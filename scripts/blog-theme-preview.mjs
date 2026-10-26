#!/usr/bin/env node
/* Renders the blog theme (ghost/theme/gully) to static HTML WITHOUT Ghost, for a quick look and for
   screenshots. A small Handlebars harness stands in for Ghost's helpers ({{get}}, {{foreach}},
   {{match}}, {{img_url}}, {{navigation}} ...), simplified to what this theme uses. Every page carries a
   "Preview: sample content" ribbon, and the sample posts are labelled as samples: none of this is real.

   Usage:
     HANDLEBARS=<path to the handlebars package> node scripts/blog-theme-preview.mjs <out dir> [--empty]
   handlebars (MIT) is not a dependency of the site; point HANDLEBARS at any copy, e.g. the one npx
   fetches with gscan. Writes <out>/{index,post,post-image,tag,author,page2,404,error,empty}.html and
   copies the theme's assets to <out>/assets. Serve <out> over HTTP (fonts need it). */
import { readFileSync, writeFileSync, mkdirSync, readdirSync, cpSync, existsSync } from 'node:fs'
import { join, dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const theme = join(root, 'ghost', 'theme', 'gully')
const out = process.argv[2]
if (!out) throw new Error('usage: node scripts/blog-theme-preview.mjs <out dir>')
const require = createRequire(import.meta.url)
const Handlebars = require(process.env.HANDLEBARS || 'handlebars')
const hb = Handlebars.create()
const SITE_URL = 'https://blog.gullylabs.xyz'

/* ------------------------------------------------------------------ sample data --- */
const tags = [
  { id: 't1', slug: 'tracker', name: 'Tracker', description: 'Sample topic: notes on the stock token tracker.', count: { posts: 3 } },
  { id: 't2', slug: 'releases', name: 'Releases', description: 'Sample topic: what shipped.', count: { posts: 3 } },
  { id: 't3', slug: 'engineering', name: 'Engineering', description: 'Sample topic: how we build.', count: { posts: 2 } },
  { id: 't4', slug: 'chains', name: 'Chains', description: 'Sample topic: app chains and explorers.', count: { posts: 2 } },
  { id: 't5', slug: 'analytics', name: 'Analytics', description: 'Sample topic: Gully Analytics.', count: { posts: 1 } },
]
for (const t of tags) t.url = `${SITE_URL}/tag/${t.slug}/`
const author = { id: 'a1', slug: 'gully-team', name: 'Gully Labs Team', bio: 'Sample author for the theme preview.', url: `${SITE_URL}/author/gully-team/`, location: 'On-chain' }
const T = Object.fromEntries(tags.map((t) => [t.slug, t]))

const BODY = `
<p><strong>Preview content.</strong> This is a sample post used to preview the Gully Labs blog theme. It is not a real article and its figures are placeholders.</p>
<p>Stock tokens trade around the clock while the underlying shares do not. The tracker compares each token with a <a href="https://gullylabs.xyz/tracker">fair price</a> and shows the gap.</p>
<h2 id="how-it-works">How the comparison works</h2>
<p>We read the token's on-chain price and the reference price, then work out the difference. Inline code looks like <code>gap = token / fair - 1</code>.</p>
<pre><code class="language-ts">import { Gully } from '@gully-labs/sdk'

const gully = new Gully({ apiKey: process.env.GULLY_KEY })
const gaps = await gully.gaps.list({ chain: 'bnb', limit: 10 })
for (const g of gaps) console.log(g.symbol, g.gapPct)
</code></pre>
<blockquote>Sample quote: a gap is information, not advice.</blockquote>
<h3 id="details">Details</h3>
<ul><li>Prices are read live and can be late or wrong.</li><li>Tokens are issued by third parties.</li><li>Alerts go out by Telegram or webhook.</li></ul>
<figure class="kg-card kg-image-card kg-card-hascaption"><img src="/assets/sample/og-home.png" class="kg-image" alt="Sample image" loading="lazy" width="1200" height="630"><figcaption>Sample caption: an image card with a caption.</figcaption></figure>
<div class="kg-card kg-callout-card kg-callout-card-accent"><div class="kg-callout-emoji">💡</div><div class="kg-callout-text">A sample callout card in the accent colour.</div></div>
<table><thead><tr><th>Column</th><th>Sample</th><th>Value</th></tr></thead><tbody><tr><td>Row one</td><td>Placeholder</td><td>0.00</td></tr><tr><td>Row two</td><td>Placeholder</td><td>0.00</td></tr></tbody></table>
<p>That is the end of the sample. The real posts will follow.</p>`

const titles = [
  ['sample-why-stock-tokens-drift', 'Sample post: why stock tokens drift from their fair price', ['tracker', 'engineering'], true],
  ['sample-chain-kit-explorers', 'Sample post: branded block explorers with Chain Kit', ['chains', 'releases']],
  ['sample-gap-alerts-telegram', 'Sample post: gap alerts by Telegram and webhook', ['tracker', 'releases']],
  ['sample-analytics-wallets', 'Sample post: web analytics that see the wallet', ['analytics']],
  ['sample-release-notes-october', 'Sample post: release notes for October', ['releases']],
  ['sample-app-chains', 'Sample post: launching an app chain, step by step', ['chains', 'engineering']],
  ['sample-tracker-methodology', 'Sample post: the tracker methodology, in full', ['tracker']],
]
const posts = titles.map(([slug, title, tagSlugs, featured], i) => {
  const d = new Date(Date.UTC(2026, 9, 16 - i * 3))
  const ptags = tagSlugs.map((s) => T[s])
  return {
    id: `p${i + 1}`, slug, title, featured: !!featured, url: `${SITE_URL}/${slug}/`,
    published_at: d.toISOString(), reading_time: 3 + (i % 5), access: true, visibility: 'public',
    excerpt: 'Preview content: a sample excerpt for the theme preview. The real posts will replace it with a summary of the article.',
    custom_excerpt: i === 0 ? 'Preview content: a sample standfirst. Stock tokens trade all day; the shares do not. Here is how the gap is measured.' : null,
    tags: ptags, primary_tag: ptags[0], authors: [author], primary_author: author, html: BODY,
    feature_image: i === 2 ? '/assets/sample/og-home.png' : null, feature_image_alt: i === 2 ? 'Sample feature image' : null,
    feature_image_caption: i === 2 ? 'Sample caption for a feature image.' : null,
  }
})

const site = {
  url: SITE_URL, title: 'Gully Labs Blog', locale: 'en',
  description: 'Building on-chain: stock token gaps, analytics, payments and the tools behind them.',
  members_enabled: process.argv.includes('--members'), accent_color: '#D9B563',
  navigation: [
    { label: 'Home', url: '/', slug: 'home' },
    { label: 'Releases', url: '/tag/releases/', slug: 'releases' },
    { label: 'Engineering', url: '/tag/engineering/', slug: 'engineering' },
    { label: 'Tracker', url: '/tag/tracker/', slug: 'tracker' },
    { label: 'Docs', url: 'https://docs.gullylabs.xyz', slug: 'docs' },
  ],
  secondary_navigation: [{ label: 'RSS', url: '/rss/', slug: 'rss' }],
}
const custom = { animated_banners: true, show_tracker_strip: true }
const config = { posts_per_page: 12 }

/* ---------------------------------------------------------------------- helpers --- */
const S = (s) => new hb.SafeString(s)
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
function fmt(iso, f) {
  const d = iso ? new Date(iso) : new Date()
  const p = (n) => String(n).padStart(2, '0')
  return f.replace(/YYYY|MMM|MM|DD|D/g, (t) => ({ YYYY: d.getUTCFullYear(), MMM: MONTHS[d.getUTCMonth()], MM: p(d.getUTCMonth() + 1), DD: p(d.getUTCDate()), D: d.getUTCDate() })[t])
}
function applyFilter(list, filter) {
  if (!filter) return list
  return filter.split('+').reduce((acc, part) => {
    const [k, v] = part.split(':')
    if (k === 'featured') return acc.filter((p) => String(!!p.featured) === v)
    if (k === 'id' && v.startsWith('-')) return acc.filter((p) => p.id !== v.slice(1))
    if (k === 'tags' || k === 'tag') return acc.filter((p) => (p.tags || []).some((t) => t.slug === v.replace(/[[\]]/g, '')))
    return acc
  }, list)
}
let ROOT = {}
let CTX = []
const helpers = {
  asset: (p) => `/assets/${p}`,
  img_url: (img) => img || '',
  date(...args) {
    const o = args.pop()
    const f = o.hash.format || 'D MMM YYYY'
    return fmt(args[0] || this.published_at, f)
  },
  reading_time(o) { const n = this.reading_time || 1; return (n === 1 ? o.hash.minute : o.hash.minutes).replace('%', n) },
  excerpt(o) { const w = (this.custom_excerpt || this.excerpt || '').split(' '); const n = +(o.hash.words || 50); return w.slice(0, n).join(' ') + (w.length > n ? '…' : '') },
  meta_title() { return ROOT.post ? `${ROOT.post.title} | ${site.title}` : site.title },
  ghost_head: () => S(`<style>:root{--ghost-accent-color:${site.accent_color}}</style>`),
  ghost_foot: () => S('<div class="preview-ribbon" style="position:fixed;right:12px;bottom:12px;z-index:99;padding:6px 10px;border:1px solid #262445;border-radius:999px;background:#0b0a16;color:#00d2ff;font:500 11px/1.4 \'IBM Plex Mono\',monospace;letter-spacing:1px">PREVIEW · SAMPLE CONTENT</div>'),
  body_class: () => `${CTX[0]}-template`,
  post_class() { return ['post', this.featured ? 'featured' : '', ...(this.tags || []).map((t) => `tag-${t.slug}`)].filter(Boolean).join(' ') },
  content() { return S(this.html || '') },
  url(o) { return this.url || '' },
  encode: (s) => encodeURIComponent(s || ''),
  concat: (...a) => a.slice(0, -1).join(''),
  t: (s) => s,
  social_url: () => '',
  comments: () => '',
  page_url: (n) => `/page/${n}/`,
  plural(n, o) { return n === 0 ? o.hash.empty : (n === 1 ? o.hash.singular : o.hash.plural).replace('%', n) },
  is(names, o) { const want = names.split(',').map((s) => s.trim()); return want.some((w) => CTX.includes(w)) ? o.fn(this) : o.inverse(this) },
  match(...args) {
    const o = args.pop()
    let ok
    if (args.length === 1) ok = !!args[0]
    else if (args.length === 2) ok = args[0] == args[1]
    else {
      const [a, op, b] = args
      ok = { '=': a == b, '!=': a != b, '>': a > b, '<': a < b, '>=': a >= b, '<=': a <= b }[op]
    }
    return ok ? o.fn(this) : o.inverse(this)
  },
  foreach(list, o) {
    let items = Array.isArray(list) ? list : []
    if (o.hash.visibility) items = items.filter((x) => !x.visibility || x.visibility === o.hash.visibility)
    const from = +(o.hash.from || 1) - 1
    const to = o.hash.to ? +o.hash.to : items.length
    items = items.slice(from, to)
    if (o.hash.limit) items = items.slice(0, +o.hash.limit)
    if (!items.length) return o.inverse(this)
    return items.map((it, i) => {
      const data = hb.createFrame(o.data)
      Object.assign(data, { index: i, number: i + 1, first: i === 0, last: i === items.length - 1 })
      return o.fn(it, { data, blockParams: [it, i] })
    }).join('')
  },
  get(resource, o) {
    const filter = (o.hash.filter || '').replace(/\{\{(\w+)\}\}/g, (_, k) => this[k])
    let list = resource === 'tags' ? tags.filter((t) => t.count.posts > 0) : posts.slice()
    if (resource === 'posts') list = applyFilter(list, filter)
    const limit = +o.hash.limit || 15
    const total = list.length
    const res = { [resource]: list.slice(0, limit), pagination: { page: 1, pages: Math.max(1, Math.ceil(total / limit)), total } }
    return o.fn(res, { data: o.data, blockParams: [res[resource], res.pagination] })
  },
  navigation(o) {
    const items = (o.hash.type === 'secondary' ? site.secondary_navigation : site.navigation).map((n) => ({ ...n, current: n.url === ROOT.__path }))
    if (!items.length) return ''
    return S(hb.partials.navigation({ navigation: items }, { data: o.data }))
  },
  pagination(o) { return S(hb.partials.pagination(ROOT.pagination || {}, { data: o.data })) },
}
// {{url absolute="true"}} inside an attribute is a helper call; plain {{url}} too. Ghost does the same.
hb.registerHelper(helpers)

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]))
}
for (const f of walk(join(theme, 'partials')).filter((f) => f.endsWith('.hbs'))) {
  const name = relative(join(theme, 'partials'), f).replace(/\\/g, '/').replace(/\.hbs$/, '')
  hb.registerPartial(name, hb.compile(readFileSync(f, 'utf8')))
}
for (const name of Object.keys(hb.partials)) if (typeof hb.partials[name] === 'string') hb.partials[name] = hb.compile(hb.partials[name])

