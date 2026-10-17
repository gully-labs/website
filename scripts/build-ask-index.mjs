// Builds the local part of the Gully Ask corpus into server/data/ask-index.json:
//   - the docs pages (src/docs/pages/*.tsx), one document per <Section>, at https://docs.gullylabs.xyz/<path>#<id>;
//   - the site's copy: src/content/*.ts and the Products, Pricing, Services and About pages, at https://gullylabs.xyz/...;
//   - the changelog (a docs page, labelled "Changelog").
//
//   npm run ask:index            rebuild (also runs as `prebuild`, so every build ships a fresh index)
//   npm run ask:index -- --check exit 1 if the committed file is out of date (no write)
//   npm run ask:index -- --print print every chunk, to read the extracted prose by eye
//
// Text is pulled from the TypeScript syntax tree (the compiler is a dev dependency): JSX text, string
// literals inside JSX, and prose fields of top-level data objects. Code blocks, class names, URLs,
// icons and anything computed at runtime are left out. Deterministic: a chunk whose text did not change
// keeps its previous updatedAt, so rebuilding an unchanged tree rewrites the same bytes.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { chunkId, chunkSection, clean } from '../server/ask-index.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT = path.join(ROOT, 'server', 'data', 'ask-index.json')
const DOCS = 'https://docs.gullylabs.xyz'
const SITE = 'https://gullylabs.xyz'
const args = new Set(process.argv.slice(2))

const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')
const parse = (rel) => ts.createSourceFile(rel, read(rel), ts.ScriptTarget.Latest, true, rel.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)

/* -------------------------------------------------------------- JSX text --- */

const SKIP_TAGS = new Set(['CodeBlock', 'pre', 'svg', 'script', 'style', 'img', 'Seo'])
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
const LIST_KEYS = { items: 'Includes', built: 'Built', chains: 'Chains', features: null, how: 'How it works', seo: null }
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
  { file: 'src/pages/Products.tsx', jsx: false, consts: { ANALYTICS: { url: '/analytics', title: 'Gully Analytics' }, CHAIN_KIT: { url: '/chain-kit', title: 'Chain Kit' } } },
  { file: 'src/pages/Pricing.tsx', url: '/pricing', title: 'API pricing', consts: { FAQ: { section: 'Questions' } } },
  { file: 'src/pages/Services.tsx', url: '/services', title: 'Services' },
  { file: 'src/pages/About.tsx', url: '/about', title: 'About Gully Labs' },
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

function siteChunks() {
  const chunks = []
  for (const pg of SITE_PAGES) {
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
  for (const name of ['socialLinks', 'devLinks', 'headerDevItems', 'productLinks']) {
    const arr = topConst(site, name)
    for (const el of arr && ts.isArrayLiteralExpression(arr) ? arr.elements : []) {
      if (!ts.isObjectLiteralExpression(el)) continue
      const get = (k) => {
        const p = el.properties.find((x) => ts.isPropertyAssignment(x) && keyOf(x) === k)
        return p ? literal(p.initializer) : null
      }
      const label = get('label')
      const to = get('to')
      const href = get('href') ?? (to === '/developers' || to === '/app' ? 'https://app.gullylabs.xyz' : to ? SITE + to : null)
      if (label && href && !links.some((l) => l.endsWith(href))) links.push(`${label}: ${href}`)
    }
  }
  chunks.push(...chunkSection({ source: 'Site', title: 'Gully Labs links and contact', url: `${SITE}/`, section: null, paragraphs: [`Where to find Gully Labs. ${links.join('. ')}. For project enquiries use the contact form on ${SITE}/services.`] }))
  return chunks
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
const chunks = [...docsChunks(), ...siteChunks()].map((c0) => {
  // Two blocks of one page under the same heading (a page's own "Questions" and its FAQ data) share a seed.
  const k = seen.get(c0.id) ?? 0
  seen.set(c0.id, k + 1)
  const c = k ? { ...c0, id: chunkId(c0.id, k) } : c0
  const old = prevById.get(c.id)
  return { ...c, updatedAt: old && old.text === c.text && old.url === c.url && old.title === c.title && old.section === c.section ? old.updatedAt : now }
})
const CODE_RE = /className=|=>|\bimport\s+[\w{]|\bconst\s+\w+\s*=|<\/?(div|span|p|a|li|ul|ol|code|section|h[1-6]|button|svg|path|img|br|strong|em)\b[^>]*>|\bfunction\s*\(/i
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
