export const CODE_MSG: Record<string, string> = {
  INVALID_MESSAGE: '请求参数无效或格式错误',
  AUTH_REQUIRED: '未登录或登录已过期，请重新登录',
  ACCOUNT_AUTH_REQUIRED: '账号登录已过期，请重新登录',
  AUTH_INVALID: '认证失败或无权访问（账号/密码错误或来源受限）',
  ACCOUNT_DISABLED: '该账号已被管理员禁用，请联系管理员',
  TOKEN_EXPIRED: '设备令牌已过期，请刷新或重新登录',
  RATE_LIMITED: '操作过于频繁或已达上限，请稍后再试',
  NOT_FOUND: '请求的资源不存在',
  DEVICE_NOT_FOUND: '未找到指定设备',
  DEVICE_REVOKED: '设备已被吊销，请重新配对注册',
  PEER_IDENTITY_MISMATCH: '设备身份密钥或角色不匹配',
  CONNECTION_NOT_FOUND: '连接不存在或已断开',
  CONNECTION_FAILED: '目标设备不在线或连接失败',
  MEMBERSHIP_REQUIRED: '当前设备角色无权执行此操作',
  PERMISSION_DENIED: '当前账号无权访问该管理模块，请联系根管理员授权',
  METHOD_NOT_FOUND: '请求的接口不存在',
  FRAME_TOO_LARGE: '请求内容过大',
  UNSUPPORTED_VERSION: '协议版本不受支持',
  CAPABILITY_NOT_SUPPORTED: '目标设备不支持请求的传输方式',
  WEBHOOK_NOT_FOUND: '未找到指定的 Webhook',
  WEBHOOK_FAILED: 'Webhook 投递失败',
  INVALID_WEBHOOK_URL: 'Webhook 地址无效或不允许内网地址',
  INVITE_INVALID: '邀请码无效、已过期或已用完',
  INVITE_EXISTS: '该邀请码已存在',
  INVITE_SESSION_EXPIRED: '邀请码验证会话已过期，请重新发起登录',
  OAUTH_DISABLED: '该第三方登录方式未启用',
  OAUTH_REGISTER_DISABLED: '该第三方登录未开启自动注册',
  OAUTH_EMAIL_BLOCKED: '该邮箱已被列入禁止注册黑名单',
  OAUTH_DOMAIN_NOT_ALLOWED: '该邮箱域名不在允许注册的白名单内',
  OAUTH_STATE_INVALID: '第三方登录状态已失效，请重新发起',
  OAUTH_TOKEN_FAILED: '第三方登录换取令牌失败，请检查密钥与回调地址',
  OAUTH_EMAIL_UNVERIFIED: '第三方账号邮箱未通过验证，无法登录',
  OAUTH_FAILED: '第三方登录失败，请稍后重试',
  HOST_CODE_INVALID: '主机匹配码无效或已过期，请重新生成',
  HELLO_TIMEOUT: 'WebSocket 握手超时，请重试',
  PAIRING_UNSUPPORTED: '服务端未启用扫码配对功能',
  PAIRING_NOT_FOUND: '配对会话不存在',
  PAIRING_EXPIRED: '配对二维码已过期，请重新生成',
  PAIRING_CLOSED: '配对会话已关闭',
  PAIRING_PROOF_INVALID: '配对签名校验失败',
  PAIRING_IDENTITY_MISMATCH: '配对设备身份不匹配',
  PAIRING_NOT_CLAIMED: '配对尚未被手机端认领',
  CLOUDFLARE_API_ERROR: 'Cloudflare TURN API 调用失败',
  INTERNAL_ERROR: '服务器内部错误，请稍后重试',
}

export class ApiFail extends Error {
  constructor(public code: string, public status: number, message?: string) {
    super(message && message !== code ? message : (CODE_MSG[code] || code))
  }
}

export async function api<T = any>(path: string, opt: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(path, {
    method: opt.method ?? (opt.body !== undefined ? 'POST' : 'GET'),
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: opt.body !== undefined ? JSON.stringify(opt.body) : undefined,
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new ApiFail(data?.error?.code ?? 'ERROR', res.status, data?.error?.message)
  return data as T
}

export const fmtAgo = (t: number): string => {
  if (!t) return '从未'
  const s = Math.max(0, (Date.now() - t) / 1000)
  if (s < 60) return `${Math.floor(s)} 秒前`
  if (s < 3600) return `${Math.floor(s / 60)} 分钟前`
  if (s < 86400) return `${Math.floor(s / 3600)} 小时前`
  return `${Math.floor(s / 86400)} 天前`
}
export const fmtDur = (ms: number): string => {
  const m = Math.floor(ms / 60000)
  return m < 60 ? `${m} 分钟` : m < 1440 ? `${Math.floor(m / 60)} 小时 ${m % 60} 分` : `${Math.floor(m / 1440)} 天 ${Math.floor((m % 1440) / 60)} 小时`
}
