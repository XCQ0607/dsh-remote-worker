// WebCrypto helpers (no node:crypto) — all async.
const enc = new TextEncoder()

export const b64url = (buf: ArrayBuffer | Uint8Array): string => {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf)
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
}
export const fromB64url = (s: string): Uint8Array => {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4))
  const bin = atob(s.replaceAll('-', '+').replaceAll('_', '/') + pad)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
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

const X25519_PKCS8_PREFIX = new Uint8Array([0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x6e, 0x04, 0x22, 0x04, 0x20])

export async function generateX25519KeyPair(): Promise<{ publicKey: string; privateKey: string }> {
  const kp = await crypto.subtle.generateKey({ name: 'X25519' }, true, ['deriveBits']) as CryptoKeyPair
  const [pub, priv] = await Promise.all([
    crypto.subtle.exportKey('raw', kp.publicKey) as Promise<ArrayBuffer>,
    crypto.subtle.exportKey('pkcs8', kp.privateKey) as Promise<ArrayBuffer>,
  ])
  const privBytes = new Uint8Array(priv)
  const rawPriv = privBytes.slice(privBytes.length - 32)
  return { publicKey: b64url(pub), privateKey: b64url(rawPriv) }
}

export async function pairingProof(opts: {
  serverPrivateKey: string
  devicePublicKey: string
  sessionId: string
  side: 'host' | 'mobile'
  path: string
  rawJson: string
}): Promise<string> {
  const rawPriv = fromB64url(opts.serverPrivateKey)
  const rawPub = fromB64url(opts.devicePublicKey)
  if (rawPriv.length !== 32 || rawPub.length !== 32) throw new Error('Invalid X25519 key length')
  const pkcs8 = new Uint8Array(X25519_PKCS8_PREFIX.length + 32)
  pkcs8.set(X25519_PKCS8_PREFIX)
  pkcs8.set(rawPriv, X25519_PKCS8_PREFIX.length)
  const [privKey, pubKey] = await Promise.all([
    crypto.subtle.importKey('pkcs8', pkcs8, { name: 'X25519' }, false, ['deriveBits']),
    crypto.subtle.importKey('raw', rawPub, { name: 'X25519' }, false, []),
  ])
  const shared = await crypto.subtle.deriveBits({ name: 'X25519', public: pubKey } as unknown as SubtleCryptoDeriveKeyAlgorithm, privKey, 256)
  const ikm = await crypto.subtle.importKey('raw', shared, 'HKDF', false, ['deriveBits'])
  const proofKeyBits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: enc.encode(opts.sessionId), info: enc.encode(`dsh-pairing-v1/${opts.side}`) },
    ikm,
    256,
  )
  const macKey = await crypto.subtle.importKey('raw', proofKeyBits, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const bodyHash = await hash(opts.rawJson)
  const sig = await crypto.subtle.sign('HMAC', macKey, enc.encode(`POST\n${opts.path}\n${bodyHash}`))
  return b64url(sig)
}

