// Token logo service (server/token-logos.mjs). Every upstream is stubbed: DNS answers from a table and a
// stub transport answers each URL, so nothing leaves the machine. Run: npm run test:token-logos
import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { test } from 'node:test'
import { PNG } from 'pngjs'
import { checkImage, checksum, createTokenLogos, fallbackPng, isPrivateAddress, sniffImage } from '../server/token-logos.mjs'

const require = createRequire(import.meta.url)
const { GIFEncoder, quantize, applyPalette } = require('gifenc')

/* ------------------------------------------------------------- fixtures --- */

function png(w, h, rgb = [217, 181, 99]) {
  const p = new PNG({ width: w, height: h })
  for (let i = 0; i < w * h; i++) p.data.set([...rgb, 255], i * 4)
  return PNG.sync.write(p)
}
function gif(w, h) {
  const d = new Uint8Array(w * h * 4)
  for (let i = 0; i < w * h; i++) d.set([47, 107, 53, 255], i * 4)
  const pal = quantize(d, 4)
  const g = GIFEncoder()
  g.writeFrame(applyPalette(d, pal), w, h, { palette: pal })
  g.finish()
  return Buffer.from(g.bytes())
}
const dims = (b) => ({ w: b.readUInt32BE(16), h: b.readUInt32BE(20) })
const pixel = (b, x, y) => {
  const p = PNG.sync.read(b)
  const i = (y * p.width + x) * 4
  return [...p.data.subarray(i, i + 4)]
}

const EP = { gullychain: 'https://gc.test/tokenlist-extended.json', dexscreener: 'https://ds.test', jupiter: 'https://jup.test', xstocks: 'https://xs.test', coingecko: 'https://cg.test', trustwallet: 'https://tw.test' }
const A = '0x1111111111111111111111111111111111111111' // a launch token with a logo on DexScreener
const B = '0x2222222222222222222222222222222222222222' // only DexScreener (and Trust Wallet)
const C = '0x3333333333333333333333333333333333333333' // only CoinGecko and Trust Wallet
const U = '0x4444444444444444444444444444444444444444' // known nowhere
const NV = '0xd0601ce157db5bdc3162bbac2a2c8af5320d9eec' // NVDA on Robinhood (tracker table)
const MINT = 'Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh'

/** A stubbed world: routes are 'https://host/path?query' -> () => { status, headers, body }. */
function world(routes = {}, { hosts = {} } = {}) {
  const calls = []
  const dnsCalls = []
  const transport = async (url, target) => {
    const key = url.href
    calls.push({ url: key, address: target.address })
    const h = routes[key]
    if (!h) return { status: 404, headers: { 'content-type': 'application/json' }, body: Buffer.from('{}') }
    const r = typeof h === 'function' ? await h() : h
    return { status: r.status ?? 200, headers: r.headers ?? {}, body: r.body ?? Buffer.alloc(0) }
  }
  const lookup = async (host) => {
    dnsCalls.push(host)
    return [{ address: hosts[host] ?? '93.184.216.34', family: 4 }]
  }
  return { transport, lookup, calls, dnsCalls }
}
const img = (b, type = 'image/png') => ({ status: 200, headers: { 'content-type': type, 'content-length': String(b.length) }, body: b })
const jsonr = (o) => ({ status: 200, headers: { 'content-type': 'application/json' }, body: Buffer.from(JSON.stringify(o)) })
const dsPair = (addr, imageUrl, { chainId = 'base', liq = 1000, base = true } = {}) => ({ chainId, baseToken: base ? { address: addr, symbol: 'TKN' } : { address: '0x9999999999999999999999999999999999999999', symbol: 'OTHER' }, quoteToken: base ? { address: '0x9999999999999999999999999999999999999999' } : { address: addr }, liquidity: { usd: liq }, info: { imageUrl } })

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'gully-logos-'))
function service(w, extra = {}) {
  let t = Date.parse('2026-10-18T12:00:00Z')
  const clock = { now: () => t, advance: (ms) => (t += ms) }
  const svc = createTokenLogos({ transport: w.transport, lookup: w.lookup, now: clock.now, dataDir: tmp(), endpoints: EP, log: () => {}, ...extra })
  return { svc, clock }
}

