// Blog share images: GET /og/blog/<slug>.png (server/og.mjs).
//
//   npm run test:og        (no build needed)
//
// The real server runs IN THIS PROCESS on port 8799 (TEST_PORT overrides) with a fresh temporary DATA_DIR,
// and a stub Ghost Content API on a random local port answers the post reads (no network). Checks: a
// 1200 x 630 PNG with a valid signature and the right headers; the same slug gives the same bytes even
// after the caches are emptied; different posts give different images; unknown and malformed slugs are
// 404; the second request is a disk-cache hit and Ghost is asked once; ETag/304 and HEAD; an emoji and an
// over-long title wrap within the width and end in an ellipsis; the disk cache stays within its bounds;
// a missing content key is 503. `--out <dir>` also writes the rendered samples there.

import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { guardTestRun, makeChecker } from './test-helpers.mjs'

const PORT = Number(process.env.TEST_PORT) || 8799
const BASE = `http://localhost:${PORT}`
const outIdx = process.argv.indexOf('--out')
const OUT = outIdx > 0 ? process.argv[outIdx + 1] : null
await guardTestRun(PORT)

const LONG = '🚀 Shipping Gully Pay: invoices, pay links, merchant stores, webhooks, refunds, subscriptions, receipts, settlement on four chains, and a title far too long for any share card to hold 🎉'
const POSTS = {
  'hello-world': { title: 'Hello world: the Gully Labs blog is live', tag: ['news', 'News'] },
  'gap-tracker': { title: 'Reading stock token gaps on BNB Chain', tag: ['tracker', 'Tracker'] },
  'emoji-long': { title: LONG, tag: ['pay', 'Payments'] },
  'no-tag': { title: 'A post with no tag', tag: null },
  'c1': { title: 'Cache one', tag: ['dev', 'Developers'] },
  'c2': { title: 'Cache two', tag: ['dev', 'Developers'] },
  'c3': { title: 'Cache three', tag: ['dev', 'Developers'] },
  'c4': { title: 'Cache four', tag: ['dev', 'Developers'] },
}
const KEY = 'test-content-key-0123456789'
const ghostCalls = []
const ghost = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x')
  ghostCalls.push({ path: u.pathname, host: req.headers.host })
  const m = u.pathname.match(/^\/ghost\/api\/content\/posts\/slug\/([^/]+)\/$/)
  if (u.searchParams.get('key') !== KEY) return res.writeHead(401).end('{"errors":[{"message":"bad key"}]}')
  const p = m && POSTS[decodeURIComponent(m[1])]
  if (!p) return res.writeHead(404, { 'Content-Type': 'application/json' }).end('{"errors":[{"type":"NotFoundError"}]}')
  const tag = p.tag ? { id: 't', slug: p.tag[0], name: p.tag[1] } : null
  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ posts: [{ id: 'p', slug: m[1], title: p.title, updated_at: p.updated_at ?? '2026-10-17T10:00:00.000Z', tags: tag ? [tag] : [], primary_tag: tag }] }))
})
await new Promise((r) => ghost.listen(0, '127.0.0.1', r))

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gully-og-'))
const dist = path.join(tmp, 'dist')
fs.mkdirSync(dist, { recursive: true })
fs.writeFileSync(path.join(dist, 'index.html'), '<!doctype html><html><head><title>Gully Labs</title></head><body></body></html>')
Object.assign(process.env, {
  PORT: String(PORT),
  DATA_DIR: tmp,
  TRACKER_DATA: path.join(tmp, 'tracker-history.json'),
  DIST_DIR: dist,
  TRACKER_LOOP: 'off',
  TRACKER_SKIP_APIS: '1',
  DEEPCORE_LOOP: 'off',
  ASK_REMOTE: 'off',
  GHOST_CONTENT_KEY: KEY,
  OG_GHOST_URL: `http://127.0.0.1:${ghost.address().port}`,
  OG_CACHE_MAX_FILES: '5',
})
delete process.env.TELEGRAM_BOT_TOKEN
delete process.env.GULLY_TREASURY_ADDRESS
delete process.env.ANTHROPIC_API_KEY

await import('../server/server.mjs')
const og = await import('../server/og.mjs')
await new Promise((r) => setTimeout(r, 300))

const t = makeChecker()
const { check } = t
const CACHE = path.join(tmp, 'og-cache')

