import { z } from 'zod'
import { equal, generateX25519KeyPair, hash, pairingProof, secret } from './crypto.js'
import { ApiError, type Store } from './store.js'
import type { AccountDeviceDescriptor } from './protocol/index.js'

export const DEVICE_PAIRING_PROTOCOL = 'dsh-pairing-v1'
export const DEVICE_PAIRING_QR_FORMAT = 'fragment-ticket-v1'
const SESSION_TTL_MS = 180_000
export const PAIRING_RECOVER_TTL_MS = 480_000
const RECOVER_TTL_MS = PAIRING_RECOVER_TTL_MS

const pairingDeviceSchema = z.object({
  deviceId: z.string().min(1).max(128),
  name: z.string().min(1).max(256),
  role: z.enum(['host', 'client']),
  platform: z.string().min(1).max(64),
  identityKey: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  clientVersion: z.string().max(64).nullable().optional(),
  harnessVersion: z.string().max(64).nullable().optional(),
})

export type PairingDevice = z.infer<typeof pairingDeviceSchema>
export type PairingState = 'created' | 'claimed' | 'approved' | 'completed' | 'failed' | 'cancelled' | 'expired'

export interface PairingTokens {
  accessToken: string
  accessTokenExpiresAt: number
  refreshToken: string
  refreshTokenExpiresAt: number
}

export interface PairingSession {
  v: 1
  sessionId: string
  ticketHash: string
  createdAt: number
  expiresAt: number
  recoverUntil: number
  state: PairingState
  host: PairingDevice
  mobile?: PairingDevice
  deepseekUserId?: string
  verificationCode?: string
  attemptConsumed?: boolean
  submissionId?: string | null
  failureReason?: string | null
  account?: string
  accountKind?: 'device_only' | 'standard'
  pairingRestricted?: boolean
  hostTokens?: PairingTokens
  mobileTokens?: PairingTokens
}

function randomDigits8(): string {
  const buf = crypto.getRandomValues(new Uint32Array(1))
  return String(buf[0]! % 100_000_000).padStart(8, '0')
}

function toDescriptor(d: PairingDevice): AccountDeviceDescriptor {
  if (d.role === 'host') {
    return {
      deviceId: d.deviceId,
      name: d.name.slice(0, 128),
      role: 'host',
      platform: d.platform,
      identityKey: d.identityKey,
      clientVersion: d.clientVersion || 'dsh-host-pairing',
      ...(d.harnessVersion ? { harnessVersion: d.harnessVersion } : {}),
    }
  }
  return {
    deviceId: d.deviceId,
    name: d.name.slice(0, 128),
    role: 'client',
    platform: d.platform,
    identityKey: d.identityKey,
    clientVersion: d.clientVersion || 'dsh-go-pairing',
  }
}

function sameIdentity(a: PairingDevice, b: PairingDevice): boolean {
  return a.deviceId === b.deviceId && a.identityKey === b.identityKey && a.role === b.role
}

export class PairingManager {
  private serverKeys?: { publicKey: string; privateKey: string }
  private confirmLocks = new Map<string, Promise<unknown>>()
  constructor(private s: DurableObjectStorage, private store: Store) {}

  async getServerPublicKey(): Promise<string> {
    return (await this.ensureKeys()).publicKey
  }

  private async ensureKeys(): Promise<{ publicKey: string; privateKey: string }> {
    if (this.serverKeys) return this.serverKeys
    const saved = await this.s.get<{ publicKey: string; privateKey: string }>('pairing_server_key')
    if (saved?.publicKey && saved?.privateKey) {
      this.serverKeys = saved
      return saved
    }
    const fresh = await generateX25519KeyPair()
    await this.s.put('pairing_server_key', fresh)
    this.serverKeys = fresh
    return fresh
  }

  async countActive(): Promise<number> {
    const now = Date.now()
    let count = 0
    for (const v of (await this.s.list<PairingSession>({ prefix: 'pair:' })).values()) {
      if (v.recoverUntil > now && (v.state === 'created' || v.state === 'claimed' || v.state === 'approved')) count++
    }
    return count
  }

  async cleanupExpired(): Promise<number> {
    const now = Date.now()
    const del: string[] = []
    for (const [k, v] of await this.s.list<PairingSession>({ prefix: 'pair:' })) {
      if (v.recoverUntil <= now) {
        del.push(k, `pairtick:${v.ticketHash}`)
      }
    }
    for (let i = 0; i < del.length; i += 128) await this.s.delete(del.slice(i, i + 128))
    return Math.floor(del.length / 2)
  }

  private async loadSession(sessionId: string): Promise<PairingSession> {
    const ses = await this.s.get<PairingSession>(`pair:${sessionId}`)
    if (!ses || ses.recoverUntil <= Date.now()) throw new ApiError('PAIRING_NOT_FOUND', 404)
    if ((ses.state === 'created' || ses.state === 'claimed') && ses.expiresAt <= Date.now()) {
      ses.state = 'expired'
      await this.s.put(`pair:${sessionId}`, ses)
    }
    return ses
  }

