// The product brand registry (src/data/productBrands.ts): every product mark the site draws is an official kit file,
// byte for byte, and comes from the registry. Owner, 2026-11-10: the landing showed the Gully Chain G for Gully Core.
//   - each registry file is in public/ and its SHA-256 is the kit file's (a redrawn, re-exported or swapped file fails);
//     on a machine that holds the kits (the owner laptop, or KIT_HOME=<folder>), the kit file itself is hashed too;
//   - no product mark path is written anywhere in src/ or server/ outside the registry;
//   - the server-drawn landing and product pages draw each product with its registry mark (Gully Core: the hex-C);
//   - the copy the server reads (page-content.json `brands`) is the registry, and GET /api/brands serves it.
// No build, no network. npm run test:product-brands
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'brands-'))
process.env.GULLY_CORE_STATIC = '1'
const { PRODUCT_BRANDS } = await import('../src/data/productBrands.ts')
const CONTENT = JSON.parse(fs.readFileSync(path.join(ROOT, 'server/data/page-content.json'), 'utf8'))
const sha = (f) => createHash('sha256').update(fs.readFileSync(f)).digest('hex')

/** Every file of the registry: [product, role, file]. */
const FILES = []
for (const [k, b] of Object.entries(PRODUCT_BRANDS)) {
  FILES.push([k, 'icon', b.icon])
  if (b.logo) FILES.push([k, 'logo', b.logo])
  if (b.logo?.src2x) FILES.push([k, 'logo 2x', b.logo.src2x])
  if (b.og) FILES.push([k, 'og', b.og])
  for (const [n, f] of Object.entries(b.extra ?? {})) FILES.push([k, n, f])
}
const PATHS = new Set(FILES.map(([, , f]) => f.src))

test('every registry file is in public/ and is the kit file byte for byte', () => {
  for (const [k, role, f] of FILES) {
    const local = path.join(ROOT, 'public', f.src)
    assert.ok(fs.existsSync(local), `${k} ${role}: ${f.src} is not in public/`)
    assert.match(f.sha256, /^[0-9a-f]{64}$/, `${k} ${role}: no SHA-256`)
    assert.equal(sha(local), f.sha256, `${k} ${role}: ${f.src} is not the kit file (redrawn, re-exported or swapped?)`)
    if (f.source === null) assert.ok(PRODUCT_BRANDS[k].note, `${k} ${role}: a file with no kit source says why in its note`)
  }
})

test('on a machine that holds the kits, each kit file still has the recorded hash', (t) => {
  const home = process.env.KIT_HOME ?? os.homedir()
  let seen = 0
  for (const [k, role, f] of FILES) {
    if (!f.source) continue
    const src = path.join(home, f.source)
    if (!fs.existsSync(src)) continue
    seen++
    assert.equal(sha(src), f.sha256, `${k} ${role}: the kit file ${f.source} changed: copy it again, byte for byte`)
  }
  // A composed file (og) names the kit files it was made from: those are checked too.
  for (const [k, b] of Object.entries(PRODUCT_BRANDS)) for (const f of b.og?.from ?? []) {
    const src = path.join(home, f.source)
    if (fs.existsSync(src)) { seen++; assert.equal(sha(src), f.sha256, `${k} og: the kit file ${f.source} changed: run ${b.og.generator} again`) }
  }
  if (!seen) t.diagnostic('no kit folder on this machine: checked against the recorded hashes only')
})

test('Gully Core is its own kit (the orange hex-C), not the Gully Chain G', () => {
  const core = PRODUCT_BRANDS.core
  assert.equal(core.icon.sha256, '0b432a662bf3edc24b9ffc6c08c4b11ec96abf59ea7f9bcfa9bf8115ab7001dd') // 02-icon/gully-core-icon-ink.svg
  assert.notEqual(core.icon.sha256, PRODUCT_BRANDS.chain.icon.sha256)
  const svg = fs.readFileSync(path.join(ROOT, 'public', core.icon.src), 'utf8')
  assert.ok(svg.includes('#FD7716') && svg.includes('#0F0E0B') && svg.includes('#FEF4E3'), 'orange, ink and cream')
  // Only a product with no kit of its own may borrow another product's mark, and it says so.
  const byHash = new Map()
  for (const [k, b] of Object.entries(PRODUCT_BRANDS)) {
    const other = byHash.get(b.icon.sha256)
    if (other) assert.ok(!PRODUCT_BRANDS[k].ownKit || !PRODUCT_BRANDS[other].ownKit, `${k} and ${other} share one icon`)
    else byHash.set(b.icon.sha256, k)
    if (!b.ownKit) assert.ok(b.note, `${k} borrows a mark: its note says so`)
  }
})

