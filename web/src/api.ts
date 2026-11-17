export class ApiFail extends Error {
  constructor(public code: string, public status: number, message?: string) { super(message || code) }
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