  private async verifyProof(
    req: Request,
    devicePublicKey: string,
    sessionId: string,
    side: 'host' | 'mobile',
    path: string,
    rawJson: string,
  ): Promise<void> {
    const got = req.headers.get('X-DSH-Pairing-Proof')?.trim()
    if (!got) throw new ApiError('PAIRING_PROOF_INVALID', 401)
    const keys = await this.ensureKeys()
    const expected = await pairingProof({
      serverPrivateKey: keys.privateKey,
      devicePublicKey,
      sessionId,
      side,
      path,
      rawJson,
    })
    if (!(await equal(got, expected))) throw new ApiError('PAIRING_PROOF_INVALID', 401)
  }

  async createSession(origin: string, rawBody: string): Promise<Record<string, unknown>> {
    let parsed: unknown
    try { parsed = JSON.parse(rawBody) } catch { throw new ApiError('INVALID_MESSAGE', 400) }
    const obj = parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : {}
    const host = pairingDeviceSchema.parse(obj.host ?? obj.device ?? obj)
    if (host.role !== 'host') throw new ApiError('INVALID_MESSAGE', 400)
    if ((await this.countActive()) >= 512) throw new ApiError('RATE_LIMITED', 429, '当前配对会话过多，请稍后重试')

    const keys = await this.ensureKeys()
    const now = Date.now()
    const sessionId = crypto.randomUUID()
    const ticket = secret()
    const ticketHash = await hash(ticket)
    const ses: PairingSession = {
      v: 1,
      sessionId,
      ticketHash,
      createdAt: now,
      expiresAt: now + SESSION_TTL_MS,
      recoverUntil: now + RECOVER_TTL_MS,
      state: 'created',
      host,
    }
    await this.s.put({
      [`pair:${sessionId}`]: ses,
      [`pairtick:${ticketHash}`]: sessionId,
    })
    return {
      v: 1,
      sessionId,
      expiresAt: ses.expiresAt,
      serverPublicKey: keys.publicKey,
      scanSecret: ticket,
      host,
    }
  }

  async resolve(rawBody: string): Promise<Record<string, unknown>> {
    let parsed: unknown
    try { parsed = JSON.parse(rawBody) } catch { throw new ApiError('INVALID_MESSAGE', 400) }
    const { ticket } = z.object({ ticket: z.string().regex(/^[A-Za-z0-9_-]{43}$/) }).parse(parsed)
    const sessionId = await this.s.get<string>(`pairtick:${await hash(ticket)}`)
    if (!sessionId) throw new ApiError('PAIRING_NOT_FOUND', 404)
    const ses = await this.loadSession(sessionId)
    if (ses.state === 'expired') throw new ApiError('PAIRING_EXPIRED', 410)
    if (ses.state !== 'created' && ses.state !== 'claimed') throw new ApiError('PAIRING_CLOSED', 409)
    const keys = await this.ensureKeys()
    return {
      v: 1,
      sessionId: ses.sessionId,
      expiresAt: ses.expiresAt,
      serverPublicKey: keys.publicKey,
      scanSecret: ticket,
      host: ses.host,
    }
  }

  async claim(req: Request, sessionId: string, path: string, rawBody: string): Promise<Record<string, unknown>> {
    let parsed: unknown
    try { parsed = JSON.parse(rawBody) } catch { throw new ApiError('INVALID_MESSAGE', 400) }
    const body = z.object({
      scanSecret: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
      device: pairingDeviceSchema,
      deepseekUserId: z.string().min(1).max(256).optional(),
    }).parse(parsed)
    if (body.device.role !== 'client') throw new ApiError('INVALID_MESSAGE', 400)

    await this.verifyProof(req, body.device.identityKey, sessionId, 'mobile', path, rawBody)
    const ses = await this.loadSession(sessionId)
    if (!(await equal(await hash(body.scanSecret), ses.ticketHash))) throw new ApiError('PAIRING_NOT_FOUND', 404)
    if (ses.host.deviceId === body.device.deviceId || ses.host.identityKey === body.device.identityKey) {
      throw new ApiError('PAIRING_IDENTITY_MISMATCH', 409)
    }
    if (ses.state === 'expired') throw new ApiError('PAIRING_EXPIRED', 410)
    if (ses.state === 'claimed' && ses.mobile && sameIdentity(ses.mobile, body.device)) {
      return { state: 'claimed', verificationCode: ses.verificationCode, expiresAt: ses.expiresAt }
    }
    if (ses.state !== 'created') throw new ApiError('PAIRING_CLOSED', 409)

    ses.state = 'claimed'
    ses.mobile = body.device
    ses.deepseekUserId = body.deepseekUserId
    ses.verificationCode = randomDigits8()
    ses.attemptConsumed = false
    await this.s.put(`pair:${sessionId}`, ses)
    return { state: 'claimed', verificationCode: ses.verificationCode, expiresAt: ses.expiresAt }
  }