test('the server reads the registry itself: page-content.json `brands` is the registry, /api/brands serves it', async () => {
  assert.deepEqual(CONTENT.brands, JSON.parse(JSON.stringify(PRODUCT_BRANDS)))
  const { brandsJson } = await import('../server/brand-registry.mjs')
  const j = brandsJson()
  assert.equal(j.brands.core.icon.url, `https://gullylabs.xyz${PRODUCT_BRANDS.core.icon.src}`)
  assert.equal(j.brands.core.icon.sha256, PRODUCT_BRANDS.core.icon.sha256)
  assert.equal(Object.keys(j.brands).length, Object.keys(PRODUCT_BRANDS).length)
})

/** Quoted strings (or a CSS url()) that name a product mark: a registry file, or any file in the product mark folders. */
const MARK = /["'`(](\/brand\/(?:hub\/icons|web\/logos|products|gullyid\/gullyid-lockup|kit\/mark-reversed|holdermaps\/holdermaps-logo)[^"'`)\s]*)/g
function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) { if (!['node_modules', 'data', 'dist'].includes(e.name)) walk(p, out) } else if (/\.(ts|tsx|mjs|js|css|html)$/.test(e.name)) out.push(p)
  }
  return out
}

test('no product mark path is written outside the registry (src/, server/, the page-content builder)', () => {
  const files = [...walk(path.join(ROOT, 'src')), ...walk(path.join(ROOT, 'server')), path.join(ROOT, 'scripts/build-page-content.mjs'), path.join(ROOT, 'index.html')]
  const bad = []
  for (const f of files) {
    const rel = path.relative(ROOT, f).replaceAll('\\', '/')
    if (rel === 'src/data/productBrands.ts') continue
    const text = fs.readFileSync(f, 'utf8')
    for (const m of text.matchAll(MARK)) bad.push(`${rel}: ${m[1]}`)
    for (const p of PATHS) if (text.includes(`"${p}"`) || text.includes(`'${p}'`) || text.includes(`\`${p}\``)) bad.push(`${rel}: ${p}`)
  }
  assert.deepEqual([...new Set(bad)], [], 'take these from src/data/productBrands.ts (PRODUCT_BRANDS) instead')
})

const svc = (key, state, ms) => ({ key, name: key, state, ms, history: [{ ms: 100 }, { ms: ms ?? null }] })
const data = {
  hub: { chain: { head: 4501 }, gateway: { ok: 5, total: 6, networks: [] }, services: [svc('gully-id', 'up', 120), svc('street', 'up', 90), svc('safe', 'up', 300)] },
  products: { chain: { recent: [{ txs: 3 }] }, activity: { hourly: [{ launches: 2, trades: 1, swaps: 0 }] }, holders: { daily: [{ maps: 5 }] }, security: { total: 4 } },
  live: { id: { totals: { users: 35 } }, pay: { services: { api: 'operational' } } },
  stats: { venues: [] },
}
const icon = (k) => PRODUCT_BRANDS[k].icon.src
/** Every image the HTML draws in a product mark folder is a registry file. */
const marksIn = (html) => [...html.matchAll(/(?:src|href)="(\/brand\/[^"]+)"/g)].map((m) => m[1]).filter((p) => /^\/brand\/(hub\/icons|web\/logos|products)\//.test(p))

