// Gully AI: the knowledge console's data. Pure functions over the indexed chunks (local build + remote docs):
//
//   knowledgeView({ chunks, remote })  every source grouped by product, a coverage matrix (Covered / Thin / Missing),
//                                      totals and the remote sources' state. `publicView()` is the same without
//                                      anything operator-only (it is served at GET /api/ask/knowledge).
//   diffSnapshots(prev, chunks)        what an index rebuild added, removed or changed (by chunk id + text hash)
//   VersionStore                       DATA_DIR/ask-versions.json: the last snapshot and the last 20 diffs
//
// A chunk is { id, source, title, url, section, text, updatedAt }. Products are assigned by what the chunk's URL,
// title, section and source say (first match wins, most specific first); a chunk that names no product is "General".
// Modules here import nothing from ask.mjs, so the Swoop Copilot and the tests can reuse them.

import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

/** Covered needs at least COVERED_MIN passages and one page of its own; Thin is 1..COVERED_MIN-1; Missing is 0. */
export const COVERED_MIN = 8

/** id, name, a matcher on `${url} ${title} ${section} ${source}`, and the public page of the product. */
export const PRODUCTS = [
  { id: 'swoop', name: 'Swoop Ads', re: /swoopads|swoop ads|\bswoop\b/i, page: 'https://docs.swoopads.xyz' },
  { id: 'kre8', name: 'kre8', re: /kre8/i, page: 'https://kre8.fun' },
  { id: 'gully-id', name: 'Gully ID', re: /gullyid|gully id|passkey sign-in/i, page: 'https://gullyid.xyz' },
  { id: 'gully-rpc', name: 'Gully RPC', re: /gullyrpc|gully rpc/i, page: 'https://gullyrpc.xyz' },
  { id: 'multisig', name: 'Gully Multisig', re: /gullymultisig|multisig/i, page: 'https://gullymultisig.xyz' },
  { id: 'gully-core', name: 'Gully Core', re: /gullycore|gully core|core-sdk|\/gully-core/i, page: 'https://gullycore.xyz' },
  { id: 'gully-chain', name: 'Gully Chain', re: /gullychain|gully chain|\bl3\b|\/chains?\b|\/chain-kit|chain kit|orbit/i, page: 'https://gullychain.xyz' },
  { id: 'ipfs', name: 'Gully IPFS', re: /ipfs/i, page: 'https://docs.gullylabs.xyz/ipfs' },
  { id: 'security', name: 'Gully Security', re: /gully-security|gully security|\/security|\/score|gully score|scan terms/i, page: 'https://docs.gullylabs.xyz/gully-security' },
  { id: 'holder-map', name: 'Holder Map', re: /holder/i, page: 'https://docs.gullylabs.xyz/holder-map' },
  { id: 'pay', name: 'Gully Pay', re: /gully pay|gullypay|gully-pay|merchant|solana pay|payments?\b/i, page: 'https://gullypay.xyz' },
  { id: 'analytics', name: 'Gully Analytics', re: /analytics|umami/i, page: 'https://docs.gullylabs.xyz/analytics' },
  { id: 'studio', name: 'Gully Studio', re: /gullystudio|gully studio|unity/i, page: 'https://gullystudio.xyz' },
  { id: 'ai', name: 'Gully AI', re: /gully-ai|gully ai|\/ask\b/i, page: 'https://docs.gullylabs.xyz/gully-ai' },
  { id: 'telegram', name: 'Telegram bot', re: /telegram|\/tg\b/i, page: 'https://docs.gullylabs.xyz/telegram' },
  { id: 'tracker', name: 'Tracker', re: /tracker|tokenised stock|tokenized stock|\bwidget\b|\/api\b|api-keys|plans-alerts/i, page: 'https://gullylabs.xyz/tracker' },
  { id: 'legal', name: 'Legal and privacy', re: /\/legal|\/terms|\/privacy|\/copyright|terms of service|privacy policy/i, page: 'https://gullylabs.xyz/privacy' },
]
const GENERAL = { id: 'general', name: 'General (company, services, roadmap)', page: 'https://gullylabs.xyz' }

/** The product a chunk belongs to (an id from PRODUCTS, or 'general'). URL and title beat the body. */
export function productOf(c) {
  const head = `${c.url ?? ''} ${c.title ?? ''} ${c.section ?? ''}`
  for (const p of PRODUCTS) if (p.re.test(head)) return p.id
  const src = String(c.source ?? '')
  for (const p of PRODUCTS) if (p.re.test(src)) return p.id
  return GENERAL.id
}

const wordsOf = (s) => String(s ?? '').split(/\s+/).filter(Boolean).length
const pageOf = (url) => String(url ?? '').split('#')[0]
const latest = (a, b) => (!a ? b : !b ? a : a > b ? a : b)

export function statusOf(passages) {
  return passages >= COVERED_MIN ? 'Covered' : passages > 0 ? 'Thin' : 'Missing'
}

/**
 * Sources grouped by product with a coverage row each.
 * @returns {{ products: object[], general: object, totals: object, remote: object[] }}
 */
