// GET /api/holders/hero: the map on holdermaps.xyz's front page, always at once. A first read of a big token can take
// up to a minute, which is too long for a hero, so the page reads this instead: a small copy of one example's map, kept
// in memory and in DATA_DIR/holders-hero.json so a restart starts warm, refreshed in the background at most every 15
// minutes and only while someone is visiting. It calls the normal builder (readHolderMap) and changes no figure; `asOf`
// says when the map was read. With no copy yet it answers { state: 'reading' } and starts the first read.
import fs from 'node:fs'
import path from 'node:path'
import { DATA_DIR } from './http.mjs'
import { readHolderMap } from './holders.mjs'

export const HERO_EXAMPLES = [
  ['robinhood', 'AAPL'],
  ['robinhood', 'NVDA'],
  ['gully', '0xf0fd2800d4d6201857c674369411a7536e633008'],
]
const REFRESH_MS = 15 * 60_000
const KEEP_MS = 7 * 86_400_000
const MIN_WALLETS = 8
const MAX_NODES = 72

let hero = null // { at, body }
let restored = false
let inflight = null
let reader = readHolderMap
const file = () => path.join(DATA_DIR, 'holders-hero.json')

export function setHeroForTest({ read = readHolderMap, restore = false } = {}) {
  reader = read
  hero = null
  inflight = null
  restored = !restore
}

/** What the hero draws: the biggest wallets and the links between them, the summary, and the replay's two totals
    (without each frame's per-wallet shares, which are most of a map's weight). */
export function trimMap(m, chain, token) {
  const nodes = m.nodes.slice(0, MAX_NODES)
  const on = new Set(nodes.map((n) => n.id.toLowerCase()))
  return {
    state: 'ok',
    pick: { chain, token },
    kind: m.kind,
    chain: m.chain,
    token: m.token,
    asOf: m.asOf,
    coverage: m.coverage,
    holders: m.holders,
    nodes,
    links: m.links.filter((l) => on.has(l.source.toLowerCase()) && on.has(l.target.toLowerCase())),
    clusters: m.clusters,
    summary: m.summary,
    timeline: m.timeline ? { ...m.timeline, frames: (m.timeline.frames ?? []).map(({ pcts: _pcts, ...f }) => f) } : null,
  }
}

function restore() {
  if (restored) return
  restored = true
  try {
    const body = JSON.parse(fs.readFileSync(file(), 'utf8'))
    const at = Date.parse(body?.savedAt)
    if (body?.state === 'ok' && Number.isFinite(at) && Date.now() - at <= KEEP_MS) hero = { at, body }
  } catch {
    // no copy yet: the first read makes one
  }
}

// One save at a time, in order, so an older copy can never land after a newer one.
let saving = Promise.resolve()
function save(body) {
  const f = file()
  const tmp = `${f}.${process.pid}.tmp`
  saving = saving
    .then(() => fs.promises.mkdir(path.dirname(f), { recursive: true }))
    .then(() => fs.promises.writeFile(tmp, JSON.stringify(body)))
    .then(() => fs.promises.rename(tmp, f))
    .catch((e) => console.warn(`[holders-hero] could not save the copy: ${String(e?.message ?? e)}`))
}

async function build() {
  let thin = null
  for (const [chain, token] of HERO_EXAMPLES) {
    try {
      const m = await reader(chain, token, { tier: 'free' })
      if (m?.state !== 'ok') continue
      if (m.nodes.length >= MIN_WALLETS) return publish(m, chain, token)
      thin ??= [m, chain, token]
    } catch (e) {
      console.warn(`[holders-hero] ${chain}/${token}: ${String(e?.message ?? e)}`)
    }
  }
  // Nothing rich could be read: an existing copy stays; with none, a small real map beats an empty hero.
  if (!hero && thin) publish(...thin)
  return hero?.body ?? null
}

function publish(m, chain, token) {
  const savedAt = new Date().toISOString()
  const body = { ...trimMap(m, chain, token), savedAt }
  hero = { at: Date.now(), body }
  save(body)
  return body
}

function refresh() {
  if (!inflight) {
    const run = build()
      .catch((e) => console.warn(`[holders-hero] refresh failed: ${String(e?.message ?? e)}`))
      .finally(() => {
        if (inflight === run) inflight = null
      })
    inflight = run
  }
  return inflight
}

/** Never waits: the copy if there is one, and a background refresh when it is due. */
export function readHero() {
  restore()
  if (!hero || Date.now() - hero.at >= REFRESH_MS) refresh()
  return hero ? hero.body : { state: 'reading' }
}

/** Tests: wait for the refresh in flight. */
export const heroSettled = () => inflight ?? Promise.resolve()
