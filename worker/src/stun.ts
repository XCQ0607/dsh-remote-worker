/** STUN 相关常量与解析:自定义 / Cloudflare / 公共列表三层,由后台三个开关控制。 */
import type { Settings } from './settings.js'

/** Cloudflare Realtime TURN 凭据里自带的 STUN,固定就这两条。 */
export const CLOUDFLARE_STUN = ['stun:stun.cloudflare.com:3478', 'stun:stun.cloudflare.com:443'] as const

/**
 * 内置公共 STUN 列表。
 * 挑选标准:各至少实测 2 次能返回 XOR-MAPPED-ADDRESS,且覆盖不同供应商与端口(3478 / 443 / 18000 / 19302),
 * 便于在 UDP 被干扰或 3478 被封的网络里仍有可用项。国内四项优先,便于亚太用户。
 * 维护说明:如某项长期不可用,直接在此删除;列表保持精简(建议 ≤ 12 条),避免 ICE 收集阶段无谓等待。
 */
export const PUBLIC_STUN = [
  // 国内(实测可用)
  'stun:stun.miwifi.com:3478',
  'stun:stun.chat.bilibili.com:3478',
  'stun:stun.hitv.com:3478',
  'stun:stun.douyucdn.cn:18000',
  // 国际大厂
  'stun:stun.cloudflare.com:443',
  'stun:stun.l.google.com:19302',
  'stun:stun1.l.google.com:19302',
  'stun:global.stun.twilio.com:3478',
  'stun:stun.voip.blackberry.com:3478',
  // 443 端口,穿透严格防火墙
  'stun:stun.nextcloud.com:443',
] as const

const norm = (u: string) => u.trim().toLowerCase()

/**
 * 计算真正下发给客户端的 STUN 列表(去重,保序):
 *   1. 自定义(后台填写 / DSH_STUN_URLS)
 *   2. 公共列表(开关打开时,见 PUBLIC_STUN)
 *   3. Cloudflare STUN(开关打开时;要求已配置自定义,否则强制关闭)
 * 总开关关闭时一律返回空数组,连 TURN 凭据自带的 STUN 也会被剔除。
 */
export function resolveStunUrls(cfg: Pick<Settings, 'stunEnabled' | 'stunUrls' | 'stunUseCloudflare' | 'stunUsePublicList'>): string[] {
  if (!cfg.stunEnabled) return []
  const out: string[] = []
  const seen = new Set<string>()
  const push = (u: string) => {
    const k = norm(u)
    if (!k || seen.has(k)) return
    seen.add(k); out.push(u.trim())
  }
  for (const u of cfg.stunUrls) push(u)
  if (cfg.stunUsePublicList) for (const u of PUBLIC_STUN) push(u)
  if (cfg.stunUseCloudflare) for (const u of CLOUDFLARE_STUN) push(u)
  return out
}
