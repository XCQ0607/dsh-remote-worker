import { accountDeviceDescriptorSchema, type AccountDeviceDescriptor } from './protocol/index.js'
import { z } from 'zod'
import { equal, hash, hmacB64url, pbkdf2, secret } from './crypto.js'

export class ApiError extends Error {
  constructor(readonly code: string, readonly status = 400, readonly detail?: string) { super(detail || code) }
}

export interface AccountRecord { email: string; salt: string; verifier: string; disabled?: boolean; maxDevices?: number; deviceOnly?: boolean }
export interface SavedDevice { account: string; descriptor: AccountDeviceDescriptor; revoked: boolean; lastSeenAt: number; pairingRestricted?: boolean }
interface SavedToken {
  kind: 'access' | 'refresh'; deviceId: string; expires: number; used: boolean
  recovery?: { nonce: string; accessExpires: number }
}
export interface SavedSession { account: string; expires: number; id?: string; ua?: string; created?: number }
export const normEmail = (e: string): string => e.trim().toLowerCase()

async function successor(token: string, nonce: string, deviceId: string) {
  const derive = (kind: string) => hmacB64url(token, JSON.stringify(['ds-harness-remote/refresh/v1', deviceId, nonce, kind]))
  const [accessToken, refreshToken] = await Promise.all([derive('access'), derive('refresh')])
  return { accessToken, refreshToken }
}

/** Multi-account store on Durable Object storage. Only token digests reach disk. */
export class Store {
  onInvalidate: (deviceId: string) => void = () => {}
  sessionHours = 8
  maxDevices = 256
  private devCache = new Map<string, SavedDevice>()
  private allDevsLoaded = false
  private acctCache = new Map<string, AccountRecord>()
  private allAcctsLoaded = false
  private sesCache = new Map<string, SavedSession>()
  private regLocks = new Map<string, Promise<unknown>>()
  constructor(private s: DurableObjectStorage) {}

  // ---- accounts ----
  private async ensureAccounts(): Promise<void> {
    if (this.allAcctsLoaded) return
    for (const a of (await this.s.list<AccountRecord>({ prefix: 'acct:' })).values()) this.acctCache.set(a.email, a)
    this.allAcctsLoaded = true
  }
  async getAccount(email: string): Promise<AccountRecord | undefined> {
    const e = normEmail(email)
    let a = this.acctCache.get(e)
    if (!a && !this.allAcctsLoaded) {
      a = await this.s.get<AccountRecord>(`acct:${e}`)
      if (a) this.acctCache.set(e, a)
    }
    return a
  }
  async listAccounts(): Promise<string[]> {
    await this.ensureAccounts()
    return [...this.acctCache.keys()]
  }
  async listAccountRecords(): Promise<AccountRecord[]> {
    await this.ensureAccounts()
    return [...this.acctCache.values()]
  }
  async upsertAccount(email: string, password: string): Promise<void> {
    const e = normEmail(email)
    if (!e || e.length > 254 || password.length < 12 || password.length > 1024) throw new ApiError('INVALID_MESSAGE')
    const prev = await this.getAccount(e)
    if (prev?.deviceOnly) throw new ApiError('INVALID_MESSAGE', 400, '纯设备配对账号不支持设置登录密码')
    const salt = secret()
    const rec: AccountRecord = { email: e, salt, verifier: await pbkdf2(password, salt), disabled: prev?.disabled, maxDevices: prev?.maxDevices }
    await this.s.put(`acct:${e}`, rec)
    this.acctCache.set(e, rec)
    await this.deleteSessions(e)
  }
  async setAccountMeta(email: string, meta: { disabled?: boolean; maxDevices?: number | null }): Promise<void> {
    const e = normEmail(email)
    const prev = await this.getAccount(e)
    if (!prev) throw new ApiError('NOT_FOUND', 404)
    const rec: AccountRecord = { ...prev }
    if (meta.disabled !== undefined) rec.disabled = meta.disabled
    if (meta.maxDevices !== undefined) {
      if (meta.maxDevices === null || meta.maxDevices <= 0) delete rec.maxDevices
      else rec.maxDevices = meta.maxDevices
    }
    await this.s.put(`acct:${e}`, rec)
    this.acctCache.set(e, rec)
    if (rec.disabled) await this.deleteSessions(e)
  }
  async deleteAccount(email: string): Promise<void> {
    const e = normEmail(email)
    this.acctCache.delete(e)
    await this.s.delete(`acct:${e}`)
    await this.deleteSessions(e)
    const devs = await this.list(e, true)
    if (!devs.length) return
    const ids = devs.map(d => d.descriptor.deviceId)
    const tokKeys: string[] = []
    for (let i = 0; i < ids.length; i += 128) {
      const m = await this.s.get<string[]>(ids.slice(i, i + 128).map(id => `devtok:${id}`))
      for (const v of m.values()) if (v?.length) tokKeys.push(...v)
    }
    const whKeys: string[] = []
    const devWrites: Record<string, SavedDevice> = {}
    for (const d of devs) {
      const id = d.descriptor.deviceId
      const upd: SavedDevice = { ...d, revoked: true }
      this.devCache.set(id, upd)
      devWrites[`dev:${id}`] = upd
      whKeys.push(`whoff:${id}`, `whsent:${id}`, `devtok:${id}`)
      this.onInvalidate(id)
    }
    await this.putEntries(devWrites)
    await this.delKeys([...whKeys, ...tokKeys])
  }
  async upsertDeviceOnlyAccount(account: string): Promise<AccountRecord> {
    const e = normEmail(account)
    const prev = await this.getAccount(e)
    if (prev) return prev
    const rec: AccountRecord = { email: e, salt: '', verifier: '', deviceOnly: true }
    await this.s.put(`acct:${e}`, rec)
    this.acctCache.set(e, rec)
    return rec
  }
  async verifyLogin(email: string, password: string): Promise<string> {
    const acct = await this.getAccount(email)
    const verifier = await pbkdf2(password, acct?.salt || 'x'.repeat(43)) // dummy work when unknown
    if (!acct || acct.deviceOnly || !acct.verifier || !(await equal(verifier, acct.verifier))) throw new ApiError('AUTH_INVALID', 401)
    if (acct.disabled) throw new ApiError('ACCOUNT_DISABLED', 403)
    return acct.email
  }

