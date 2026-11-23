// Gully AI: the provider's health across restarts.
//
// ask.mjs keeps the provider state in memory (ok / unavailable / failing). A restart used to forget it, so the status
// row read "up" until the first question failed. Two things fix that, both used by startAsk():
//   - the last state is written to DATA_DIR/ask-health.json on every change and read back at start;
//   - one cheap startup probe: GET <api>/v1/models?limit=1 with the key. It writes no text and uses no tokens, so it
//     costs nothing and is not counted in the daily cap. 200 = the key works, 401/403 = the account refuses us,
//     anything else (network, 5xx, 429) = unknown: the restored state stands.
// The file holds no key and no question: { ok, lastError (already scrubbed, <= 200 chars), since, failingN, failingSince, at }.

import fs from 'node:fs'
import path from 'node:path'

/** The stored state, or null when there is none or it cannot be read. */
export function readHealth(file) {
  try {
    const d = JSON.parse(fs.readFileSync(file, 'utf8'))
    if (!d || typeof d.ok !== 'boolean') return null
    return { ok: d.ok, lastError: typeof d.lastError === 'string' ? d.lastError.slice(0, 200) : null, since: typeof d.since === 'string' ? d.since : null, failingN: Number.isInteger(d.failingN) && d.failingN > 0 ? d.failingN : 0, failingSince: typeof d.failingSince === 'string' ? d.failingSince : null, at: typeof d.at === 'string' ? d.at : null }
  } catch {
    return null
  }
}

/** Writes the state (atomic rename). Never throws. */
export function writeHealth(file, state, now = new Date().toISOString()) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file + '.tmp', JSON.stringify({ ...state, at: now }))
    fs.renameSync(file + '.tmp', file)
    return true
  } catch (e) {
    console.error('ask health:', e?.message ?? e)
    return false
  }
}

/** One authenticated call that costs nothing. Returns 'ok' | 'unavailable' | 'unknown'. Never throws. */
export async function probeProvider({ base, key, fetchImpl = fetch, timeoutMs = 8_000 }) {
  if (!key) return 'unknown'
  try {
    const r = await fetchImpl(`${base}/v1/models?limit=1`, { method: 'GET', headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' }, redirect: 'manual', signal: AbortSignal.timeout(timeoutMs) })
    if (r.status === 200) return 'ok'
    if (r.status === 401 || r.status === 403) return 'unavailable'
    return 'unknown'
  } catch {
    return 'unknown'
  }
}

/** A stored "unavailable" that a working key disproves (a key or sign-in problem; billing problems are not visible to the probe). */
export const KEY_ERROR = /api[- ]?key|authentication|permission|HTTP 401|HTTP 403|probe/i