const goodRoutes = () => ({
  [`https://ds.test/tokens/v1/base/${A}`]: jsonr([dsPair(A, 'https://img.ds.test/a.png')]),
  'https://img.ds.test/a.png': img(png(100, 100, [10, 10, 200])),
  [`https://ds.test/tokens/v1/base/${B}`]: jsonr([dsPair(B, 'https://img.ds.test/quote-side.png', { base: false }), dsPair(B, 'https://img.ds.test/b.png', { liq: 5 })]),
  'https://img.ds.test/b.png': img(gif(40, 40), 'image/gif'),
  [`https://ds.test/tokens/v1/base/${C}`]: jsonr([]),
  [`https://ds.test/latest/dex/tokens/${C}`]: jsonr({ pairs: [] }),
  [`https://cg.test/api/v3/coins/base/contract/${C}`]: jsonr({ image: { large: 'https://img.cg.test/c.png' } }),
  'https://img.cg.test/c.png': img(png(250, 250, [47, 107, 53])),
  [`https://tw.test/trustwallet/assets/master/blockchains/base/assets/${checksum(B)}/logo.png`]: img(png(256, 256)),
  [`https://tw.test/trustwallet/assets/master/blockchains/base/assets/${checksum(C)}/logo.png`]: img(png(256, 256)),
})

/* ---------------------------------------------------------------- tests --- */

test('sources are tried in order and the first valid image wins', async () => {
  const w = world(goodRoutes())
  const { svc } = service(w)
  assert.deepEqual(svc.sources, ['gullychain', 'dexscreener', 'jupiter', 'xstocks', 'coingecko', 'trustwallet'])
  const a = await svc.getLogo('base', A, { size: 64 })
  assert.equal(a.source, 'dexscreener')
  assert.deepEqual(pixel(a.png, 32, 32), [10, 10, 200, 255])
  assert.ok(!w.calls.some((c) => c.url.startsWith('https://cg.test')), 'CoinGecko is not asked once DexScreener answered')
  const c = await svc.getLogo('base', C, { size: 64 })
  assert.equal(c.source, 'coingecko')
  const order = w.calls.filter((x) => !x.url.includes('img.')).map((x) => new URL(x.url).host)
  assert.deepEqual(order.slice(-3), ['ds.test', 'ds.test', 'cg.test'], 'C: DexScreener (both endpoints), then CoinGecko')
})

test('DexScreener: only pairs where the token is the base token; GIF decodes', async () => {
  const w = world(goodRoutes())
  const { svc } = service(w)
  const b = await svc.getLogo('base', B, { size: 128 })
  assert.equal(b.source, 'dexscreener')
  assert.ok(!w.calls.some((c) => c.url.includes('quote-side')), 'the quote-side pair image is never fetched')
  assert.deepEqual(dims(b.png), { w: 128, h: 128 })
  assert.deepEqual(pixel(b.png, 64, 64), [47, 107, 53, 255])
})

test('no launch platform’s own token list is read: only the listed public sources are asked', async () => {
  const w = world(goodRoutes())
  const { svc } = service(w)
  await svc.getLogo('base', A)
  await svc.getLogo('base', U)
  await svc.getLogo('ethereum', U)
  const hosts = new Set(w.calls.map((c) => new URL(c.url).host))
  assert.ok([...hosts].every((h) => ['ds.test', 'cg.test', 'tw.test', 'img.ds.test'].includes(h)), [...hosts].join())
  assert.ok(!w.calls.some((c) => c.url.includes('tokenlists')))
})

