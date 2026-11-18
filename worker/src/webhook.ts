import { z } from 'zod'

export type WhEvent = 'host_offline' | 'host_online' | 'device_registered'
export const WH_EVENTS: WhEvent[] = ['host_offline', 'host_online', 'device_registered']
export const WH_MAX = 10
export type Webhook = {
  id: string; name: string; url: string; enabled: boolean; events: WhEvent[]; deviceIds: string[]
  secret?: string; offlineDelaySec?: number; createdAt?: number
  lastAt?: number; lastOk?: boolean; lastStatus?: number; lastError?: string; okCount?: number; failCount?: number
}
export type WhLog = { t: number; id: string; event: string; ok: boolean; status?: number; error?: string; ms: number }
export type Platform = 'feishu' | 'dingtalk' | 'wecom' | 'discord' | 'slack' | 'custom'

export const whInput = z.object({
  id: z.string().trim().regex(/^[A-Za-z0-9_-]{1,32}$/).optional(),
  name: z.string().trim().max(64).optional(),
  url: z.string().trim().url().max(512).optional(),
  enabled: z.boolean().optional(),
  events: z.array(z.enum(['host_offline', 'host_online', 'device_registered'])).min(1).optional(),
  deviceIds: z.array(z.string().trim().min(1).max(128)).max(64).optional(),
  secret: z.string().trim().max(128).optional(),
  offlineDelaySec: z.number().int().min(0).max(300).optional(),
})

function parseIpv6(raw: string): number[] | null {
  let s = raw.toLowerCase()
  const v4m = /:(\d+\.\d+\.\d+\.\d+)$/.exec(s)
  if (v4m) {
    const parts = v4m[1]!.split('.').map(Number)
    if (parts.some(n => n < 0 || n > 255)) return null
    s = s.slice(0, v4m.index) + `:${((parts[0]! << 8) | parts[1]!).toString(16)}:${((parts[2]! << 8) | parts[3]!).toString(16)}`
  }
  const halves = s.split('::')
  if (halves.length > 2) return null
  const left = halves[0] ? halves[0].split(':').filter(Boolean) : []
  const right = halves.length === 2 && halves[1] ? halves[1].split(':').filter(Boolean) : []
  if (halves.length === 1 && left.length !== 8) return null
  if (left.length + right.length > 8) return null
  const zeros = Array(8 - left.length - right.length).fill('0')
  const groups = [...left, ...zeros, ...right]
  const nums = groups.map(g => (/^[0-9a-f]{1,4}$/.test(g) ? parseInt(g, 16) : -1))
  return nums.some(n => n < 0) ? null : nums
}

function isPrivateV4(a: number, b: number): boolean {
  return a === 10 || a === 127 || a === 0 || a >= 224 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127)
}

/** SSRF guard: https only, no credentials, no loopback/private/link-local/multicast/internal hosts. */
export function checkUrl(raw: string): string | null {
  let u: URL
  try { u = new URL(raw) } catch { return 'URL 无效' }
  if (u.protocol !== 'https:') return '仅支持 https 地址'
  if (u.username || u.password) return 'URL 不能包含账号密码'
  const h = u.hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (h === 'localhost' || h.endsWith('.local') || h.endsWith('.internal') || h.endsWith('.localhost') || (!h.includes('.') && !h.includes(':'))) return '不允许内网地址'
  const m = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(h)
  if (m && isPrivateV4(Number(m[1]), Number(m[2]))) return '不允许内网地址'
  if (h.includes(':')) {
    const g = parseIpv6(h)
    if (!g) return 'URL 无效'
    const allZero = g.slice(0, 7).every(x => x === 0)
    if (allZero && (g[7] === 0 || g[7] === 1)) return '不允许内网地址' // :: or ::1
    if ((g[0]! & 0xfe00) === 0xfc00 || (g[0]! & 0xffc0) === 0xfe80 || (g[0]! & 0xff00) === 0xff00) return '不允许内网地址' // ULA, link-local, multicast
    if (g.slice(0, 6).every(x => x === 0) && isPrivateV4(g[6]! >> 8, g[6]! & 0xff)) return '不允许内网地址' // ::/96 IPv4-compatible
    if (g.slice(0, 5).every(x => x === 0) && g[5] === 0xffff && isPrivateV4(g[6]! >> 8, g[6]! & 0xff)) return '不允许内网地址' // ::ffff:0:0/96
    if (g[0] === 0x2002 && isPrivateV4(g[1]! >> 8, g[1]! & 0xff)) return '不允许内网地址' // 2002::/16 6to4
    if (g[0] === 0x0064 && g[1] === 0xff9b && g.slice(2, 6).every(x => x === 0) && isPrivateV4(g[6]! >> 8, g[6]! & 0xff)) return '不允许内网地址' // 64:ff9b::/96 NAT64
  }
  return null
}

export function platformOf(url: string): Platform {
  const u = url.toLowerCase()
  if (u.includes('open.feishu.cn') || u.includes('open.larksuite.com')) return 'feishu'
  if (u.includes('oapi.dingtalk.com')) return 'dingtalk'
  if (u.includes('qyapi.weixin.qq.com')) return 'wecom'
  if (u.includes('discord.com/api/webhooks') || u.includes('discordapp.com/api/webhooks')) return 'discord'
  if (u.includes('hooks.slack.com')) return 'slack'
  return 'custom'
}

