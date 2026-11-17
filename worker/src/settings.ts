/** Runtime settings: wrangler `vars` (DSH_*) provide defaults; the admin dashboard overrides them (stored in the DO). */
export interface Settings {
  heartbeatMs: number
  helloTimeoutMs: number
  heartbeatDisconnectMs: number
  maxFramesPerSec: number
  maxConnections: number
  maxDevicesPerAccount: number
  sessionHours: number
  turnEnabled: boolean
  turnTtlSeconds: number
  stunUrls: string[]
  siteName: string
  allowedOrigins: string[]
}

type EnvLike = Record<string, unknown>
const RANGES: Record<string, [number, number]> = {
  heartbeatMs: [5000, 120_000], helloTimeoutMs: [1000, 60_000], heartbeatDisconnectMs: [15_000, 600_000],
  maxFramesPerSec: [64, 65_536], maxConnections: [8, 1024], maxDevicesPerAccount: [1, 4096],
  sessionHours: [1, 720], turnTtlSeconds: [60, 3600],
}
const clamp = (v: unknown, key: string, fallback: number): number => {
  const n = Number(v), [lo, hi] = RANGES[key]!
  return Number.isFinite(n) && n >= lo && n <= hi ? Math.round(n) : fallback
}
const list = (v: unknown): string[] =>
  (Array.isArray(v) ? v : typeof v === 'string' ? v.split(',') : []).map(x => String(x).trim()).filter(Boolean).slice(0, 16)

export function defaultSettings(env: EnvLike): Settings {
  return sanitize({
    heartbeatMs: env.DSH_HEARTBEAT_MS, helloTimeoutMs: env.DSH_HELLO_TIMEOUT_MS, heartbeatDisconnectMs: env.DSH_HEARTBEAT_DISCONNECT_MS,
    maxFramesPerSec: env.DSH_MAX_FRAMES_PER_SEC, maxConnections: env.DSH_MAX_CONNECTIONS, maxDevicesPerAccount: env.DSH_MAX_DEVICES_PER_ACCOUNT,
    sessionHours: env.DSH_SESSION_HOURS, turnEnabled: env.DSH_TURN_ENABLED !== 'false', turnTtlSeconds: env.TURN_TTL_SECONDS ?? env.DSH_TURN_TTL_SECONDS,
    stunUrls: env.DSH_STUN_URLS ?? 'stun:stun.cloudflare.com:3478', siteName: env.DSH_SITE_NAME ?? 'DSH Remote', allowedOrigins: env.DSH_ALLOWED_ORIGINS ?? '',
  }, {
    heartbeatMs: 25_000, helloTimeoutMs: 5000, heartbeatDisconnectMs: 75_000, maxFramesPerSec: 512, maxConnections: 256,
    maxDevicesPerAccount: 256, sessionHours: 8, turnEnabled: true, turnTtlSeconds: 300, stunUrls: [], siteName: 'DSH Remote', allowedOrigins: [],
  })
}

export function sanitize(input: Record<string, unknown>, base: Settings): Settings {
  const s = { ...base }
  for (const k of Object.keys(RANGES)) (s as Record<string, unknown>)[k] = clamp(input[k], k, (base as unknown as Record<string, number>)[k]!)
  if (s.heartbeatDisconnectMs < s.heartbeatMs * 2) s.heartbeatDisconnectMs = s.heartbeatMs * 3
  s.turnEnabled = input.turnEnabled === undefined ? base.turnEnabled : input.turnEnabled === true || input.turnEnabled === 'true'
  s.stunUrls = input.stunUrls === undefined ? base.stunUrls : list(input.stunUrls).filter(u => /^stuns?:[^\s]+$/i.test(u))
  s.allowedOrigins = input.allowedOrigins === undefined ? base.allowedOrigins : list(input.allowedOrigins).filter(o => /^https?:\/\/[^\s/]+$/i.test(o))
  s.siteName = typeof input.siteName === 'string' && input.siteName.trim() ? input.siteName.trim().slice(0, 40) : base.siteName
  return s
}