async function get(p, { method = 'GET', headers = {} } = {}) {
  const r = await fetch(BASE + p, { method, headers: { host: 'gullylabs.xyz', ...headers } })
  return { status: r.status, headers: r.headers, body: Buffer.from(await r.arrayBuffer()) }
}
const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const pngSize = (b) => ({ w: b.readUInt32BE(16), h: b.readUInt32BE(20) })
const save = (name, b) => OUT && fs.writeFileSync(path.join(OUT, name), b)

try {
  // A first render: PNG signature, IHDR 1200 x 630, headers.
  const a = await get('/og/blog/hello-world.png')
  check('hello-world: 200', a.status === 200, a.status)
  check('hello-world: PNG signature', a.body.subarray(0, 8).equals(PNG_SIG))
  check('hello-world: IHDR chunk first', a.body.toString('latin1', 12, 16) === 'IHDR')
  const sz = pngSize(a.body)
  check('hello-world: 1200 x 630', sz.w === 1200 && sz.h === 630, JSON.stringify(sz))
  check('content-type image/png', a.headers.get('content-type') === 'image/png')
  check('cache-control public, max-age=86400', a.headers.get('cache-control') === 'public, max-age=86400', a.headers.get('cache-control'))
  check('first request is a cache miss', a.headers.get('x-og-cache') === 'miss')
  check('an image, not a blank: > 20 kB', a.body.length > 20_000, a.body.length)
  check('Ghost asked with the blog host', ghostCalls.at(-1)?.host === 'blog.gullylabs.xyz', ghostCalls.at(-1)?.host)
  save('hello-world.png', a.body)

  // Second request: disk-cache hit, same bytes, Ghost not asked again (post data cached in memory).
  const calls = ghostCalls.length
  const b = await get('/og/blog/hello-world.png')
  check('second request: 200', b.status === 200)
  check('second request: disk cache hit', b.headers.get('x-og-cache') === 'hit', b.headers.get('x-og-cache'))
  check('second request: same bytes', b.body.equals(a.body))
  check('second request: Ghost not asked again', ghostCalls.length === calls, ghostCalls.length - calls)
  check('cache file on disk', fs.readdirSync(CACHE).some((f) => f.startsWith('hello-world.') && f.endsWith('.png')))

  // Deterministic: empty both caches, render again, same bytes.
  fs.rmSync(CACHE, { recursive: true, force: true })
  og.resetOgMemory()
  const c = await get('/og/blog/hello-world.png')
  check('after clearing caches: a miss', c.headers.get('x-og-cache') === 'miss')
  check('same slug, same bytes (fresh render)', c.body.equals(a.body))
  const direct = await og.renderOgPng({ slug: 'hello-world', title: POSTS['hello-world'].title, primary_tag: { slug: 'news', name: 'News' } })
  check('renderOgPng directly: same bytes', direct.equals(a.body))

  // ETag / 304 and HEAD.
  const etag = c.headers.get('etag')
  check('ETag set', /^"[0-9a-f]{20}"$/.test(etag ?? ''), etag)
  const nm = await get('/og/blog/hello-world.png', { headers: { 'if-none-match': etag } })
  check('If-None-Match: 304', nm.status === 304 && nm.body.length === 0, nm.status)
  const head = await get('/og/blog/hello-world.png', { method: 'HEAD' })
  check('HEAD: 200 with no body', head.status === 200 && head.body.length === 0 && head.headers.get('content-type') === 'image/png')
  const post = await fetch(BASE + '/og/blog/hello-world.png', { method: 'POST', headers: { host: 'gullylabs.xyz' } })
  check('POST: 405', post.status === 405, post.status)

  // Different posts, different images.
  const g = await get('/og/blog/gap-tracker.png')
  check('another post: 200 PNG', g.status === 200 && g.body.subarray(0, 8).equals(PNG_SIG))
  check('another post: different bytes', !g.body.equals(a.body))
  save('gap-tracker.png', g.body)
  const nt = await get('/og/blog/no-tag.png')
  check('post without a tag: 200 PNG', nt.status === 200 && pngSize(nt.body).w === 1200)

  // Unknown and malformed slugs.
  const u = await get('/og/blog/no-such-post.png')
  check('unknown slug: 404', u.status === 404, u.status)
  const u2 = await get('/og/blog/no-such-post.png')
  check('unknown slug again: 404 (remembered)', u2.status === 404)
  for (const bad of ['/og/blog/..%2Fetc%2Fpasswd.png', '/og/blog/UPPER.png', '/og/blog/a_b.png', '/og/blog/hello-world.jpg', '/og/blog/x/y.png', `/og/blog/${'a'.repeat(200)}.png`]) {
    const r = await get(bad)
    check(`malformed ${bad.slice(0, 40)}: 404`, r.status === 404, r.status)
  }

  // Emoji and long text: wraps within the width, at most 3 lines, ends in an ellipsis, no emoji drawn.
  const e = await get('/og/blog/emoji-long.png')
  check('emoji + long title: 200 PNG 1200 x 630', e.status === 200 && pngSize(e.body).w === 1200 && pngSize(e.body).h === 630)
  save('emoji-long.png', e.body)
  const lay = og.titleLayout(LONG)
  const ctx = new og.SvgContext(1200, 630, og.loadFonts())
  ctx.font = `800 ${lay.size}px "Barlow Condensed"`
  check('long title: wraps to several lines', lay.lines.length > 1 && lay.lines.length <= 3, lay.lines.length)
  check('long title: every line fits the width', lay.lines.every((l) => ctx.measureText(l).width <= lay.maxWidth + 0.01))
  check('long title: smaller type than a short one', lay.size < og.titleLayout('Short').size, lay.size)
  check('long title: last line ends in an ellipsis', lay.lines.at(-1).endsWith('…'), lay.lines.at(-1))
  check('long title: no emoji in the set lines', !lay.lines.join(' ').match(/\p{Extended_Pictographic}/u))
  check('long title: words kept in order', lay.lines.join(' ').startsWith('SHIPPING GULLY PAY:'), lay.lines[0])
  const svg = og.renderOgSvg({ slug: 'emoji-long', title: LONG, primary_tag: { slug: 'pay', name: 'Payments' } })
  check('SVG has no emoji', !/\p{Extended_Pictographic}/u.test(svg))
  const one = og.titleLayout('Supercalifragilisticexpialidociousandthensomemoretomakeitwidertoo')
  const ctx2 = new og.SvgContext(1200, 630, og.loadFonts())
  ctx2.font = `800 ${one.size}px "Barlow Condensed"`
  check('one over-long word: broken across lines', one.lines.length > 1 && one.lines.every((l) => ctx2.measureText(l).width <= one.maxWidth + 0.01), JSON.stringify(one.lines))
  check('short title: one line at the largest size', og.titleLayout('Gully Chains devnet').lines.length === 1 && og.titleLayout('Gully Chains devnet').size === 88)

  // The disk cache stays bounded (OG_CACHE_MAX_FILES=5 here).
  for (const s of ['c1', 'c2', 'c3', 'c4']) await get(`/og/blog/${s}.png`)
  const files = fs.readdirSync(CACHE).filter((f) => f.endsWith('.png'))
  check('disk cache bounded to 5 files', files.length <= 5, files.length)
  check('most recent image kept', files.some((f) => f.startsWith('c4.')))
  check('no temp files left', !fs.readdirSync(CACHE).some((f) => f.endsWith('.tmp')))

  // An edited post (new updated_at) re-renders and replaces its old file.
  POSTS['c4'].title = 'Cache four, edited'
  POSTS['c4'].updated_at = '2026-10-18T10:00:00.000Z'
  og.resetOgMemory()
  const ed = await get('/og/blog/c4.png')
  check('edited post: a miss', ed.headers.get('x-og-cache') === 'miss')
  check('edited post: one file for the slug', fs.readdirSync(CACHE).filter((f) => f.startsWith('c4.')).length === 1)

  // Without the content key: 503, not cached.
  og.resetOgMemory()
  delete process.env.GHOST_CONTENT_KEY
  const nk = await get('/og/blog/hello-world.png')
  check('no GHOST_CONTENT_KEY: 503', nk.status === 503, nk.status)
  check('503 not cacheable', nk.headers.get('cache-control') === 'no-store')
} catch (err) {
  console.error(err)
  t.failed++
} finally {
  ghost.close()
  fs.rmSync(tmp, { recursive: true, force: true })
}

console.log(`\n${t.passed} passed, ${t.failed} failed`)
process.exit(t.failed ? 1 : 0)
