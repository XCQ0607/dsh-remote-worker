// WebCrypto helpers (no node:crypto) — all async.
const enc = new TextEncoder()

export const b64url = (buf: ArrayBuffer | Uint8Array): string => {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf)
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
}
const hex = (buf: ArrayBuffer): string => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('')

export const hash = async (value: string): Promise<string> => hex(await crypto.subtle.digest('SHA-256', enc.encode(value)))
export const secret = (): string => b64url(crypto.getRandomValues(new Uint8Array(32)))

/** Constant-time-ish comparison via digests (same approach as upstream). */
export async function equal(a: string, b: string): Promise<boolean> {
  const [x, y] = await Promise.all([hash(a), hash(b)])
  let diff = 0
  for (let i = 0; i < x.length; i++) diff |= x.charCodeAt(i) ^ y.charCodeAt(i)
  return diff === 0
}

export async function hmacB64url(key: string, data: string): Promise<string> {
  const k = await crypto.subtle.importKey('raw', enc.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return b64url(await crypto.subtle.sign('HMAC', k, enc.encode(data)))
}

/** PBKDF2 verifier. Iterations are kept moderate for the free-plan CPU budget; passwords must be >= 12 chars. */
export const PBKDF2_ITERATIONS = 20_000
export async function pbkdf2(password: string, salt: string, iterations = PBKDF2_ITERATIONS): Promise<string> {
  const k = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits'])
  return hex(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode(salt), iterations }, k, 256))
}

