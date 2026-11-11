/**
 * Integrations guard shared by the Gully admin consoles (admin.gullyid.xyz, admin.kre8.fun, admin.gullypay.xyz,
 * app.gullyrpc.xyz/admin). Plain ESM, no dependencies; the same file is copied into each console.
 *
 *  - looksLikeWalletSecret: wallet private keys, signer keys and seed phrases are refused on every field, whatever the
 *    key name (any 32-byte hex run, a 12-24 word phrase, a Solana secret key, a PEM signer / OpenSSH key).
 *  - stepUpFresh: a write needs a Gully ID passkey sign-in (OIDC prompt=login, amr contains "passkey") whose auth_time
 *    is at most STEP_UP_MAX_AGE_S old.
 *  - RateLimit: a small sliding window per admin and action.
 */
export const STEP_UP_MAX_AGE_S = 300

export function looksLikeWalletSecret(raw) {
  const s = String(raw ?? '').trim()
  if (/(?:^|[^0-9a-fA-F])(?:0x)?[0-9a-fA-F]{64}(?:[^0-9a-fA-F]|$)/.test(s)) return 'hex32'
  const words = s.toLowerCase().split(/[\s,]+/).filter(Boolean)
  if (words.length >= 12 && words.length <= 24 && words.filter((w) => /^[a-z]{3,8}$/.test(w)).length >= 12) return 'mnemonic'
  if (/^[1-9A-HJ-NP-Za-km-z]{85,90}$/.test(s)) return 'solana'
  if (/^\[\s*(?:\d{1,3}\s*,\s*){31,}\d{1,3}\s*\]$/.test(s)) return 'solana'
  if (/BEGIN (?:EC|OPENSSH|ENCRYPTED|RSA) PRIVATE KEY/.test(s)) return 'pem_signer'
  return null
}

export const WALLET_REFUSED = { code: 'wallet_secret_refused', message: 'This looks like a wallet private key, signer key or seed phrase. Those never go into the admin console.' }

/** true when the session holds a passkey step-up no older than maxAge seconds */
export function stepUpFresh(session, nowMs = Date.now(), maxAge = STEP_UP_MAX_AGE_S) {
  const at = Number(session?.su)
  if (!Number.isFinite(at) || at <= 0) return false
  const age = nowMs / 1000 - at
  return age <= maxAge && age >= -60
}

/** checks an id_token's claims for a step-up: same subject, passkey, fresh auth_time */
export function stepUpClaimsOk(claims, sub, nowMs = Date.now(), maxAge = STEP_UP_MAX_AGE_S) {
  if (!claims || String(claims.sub ?? '').toLowerCase() !== String(sub ?? '').toLowerCase()) return { ok: false, why: 'other_account' }
  const amr = Array.isArray(claims.amr) ? claims.amr.map(String) : []
  if (!amr.includes('passkey') && !amr.includes('webauthn') && !amr.includes('hwk')) return { ok: false, why: 'not_passkey' }
  const at = Number(claims.auth_time)
  if (!Number.isFinite(at) || nowMs / 1000 - at > maxAge || at - nowMs / 1000 > 60) return { ok: false, why: 'stale' }
  return { ok: true, at }
}

export class RateLimit {
  constructor(limit, windowMs) {
    this.limit = limit
    this.windowMs = windowMs
    this.hits = new Map()
  }
  /** true = allowed */
  take(key, nowMs = Date.now()) {
    const arr = (this.hits.get(key) ?? []).filter((t) => nowMs - t < this.windowMs)
    if (arr.length >= this.limit) {
      this.hits.set(key, arr)
      return false
    }
    arr.push(nowMs)
    this.hits.set(key, arr)
    if (this.hits.size > 5000) this.hits.clear()
    return true
  }
}
