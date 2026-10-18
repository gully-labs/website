// Gully Ask retrieval: a dependency-free BM25 index over text chunks.
//
// A chunk is { id, source, title, url, section, text, updatedAt }. The local part of the corpus (docs,
// site copy, changelog) is built by scripts/build-ask-index.mjs into server/data/ask-index.json; the
// remote part (GitHub READMEs, DeepCore docs, the blog) is refreshed at runtime by ask-remote.mjs.
// Both are merged into one in-memory index (makeIndex) whenever either changes.
//
// The tokenizer and chunker live here so the build script and the runtime use exactly the same rules.

import crypto from 'node:crypto'

/* ----------------------------------------------------------- tokenizer --- */

const STOP = new Set(
  `a about above after again against all am an and any are as at be because been before being below between both but by
  can could did do does doing down during each few for from further had has have having he her here hers him his how i if
  in into is it its itself just me more most my no nor not of off on once only or other our ours out over own same she
  should so some such than that the their theirs them then there these they this those through to too under until up very
  was we were what when where which while who whom why will with would you your yours i'm it's can't don't does doesn't
  get got also may might must shall us via per yes ok please tell explain know want need`.split(/\s+/),
)

/** Lowercase, ASCII-folded, apostrophes dropped. */
export const fold = (s) =>
  String(s ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/['’‘`]/g, '')
    .toLowerCase()

/** Very light stemming: plurals, -ing, -ed, a trailing e. The same rule on both sides is all BM25 needs. */
export function stem(w) {
  if (/^\d/.test(w) || w.length <= 3) return w
  if (w.endsWith('ies') && w.length > 4) w = w.slice(0, -3) + 'y'
  else if (w.endsWith('sses')) w = w.slice(0, -2)
  else if (w.endsWith('s') && !/(ss|us|is)$/.test(w)) w = w.slice(0, -1)
  if (w.endsWith('ing') && w.length > 5) w = w.slice(0, -3)
  else if (w.endsWith('ed') && w.length > 4) w = w.slice(0, -2)
  if (w.endsWith('e') && w.length > 4) w = w.slice(0, -1)
  return w
}

/** Text to search terms: folded, split on anything not a letter or digit, stopwords out, stemmed. */
export function tokenize(s) {
  const out = []
  for (const raw of fold(s).split(/[^a-z0-9]+/)) {
    if (!raw || raw.length < 2 || raw.length > 40 || STOP.has(raw)) continue
    out.push(stem(raw))
  }
  return out
}

/* ------------------------------------------------------------- chunking --- */

const words = (s) => String(s).split(/\s+/).filter(Boolean)
export const CHUNK_MIN = 120
export const CHUNK_MAX = 250
const OVERLAP = 30

/** Collapses whitespace and strips control characters. */
export const clean = (s) =>
  String(s ?? '')
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

export const chunkId = (...parts) => crypto.createHash('sha1').update(parts.join('|')).digest('hex').slice(0, 12)

/**
 * Splits one section's paragraphs into chunks of about CHUNK_MIN–CHUNK_MAX words, with a short overlap
 * between consecutive chunks of the same section. Paragraph boundaries are kept where they can be.
 */
export function chunkSection({ source, title, url, section, paragraphs, updatedAt = null }) {
  const paras = []
  for (const p of paragraphs.map(clean).filter(Boolean)) {
    const w = words(p)
    if (w.length <= CHUNK_MAX) paras.push(w)
    else for (let i = 0; i < w.length; i += 200) paras.push(w.slice(i, i + 200))
  }
  const texts = []
  let carry = [] // the overlap from the previous chunk
  let cur = [] // new words since then
  for (const w of paras) {
    if (cur.length && carry.length + cur.length + w.length > CHUNK_MAX) {
      texts.push(carry.concat(cur))
      carry = cur.slice(-OVERLAP)
      cur = []
    }
    if (carry.length + w.length > CHUNK_MAX) carry = carry.slice(Math.min(carry.length, carry.length + w.length - CHUNK_MAX))
    cur = cur.concat(w)
  }
  if (cur.length) {
    // A short tail folds into the chunk before it rather than standing alone.
    if (texts.length && cur.length < 60 && texts.at(-1).length + cur.length <= CHUNK_MAX + 60) texts[texts.length - 1] = texts.at(-1).concat(cur)
    else texts.push(carry.concat(cur))
  }
  return texts.map((t, i) => ({ id: chunkId(source, url, section ?? '', i), source, title, url, section: section ?? null, text: t.join(' '), updatedAt }))
}

/* ----------------------------------------------------------------- BM25 --- */

const K1 = 1.2
const B = 0.75

/** Builds an in-memory BM25 index over chunks. Title and section count twice. */
export function makeIndex(chunks) {
  const docs = chunks.map((c) => {
    const head = tokenize(`${c.title ?? ''} ${c.section ?? ''}`)
    const toks = tokenize(c.text).concat(head, head)
    const tf = new Map()
    for (const t of toks) tf.set(t, (tf.get(t) ?? 0) + 1)
    return { chunk: c, tf, len: toks.length }
  })
  const df = new Map()
  for (const d of docs) for (const t of d.tf.keys()) df.set(t, (df.get(t) ?? 0) + 1)
  const avg = docs.reduce((a, d) => a + d.len, 0) / Math.max(1, docs.length)
  const N = docs.length

  /** Top `k` chunks for a query, each with its score; at most `perUrl` from one page (Infinity: no cap). */
  function search(query, { k = 6, perUrl = 2, sources = null } = {}) {
    const q = [...new Set(tokenize(query))]
    if (!q.length) return []
    const scored = []
    for (const d of docs) {
      if (sources && !sources.includes(d.chunk.source)) continue
      let s = 0
      for (const t of q) {
        const f = d.tf.get(t)
        if (!f) continue
        const n = df.get(t)
        const idf = Math.log(1 + (N - n + 0.5) / (n + 0.5))
        s += idf * ((f * (K1 + 1)) / (f + K1 * (1 - B + (B * d.len) / avg)))
      }
      if (s > 0) scored.push({ chunk: d.chunk, score: s })
    }
    scored.sort((a, b) => b.score - a.score || a.chunk.id.localeCompare(b.chunk.id))
    const seen = new Map()
    const out = []
    for (const r of scored) {
      const page = r.chunk.url.split('#')[0]
      const n = seen.get(page) ?? 0
      if (n >= perUrl) continue
      seen.set(page, n + 1)
      out.push(r)
      if (out.length >= k) break
    }
    return out
  }

  return { search, size: N, terms: df.size, chunks: docs.map((d) => d.chunk) }
}

/* --------------------------------------------------------- hybrid search --- */
//
// Hybrid retrieval (ask.mjs retrieve()): several ranked candidate lists (BM25 on the question, BM25 on a
// synonym-expanded question, and nearest neighbours by embedding when ask-embed.mjs has vectors) are fused
// with reciprocal-rank fusion, then the top ~20 are re-ranked here by how much of the question each chunk
// covers. Every step is deterministic and dependency-free; with no embeddings it is BM25 + expansion only.

/**
 * Plain-language words people ask with, mapped to the words the docs use. Only adds terms; the original
 * question is always searched as typed too.
 */
const SYNONYMS = {
  charge: 'fee fees price pricing cost plan',
  charges: 'fee fees price pricing cost plan',
  cost: 'price pricing fee plan',
  costs: 'price pricing fee plan',
  expensive: 'price pricing fee',
  cheap: 'price pricing fee free',
  pay: 'payment checkout chains assets',
  paying: 'payment checkout chains assets',
  money: 'payment fee price',
  track: 'analytics cookie privacy collect',
  tracking: 'analytics cookie privacy collect',
  spy: 'analytics privacy collect',
  privacy: 'privacy personal data collect retention cookie',
  data: 'collect retention',
  delete: 'retention erase deletion',
  store: 'merchant checkout',
  shop: 'merchant store checkout',
  paused: 'pause statement overdue unpaid',
  pause: 'paused statement overdue unpaid',
  frozen: 'pause paused statement overdue',
  l3: 'roadmap rollup orbit chain settlement hyperlane',
  rollup: 'l3 roadmap orbit',
  roadmap: 'l3 rollup plan',
  bot: 'telegram chat command',
  telegram: 'bot chat alerts',
  notify: 'alert alerts webhook telegram',
  notification: 'alert alerts webhook telegram',
  holders: 'holder map distribution wallets',
  whales: 'holder holders map',
  chains: 'chain network base ethereum arbitrum bnb',
  network: 'chain chains',
  key: 'api key keys',
  limit: 'rate limit requests plan',
  limits: 'rate limit requests plan',
  usage: 'requests calls rate limit',
  audit: 'audits security review',
  safe: 'audit security custody',
  custody: 'non-custodial wallet funds',
  refund: 'refunds payment',
}

/** The question plus the docs' words for the plain words in it, or null when nothing is added. */
export function expandQuery(q) {
  const add = []
  for (const w of fold(q).split(/[^a-z0-9]+/)) if (SYNONYMS[w]) add.push(SYNONYMS[w])
  return add.length ? `${q} ${add.join(' ')}` : null
}

export const RRF_K = 60

/**
 * Reciprocal-rank fusion: each list is [{ chunk, ... }] best first; a chunk scores the sum of
 * weight / (RRF_K + rank) over the lists it appears in. Returns [{ chunk, score, ranks }] best first,
 * ties broken by chunk id so the order is stable.
 */
export function rrf(lists, { k = RRF_K } = {}) {
  const m = new Map()
  for (const { name, items, weight = 1 } of lists) {
    items.forEach((r, i) => {
      const e = m.get(r.chunk.id) ?? { chunk: r.chunk, score: 0, ranks: {} }
      e.score += weight / (k + i + 1)
      e.ranks[name] = i + 1
      m.set(r.chunk.id, e)
    })
  }
  return [...m.values()].sort((a, b) => b.score - a.score || a.chunk.id.localeCompare(b.chunk.id))
}

/** A small prior by source: the docs and the legal pages are the reference; UI copy and notes rank a little lower. */
const SOURCE_PRIOR = { Docs: 0.06, Legal: 0.05, Site: 0.03, Changelog: 0, Roadmap: 0, Blog: 0, GitHub: 0, 'DeepCore docs': 0.02, 'Gully Pay contracts': -0.03, 'Telegram bot': -0.05, 'Telegram Mini App': -0.08 }

/**
 * Re-ranks fused candidates by question coverage: the share of the question's distinct terms found in the
 * chunk (title and section included), with a bonus when they appear in its title or section, and a small
 * prior by source (SOURCE_PRIOR). The fused rank still dominates (coverage only moves a chunk past near
 * neighbours). Stable for equal scores.
 */
export function rerank(query, fused) {
  const q = [...new Set(tokenize(query))]
  if (!q.length || !fused.length) return fused
  const top = fused[0].score || 1
  return fused
    .map((r) => {
      const body = new Set(tokenize(r.chunk.text))
      const head = new Set(tokenize(`${r.chunk.title ?? ''} ${r.chunk.section ?? ''}`))
      const covered = q.filter((t) => body.has(t) || head.has(t)).length / q.length
      const inHead = q.filter((t) => head.has(t)).length / q.length
      return { ...r, fused: r.score, score: r.score / top + 0.35 * covered + 0.15 * inHead + (SOURCE_PRIOR[r.chunk.source] ?? 0) }
    })
    .sort((a, b) => b.score - a.score || a.chunk.id.localeCompare(b.chunk.id))
}

/** At most `perUrl` chunks of one page, the first `k`. */
export function capPerPage(results, { k = 6, perUrl = 2 } = {}) {
  const seen = new Map()
  const out = []
  for (const r of results) {
    const page = r.chunk.url.split('#')[0]
    const n = seen.get(page) ?? 0
    if (n >= perUrl) continue
    seen.set(page, n + 1)
    out.push(r)
    if (out.length >= k) break
  }
  return out
}

/** Cosine similarity of two equal-length numeric vectors (0 when either is empty). */
export function cosine(a, b) {
  let dot = 0
  let na = 0
  let nb = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    na += a[i] * a[i]
    nb += b[i] * b[i]
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0
}

/* ------------------------------------------------------- markdown → text --- */

/**
 * Markdown (a README) to sections of plain paragraphs: HTML, badges, images and code blocks out,
 * links reduced to their text, tables to "a — b" lines. Headings start sections.
 */
export function markdownSections(md, { maxWords = 2_500 } = {}) {
  let s = String(md ?? '').replace(/\r\n?/g, '\n')
  s = s.replace(/<!--[\s\S]*?-->/g, '')
  s = s.replace(/```[\s\S]*?```/g, '\n').replace(/~~~[\s\S]*?~~~/g, '\n')
  s = s.replace(/\[!\[[^\]]*\]\([^)]*\)\]\([^)]*\)/g, '') // linked badges
  s = s.replace(/!\[[^\]]*\]\([^)]*\)/g, '') // images
  s = s.replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
  s = s.replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|h\d|li|tr|table)>/gi, '\n')
  s = s.replace(/<h([1-6])[^>]*>/gi, (_, n) => '\n' + '#'.repeat(Number(n)) + ' ')
  s = s.replace(/<[^>]+>/g, '')
  s = s.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
  s = s.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/\[([^\]]+)\]\[[^\]]*\]/g, '$1')
  s = s.replace(/^\s*\[[^\]]+\]:\s*\S+.*$/gm, '') // reference definitions
  const sections = []
  let cur = { heading: null, paras: [] }
  let para = []
  let total = 0
  const flush = () => {
    const t = clean(para.join(' ').replace(/`/g, '').replace(/\*\*|__/g, '').replace(/(^|\s)[*_]([^*_]+)[*_](?=\s|$|[.,;:])/g, '$1$2'))
    para = []
    if (!t || /^[-=_*|:\s]+$/.test(t)) return
    total += words(t).length
    if (total <= maxWords) cur.paras.push(t)
  }
  for (const line of s.split('\n')) {
    const h = line.match(/^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/)
    if (h) {
      flush()
      if (cur.paras.length || cur.heading) sections.push(cur)
      cur = { heading: clean(h[2].replace(/[`*_]/g, '')), paras: [] }
      continue
    }
    if (/^\s*\|/.test(line)) {
      flush()
      if (/^\s*\|?[\s:|-]+\|?\s*$/.test(line)) continue
      para.push(line.split('|').map((c) => c.trim()).filter(Boolean).join(' — '))
      flush()
      continue
    }
    if (/^\s*$/.test(line) || /^\s*([-*+]|\d+[.)])\s+/.test(line) || /^\s*(---|\*\*\*|___)\s*$/.test(line)) flush()
    if (/^\s*(---|\*\*\*|___)\s*$/.test(line)) continue
    para.push(line.replace(/^\s*([-*+]|\d+[.)]|>)\s*/, ''))
  }
  flush()
  if (cur.paras.length) sections.push(cur)
  return sections.filter((x) => x.paras.length)
}

/** GitHub's heading anchor for a heading text. */
export const githubAnchor = (h) =>
  String(h)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .trim()
    .replace(/\s/g, '-')
