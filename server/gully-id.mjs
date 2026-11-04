// Sign in with Gully ID on the Gully Labs App (app.gullylabs.xyz), next to wallet sign-in (SIWE).
//
// The browser signs in on gullyid.xyz (sdk.js popup, OIDC code + PKCE, client `gully-labs`, registered in gully-ops
// gully/gully-id/clients.json) and posts ONLY the access token to POST /api/developer/gully. We ask Gully ID who it
// belongs to (GET <issuer>/v1/profile), check the token was issued to our client, and sign the browser in as the
// Gully ID's main wallet: an account here is a wallet address (developer.mjs), and Gully ID has already proven that
// wallet (a passkey smart account it deployed, or a SIWE-verified EOA). The Gully token is never stored.
//
//   GULLY_ID_ISSUER     issuer, default https://gullyid.xyz (http only for localhost, for tests); GULLY_ID_URL is an alias
//   GULLY_ID_CLIENT_ID  default gully-labs
//   GULLY_ID_SIGNIN     on (default) / off: off hides the button (GET /api/developer/session says so) and the route
//                       answers 404, without a rebuild

export const GULLY_ID_DEFAULT_URL = 'https://gullyid.xyz'

export function gullyIdConfig(env = process.env) {
  let url = String(env.GULLY_ID_ISSUER ?? env.GULLY_ID_URL ?? GULLY_ID_DEFAULT_URL).trim().replace(/\/+$/, '') || GULLY_ID_DEFAULT_URL
  try {
    const u = new URL(url)
    const local = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(u.hostname)
    if (u.protocol !== 'https:' && !(local && u.protocol === 'http:')) url = GULLY_ID_DEFAULT_URL
  } catch {
    url = GULLY_ID_DEFAULT_URL
  }
  return {
    enabled: !['off', 'false', '0', 'no'].includes(String(env.GULLY_ID_SIGNIN ?? 'on').trim().toLowerCase()),
    url,
    clientId: String(env.GULLY_ID_CLIENT_ID ?? 'gully-labs').trim() || 'gully-labs',
  }
}

const fail = (status, code, error) => ({ ok: false, status, code, error })

/**
 * Resolves a Gully ID access token to { ok: true, sub, address, name } or { ok: false, status, code, error }.
 * `address` is the main wallet, lower-cased.
 */
export async function gullyIdWallet(accessToken, { config = gullyIdConfig(), fetchImpl = fetch } = {}) {
  if (typeof accessToken !== 'string' || !accessToken.trim() || accessToken.length > 4096) return fail(401, 'gully-token-invalid', 'Gully ID sign-in failed or expired. Try again.')
  let r
  try {
    r = await fetchImpl(`${config.url}/v1/profile`, { headers: { authorization: `Bearer ${accessToken.trim()}`, accept: 'application/json' }, signal: AbortSignal.timeout(6000) })
  } catch {
    return fail(503, 'gully-id-unavailable', 'Gully ID is unreachable right now. Try again, or connect a wallet.')
  }
  if (r.status === 401 || r.status === 403) return fail(401, 'gully-token-invalid', 'Gully ID sign-in failed or expired. Try again.')
  if (!r.ok) return fail(503, 'gully-id-unavailable', 'Gully ID is unavailable right now. Try again, or connect a wallet.')
  const p = await r.json().catch(() => null)
  if (!p || typeof p.sub !== 'string' || !p.sub || p.sub.length > 64) return fail(401, 'gully-token-invalid', 'Gully ID sign-in failed or expired. Try again.')
  // A token issued to another Gully app must not open this one (Gully ID returns the client it was issued to).
  if (p.client !== config.clientId) return fail(401, 'gully-wrong-client', 'This Gully ID sign-in was made for another app. Sign in again.')
  const address = typeof p.wallet?.address === 'string' ? p.wallet.address.toLowerCase() : ''
  if (!/^0x[0-9a-f]{40}$/.test(address)) {
    return fail(409, 'gully-no-wallet', 'Your Gully ID has no wallet yet. Open gullyid.xyz, add a passkey wallet, then sign in again.')
  }
  return { ok: true, sub: p.sub, address, name: typeof p.gullyName === 'string' ? p.gullyName : null }
}