const layout = hb.compile(readFileSync(join(theme, 'default.hbs'), 'utf8'))
function render(template, ctx, contexts, path) {
  ROOT = { ...ctx, __path: path }
  CTX = contexts
  const src = readFileSync(join(theme, template), 'utf8')
  const data = { site, custom, config, member: null, page: { show_title_and_feature_image: true } }
  const body = hb.compile(src)(ctx, { data })
  if (!/\{\{!<\s*default\s*\}\}/.test(src)) return body
  return layout({ ...ctx, body: S(body) }, { data })
}

mkdirSync(out, { recursive: true })
cpSync(join(theme, 'assets'), join(out, 'assets'), { recursive: true })
mkdirSync(join(out, 'assets', 'sample'), { recursive: true })
const sample = join(root, 'public', 'social', 'og-home.png')
if (existsSync(sample)) cpSync(sample, join(out, 'assets', 'sample', 'og-home.png'))

const pag = (n) => ({ page: 1, pages: 1, total: n, next: null, prev: null })
const pages = {
  'index.html': render('home.hbs', { posts, pagination: pag(posts.length) }, ['home', 'index'], '/'),
  'empty.html': render('home.hbs', { posts: [], pagination: pag(0) }, ['home', 'index'], '/'),
  'page2.html': render('index.hbs', { posts: posts.slice(3), pagination: { page: 2, pages: 2, total: posts.length, prev: 1, next: null } }, ['index', 'paged'], '/page/2/'),
  'post.html': render('post.hbs', { post: posts[0] }, ['post'], '/sample-why-stock-tokens-drift/'),
  'post-image.html': render('post.hbs', { post: posts[2] }, ['post'], '/sample-gap-alerts-telegram/'),
  'tag.html': render('tag.hbs', { tag: T.releases, posts: posts.filter((p) => p.tags.includes(T.releases)), pagination: pag(3) }, ['tag'], '/tag/releases/'),
  'author.html': render('author.hbs', { author, posts, pagination: pag(posts.length) }, ['author'], '/author/gully-team/'),
  '404.html': render('error-404.hbs', { statusCode: 404, message: 'Page not found' }, ['error'], '/nope/'),
  'error.html': render('error.hbs', { statusCode: 500, message: 'Sample server error' }, ['error'], '/err/'),
}
for (const [f, html] of Object.entries(pages)) writeFileSync(join(out, f), html)
console.log(`wrote ${Object.keys(pages).length} pages to ${out}`)
