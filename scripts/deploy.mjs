#!/usr/bin/env node
// One-command deploy.  node scripts/deploy.mjs
//
// Auth modes (first match wins):
//   1. CLOUDFLARE_API_TOKEN=...                      scoped API token
//   2. CLOUDFLARE_EMAIL=... CLOUDFLARE_API_KEY=...   Global API Key
//   3. nothing                                       use the existing `wrangler login` (OAuth) session
// Optional env:
//   CLOUDFLARE_ACCOUNT_ID  (required when the login has several accounts)
//   WORKER_NAME (default dsh-remote)   DSH_ACCOUNT / DSH_PASSWORD (first login account, also made dashboard admin)
//   ADMIN_TOKEN (default: random, kept if already set)   SKIP_TURN=1   FORCE_TURN=1
import { spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const base = join(dirname(fileURLToPath(import.meta.url)), '..')
const worker = join(base, 'worker'), web = join(base, 'web')
const env = { ...process.env }
const envFile = join(base, 'env.json')
if (existsSync(envFile)) {
  const cfg = JSON.parse(readFileSync(envFile, 'utf8'))
  for (const [k, v] of Object.entries(cfg)) {
    if (!k.startsWith('_') && v !== '' && v !== null && v !== undefined && !env[k]) env[k] = String(v)
  }
  console.log('Loaded config from env.json')
}
const name = env.WORKER_NAME || 'dsh-remote'
const sh = process.platform === 'win32'

function run(cmd, args, { cwd = worker, input, allowFail, retries = 1 } = {}) {
  let r
  for (let i = 0; i < retries; i++) {
    r = spawnSync(cmd, args, { cwd, env, encoding: 'utf8', shell: sh, input })
    if (r.status === 0) return r
  }
  if (!allowFail) { console.error(r.stdout, r.stderr); throw new Error(`${cmd} ${args.join(' ')} failed`) }
  return r
}
const step = (n, t) => console.log(`\n[${n}/6] ${t}`)

// ---- auth ----
let headers = null
if (env.CLOUDFLARE_API_TOKEN) headers = { Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}` }
else if (env.CLOUDFLARE_EMAIL && env.CLOUDFLARE_API_KEY) headers = { 'X-Auth-Email': env.CLOUDFLARE_EMAIL, 'X-Auth-Key': env.CLOUDFLARE_API_KEY }
const authMode = headers ? (env.CLOUDFLARE_API_TOKEN ? 'API Token' : 'Global API Key') : 'wrangler OAuth'
console.log(`Auth mode: ${authMode}`)

async function cf(path, init = {}, h = headers) {
  const res = await fetch(`https://api.cloudflare.com/client/v4${path}`, { ...init, headers: { 'Content-Type': 'application/json', ...h } })
  const j = await res.json()
  if (!j.success) throw new Error(`${path}: ${j.errors?.map(e => e.message).join('; ')}`)
  return j.result
}
function oauthHeaders() {
  const r = run('npx', ['wrangler', 'auth', 'token'], { allowFail: true })
  const tok = (r.stdout || '').trim().split(/\r?\n/).pop()?.trim()
  return tok && tok.length > 20 ? { Authorization: `Bearer ${tok}` } : null
}

step(1, 'install dependencies & build dashboard')
run('npm', ['ci'], { cwd: worker })
if (existsSync(join(web, 'package.json'))) {
  run('npm', ['ci'], { cwd: web }); run('npm', ['run', 'build'], { cwd: web })
} else if (existsSync(join(worker, 'public', 'index.html'))) {
  console.log('  web/ 源码不在包内,直接使用预构建的 worker/public 前端产物')
} else {
  throw new Error('缺少 web/ 源码且 worker/public 未构建,请改用 -source.zip 完整源码包')
}

step(2, 'resolve Cloudflare account')
let acct = env.CLOUDFLARE_ACCOUNT_ID
if (!acct) {
  try {
    const list = await cf('/accounts', {}, headers ?? oauthHeaders() ?? {})
    if (list.length === 1) acct = list[0].id
    else throw new Error(`found ${list.length} accounts: ${list.map(a => `${a.name}=${a.id}`).join(', ')}`)
  } catch (e) { console.log(`  cannot auto-detect account (${e.message}); set CLOUDFLARE_ACCOUNT_ID if wrangler complains`) }
}
if (acct) { env.CLOUDFLARE_ACCOUNT_ID = acct; console.log('  account', acct) }

step(3, 'deploy worker')
const deployArgs = ['wrangler', 'deploy', '--name', name]
if (env.DSH_ACCOUNT) deployArgs.push('--var', `ADMIN_ACCOUNTS:${env.DSH_ACCOUNT}`)
if (env.DSH_DO_LOCATION) deployArgs.push('--var', `DSH_DO_LOCATION:${env.DSH_DO_LOCATION}`)
const dep = run('npx', deployArgs, { retries: 3 })
const url = /https:\/\/[^\s]+workers\.dev/.exec(dep.stdout + dep.stderr)?.[0]
console.log('  ', url ?? '(workers.dev URL not detected)')