  // ---- sessions (web login) ----
  async createSession(account: string, ua = ''): Promise<{ value: string; expiresAt: number }> {
    const value = secret(), expiresAt = Date.now() + this.sessionHours * 3600_000
    const ses: SavedSession = { account, expires: expiresAt, id: secret().slice(0, 12), ua: ua.slice(0, 160), created: Date.now() }
    const key = `ses:${await hash(value)}`
    this.sesCache.set(key, ses)
    await this.s.put(key, ses)
    return { value, expiresAt }
  }
  async listSessions(account: string, currentId?: string): Promise<Array<{ id: string; ua: string; created: number; expires: number; current: boolean }>> {
    const now = Date.now()
    const all = await this.s.list<SavedSession>({ prefix: 'ses:' })
    const out: Array<{ id: string; ua: string; created: number; expires: number; current: boolean }> = []
    const expired: string[] = []
    for (const [k, v] of all) {
      if (v.expires <= now) { this.sesCache.delete(k); expired.push(k); continue }
      const id = v.id ?? k.slice(4, 16)
      if (v.account === account) out.push({ id, ua: v.ua ?? '', created: v.created ?? 0, expires: v.expires, current: !!currentId && id === currentId })
    }
    await this.delKeys(expired)
    return out.sort((a, b) => Number(b.current) - Number(a.current) || b.created - a.created)
  }
  async deleteOtherSessions(account: string, keepId: string): Promise<number> {
    const all = await this.s.list<SavedSession>({ prefix: 'ses:' })
    const del: string[] = []
    for (const [k, v] of all) {
      const id = v.id ?? k.slice(4, 16)
      if (v.account === account && id !== keepId) { this.sesCache.delete(k); del.push(k) }
    }
    for (let i = 0; i < del.length; i += 128) await this.s.delete(del.slice(i, i + 128))
    return del.length
  }
  async deleteSessionById(account: string, id: string): Promise<boolean> {
    const all = await this.s.list<SavedSession>({ prefix: 'ses:' })
    for (const [k, v] of all) {
      if (v.account === account && (v.id === id || k.slice(4, 16) === id)) {
        this.sesCache.delete(k)
        await this.s.delete(k)
        return true
      }
    }
    return false
  }
  private async delKeys(keys: string[]): Promise<void> {
    for (let i = 0; i < keys.length; i += 128) await this.s.delete(keys.slice(i, i + 128))
  }
  private async putEntries(entries: Record<string, unknown>): Promise<void> {
    const kv = Object.entries(entries)
    for (let i = 0; i < kv.length; i += 128) await this.s.put(Object.fromEntries(kv.slice(i, i + 128)))
  }
  async cleanupExpiredSessions(): Promise<number> {
    const now = Date.now()
    const all = await this.s.list<SavedSession>({ prefix: 'ses:' })
    const expired = [...all].filter(([, v]) => v.expires <= now).map(([k]) => k)
    for (const k of expired) this.sesCache.delete(k)
    await this.delKeys(expired)
    return expired.length
  }
  async sessionInfo(token: string): Promise<{ account: string; id: string }> {
    const key = `ses:${await hash(token)}`
    let v = this.sesCache.get(key)
    if (!v) {
      v = await this.s.get<SavedSession>(key)
      if (v) this.sesCache.set(key, v)
    }
    if (!v || v.expires <= Date.now()) { this.sesCache.delete(key); if (v) await this.s.delete(key); throw new ApiError('ACCOUNT_AUTH_REQUIRED', 401) }
    if ((await this.getAccount(v.account))?.disabled) throw new ApiError('ACCOUNT_DISABLED', 403)
    return { account: v.account, id: v.id ?? key.slice(4, 16) }
  }
  async session(token: string): Promise<string> {
    return (await this.sessionInfo(token)).account
  }
  async deleteSession(token: string): Promise<void> {
    const key = `ses:${await hash(token)}`
    this.sesCache.delete(key)
    await this.s.delete(key)
  }
  private async deleteSessions(account: string): Promise<void> {
    const all = await this.s.list<SavedSession>({ prefix: 'ses:' })
    const keys = [...all].filter(([, v]) => v.account === account).map(([k]) => k)
    for (const k of keys) this.sesCache.delete(k)
    await this.delKeys(keys)
  }

