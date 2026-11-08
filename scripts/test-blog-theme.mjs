// The blog theme sits on the Gully Labs 2026-11 kit: SVGs are kit files byte for byte, the derived files are the same
// bytes the website serves, nothing of the old brand is left, and every asset the theme names exists
// (npm run test:blog-theme).
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const THEME = path.join(ROOT, 'ghost/theme/gully')
const BRAND = path.join(THEME, 'assets/brand')
const KIT = path.join(ROOT, 'brand/gully-labs-kit-2026-11')
const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex')
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]))
const lock = new Map(fs.readFileSync(`${KIT}.sha256`, 'utf8').trim().split('\n').map((l) => [l.slice(66).trim(), l.slice(0, 64)]))
const read = (f) => fs.readFileSync(path.join(THEME, f), 'utf8')
const text = walk(THEME).filter((f) => /\.(hbs|css|js|json|webmanifest)$/.test(f) && !f.includes(`${path.sep}lib${path.sep}`))

test('every theme SVG is a kit file, byte for byte', () => {
  const hashes = new Set(lock.values())
  const svgs = walk(BRAND).filter((f) => f.endsWith('.svg'))
  assert.equal(svgs.length, 3)
  for (const f of svgs) assert.ok(hashes.has(sha(f)), f)
})

test('every derived file is the file the website serves from public/brand/kit', () => {
  const site = new Map(walk(path.join(ROOT, 'public/brand/kit')).map((f) => [path.basename(f), sha(f)]))
  const derived = walk(BRAND).filter((f) => /\.(png|ico|webp)$/.test(f))
  assert.equal(derived.length, 13)
  for (const f of derived) assert.equal(sha(f), site.get(path.basename(f)), f)
})

test('nothing of the old brand is left', () => {
  const old = /#(06050d|0b0a16|00d2ff|248bff|7b3bff|c02cff|a3a8c3)\b|poppins|mascot-[12]-|gully-labs-(logo|icon|wordmark)|powered-by-gully-labs|og-image-1200x630/i
  for (const f of text) assert.ok(!old.test(fs.readFileSync(f, 'utf8')), `${path.relative(THEME, f)}: ${(fs.readFileSync(f, 'utf8').match(old) || [])[0]}`)
})

test('the head carries the kit navy, the share card and the kit icons', () => {
  const head = read('default.hbs')
  assert.match(head, /name="theme-color" content="#0E1C38"/)
  assert.match(read('error.hbs'), /name="theme-color" content="#0E1C38"/)
  assert.equal([...head.matchAll(/brand\/social\/og-default-1200x630\.png/g)].length, 4)
  const manifest = JSON.parse(read('assets/brand/site.webmanifest'))
  assert.equal(manifest.theme_color, '#0E1C38')
  for (const i of manifest.icons) assert.ok(fs.existsSync(path.join(THEME, i.src)), i.src)
  const css = read('assets/css/screen.css')
  for (const c of ['#0e1c38', '#3754a0', '#6f8ddf', '#f1f3f8']) assert.ok(css.includes(c), c)
})

test('the footer has the new badge and the tagline', () => {
  assert.match(read('partials/brand/badge.hbs'), /brand\/badges\/powered-by-clear-white\.svg/)
  assert.match(read('partials/footer.hbs'), /You Think It, We Ship It/)
})

test('every {{asset}} path exists', () => {
  for (const f of text.filter((x) => x.endsWith('.hbs'))) {
    for (const [, a] of fs.readFileSync(f, 'utf8').matchAll(/\{\{asset "([^"]+)"\}\}/g)) {
      assert.ok(fs.existsSync(path.join(THEME, 'assets', a)), `${path.relative(THEME, f)}: ${a}`)
    }
  }
})

test('only kit colours: no gold, no cyan, no hex outside the kit set', () => {
  const kit = new Set(['#0e1c38', '#3754a0', '#6f8ddf', '#f1f3f8', '#c9d2e8', '#d6dce8'])
  for (const f of text.filter((x) => !x.includes('reframe'))) {
    const src = fs.readFileSync(f, 'utf8')
    for (const h of src.match(/#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b/g) || []) assert.ok(kit.has(h.toLowerCase()), `${path.relative(THEME, f)}: ${h}`)
    assert.ok(!/\bgold\b|e8c060|00f7fc|cyan/i.test(src.replace(/--gl-cyan-unused/, '')), `${path.relative(THEME, f)} names gold or cyan`)
  }
})

test('no old .gl-btn classes: the old Code injection styles them gold', () => {
  for (const f of text) assert.ok(!/\bgl-btn\b/.test(fs.readFileSync(f, 'utf8')), path.relative(THEME, f))
})

test('every menu icon exists and every nav entry has one', () => {
  for (const f of text.filter((x) => x.endsWith('.hbs'))) {
    const src = fs.readFileSync(f, 'utf8')
    for (const [, i] of src.matchAll(/\{\{> "icons\/([a-z0-9-]+)"/g)) assert.ok(fs.existsSync(path.join(THEME, `partials/icons/${i}.hbs`)), `${path.relative(THEME, f)}: ${i}`)
    for (const [, i] of src.matchAll(/icon="([a-z0-9-]+)"/g)) assert.ok(fs.existsSync(path.join(THEME, `partials/icons/${i}.hbs`)), `${path.relative(THEME, f)}: ${i}`)
    for (const m of src.matchAll(/\{\{> "nav-entry"[^}]*\}\}/g)) assert.match(m[0], /icon="/, `${path.relative(THEME, f)}: ${m[0].slice(0, 80)}`)
  }
})

test('the Products menu names the same products and links as gullylabs.xyz', () => {
  const cat = fs.readFileSync(path.join(ROOT, 'src/terminal/catalog.ts'), 'utf8')
  const street = (cat.match(/const STREET = '([^']+)'/) || [])[1]
  const site = [...cat.matchAll(/\n    name: '([^']+)',[\s\S]*?\n    url: (?:'([^']+)'|`\$\{STREET\}([^`]*)`|STREET),/g)].map((m) => [m[1], m[2] || street + (m[3] || '')])
  assert.ok(site.length >= 15, `catalog parsed: ${site.length}`)
  const menu = [...read('partials/links/products.hbs').matchAll(/href="([^"]+)" icon="[^"]+" label="([^"]+)"/g)].map((m) => [m[2], m[1]])
  for (const [name, url] of site) {
    const hit = menu.find(([n]) => n === name)
    assert.ok(hit, `missing in the blog menu: ${name}`)
    assert.equal(hit[1].replace(/\/$/, ''), url.replace(/\/$/, ''), name)
  }
})
