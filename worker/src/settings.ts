import { defaultStunServers, type StunServer } from './stun.js'

/** Runtime settings: wrangler `vars` (DSH_*) provide defaults; the admin dashboard overrides them (stored in the DO). */
export interface OriginRule {
  origin: string
  enabled: boolean
}

export interface Settings {
  heartbeatMs: number
  helloTimeoutMs: number
  heartbeatDisconnectMs: number
  maxFramesPerSec: number
  maxConnections: number
  maxDevicesPerAccount: number
  sessionHours: number
  /** 打开 P2P：允许设备协商 transport.p2p（默认开）。 */
  p2pEnabled: boolean
  /** 打开 STUN：用于 P2P NAT 穿透，关闭后不下发任何 STUN（含 TURN 凭据自带的）。 */
  stunEnabled: boolean
  /** 启用 TURN：P2P 打洞失败时使用 Cloudflare TURN 中继（默认开）。 */
  turnEnabled: boolean
  turnTtlSeconds: number
  /** P2P STUN 服务器列表（可添加 / 删除 / 单独禁用）。 */
  stunServers: StunServer[]
  siteName: string
  /** 额外允许的 Origin 规则列表（可添加 / 删除 / 单独禁用）。 */
  originRules: OriginRule[]
  /** 由 originRules 中已启用项派生，供 CORS / Origin 校验使用。 */
  allowedOrigins: string[]
}

type EnvLike = Record<string, unknown>
const RANGES: Record<string, [number, number]> = {
  heartbeatMs: [5000, 120_000], helloTimeoutMs: [1000, 60_000], heartbeatDisconnectMs: [15_000, 600_000],
  maxFramesPerSec: [64, 65_536], maxConnections: [8, 1024], maxDevicesPerAccount: [1, 4096],
  sessionHours: [1, 720], turnTtlSeconds: [60, 3600],
}
const STUN_RE = /^stuns?:[^\s]+$/i
const ORIGIN_RE = /^https?:\/\/[^\s/]+$/i
const clamp = (v: unknown, key: string, fallback: number): number => {
  const n = Number(v), [lo, hi] = RANGES[key]!
  return Number.isFinite(n) && n >= lo && n <= hi ? Math.round(n) : fallback
}
const strList = (v: unknown): string[] =>
  (Array.isArray(v) ? v : typeof v === 'string' ? v.split(',') : []).map(x => String(x).trim()).filter(Boolean)
const boolFlag = (v: unknown, dflt: boolean): boolean =>
  v === undefined ? dflt : v === true || v === 'true'

function normStunServers(raw: unknown): StunServer[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const out: StunServer[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const r = item as Record<string, unknown>
    const url = typeof r.url === 'string' ? r.url.trim() : ''
    if (!STUN_RE.test(url)) continue
    const k = url.toLowerCase()
    if (seen.has(k)) continue
    seen.add(k)
    out.push({
      url,
      enabled: r.enabled !== false,
      ...(typeof r.label === 'string' && r.label.trim() ? { label: r.label.trim().slice(0, 32) } : {}),
      ...(typeof r.region === 'string' && r.region.trim() ? { region: r.region.trim().slice(0, 16) } : {}),
      ...(r.builtin ? { builtin: true } : {}),
    })
    if (out.length >= 64) break
  }
  return out
}

function mergeStunFromUrls(urls: string[], includeBuiltins: boolean, cfEnabled?: boolean): StunServer[] {
  const seen = new Set<string>()
  const out: StunServer[] = []
  const push = (s: StunServer) => {
    const k = s.url.trim().toLowerCase()
    if (!k || seen.has(k)) return
    seen.add(k)
    out.push(s)
  }
  for (const u of urls) if (STUN_RE.test(u)) push({ url: u, label: '自定义', enabled: true })
  if (includeBuiltins) {
    for (const s of defaultStunServers(true)) {
      if (cfEnabled === false && s.url.includes('stun.cloudflare.com')) push({ ...s, enabled: false })
      else push(s)
    }
  }
  return out.slice(0, 64)
}

function normOriginRules(raw: unknown): OriginRule[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const out: OriginRule[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const r = item as Record<string, unknown>
    const origin = typeof r.origin === 'string' ? r.origin.trim() : ''
    if (!ORIGIN_RE.test(origin)) continue
    const k = origin.toLowerCase()
    if (seen.has(k)) continue
    seen.add(k)
    out.push({ origin, enabled: r.enabled !== false })
    if (out.length >= 32) break
  }
  return out
}

