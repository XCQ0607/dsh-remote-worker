import { accountDeviceDescriptorSchema, type AccountDeviceDescriptor } from './protocol/index.js'
import { z } from 'zod'
import { equal, hash, hmacB64url, pbkdf2, secret } from './crypto.js'

export class ApiError extends Error {
  constructor(readonly code: string, readonly status = 400) { super(code) }
}

export interface AccountRecord { email: string; salt: string; verifier: string }
export interface SavedDevice { account: string; descriptor: AccountDeviceDescriptor; revoked: boolean; lastSeenAt: number }
interface SavedToken {
  kind: 'access' | 'refresh'; deviceId: string; expires: number; used: boolean
  recovery?: { nonce: string; accessExpires: number }
}
export interface SavedSession { account: string; expires: number }
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
  async upsertAccount(email: string, password: string): Promise<void> {
    const e = normEmail(email)
    if (!e || e.length > 254 || password.length < 12 || password.length > 1024) throw new ApiError('INVALID_MESSAGE')
    const salt = secret()
    const rec: AccountRecord = { email: e, salt, verifier: await pbkdf2(password, salt) }
    await this.s.put(`acct:${e}`, rec)
    this.acctCache.set(e, rec)
    await this.deleteSessions(e)
  }
  async deleteAccount(email: string): Promise<void> {
    const e = normEmail(email)
    this.acctCache.delete(e)
    await this.s.delete(`acct:${e}`)
    await this.deleteSessions(e)
    for (const d of await this.list(e, true)) await this.revokeRaw(d.descriptor.deviceId)
  }
  async verifyLogin(email: string, password: string): Promise<string> {
    const acct = await this.getAccount(email)
    const verifier = await pbkdf2(password, acct?.salt ?? 'x'.repeat(43)) // dummy work when unknown
    if (!acct || !(await equal(verifier, acct.verifier))) throw new ApiError('AUTH_INVALID', 401)
    return acct.email
  }

  // ---- sessions (web login) ----
  async createSession(account: string): Promise<{ value: string; expiresAt: number }> {
    const value = secret(), expiresAt = Date.now() + this.sessionHours * 3600_000
    const ses: SavedSession = { account, expires: expiresAt }
    const key = `ses:${await hash(value)}`
    this.sesCache.set(key, ses)
    await this.s.put(key, ses)
    return { value, expiresAt }
  }
  async session(token: string): Promise<string> {
    const key = `ses:${await hash(token)}`
    let v = this.sesCache.get(key)
    if (!v) {
      v = await this.s.get<SavedSession>(key)
      if (v) this.sesCache.set(key, v)
    }
    if (!v || v.expires <= Date.now()) { this.sesCache.delete(key); if (v) await this.s.delete(key); throw new ApiError('ACCOUNT_AUTH_REQUIRED', 401) }
    return v.account
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
    if (keys.length) await this.s.delete(keys)
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
  async register(account: string, raw: AccountDeviceDescriptor) {
    const descriptor = accountDeviceDescriptorSchema.parse(raw)
    const old = await this.s.get<SavedDevice>(`dev:${descriptor.deviceId}`)
    if (old?.revoked) throw new ApiError('DEVICE_REVOKED', 403)
    if (old && (old.account !== account || old.descriptor.identityKey !== descriptor.identityKey || old.descriptor.role !== descriptor.role)) throw new ApiError('PEER_IDENTITY_MISMATCH', 409)
    if (!old && (await this.list(account)).length >= this.maxDevices) throw new ApiError('RATE_LIMITED', 429)
    const rec: SavedDevice = { account, descriptor, revoked: false, lastSeenAt: old?.lastSeenAt ?? 0 }
    await this.s.put(`dev:${descriptor.deviceId}`, rec)
    this.devCache.set(descriptor.deviceId, rec)
    await this.invalidate(descriptor.deviceId)
    return this.issue(descriptor.deviceId)
  }

  // ---- tokens ----
  private async issue(deviceId: string, refreshTokenExpiresAt = Date.now() + 30 * 86400_000, previous?: { token: string; record: SavedToken }) {
    const now = Date.now()
    const all = await this.s.list<SavedToken>({ prefix: 'tok:' })
    const expired = [...all].filter(([, v]) => v.expires <= now).map(([k]) => k)
    if (expired.length) await this.s.delete(expired.slice(0, 128))
    if (all.size - expired.length + 2 > 16384) throw new ApiError('RATE_LIMITED', 429)
    const accessTokenExpiresAt = now + 60 * 60_000
    const nonce = secret()
    const { accessToken, refreshToken } = previous ? await successor(previous.token, nonce, deviceId) : { accessToken: secret(), refreshToken: secret() }
    const writes: Record<string, SavedToken> = {
      [`tok:${await hash(accessToken)}`]: { kind: 'access', deviceId, expires: accessTokenExpiresAt, used: false },
      [`tok:${await hash(refreshToken)}`]: { kind: 'refresh', deviceId, expires: refreshTokenExpiresAt, used: false },
    }
    if (previous) writes[`tok:${await hash(previous.token)}`] = { ...previous.record, used: true, recovery: { nonce, accessExpires: accessTokenExpiresAt } }
    await this.s.put(writes) // one atomic batch: consume + successor
    return { accessToken, refreshToken, accessTokenExpiresAt, refreshTokenExpiresAt }
  }
  async authenticate(token: string): Promise<SavedDevice> {
    const r = await this.s.get<SavedToken>(`tok:${await hash(token)}`)
    if (!r || r.kind !== 'access') throw new ApiError('AUTH_INVALID', 401)
    if (r.expires <= Date.now()) throw new ApiError('TOKEN_EXPIRED', 401)
    return this.get(r.deviceId)
  }
  async refresh(deviceId: string, token: string) {
    await this.get(deviceId)
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
  async invalidate(deviceId: string): Promise<void> {
    const all = await this.s.list<SavedToken>({ prefix: 'tok:' })
    const keys = [...all].filter(([, v]) => v.deviceId === deviceId).map(([k]) => k)
    for (let i = 0; i < keys.length; i += 128) await this.s.delete(keys.slice(i, i + 128))
    this.onInvalidate(deviceId)
  }
  private async revokeRaw(id: string): Promise<void> {
    const d = await this.s.get<SavedDevice>(`dev:${id}`)
    if (d) { d.revoked = true; this.devCache.set(id, d); await this.s.put(`dev:${id}`, d) }
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