test('Gully Chain: hosted token list logoURI, cached 10 min, shape-checked, bundled copy as fallback', async () => {
  const G1 = '0x661B016D2Dc8E5e418C3B00A4098e341d8637ec1'
  const tok = (o) => ({ chainId: 485590, address: G1, name: 'Frog', symbol: 'FROG', decimals: 18, logoURI: 'https://img.gc.test/frog.png', ...o })
  const list = { tokens: [tok(), tok({ address: B, decimals: '18', logoURI: 'https://img.gc.test/bad.png' }), tok({ address: C, chainId: 8453, logoURI: 'https://img.gc.test/bad.png' })] }
  const w = world({ 'https://gc.test/tokenlist-extended.json': jsonr(list), 'https://img.gc.test/frog.png': img(png(64, 64, [47, 107, 53])) })
  const { svc, clock } = service(w, { gullyTokenList: { tokens: [] } })
  const g = await svc.getLogo('gully', G1.toLowerCase(), { size: 64 })
  assert.equal(g.source, 'gullychain')
  assert.deepEqual(pixel(g.png, 32, 32), [47, 107, 53, 255])
  assert.equal((await svc.getLogo('gully', B)).source, null, 'non-integer decimals: dropped')
  assert.equal((await svc.getLogo('gully', C)).source, null, 'another chain id: dropped')
  assert.ok(!w.calls.some((c) => c.url.includes('bad.png')))
  assert.equal(w.calls.filter((c) => c.url.startsWith('https://gc.test/')).length, 1, 'list cached across tokens')
  clock.advance(11 * 60_000)
  await svc.getLogo('gully', U)
  assert.equal(w.calls.filter((c) => c.url.startsWith('https://gc.test/')).length, 2, 're-read after 10 min')
  await svc.getLogo('base', U)
  assert.equal(w.calls.filter((c) => c.url.startsWith('https://gc.test/')).length, 2, 'other chains never ask it')

  // Hosted list down: the bundled copy answers.
  const w2 = world({ 'https://gc.test/tokenlist-extended.json': { status: 503 }, 'https://img.gc.test/frog.png': img(png(64, 64)) })
  const { svc: svc2 } = service(w2, { gullyTokenList: { tokens: [tok()] } })
  assert.equal((await svc2.getLogo('gully', G1)).source, 'gullychain')
})

test('Gully Chain: the bundled token list in server/data is valid', async () => {
  const { gullyListLogos } = await import('../server/token-logos.mjs')
  const list = JSON.parse(fs.readFileSync(new URL('../server/data/gully-tokenlist.json', import.meta.url), 'utf8'))
  const m = gullyListLogos(list, (u) => (typeof u === 'string' && u.startsWith('https://') ? u : null))
  assert.ok(m.has('0x26acccb2e98ca9e067e58668aa3b101bef432754'), 'WETH9')
  assert.ok(!m.has('0x3292de74305df64dbe082c6834fa841353eb2415'), 'the zero-supply bridge WETH is not listed')
})

test('Solana: Jupiter icon; xStocks: tracked stock gets the official Backed logo', async () => {
  const w = world({
    [`https://jup.test/tokens/v2/search?query=${MINT}`]: jsonr([{ id: MINT, icon: 'https://img.jup.test/n.png' }]),
    'https://img.jup.test/n.png': img(png(96, 96)),
    'https://xs.test/logos/tokens/NVDAx.png': img(png(512, 512, [118, 185, 0])),
  })
  const { svc } = service(w)
  assert.equal((await svc.getLogo('solana', MINT)).source, 'jupiter')
  const nv = await svc.getLogo('robinhood', NV)
  assert.equal(nv.source, 'xstocks')
  assert.deepEqual(pixel(nv.png, 10, 10), [118, 185, 0, 255])
})

test('SVG is refused even when served as image/png; the next source is used', async () => {
  const r = goodRoutes()
  r['https://img.cg.test/c.png'] = img(Buffer.from('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'), 'image/png')
  const { svc } = service(world(r))
  assert.equal((await svc.getLogo('base', C)).source, 'trustwallet')
  assert.throws(() => checkImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), 'image/svg+xml'), /svg/)
  assert.equal(sniffImage(Buffer.from('﻿  <svg>')), 'svg')
})

test('oversized images are refused (stated length and streamed bytes)', async () => {
  const big = Buffer.concat([png(64, 64), Buffer.alloc(2 * 1024 * 1024)])
  const r = goodRoutes()
  r['https://img.cg.test/c.png'] = img(big)
  r[`https://tw.test/trustwallet/assets/master/blockchains/base/assets/${checksum(C)}/logo.png`] = { status: 200, headers: { 'content-type': 'image/png' }, body: (async function* () { for (let i = 0; i < 40; i++) yield Buffer.alloc(64 * 1024) })() }
  const { svc } = service(world(r))
  const c = await svc.getLogo('base', C)
  assert.equal(c.source, null, 'both candidates refused, nothing else covers C')
  assert.equal(svc.logoCoverage().since.rejected['too-large'], 2)
  // Dimensions outside 16..4096 px are refused before decoding.
  assert.throws(() => checkImage(png(8, 8), 'image/png'), /bad-size/)
})

test('a non-image is refused despite an image content type', async () => {
  const r = goodRoutes()
  r['https://img.cg.test/c.png'] = img(Buffer.from('<html><body>not found</body></html>'), 'image/png')
  const { svc } = service(world(r))
  assert.equal((await svc.getLogo('base', C)).source, 'trustwallet')
  assert.equal(svc.logoCoverage().since.rejected['not-image'], 1)
  // A real image behind a non-image content type is refused too.
  assert.throws(() => checkImage(png(64, 64), 'text/html'), /not-image/)
})

