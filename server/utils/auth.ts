/**
 * server/utils/auth.ts
 *
 * Generates the HMAC-SHA256 session token stored in the auth cookie.
 *
 * Using the Web Crypto API (crypto.subtle) so this works identically on
 * Cloudflare Workers and Node.js 20+ — no Node-only imports needed.
 */

/**
 * Derive a deterministic session token from the admin password.
 * The token is an HMAC-SHA256 hex digest of a fixed message signed with the password.
 * Anyone who knows the password can verify the cookie; there is no server-side session store.
 */
export async function computeSessionToken(password: string): Promise<string> {
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(password),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode('bloggen-admin-session-v1'))
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('')
}
