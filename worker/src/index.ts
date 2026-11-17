import { Hub, type Env } from './hub.js'
export { Hub }

const SECURITY = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
}

const LOCATIONS = new Set(['wnam', 'enam', 'sam', 'weur', 'eeur', 'apac', 'oc', 'afr', 'me'])

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(req.url)
    if (pathname.startsWith('/api/') || pathname.startsWith('/ws/') || ['/health', '/healthz', '/ready'].includes(pathname)) {
      const hint = env.DSH_DO_LOCATION?.trim().toLowerCase()
      const opt = hint && LOCATIONS.has(hint) ? { locationHint: hint as DurableObjectLocationHint } : undefined
      // Single hub DO: all accounts share it (isolated by account in storage/links).
      const res = await env.HUB.get(env.HUB.idFromName('hub'), opt).fetch(req)
      if (res.status === 101) return res
      const out = new Response(res.body, res)
      for (const [k, v] of Object.entries(SECURITY)) out.headers.set(k, v)
      return out
    }
    const res = await env.ASSETS.fetch(req)
    const out = new Response(res.body, res)
    for (const [k, v] of Object.entries(SECURITY)) out.headers.set(k, v)
    return out
  },
} satisfies ExportedHandler<Env>