test('SSRF guard: private addresses and redirects to them are blocked before connecting', async () => {
  for (const ip of ['10.0.0.5', '172.16.0.1', '192.168.1.1', '127.0.0.1', '169.254.169.254', '100.64.0.1', '::1', 'fd00::1', 'fe80::1', '::ffff:10.0.0.1']) assert.ok(isPrivateAddress(ip), ip)
  for (const ip of ['93.184.216.34', '1.1.1.1', '2606:4700::1111']) assert.ok(!isPrivateAddress(ip), ip)
  const r = goodRoutes()
  r['https://img.cg.test/c.png'] = { status: 302, headers: { location: 'https://metadata.internal.test/latest' } }
  r[`https://tw.test/trustwallet/assets/master/blockchains/base/assets/${checksum(C)}/logo.png`] = { status: 301, headers: { location: 'http://img.ds.test/plain.png' } }
  const w = world(r, { hosts: { 'metadata.internal.test': '169.254.169.254', 'evil.test': '10.0.0.5' } })
  const { svc } = service(w)
  assert.equal((await svc.getLogo('base', C)).source, null)
  assert.ok(!w.calls.some((c) => c.address === '169.254.169.254'), 'never connected to the private address')
  assert.ok(!w.calls.some((c) => c.url.startsWith('http:')), 'never followed a redirect to http')
  const s = svc.logoCoverage().since.rejected
  assert.equal(s.private, 1)
  assert.equal(s['not-https'], 1)
  await assert.rejects(svc.guardedGet('https://evil.test/x.png', { accept: '*/*', max: 100 }), /private/)
  await assert.rejects(svc.guardedGet('https://10.1.2.3/x.png', { accept: '*/*', max: 100 }), /private/)
  await assert.rejects(svc.guardedGet('https://localhost/x.png', { accept: '*/*', max: 100 }), /private/)
  await assert.rejects(svc.guardedGet('http://img.ds.test/x.png', { accept: '*/*', max: 100 }), /not-https/)
  // More than 3 redirects is refused.
  const loop = world({ 'https://r.test/0': { status: 302, headers: { location: '/1' } }, 'https://r.test/1': { status: 302, headers: { location: '/2' } }, 'https://r.test/2': { status: 302, headers: { location: '/3' } }, 'https://r.test/3': { status: 302, headers: { location: '/4' } }, 'https://r.test/4': img(png(32, 32)) })
  const { svc: s2 } = service(loop)
  await assert.rejects(s2.guardedGet('https://r.test/0', { accept: '*/*', max: 1e6 }), /redirects/)
  const ok3 = world({ 'https://r.test/0': { status: 302, headers: { location: '/1' } }, 'https://r.test/1': { status: 302, headers: { location: '/2' } }, 'https://r.test/2': { status: 302, headers: { location: '/3' } }, 'https://r.test/3': img(png(32, 32)) })
  const { svc: s3 } = service(ok3)
  assert.ok((await s3.guardedGet('https://r.test/0', { accept: '*/*', max: 1e6 })).body.length > 0, 'three redirects are fine')
})

test('every logo is re-encoded at 64, 128 and 256 px and cached on disk', async () => {
  const w = world(goodRoutes())
  const { svc } = service(w)
  const r = await svc.resolveTokenLogo('base', C)
  assert.equal(r.source, 'coingecko')
  for (const s of [64, 128, 256]) {
    assert.deepEqual(dims(r.sizes[s]), { w: s, h: s })
    assert.equal(sniffImage(r.sizes[s]), 'png')
    // Fresh PNG from resvg: no text / EXIF / ICC chunks from the source survive.
    assert.ok(!/tEXt|iTXt|zTXt|eXIf|iCCP/.test(r.sizes[s].toString('latin1')))
  }
  const before = w.calls.length
  await svc.getLogo('base', C, { size: 256 })
  assert.equal(w.calls.length, before, 'served from the disk cache')
})

