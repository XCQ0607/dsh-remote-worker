import { DurableObject } from 'cloudflare:workers'
import { z } from 'zod'
import {
  createControlFrame, decodeControlFrame, deviceRefreshRequestSchema, deviceRegistrationRequestSchema,
  MAX_CONTROL_FRAME_BYTES, MAX_RELAY_FRAME_BYTES, MAX_ICE_CANDIDATES_PER_CONNECTION, parseWireJson, relayPayloadSchema,
  type ConnectRequestPayload, type ControlFrame, type HelloPayload, type RelayPayload,
  type SecureHandshakePayload, type TransportSelectedPayload,
} from './protocol/index.js'
import { ApiError, Store, normEmail, type SavedDevice } from './store.js'
import { equal, hash, secret } from './crypto.js'
import { authorizeUrl, fetchEmail, loadProviders, type ProviderCfg } from './oauth.js'
import { createTurnKey, clearIceCache, fetchIceServers, listTurnKeys, type CfAuth, type TurnKey } from './ice.js'
import { defaultStunServers, resolveStunUrls } from './stun.js'
import { defaultSettings, sanitize, type Settings } from './settings.js'

export interface Env {
  HUB: DurableObjectNamespace<Hub>
  ASSETS: Fetcher
  ADMIN_TOKEN?: string
  TURN_KEY_ID?: string
  TURN_KEY_API_TOKEN?: string
  TURN_TTL_SECONDS?: string
  ADMIN_ACCOUNTS?: string
  OAUTH_PROVIDERS?: string
  DSH_DO_LOCATION?: string
  [key: string]: unknown
}

type Role = 'host' | 'client'
type TransportName = 'lan' | 'p2p' | 'turn' | 'relay'
/** Per-socket state; survives hibernation via serializeAttachment (<2 KiB). */
interface Att { id?: string; account?: string; role?: Role; caps: string[]; version: string; lastPong: number; nonce?: string; created: number }
type Link = { id: string; host: string; client: string; stage: 'pending' | 'accepted' | 'handshake' | 'ready'; created: number; preferredTransports: TransportName[] }
type Dropped = { host: string; client: string; expiresAt: number; frames: number }

const DROPPED_TTL_MS = 300_000
const WEBRTC_FALLBACK_TIMEOUT_MS = 12_000
const SUPPORTED = ['transport.lan', 'transport.p2p', 'transport.turn', 'transport.relay'] as const
const TRANSPORTS: readonly TransportName[] = ['lan', 'p2p', 'turn', 'relay']
const loginSchema = z.object({ email: z.string().min(1).max(254), password: z.string().min(1).max(1024) }).strict()

function modernHost(version: string): boolean {
  const m = /^v?(\d+)\.(\d+)\.(\d+)(?:\+.*)?$/.exec(version)
  if (!m) return false
  const [major, minor, patch] = m.slice(1).map(Number)
  return major! > 0 || minor! > 2 || (minor === 2 && patch! >= 15)
}

const json = (status: number, value: unknown, headers: HeadersInit = {}): Response =>
  new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers } })

