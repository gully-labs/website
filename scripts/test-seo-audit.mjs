// The every-URL SEO audit of gullylabs.xyz, as a test that fails the build on a gap (npm run test:seo-audit).
// No build and no network: every URL of the sitemap is rendered the way the server serves it (server/seo.mjs pageMeta +
// renderHead over index.html) and checked with the rules of the live audit (gully-ops scripts/seo-audit.py):
//   title at most 60 characters, description 120 to 160, exactly one h1, a canonical that is the page's own address,
//   og:title / og:description / og:image / og:url, twitter:card, lang, JSON-LD, and at least 120 words of text in the
//   served HTML.
// And what a live audit cannot see:
//   - the share image is a file this repo ships (public/…), so it loads;
//   - no two pages share a title or a description;
//   - JSON-LD parses and is of the page's type (Organization + WebSite on the home page, SoftwareApplication or Product
//     + FAQPage on a product page, BreadcrumbList on every page below the home page);
//   - every link in the served page goes somewhere: a page of this site that exists, or another site in a new tab;
//   - the served copy is the page's own: server/data/page-content.json is exactly what scripts/build-page-content.mjs
//     builds from the page sources now (so the two cannot drift), and a product page serves every feature, step and
//     question of its catalog entry;
//   - the sitemap gives every URL a lastmod, and robots.txt names the sitemap.
// The last line is the audit's summary: "gullylabs.xyz  N pages (N indexable), 0 with gaps".
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
// Production's switches: HolderMaps and Gully Security live on their own domains, so their pages are not this site's.
process.env.HOLDERMAPS_PRIMARY = '1'
process.env.SECURITY_PRIMARY = '1'
process.env.DATA_DIR ??= fs.mkdtempSync(path.join((await import('node:os')).tmpdir(), 'seo-audit-'))

const { build } = await import('./build-page-content.mjs')
const { pageMeta, renderHead, robotsFor, sitemapFor } = await import('../server/seo.mjs')
const { movedPageUrl } = await import('../server/hosts.mjs')
const C = await import(pathToFileURL(path.join(ROOT, 'src/terminal/catalog.ts')).href)

const HOST = 'gullylabs.xyz'
const SITE = `https://${HOST}`
const TITLE_MAX = 60
const DESC_MIN = 120
const DESC_MAX = 160
const WORDS_MIN = 120
const INDEX = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8')

const failures = []
const fail = (what) => failures.push(what)

/* ---- the content file is what the sources build ---- */
const built = JSON.stringify(await build(), null, 1) + '\n'
const committed = fs.readFileSync(path.join(ROOT, 'server/data/page-content.json'), 'utf8')
if (built !== committed) fail('server/data/page-content.json is out of date: run node scripts/build-page-content.mjs and commit it')

/* ---- the sitemap and robots.txt ---- */
const robots = robotsFor(HOST)
if (!/^Sitemap: https:\/\/gullylabs\.xyz\/sitemap\.xml$/m.test(robots)) fail('robots.txt has no Sitemap line')
const sitemap = sitemapFor(HOST)
const entries = [...sitemap.matchAll(/<url><loc>([^<]+)<\/loc>(?:<lastmod>([^<]*)<\/lastmod>)?/g)].map((m) => ({ url: m[1], lastmod: m[2] ?? null }))
if (entries.length < 100) fail(`the sitemap lists only ${entries.length} URLs`)
const today = new Date().toISOString().slice(0, 10)
for (const e of entries) if (!e.lastmod || !/^\d{4}-\d{2}-\d{2}$/.test(e.lastmod) || e.lastmod > today) fail(`${e.url}: sitemap lastmod is ${e.lastmod}`)
if (new Set(entries.map((e) => e.url)).size !== entries.length) fail('the sitemap lists a URL twice')