test('negative cache: none found is kept for 24 h, then retried', async () => {
  const w = world(goodRoutes())
  const { svc, clock } = service(w)
  const r = await svc.getLogo('base', U)
  assert.equal(r.source, null)
  assert.deepEqual(r.png, await fallbackPng(64))
  const n = w.calls.length
  clock.advance(23 * 3600_000)
  await svc.getLogo('base', U)
  assert.equal(w.calls.length, n, 'no upstream call inside 24 h')
  clock.advance(2 * 3600_000)
  await svc.getLogo('base', U)
  assert.ok(w.calls.length > n, 'retried after 24 h')
  assert.equal(svc.logoCoverage().chains.base.fallback, 1)
})

test('positives are refreshed in the background after 7 days', async () => {
  const w = world(goodRoutes())
  const { svc, clock } = service(w)
  await svc.getLogo('base', C)
  const n = w.calls.length
  clock.advance(8 * 24 * 3600_000)
  const r = await svc.getLogo('base', C)
  assert.equal(r.cached, true, 'the old logo is served at once')
  await new Promise((res) => setTimeout(res, 50))
  assert.ok(w.calls.length > n, 'and re-resolved behind it')
})

test('concurrent requests for one token are coalesced', async () => {
  let hits = 0
  const r = goodRoutes()
  const slow = r[`https://cg.test/api/v3/coins/base/contract/${C}`]
  r[`https://cg.test/api/v3/coins/base/contract/${C}`] = async () => {
    hits++
    await new Promise((res) => setTimeout(res, 30))
    return slow
  }
  const { svc } = service(world(r))
  const all = await Promise.all(Array.from({ length: 8 }, (_, i) => svc.getLogo('base', C, { size: [64, 128, 256][i % 3] })))
  assert.equal(hits, 1)
  assert.ok(all.every((x) => x.source === 'coingecko'))
})

test('rate limits: upstream bucket, 429 backoff, per-IP limit', async () => {
  // DexScreener's bucket allows ~50/min; with a tiny budget the source is skipped and the miss is short-lived.
  const w = world(goodRoutes())
  const { svc, clock } = service(w, { perMin: { dexscreener: 1, coingecko: 1 } })
  await svc.getLogo('base', B) // spends DexScreener's single token
  const misses = []
  for (const a of ['0x5555555555555555555555555555555555555555', '0x6666666666666666666666666666666666666666']) misses.push(await svc.getLogo('base', a))
  assert.ok(svc.logoCoverage().since.sourceErrors['dexscreener:rate-limited'] >= 1)
  const n = w.calls.length
  clock.advance(20 * 60_000) // past the 15 min partial-miss window, well inside 24 h
  await svc.getLogo('base', '0x6666666666666666666666666666666666666666')
  assert.ok(w.calls.length > n, 'a miss caused by a rate limit is retried soon')

  // A 429 pauses that upstream (Retry-After honoured).
  const r = goodRoutes()
  r[`https://ds.test/tokens/v1/base/${B}`] = { status: 429, headers: { 'retry-after': '120' } }
  const w2 = world(r)
  const { svc: s2 } = service(w2)
  await s2.getLogo('base', B)
  assert.ok(s2.logoCoverage().upstreams.dexscreener.pausedUntil, 'paused after 429')
  const before = w2.calls.filter((c) => c.url.startsWith('https://ds.test')).length
  await s2.getLogo('base', '0x7777777777777777777777777777777777777777')
  assert.equal(w2.calls.filter((c) => c.url.startsWith('https://ds.test')).length, before, 'not called while paused')
})

/* ------------------------------------------------------------- over HTTP --- */

async function serve(svc) {
  const srv = http.createServer((req, res) => void svc.handleLogo(req, res, new URL(req.url, 'http://localhost')))
  await new Promise((r) => srv.listen(0, '127.0.0.1', r))
  return { base: `http://127.0.0.1:${srv.address().port}`, close: () => new Promise((r) => srv.close(r)) }
}