step(4, 'secrets (ADMIN_TOKEN, TURN)')
const listed = run('npx', ['wrangler', 'secret', 'list', '--name', name, '--format', 'json'], { allowFail: true })
const existing = new Set((() => { try { return JSON.parse(listed.stdout).map(s => s.name) } catch { return [] } })())
const secrets = {}
let adminToken = env.ADMIN_TOKEN
if (adminToken || !existing.has('ADMIN_TOKEN')) { adminToken ||= randomBytes(24).toString('base64url'); secrets.ADMIN_TOKEN = adminToken }
let turn = existing.has('TURN_KEY_ID') ? 'kept' : 'none'
  if (env.TURN_KEY_ID && env.TURN_KEY_API_TOKEN) {
    secrets.TURN_KEY_ID = env.TURN_KEY_ID
    secrets.TURN_KEY_API_TOKEN = env.TURN_KEY_API_TOKEN
    turn = 'configured'
  } else if (env.SKIP_TURN !== '1' && acct && (turn === 'none' || env.FORCE_TURN === '1')) {
    const tries = [headers, oauthHeaders()].filter(Boolean)
    for (const h of tries) {
      try {
        const key = await cf(`/accounts/${acct}/calls/turn_keys`, { method: 'POST', body: JSON.stringify({ name: `${name}-turn` }) }, h)
        secrets.TURN_KEY_ID = key.uid; secrets.TURN_KEY_API_TOKEN = key.secret ?? key.apiToken ?? key.key; turn = 'created'
        break
      } catch (e) { console.log('  TURN create failed:', e.message) }
    }
    if (turn === 'none') console.log('  TURN not configured (Relay-only). Create it later in the dashboard: TURN 中转 -> 一键创建.')
  }
  const providerFile = join(base, 'provider.json')
  if (existsSync(providerFile)) {
    try { secrets.OAUTH_PROVIDERS = JSON.stringify(JSON.parse(readFileSync(providerFile, 'utf8'))); console.log('  OAuth providers loaded from provider.json') }
    catch (e) { console.log('  provider.json invalid, skipped:', e.message) }
  }
  if (Object.keys(secrets).length) {
    const tmp = join(worker, '.secrets.tmp.json')
    writeFileSync(tmp, JSON.stringify(secrets))
    try { run('npx', ['wrangler', 'secret', 'bulk', '.secrets.tmp.json', '--name', name], { retries: 3 }) } finally { try { unlinkSync(tmp) } catch { } }
  }
  if (existsSync(envFile)) {
    const cfg = JSON.parse(readFileSync(envFile, 'utf8'))
    let dirty = false
    const fill = (k, v) => { if (v && !cfg[k]) { cfg[k] = v; dirty = true } }
    fill('CLOUDFLARE_ACCOUNT_ID', acct)
    fill('ADMIN_TOKEN', secrets.ADMIN_TOKEN)
    if (turn === 'created') { cfg.TURN_KEY_ID = secrets.TURN_KEY_ID; cfg.TURN_KEY_API_TOKEN = secrets.TURN_KEY_API_TOKEN; dirty = true }
    if (dirty) { writeFileSync(envFile, JSON.stringify(cfg, null, 2) + '\n'); console.log('  backfilled env.json') }
  }
  console.log('  TURN:', turn)

  step(5, 'first account')
  const out = { url, adminToken: adminToken ?? '(unchanged, previously set)', turn }
  if (url && env.DSH_ACCOUNT && env.DSH_PASSWORD && adminToken) {
    await new Promise(r => setTimeout(r, 6000))
    try {
      const r = await fetch(`${url}/api/v1/admin/accounts`, { method: 'POST', headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ email: env.DSH_ACCOUNT, password: env.DSH_PASSWORD }) })
      console.log('  create account HTTP', r.status); out.account = env.DSH_ACCOUNT
    } catch (e) {
      console.log(`  could not reach ${url} from this machine (${e.message}). If workers.dev is blocked, bind your custom domain, then create the account with:`)
      console.log(`  curl -X POST ${url}/api/v1/admin/accounts -H "Authorization: Bearer <ADMIN_TOKEN>" -H "Content-Type: application/json" -d '{"email":"...","password":"...(>=12)"}'`)
    }
  }

  step(6, 'save summary')
  writeFileSync(join(base, 'deploy-output.json'), JSON.stringify(out, null, 2))
  console.log(`\nDone -> ${url ?? ''}\nSummary (admin token etc.) saved to deploy-output.json (gitignored). Bind your custom domain in the dashboard: Workers & Pages -> ${name} -> Settings -> Domains.`)
