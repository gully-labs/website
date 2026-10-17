// Where the in-page stock-token swap may be offered. Owner-editable: this is the only list.
//
// The country comes from Cloudflare's CF-IPCountry header (every public request reaches gully-web through
// Cloudflare); no third-party geo service is called. It is an IP-based guess, not identity: a VPN changes it,
// and regions that are not countries (Crimea, the so-called DNR/LNR) cannot be told apart from the country
// Cloudflare files them under, so they are not blocked by this list on their own.
//
// - US: Robinhood's stock tokens are not offered to US persons, and other issuers exclude the US too.
// - CU, IR, KP, SY: comprehensively sanctioned (OFAC).
export const SWAP_BLOCKED = new Set(['US', 'CU', 'IR', 'KP', 'SY'])

/**
 * The visitor's country and whether the swap may be shown. A missing or unknown country (no header, Cloudflare's
 * XX for unknown or T1 for Tor) is not allowed, except on localhost where development has no Cloudflare in front.
 * @param {import('node:http').IncomingMessage} req
 * @param {boolean} isLocal
 * @returns {{ country: string | null, allowed: boolean, reason: 'ok' | 'blocked' | 'unknown' | 'local' }}
 */
export function geoFor(req, isLocal) {
  const raw = String(req.headers['cf-ipcountry'] ?? '').trim().toUpperCase()
  const country = /^[A-Z]{2}$/.test(raw) && raw !== 'XX' && raw !== 'T1' ? raw : null
  if (country) return SWAP_BLOCKED.has(country) ? { country, allowed: false, reason: 'blocked' } : { country, allowed: true, reason: 'ok' }
  return isLocal ? { country: null, allowed: true, reason: 'local' } : { country: null, allowed: false, reason: 'unknown' }
}
