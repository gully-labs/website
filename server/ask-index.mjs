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

  /** Top `k` chunks for a query, each with its score; at most `perUrl` from one page. */
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

  return { search, size: N, terms: df.size }
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
