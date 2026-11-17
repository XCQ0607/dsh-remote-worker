/** ICE servers via Cloudflare Realtime TURN (https://developers.cloudflare.com/api/resources/calls/subresources/turn/). */
export interface IceServer { urls: string | string[]; username?: string; credential?: string }
export interface TurnKey { keyId: string; apiToken: string }
export interface CfAuth { apiToken?: string; email?: string; apiKey?: string }

const API = 'https://api.cloudflare.com/client/v4'
const authHeaders = (a: CfAuth): Record<string, string> =>
  a.apiToken ? { Authorization: `Bearer ${a.apiToken}` } : a.email && a.apiKey ? { 'X-Auth-Email': a.email, 'X-Auth-Key': a.apiKey } : {}

export async function cfApi<T>(auth: CfAuth, path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API}${path}`, { ...init, headers: { 'Content-Type': 'application/json', ...authHeaders(auth) } })
  const j = await res.json() as { success: boolean; result: T; errors?: { message: string }[] }
  if (!j.success) throw new Error(j.errors?.map(e => e.message).join('; ') || `HTTP ${res.status}`)
  return j.result
}

/** POST /accounts/{id}/calls/turn_keys — `secret` is only returned at creation time. */
export async function createTurnKey(auth: CfAuth, accountId: string, name: string): Promise<TurnKey> {
  const r = await cfApi<{ uid: string; secret?: string; apiToken?: string; key?: string }>(auth, `/accounts/${accountId}/calls/turn_keys`, { method: 'POST', body: JSON.stringify({ name }) })
  const apiToken = r.secret ?? r.apiToken ?? r.key
  if (!apiToken) throw new Error('Cloudflare API did not return TURN secret')
  return { keyId: r.uid, apiToken }
}
export const listTurnKeys = (auth: CfAuth, accountId: string) =>
  cfApi<{ uid: string; name: string; created: string }[]>(auth, `/accounts/${accountId}/calls/turn_keys`)

let cached: { key: string; expiresAt: number; servers: IceServer[] } | undefined

export async function fetchIceServers(
  turn: TurnKey | undefined,
  ttl: number,
  stunUrls: string[],
  noCache = false,
): Promise<{ servers: IceServer[]; turn: boolean; error?: string }> {
  const stun: IceServer[] = stunUrls.length ? [{ urls: stunUrls }] : []
  if (!turn) return { servers: stun, turn: false }
  const cacheKey = `${turn.keyId}:${ttl}`
  const now = Date.now()
  if (!noCache && cached && cached.key === cacheKey && cached.expiresAt > now) {
    return { servers: cached.servers, turn: true }
  }
  try {
    const res = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${turn.keyId}/credentials/generate-ice-servers`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${turn.apiToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ttl }),
      signal: AbortSignal.timeout(4000),
    })
    if (!res.ok) throw new Error(`turn api ${res.status}`)
    const data = await res.json() as { iceServers?: IceServer[] | IceServer }
    const list = Array.isArray(data.iceServers) ? data.iceServers : data.iceServers ? [data.iceServers] : []
    if (!list.length) return { servers: stun, turn: false, error: 'empty response' }
    // Reuse credentials for at most half the TTL (capped at 60s) so clients always get >= 240s validity
    cached = { key: cacheKey, expiresAt: now + Math.min(60, Math.floor(ttl / 2)) * 1000, servers: list }
    return { servers: list, turn: true }
  } catch (e) {
    console.error('turn_credentials_failed', String(e))
    return { servers: stun, turn: false, error: String(e) }
  }
}
