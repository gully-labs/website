// Builds the local part of the Gully Ask corpus into server/data/ask-index.json:
//   - the docs pages (src/docs/pages/*.tsx), one document per <Section>, at https://docs.gullylabs.xyz/<path>#<id>
//     (Gully Pay, Chain Kit and the L3 roadmap moved to their products' own docs on 2026-10-26 and are not here);
//   - the site's copy: src/content/*.ts and the Products, Pricing, Services and About pages, at https://gullylabs.xyz/...;
//   - the changelog (a docs page, labelled "Changelog");
//   - the legal pages (merchant terms, privacy policy, terms of service), one chunk run per numbered section, at /legal/<page>#s<n>;
//   - the Gully Pay contract notes (contracts/CHOICE.md, contracts/TESTNET-RESULTS.md) and the L3 spec
//     (ops/l3/SPEC.md, labelled "Roadmap"), capped in length, hashes and addresses shortened, at their GitHub
//     section anchors in the public gully-labs/website repo;
//   - the Telegram bot's help, menu and Gully AI screens (server/telegram-ui.mjs) and its command list;
//   - the Telegram Mini App's copy (src/pages/tg/*.tsx);
//   - the feature catalog (src/content/features.ts, source "Features"): one chunk per feature that is live, beta or
//     testnet; building and planned features only as "Roadmap" chunks that say they are NOT available yet. A missing
//     catalog is skipped with a warning (`--features <file>` reads another one, tests);
//   - every site page src/pages/*.tsx not listed above (Ecosystem, Partners, Chains, ...), found by glob, at /<kebab-name>;
//   - ops notes (ops/TREASURY-SAFE.md, ops/LAUNCHPAD-INTEGRATION.md when it exists) and the READMEs of our public repos
//     (sdk, website, the forks' Gully headers), read from local clones when present (GULLY_REPOS_DIR, default the folder
//     next to this repo) at their GitHub URLs; a missing clone keeps its chunks from the committed index.
// The blog is not here: ask-remote.mjs reads it from the Ghost Content API at runtime (GHOST_CONTENT_KEY).
//
//   npm run ask:index            rebuild (also runs as `prebuild`, so every build ships a fresh index)
//   npm run ask:index -- --check exit 1 if the committed file is out of date (no write)
//   npm run ask:index -- --print print every chunk, to read the extracted prose by eye
//   npm run ask:index -- --out <file>  write to another file (tests)
//
// Text is pulled from the TypeScript syntax tree (the compiler is a dev dependency): JSX text, string
// literals inside JSX, and prose fields of top-level data objects. Code blocks, class names, URLs,
// icons and anything computed at runtime are left out. Deterministic: a chunk whose text did not change
// keeps its previous updatedAt, so rebuilding an unchanged tree rewrites the same bytes.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { chunkId, chunkSection, clean, githubAnchor, markdownSections } from '../server/ask-index.mjs'
import { aiIntroView, helpView, menuCaption } from '../server/telegram-ui.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const argv = process.argv.slice(2)
const outAt = argv.indexOf('--out')
const OUT = outAt >= 0 && argv[outAt + 1] ? path.resolve(argv[outAt + 1]) : path.join(ROOT, 'server', 'data', 'ask-index.json')
const DOCS = 'https://docs.gullylabs.xyz'
const SITE = 'https://gullylabs.xyz'
const REPO = 'https://github.com/gully-labs/website/blob/main'
const BOT = 'https://t.me/GullyLabsBot'
const args = new Set(argv)
/** Code or markup leaking into prose: the build refuses a chunk that matches. */
const CODE_RE = /className=|=>|\bimport\s+[\w{]|\bconst\s+\w+\s*=|<\/?(div|span|p|a|li|ul|ol|code|section|h[1-6]|button|svg|path|img|br|strong|em)\b[^>]*>|\bfunction\s*\(/i

const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')
const parse = (rel) => ts.createSourceFile(rel, read(rel), ts.ScriptTarget.Latest, true, rel.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)

/* -------------------------------------------------------------- JSX text --- */

const SKIP_TAGS = new Set(['CodeBlock', 'pre', 'svg', 'script', 'style', 'img', 'Seo', 'caption', 'thead'])
const BLOCK_TAGS = new Set(['p', 'P', 'li', 'ul', 'ol', 'List', 'div', 'section', 'article', 'header', 'footer', 'Callout', 'h1', 'h2', 'h3', 'h4', 'H3', 'dl', 'dt', 'dd', 'table', 'tr', 'td', 'th', 'blockquote', 'form', 'label', 'details', 'summary', 'nav', 'aside', 'main', 'figure', 'figcaption'])
const HEADING_TAGS = new Set(['h1', 'h2'])
const HEADING = '\u0000H:'
const GAP = '\u0001'
/** Docs keep a sentence with a runtime gap (the gap is dropped). */
const docProse = (p) => p.replaceAll(GAP, '').replace(/\s+([,.;:])/g, '$1')
/** Site pages drop such sentences, and eyebrows and bare calls to action too. */
function siteProse(p) {
  if (p.includes(GAP)) return false
  const t = p.replace(HEADING, '')
  const letters = t.replace(/[^A-Za-z]/g, '')
  if (letters.length && t.replace(/[^A-Z]/g, '').length / letters.length > 0.4) return false
  return t.split(' ').length >= 4 && !/→\s*$/.test(t)
}

const tagName = (n) => (ts.isJsxElement(n) ? n.openingElement.tagName : n.tagName).getText()
const attrsOf = (n) => (ts.isJsxElement(n) ? n.openingElement.attributes : n.attributes).properties
function attr(n, name) {
  const a = attrsOf(n).find((p) => ts.isJsxAttribute(p) && p.name.getText() === name)
  if (!a?.initializer) return null
  if (ts.isStringLiteral(a.initializer)) return { str: a.initializer.text }
  if (ts.isJsxExpression(a.initializer)) return { expr: a.initializer.expression }
  return null
}

function jsxTextValue(t) {
  const raw = t.text
  if (/^\s*$/.test(raw) && raw.includes('\n')) return ''
  return raw.replace(/\s*\n\s*/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&apos;/g, "'").replace(/&quot;/g, '"')
}

/** Literal text of an expression, or null when it is computed at runtime. */
function literal(e) {
  if (!e) return null
  if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) return e.text
  if (ts.isParenthesizedExpression(e)) return literal(e.expression)
  if (ts.isTemplateExpression(e)) return e.head.text + e.templateSpans.map((s) => '(live value)' + s.literal.text).join('')
  return null
}

/** Paragraphs of readable text under a JSX node. A paragraph starting with HEADING opens a section. */
function blocks(root) {
  const out = []
  let cur = ''
  const flush = () => {
    const t = clean(cur)
    if (t) out.push(t)
    cur = ''
  }
  const visit = (n) => {
    if (ts.isJsxText(n)) return void (cur += jsxTextValue(n))
    if (ts.isJsxExpression(n)) {
      const lit = n.expression && (ts.isStringLiteral(n.expression) || ts.isNoSubstitutionTemplateLiteral(n.expression)) ? n.expression.text : null
      if (lit !== null) cur += lit
      // Conditionals, .map() callbacks and variables are runtime state: left out, with a marker so a
      // caller can drop the sentence it leaves broken.
      else if (n.expression) cur += GAP
      return
    }
    if (ts.isJsxFragment(n)) return n.children.forEach(visit)
    if (ts.isJsxElement(n) || ts.isJsxSelfClosingElement(n)) {
      const tag = tagName(n)
      if (SKIP_TAGS.has(tag)) return
      if (tag === 'br') return void (cur += ' ')
      if (tag === 'Fields') {
        flush()
        const rows = attr(n, 'rows')?.expr
        if (rows && ts.isArrayLiteralExpression(rows)) {
          for (const r of rows.elements) {
            if (!ts.isArrayLiteralExpression(r)) continue
            const parts = r.elements.map((e) => literal(e) ?? (ts.isJsxElement(e) || ts.isJsxFragment(e) || ts.isJsxSelfClosingElement(e) ? blocks(e).join(' ') : ''))
            const [f, t, m] = parts
            if (f || m) out.push(clean(`${f}${t ? ` (${t})` : ''}: ${m ?? ''}`))
          }
        }
        return
      }
      if (ts.isJsxSelfClosingElement(n)) return
      const block = BLOCK_TAGS.has(tag)
      if (block) flush()
      const before = out.length
      n.children.forEach(visit)
      if (block) flush()
      if (HEADING_TAGS.has(tag) && out.length > before) out[before] = HEADING + out.splice(before).join(' ')
      return
    }
  }
  visit(root)
  flush()
  return out
}

/** Every node of a kind under `root`, in source order. */
function findAll(root, pred) {
  const found = []
  const walk = (n) => {
    if (pred(n)) found.push(n)
    ts.forEachChild(n, walk)
  }
  walk(root)
  return found
}

/* ----------------------------------------------------------- data objects --- */

const NAME_KEYS = ['name', 'title', 'q']
const BODY_KEYS = ['tagline', 'description', 'body', 'lead', 'a', 'status', 'time', 'licence', 'cta']
const LIST_KEYS = { items: 'Includes', built: 'Built', chains: 'Chains', features: null, how: 'How it works', seo: null, gets: 'What you get', limits: 'Limits' }
const keyOf = (p) => (p.name && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)) ? p.name.text : null)

