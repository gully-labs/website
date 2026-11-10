// The server's reading of the Gully Core manifest: the committed copy (server/data/gully-core-manifest.json) at start,
// refreshed from https://gullycore.xyz/manifest.json every ten minutes in the background, so a chain that goes live on
// Gully Core shows up on gullylabs.xyz without a deploy. A fetch that fails or returns something that is not a manifest
// keeps the last good reading. GULLY_CORE_STATIC=1 (tests) never fetches.
import fs from 'node:fs'
import { MANIFEST_URL, derive } from './gully-core-derive.mjs'

const REFRESH_MS = 10 * 60_000
const STATIC = process.env.GULLY_CORE_STATIC === '1'
let manifest = JSON.parse(fs.readFileSync(new URL('./data/gully-core-manifest.json', import.meta.url), 'utf8'))
let reading = derive(manifest)
let fetchedAt = 0
let inflight = null
let refreshed = null

function refresh() {
  if (STATIC || inflight || Date.now() - fetchedAt < REFRESH_MS) return
  inflight = (async () => {
    try {
      const r = await fetch(process.env.GULLY_CORE_MANIFEST_URL || MANIFEST_URL, { headers: { accept: 'application/json', 'user-agent': 'gullylabs.xyz (gully-core manifest reader)' }, signal: AbortSignal.timeout(5000) })
      if (!r.ok) return
      const j = await r.json()
      const d = derive(j)
      manifest = j
      reading = d
      refreshed = new Date().toISOString()
    } catch {
      /* keep the last good reading */
    } finally {
      fetchedAt = Date.now()
      inflight = null
    }
  })()
}

/** The current reading (chains in display order, whereLive, multisig chains, links, fee). Triggers a background refresh when due. */
export function gullyCore() {
  refresh()
  return reading
}
/** The manifest itself (committed copy or the last good fetch). */
export function gullyCoreManifest() {
  refresh()
  return manifest
}
/** When the reading last came from the network, or null while it is the committed copy. */
export const gullyCoreRefreshedAt = () => refreshed
