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
export const clearIceCache = (): void => { cached = undefined }

const urlsOf = (s: IceServer): string[] => (Array.isArray(s.urls) ? s.urls : [s.urls])
/** 从 TURN 返回的条目里剔除 STUN 地址;条目若混合了 turn: 地址则只保留 TURN 部分。 */
const stripStun = (s: IceServer): IceServer | undefined => {
  const keep = urlsOf(s).filter(u => !/^stuns?:/i.test(u))
  if (!keep.length) return undefined
  return { ...s, urls: keep.length === 1 ? keep[0]! : keep }
}

export async function fetchIceServers(
  turn: TurnKey | undefined,
  ttl: number,
  stunUrls: string[],
  noCache = false,
): Promise<{ servers: IceServer[]; turn: boolean; error?: string }> {
  // stunUrls 由 resolveStunUrls 按三个开关解析完成(自定义 / 公共列表 / Cloudflare);
  // 为空表示 STUN 总开关关闭,此时连 TURN 凭据自带的 STUN 也要剔除。
  const stun: IceServer[] = stunUrls.length ? [{ urls: stunUrls }] : []
  const wanted = new Set(stunUrls.map(u => u.trim().toLowerCase()))
  if (!turn) return { servers: stun, turn: false }
  // STUN 配置参与缓存键:后台切换开关后立即生效,不会拿到上一次合并结果的缓存。
  const cacheKey = `${turn.keyId}:${ttl}:${stunUrls.join(',')}`
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
    // Cloudflare 的 iceServers 自带它的 STUN:总开关关闭时整条剔除;开启时也交给 resolveStunUrls 决定是否保留,
    // 避免「我关了 Cloudflare STUN 却在 TURN 条目里又被塞回来」。
    const cleaned = list
      .map(s => (stun.length ? stripStunFromMixed(s, wanted) : stripStun(s)))
      .filter((s): s is IceServer => s !== undefined)
    const merged = stun.length ? [stun[0]!, ...cleaned] : cleaned
    // Reuse credentials for at most half the TTL (capped at 60s) so clients always get >= 240s validity
    cached = { key: cacheKey, expiresAt: now + Math.min(60, Math.floor(ttl / 2)) * 1000, servers: merged }
    return { servers: merged, turn: true }
  } catch (e) {
    console.error('turn_credentials_failed', String(e))
    return { servers: stun, turn: false, error: String(e) }
  }
}
/** 保留条目中仍被 wanted 认可的 STUN 地址,其余 URL 原样保留。 */
function stripStunFromMixed(s: IceServer, wanted: Set<string>): IceServer | undefined {
  const keep = urlsOf(s).filter(u => !/^stuns?:/i.test(u) || wanted.has(u.trim().toLowerCase()))
  if (!keep.length) return undefined
  return { ...s, urls: keep.length === 1 ? keep[0]! : keep }
}