  // ---- devices ----
  private async ensureDevices(): Promise<void> {
    if (this.allDevsLoaded) return
    for (const d of (await this.s.list<SavedDevice>({ prefix: 'dev:' })).values()) this.devCache.set(d.descriptor.deviceId, d)
    this.allDevsLoaded = true
  }
  async get(id: string): Promise<SavedDevice> {
    let d = this.devCache.get(id)
    if (!d && !this.allDevsLoaded) {
      d = await this.s.get<SavedDevice>(`dev:${id}`)
      if (d) this.devCache.set(id, d)
    }
    if (!d) throw new ApiError('DEVICE_NOT_FOUND', 404)
    if (d.revoked) throw new ApiError('DEVICE_REVOKED', 403)
    return d
  }
  async listAll(): Promise<SavedDevice[]> {
    await this.ensureDevices()
    return [...this.devCache.values()]
  }
  async list(account: string, includeRevoked = false): Promise<SavedDevice[]> {
    await this.ensureDevices()
    return [...this.devCache.values()].filter(d => d.account === account && (includeRevoked || !d.revoked))
  }
  async register(account: string, raw: AccountDeviceDescriptor, opts?: { pairingRestricted?: boolean }) {
    const prev = this.regLocks.get(account) ?? Promise.resolve()
    const run = prev.catch(() => {}).then(() => this.registerSerial(account, raw, opts))
    this.regLocks.set(account, run)
    try { return await run } finally { if (this.regLocks.get(account) === run) this.regLocks.delete(account) }
  }
  private async registerSerial(account: string, raw: AccountDeviceDescriptor, opts?: { pairingRestricted?: boolean }) {
    const descriptor = accountDeviceDescriptorSchema.parse(raw)
    const old = await this.s.get<SavedDevice>(`dev:${descriptor.deviceId}`)
    if (old?.revoked) throw new ApiError('DEVICE_REVOKED', 403)
    if (old && (old.account !== account || old.descriptor.identityKey !== descriptor.identityKey || old.descriptor.role !== descriptor.role)) throw new ApiError('PEER_IDENTITY_MISMATCH', 409)
    const acct = await this.getAccount(account)
    if (acct?.disabled) throw new ApiError('ACCOUNT_DISABLED', 403)
    const acctMax = acct?.maxDevices ?? this.maxDevices
    if (!old && (await this.list(account)).length >= acctMax) throw new ApiError('RATE_LIMITED', 429, `设备数量已达账号配额上限 (${acctMax} 台)`)
    const rec: SavedDevice = {
      account,
      descriptor,
      revoked: false,
      lastSeenAt: old?.lastSeenAt ?? 0,
      ...(opts?.pairingRestricted !== undefined ? { pairingRestricted: opts.pairingRestricted } : old?.pairingRestricted ? { pairingRestricted: true } : {}),
    }
    await this.s.put(`dev:${descriptor.deviceId}`, rec)
    this.devCache.set(descriptor.deviceId, rec)
    await this.invalidate(descriptor.deviceId)
    return this.issue(descriptor.deviceId)
  }

