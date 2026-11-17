/** 公共 STUN 列表与解析：用于 WebRTC P2P NAT 穿透（仅探测公网映射地址，不中转流量）。 */
export interface StunServer {
  url: string
  label?: string
  region?: string
  enabled: boolean
  builtin?: boolean
}

export const PUBLIC_STUN: readonly Omit<StunServer, 'enabled' | 'builtin'>[] = [
  // 国内（亚太低延迟优先）
  { url: 'stun:stun.miwifi.com:3478', label: '小米', region: '国内' },
  { url: 'stun:stun.chat.bilibili.com:3478', label: '哔哩哔哩', region: '国内' },
  { url: 'stun:stun.hitv.com:3478', label: '芒果 TV', region: '国内' },
  { url: 'stun:stun.douyucdn.cn:18000', label: '斗鱼', region: '国内' },
  { url: 'stun:stun.qq.com:3478', label: '腾讯', region: '国内' },
  // Cloudflare
  { url: 'stun:stun.cloudflare.com:443', label: 'Cloudflare 443', region: '全球' },
  { url: 'stun:stun.cloudflare.com:3478', label: 'Cloudflare 3478', region: '全球' },
  // 国际公共 STUN
  { url: 'stun:stun.l.google.com:19302', label: 'Google', region: '国际' },
  { url: 'stun:stun1.l.google.com:19302', label: 'Google 1', region: '国际' },
  { url: 'stun:stun2.l.google.com:19302', label: 'Google 2', region: '国际' },
  { url: 'stun:stun3.l.google.com:19302', label: 'Google 3', region: '国际' },
  { url: 'stun:stun4.l.google.com:19302', label: 'Google 4', region: '国际' },
  { url: 'stun:global.stun.twilio.com:3478', label: 'Twilio', region: '国际' },
  { url: 'stun:stun.voip.blackberry.com:3478', label: 'BlackBerry', region: '国际' },
  { url: 'stun:stun.nextcloud.com:443', label: 'Nextcloud', region: '国际' },
  { url: 'stun:stun.syncthing.net:3478', label: 'Syncthing', region: '国际' },
  { url: 'stun:stun.sipgate.net:3478', label: 'Sipgate', region: '欧洲' },
  { url: 'stun:stunserver.stunprotocol.org:3478', label: 'StunProtocol', region: '国际' },
]

export const defaultStunServers = (enabled = true): StunServer[] =>
  PUBLIC_STUN.map(s => ({ ...s, enabled, builtin: true }))

export function resolveStunUrls(cfg: { stunEnabled: boolean; stunServers: readonly StunServer[] }): string[] {
  if (!cfg.stunEnabled) return []
  const seen = new Set<string>()
  const out: string[] = []
  for (const s of cfg.stunServers) {
    if (!s.enabled) continue
    const k = s.url.trim().toLowerCase()
    if (!k || seen.has(k)) continue
    seen.add(k)
    out.push(s.url.trim())
  }
  return out
}