const TITLES: Record<WhEvent, string> = { host_offline: '主机离线告警', host_online: '主机上线恢复', device_registered: '新设备接入' }

function text(event: WhEvent, account: string, p: Record<string, unknown>): string {
  const lines = [`[DSH Remote] ${p.test ? '测试通知 · ' : ''}${TITLES[event]}`, `账号: ${account}`]
  if (p.deviceId) lines.push(`设备: ${p.displayName ? `${p.displayName} (${p.deviceId})` : p.deviceId}`)
  lines.push(`时间: ${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })}`)
  return lines.join('\n')
}

async function hmac(secret: string, data: string): Promise<{ hex: string; b64: string }> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data)))
  return { hex: [...sig].map(b => b.toString(16).padStart(2, '0')).join(''), b64: btoa(String.fromCharCode(...sig)) }
}

/** Build request for platform, including optional signing (feishu/dingtalk secret; generic HMAC header). */
async function build(w: Webhook, event: WhEvent, account: string, p: Record<string, unknown>): Promise<{ url: string; body: string; headers: Record<string, string> }> {
  const plat = platformOf(w.url)
  const msg = text(event, account, p)
  const ts = Date.now()
  const headers: Record<string, string> = { 'Content-Type': 'application/json', 'User-Agent': 'DSH-Remote-Webhook/2' }
  let url = w.url
  let obj: unknown
  if (plat === 'feishu') {
    obj = { msg_type: 'text', content: { text: msg } }
    if (w.secret) {
      const sec = Math.floor(ts / 1000)
      const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(`${sec}\n${w.secret}`), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
      const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, new Uint8Array()))
      obj = { timestamp: String(sec), sign: btoa(String.fromCharCode(...sig)), ...(obj as object) }
    }
  } else if (plat === 'dingtalk' || plat === 'wecom') {
    obj = { msgtype: 'text', text: { content: msg } }
    if (plat === 'dingtalk' && w.secret) {
      const s = (await hmac(w.secret, `${ts}\n${w.secret}`)).b64
      url += `${url.includes('?') ? '&' : '?'}timestamp=${ts}&sign=${encodeURIComponent(s)}`
    }
  } else if (plat === 'discord') obj = { content: msg, username: 'DSH Remote' }
  else if (plat === 'slack') obj = { text: msg }
  else obj = { event, account, timestamp: ts, message: msg, ...p }
  const body = JSON.stringify(obj)
  if (plat === 'custom' && w.secret) {
    headers['X-DSH-Timestamp'] = String(ts)
    headers['X-DSH-Signature'] = 'sha256=' + (await hmac(w.secret, `${ts}.${body}`)).hex
  }
  return { url, body, headers }
}

export type SendResult = { ok: boolean; status?: number; error?: string; ms: number }

/** Send once with up to 2 retries (5xx / network / 429). Detects platform-level error codes in 200 responses. */
export async function deliver(w: Webhook, event: WhEvent, account: string, p: Record<string, unknown>, retries = 2): Promise<SendResult> {
  const bad = checkUrl(w.url)
  if (bad) return { ok: false, error: bad, ms: 0 }
  const req = await build(w, event, account, p)
  const t0 = Date.now()
  let last: SendResult = { ok: false, error: 'unknown', ms: 0 }
  for (let i = 0; i <= retries; i++) {
    if (i) await new Promise(r => setTimeout(r, 400 * 2 ** (i - 1)))
    try {
      const res = await fetch(req.url, { method: 'POST', headers: req.headers, body: req.body, redirect: 'manual', signal: AbortSignal.timeout(7000) })
      let err: string | undefined
      if (res.status >= 300 && res.status < 400) err = '不允许重定向'
      else if (!res.ok) err = `HTTP ${res.status}`
      else {
        const t = (await res.text().catch(() => '')).slice(0, 2000)
        try {
          const j = JSON.parse(t) as Record<string, unknown>
          const code = j.code ?? j.StatusCode ?? j.errcode
          if (code !== undefined && code !== 0 && code !== '0') err = `平台返回错误: ${String(j.msg ?? j.errmsg ?? j.StatusMessage ?? code).slice(0, 120)}`
        } catch { /* non-JSON ok */ }
      }
      last = { ok: !err, status: res.status, error: err, ms: Date.now() - t0 }
      if (!err) return last
      if (res.status < 500 && res.status !== 429 && res.status < 300) return last // platform logic error, no retry
      if (res.status >= 300 && res.status < 500 && res.status !== 429) return last
    } catch (e) {
      const msg = e instanceof Error ? (e.name === 'TimeoutError' ? '请求超时（7 秒无响应）' : e.message) : String(e)
      const friendly = /internal error/i.test(msg) ? '网络连接失败（目标主机不可达、DNS 失败或 TLS 握手错误）' : msg
      last = { ok: false, error: friendly, ms: Date.now() - t0 }
    }
  }
  return last
}

export function publicView(w: Webhook): Omit<Webhook, 'secret'> & { hasSecret: boolean; platform: Platform; urlMasked: string } {
  const { secret, ...rest } = w
  let masked = w.url
  try { const u = new URL(w.url); masked = `${u.origin}${u.pathname.length > 14 ? u.pathname.slice(0, 10) + '…' + u.pathname.slice(-4) : u.pathname}` } catch { /* keep */ }
  return { ...rest, hasSecret: !!secret, platform: platformOf(w.url), urlMasked: masked }
}
