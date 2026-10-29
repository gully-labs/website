// Gully Ask: the remote part of the corpus, refreshed at runtime every 6 hours into DATA_DIR/ask-remote.json.
//
//   - README of each public gully-labs repo (raw.githubusercontent.com), HTML and badges stripped;
//   - the Ghost blog, only when GHOST_CONTENT_KEY is set (Content API, published posts).
//
// Each source is fetched on its own. A source that fails keeps its last good copy; the file is only
// rewritten with whatever is good. Nothing here is required: with no file and no network, Ask answers
// from the local index alone.

import fs from 'node:fs'
import path from 'node:path'
import { DATA_DIR } from './http.mjs'
import { chunkSection, clean, githubAnchor, markdownSections } from './ask-index.mjs'

export const REMOTE_FILE = () => path.join(process.env.DATA_DIR ?? DATA_DIR, 'ask-remote.json')
export const REFRESH_MS = 6 * 3_600_000
const TIMEOUT_MS = 20_000
const MAX_BYTES = 2_000_000
const UA = 'gullylabs-ask/1 (+https://gullylabs.xyz/ask)'

const GH = 'gully-labs'
const REPOS = [
  { repo: 'sdk', branch: 'main' },
  { repo: 'umami', branch: 'gully/analytics' },
  ...['arbitrum-orbit-deployment-ui', 'orbit-setup-script', 'orbit-monitoring-tools', 'arbitrum-token-bridge', 'arbitrum-token-lists', 'stylus-sdk-rs', 'stylus-hello-world'].map((repo) => ({ repo, branch: 'gully/main' })),
  { repo: '.github', branch: 'main', file: 'profile/README.md', title: 'Gully Labs on GitHub' },
]

/** The list of remote sources: { key, label, fetch(fetchImpl) -> chunks }. */
export function remoteSources() {
  const list = REPOS.map((r) => ({
    key: `github:${r.repo}`,
    label: 'GitHub',
    async load(f) {
      const file = r.file ?? 'README.md'
      const raw = `https://raw.githubusercontent.com/${GH}/${r.repo}/refs/heads/${r.branch}/${file}`
      const md = await getText(f, raw)
      const page = `https://github.com/${GH}/${r.repo}/blob/${r.branch}/${file}`
      const title = r.title ?? `${GH}/${r.repo} README`
      const secs = markdownSections(md)
      if (!secs.length) throw new Error('empty README')
      return secs.flatMap((s) => chunkSection({ source: 'GitHub', title, url: s.heading ? `${page}#${githubAnchor(s.heading)}` : page, section: s.heading, paragraphs: s.paras }))
    },
  }))
  const key = String(process.env.GHOST_CONTENT_KEY ?? '').trim()
  if (/^[a-f0-9]{16,64}$/i.test(key)) {
    list.push({
      key: 'blog',
      label: 'Blog',
      async load(f) {
        const api = `https://blog.gullylabs.xyz/ghost/api/content/posts/?key=${encodeURIComponent(key)}&limit=all&fields=title,url,plaintext,updated_at`
        const doc = JSON.parse(await getText(f, api))
        const out = []
        for (const p of Array.isArray(doc?.posts) ? doc.posts : []) {
          if (typeof p?.url !== 'string' || !p.url.startsWith('https://blog.gullylabs.xyz/')) continue
          out.push(...chunkSection({ source: 'Blog', title: clean(p.title).slice(0, 160), url: p.url, section: null, paragraphs: String(p.plaintext ?? '').split(/\n{2,}/), updatedAt: p.updated_at ?? null }))
        }
        return out
      },
    })
  }
  return list
}

async function getText(f, url) {
  const r = await f(url, { headers: { 'user-agent': UA, accept: '*/*' }, redirect: 'follow', signal: AbortSignal.timeout(TIMEOUT_MS) })
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  const text = await r.text()
  if (text.length > MAX_BYTES) throw new Error('too large')
  return text
}

/** The stored remote corpus: { updatedAt, sources: { [key]: { label, ok, at, lastGoodAt, error, chunks } } }. */
export function readRemote() {
  try {
    const d = JSON.parse(fs.readFileSync(REMOTE_FILE(), 'utf8'))
    if (d && typeof d.sources === 'object') return d
  } catch {
    /* none yet */
  }
  return { updatedAt: null, sources: {} }
}

/** All chunks of the stored remote corpus, from the sources still configured: a stored copy of a source that was
    removed (a third-party docs corpus dropped on 2026-10-29) is never served, even before the next refresh drops it. */
export function remoteChunks(doc = readRemote()) {
  const keys = new Set(remoteSources().map((s) => s.key))
  return Object.entries(doc.sources).flatMap(([k, s]) => (keys.has(k) && Array.isArray(s.chunks) ? s.chunks : []))
}

/**
 * Fetches every remote source once. A source that fails keeps its last good chunks and records the
 * error. `fetchImpl` is for tests. Returns the new document.
 */
export async function refreshRemote({ fetchImpl = fetch, sources = remoteSources() } = {}) {
  const prev = readRemote()
  const now = new Date().toISOString()
  const next = { updatedAt: now, sources: { ...prev.sources } }
  await Promise.all(
    sources.map(async (s) => {
      const old = prev.sources[s.key]
      try {
        const chunks = (await s.load(fetchImpl)).map((c) => ({ ...c, updatedAt: c.updatedAt ?? now }))
        if (!chunks.length) throw new Error('no text')
        next.sources[s.key] = { label: s.label, ok: true, at: now, lastGoodAt: now, error: null, chunks }
      } catch (e) {
        next.sources[s.key] = { label: s.label, ok: false, at: now, lastGoodAt: old?.lastGoodAt ?? null, error: String(e?.message ?? e).slice(0, 200), chunks: old?.chunks ?? [] }
      }
    }),
  )
  // A source that is no longer configured (the blog without its key) is dropped.
  for (const k of Object.keys(next.sources)) if (!sources.some((s) => s.key === k)) delete next.sources[k]
  try {
    fs.mkdirSync(path.dirname(REMOTE_FILE()), { recursive: true })
    fs.writeFileSync(REMOTE_FILE() + '.tmp', JSON.stringify(next))
    fs.renameSync(REMOTE_FILE() + '.tmp', REMOTE_FILE())
  } catch (e) {
    console.error('ask remote save:', e?.message ?? e)
  }
  return next
}

let timer = null
/** Refreshes now if the stored copy is older than REFRESH_MS, then every REFRESH_MS. `onChange` gets the new doc. */
export function startRemoteLoop(onChange) {
  if (timer) return
  const tick = () =>
    refreshRemote().then(
      (doc) => {
        const bad = Object.entries(doc.sources).filter(([, s]) => !s.ok)
        if (bad.length) console.error(`ask remote: ${bad.length} source(s) failed, kept their last copy: ${bad.map(([k, s]) => `${k} (${s.error})`).join(', ')}`)
        onChange?.(doc)
      },
      (e) => console.error('ask remote:', e?.message ?? e),
    )
  const age = Date.now() - (Date.parse(readRemote().updatedAt ?? '') || 0)
  timer = setTimeout(
    () => {
      tick()
      timer = setInterval(tick, REFRESH_MS)
      timer.unref?.()
    },
    age >= REFRESH_MS ? 15_000 : REFRESH_MS - age,
  )
  timer.unref?.()
}
