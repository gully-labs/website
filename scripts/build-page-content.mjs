// Builds server/data/page-content.json: what the server writes into the HTML of every indexed gullylabs.xyz page
// before scripts run (server/seo.mjs), so a crawler, a link preview and a reader without JavaScript get the page's
// own title, description, headings, copy and links, not an empty shell.
//
// Nothing is written by hand here. Every string comes from the file the browser draws the page from:
//   titles and descriptions   src/content/seoPages.ts (the <Seo> component reads the same table)
//   header and footer links   src/content/nav.ts, src/terminal/catalog.ts, src/pages/hub/hubData.ts
//   product pages             src/terminal/catalog.ts (PRODUCTS, PRODUCT_SECTIONS, productFaq, pricingNote)
//   the landing               src/pages/hub/hubData.ts (HUB_PRODUCTS, PEDDLE_FAMILY, NEWS) and its page's own sentences
//   services, projects        src/terminal/catalog.ts (SERVICES), src/content/projects.ts
//   stock pages               server/data/*-stocks.json and src/content/stockCopy.ts (filled in per page by the server)
//   every other page          the page's own TSX, read as an outline (scripts/lib/jsx-outline.mjs)
// So the pre-render cannot drift from the page: change the page and the next build changes this file.
//
//   node scripts/build-page-content.mjs           write the file (also runs as `prebuild`)
//   node scripts/build-page-content.mjs --check   exit 1 when the committed file is out of date (no write)
// The output is deterministic (no dates), so an unchanged tree rewrites the same bytes.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { constLiteral, fileOutline, sections } from './lib/jsx-outline.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT = path.join(ROOT, 'server', 'data', 'page-content.json')
/** Node reads these TypeScript files itself (types are stripped; they import nothing that needs a bundler). */
const load = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href)
const json = (rel) => JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'))

/** Pages whose copy is read from their own TSX: path -> source file. */
const JSX_PAGES = {
  '/about': 'src/pages/About.tsx',
  '/pricing': 'src/pages/Pricing.tsx',
  '/status': 'src/pages/Status.tsx',
  '/widget': 'src/pages/widget/WidgetPage.tsx',
  '/analytics': 'src/pages/Products.tsx',
  '/ask': 'src/pages/ask/AskPage.tsx',
  '/links': 'src/pages/Links.tsx',
  '/score': 'src/pages/score/ScoreIndex.tsx',
  '/ecosystem': 'src/pages/Ecosystem.tsx',
  '/partners': 'src/pages/Partners.tsx',
  '/gully-id': 'src/pages/GullyId.tsx',
  '/tracker': 'src/pages/Tracker.tsx',
  '/services': 'src/pages/Services.tsx',
  '/products': 'src/pages/products/ProductsIndex.tsx',
  '/': 'src/pages/hub/Constellation.tsx',
  '/legal': 'src/pages/legal/LegalIndex.tsx',
  '/terms': 'src/pages/legal/Terms.tsx',
  '/privacy': 'src/pages/legal/Privacy.tsx',
  '/legal/merchant-terms': 'src/pages/legal/MerchantTerms.tsx',
  '/legal/scan-terms': 'src/pages/legal/ScanTerms.tsx',
}
/** holdermaps.xyz pages whose copy is read from their own TSX: path -> [source file, the page's component]. Both
    policies live in one file, so each is read from its own component (server/seo.mjs serves them as
    `holdermaps:<path>`). */
const HM_JSX_PAGES = {
  '/terms': ['src/holdermaps/HmLegal.tsx', 'HmTermsPage'],
  '/privacy': ['src/holdermaps/HmLegal.tsx', 'HmPrivacyPage'],
}

/** Self-closing components that draw one fixed string, read from the file that draws them: <Mail /> is the contact
    address of src/pages/legal/kit.tsx (LEGAL.email), so a sentence ending in it is served whole. */
const TEXT = { Mail: constLiteral(path.join(ROOT, 'src/pages/legal/kit.tsx'), 'LEGAL')?.email }
if (!TEXT.Mail) throw new Error('src/pages/legal/kit.tsx: LEGAL.email not found (needed to pre-render <Mail />)')

