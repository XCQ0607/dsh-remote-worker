/** 公共 STUN 列表与解析：用于 WebRTC P2P NAT 穿透（仅探测公网映射地址，不中转流量）。 */
export interface StunServer {
  url: string
  label?: string
  region?: string
  enabled: boolean
  builtin?: boolean
}

export const DEFAULT_MAX_ENABLED_STUN = 6

type BuiltinStun = Omit<StunServer, 'enabled' | 'builtin'> & { defaultEnabled?: boolean }

/**
 * 内置公共 STUN 列表（共 18 条，默认仅启用国内实测响应最快的 4 条 <70ms 节点）。
 * 其余节点默认禁用，避免过多/不可达 STUN 拖慢 ICE 收集导致超过 12s 超时退回 Relay。
 */
export const PUBLIC_STUN: readonly BuiltinStun[] = [
  // 国内实测高速可用（默认开启，实测 39–70ms）
  { url: 'stun:stun.douyucdn.cn:18000', label: '斗鱼', region: '国内 · 推荐', defaultEnabled: true },
  { url: 'stun:stun.hitv.com:3478', label: '芒果 TV', region: '国内 · 推荐', defaultEnabled: true },
  { url: 'stun:stun.miwifi.com:3478', label: '小米', region: '国内 · 推荐', defaultEnabled: true },
  { url: 'stun:stun.chat.bilibili.com:3478', label: '哔哩哔哩', region: '国内 · 推荐', defaultEnabled: true },
  { url: 'stun:stun.qq.com:3478', label: '腾讯', region: '国内', defaultEnabled: false },
  // Cloudflare（3478 实测 211ms 可用；443 UDP 实测超时，默认均关闭按需开启）
  { url: 'stun:stun.cloudflare.com:3478', label: 'Cloudflare 3478', region: '全球', defaultEnabled: false },
  { url: 'stun:stun.cloudflare.com:443', label: 'Cloudflare 443', region: '全球', defaultEnabled: false },
  // 国际公共 STUN（默认关闭，海外或跨区按需开启）
  { url: 'stun:stun.l.google.com:19302', label: 'Google', region: '国际', defaultEnabled: false },
  { url: 'stun:stun1.l.google.com:19302', label: 'Google 1', region: '国际', defaultEnabled: false },
  { url: 'stun:stun2.l.google.com:19302', label: 'Google 2', region: '国际', defaultEnabled: false },
  { url: 'stun:stun3.l.google.com:19302', label: 'Google 3', region: '国际', defaultEnabled: false },
  { url: 'stun:stun4.l.google.com:19302', label: 'Google 4', region: '国际', defaultEnabled: false },
  { url: 'stun:global.stun.twilio.com:3478', label: 'Twilio', region: '国际', defaultEnabled: false },
  { url: 'stun:stun.voip.blackberry.com:3478', label: 'BlackBerry', region: '国际', defaultEnabled: false },
  { url: 'stun:stun.nextcloud.com:443', label: 'Nextcloud', region: '国际', defaultEnabled: false },
  { url: 'stun:stun.syncthing.net:3478', label: 'Syncthing', region: '国际', defaultEnabled: false },
  { url: 'stun:stun.sipgate.net:3478', label: 'Sipgate', region: '欧洲', defaultEnabled: false },
  { url: 'stun:stunserver.stunprotocol.org:3478', label: 'StunProtocol', region: '国际', defaultEnabled: false },
]

export const defaultStunServers = (): StunServer[] =>
  PUBLIC_STUN.map(({ defaultEnabled, ...s }) => ({ ...s, enabled: Boolean(defaultEnabled), builtin: true }))

export function resolveStunUrls(cfg: { stunEnabled: boolean; stunServers: readonly StunServer[]; maxEnabledStun?: number }): string[] {
  if (!cfg.stunEnabled) return []
  const limit = cfg.maxEnabledStun ?? DEFAULT_MAX_ENABLED_STUN
  const seen = new Set<string>()
  const out: string[] = []
  for (const s of cfg.stunServers) {
    if (!s.enabled) continue
    const k = s.url.trim().toLowerCase()
    if (!k || seen.has(k)) continue
    seen.add(k)
    out.push(s.url.trim())
    if (out.length >= limit) break
  }
  return out
}
