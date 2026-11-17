// Generic OAuth2 login. Providers come from the OAUTH_PROVIDERS secret (generated from provider.json by scripts/deploy.mjs).
import { ApiError } from './store.js'

export interface ProviderCfg {
  enabled?: boolean; allowRegister?: boolean; displayName?: string
  clientId?: string; clientSecret?: string; scopes?: string
  authUrl?: string; tokenUrl?: string; userInfoUrl?: string; emailsUrl?: string
  emailField?: string; verifiedField?: string
}
export interface Provider extends Required<Pick<ProviderCfg, 'enabled' | 'allowRegister' | 'displayName' | 'clientId' | 'clientSecret' | 'scopes' | 'authUrl' | 'tokenUrl' | 'userInfoUrl' | 'emailField'>> {
  id: string; emailsUrl?: string; verifiedField?: string
}

const PRESETS: Record<string, ProviderCfg> = {
  github: { displayName: 'GitHub', scopes: 'read:user user:email', authUrl: 'https://github.com/login/oauth/authorize', tokenUrl: 'https://github.com/login/oauth/access_token', userInfoUrl: 'https://api.github.com/user', emailsUrl: 'https://api.github.com/user/emails' },
  google: { displayName: 'Google', scopes: 'openid email', authUrl: 'https://accounts.google.com/o/oauth2/v2/auth', tokenUrl: 'https://oauth2.googleapis.com/token', userInfoUrl: 'https://openidconnect.googleapis.com/v1/userinfo', verifiedField: 'email_verified' },
  gitlab: { displayName: 'GitLab', scopes: 'read_user', authUrl: 'https://gitlab.com/oauth/authorize', tokenUrl: 'https://gitlab.com/oauth/token', userInfoUrl: 'https://gitlab.com/api/v4/user' },
  discord: { displayName: 'Discord', scopes: 'identify email', authUrl: 'https://discord.com/api/oauth2/authorize', tokenUrl: 'https://discord.com/api/oauth2/token', userInfoUrl: 'https://discord.com/api/users/@me', verifiedField: 'verified' },
  microsoft: { displayName: 'Microsoft', scopes: 'openid email profile', authUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize', tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token', userInfoUrl: 'https://graph.microsoft.com/oidc/userinfo' },
  gitee: { displayName: 'Gitee', scopes: 'user_info emails', authUrl: 'https://gitee.com/oauth/authorize', tokenUrl: 'https://gitee.com/oauth/token', userInfoUrl: 'https://gitee.com/api/v5/user', emailsUrl: 'https://gitee.com/api/v5/emails' },
  linuxdo: { displayName: 'Linux.do', scopes: 'user', authUrl: 'https://connect.linux.do/oauth2/authorize', tokenUrl: 'https://connect.linux.do/oauth2/token', userInfoUrl: 'https://connect.linux.do/api/user' },
}

/** Parse the secret + optional dashboard overrides; a provider is usable only when it has client id/secret and all endpoints. Never throws. */
export function loadProviders(raw: string | undefined, custom: Record<string, ProviderCfg> = {}): Provider[] {
  let cfg: Record<string, ProviderCfg> = {}
  try { const j = JSON.parse(raw || '{}'); cfg = j.providers ?? j } catch { cfg = {} }
  const merged: Record<string, ProviderCfg> = { ...cfg }
  for (const [id, c] of Object.entries(custom)) merged[id] = { ...merged[id], ...c }
  const out: Provider[] = []
  for (const [id, c] of Object.entries(merged)) {
    if (!/^[a-z0-9_-]{1,32}$/.test(id) || !c || typeof c !== 'object') continue
    const m = { ...PRESETS[id], ...c }
    if (!m.clientId || !m.clientSecret || !m.authUrl || !m.tokenUrl || !m.userInfoUrl) continue
    out.push({
      id, enabled: m.enabled !== false, allowRegister: m.allowRegister !== false, displayName: m.displayName || id,
      clientId: m.clientId, clientSecret: m.clientSecret, scopes: m.scopes || 'openid email',
      authUrl: m.authUrl, tokenUrl: m.tokenUrl, userInfoUrl: m.userInfoUrl, emailField: m.emailField || 'email',
      emailsUrl: m.emailsUrl, verifiedField: m.verifiedField,
    })
  }
  return out
}

export const authorizeUrl = (p: Provider, redirect: string, state: string): string => {
  const u = new URL(p.authUrl)
  u.search = new URLSearchParams({ ...Object.fromEntries(u.searchParams), client_id: p.clientId, redirect_uri: redirect, response_type: 'code', scope: p.scopes, state }).toString()
  return u.toString()
}

const UA = { 'User-Agent': 'dsh-remote-worker', Accept: 'application/json' }

/** Exchange code and return a verified email. */
export async function fetchEmail(p: Provider, code: string, redirect: string): Promise<string> {
  const tr = await fetch(p.tokenUrl, {
    method: 'POST', headers: { ...UA, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirect, client_id: p.clientId, client_secret: p.clientSecret }),
  })
  const t = await tr.json().catch(() => ({})) as { access_token?: string }
  if (!t.access_token) throw new ApiError('OAUTH_TOKEN_FAILED', 502)
  const h = { ...UA, Authorization: `Bearer ${t.access_token}` }
  const u = await (await fetch(p.userInfoUrl, { headers: h })).json().catch(() => ({})) as Record<string, unknown>
  let email = '', verified = true
  if (p.emailsUrl) { // GitHub: /user may hide the email; use the primary verified one
    const list = await (await fetch(p.emailsUrl, { headers: h })).json().catch(() => []) as { email: string; primary: boolean; verified: boolean }[]
    const e = Array.isArray(list) ? list.find(x => x.primary && x.verified) ?? list.find(x => x.verified) : undefined
    email = e?.email ?? ''
  } else {
    email = String(u[p.emailField] ?? '')
    if (p.verifiedField && u[p.verifiedField] !== true && u[p.verifiedField] !== 'true') verified = false
  }
  if (!email || !verified || email.length > 254 || !email.includes('@')) throw new ApiError('OAUTH_EMAIL_UNVERIFIED', 403)
  return email
}