export function knowledgeView({ chunks = [], remote = {} } = {}) {
  const by = new Map([...PRODUCTS, GENERAL].map((p) => [p.id, { id: p.id, name: p.name, page: p.page, passages: 0, words: 0, lastIndexedAt: null, pages: new Map(), sources: new Set() }]))
  for (const c of chunks) {
    const g = by.get(productOf(c))
    g.passages++
    g.words += wordsOf(c.text)
    g.lastIndexedAt = latest(g.lastIndexedAt, c.updatedAt ?? null)
    g.sources.add(c.source)
    const url = pageOf(c.url)
    const pg = g.pages.get(url) ?? { url, title: c.title, source: c.source, passages: 0, words: 0, updatedAt: null }
    pg.passages++
    pg.words += wordsOf(c.text)
    pg.updatedAt = latest(pg.updatedAt, c.updatedAt ?? null)
    g.pages.set(url, pg)
  }
  const out = [...by.values()].map(({ pages, sources, ...g }) => ({ ...g, status: statusOf(g.passages), sources: [...sources].sort(), pages: [...pages.values()].sort((a, b) => b.passages - a.passages || a.url.localeCompare(b.url)) }))
  const general = out.find((p) => p.id === 'general')
  const products = out.filter((p) => p.id !== 'general').map((p) => p)
  const sources = Object.entries(remote.sources ?? {}).map(([key, s]) => ({ key, label: s.label, ok: !!s.ok, chunks: s.chunks?.length ?? 0, lastGoodAt: s.lastGoodAt ?? null, error: s.error ?? null, rejected: s.rejected ?? 0 }))
  return {
    products,
    general,
    totals: { passages: chunks.length, words: chunks.reduce((n, c) => n + wordsOf(c.text), 0), pages: new Set(chunks.map((c) => pageOf(c.url))).size, covered: products.filter((p) => p.status === 'Covered').length, thin: products.filter((p) => p.status === 'Thin').length, missing: products.filter((p) => p.status === 'Missing').length },
    remote: sources,
  }
}

/** The public "What Gully AI knows" view: per product the pages (title, link, last updated), no operator state. */
export function publicView(view, extra = {}) {
  return {
    products: view.products.map((p) => ({ id: p.id, name: p.name, status: p.status, passages: p.passages, lastIndexedAt: p.lastIndexedAt, pages: p.pages.slice(0, 40).map((g) => ({ title: g.title, url: g.url, updatedAt: g.updatedAt })), moreSources: Math.max(0, p.pages.length - 40) })),
    general: { name: view.general.name, passages: view.general.passages, lastIndexedAt: view.general.lastIndexedAt },
    totals: view.totals,
    ...extra,
  }
}

/* ------------------------------------------------------------ versions --- */

export const hashText = (s) => crypto.createHash('sha1').update(String(s ?? '')).digest('hex').slice(0, 10)
/** id -> { h: text hash, t: title, u: url } for every chunk. */
export const snapshotOf = (chunks) => Object.fromEntries(chunks.map((c) => [c.id, { h: hashText(`${c.title}|${c.section}|${c.text}`), t: c.title, u: c.url }]))

const CAP = 200
/** What changed between a stored snapshot and the chunks now. Lists are capped; the counts are exact. */
export function diffSnapshots(prev, chunks) {
  const next = snapshotOf(chunks)
  const added = []
  const removed = []
  const changed = []
  for (const [id, n] of Object.entries(next)) {
    const o = prev?.[id]
    if (!o) added.push({ id, title: n.t, url: n.u })
    else if (o.h !== n.h) changed.push({ id, title: n.t, url: n.u })
  }
  for (const [id, o] of Object.entries(prev ?? {})) if (!next[id]) removed.push({ id, title: o.t, url: o.u })
  return { counts: { added: added.length, removed: removed.length, changed: changed.length, total: chunks.length }, added: added.slice(0, CAP), removed: removed.slice(0, CAP), changed: changed.slice(0, CAP) }
}

/** Keeps the last snapshot and the last 20 non-empty diffs in one JSON file. */
export class VersionStore {
  constructor(file) {
    this.file = file
  }
  read() {
    try {
      const d = JSON.parse(fs.readFileSync(this.file, 'utf8'))
      if (d && typeof d === 'object') return { snapshot: d.snapshot ?? null, versions: Array.isArray(d.versions) ? d.versions : [] }
    } catch {
      /* none yet */
    }
    return { snapshot: null, versions: [] }
  }
  /** Records the index as it is now. The very first call stores the baseline without a diff. Returns the new version or null. */
  record(chunks, at = new Date().toISOString(), reason = 'rebuild') {
    const cur = this.read()
    const d = cur.snapshot ? diffSnapshots(cur.snapshot, chunks) : null
    const changedAny = d && (d.counts.added || d.counts.removed || d.counts.changed)
    let version = null
    if (!cur.snapshot) version = { at, reason: 'baseline', ...{ counts: { added: 0, removed: 0, changed: 0, total: chunks.length } }, added: [], removed: [], changed: [] }
    else if (changedAny) version = { at, reason, ...d }
    if (!version) return null
    const versions = [version, ...cur.versions].slice(0, 20)
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true })
      fs.writeFileSync(this.file + '.tmp', JSON.stringify({ snapshot: snapshotOf(chunks), versions }))
      fs.renameSync(this.file + '.tmp', this.file)
    } catch (e) {
      console.error('ask versions:', e?.message ?? e)
    }
    return version
  }
}