/** Readable paragraphs from a data literal: one per object with a name or title, in source order. */
function objectProse(e, out = []) {
  if (!e) return out
  if (ts.isParenthesizedExpression(e) || ts.isAsExpression(e) || ts.isSatisfiesExpression?.(e)) return objectProse(e.expression, out)
  if (ts.isArrowFunction(e)) return objectProse(e.body, out)
  if (ts.isArrayLiteralExpression(e)) {
    for (const x of e.elements) objectProse(x, out)
    return out
  }
  if (!ts.isObjectLiteralExpression(e)) return out
  const props = new Map(e.properties.filter(ts.isPropertyAssignment).map((p) => [keyOf(p), p.initializer]))
  const textOf = (k) => {
    const v = props.get(k)
    if (!v) return null
    if (ts.isArrayLiteralExpression(v) && v.elements.every((x) => literal(x) !== null)) return v.elements.map(literal).join(' ')
    return literal(v)
  }
  const name = NAME_KEYS.map(textOf).find(Boolean)
  const lines = []
  if (name) {
    const tag = textOf('tag')
    lines.push(props.has('q') ? `Q: ${name}` : `${name}${tag ? ` (${tag})` : ''}`)
  }
  for (const k of BODY_KEYS) {
    const t = textOf(k)
    if (t && !(k === 'status' && !name)) lines.push(k === 'a' ? `A: ${t}` : k === 'time' ? `Typical timeline: ${t}.` : t)
  }
  for (const [k, label] of Object.entries(LIST_KEYS)) {
    const v = props.get(k)
    if (!v) continue
    if (ts.isArrayLiteralExpression(v) && v.elements.length && v.elements.every((x) => literal(x) !== null)) {
      if (label) lines.push(`${label}: ${v.elements.map(literal).join('; ')}.`)
    } else objectProse(v, (lines.nested ??= []))
  }
  const t = clean(lines.join(name ? '. ' : ' ').replace(/([.?!:])\. /g, '$1 ').replace(/\.\./g, '.'))
  if (t && (name || lines.length > 1 || t.split(' ').length > 6)) out.push(t)
  if (lines.nested) out.push(...lines.nested)
  return out
}