test('the landing draws every product node, tile and heading with its own registry mark', async () => {
  const { headTags, pageMeta } = await import('../server/seo.mjs')
  const L = await import('../server/landing.mjs')
  const html = await L.renderLanding(headTags(pageMeta('gullylabs.xyz', '/preview/landing')), data)
  for (const p of marksIn(html)) assert.ok(PATHS.has(p), `${p} is not a registry file`)
  // The constellation (both layouts), the "Everything in orbit" tiles.
  const TOOLS = ['bridge', 'faucet', 'explorer']
  for (const k of ['id', 'pay', 'rpc', 'holdermaps', 'security', 'studio', 'ai', 'chain', 'core', 'kre8', 'multisig']) {
    const nodes = [...html.matchAll(new RegExp(`data-mk="${k}"[^>]*>(?:<[^>]+>){3}<image href="([^"]+)"`, 'g'))].map((m) => m[1])
    assert.equal(nodes.length, 2, `${k}: one node per map layout`)
    for (const n of nodes) assert.equal(n, icon(k), `${k} node`)
    const tile = html.match(new RegExp(`data-p="${k}"[^>]*><img[^>]* src="([^"]+)"`))
    assert.ok(tile, `${k}: a tile`)
    assert.equal(tile[1], icon(k), `${k} tile`)
  }
  for (const k of TOOLS) assert.equal(html.match(new RegExp(`data-p="${k}"[^>]*><img[^>]* src="([^"]+)"`))[1], icon('chain'), `${k} is a Gully Chain tool`)
  // "Build on Gully Core" and the chains orbiting it.
  const heads = [...html.matchAll(/<img src="([^"]+)"[^>]*data-brand="core"><h2 class="t">Build on Gully Core<\/h2>/g)]
  assert.equal(heads.length, 1)
  assert.equal(heads[0][1], icon('core'))
  assert.ok(html.includes(`<image href="${icon('core')}" x="182" y="182" width="96" height="96" clip-path="url(#corec)" data-brand="core"/>`), 'the orbit centre is the Gully Core tile')
  assert.ok(!/data-mk="core"[^>]*>(?:<[^>]+>){3}<image href="\/brand\/web\/logos\/gc-icon\.svg"/.test(html))
})

test('the product pages draw the product mark; Gully Core and its builds draw the hex-C', async () => {
  const P = await import('../server/product-pages.mjs')
  const hero = async (kind, id) => (await P.renderProduct('', kind, id, data)).match(/<div class="pm"[^>]*><img src="([^"]+)"[^>]*data-brand="([^"]+)"/)
  const want = { 'gully-core': 'core', chain: 'chain', street: 'kre8', safe: 'multisig', 'gully-id': 'id', pay: 'pay', rpc: 'rpc', holders: 'holdermaps', security: 'security', studio: 'studio', ai: 'ai', quests: 'chain' }
  for (const [slug, k] of Object.entries(want)) {
    const m = await hero('product', slug)
    assert.ok(m, `${slug}: a hero mark`)
    assert.equal(m[1], icon(k), `${slug}: ${k} mark`)
  }
  for (const b of ['token', 'pad', 'dex', 'stock', 'vault', 'locks']) assert.equal((await hero('build', b))[1], icon('core'), `build ${b}`)
  for (const slug of Object.keys(CONTENT.product)) for (const p of marksIn(await P.renderProduct('', 'product', slug, data))) assert.ok(PATHS.has(p), `${slug}: ${p} is not a registry file`)
})

test('the React catalog shows each product with its own kit logo (Gully Core: its logotype)', async () => {
  const C = await import('../src/terminal/catalog.ts')
  const logo = (slug) => C.PRODUCTS.find((p) => p.slug === slug).logo
  assert.deepEqual([logo('gully-core').kind, logo('gully-core').src], ['kit', PRODUCT_BRANDS.core.logo.src])
  assert.equal(logo('street').src, PRODUCT_BRANDS.kre8.logo.src)
  assert.equal(logo('gully-id').src, PRODUCT_BRANDS.id.logo.src)
  assert.equal(logo('safe').mark, 'multisig')
  for (const p of C.PRODUCTS) {
    const l = p.logo
    if (l.kind === 'kit') assert.ok(PATHS.has(l.src), `${p.slug}: ${l.src} is not a registry file`)
    else assert.ok(PRODUCT_BRANDS[l.mark], `${p.slug}: mark ${l.mark} is not a registry key`)
  }
  // Gully Core shares its own kit art, never the Gully Chain card.
  assert.equal(C.PRODUCTS.find((p) => p.slug === 'gully-core').og, PRODUCT_BRANDS.core.og.src)
  assert.equal(CONTENT.product['gully-core'].og, PRODUCT_BRANDS.core.og.src)
  assert.ok(fs.existsSync(path.join(ROOT, PRODUCT_BRANDS.core.og.generator)))
  const H = await import('../src/pages/hub/hubData.ts')
  for (const p of H.HUB_PRODUCTS) assert.equal(p.icon, icon(p.key), `hub ${p.key}`)
})