/* ---- one page ---- */
const unescape = (s) => s.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
function metaTag(doc, key) {
  const k = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const m = new RegExp(`<meta[^>]+(?:name|property)=["']${k}["'][^>]*?content="([^"]*)"`, 'i').exec(doc) ?? new RegExp(`<meta[^>]+content="([^"]*)"[^>]*(?:name|property)=["']${k}["']`, 'i').exec(doc)
  return m ? unescape(m[1]).trim() : null
}
/** Whether this site answers a path: a page, a path that moves to a product's own domain, or a host the server sends on. */
const answers = (p) => pageMeta(HOST, p).found || !!movedPageUrl(p) || /^\/(app|developers|docs|blog|status|holders|security)(\/|$)/.test(p)

const titles = new Map()
const descriptions = new Map()
const rows = []
for (const { url } of entries) {
  const gaps = []
  const p = new URL(url).pathname
  const meta = pageMeta(HOST, p)
  if (!meta.found) {
    rows.push([url, ['not a page (404)']])
    continue
  }
  const doc = renderHead(INDEX, meta)
  const title = unescape((/<title[^>]*>(.*?)<\/title>/is.exec(doc) ?? [])[1] ?? '').trim()
  const noindex = /noindex/i.test(metaTag(doc, 'robots') ?? '')
  if (noindex) gaps.push('noindex in the sitemap')
  if (!title) gaps.push('no title')
  else if (title.length > TITLE_MAX) gaps.push(`title ${title.length}ch`)
  for (const k of ['og:title', 'og:description', 'og:image', 'twitter:card', 'og:url']) if (!metaTag(doc, k)) gaps.push(`no ${k}`)
  const d = metaTag(doc, 'description')
  if (!d) gaps.push('no description')
  else if (d.length < DESC_MIN || d.length > DESC_MAX) gaps.push(`description ${d.length}ch`)
  const canonical = (/<link[^>]+rel=["']canonical["'][^>]*href=["']([^"']+)/i.exec(doc) ?? [])[1]
  if (!canonical) gaps.push('no canonical')
  else if (canonical !== url) gaps.push(`canonical is ${canonical}`)
  if (metaTag(doc, 'og:url') && metaTag(doc, 'og:url') !== url) gaps.push(`og:url is ${metaTag(doc, 'og:url')}`)
  if (title && metaTag(doc, 'og:title') !== title) gaps.push('og:title is not the title')
  if (d && metaTag(doc, 'og:description') !== d) gaps.push('og:description is not the description')
  const h1 = (doc.match(/<h1[\s>]/gi) ?? []).length
  if (h1 !== 1) gaps.push(`h1 x${h1}`)
  if (!/<html[^>]+lang=/i.test(doc)) gaps.push('no lang')
  const text = doc.replace(/<script.*?<\/script>|<style.*?<\/style>|<svg.*?<\/svg>|<[^>]+>/gis, ' ')
  const words = text.split(/\s+/).filter(Boolean).length
  if (words < WORDS_MIN) gaps.push(`only ${words} words in HTML`)

  // The share image: one of this repo's files, so it loads (the per-token cards under /api are drawn by the server).
  const og = metaTag(doc, 'og:image')
  if (og?.startsWith(`${SITE}/`) && !og.startsWith(`${SITE}/api/`) && !fs.existsSync(path.join(ROOT, 'public', new URL(og).pathname))) gaps.push(`og:image is not a file: ${new URL(og).pathname}`)
  else if (og && !og.startsWith('https://')) gaps.push('og:image is not an absolute https address')
  if (metaTag(doc, 'twitter:image') !== og) gaps.push('twitter:image is not og:image')

  // JSON-LD: parses, and is of the page's type.
  const lds = [...doc.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/gs)].map((m) => {
    try {
      return JSON.parse(m[1])
    } catch {
      return null
    }
  })
  if (!lds.length) gaps.push('no JSON-LD')
  if (lds.some((x) => !x || !x['@type'] || x['@context'] !== 'https://schema.org')) gaps.push('JSON-LD does not parse or has no @type')
  const types = lds.filter(Boolean).map((x) => x['@type'])
  const need = (t) => types.includes(t) || gaps.push(`no ${t} JSON-LD`)
  if (p === '/') ['Organization', 'WebSite'].forEach(need)
  else need('BreadcrumbList')
  const crumb = lds.find((x) => x?.['@type'] === 'BreadcrumbList')
  if (crumb && crumb.itemListElement.at(-1)?.item !== url) gaps.push('the breadcrumb does not end at the page')
  const product = /^\/products\/([a-z-]+)$/.exec(p)
  if (product) {
    if (!types.includes('SoftwareApplication') && !types.includes('Product')) gaps.push('no SoftwareApplication or Product JSON-LD')
    need('FAQPage')
    // The served copy is the catalog entry's: every feature, step and question.
    const def = C.productBySlug(product[1])
    const shell = unescape(doc.slice(doc.indexOf('<div id="root">')))
    for (const t of [def.name, ...def.features.flatMap((f) => [f.t, f.d]), ...def.how.flat(), ...C.productFaq(def).flat()]) if (!shell.includes(t)) gaps.push(`the served page lacks the catalog's "${t.slice(0, 40)}"`)
    const faq = lds.find((x) => x?.['@type'] === 'FAQPage')
    if (faq && faq.mainEntity.length !== C.productFaq(def).length) gaps.push('FAQPage is not the page’s questions')
  }

  // Links: this site's go to a page that exists; other sites open in a new tab.
  const shell = doc.slice(doc.indexOf('<div id="root">'), doc.lastIndexOf('</div>'))
  if (!shell.includes('data-shell')) gaps.push('no pre-rendered body')
  for (const m of shell.matchAll(/<a href="([^"]*)"([^>]*)>(.*?)<\/a>/gs)) {
    const href = unescape(m[1])
    if (!m[3].trim()) gaps.push(`a link with no text: ${href}`)
    if (/^https?:\/\//.test(href) && !href.startsWith(`${SITE}/`)) {
      if (!/target="_blank"/.test(m[2]) || !/rel="noopener noreferrer"/.test(m[2])) gaps.push(`external link not in a new tab: ${href}`)
    } else {
      const to = new URL(href, SITE).pathname
      if (!answers(to)) gaps.push(`link to a page that does not exist: ${href}`)
    }
  }
  if (/safe\.gullychain|Gully Safe\b/i.test(doc)) gaps.push('names the retired Gully Safe host or name')

  if (title) titles.set(title, [...(titles.get(title) ?? []), url])
  if (d) descriptions.set(d, [...(descriptions.get(d) ?? []), url])
  rows.push([url, gaps])
}
for (const [what, map] of [['title', titles], ['description', descriptions]]) for (const [text, urls] of map) if (urls.length > 1) for (const u of urls) rows.find((r) => r[0] === u)[1].push(`shares its ${what} with ${urls.length - 1} other page${urls.length > 2 ? 's' : ''}: "${text.slice(0, 50)}"`)

/* ---- the other hosts this server answers still render (their own audits follow) ---- */
for (const host of ['holdermaps.xyz', 'gullysecurity.xyz', 'docs.gullylabs.xyz', 'app.gullylabs.xyz']) {
  for (const m of (sitemapFor(host) ?? '').matchAll(/<loc>([^<]+)<\/loc>/g)) {
    const doc = renderHead(INDEX, pageMeta(host, new URL(m[1]).pathname))
    if ((doc.match(/<h1[\s>]/gi) ?? []).length !== 1) fail(`${m[1]}: h1 count is not 1`)
  }
}

const bad = rows.filter((r) => r[1].length)
const kinds = {}
for (const [, gaps] of bad) for (const g of gaps) kinds[g.split(':')[0].replace(/\d+/g, 'N')] = (kinds[g.split(':')[0].replace(/\d+/g, 'N')] ?? 0) + 1
for (const f of failures) console.log(`    FAIL ${f}`)
for (const [u, gaps] of bad.slice(0, 400)) console.log(`    ${u}: ${gaps.join('; ')}`)
console.log(`${HOST.padEnd(28)} ${String(rows.length).padStart(3)} pages (${rows.length} indexable), ${bad.length} with gaps${Object.keys(kinds).length ? '; ' + Object.entries(kinds).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, n]) => `${k} x${n}`).join('; ') : ''}`)
process.exit(bad.length || failures.length ? 1 : 0)