/** The initializer of a top-level `const NAME = …`, or null. */
function topConst(sf, name) {
  for (const st of sf.statements) {
    if (!ts.isVariableStatement(st)) continue
    for (const d of st.declarationList.declarations) {
      if (d.name.getText() !== name) continue
      let e = d.initializer ?? null
      while (e && (ts.isAsExpression(e) || ts.isParenthesizedExpression(e) || ts.isSatisfiesExpression?.(e))) e = e.expression
      return e
    }
  }
  return null
}

/* ------------------------------------------------------------------ docs --- */

function docRoutes() {
  const src = read('src/docs/routes.tsx')
  const map = new Map()
  for (const m of src.matchAll(/\{\s*(index:\s*true|path:\s*'([^']*)')[^}]*?import\('\.\/pages\/(\w+)'\)/g)) {
    if (m[2] === '*') continue
    map.set(m[3], m[1].startsWith('index') ? '' : m[2])
  }
  return map
}

function docsChunks() {
  const routes = docRoutes()
  const chunks = []
  // Every page file should be routed (and so indexed); say so when one is not, so a new docs page is never silently missed.
  for (const f of fs.readdirSync(path.join(ROOT, 'src/docs/pages'))) {
    const name = f.replace(/\.tsx$/, '')
    if (f.endsWith('.tsx') && name !== 'NotFound' && !routes.has(name)) console.warn(`warning: src/docs/pages/${f} has no route in src/docs/routes.tsx: not indexed`)
  }
  for (const [file, slug] of routes) {
    const rel = `src/docs/pages/${file}.tsx`
    const sf = parse(rel)
    const page = findAll(sf, (n) => (ts.isJsxElement(n) || ts.isJsxSelfClosingElement(n)) && tagName(n) === 'DocPage')[0]
    if (!page) throw new Error(`${rel}: no <DocPage>`)
    const title = attr(page, 'title')?.str ?? file
    const url = `${DOCS}/${slug}`.replace(/\/$/, '') || DOCS
    const source = file === 'Changelog' ? 'Changelog' : 'Docs'
    const leadA = attr(page, 'lead')
    const lead = leadA?.str ?? (leadA?.expr ? (literal(leadA.expr) ?? docProse(blocks(leadA.expr).join(' '))) : '')
    const intro = [lead, attr(page, 'description')?.str ?? ''].filter(Boolean)
    const sections = []
    for (const child of ts.isJsxElement(page) ? page.children : []) {
      if ((ts.isJsxElement(child) || ts.isJsxSelfClosingElement(child)) && tagName(child) === 'Section') {
        sections.push({ id: attr(child, 'id')?.str, title: attr(child, 'title')?.str, paragraphs: blocks(child).map((p) => docProse(p.replace(HEADING, ''))) })
      } else intro.push(...blocks(child).map((p) => docProse(p.replace(HEADING, ''))))
    }
    chunks.push(...chunkSection({ source, title, url: url === DOCS ? `${DOCS}/` : url, section: null, paragraphs: intro }))
    for (const s of sections) {
      if (!s.paragraphs.length) continue
      chunks.push(...chunkSection({ source, title, url: `${url === DOCS ? DOCS + '/' : url}#${s.id}`, section: s.title ?? s.id, paragraphs: s.paragraphs }))
    }
  }
  return chunks
}

/* ------------------------------------------------------------------ site --- */

const SITE_PAGES = [
  { file: 'src/pages/Products.tsx', jsx: false, consts: { ANALYTICS: { url: '/analytics', title: 'Gully Analytics' } } },
  { file: 'src/pages/Pricing.tsx', url: '/pricing', title: 'API pricing', consts: { FAQ: { section: 'Questions' } } },
  { file: 'src/pages/Services.tsx', url: '/services', title: 'Services' },
  { file: 'src/pages/About.tsx', url: '/about', title: 'About Gully Labs' },
  { file: 'src/pages/security/SecurityPage.tsx', url: '/security', title: 'Gully Security', consts: { TIERS: { section: 'Tiers' }, HOW: { section: 'How a scan works' } } },
  { file: 'src/pages/HoldersLanding.tsx', url: '/holders', title: 'Holder Map' },
  { file: 'src/pages/score/ScoreIndex.tsx', url: '/score', title: 'Gully Score' },
  { file: 'src/pages/Status.tsx', url: '/status', title: 'Status' },
  { file: 'src/pages/hub/Constellation.tsx', url: '/', title: 'Gully Labs home' },
  { file: 'src/pages/Tracker.tsx', url: '/tracker', title: 'Stock token tracker' },
  { file: 'src/pages/widget/WidgetPage.tsx', url: '/widget', title: 'Tracker widget' },
  { file: 'src/components/landing/ProductConsole.tsx', jsx: false, consts: { SECURITY_STEPS: { url: '/#security', title: 'Gully Security on the home page', section: 'What is live, on request and not offered' } } },
]

/** Splits paragraphs (with HEADING markers) into sections. */
function sectioned(paragraphs, first = null) {
  const out = [{ section: first, paragraphs: [] }]
  for (const p of paragraphs) {
    if (p.startsWith(HEADING)) out.push({ section: p.slice(HEADING.length), paragraphs: [] })
    else out.at(-1).paragraphs.push(p)
  }
  return out.filter((s) => s.paragraphs.length)
}

function seoDescription(sf) {
  const seo = findAll(sf, (n) => ts.isJsxSelfClosingElement(n) && tagName(n) === 'Seo')[0]
  return seo ? (attr(seo, 'description')?.str ?? null) : null
}

/** Top-level site pages that are not marketing copy (app shells, redirects, per-item views) or are read elsewhere. */
const AUTO_SKIP = new Set(['Home', 'Links', 'NotFound', 'RouteError', 'GoTo', 'LazyRoutes', 'ProjectDetail', 'StockPage', 'HoldersPage', 'EmbedHolders'])
const AUTO_TITLES = { Chains: 'Gully Chains', Ecosystem: 'Gully Labs ecosystem', Partners: 'Gully Labs partners' }
const kebab = (n) => n.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase()

/** Pages src/pages/*.tsx that SITE_PAGES does not list (Ecosystem, Partners, Chains once merged, ...): found by glob, served at /<kebab-name>. */
function autoSitePages() {
  const listed = new Set(SITE_PAGES.map((p) => p.file))
  return fs
    .readdirSync(path.join(ROOT, 'src/pages'))
    .filter((f) => /^[A-Z]\w*\.tsx$/.test(f) && !AUTO_SKIP.has(f.replace('.tsx', '')) && !listed.has(`src/pages/${f}`))
    .sort()
    .map((f) => {
      const name = f.replace('.tsx', '')
      return { file: `src/pages/${f}`, url: `/${kebab(name)}`, title: AUTO_TITLES[name] ?? name.replace(/([a-z])([A-Z])/g, '$1 $2') }
    })
}

function siteChunks() {
  const chunks = []
  for (const pg of [...SITE_PAGES, ...autoSitePages()]) {
    const sf = parse(pg.file)
    if (pg.jsx !== false) {
      const fn = sf.statements.find((s) => ts.isFunctionDeclaration(s) && s.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword))
      const paras = []
      const desc = seoDescription(sf)
      if (desc) paras.push(desc)
      // Top-level JSX roots in the exported page and its helper components, in source order.
      const insideJsx = (n) => {
        for (let a = n.parent; a; a = a.parent) if (ts.isJsxElement(a) || ts.isJsxFragment(a) || ts.isJsxSelfClosingElement(a)) return true
        return false
      }
      const roots = findAll(fn ?? sf, (n) => (ts.isJsxElement(n) || ts.isJsxFragment(n)) && !insideJsx(n))
      for (const r of roots) paras.push(...blocks(r).filter((p) => p.startsWith(HEADING) || siteProse(p)))
      for (const s of sectioned(paras)) chunks.push(...chunkSection({ source: 'Site', title: pg.title, url: SITE + pg.url, section: s.section, paragraphs: s.paragraphs }))
    }
    for (const [name, c] of Object.entries(pg.consts ?? {})) {
      const init = topConst(sf, name)
      if (!init) throw new Error(`${pg.file}: no const ${name}`)
      chunks.push(...chunkSection({ source: 'Site', title: c.title ?? pg.title, url: SITE + (c.url ?? pg.url), section: c.section ?? null, paragraphs: objectProse(init) }))
    }
  }

  // src/content: projects (one page each), services, and the site's links.
  const projects = parse('src/content/projects.ts')
  const list = topConst(projects, 'projects')
  for (const el of list && ts.isArrayLiteralExpression(list) ? list.elements : []) {
    if (!ts.isObjectLiteralExpression(el)) continue
    const get = (k) => {
      const p = el.properties.find((x) => ts.isPropertyAssignment(x) && keyOf(x) === k)
      return p ? literal(p.initializer) : null
    }
    const slug = get('slug')
    const name = get('name')
    const paras = objectProse(el)
    const site = get('url')
    if (site) paras.push(`${name}'s own site: ${site}`)
    chunks.push(...chunkSection({ source: 'Site', title: `${name}, a Gully Labs project`, url: `${SITE}/projects/${slug}`, section: null, paragraphs: paras }))
  }
  const services = parse('src/content/services.ts')
  chunks.push(...chunkSection({ source: 'Site', title: 'Services', url: `${SITE}/services`, section: 'What we build', paragraphs: objectProse(topConst(services, 'services')) }))
  chunks.push(...chunkSection({ source: 'Site', title: 'Services', url: `${SITE}/services`, section: 'How we work', paragraphs: objectProse(topConst(services, 'processSteps')) }))
  const budgets = topConst(services, 'budgets')
  if (budgets && ts.isArrayLiteralExpression(budgets)) {
    chunks.push(...chunkSection({ source: 'Site', title: 'Services', url: `${SITE}/services`, section: 'Budgets', paragraphs: [`The contact form offers these project budget ranges: ${budgets.elements.map(literal).join(', ')}. Send an enquiry from the Services page or any "Talk to us" button.`] }))
  }
  const site = parse('src/content/site.ts')
  const links = []
  // Every { label, to | href } object in the site's menus (nested groups included) and the socials.
  const resolveHref = (node) => {
    if (!node) return null
    const lit = literal(node)
    if (lit) return lit
    if (ts.isTemplateExpression(node) || ts.isNoSubstitutionTemplateLiteral(node))
      return node.getText(site).slice(1, -1).replace(/\$\{DOCS_URL\}/g, 'https://docs.gullylabs.xyz').replace(/\$\{APP_URL\}/g, 'https://app.gullylabs.xyz').replace(/\$\{SITE_URL\}/g, SITE)
    if (ts.isIdentifier(node)) return { APP_URL: 'https://app.gullylabs.xyz', DOCS_URL: 'https://docs.gullylabs.xyz', SITE_URL: SITE }[node.text] ?? null
    return null
  }
  for (const name of ['socialLinks', 'productsNav', 'developersNav', 'companyNav', 'navLinks']) {
    const init = topConst(site, name)
    if (!init) throw new Error(`src/content/site.ts: no const ${name}`)
    for (const el of findAll(init, (n) => ts.isObjectLiteralExpression(n))) {
      const prop = (k) => el.properties.find((x) => ts.isPropertyAssignment(x) && keyOf(x) === k)?.initializer ?? null
      const label = literal(prop('label'))
      const to = literal(prop('to'))
      const href = resolveHref(prop('href')) ?? (to === '/developers' || to === '/app' ? 'https://app.gullylabs.xyz' : to ? SITE + to : null)
      const desc = literal(prop('desc'))
      if (label && href && !/\$\{/.test(href) && !links.some((l) => l.includes(`: ${href}`))) links.push(`${label}: ${href}`)
    }
  }
  // The /links hub's own list (read as text, campaign tags dropped): only what the menus above do not already name.
  const hub = read('src/pages/Links.tsx')
  const hubLinks = [...hub.matchAll(/label: '([^']+)', desc: '[^']+', href: (?:utm\()?'([^']+)'/g)]
  if (hubLinks.length < 10) throw new Error('src/pages/Links.tsx: the link list was not found')
  for (const [, label, href] of hubLinks) if (!links.some((l) => l.includes(`: ${href.replace(/\/$/, '')}`))) links.push(`${label}: ${href}`)
  links.push(`Every link in one place: ${SITE}/links`)
  chunks.push(...chunkSection({ source: 'Site', title: 'Gully Labs links and contact', url: `${SITE}/`, section: null, paragraphs: [`Where to find Gully Labs. ${links.join('. ')}. For project enquiries use the contact form on ${SITE}/services.`] }))
  return chunks
}

/* ----------------------------------------------------------------- legal --- */

const LEGAL_PAGES = [
  { file: 'src/pages/legal/MerchantTerms.tsx', url: '/legal/merchant-terms', title: 'Gully Pay merchant terms' },
  { file: 'src/pages/legal/Privacy.tsx', url: '/legal/privacy', title: 'Privacy policy', table: { name: 'RETENTION', section: 11 } },
  { file: 'src/pages/legal/ScanTerms.tsx', url: '/legal/scan-terms', title: 'AI Security Scan terms' },
  { file: 'src/pages/legal/Terms.tsx', url: '/legal/terms', title: 'Terms of Service' },
]

/** The legal pages: the header's prose, then each numbered <S n={k} title="…"> at #s<k>. */
function legalChunks() {
  const chunks = []
  for (const pg of LEGAL_PAGES) {
    const sf = parse(pg.file)
    const url = SITE + pg.url
    const header = findAll(sf, (n) => ts.isJsxElement(n) && tagName(n) === 'header')[0]
    const intro = header ? blocks(header).map((p) => docProse(p.replace(HEADING, ''))).filter((p) => p.split(' ').length >= 8) : []
    chunks.push(...chunkSection({ source: 'Legal', title: pg.title, url, section: null, paragraphs: intro }))
    const extra = {}
    if (pg.table) {
      const t = topConst(sf, pg.table.name)
      if (!t || !ts.isArrayLiteralExpression(t)) throw new Error(`${pg.file}: no const ${pg.table.name}`)
      extra[pg.table.section] = t.elements.filter(ts.isArrayLiteralExpression).map((r) => `${literal(r.elements[0])}: ${literal(r.elements[1])}.`)
    }
    for (const s of findAll(sf, (n) => ts.isJsxElement(n) && tagName(n) === 'S')) {
      const nExpr = attr(s, 'n')?.expr
      const n = nExpr && ts.isNumericLiteral(nExpr) ? Number(nExpr.text) : null
      const title = attr(s, 'title')?.str
      if (!n || !title) throw new Error(`${pg.file}: a section without n or title`)
      const paragraphs = [...blocks(s).map((p) => docProse(p.replace(HEADING, ''))).filter((p) => p.replace(/[^A-Za-z]/g, '').length > 3), ...(extra[n] ?? [])]
      chunks.push(...chunkSection({ source: 'Legal', title: pg.title, url: `${url}#s${n}`, section: title, paragraphs }))
    }
  }
  return chunks
}

/* ------------------------------------------------- markdown in this repo --- */

const REPO_DOCS = [
  { file: 'contracts/CHOICE.md', source: 'Gully Pay contracts', title: 'Gully Pay fee split: which contract and why', maxWords: 1_400 },
  { file: 'contracts/TESTNET-RESULTS.md', source: 'Gully Pay contracts', title: 'Gully Pay fee path: testnet results', maxWords: 900 },
  { file: 'ops/l3/SPEC.md', source: 'Roadmap', title: 'Roadmap: the Gully L3 spec', maxWords: 2_200 },
  { file: 'ops/TREASURY-SAFE.md', source: 'Ops notes', title: 'Treasury Safe: how the Gully Labs treasury Safe is deployed', maxWords: 1_200 },
  { file: 'ops/LAUNCHPAD-INTEGRATION.md', source: 'Ops notes', title: 'Launchpad integration: Holder Map on launchpads', maxWords: 1_200, optional: true },
]
const SECRET_LINE = /(private|secret|mnemonic|seed|api)[ _-]?(key|phrase)?\s*[=:]|BEGIN [A-Z ]*PRIVATE KEY|\bsk-[A-Za-z0-9]/i

/** No secrets, 32-byte hex (keys, hashes) dropped, addresses shortened. */
const redact = (md) =>
  String(md)
    .split('\n')
    .filter((l) => !SECRET_LINE.test(l))
    .join('\n')
    .replace(/\b0x[0-9a-fA-F]{64}\b/g, '(hash)')
    .replace(/\b(0x[0-9a-fA-F]{4})[0-9a-fA-F]{32}([0-9a-fA-F]{4})\b/g, '$1…$2')

/** Summarised repo notes: capped in words, redacted. */
function repoDocChunks() {
  const chunks = []
  for (const d of REPO_DOCS) {
    if (d.optional && !fs.existsSync(path.join(ROOT, d.file))) continue
    const md = redact(read(d.file))
    for (const s of markdownSections(md, { maxWords: d.maxWords })) {
      const paragraphs = s.paras.filter((p) => !CODE_RE.test(p))
      if (!paragraphs.length) continue
      chunks.push(...chunkSection({ source: d.source, title: d.title, url: `${REPO}/${d.file}${s.heading ? `#${githubAnchor(s.heading)}` : ''}`, section: s.heading, paragraphs }))
    }
  }
  return chunks
}

/* ---------------------------------------------------------- public READMEs --- */

const GH = 'https://github.com/gully-labs'
// Local clones sit next to this repo (GULLY_REPOS_DIR overrides). `dir: null` is this repo. The forks' READMEs are
// mostly upstream text, so they are capped short: the Gully header and the first sections.
const README_REPOS = [
  { repo: 'sdk', dir: 'gully-sdk', branch: 'main', title: 'Gully SDK (gully-labs/sdk README)', maxWords: 900 },
  { repo: 'website', dir: null, branch: 'main', title: 'gullylabs.xyz website (gully-labs/website README)', maxWords: 900 },
  { repo: 'umami', dir: 'gully-umami', branch: 'gully/analytics', title: 'Gully Analytics, the Umami fork (gully-labs/umami README)', maxWords: 450 },
  { repo: 'arbitrum-token-bridge', dir: 'gully-bridge', branch: 'gully/main', title: 'Gully Bridge, the Arbitrum token bridge fork (gully-labs/arbitrum-token-bridge README)', maxWords: 450 },
]
const REPOS_DIR = path.resolve(process.env.GULLY_REPOS_DIR ?? path.join(ROOT, '..'))

/** READMEs of our public repos at their GitHub URLs. A repo with no local clone keeps its chunks from the committed index. */
function readmeChunks(previousChunks) {
  const chunks = []
  for (const r of README_REPOS) {
    const file = r.dir === null ? path.join(ROOT, 'README.md') : path.join(REPOS_DIR, r.dir, 'README.md')
    const page = `${GH}/${r.repo}/blob/${r.branch}/README.md`
    if (!fs.existsSync(file)) {
      const kept = previousChunks.filter((c) => c.source === 'GitHub README' && (c.url === page || c.url.startsWith(`${page}#`)))
      console.warn(`warning: no local clone for ${r.repo} (${file}): ${kept.length ? `keeping its ${kept.length} chunks from the committed index` : 'skipped'}`)
      chunks.push(...kept.map(({ updatedAt: _u, ...c }) => c))
      continue
    }
    for (const s of markdownSections(redact(fs.readFileSync(file, 'utf8')), { maxWords: r.maxWords })) {
      const paragraphs = s.paras.filter((p) => !CODE_RE.test(p))
      if (!paragraphs.length) continue
      chunks.push(...chunkSection({ source: 'GitHub README', title: r.title, url: s.heading ? `${page}#${githubAnchor(s.heading)}` : page, section: s.heading, paragraphs }))
    }
  }
  return chunks
}

/* ------------------------------------------------------------ feature catalog --- */

const STATUSES = { live: 'live now', beta: 'in beta (usable, and still changing)', testnet: 'on testnet only, not on mainnet yet', building: 'being built', planned: 'planned' }
const AVAILABLE = new Set(['live', 'beta', 'testnet'])
/** Where a product lives, by the product's name: the docs page, else the site page. */
const PRODUCT_PAGES = [
  [/solana pay/i, `${DOCS}/solana-pay`],
  [/gully pay|merchant/i, `${DOCS}/gully-pay`],
  [/holder/i, `${DOCS}/holder-map`],
  [/security/i, `${DOCS}/gully-security`],
  [/score/i, `${DOCS}/gully-score`],
  [/tracker|stock/i, `${SITE}/tracker`],
  [/gully ai|\bask\b/i, `${DOCS}/gully-ai`],
  [/mini ?app/i, `${DOCS}/telegram-mini-app`],
  [/news gate/i, `${DOCS}/news-gate`],
  [/telegram|bot/i, `${DOCS}/telegram`],
  [/analytics/i, `${DOCS}/analytics`],
  [/chain kit/i, `${DOCS}/chain-kit`],
  [/chains?\b/i, `${SITE}/chain-kit`],
  [/sdk/i, `${DOCS}/sdk`],
  [/widget/i, `${DOCS}/widget`],
  [/solana/i, `${DOCS}/solana`],
  [/swap/i, `${DOCS}/swaps`],
  [/status/i, `${DOCS}/status`],
]
const productPage = (product) => PRODUCT_PAGES.find(([re]) => re.test(product))?.[1] ?? `${SITE}/products`

/** The catalog (src/content/features.ts, or --features <file>), or null with a warning when it is missing. */
async function loadFeatures() {
  const at = argv.indexOf('--features')
  const file = at >= 0 && argv[at + 1] ? path.resolve(argv[at + 1]) : path.join(ROOT, 'src/content/features.ts')
  if (!fs.existsSync(file)) {
    console.warn(`warning: ${path.relative(ROOT, file)} is missing: the feature catalog is not indexed (it is merged separately)`)
    return null
  }
  const js = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
  const mod = await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`)
  if (!Array.isArray(mod.features)) throw new Error(`${file}: no exported features array`)
  return mod.features
}

/**
 * One chunk per feature. live, beta and testnet go in under "Features" with their honest status; building and planned
 * go in only as "Roadmap" chunks that say, in so many words, that the feature is NOT available yet.
 */
function featureChunks(features) {
  const chunks = []
  const ids = new Set()
  for (const f of features ?? []) {
    if (!f || typeof f.id !== 'string' || typeof f.name !== 'string' || typeof f.summary !== 'string' || !Object.hasOwn(STATUSES, f.status)) throw new Error(`features: a malformed entry ${JSON.stringify(f?.id ?? f?.name ?? f)}`)
    if (ids.has(f.id)) throw new Error(`features: duplicate id ${f.id}`)
    ids.add(f.id)
    const facts = (Array.isArray(f.facts) ? f.facts : []).map((x) => clean(redact(x))).filter(Boolean)
    const product = f.product || 'Gully Labs'
    if (AVAILABLE.has(f.status)) {
      const url = f.url && /^https:\/\//.test(f.url) ? f.url : productPage(product)
      chunks.push(...chunkSection({ source: 'Features', title: `${f.name} (${product})`, url, section: f.name, paragraphs: [`${f.name} is part of ${product}. Status: ${STATUSES[f.status]}.`, f.summary, ...facts] }).map((c) => ({ ...c, feature: f.id, status: f.status })))
    } else {
      chunks.push(
        ...chunkSection({
          source: 'Roadmap',
          title: `Roadmap: ${f.name} (${product}), not available yet`,
          url: productPage(product),
          section: `${f.name} (${f.status})`,
          paragraphs: [`${f.name} (${product}) is ${STATUSES[f.status]} and is NOT available yet: coming soon, with no date. Do not tell anyone they can use it today.`, f.summary, ...facts],
        }).map((c) => ({ ...c, feature: f.id, status: f.status })),
      )
    }
  }
  return chunks
}

/* -------------------------------------------------------------- Telegram --- */

const stripHtml = (s) => clean(String(s).replace(/<[^>]+>/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'))

/** The bot's own words: menu, help (with and without a linked wallet), the Gully AI intro and the command list. */
function telegramChunks() {
  // server/telegram.mjs keeps the menu's commands in `const COMMANDS = { name: '<emoji> description', … }` (read as text:
  // importing the bot module here would start its side effects). The leading emoji is dropped for the index.
  const block = read('server/telegram.mjs').match(/const COMMANDS = \{([\s\S]*?)\r?\n\}/)?.[1] ?? ''
  const commands = [...block.matchAll(/^\s+(\w+): '([^']+)',?\r?$/gm)].map((m) => `/${m[1]}: ${m[2].replace(/^[^\p{L}\p{N}/]+/u, '')}.`)
  if (!commands.length) throw new Error('server/telegram.mjs: no bot commands found')
  const help = [...new Set([...helpView(false).text.split('\n'), ...helpView(true).text.split('\n')])].map(stripHtml).filter(Boolean)
  return [
    ...chunkSection({ source: 'Telegram bot', title: 'Gully Labs Telegram bot (@GullyLabsBot)', url: BOT, section: 'Help', paragraphs: [stripHtml(menuCaption(null)), ...help, 'To use the bot you follow the Gully Labs News channel (https://t.me/GullyLabsNews); alerts you already set up still arrive either way.'] }),
    ...chunkSection({ source: 'Telegram bot', title: 'Gully Labs Telegram bot (@GullyLabsBot)', url: BOT, section: 'Commands', paragraphs: [`The bot's commands. ${commands.join(' ')}`, ...stripHtml(aiIntroView().text).split(/(?<=\.)\s+(?=[A-Z])/).filter(Boolean)] }),
  ]
}

/** The Mini App's copy (Telegram's in-app web view at gullylabs.xyz/tg). */
function miniAppChunks() {
  const paras = []
  for (const f of ['src/pages/tg/TgApp.tsx', 'src/pages/tg/screens.tsx']) {
    const sf = parse(f)
    const insideJsx = (n) => {
      for (let a = n.parent; a; a = a.parent) if (ts.isJsxElement(a) || ts.isJsxFragment(a) || ts.isJsxSelfClosingElement(a)) return true
      return false
    }
    for (const r of findAll(sf, (n) => (ts.isJsxElement(n) || ts.isJsxFragment(n)) && !insideJsx(n))) paras.push(...blocks(r).filter((p) => !p.startsWith(HEADING) && siteProse(p)))
  }
  const uniq = [...new Set(paras)].filter((p) => !CODE_RE.test(p))
  return chunkSection({ source: 'Telegram Mini App', title: 'Gully Labs Mini App in Telegram', url: `${SITE}/tg`, section: null, paragraphs: [`The Gully Labs Mini App opens inside Telegram from @GullyLabsBot's "Open app" button. It shows the stock token gaps, DeepCore launches and your alerts.`, ...uniq] })
}

/* ------------------------------------------------------------------ main --- */

let previous = null
try {
  previous = JSON.parse(fs.readFileSync(OUT, 'utf8'))
} catch {
  /* first build */
}
const prevById = new Map((previous?.chunks ?? []).map((c) => [c.id, c]))
const now = new Date().toISOString()
const seen = new Map()
const chunks = [...docsChunks(), ...siteChunks(), ...legalChunks(), ...repoDocChunks(), ...telegramChunks(), ...miniAppChunks(), ...readmeChunks(previous?.chunks ?? []), ...featureChunks(await loadFeatures())].map((c0) => {
  // Two blocks of one page under the same heading (a page's own "Questions" and its FAQ data) share a seed.
  const k = seen.get(c0.id) ?? 0
  seen.set(c0.id, k + 1)
  const c = k ? { ...c0, id: chunkId(c0.id, k) } : c0
  const old = prevById.get(c.id)
  return { ...c, updatedAt: old && old.text === c.text && old.url === c.url && old.title === c.title && old.section === c.section ? old.updatedAt : now }
})
const ids = new Set()
for (const c of chunks) {
  if (ids.has(c.id)) throw new Error(`duplicate chunk id ${c.id} (${c.url})`)
  ids.add(c.id)
  // Guard against code or markup leaking into the prose.
  const at = c.text.search(CODE_RE)
  if (at >= 0) throw new Error(`chunk ${c.id} (${c.url}) looks like code near: …${c.text.slice(Math.max(0, at - 60), at + 100)}…`)
}
const changed = chunks.some((c) => c.updatedAt === now) || (previous?.chunks?.length ?? -1) !== chunks.length
const updatedAt = changed ? now : previous.updatedAt
const doc = { version: 1, updatedAt, chunks }
const text = JSON.stringify(doc, null, 1) + '\n'

const counts = chunks.reduce((m, c) => ((m[c.source] = (m[c.source] ?? 0) + 1), m), {})
if (args.has('--print')) for (const c of chunks) console.log(`\n[${c.source}] ${c.title} · ${c.section ?? '-'} · ${c.url} (${c.text.split(' ').length} words)\n${c.text}`)
if (args.has('--check')) {
  const same = previous && JSON.stringify(previous.chunks.map(({ updatedAt: _u, ...c }) => c)) === JSON.stringify(chunks.map(({ updatedAt: _u, ...c }) => c))
  console.log(same ? `ask index is up to date (${chunks.length} chunks)` : 'ask index is OUT OF DATE: run npm run ask:index and commit server/data/ask-index.json')
  process.exit(same ? 0 : 1)
}
if (!changed && fs.existsSync(OUT)) console.log(`ask index unchanged: ${chunks.length} chunks ${JSON.stringify(counts)}`)
else {
  fs.writeFileSync(OUT, text)
  console.log(`ask index written: ${chunks.length} chunks ${JSON.stringify(counts)} -> ${path.relative(ROOT, OUT)}`)
}