const link = (d) => [d.to ?? d.href, d.label]
const sec = (h, { p = [], list = [], links = [], qa = [], level = 2 } = {}) => ({ h, level, p, list, links, qa })
/** A page's own headline (its h1, when it is plain text) and sentences, as sections. Links to this site's API are
    not page links. */
function fromJsx(file, within = null) {
  const { h1, sections: s } = sections(fileOutline(path.join(ROOT, file), within, TEXT))
  return { ...(h1 ? { h1 } : {}), sections: s.map((x) => sec(x.h, { level: x.level ?? 2, p: x.p, links: x.links.filter(([href]) => !href.startsWith('/api/')) })) }
}

export async function build() {
  const S = await load('src/content/seoPages.ts')
  const N = await load('src/content/nav.ts')
  const C = await load('src/terminal/catalog.ts')
  const H = await load('src/pages/hub/hubData.ts')
  const P = await load('src/content/projects.ts')
  const K = await load('src/content/stockCopy.ts')
  const GC = await load('src/content/gullyCore.generated.ts')

  /* ---- titles and descriptions ---- */
  const meta = {}
  for (const [p, e] of Object.entries(S.SEO_PAGES)) meta[p] = [S.fullTitle(p, e.title), e.description]
  for (const p of C.PRODUCTS) {
    const e = S.productSeo(p)
    meta[`/products/${p.slug}`] = [S.fullTitle('', e.title), e.description]
  }
  // The Peddle family's pages. (Gully Chain has its product page, /products/chain.)
  const projects = P.projects.filter((p) => p.family === 'Peddle')
  for (const p of projects) {
    const e = S.projectSeo(p)
    meta[`/projects/${p.slug}`] = [S.fullTitle('', e.title), e.description]
  }
  const stocks = {}
  for (const key of Object.keys(S.STOCK_CHAIN_NAME)) {
    let rows = []
    try {
      rows = json(`server/data/${key}-stocks.json`).stocks
    } catch {
      /* no table: no pages for this chain */
    }
    stocks[key] = { name: S.STOCK_CHAIN_NAME[key], rows: rows.map((s) => [s.ticker, s.name, s.token, s.feed ?? null]) }
    for (const s of rows) {
      const e = S.stockSeo(key, s.ticker, s.name)
      meta[`/tracker/${key}/${s.ticker}`] = [S.fullTitle('', e.title), e.description]
    }
  }

  /* ---- header and footer ---- */
  const groups = [
    ['labs', 'Gully Labs'],
    ['chain', 'Gully Chain'],
  ].map(([g, label]) => ({ group: label, links: C.PRODUCTS.filter((p) => p.group === g).map((p) => [`/products/${p.slug}`, p.name]) }))
  groups.push({ group: 'Peddle', links: H.PEDDLE_FAMILY.map((p) => [p.url, p.name]) })
  const nav = {
    header: N.headerNav(false).map(link),
    headerHome: N.headerNav(true).map(link),
    footer: N.FOOTER_LINKS.map(link),
    more: N.FOOTER_MORE.map(link),
    legal: N.FOOTER_LEGAL.map(link),
    products: groups,
    tagline: N.FOOTER_TAGLINE,
    copy: N.FOOTER_COPY,
  }

  /* ---- page bodies ---- */
  const body = {}
  for (const [p, file] of Object.entries(JSX_PAGES)) body[p] = fromJsx(file)
  for (const [p, [file, within]] of Object.entries(HM_JSX_PAGES)) body[`holdermaps:${p}`] = fromJsx(file, within)

  // /analytics: the page is drawn from one data object (ANALYTICS in src/pages/Products.tsx); the same object here.
  const an = constLiteral(path.join(ROOT, JSX_PAGES['/analytics']), 'ANALYTICS')
  if (!an?.lead || !an.features?.length || !an.how?.length) throw new Error('src/pages/Products.tsx: the ANALYTICS object was not found')
  body['/analytics'].sections.unshift(
    sec(null, { p: [an.lead], list: an.features.map((f) => `${f.title}: ${f.body}`) }),
    ...[an.live, an.figure].filter((x) => x?.title && x.body).map((x) => sec(x.title, { p: [x.body] })),
    sec(null, { list: an.how.map((h) => `${h.title}: ${h.body}`), p: an.licence ? [an.licence] : [] }),
  )

  // The landing: its own sentences, then the directory (every product with its line and what is live), the Peddle
  // family and the dated news, from the data the page draws them from.
  const home = body['/'].sections
  /** A section of the landing's own TSX by its heading; a missing one stops the build (the page changed: update here). */
  const homeSec = (h) => home.find((s) => s.h === h) ?? (() => { throw new Error(`src/pages/hub/Constellation.tsx: no "${h}" heading`) })()
  const homeLine = (re) => home.flatMap((s) => s.p).find((t) => re.test(t)) ?? (() => { throw new Error(`src/pages/hub/Constellation.tsx: no sentence matching ${re}`) })()
  const peddle = fromJsx('src/pages/hub/PeddleFamily.tsx').sections.flatMap((s) => s.p)
  if (!peddle.length) throw new Error('src/pages/hub/PeddleFamily.tsx: its sentence was not found')
  const dir = homeSec('Where to go')
  const build = homeSec('We build with you, on the same stack we run.')
  const contact = homeSec('Tell us what you are building.')
  body['/'].h1 = H.LANDING_HEADLINE.join(' ')
  body['/'].sections = [
    sec(null, { p: [H.LANDING_LEDE] }),
    sec(dir.h, { p: dir.p.slice(0, 1) }),
    ...H.HUB_PRODUCTS.map((p) =>
      sec(`${p.name} · ${H.STATUS_LABEL[p.status]}`, {
        level: 3,
        p: [p.line, p.about],
        list: p.live,
        links: [
          [`/products/${p.page}`, `${p.name} on Gully Labs`],
          [p.url, p.domain],
        ],
      }),
    ),
    sec(peddle[0], { p: peddle.slice(1) }),
    ...H.PEDDLE_FAMILY.map((p) =>
      sec(`${p.name} · ${p.kind}`, {
        level: 3,
        p: [p.line],
        links: [
          [`/projects/${p.page}`, `${p.name} on Gully Labs`],
          [p.url, p.domain],
        ],
      }),
    ),
    sec(null, { p: [homeLine(/^Every item is live or shipped/)], list: H.NEWS.map((n) => `${n.d} · ${H.productOf(n.p).name}: ${n.t} (${n.s})`) }),
    sec(build.h, { links: build.links.filter(([href]) => href === '/services') }),
    sec(contact.h, { p: contact.p.slice(0, 1) }),
  ]

  // /products: every product with its line, and the Peddle family.
  body['/products'].sections.push(
    sec(null, { links: C.PRODUCTS.map((p) => [`/products/${p.slug}`, `${p.name}: ${p.line}`]) }),
    sec(null, { links: H.PEDDLE_FAMILY.map((p) => [`/projects/${p.page}`, `${p.name} (${p.kind}): ${p.line}`]) }),
  )

  // /services: every service with its deliverables and timeline.
  body['/services'].sections.push(...C.SERVICES.map((s) => sec(s.title, { level: 3, p: [s.desc, `Typical timeline: ${s.timeline}.`], list: s.deliverables, links: [[`/products/${s.proof}`, `Our own product that proves it: ${C.productBySlug(s.proof)?.name ?? s.proof}`]] })))

  // /ecosystem: the third-party services the code integrates with.
  // (ecosystem.ts imports the browser's host table, so its list is read as text, like the /links list below.)
  const ecoSrc = fs.readFileSync(path.join(ROOT, 'src/content/ecosystem.ts'), 'utf8')
  const integrations = [...ecoSrc.matchAll(/\{ id: '[^']+', name: '([^']+)', kind: '([^']+)', use: '([^']+)', where: '[^']*', href: '([^']+)' \}/g)].map((m) => [m[4], `${m[1]} (${m[2]}): ${m[3]}`])
  if (integrations.length < 8) throw new Error('src/content/ecosystem.ts: the integrations list was not found')
  body['/ecosystem'].sections.push(sec(null, { links: integrations }))

  // /tracker: every tracked stock token's own page, per chain.
  for (const [key, c] of Object.entries(stocks)) if (c.rows.length) body['/tracker'].sections.push(sec(c.name, { level: 3, links: c.rows.map(([ticker, name]) => [`/tracker/${key}/${ticker}`, `${ticker} · ${name}`]) }))

  // /links: the list itself (label, what it is, where it goes; the campaign tag is the page's own business).
  const linksSrc = fs.readFileSync(path.join(ROOT, JSX_PAGES['/links']), 'utf8')
  const hubLinks = [...linksSrc.matchAll(/label: '([^']+)', desc: '([^']+)', href: (?:utm\()?'([^']+)'/g)].map((m) => [m[3], `${m[1]}: ${m[2]}`])
  if (hubLinks.length < 10) throw new Error('src/pages/Links.tsx: the link list was not found')
  body['/links'].sections.push(sec(null, { links: hubLinks }))

  // One page per product.
  const idx = (i) => C.PRODUCTS[(i + C.PRODUCTS.length) % C.PRODUCTS.length]
  C.PRODUCTS.forEach((p, i) => {
    const svc = C.SERVICES.find((s) => s.key === C.SERVICE_FOR[p.slug])
    body[`/products/${p.slug}`] = {
      h1: p.name,
      crumbs: [['/products', 'Products']],
      sections: [
        sec(null, {
          // (The line itself is the page's description, served just above.)
          p: [`${C.runsLine(p)}.`],
          links: [[p.url, p.cta ?? `Open ${p.urlLabel}`], ...(p.cta2 ? [[p.cta2[1], p.cta2[0]]] : []), ...(p.docs ? [[p.docs, `${p.name} docs`]] : [])],
        }),
        sec(C.PRODUCT_SECTIONS.features, { list: p.features.map((f) => `${f.t}: ${f.d}`) }),
        sec(C.PRODUCT_SECTIONS.how, { list: p.how.map(([t, d]) => `${t}: ${d}`) }),
        // A product with a live price table (read from /api/plans in the browser) shows no typed price here.
        ...(p.pricing === 'security' || p.pricing === 'holders' ? [] : [sec(C.PRODUCT_SECTIONS.pricing, { p: [C.pricingNote(p)] })]),
        sec(C.PRODUCT_SECTIONS.faq, { qa: C.productFaq(p) }),
        sec(C.PRODUCT_SECTIONS.links, { links: [['/status', 'Status of every Gully service'], ...(svc ? [[`/services?service=${svc.key}#contact`, `Service: ${svc.title}`]] : []), [`/products/${idx(i - 1).slug}`, idx(i - 1).name], ['/products', 'All products'], [`/products/${idx(i + 1).slug}`, idx(i + 1).name]] }),
      ],
    }
  })
  const product = Object.fromEntries(C.PRODUCTS.map((p) => [p.slug, { name: p.name, line: p.line, url: p.url, urlLabel: p.urlLabel, cta: p.cta ?? null, cta2: p.cta2 ?? null, docs: p.docs ?? null, group: p.group, hub: p.hub, og: p.og, category: p.category, features: p.features, how: p.how, price: C.pricingNote(p), faq: C.productFaq(p) }]))

  // One page per Peddle project.
  for (const p of projects) {
    body[`/projects/${p.slug}`] = {
      h1: p.name,
      sections: [sec(null, { p: [`${p.tag} · ${p.status} · ${p.chains.join(', ')}`], list: p.built, links: [[p.url, `Open ${p.name}`], ['/ecosystem', 'Every Gully Labs project']] })],
    }
  }
  const project = Object.fromEntries(projects.map((p) => [p.slug, { name: p.name, url: p.url, tag: p.tag }]))

  // Nothing may be empty, repeated or left with a runtime gap.
  for (const [p, b] of Object.entries(body)) {
    // holdermaps:<path> bodies take their title and description from server/seo.mjs (HM_LEGAL), not seoPages.ts.
    if (!meta[p] && !p.startsWith('holdermaps:')) throw new Error(`${p}: a page body with no title and description in src/content/seoPages.ts`)
    b.sections = b.sections.filter((s) => s.p.length || s.list.length || s.links.length || s.qa.length)
    if (!b.sections.length) throw new Error(`${p}: nothing could be read from its source`)
  }
  for (const p of Object.keys(meta)) if (!body[p] && !p.startsWith('/tracker/')) throw new Error(`${p}: a title with no page body`)

  // The landing (server/landing.mjs): the same words and marks the current landing uses.
  const statusWord = (p) => H.STATUS_LABEL[p.status]
  // `fact`: the card's fixed line when no live figure is worth showing.
  const FACT = { id: 'Passkeys, wallets, email', pay: 'Checkout and x402', chain: 'Arbitrum Orbit L3', rpc: 'One key, every network', holdermaps: 'Six chains', security: 'Scan, score, monitor', studio: 'Web and phone', ai: 'API coming online' }
  const productCard = (p) => ({ key: p.key, name: p.name, line: p.line, icon: p.icon, label: statusWord(p), fact: FACT[p.key], href: `/products/${p.page}` })
  const chainProduct = (slug, key, label, fact) => {
    const p = C.productBySlug(slug)
    return { key, name: p.name, line: p.short, icon: '/brand/web/logos/gc-icon.svg', label, fact, href: `/products/${slug}` }
  }
  const landing = {
    headline: H.LANDING_HEADLINE,
    lede: H.LANDING_LEDE,
    productsTitle: 'Where to go',
    productsSub: dir.p[0],
    // Gully Multisig and Gully Core: state and chains from the Gully Core manifest reading (src/content/gullyCore.generated.ts).
    products: [...H.HUB_PRODUCTS.map(productCard), chainProduct('safe', 'multisig', 'Live', GC.GULLY_CORE.multisigChains.map((n) => n.replace(/ (Network|Chain)$/, '').replace(/^Gully Chain testnet$/, 'Gully Chain')).join(' · ')), chainProduct('gully-core', 'core', GC.GULLY_CORE.liveMainnets.length ? 'Live' : 'Testnet', `${GC.GULLY_CORE.liveMainnets.length} mainnets · ${GC.GULLY_CORE.builderFeePct}% for builders`)],
    peddleTitle: 'Peddle family',
    peddleSub: 'Gully Labs projects for trading and DeFi, each on its own site.',
    peddle: H.PEDDLE_FAMILY.map((p) => ({ key: p.key, name: p.name, line: p.line, icon: p.logo, kind: p.kind, fact: P.projects.find((x) => x.slug === p.page).chains.join(', '), href: `/projects/${p.page}` })),
    newsTitle: "What's new",
    news: H.NEWS.slice(0, 4).map((n) => ({ d: n.d, t: n.t, href: n.href })),
    buildTitle: build.h,
    buildSub: contact.p[0],
  }

  // For JSON-LD: the landing's product list (name, own site) and the services (name, one line).
  const hub = [...H.HUB_PRODUCTS, ...H.PEDDLE_FAMILY].map((p) => [p.name, p.url])
  const services = C.SERVICES.map((s) => [s.title, s.desc])
  return { version: 1, nav, meta, stocks, stockCopy: K.STOCK_COPY, product, project, hub, services, landing, body }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const text = JSON.stringify(await build(), null, 1) + '\n'
  const current = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : null
  if (process.argv.includes('--check')) {
    console.log(current === text ? 'page content is up to date' : 'page content is OUT OF DATE: run node scripts/build-page-content.mjs and commit server/data/page-content.json')
    process.exit(current === text ? 0 : 1)
  }
  if (current === text) console.log('page content unchanged')
  else {
    fs.writeFileSync(OUT, text)
    console.log(`page content written: ${Object.keys(JSON.parse(text).meta).length} pages, ${text.length} bytes -> ${path.relative(ROOT, OUT)}`)
  }
}