  // ---- tokens ----
  private async issue(deviceId: string, refreshTokenExpiresAt = Date.now() + 30 * 86400_000, previous?: { token: string; record: SavedToken }) {
    const now = Date.now()
    const accessTokenExpiresAt = now + 60 * 60_000
    const nonce = secret()
    const { accessToken, refreshToken } = previous ? await successor(previous.token, nonce, deviceId) : { accessToken: secret(), refreshToken: secret() }
    const writes: Record<string, SavedToken> = {
      [`tok:${await hash(accessToken)}`]: { kind: 'access', deviceId, expires: accessTokenExpiresAt, used: false },
      [`tok:${await hash(refreshToken)}`]: { kind: 'refresh', deviceId, expires: refreshTokenExpiresAt, used: false },
    }
    const prevIdx = (await this.s.get<string[]>(`devtok:${deviceId}`)) ?? []
    const newKeys = Object.keys(writes)
    writes[`devtok:${deviceId}`] = [...new Set([...prevIdx, ...newKeys])].slice(-16) as unknown as SavedToken
    if (previous) writes[`tok:${await hash(previous.token)}`] = { ...previous.record, used: true, recovery: { nonce, accessExpires: accessTokenExpiresAt } }
    await this.s.put(writes) // one atomic batch: consume + successor + device token index
    return { accessToken, refreshToken, accessTokenExpiresAt, refreshTokenExpiresAt }
  }
  async authenticate(token: string): Promise<SavedDevice> {
    const r = await this.s.get<SavedToken>(`tok:${await hash(token)}`)
    if (!r || r.kind !== 'access') throw new ApiError('AUTH_INVALID', 401)
    if (r.expires <= Date.now()) throw new ApiError('TOKEN_EXPIRED', 401)
    const dev = await this.get(r.deviceId)
    if ((await this.getAccount(dev.account))?.disabled) throw new ApiError('ACCOUNT_DISABLED', 403)
    return dev
  }
  async refresh(deviceId: string, token: string) {
    const dev = await this.get(deviceId)
    if ((await this.getAccount(dev.account))?.disabled) throw new ApiError('ACCOUNT_DISABLED', 403)
    const record = await this.s.get<SavedToken>(`tok:${await hash(token)}`)
    if (!record || record.kind !== 'refresh' || record.deviceId !== deviceId) throw new ApiError('AUTH_INVALID', 401)
    if (record.expires <= Date.now()) throw new ApiError('TOKEN_EXPIRED', 401)
    if (!record.used) return this.issue(deviceId, record.expires, { token, record })
    if (!record.recovery) throw new ApiError('AUTH_INVALID', 401)
    const pair = await successor(token, record.recovery.nonce, deviceId)
    const next = await this.s.get<SavedToken>(`tok:${await hash(pair.refreshToken)}`)
    if (!next || next.kind !== 'refresh' || next.deviceId !== deviceId || next.expires !== record.expires) throw new ApiError('INTERNAL_ERROR', 503)
    if (next.used) throw new ApiError('AUTH_INVALID', 401)
    return { ...pair, accessTokenExpiresAt: record.recovery.accessExpires, refreshTokenExpiresAt: next.expires }
  }
  async cleanupExpiredTokens(): Promise<number> {
    const now = Date.now()
    const all = await this.s.list<SavedToken>({ prefix: 'tok:' })
    const expired = [...all].filter(([, v]) => v.expires <= now).map(([k]) => k)
    await this.delKeys(expired)
    return expired.length
  }
  async invalidate(deviceId: string): Promise<void> {
    const idx = await this.s.get<string[]>(`devtok:${deviceId}`)
    if (idx?.length) await this.delKeys([...idx, `devtok:${deviceId}`])
    else {
      const all = await this.s.list<SavedToken>({ prefix: 'tok:' })
      await this.delKeys([...all].filter(([, v]) => v.deviceId === deviceId).map(([k]) => k))
    }
    this.onInvalidate(deviceId)
  }
  private async revokeRaw(id: string): Promise<void> {
    const d = await this.s.get<SavedDevice>(`dev:${id}`)
    if (d) { d.revoked = true; this.devCache.set(id, d); await this.s.put(`dev:${id}`, d) }
    await this.s.delete([`whoff:${id}`, `whsent:${id}`])
    await this.invalidate(id)
  }
  async revoke(id: string): Promise<void> { await this.get(id); await this.revokeRaw(id) }
  async rename(account: string, id: string, name: string): Promise<void> {
    const d = await this.get(id)
    if (d.account !== account) throw new ApiError('DEVICE_NOT_FOUND', 404)
    d.descriptor.name = name
    this.devCache.set(id, d)
    await this.s.put(`dev:${id}`, d)
  }
  async touch(id: string, clientVersion?: string, harnessVersion?: string): Promise<void> {
    const d = await this.get(id)
    d.lastSeenAt = Date.now()
    if (clientVersion) d.descriptor.clientVersion = clientVersion.slice(0, 64)
    if (d.descriptor.role === 'host' && harnessVersion) d.descriptor.harnessVersion = harnessVersion.slice(0, 64)
    this.devCache.set(id, d)
    await this.s.put(`dev:${id}`, d)
  }
}