export class Hub extends DurableObject<Env> {
  private store: Store
  private cfg: Settings
  private turn?: TurnKey
  private startedAt = Date.now()
  private events: { t: number; type: string; detail: string; actor: string }[] = []
  private admins = new Set<string>()
  private oauthCustom: Record<string, ProviderCfg> = {}
  private links: Record<string, Link> = {}
  private dropped = new Map<string, Dropped>()
  private counters = new Map<string, Map<string, number>>() // relay counters (memory only; Noise protects replays)
  private ice = new Map<string, number>()
  private rate = new Map<string, { count: number; until: number }>()
  private windows = new WeakMap<WebSocket, { start: number; frames: number }>()
  private peerCache?: Map<string, { ws: WebSocket; att: Att }>

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    this.store = new Store(ctx.storage)
    this.cfg = defaultSettings(env)
    if (env.TURN_KEY_ID && env.TURN_KEY_API_TOKEN) this.turn = { keyId: String(env.TURN_KEY_ID).trim(), apiToken: String(env.TURN_KEY_API_TOKEN).trim() }
    this.store.onInvalidate = id => { void this.disconnect(id, 'AUTH_INVALID') }
    ctx.blockConcurrencyWhile(async () => {
      const legacy = await ctx.storage.get<Record<string, Link>>('links')
      if (legacy) {
        this.links = legacy
        await ctx.storage.delete('links')
        for (const l of Object.values(legacy)) await ctx.storage.put(`link:${l.id}`, l)
      } else {
        for (const l of (await ctx.storage.list<Link>({ prefix: 'link:' })).values()) this.links[l.id] = l
      }
      const saved = await ctx.storage.get<Record<string, unknown>>('settings')
      if (saved) this.cfg = sanitize(saved, this.cfg)
      this.store.sessionHours = this.cfg.sessionHours
      this.store.maxDevices = this.cfg.maxDevicesPerAccount
      this.turn = (await ctx.storage.get<TurnKey>('turn')) ?? this.turn
      this.events = (await ctx.storage.get<typeof this.events>('events')) ?? []
      this.admins = new Set((await ctx.storage.get<string[]>('admins')) ?? [])
      this.oauthCustom = (await ctx.storage.get<Record<string, ProviderCfg>>('oauth_custom')) ?? {}
    })
  }

  // ---------------- helpers ----------------
  private saveLink(link: Link): void { void this.ctx.storage.put(`link:${link.id}`, link) }
  private deleteLinkStorage(id: string): void { void this.ctx.storage.delete(`link:${id}`) }
  private sockets(): { ws: WebSocket; att: Att }[] {
    return this.ctx.getWebSockets().map(ws => ({ ws, att: ws.deserializeAttachment() as Att | null })).filter((x): x is { ws: WebSocket; att: Att } => x.att !== null)
  }
  private peer(id: string): { ws: WebSocket; att: Att } | undefined {
    if (!this.peerCache) {
      this.peerCache = new Map()
      for (const s of this.sockets()) if (s.att.id) this.peerCache.set(s.att.id, s)
    }
    return this.peerCache.get(id)
  }
  private setAtt(ws: WebSocket, att: Att): void {
    ws.serializeAttachment(att)
    if (att.id && this.peerCache) this.peerCache.set(att.id, { ws, att })
  }
  private send(ws: WebSocket, frame: ControlFrame): void { try { ws.send(JSON.stringify(frame)) } catch { /* closing */ } }
  private sendRaw(ws: WebSocket, raw: string): void { try { ws.send(raw) } catch { /* closing */ } }
  private get turnOn(): boolean { return this.cfg.turnEnabled && this.turn !== undefined }
  private supported(): string[] {
    return SUPPORTED.filter(c => {
      if (c === 'transport.p2p') return this.cfg.p2pEnabled
      if (c === 'transport.turn') return this.turnOn
      return true
    })
  }
  private negotiated(offered: readonly string[]): string[] { return this.supported().filter(c => offered.includes(c)) }
  private async ensureAlarm(ms: number): Promise<void> {
    const cur = await this.ctx.storage.getAlarm()
    if (cur === null || cur > Date.now() + ms) await this.ctx.storage.setAlarm(Date.now() + ms)
  }

  private recordDropped(link: Link): void {
    const now = Date.now()
    for (const [k, v] of this.dropped) if (v.expiresAt <= now) this.dropped.delete(k)
    while (this.dropped.size >= 4096) this.dropped.delete(this.dropped.keys().next().value!)
    this.dropped.set(link.id, { host: link.host, client: link.client, expiresAt: now + DROPPED_TTL_MS, frames: 0 })
  }
  private removeLink(link: Link): void {
    delete this.links[link.id]
    this.counters.delete(link.id)
    this.ice.delete(link.id)
    this.recordDropped(link)
    this.deleteLinkStorage(link.id)
  }
  private drop(link: Link, code: string): void {
    this.removeLink(link)
    for (const id of [link.host, link.client]) {
      const p = this.peer(id)
      if (p && (p.att.role === 'client' || modernHost(p.att.version))) this.send(p.ws, createControlFrame('error', { code, message: code, connectionId: link.id, retryable: true }))
    }
  }
  private isDroppedFrame(att: Att, frame: ControlFrame): boolean {
    if (frame.type === 'ping' || frame.type === 'pong' || frame.type === 'connect.request') return false
    const id = (frame.payload as Record<string, unknown>).connectionId
    if (typeof id !== 'string' || this.links[id]) return false
    const d = this.dropped.get(id)
    if (!d) return false
    if (d.expiresAt <= Date.now()) { this.dropped.delete(id); return false }
    if (att.id !== d.host && att.id !== d.client) return false
    d.frames++
    return true
  }
  /** Close every socket of a device and drop its links. */
  async disconnect(id: string, code: string): Promise<void> {
    this.peerCache?.delete(id)
    for (const link of Object.values(this.links)) if (link.host === id || link.client === id) this.drop(link, code)
    for (const { ws, att } of this.sockets()) {
      if (att.id !== id) continue
      this.setAtt(ws, { ...att, id: undefined, role: undefined }) // webSocketClose must not re-disconnect
      try { ws.close(code === 'CONNECTION_REPLACED' ? 4003 : 4001, code) } catch { /* already closed */ }
    }
  }

  // ---------------- HTTP / WS entry ----------------
  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url)
    try {
      const origin = req.headers.get('Origin')
      if (origin && origin !== url.origin && !this.cfg.allowedOrigins.includes(origin)) throw new ApiError('AUTH_INVALID', 403)
      if (url.pathname === '/ws/v1/connect' && req.headers.get('Upgrade') === 'websocket') return this.accept(url)
      return await this.route(req, url)
    } catch (error) {
      const e = error instanceof ApiError ? error : error instanceof z.ZodError ? new ApiError('INVALID_MESSAGE') : new ApiError('INTERNAL_ERROR', 500)
      if (!(error instanceof ApiError) && !(error instanceof z.ZodError)) console.error('internal', String(error))
      return json(e.status, { error: { code: e.code, message: e.code, requestId: crypto.randomUUID(), retryable: e.status === 429 || e.status >= 500 } }, e.status === 429 ? { 'Retry-After': '60' } : {})
    }
  }

  private accept(url: URL): Response {
    if (url.search) return new Response('Forbidden', { status: 403 })
    if (this.ctx.getWebSockets().length >= this.cfg.maxConnections) return new Response('Forbidden', { status: 403 })
    const pair = new WebSocketPair()
    const [client, server] = [pair[0], pair[1]]
    this.ctx.acceptWebSocket(server)
    this.setAtt(server, { caps: [], version: '', lastPong: Date.now(), created: Date.now() })
    void this.ensureAlarm(this.cfg.helloTimeoutMs)
    return new Response(null, { status: 101, webSocket: client })
  }

  private limit(key: string, max: number): void {
    const now = Date.now()
    if (this.rate.size > 4096) for (const [k, v] of this.rate) if (v.until < now) this.rate.delete(k)
    let e = this.rate.get(key)
    if (!e || e.until < now) { e = { count: 0, until: now + 60_000 }; this.rate.set(key, e) }
    if (++e.count > max) throw new ApiError('RATE_LIMITED', 429)
  }
  private async body(req: Request): Promise<unknown> {
    if (!req.headers.get('content-type')?.toLowerCase().startsWith('application/json')) throw new ApiError('INVALID_MESSAGE', 415)
    const text = await req.text()
    if (text.length > 16384) throw new ApiError('FRAME_TOO_LARGE', 413)
    try { return parseWireJson(text) } catch { throw new ApiError('INVALID_MESSAGE') }
  }
  private bearer(req: Request): string {
    const a = req.headers.get('authorization')
    if (a) return a.startsWith('Bearer ') ? a.slice(7) : ''
    return /(?:^|;\s*)dsh_session=([A-Za-z0-9_-]+)/.exec(req.headers.get('cookie') ?? '')?.[1] ?? ''
  }
  private async deviceAuth(req: Request): Promise<SavedDevice> {
    const a = req.headers.get('authorization')
    if (!a?.startsWith('Bearer ')) throw new ApiError('AUTH_REQUIRED', 401)
    return this.store.authenticate(a.slice(7))
  }
  private cookie(value: string, age: number, url: URL): string {
    return `dsh_session=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${age}${url.protocol === 'https:' ? '; Secure' : ''}`
  }
  private async describe(d: SavedDevice) {
    return { ...d.descriptor, membershipId: `account:${(await hash(d.account)).slice(0, 16)}`, online: this.peer(d.descriptor.deviceId) !== undefined, lastSeenAt: d.lastSeenAt }
  }
  private async route(req: Request, url: URL): Promise<Response> {
    const path = url.pathname, method = req.method
    if (method === 'GET' && ['/health', '/healthz', '/ready'].includes(path)) return json(200, { status: 'ok' })
    const ip = req.headers.get('CF-Connecting-IP') ?? 'unknown'
    this.limit(`api:${ip}`, 240)
    const profile = (account: string) => ({ account, profile: { displayName: account }, isAdmin: this.isAdminAccount(account) })

    if (method === 'POST' && path === '/api/v1/auth/login') {
      this.limit(`login:${ip}`, 20)
      const c = loginSchema.parse(await this.body(req))
      const account = await this.store.verifyLogin(c.email, c.password)
      const s = await this.store.createSession(account)
      await this.log('login', ip, account)
      return json(200, { ...profile(account), token: s.value, expiresAt: s.expiresAt }, { 'Set-Cookie': this.cookie(s.value, this.cfg.sessionHours * 3600, url) })
    }
    if (method === 'GET' && path === '/api/v1/auth/me') {
      const a = await this.store.session(this.bearer(req))
      return json(200, { ...profile(a), oauthInit: !!(await this.ctx.storage.get(`oauthpw:${normEmail(a)}`)) })
    }
    if (method === 'GET' && path === '/api/v1/network/ping') {
      return json(200, { ok: true, ts: Date.now(), stunServers: this.cfg.stunServers.filter(s => s.enabled).map(s => s.url) })
    }
    if (method === 'GET' && path === '/api/v1/account/profile') {
      const a = await this.accountAuth(req)
      const acct = await this.store.getAccount(a)
      const oauthInit = !!(await this.ctx.storage.get(`oauthpw:${normEmail(a)}`))
      const sessions = await this.store.listSessions(a)
      return json(200, {
        email: a, isAdmin: this.isAdminAccount(a), hasPassword: !oauthInit,
        disabled: !!acct?.disabled, maxDevices: acct?.maxDevices ?? this.cfg.maxDevicesPerAccount,
        sessions,
      })
    }
    if (method === 'POST' && path === '/api/v1/account/password') {
      const a = await this.accountAuth(req)
      const b = await this.body(req) as { currentPassword?: unknown; newPassword?: unknown }
      const newPw = typeof b.newPassword === 'string' ? b.newPassword : ''
      if (newPw.length < 12 || newPw.length > 1024) throw new ApiError('INVALID_MESSAGE')
      const oauthInit = !!(await this.ctx.storage.get(`oauthpw:${normEmail(a)}`))
      if (!oauthInit) {
        const cur = typeof b.currentPassword === 'string' ? b.currentPassword : ''
        await this.store.verifyLogin(a, cur)
      }
      await this.store.upsertAccount(a, newPw)
      if (oauthInit) await this.ctx.storage.delete(`oauthpw:${normEmail(a)}`)
      await this.log('account.password.changed', a, a)
      return json(200, { ok: true })
    }
    if (method === 'GET' && path === '/api/v1/account/sessions') {
      const a = await this.accountAuth(req)
      return json(200, { items: await this.store.listSessions(a) })
    }
    const sesDel = /^\/api\/v1\/account\/sessions\/([A-Za-z0-9_-]{6,32})$/.exec(path)
    if (method === 'DELETE' && sesDel) {
      const a = await this.accountAuth(req)
      await this.store.deleteSessionById(a, sesDel[1]!)
      return json(200, { ok: true })
    }
    if (method === 'GET' && path === '/api/v1/account/host-registration-codes') {
      const a = await this.accountAuth(req)
      const now = Date.now()
      const all = await this.ctx.storage.list<{ account: string; code: string; registrationId: string; expiresAt: number }>({ prefix: 'hostcode:' })
      const items = [...all.values()].filter(v => v.account === a && v.expiresAt > now).sort((x, y) => y.expiresAt - x.expiresAt)
      return json(200, { items })
    }
    if (method === 'POST' && path === '/api/v1/account/host-registration-codes') {
      const a = await this.accountAuth(req)
      const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
      const pick = (n: number) => Array.from(crypto.getRandomValues(new Uint8Array(n)), x => chars[x % chars.length]).join('')
      const code = `${pick(4)}-${pick(4)}`
      const registrationId = crypto.randomUUID()
      const expiresAt = Date.now() + 600_000
      const rec = { account: a, code, registrationId, expiresAt }
      await this.ctx.storage.put(`hostcode:${code}`, rec)
      await this.ensureAlarm(600_000)
      return json(200, rec)
    }
    const hcDel = /^\/api\/v1\/account\/host-registration-codes\/([^/]+)$/.exec(path)
    if (method === 'DELETE' && hcDel) {
      const a = await this.accountAuth(req)
      const id = decodeURIComponent(hcDel[1]!)
      const all = await this.ctx.storage.list<{ account: string; code: string; registrationId: string }>({ prefix: 'hostcode:' })
      for (const [k, v] of all) {
        if (v.account === a && (v.registrationId === id || v.code === id)) await this.ctx.storage.delete(k)
      }
      return json(200, { ok: true })
    }
    const devPatch = /^\/api\/v1\/account\/devices\/([^/]+)$/.exec(path)
    if (method === 'PATCH' && devPatch) {
      const a = await this.accountAuth(req)
      const id = decodeURIComponent(devPatch[1]!)
      const b = await this.body(req) as { displayName?: unknown }
      const name = typeof b.displayName === 'string' ? b.displayName.trim().slice(0, 64) : ''
      if (!name) throw new ApiError('INVALID_MESSAGE')
      await this.store.rename(a, id, name)
      return json(200, { ok: true })
    }
    if (path === '/api/v1/account/webhooks') {
      const a = await this.accountAuth(req)
      if (method === 'GET') return json(200, { items: await this.getWebhooks(a) })
      if (method === 'POST') {
        const b = z.object({
          id: z.string().trim().max(32).optional(),
          name: z.string().trim().max(64).optional(),
          url: z.string().trim().url().max(512),
          enabled: z.boolean().optional(),
          events: z.array(z.enum(['host_offline', 'device_registered'])).optional(),
          deviceIds: z.array(z.string().trim().max(128)).max(64).optional(),
        }).parse(await this.body(req))
        const list = await this.getWebhooks(a)
        const id = b.id || secret().slice(0, 10)
        const item = { id, name: b.name || 'Webhook', url: b.url, enabled: b.enabled ?? true, events: b.events ?? ['host_offline', 'device_registered'], deviceIds: (b.deviceIds ?? []).filter(Boolean) }
        const idx = list.findIndex(x => x.id === id)
        if (idx >= 0) list[idx] = item; else list.push(item)
        await this.ctx.storage.put(`webhooks:${a}`, list)
        return json(200, item)
      }
    }
    const whDel = /^\/api\/v1\/account\/webhooks\/([A-Za-z0-9_-]{1,32})$/.exec(path)
    if (method === 'DELETE' && whDel) {
      const a = await this.accountAuth(req)
      const list = (await this.getWebhooks(a)).filter(x => x.id !== whDel[1])
      await this.ctx.storage.put(`webhooks:${a}`, list)
      return json(200, { ok: true })
    }
    if (method === 'POST' && path === '/api/v1/account/webhooks/test') {
      const a = await this.accountAuth(req)
      const b = (await this.body(req).catch(() => ({}))) as { id?: string }
      const list = await this.getWebhooks(a)
      const target = b?.id ? list.find(x => x.id === b.id) : list[0]
      if (!target) throw new ApiError('WEBHOOK_NOT_FOUND', 404)
      const res = await this.sendOneWebhook(target.url, a, 'device_registered', { test: true, message: 'DSH Remote Webhook 测试通知' })
      if (!res.ok) return json(400, { error: { code: 'WEBHOOK_FAILED', message: res.error ?? 'Webhook 请求失败' } })
      return json(200, res)
    }
    // ---- OAuth login (providers from provider.json -> OAUTH_PROVIDERS secret) ----
    if (method === 'GET' && path === '/api/v1/auth/oauth/providers') {
      const ov = await this.oauthOverrides()
      return json(200, {
        items: loadProviders(this.env.OAUTH_PROVIDERS, this.oauthCustom)
          .filter(p => ov[p.id]?.enabled ?? p.enabled)
          .map(p => ({ id: p.id, displayName: p.displayName, startUrl: `/api/v1/auth/oauth/${p.id}/start`, qrStartUrl: `/api/v1/auth/oauth/qr/start?provider=${p.id}` })),
      })
    }
    if (path === '/api/v1/auth/oauth/qr/start' && (method === 'POST' || method === 'GET')) {
      this.limit(`oauth:${ip}`, 30)
      const pid = url.searchParams.get('provider') ?? ''
      const p = loadProviders(this.env.OAUTH_PROVIDERS, this.oauthCustom).find(x => x.id === pid)
      const ov = p ? (await this.oauthOverrides())[p.id] : undefined
      if (!p || !(ov?.enabled ?? p.enabled)) throw new ApiError('OAUTH_DISABLED', 400)
      const qrId = secret().slice(0, 24)
      await this.ctx.storage.put(`qr:${qrId}`, { id: p.id, exp: Date.now() + 600_000, status: 'pending' })
      return json(200, { qrId, scanUrl: `${url.origin}/api/v1/auth/q/${qrId}`, expiresIn: 600, provider: p.id })
    }
    const qrPoll = /^\/api\/v1\/auth\/oauth\/qr\/([A-Za-z0-9_-]{8,64})$/.exec(path)
    if (method === 'GET' && (qrPoll || path === '/api/v1/auth/oauth/qr/status' || path === '/api/v1/auth/oauth/qr/poll')) {
      const qrId = qrPoll ? qrPoll[1]! : (url.searchParams.get('qrId') ?? '')
      const q = qrId ? await this.ctx.storage.get<{ id: string; exp: number; status: string; token?: string; account?: string; expiresAt?: number }>(`qr:${qrId}`) : undefined
      if (!q || q.exp < Date.now()) { if (q) await this.ctx.storage.delete(`qr:${qrId}`); return json(200, { status: 'expired' }) }
      if (q.status === 'confirmed' || q.status === 'complete') { await this.ctx.storage.delete(`qr:${qrId}`); return json(200, { status: 'complete', token: q.token, account: q.account, expiresAt: q.expiresAt }) }
      return json(200, { status: 'pending' })
    }
    const qm = /^\/api\/v1\/auth\/q\/([A-Za-z0-9_-]{8,64})$/.exec(path)
    if (method === 'GET' && qm) {
      this.limit(`oauth:${ip}`, 30)
      const q = await this.ctx.storage.get<{ id: string; exp: number; status: string }>(`qr:${qm[1]}`)
      if (!q || q.exp < Date.now()) return new Response('QR expired', { status: 410 })
      const p = loadProviders(this.env.OAUTH_PROVIDERS, this.oauthCustom).find(x => x.id === q.id)
      if (!p) return new Response('OAuth not configured', { status: 400 })
      if (!q || q.exp < Date.now()) return new Response('QR expired', { status: 410 })
      const state = secret(), secure = url.protocol === 'https:' ? '; Secure' : ''
      await this.ctx.storage.put(`ostate:${await hash(state)}`, { id: p.id, exp: Date.now() + 600_000, qrId: qm[1] })
      return new Response(null, { status: 302, headers: { Location: authorizeUrl(p, `${url.origin}/api/v1/auth/oauth/${p.id}/callback`, state), 'Set-Cookie': `dsh_oauth=${state}; Path=/api/v1/auth/oauth; HttpOnly; SameSite=Lax; Max-Age=600${secure}` } })
    }
    if (method === 'POST' && path === '/api/v1/auth/oauth/invite') {
      this.limit(`oauth:${ip}`, 30)
      const ct = req.headers.get('content-type') ?? ''
      let raw: { token?: string; code?: string }
      if (ct.includes('application/x-www-form-urlencoded')) {
        const fd = new URLSearchParams(await req.text())
        raw = { token: fd.get('token') ?? '', code: fd.get('code') ?? '' }
      } else {
        raw = (await this.body(req)) as { token?: string; code?: string }
      }
      const b = z.object({ token: z.string().min(16).max(64), code: z.string().trim().min(4).max(32) }).parse(raw)
      const pending = await this.ctx.storage.get<{ email: string; providerId: string; qrId?: string; exp: number }>(`oinvite:${b.token}`)
      if (!pending || pending.exp < Date.now()) throw new ApiError('INVITE_SESSION_EXPIRED', 400)
      const invCode = b.code.toUpperCase().replace(/[^A-Z0-9_-]/g, '')
      const inv = await this.ctx.storage.get<{ code: string; maxUses: number; uses: number; expiresAt: number; usedBy?: Array<{ email: string; at: number }> }>(`invite:${invCode}`)
      if (!inv || (inv.expiresAt > 0 && inv.expiresAt < Date.now()) || inv.uses >= inv.maxUses) throw new ApiError('INVITE_INVALID', 400)
      inv.uses += 1
      inv.usedBy = [...(inv.usedBy ?? []), { email: pending.email, at: Date.now() }]
      await this.ctx.storage.put(`invite:${invCode}`, inv)
      await this.ctx.storage.delete(`oinvite:${b.token}`)
      if (!(await this.store.getAccount(pending.email))) {
        await this.store.upsertAccount(pending.email, secret())
        await this.ctx.storage.put(`oauthpw:${pending.email}`, true)
        await this.log('oauth.register', `${pending.providerId} ${pending.email} invite:${invCode}`, pending.email)
      }
      const s = await this.store.createSession(pending.email, req.headers.get('user-agent') ?? '')
      await this.log('login', `oauth:${pending.providerId} ${ip}`, pending.email)
      if (pending.qrId) {
        const q = await this.ctx.storage.get<{ id: string; exp: number }>(`qr:${pending.qrId}`)
        if (q && q.exp >= Date.now()) await this.ctx.storage.put(`qr:${pending.qrId}`, { ...q, status: 'confirmed', token: s.value, account: pending.email, expiresAt: s.expiresAt })
        if (ct.includes('application/x-www-form-urlencoded')) {
          return new Response('<!doctype html><meta charset="utf-8"><title>授权成功</title><body style="font-family:sans-serif;display:grid;place-items:center;min-height:100vh;background:#0b0d12;color:#e8ebf2"><div style="text-align:center"><h2>授权成功</h2><p>已完成注册并授权，请关闭此页面并返回客户端继续。</p></div></body>', { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } })
        }
        return json(200, { ok: true, qr: true })
      }
      if (ct.includes('application/x-www-form-urlencoded')) {
        return new Response(null, { status: 302, headers: { Location: '/', 'Set-Cookie': this.cookie(s.value, this.cfg.sessionHours * 3600, url) } })
      }
      return json(200, { ok: true, qr: false }, { 'Set-Cookie': this.cookie(s.value, this.cfg.sessionHours * 3600, url) })
    }
    const oa = /^\/api\/v1\/auth\/oauth\/([a-z0-9_-]+)\/(start|callback)$/.exec(path)
    if (method === 'GET' && oa) {
      this.limit(`oauth:${ip}`, 30)
      const fail = (code: string) => new Response(null, { status: 302, headers: { Location: `/?oauth_error=${code}` } })
      const p = loadProviders(this.env.OAUTH_PROVIDERS, this.oauthCustom).find(x => x.id === oa[1])
      const ov = p ? (await this.oauthOverrides())[p.id] : undefined
      if (!p || !(ov?.enabled ?? p.enabled)) return fail('OAUTH_DISABLED')
      const redirect = `${url.origin}/api/v1/auth/oauth/${p.id}/callback`
      const secure = url.protocol === 'https:' ? '; Secure' : ''
      if (oa[2] === 'start') {
        const state = secret()
        await this.ctx.storage.put(`ostate:${await hash(state)}`, { id: p.id, exp: Date.now() + 600_000 })
        return new Response(null, { status: 302, headers: { Location: authorizeUrl(p, redirect, state), 'Set-Cookie': `dsh_oauth=${state}; Path=/api/v1/auth/oauth; HttpOnly; SameSite=Lax; Max-Age=600${secure}` } })
      }
      const state = url.searchParams.get('state') ?? '', code = url.searchParams.get('code') ?? ''
      const ck = /(?:^|;\s*)dsh_oauth=([A-Za-z0-9_-]+)/.exec(req.headers.get('cookie') ?? '')?.[1]
      const sk = `ostate:${await hash(state)}`
      const saved = await this.ctx.storage.get<{ id: string; exp: number; qrId?: string }>(sk)
      await this.ctx.storage.delete(sk)
      if (!code || !saved || saved.id !== p.id || saved.exp < Date.now() || ck !== state) return fail('OAUTH_STATE_INVALID')
      try {
        const email = normEmail(await fetchEmail(p, code, redirect))
        if (!(await this.store.getAccount(email))) {
          if (!(ov?.allowRegister ?? p.allowRegister)) return fail('OAUTH_REGISTER_DISABLED')
          const dom = email.split('@')[1] ?? ''
          if (this.cfg.oauthBlockedDomains.includes(email) || this.cfg.oauthBlockedDomains.includes(dom)) return fail('OAUTH_EMAIL_BLOCKED')
          if (this.cfg.oauthAllowedDomains.length && !this.cfg.oauthAllowedDomains.includes(email) && !this.cfg.oauthAllowedDomains.includes(dom)) return fail('OAUTH_DOMAIN_NOT_ALLOWED')
          const needInvite = (ov as { requireInviteCode?: boolean } | undefined)?.requireInviteCode ?? true
          if (needInvite) {
            const pt = secret().slice(0, 24)
            await this.ctx.storage.put(`oinvite:${pt}`, { email, providerId: p.id, providerName: p.displayName, qrId: saved.qrId, exp: Date.now() + 600_000 })
            return new Response(null, { status: 302, headers: { Location: `/?oauth_invite=${encodeURIComponent(pt)}` } })
          }
          await this.store.upsertAccount(email, secret()) // random password; user may set their own later
          await this.ctx.storage.put(`oauthpw:${email}`, true)
          await this.log('oauth.register', `${p.id} ${email}`, email)
        }
        const s = await this.store.createSession(email)
        await this.log('login', `oauth:${p.id} ${ip}`, email)
        if (saved.qrId) {
          const q = await this.ctx.storage.get<{ id: string; exp: number }>(`qr:${saved.qrId}`)
          if (q && q.exp >= Date.now()) await this.ctx.storage.put(`qr:${saved.qrId}`, { ...q, status: 'confirmed', token: s.value, account: email, expiresAt: s.expiresAt })
          const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>授权成功 · DSH Remote</title>
<style>:root{color-scheme:dark light;--bg:#0b0d12;--card:rgba(255,255,255,.05);--line:rgba(255,255,255,.1);--tx:#e8ebf2;--mut:#8b93a7;--ok:#34d399;--pri:#6c8cff;--pri2:#a56bff}
@media(prefers-color-scheme:light){:root{--bg:#f4f6fb;--card:#fff;--line:#e2e6f0;--tx:#161a25;--mut:#667089}}
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:20px;font:14px/1.6 Inter,system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;background:var(--bg);color:var(--tx);background-image:radial-gradient(800px 420px at 20% -10%,rgba(108,140,255,.18),transparent),radial-gradient(600px 420px at 90% 0,rgba(165,107,255,.14),transparent)}
.card{width:100%;max-width:380px;background:var(--card);border:1px solid var(--line);border-radius:18px;padding:32px 26px;text-align:center;backdrop-filter:blur(14px);box-shadow:0 14px 36px rgba(0,0,0,.25)}
.ic{width:54px;height:54px;border-radius:16px;margin:0 auto 14px;display:grid;place-items:center;background:rgba(52,211,153,.14);color:var(--ok);border:1px solid rgba(52,211,153,.3)}
h2{margin:0 0 6px;font-size:20px}p{margin:0 0 18px;color:var(--mut)}.tag{display:inline-block;padding:4px 12px;border-radius:99px;background:rgba(108,140,255,.15);color:var(--pri);font-size:12px;margin-bottom:18px}
a.btn{display:block;width:100%;padding:10px 16px;border-radius:10px;background:linear-gradient(135deg,var(--pri),var(--pri2));color:#fff;font-weight:600;text-decoration:none}</style></head>
<body><div class="card"><div class="ic"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg></div>
<h2>授权成功</h2><div class="tag">${email.replace(/[<>&]/g, '')}</div><p>已完成 ${p.displayName} 账号授权，您可以直接关闭此标签页并返回客户端。</p>
<a class="btn" href="/">进入网页管理后台</a></div></body></html>`
          return new Response(html, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } })
        }
        const h = new Headers({ Location: '/' })
        h.append('Set-Cookie', this.cookie(s.value, this.cfg.sessionHours * 3600, url))
        h.append('Set-Cookie', `dsh_oauth=; Path=/api/v1/auth/oauth; Max-Age=0${secure}`)
        return new Response(null, { status: 302, headers: h })
      } catch (e) { return fail(e instanceof ApiError ? e.code : 'OAUTH_FAILED') }
    }
    if (method === 'POST' && path === '/api/v1/auth/logout') {
      await this.store.deleteSession(this.bearer(req))
      return json(200, { status: 'ok' }, { 'Set-Cookie': this.cookie('', 0, url) })
    }
    if (method === 'GET' && path === '/api/v1/account/devices') {
      const account = await this.store.session(this.bearer(req))
      return json(200, { items: await Promise.all((await this.store.list(account)).map(d => this.describe(d))), serverUrl: url.origin, transport: 'webrtc' })
    }
    if (method === 'POST' && path === '/api/v1/account/password') {
      const account = await this.store.session(this.bearer(req))
      const b = z.object({ oldPassword: z.string().max(1024).optional(), newPassword: z.string().min(12).max(1024) }).parse(await this.body(req))
      const mk = `oauthpw:${normEmail(account)}` // OAuth-created accounts have an unknown random password: no old password needed once
      if (!(await this.ctx.storage.get(mk))) await this.store.verifyLogin(account, b.oldPassword ?? '')
      await this.store.upsertAccount(account, b.newPassword)
      await this.ctx.storage.delete(mk)
      const s = await this.store.createSession(account)
      await this.log('account.password', account, account)
      return json(200, { status: 'ok', expiresAt: s.expiresAt }, { 'Set-Cookie': this.cookie(s.value, this.cfg.sessionHours * 3600, url) })
    }
    const delMyDev = /^\/api\/v1\/account\/devices\/([^/]+)$/.exec(path)
    if (method === 'DELETE' && delMyDev) {
      const account = await this.store.session(this.bearer(req))
      const target = await this.store.get(decodeURIComponent(delMyDev[1]!))
      if (target.account !== account) throw new ApiError('DEVICE_NOT_FOUND', 404)
      await this.store.revoke(target.descriptor.deviceId)
      await this.log('device.revoke', target.descriptor.deviceId, account)
      return json(200, { status: 'revoked' })
    }
    if (method === 'POST' && (path === '/api/v1/devices/register' || path === '/api/v1/devices/register-owned-role')) {
      const owned = path.endsWith('register-owned-role')
      const source = owned ? await this.deviceAuth(req) : undefined
      const account = source ? source.account : await this.store.session(this.bearer(req))
      const { device } = deviceRegistrationRequestSchema.parse(await this.body(req))
      if (source && (source.descriptor.deviceId === device.deviceId || source.descriptor.role === device.role)) throw new ApiError('INVALID_MESSAGE', 409)
      return json(200, await this.store.register(account, device))
    }
    if (method === 'POST' && path === '/api/v1/auth/refresh') {
      const d = deviceRefreshRequestSchema.parse(await this.body(req))
      return json(200, await this.store.refresh(d.deviceId, d.refreshToken))
    }
    if (method === 'DELETE' && path === '/api/v1/devices/self') {
      await this.store.revoke((await this.deviceAuth(req)).descriptor.deviceId)
      return json(200, { status: 'revoked' })
    }
    if (method === 'GET' && path === '/api/v1/me') return json(200, await this.describe(await this.deviceAuth(req)))
    if (method === 'GET' && path === '/api/v1/turn/credentials') {
      const source = await this.deviceAuth(req)
      const cid = url.searchParams.get('connection_id') ?? ''
      if (!cid || cid.length > 128) throw new ApiError('INVALID_MESSAGE')
      if (!this.authorizeIce(source.descriptor.deviceId, cid)) throw new ApiError('CONNECTION_NOT_FOUND', 404)
      const { servers } = await fetchIceServers(this.turnOn ? this.turn : undefined, this.cfg.turnTtlSeconds, resolveStunUrls(this.cfg))
      return json(200, { iceServers: servers })
    }
    if (method === 'GET' && path === '/api/v1/devices') {
      const source = await this.deviceAuth(req)
      if (source.descriptor.role !== 'client') throw new ApiError('MEMBERSHIP_REQUIRED', 403)
      const items = await Promise.all((await this.store.list(source.account)).filter(d => d.descriptor.role === 'host').map(async d => {
        const { identityKey: _k, ...item } = await this.describe(d)
        return item
      }))
      return json(200, { items, nextCursor: null })
    }
    const rename = /^\/api\/v1\/devices\/([^/]+)\/name$/.exec(path)
    if (method === 'POST' && rename) {
      const account = await this.store.session(this.bearer(req))
      const { name } = z.object({ name: z.string().trim().min(1).max(80) }).parse(await this.body(req))
      await this.store.rename(account, rename[1]!, name)
      return json(200, await this.describe(await this.store.get(rename[1]!)))
    }
    const m = /^\/api\/v1\/devices\/([^/]+)(\/presence)?$/.exec(path)
    if (method === 'GET' && m) {
      const source = await this.deviceAuth(req), target = await this.store.get(m[1]!)
      if (source.descriptor.role === target.descriptor.role || source.account !== target.account) throw new ApiError('MEMBERSHIP_REQUIRED', 403)
      const d = await this.describe(target)
      return json(200, m[2] ? { deviceId: d.deviceId, online: d.online, lastSeenAt: d.lastSeenAt } : d)
    }

    // ---- admin API (ADMIN_TOKEN bearer, or session of an account listed in ADMIN_ACCOUNTS) ----
    if (path.startsWith('/api/v1/admin/')) return this.admin(req, url, path, method)
    throw new ApiError('METHOD_NOT_FOUND', 404)
  }

  private oauthOverridesCache?: Record<string, { enabled?: boolean; allowRegister?: boolean }>
  private lastCleanupAt = 0

  private async oauthOverrides(): Promise<Record<string, { enabled?: boolean; allowRegister?: boolean }>> {
    if (!this.oauthOverridesCache) {
      this.oauthOverridesCache = (await this.ctx.storage.get<Record<string, { enabled?: boolean; allowRegister?: boolean }>>('oauth')) ?? {}
    }
    return this.oauthOverridesCache
  }
  private async getWebhooks(account: string): Promise<Array<{ id: string; name: string; url: string; enabled: boolean; events: string[]; deviceIds: string[] }>> {
    const list = await this.ctx.storage.get<Array<{ id: string; name: string; url: string; enabled: boolean; events: string[]; deviceIds: string[] }>>(`webhooks:${account}`)
    if (list) return list
    const legacy = await this.ctx.storage.get<{ url: string; enabled: boolean; events: string[]; deviceIds?: string[] }>(`webhook:${account}`)
    if (legacy?.url) return [{ id: 'default', name: '默认 Webhook', url: legacy.url, enabled: legacy.enabled, events: legacy.events ?? ['host_offline', 'device_registered'], deviceIds: legacy.deviceIds ?? [] }]
    return []
  }
  private async sendOneWebhook(url: string, account: string, event: 'host_offline' | 'device_registered', payload: Record<string, unknown>): Promise<{ ok: boolean; status?: number; error?: string }> {
    const text = `[DSH Remote] ${event === 'host_offline' ? '主机离线告警' : '新设备接入'} (${account}) ${payload.deviceId ? `设备: ${payload.deviceId}` : ''}`.trim()
    const plat = (url.includes('open.feishu.cn') || url.includes('open.larksuite.com')) ? 'feishu'
      : url.includes('oapi.dingtalk.com') ? 'dingtalk'
      : url.includes('qyapi.weixin.qq.com') ? 'wecom'
      : url.includes('discord.com/api/webhooks') ? 'discord'
      : 'custom'
    let bodyObj: unknown = { event, account, timestamp: Date.now(), msg: text, ...payload }
    if (plat === 'feishu') bodyObj = { msg_type: 'text', content: { text } }
    else if (plat === 'dingtalk' || plat === 'wecom') bodyObj = { msgtype: 'text', text: { content: text } }
    else if (plat === 'discord') bodyObj = { content: text }
    try {
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(bodyObj), signal: AbortSignal.timeout(8000) })
      return res.ok ? { ok: true, status: res.status } : { ok: false, status: res.status, error: `HTTP ${res.status}` }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  }
  private async sendWebhook(account: string, event: 'host_offline' | 'device_registered', payload: Record<string, unknown>): Promise<void> {
    const list = await this.getWebhooks(account)
    for (const cfg of list) {
      if (!cfg.enabled || !cfg.url || !cfg.events.includes(event)) continue
      if (cfg.deviceIds?.length && typeof payload.deviceId === 'string' && !cfg.deviceIds.includes(payload.deviceId)) continue
      await this.sendOneWebhook(cfg.url, account, event, payload)
    }
  }
  private async cleanupExpired(): Promise<void> {
    const now = Date.now()
    if (now - this.lastCleanupAt < 300_000) return
    this.lastCleanupAt = now
    for (const prefix of ['qr:', 'ostate:', 'hostcode:']) {
      const entries = await this.ctx.storage.list<{ exp?: number; expiresAt?: number }>({ prefix })
      const del: string[] = []
      for (const [k, v] of entries) {
        const exp = v.exp ?? v.expiresAt ?? 0
        if (exp > 0 && exp <= now) del.push(k)
      }
      if (del.length) await this.ctx.storage.delete(del)
    }
    await this.store.cleanupExpiredSessions()
  }
  private isEnvAdmin(a: string): boolean {
    return String(this.env.ADMIN_ACCOUNTS ?? '').split(',').map(normEmail).filter(Boolean).includes(normEmail(a))
  }
  private isAdminAccount(a: string): boolean {
    const e = normEmail(a)
    return this.isEnvAdmin(e) || this.admins.has(e)
  }
  private async accountAuth(req: Request): Promise<string> {
    return this.store.session(this.bearer(req))
  }
  private async adminAuth(req: Request): Promise<string> {
    const tok = this.bearer(req)
    const t = this.env.ADMIN_TOKEN?.trim()
    if (t && t.length >= 16 && tok && await equal(tok, t)) return 'admin-token'
    try { const a = await this.store.session(tok); if (this.isAdminAccount(a)) return a } catch { /* fall through */ }
    throw new ApiError('AUTH_REQUIRED', 401)
  }
  private async log(type: string, detail = '', actor = ''): Promise<void> {
    this.events.unshift({ t: Date.now(), type, detail: detail.slice(0, 200), actor })
    this.events.length = Math.min(this.events.length, 200)
    await this.ctx.storage.put('events', this.events)
  }
  private async applySettings(next: Settings): Promise<void> {
    this.cfg = next
    this.store.sessionHours = next.sessionHours
    this.store.maxDevices = next.maxDevicesPerAccount
    await this.ctx.storage.put('settings', next)
  }

  private async admin(req: Request, url: URL, path: string, method: string): Promise<Response> {
    const actor = await this.adminAuth(req)
    const p = path.slice('/api/v1/admin'.length)
    if (method === 'GET' && p === '/overview') {
      const devices = await this.store.listAll()
      const live = devices.filter(d => !d.revoked)
      const socks = this.sockets().filter(s => s.att.id)
      return json(200, {
        siteName: this.cfg.siteName, uptimeMs: Date.now() - this.startedAt, accounts: (await this.store.listAccounts()).length,
        devices: { total: live.length, hosts: live.filter(d => d.descriptor.role === 'host').length, clients: live.filter(d => d.descriptor.role === 'client').length, online: socks.length },
        sockets: this.ctx.getWebSockets().length, links: Object.keys(this.links).length,
        turn: { configured: this.turn !== undefined, enabled: this.turnOn, keyId: this.turn?.keyId ?? null },
        config: { heartbeatMs: this.cfg.heartbeatMs, maxConnections: this.cfg.maxConnections, turnTtlSeconds: this.cfg.turnTtlSeconds, p2pEnabled: this.cfg.p2pEnabled, stunEnabled: this.cfg.stunEnabled },
        origin: url.origin, you: actor,
      })
    }
    if (p === '/settings') {
      if (method === 'GET') return json(200, { settings: this.cfg, defaults: defaultSettings(this.env), defaultStun: defaultStunServers(), effectiveStun: resolveStunUrls(this.cfg) })
      if (method === 'PUT') {
        await this.applySettings(sanitize(await this.body(req) as Record<string, unknown>, this.cfg))
        await this.log('settings.update', '', actor)
        return json(200, { settings: this.cfg, effectiveStun: resolveStunUrls(this.cfg) })
      }
    }
    if (p === '/accounts') {
      if (method === 'GET') {
        const devices = await this.store.listAll()
        const items = await Promise.all((await this.store.listAccounts()).map(async email => {
          const mine = devices.filter(d => d.account === email && !d.revoked)
          return { email, devices: mine.length, online: mine.filter(d => this.peer(d.descriptor.deviceId)).length, admin: this.isAdminAccount(email), rootAdmin: this.isEnvAdmin(email) }
        }))
        return json(200, { items })
      }
      if (method === 'POST') {
        const { email, password } = loginSchema.parse(await this.body(req))
        const e = normEmail(email)
        await this.store.upsertAccount(e, password)
        await this.ctx.storage.delete(`oauthpw:${e}`)
        await this.log('account.upsert', e, actor)
        if (e === normEmail(actor)) {
          const s = await this.store.createSession(e)
          return json(200, { status: 'ok', account: e }, { 'Set-Cookie': this.cookie(s.value, this.cfg.sessionHours * 3600, url) })
        }
        return json(200, { status: 'ok', account: e })
      }
    }
    const admRole = /^\/accounts\/([^/]+)\/admin$/.exec(p)
    if (method === 'POST' && admRole) {
      const e = normEmail(decodeURIComponent(admRole[1]!))
      const { admin } = z.object({ admin: z.boolean() }).parse(await this.body(req))
      if (this.isEnvAdmin(e) && !admin) throw new ApiError('INVALID_MESSAGE', 400)
      if (admin) this.admins.add(e)
      else this.admins.delete(e)
      await this.ctx.storage.put('admins', [...this.admins])
      await this.log('account.admin', `${e} -> ${admin}`, actor)
      return json(200, { status: 'ok', admin: this.isAdminAccount(e) })
    }
    const acctMeta = /^\/accounts\/([^/]+)\/meta$/.exec(p)
    if (method === 'POST' && acctMeta) {
      const e = normEmail(decodeURIComponent(acctMeta[1]!))
      const b = z.object({ disabled: z.boolean().optional(), maxDevices: z.number().int().min(0).max(4096).nullable().optional() }).parse(await this.body(req))
      await this.store.setAccountMeta(e, b)
      if (b.disabled) for (const d of await this.store.list(e, true)) await this.disconnect(d.descriptor.deviceId, 'AUTH_INVALID')
      await this.log('account.meta', `${e} ${JSON.stringify(b)}`, actor)
      return json(200, { status: 'ok' })
    }
    if (p === '/invites') {
      if (method === 'GET') {
        const all = await this.ctx.storage.list<{ code: string; maxUses: number; uses: number; expiresAt: number; note?: string; createdAt: number }>({ prefix: 'invite:' })
        return json(200, { items: [...all.values()].sort((a, b) => b.createdAt - a.createdAt) })
      }
      if (method === 'POST') {
        const b = z.object({
          code: z.string().trim().min(4).max(32).optional(),
          count: z.number().int().min(1).max(100).optional(),
          maxUses: z.number().int().min(1).max(1000).optional(),
          expiresHours: z.number().int().min(1).max(8760).optional(),
          note: z.string().trim().max(120).optional(),
        }).parse(await this.body(req))
        const count = b.code ? 1 : (b.count ?? 1)
        const created: Array<{ code: string; maxUses: number; uses: number; expiresAt: number; note: string; createdAt: number }> = []
        for (let i = 0; i < count; i++) {
          const code = (b.code || secret().slice(0, 10)).toUpperCase().replace(/[^A-Z0-9_-]/g, '')
          if (code.length < 4) throw new ApiError('INVALID_MESSAGE')
          const rec = { code, maxUses: b.maxUses ?? 1, uses: 0, expiresAt: b.expiresHours ? Date.now() + b.expiresHours * 3600_000 : 0, note: b.note ?? '', createdAt: Date.now() }
          await this.ctx.storage.put(`invite:${code}`, rec)
          created.push(rec)
        }
        await this.log('invite.create', count > 1 ? `batch:${count}` : created[0]!.code, actor)
        return json(200, { ...created[0], items: created, count: created.length })
      }
    }
    if (method === 'POST' && p === '/invites/batch-delete') {
      const b = z.object({ codes: z.array(z.string()).max(200).optional(), expired: z.boolean().optional() }).parse(await this.body(req))
      let removed = 0
      if (b.expired) {
        const now = Date.now()
        const all = await this.ctx.storage.list<{ code: string; maxUses: number; uses: number; expiresAt: number }>({ prefix: 'invite:' })
        const keys = [...all].filter(([, v]) => (v.expiresAt > 0 && v.expiresAt <= now) || v.uses >= v.maxUses).map(([k]) => k)
        if (keys.length) { await this.ctx.storage.delete(keys); removed += keys.length }
      }
      if (b.codes?.length) {
        const keys = b.codes.map(c => `invite:${c.toUpperCase()}`)
        await this.ctx.storage.delete(keys)
        removed += keys.length
      }
      await this.log('invite.batch_delete', `${removed}`, actor)
      return json(200, { status: 'deleted', removed })
    }
    const invDel = /^\/invites\/([A-Za-z0-9_-]{4,32})$/.exec(p)
    if (method === 'DELETE' && invDel) {
      const code = invDel[1]!.toUpperCase()
      await this.ctx.storage.delete(`invite:${code}`)
      await this.log('invite.delete', code, actor)
      return json(200, { status: 'deleted' })
    }
    const del = /^\/accounts\/([^/]+)$/.exec(p)
    if (method === 'DELETE' && del) {
      const e = normEmail(decodeURIComponent(del[1]!))
      for (const d of await this.store.list(e, true)) await this.disconnect(d.descriptor.deviceId, 'AUTH_INVALID')
      await this.store.deleteAccount(e)
      await this.log('account.delete', e, actor)
      return json(200, { status: 'deleted' })
    }
    if (method === 'GET' && p === '/devices') {
      const items = await Promise.all((await this.store.listAll()).filter(d => !d.revoked).map(async d => {
        const { identityKey: _k, ...rest } = await this.describe(d)
        return { ...rest, account: d.account }
      }))
      return json(200, { items })
    }
    const dev = /^\/devices\/([^/]+)\/(disconnect|revoke)$/.exec(p)
    if (method === 'POST' && dev) {
      const id = decodeURIComponent(dev[1]!)
      if (dev[2] === 'revoke') await this.store.revoke(id)
      else await this.disconnect(id, 'CONNECTION_FAILED')
      await this.log(`device.${dev[2]}`, id, actor)
      return json(200, { status: 'ok' })
    }
    if (p === '/oauth') {
      if (method === 'GET') {
        const ov = await this.oauthOverrides()
        return json(200, { items: loadProviders(this.env.OAUTH_PROVIDERS, this.oauthCustom).map(x => ({ id: x.id, displayName: x.displayName, enabled: ov[x.id]?.enabled ?? x.enabled, allowRegister: ov[x.id]?.allowRegister ?? x.allowRegister, requireInviteCode: (ov[x.id] as { requireInviteCode?: boolean } | undefined)?.requireInviteCode ?? true, callbackUrl: `${url.origin}/api/v1/auth/oauth/${x.id}/callback`, clientId: x.clientId, source: this.oauthCustom[x.id] ? 'dashboard' : 'env' })) })
      }
      if (method === 'POST') {
        const b = z.object({
          id: z.string().trim().regex(/^[a-z0-9_-]{1,32}$/),
          displayName: z.string().trim().min(1).max(32).optional(),
          clientId: z.string().trim().min(4).max(256),
          clientSecret: z.string().trim().max(512).optional(),
          scopes: z.string().trim().max(256).optional(),
          authUrl: z.string().url().optional(),
          tokenUrl: z.string().url().optional(),
          userInfoUrl: z.string().url().optional(),
          enabled: z.boolean().optional(),
          allowRegister: z.boolean().optional(),
        }).parse(await this.body(req))
        const prev = loadProviders(this.env.OAUTH_PROVIDERS, this.oauthCustom).find(x => x.id === b.id)
        const sec = b.clientSecret || this.oauthCustom[b.id]?.clientSecret || prev?.clientSecret
        if (!sec || sec.length < 4) throw new ApiError('INVALID_MESSAGE')
        this.oauthCustom[b.id] = {
          enabled: b.enabled ?? prev?.enabled ?? true, allowRegister: b.allowRegister ?? prev?.allowRegister ?? true,
          ...(b.displayName ? { displayName: b.displayName } : {}),
          clientId: b.clientId, clientSecret: sec,
          ...(b.scopes ? { scopes: b.scopes } : {}),
          ...(b.authUrl ? { authUrl: b.authUrl } : {}),
          ...(b.tokenUrl ? { tokenUrl: b.tokenUrl } : {}),
          ...(b.userInfoUrl ? { userInfoUrl: b.userInfoUrl } : {}),
        }
        await this.ctx.storage.put('oauth_custom', this.oauthCustom)
        await this.log('oauth.upsert', b.id, actor)
        return json(200, { status: 'ok', id: b.id })
      }
    }
    const oaAdm = /^\/oauth\/([a-z0-9_-]+)$/.exec(p)
    if (oaAdm) {
      if (method === 'DELETE') {
        delete this.oauthCustom[oaAdm[1]!]
        await this.ctx.storage.put('oauth_custom', this.oauthCustom)
        await this.log('oauth.delete', oaAdm[1]!, actor)
        return json(200, { status: 'deleted' })
      }
      if (method === 'POST') {
        const b = z.object({ enabled: z.boolean().optional(), allowRegister: z.boolean().optional(), requireInviteCode: z.boolean().optional() }).parse(await this.body(req))
        const ov = await this.oauthOverrides()
        ov[oaAdm[1]!] = { ...ov[oaAdm[1]!], ...b }
        this.oauthOverridesCache = ov
        await this.ctx.storage.put('oauth', ov)
        await this.log('oauth.update', `${oaAdm[1]} ${JSON.stringify(b)}`, actor)
        return json(200, { status: 'ok' })
      }
    }
    if (method === 'GET' && p === '/links') {
      const now = Date.now()
      return json(200, { items: Object.values(this.links).map(l => ({ ...l, ageMs: now - l.created })) })
    }
    const lk = /^\/links\/([^/]+)$/.exec(p)
    if (method === 'DELETE' && lk) {
      const l = this.links[lk[1]!]
      if (l) { this.drop(l, 'CONNECTION_FAILED'); await this.log('link.drop', l.id, actor) }
      return json(200, { status: 'ok' })
    }
    if (p === '/events') {
      if (method === 'GET') return json(200, { items: this.events })
      if (method === 'DELETE') { this.events = []; await this.ctx.storage.delete('events'); return json(200, { status: 'ok' }) }
    }

    // ---- TURN management (Cloudflare Realtime TURN API) ----
    if (p === '/turn') {
      if (method === 'GET') return json(200, { configured: this.turn !== undefined, keyId: this.turn?.keyId ?? null, source: (await this.ctx.storage.get('turn')) ? 'dashboard' : this.turn ? 'env' : null, enabled: this.cfg.turnEnabled })
      if (method === 'DELETE') { await this.ctx.storage.delete('turn'); this.turn = this.env.TURN_KEY_ID && this.env.TURN_KEY_API_TOKEN ? { keyId: String(this.env.TURN_KEY_ID).trim(), apiToken: String(this.env.TURN_KEY_API_TOKEN).trim() } : undefined; clearIceCache(); await this.log('turn.clear', '', actor); return json(200, { status: 'ok' }) }
    }
    if (method === 'POST' && p === '/turn/manual') {
      const b = z.object({ keyId: z.string().trim().min(8).max(64), apiToken: z.string().trim().min(8).max(256) }).parse(await this.body(req))
      this.turn = { keyId: b.keyId, apiToken: b.apiToken }
      await this.ctx.storage.put('turn', this.turn)
      clearIceCache()
      await this.log('turn.manual', b.keyId, actor)
      return json(200, { status: 'ok', keyId: b.keyId })
    }
    if (method === 'POST' && p === '/turn/provision') {
      const b = z.object({ accountId: z.string().trim().regex(/^[a-f0-9]{32}$/), apiToken: z.string().trim().max(256).optional(), email: z.string().max(254).optional(), apiKey: z.string().max(256).optional(), name: z.string().trim().max(64).optional() }).parse(await this.body(req))
      const auth: CfAuth = { apiToken: b.apiToken, email: b.email, apiKey: b.apiKey }
      if (!auth.apiToken && !(auth.email && auth.apiKey)) throw new ApiError('INVALID_MESSAGE')
      try {
        const key = await createTurnKey(auth, b.accountId, b.name || 'dsh-remote-turn')
        this.turn = key
        await this.ctx.storage.put('turn', key)
        clearIceCache()
        await this.log('turn.provision', key.keyId, actor)
        return json(200, { status: 'ok', keyId: key.keyId })
      } catch (e) { return json(502, { error: { code: 'CLOUDFLARE_API_ERROR', message: String(e instanceof Error ? e.message : e).slice(0, 300), retryable: false } }) }
    }
    if (method === 'POST' && p === '/turn/list') {
      const b = z.object({ accountId: z.string().trim().regex(/^[a-f0-9]{32}$/), apiToken: z.string().trim().max(256).optional(), email: z.string().max(254).optional(), apiKey: z.string().max(256).optional() }).parse(await this.body(req))
      try { return json(200, { items: await listTurnKeys({ apiToken: b.apiToken, email: b.email, apiKey: b.apiKey }, b.accountId) }) }
      catch (e) { return json(502, { error: { code: 'CLOUDFLARE_API_ERROR', message: String(e instanceof Error ? e.message : e).slice(0, 300), retryable: false } }) }
    }
    if (method === 'POST' && p === '/turn/test') {
      const r = await fetchIceServers(this.turnOn ? this.turn : undefined, this.cfg.turnTtlSeconds, resolveStunUrls(this.cfg), true)
      return json(200, { turn: r.turn, error: r.error ?? null, servers: r.servers.map(s => ({ urls: s.urls, hasCredential: Boolean(s.credential) })) })
    }
    throw new ApiError('METHOD_NOT_FOUND', 404)
  }


  authorizeIce(deviceId: string, connectionId: string): boolean {
    const link = this.links[connectionId]
    if (!link || (link.host !== deviceId && link.client !== deviceId) || link.stage === 'pending') return false
    if (link.stage === 'ready' && !link.preferredTransports.some(t => t !== 'relay')) return false
    return this.peer(link.host) !== undefined && this.peer(link.client) !== undefined
  }

  // ---------------- WebSocket (hibernation handlers) ----------------
  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    const att = ws.deserializeAttachment() as Att | null
    if (!att) return
    let frame: ControlFrame | undefined
    try {
      if (typeof raw !== 'string') throw new ApiError('INVALID_MESSAGE')
      const now = Date.now()
      let w = this.windows.get(ws)
      if (!w || now - w.start >= 1000) { w = { start: now, frames: 0 }; this.windows.set(ws, w) }
      if (++w.frames > this.cfg.maxFramesPerSec) throw new ApiError('RATE_LIMITED')
      let isRelayFast = false
      if (att.id && raw.length <= MAX_RELAY_FRAME_BYTES && raw.includes('"relay"')) {
        const parsed = JSON.parse(raw) as Record<string, unknown>
        if (parsed && parsed.v === 1 && parsed.type === 'relay' && typeof parsed.id === 'string' && typeof parsed.timestamp === 'number' && Number.isFinite(parsed.timestamp)) {
          if (raw.length * 3 > MAX_RELAY_FRAME_BYTES && new TextEncoder().encode(raw).byteLength > MAX_RELAY_FRAME_BYTES) throw new ApiError('FRAME_TOO_LARGE')
          frame = { v: 1, type: 'relay', id: parsed.id, timestamp: parsed.timestamp, payload: relayPayloadSchema.parse(parsed.payload) }
          isRelayFast = true
        }
      }
      if (!frame) {
        try {
          frame = decodeControlFrame(raw, { maxControlFrameBytes: MAX_CONTROL_FRAME_BYTES, maxRelayFrameBytes: MAX_RELAY_FRAME_BYTES })
        } catch (e) {
          try {
            const env = JSON.parse(raw) as { v?: unknown }
            if (env && env.v !== 1) throw new ApiError('UNSUPPORTED_VERSION')
          } catch (err) { if (err instanceof ApiError) throw err }
          throw e
        }
      }

      if (!att.id) { // awaiting hello
        if (frame.type !== 'hello') throw new ApiError('AUTH_REQUIRED')
        const p = frame.payload as HelloPayload
        const device = (await this.store.authenticate(p.accessToken))
        const d = device.descriptor
        if (d.deviceId !== p.deviceId || d.role !== p.role) throw new ApiError('AUTH_INVALID')
        if (!p.protocols.includes(1)) throw new ApiError('UNSUPPORTED_VERSION')
        if (ws.deserializeAttachment() === null || (ws.deserializeAttachment() as Att).id) return
        await this.disconnect(d.deviceId, 'CONNECTION_REPLACED')
        const caps = this.negotiated(p.capabilities)
        this.setAtt(ws, { id: d.deviceId, account: device.account, role: d.role, caps, version: p.clientVersion ?? d.clientVersion ?? '', lastPong: Date.now(), created: att.created })
        await this.store.touch(d.deviceId, p.clientVersion, p.harnessVersion)
        this.send(ws, createControlFrame('hello.ack', {
          protocol: 1, serverVersion: 'worker/0.1.0', connectionSessionId: crypto.randomUUID(),
          heartbeatIntervalMs: this.cfg.heartbeatMs, maxControlFrameBytes: MAX_CONTROL_FRAME_BYTES, maxRelayFrameBytes: MAX_RELAY_FRAME_BYTES,
          capabilities: caps, webrtcEnabled: true, webrtcFallbackTimeoutMs: WEBRTC_FALLBACK_TIMEOUT_MS,
        }))
        await this.ensureAlarm(this.cfg.heartbeatMs)
        return
      }
      if (frame.type === 'hello') throw new ApiError('INVALID_MESSAGE')
      if (this.peer(att.id)?.ws !== ws) throw new ApiError('AUTH_INVALID')
      await this.store.get(att.id)
      if (this.isDroppedFrame(att, frame)) return
      await this.handle(ws, att, frame, isRelayFast ? raw : undefined)
    } catch (error) {
      const code = error instanceof ApiError ? error.code : 'INVALID_MESSAGE'
      const connectionId = (frame?.payload as { connectionId?: unknown } | undefined)?.connectionId
      if (att.id && typeof connectionId === 'string' && code !== 'RATE_LIMITED') {
        const link = this.links[connectionId]
        if (link && (link.host === att.id || link.client === att.id)) { this.drop(link, code); return }
        this.send(ws, createControlFrame('error', { code, message: code, connectionId, retryable: false }))
        return
      }
      this.send(ws, createControlFrame('error', { code, message: code, retryable: false }))
      if (att.id) await this.disconnect(att.id, code)
      else try { ws.close(4001, code) } catch { /* closed */ }
    }
  }

  async webSocketClose(ws: WebSocket, code: number): Promise<void> {
    const att = ws.deserializeAttachment() as Att | null
    try { ws.close(code === 1005 || code === 1006 ? 1000 : code) } catch { /* already closed */ }
    if (!att?.id) return
    if (this.sockets().some(s => s.ws !== ws && s.att.id === att.id)) return // replaced
    this.peerCache?.delete(att.id)
    for (const link of Object.values(this.links)) if (link.host === att.id || link.client === att.id) this.drop(link, 'CONNECTION_FAILED')
    if (att.role === 'host' && att.account) this.ctx.waitUntil(this.sendWebhook(att.account, 'host_offline', { deviceId: att.id }))
  }
  async webSocketError(ws: WebSocket): Promise<void> { await this.webSocketClose(ws, 1011) }

  async alarm(): Promise<void> {
    const now = Date.now()
    let waitingHello = false
    for (const { ws, att } of this.sockets()) {
      if (!att.id) {
        if (now - att.created >= this.cfg.helloTimeoutMs) {
          this.send(ws, createControlFrame('error', { code: 'HELLO_TIMEOUT', message: `Hello handshake timed out after ${this.cfg.helloTimeoutMs}ms`, retryable: true }))
          try { ws.close(4001, 'CONNECTION_FAILED') } catch { /* closed */ }
        } else waitingHello = true
        continue
      }
      if (now - att.lastPong > this.cfg.heartbeatDisconnectMs) { await this.disconnect(att.id, 'CONNECTION_FAILED'); continue }
      const nonce = crypto.randomUUID()
      this.setAtt(ws, { ...att, nonce })
      this.send(ws, createControlFrame('ping', { nonce }))
    }
    for (const link of Object.values(this.links)) if (link.stage !== 'ready' && now - link.created > 30_000) this.drop(link, 'CONNECTION_FAILED')
    for (const [k, v] of this.dropped) if (v.expiresAt <= now) this.dropped.delete(k)
    await this.cleanupExpired()
    if (this.ctx.getWebSockets().length > 0) await this.ctx.storage.setAlarm(now + (waitingHello ? this.cfg.helloTimeoutMs : this.cfg.heartbeatMs))
  }

  // ---------------- frame handling (port of gateway.ts) ----------------
  private async handle(ws: WebSocket, att: Att, frame: ControlFrame, rawRelay?: string): Promise<void> {
    const p = frame.payload as Record<string, unknown>
    const self = att.id!
    if (frame.type === 'ping') { this.send(ws, createControlFrame('pong', { nonce: p.nonce })); return }
    if (frame.type === 'pong') {
      if (att.nonce && p.nonce === att.nonce) this.setAtt(ws, { ...att, lastPong: Date.now(), nonce: undefined })
      return
    }
    if (frame.type === 'connect.request') {
      const req = frame.payload as ConnectRequestPayload
      if (att.role !== 'client') throw new ApiError('MEMBERSHIP_REQUIRED')
      const host = this.peer(req.hostDeviceId)
      if (host && Date.now() - host.att.lastPong > this.cfg.heartbeatDisconnectMs) { await this.disconnect(host.att.id!, 'CONNECTION_FAILED') }
      const h = this.peer(req.hostDeviceId)
      if (!h || h.att.role !== 'host' || h.att.account !== att.account) { this.send(ws, createControlFrame('error', { code: 'HOST_OFFLINE', message: 'Host is offline.', retryable: true })); return }
      await this.store.get(req.hostDeviceId)
      if (!req.preferredTransports.includes('relay') || !att.caps.includes('transport.relay') || !h.att.caps.includes('transport.relay')) throw new ApiError('CAPABILITY_NOT_SUPPORTED')
      const preferred = [...new Set(req.preferredTransports)].filter(t => att.caps.includes(`transport.${t}`) && h.att.caps.includes(`transport.${t}`)) as TransportName[]
      if (preferred.length === 0) throw new ApiError('CAPABILITY_NOT_SUPPORTED')
      for (const old of Object.values(this.links)) if (old.client === self || (old.host === req.hostDeviceId && !modernHost(h.att.version))) this.drop(old, 'CONNECTION_REPLACED')
      if (Object.keys(this.links).length >= 256) throw new ApiError('RATE_LIMITED')
      const link: Link = { id: crypto.randomUUID(), host: req.hostDeviceId, client: self, stage: 'pending', created: Date.now(), preferredTransports: preferred }
      this.links[link.id] = link
      this.saveLink(link)
      this.send(h.ws, createControlFrame('connect.incoming', {
        connectionId: link.id, clientDeviceId: self,
        clientIdentityKey: (await this.store.get(self)).descriptor.identityKey,
        authorization: 'account', preferredTransports: preferred,
      }))
      return
    }
    const id = p.connectionId
    const link = typeof id === 'string' ? this.links[id] : undefined
    if (!link || (self !== link.host && self !== link.client)) throw new ApiError('CONNECTION_NOT_FOUND')
    const otherId = self === link.host ? link.client : link.host
    const other = this.peer(otherId)
    await this.store.get(otherId)
    if (!other) throw new ApiError('CONNECTION_FAILED')
    if (frame.type === 'connect.accepted' || frame.type === 'connect.rejected') {
      if (self !== link.host || link.stage !== 'pending') throw new ApiError('INVALID_MESSAGE')
      if (frame.type === 'connect.rejected') this.removeLink(link)
      else { link.stage = 'accepted'; this.saveLink(link) }
      this.send(other.ws, frame)
      return
    }
    if (p.targetDeviceId !== otherId || link.stage === 'pending') throw new ApiError('CONNECTION_NOT_FOUND')
    if (frame.type.startsWith('signal.')) { this.forwardSignal(link, self, other.ws, frame); return }
    if (frame.type === 'transport.selected') { this.forwardTransport(link, self, other, frame.payload as TransportSelectedPayload); return }
    if (frame.type === 'secure.handshake') {
      const step = (frame.payload as SecureHandshakePayload).step
      if (step === 1 && self === link.client && link.stage === 'accepted') link.stage = 'handshake'
      else if (step === 2 && self === link.host && link.stage === 'handshake') link.stage = 'ready'
      else throw new ApiError('INVALID_MESSAGE')
      this.saveLink(link)
    } else if (frame.type === 'relay') {
      const counter = (frame.payload as RelayPayload).counter
      let c = this.counters.get(link.id)
      if (!c) { c = new Map(); this.counters.set(link.id, c) }
      if (link.stage !== 'ready' || counter <= (c.get(self) ?? -1)) throw new ApiError('INVALID_MESSAGE')
      c.set(self, counter)
      if (rawRelay !== undefined) { this.sendRaw(other.ws, rawRelay); return }
    } else throw new ApiError('INVALID_MESSAGE')
    this.send(other.ws, frame)
  }

  private forwardSignal(link: Link, self: string, other: WebSocket, frame: ControlFrame): void {
    if (link.stage === 'ready') return
    if (!link.preferredTransports.some(t => t !== 'relay')) return
    if (frame.type === 'signal.offer') { if (self !== link.client) throw new ApiError('INVALID_MESSAGE') }
    else if (frame.type === 'signal.answer') { if (self !== link.host) throw new ApiError('INVALID_MESSAGE') }
    else if (frame.type === 'signal.ice') {
      const n = (this.ice.get(link.id) ?? 0) + 1
      this.ice.set(link.id, n)
      if (n > MAX_ICE_CANDIDATES_PER_CONNECTION) throw new ApiError('INVALID_MESSAGE')
    } else throw new ApiError('INVALID_MESSAGE')
    this.send(other, frame)
  }

  private forwardTransport(link: Link, self: string, other: { ws: WebSocket; att: Att }, payload: TransportSelectedPayload): void {
    if (self !== link.client) return
    if (link.stage !== 'accepted' && link.stage !== 'handshake') throw new ApiError('INVALID_MESSAGE')
    const transport = payload.transport as TransportName
    if (!TRANSPORTS.includes(transport)) throw new ApiError('INVALID_MESSAGE')
    const selected: TransportName = transport === 'lan' && !link.preferredTransports.includes('lan') && link.preferredTransports.includes('p2p') ? 'p2p' : transport
    if (!link.preferredTransports.includes(selected)) throw new ApiError('CAPABILITY_NOT_SUPPORTED')
    if (selected === 'relay' && !modernHost(other.att.version)) return
    this.send(other.ws, createControlFrame('transport.selected', selected === transport ? { ...payload } : { ...payload, transport: selected }))
  }
}