test('HTTP: headers, ETag / 304, CORS, fallback glyph, per-IP limit, no upstream URL leaks', async () => {
  const w = world(goodRoutes())
  const { svc } = service(w, { perIpPerMin: 12 })
  const s = await serve(svc)
  try {
    const r1 = await fetch(`${s.base}/api/logo/base/${C}.png?s=128`)
    assert.equal(r1.status, 200)
    assert.equal(r1.headers.get('content-type'), 'image/png')
    assert.equal(r1.headers.get('cache-control'), 'public, max-age=86400')
    assert.equal(r1.headers.get('access-control-allow-origin'), '*')
    assert.equal(r1.headers.get('x-logo-source'), 'coingecko')
    assert.equal(r1.headers.get('access-control-expose-headers'), null, 'the source header is not exposed to pages')
    const body = Buffer.from(await r1.arrayBuffer())
    assert.deepEqual(dims(body), { w: 128, h: 128 })
    const etag = r1.headers.get('etag')
    assert.match(etag, /^"[\w-]{22}"$/)
    const r2 = await fetch(`${s.base}/api/logo/base/${C}?s=128`, { headers: { 'if-none-match': etag } })
    assert.equal(r2.status, 304)

    // Unknown token: the kit's glyph, marked fallback.
    const r3 = await fetch(`${s.base}/api/logo/base/${U}.png`)
    assert.equal(r3.status, 200)
    assert.equal(r3.headers.get('x-logo-source'), 'fallback')
    assert.deepEqual(Buffer.from(await r3.arrayBuffer()), await fallbackPng(64))
    // Bad chain / address: the glyph with 400.
    const r4 = await fetch(`${s.base}/api/logo/notachain/${U}.png`)
    assert.equal(r4.status, 400)
    assert.equal(sniffImage(Buffer.from(await r4.arrayBuffer())), 'png')
    const r5 = await fetch(`${s.base}/api/logo/base/0x12.png`)
    assert.equal(r5.status, 400)
    // OPTIONS preflight.
    const r6 = await fetch(`${s.base}/api/logo/base/${C}.png`, { method: 'OPTIONS' })
    assert.equal(r6.status, 204)

    // No upstream URL or host anywhere in what we sent back.
    for (const r of [r1, r3]) for (const [k, v] of r.headers) assert.ok(!/\.test|https?:/.test(`${k}:${v}`), `${k}: ${v}`)
    assert.ok(!/\.test|https?:\/\//.test(body.toString('latin1')))

    // Per-IP limit: 12 a minute here; 6 used so far.
    const codes = []
    for (let i = 0; i < 8; i++) codes.push((await fetch(`${s.base}/api/logo/base/${C}.png`)).status)
    assert.ok(codes.includes(429), String(codes))
  } finally {
    await s.close()
  }
})

test('cache is bounded (LRU by last use)', async () => {
  const w = world(goodRoutes())
  const { svc, clock } = service(w, { maxEntries: 2 })
  await svc.getLogo('base', A)
  clock.advance(1000)
  await svc.getLogo('base', B)
  clock.advance(1000)
  await svc.getLogo('base', A) // A is now the most recent
  clock.advance(1000)
  await svc.getLogo('base', C)
  const cov = svc.logoCoverage()
  assert.equal(cov.cache.entries, 2)
  assert.deepEqual(cov.sources, { dexscreener: 1, coingecko: 1 }, 'B (least recently used) was evicted; A and C stay')
  assert.equal(cov.resolved, 2)
})

test('logoCoverage reports per chain and source', async () => {
  const { svc } = service(world(goodRoutes()))
  await svc.getLogo('base', A)
  await svc.getLogo('base', C)
  await svc.getLogo('base', U)
  const c = svc.logoCoverage()
  assert.equal(c.resolved, 2)
  assert.equal(c.fallback, 1)
  assert.deepEqual(c.chains.base.sources, { dexscreener: 1, coingecko: 1 })
  assert.deepEqual(c.sources, { dexscreener: 1, coingecko: 1 })

})

/* ------------------------------------------------------- integration logos --- */

test('every file in public/integrations has a SOURCES.json entry with its origin and terms', () => {
  const dir = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, '$1')), '..', 'public', 'integrations')
  const sources = JSON.parse(fs.readFileSync(path.join(dir, 'SOURCES.json'), 'utf8'))
  const listed = new Map(Object.values(sources).map((s) => [s.file, s]))
  const files = fs.readdirSync(dir).filter((f) => f !== 'SOURCES.json')
  assert.ok(files.length >= 20, `expected the integration logos, found ${files.length}`)
  for (const f of files) {
    const s = listed.get(`/integrations/${f}`)
    assert.ok(s, `public/integrations/${f} has no SOURCES.json entry`)
    assert.match(s.from, /^https:\/\//, `${f}: from must be a URL`)
    assert.ok(s.terms && s.fetchedAt, `${f}: terms and fetchedAt are required`)
  }
  for (const file of listed.keys()) assert.ok(files.includes(file.replace('/integrations/', '')), `SOURCES.json lists ${file} but the file is missing`)
})