export function defaultSettings(env: EnvLike): Settings {
  const customStun = strList(env.DSH_STUN_URLS).filter(u => STUN_RE.test(u))
  const includePublic = env.DSH_STUN_USE_PUBLIC_LIST !== 'false'
  const origList = strList(env.DSH_ALLOWED_ORIGINS).filter(o => ORIGIN_RE.test(o))
  const originRules: OriginRule[] = [...new Set(origList)].slice(0, 32).map(origin => ({ origin, enabled: true }))
  return sanitize({
    heartbeatMs: env.DSH_HEARTBEAT_MS,
    helloTimeoutMs: env.DSH_HELLO_TIMEOUT_MS,
    heartbeatDisconnectMs: env.DSH_HEARTBEAT_DISCONNECT_MS,
    maxFramesPerSec: env.DSH_MAX_FRAMES_PER_SEC,
    maxConnections: env.DSH_MAX_CONNECTIONS,
    maxDevicesPerAccount: env.DSH_MAX_DEVICES_PER_ACCOUNT,
    sessionHours: env.DSH_SESSION_HOURS,
    p2pEnabled: env.DSH_P2P_ENABLED !== 'false',
    stunEnabled: env.DSH_STUN_ENABLED !== 'false',
    turnEnabled: env.DSH_TURN_ENABLED !== 'false',
    turnTtlSeconds: env.TURN_TTL_SECONDS ?? env.DSH_TURN_TTL_SECONDS,
    stunServers: mergeStunFromUrls(customStun, includePublic),
    siteName: env.DSH_SITE_NAME ?? 'DSH Remote',
    originRules,
  }, {
    heartbeatMs: 25_000, helloTimeoutMs: 5000, heartbeatDisconnectMs: 75_000, maxFramesPerSec: 512, maxConnections: 256,
    maxDevicesPerAccount: 256, sessionHours: 8, p2pEnabled: true, stunEnabled: true, turnEnabled: true, turnTtlSeconds: 300,
    stunServers: defaultStunServers(true), siteName: 'DSH Remote', originRules: [], allowedOrigins: [],
  })
}

export function sanitize(input: Record<string, unknown>, base: Settings): Settings {
  const s = { ...base }
  for (const k of Object.keys(RANGES)) (s as Record<string, unknown>)[k] = clamp(input[k], k, (base as unknown as Record<string, number>)[k]!)
  if (s.heartbeatDisconnectMs < s.heartbeatMs * 2) s.heartbeatDisconnectMs = s.heartbeatMs * 3
  s.p2pEnabled = boolFlag(input.p2pEnabled, base.p2pEnabled)
  s.stunEnabled = boolFlag(input.stunEnabled, base.stunEnabled)
  s.turnEnabled = boolFlag(input.turnEnabled, base.turnEnabled)

  if (Array.isArray(input.stunServers)) {
    s.stunServers = normStunServers(input.stunServers)
  } else if (input.stunUrls !== undefined || input.stunUsePublicList !== undefined || input.stunUseCloudflare !== undefined) {
    // 兼容旧版 storage 结构迁移
    const urls = strList(input.stunUrls).filter(u => STUN_RE.test(u))
    const incPub = boolFlag(input.stunUsePublicList, true)
    const cfOn = input.stunUseCloudflare === undefined ? undefined : boolFlag(input.stunUseCloudflare, false)
    s.stunServers = mergeStunFromUrls(urls, incPub, cfOn)
  }

  if (Array.isArray(input.originRules)) {
    s.originRules = normOriginRules(input.originRules)
  } else if (input.allowedOrigins !== undefined) {
    const origins = strList(input.allowedOrigins).filter(o => ORIGIN_RE.test(o))
    s.originRules = [...new Set(origins)].slice(0, 32).map(origin => ({ origin, enabled: true }))
  }
  s.allowedOrigins = s.originRules.filter(r => r.enabled).map(r => r.origin)
  s.siteName = typeof input.siteName === 'string' && input.siteName.trim() ? input.siteName.trim().slice(0, 40) : base.siteName
  return s
}