  private statusView(ses: PairingSession, side: 'host' | 'mobile'): Record<string, unknown> {
    const tokens = side === 'host' ? ses.hostTokens : ses.mobileTokens
    const dev = side === 'host' ? ses.host : ses.mobile
    return {
      v: 1,
      sessionId: ses.sessionId,
      state: ses.state,
      expiresAt: ses.expiresAt,
      recoverUntil: ses.recoverUntil,
      failureReason: ses.failureReason ?? null,
      attemptConsumed: Boolean(ses.attemptConsumed),
      submissionId: ses.submissionId ?? null,
      host: ses.host,
      mobile: ses.mobile ?? null,
      credentials: ses.state === 'completed' && ses.account && dev && tokens ? {
        account: ses.account,
        accountKind: ses.accountKind ?? 'device_only',
        device: dev,
        inboundOnly: side === 'host',
        pairingRestricted: ses.pairingRestricted ?? true,
        tokens,
      } : null,
    }
  }

  async mobileStatus(req: Request, sessionId: string, path: string, rawBody: string): Promise<Record<string, unknown>> {
    const ses = await this.loadSession(sessionId)
    if (!ses.mobile) throw new ApiError('PAIRING_NOT_CLAIMED', 409)
    await this.verifyProof(req, ses.mobile.identityKey, sessionId, 'mobile', path, rawBody)
    return this.statusView(ses, 'mobile')
  }

  async hostStatus(req: Request, sessionId: string, path: string, rawBody: string): Promise<Record<string, unknown>> {
    const ses = await this.loadSession(sessionId)
    await this.verifyProof(req, ses.host.identityKey, sessionId, 'host', path, rawBody)
    return this.statusView(ses, 'host')
  }

  async hostConfirm(req: Request, sessionId: string, path: string, rawBody: string): Promise<{ body: Record<string, unknown>; account?: string }> {
    const prev = this.confirmLocks.get(sessionId) ?? Promise.resolve()
    const run = prev.catch(() => {}).then(() => this.hostConfirmSerial(req, sessionId, path, rawBody))
    this.confirmLocks.set(sessionId, run)
    try { return await run } finally { if (this.confirmLocks.get(sessionId) === run) this.confirmLocks.delete(sessionId) }
  }
  private async hostConfirmSerial(req: Request, sessionId: string, path: string, rawBody: string): Promise<{ body: Record<string, unknown>; account?: string }> {
    const ses = await this.loadSession(sessionId)
    await this.verifyProof(req, ses.host.identityKey, sessionId, 'host', path, rawBody)
    let parsed: unknown
    try { parsed = JSON.parse(rawBody) } catch { throw new ApiError('INVALID_MESSAGE', 400) }
    const b = z.object({
      submissionId: z.string().min(1).max(128).optional(),
      verificationCode: z.string().regex(/^[0-9]{8}$/),
    }).parse(parsed)

    if (ses.state === 'completed' && (!b.submissionId || ses.submissionId === b.submissionId)) {
      return { body: this.statusView(ses, 'host') }
    }
    if (ses.state === 'expired') throw new ApiError('PAIRING_EXPIRED', 410)
    if (ses.state !== 'claimed' || !ses.mobile || !ses.verificationCode) throw new ApiError('PAIRING_CLOSED', 409)

    ses.attemptConsumed = true
    ses.submissionId = b.submissionId ?? null
    if (!(await equal(b.verificationCode, ses.verificationCode))) {
      ses.state = 'failed'
      ses.failureReason = 'verification_failed'
      await this.s.put(`pair:${sessionId}`, ses)
      return { body: this.statusView(ses, 'host') }
    }

    const account = `dsh-device:${crypto.randomUUID()}`
    await this.store.upsertDeviceOnlyAccount(account)
    const hostTokens = await this.store.register(account, toDescriptor(ses.host), { pairingRestricted: true })
    const mobileTokens = await this.store.register(account, toDescriptor(ses.mobile), { pairingRestricted: true })

    ses.state = 'completed'
    ses.account = account
    ses.accountKind = 'device_only'
    ses.pairingRestricted = true
    ses.hostTokens = hostTokens
    ses.mobileTokens = mobileTokens
    await this.s.put(`pair:${sessionId}`, ses)

    return { account, body: this.statusView(ses, 'host') }
  }

  async cancel(req: Request, sessionId: string, side: 'host' | 'mobile', path: string, rawBody: string): Promise<Record<string, unknown>> {
    const ses = await this.loadSession(sessionId)
    const pubKey = side === 'host' ? ses.host.identityKey : ses.mobile?.identityKey
    if (!pubKey) throw new ApiError('PAIRING_NOT_CLAIMED', 409)
    await this.verifyProof(req, pubKey, sessionId, side, path, rawBody)
    if (ses.state === 'created' || ses.state === 'claimed' || ses.state === 'approved') {
      ses.state = 'cancelled'
      await this.s.put(`pair:${sessionId}`, ses)
    }
    return side === 'host' ? this.statusView(ses, 'host') : { state: ses.state }
  }
}
