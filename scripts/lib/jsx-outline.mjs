// Reads a page's own copy out of its TSX source, as an outline: headings, paragraphs, list items and links, in source
// order. scripts/build-page-content.mjs turns it into the HTML a crawler is served before scripts run, so that text
// and the page React draws come from one file and cannot drift apart.
//
// Only text that is literally in the source is taken: JSX text, string literals in JSX, and string attributes that
// carry a heading (title="…" on the section-heading components). Anything computed at runtime (a live figure, a
// .map() over fetched rows, a conditional) is left out, and a sentence with such a gap in it is dropped whole, so the
// outline never holds a half sentence or an invented value.
import fs from 'node:fs'
import path from 'node:path'
import ts from 'typescript'

const GAP = '\u0001'
/** Tags whose content is never page copy. */
const SKIP = new Set(['CodeBlock', 'pre', 'svg', 'script', 'style', 'img', 'Seo', 'caption', 'thead', 'button', 'input', 'select', 'textarea', 'label', 'form', 'kbd'])
/** Tags that sit inside a sentence: their words stay in it. */
const INLINE = new Set(['b', 'strong', 'em', 'i', 'u', 'code', 'span', 'small', 'abbr', 'sup', 'sub', 'mark', 'time', 'NewTabMark'])
/** Tags that end the running paragraph. */
const HEADING = { h1: 1, h2: 2, h3: 3, h4: 3, H3: 3 }
/** Components that draw a heading from an attribute: [attribute, level]. */
const HEADING_ATTR = { SecHead: ['title', 2], S: ['title', 2], Section: ['title', 2], Card: ['title', 3] }
const LINK = new Set(['a', 'A', 'Link', 'SmartLink', 'NavLink'])

const clean = (s) => String(s).replace(/\s+/g, ' ').replace(/\s+([,.;:!?])/g, '$1').trim()
const tagName = (n) => (ts.isJsxElement(n) ? n.openingElement.tagName : n.tagName).getText()
const attrsOf = (n) => (ts.isJsxElement(n) ? n.openingElement.attributes : n.attributes).properties

/** A string attribute's value, or null when it is absent or computed. */
function strAttr(n, name) {
  const a = attrsOf(n).find((p) => ts.isJsxAttribute(p) && p.name.getText() === name)
  const i = a?.initializer
  if (!i) return null
  if (ts.isStringLiteral(i)) return i.text
  if (ts.isJsxExpression(i) && i.expression && (ts.isStringLiteral(i.expression) || ts.isNoSubstitutionTemplateLiteral(i.expression))) return i.expression.text
  return null
}

function jsxText(t) {
  const raw = t.text
  if (/^\s*$/.test(raw) && raw.includes('\n')) return ''
  return raw
    .replace(/\s*\n\s*/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&rsquo;/g, '’')
    .replace(/&lsquo;/g, '‘')
    .replace(/&ldquo;/g, '“')
    .replace(/&rdquo;/g, '”')
    .replace(/&mdash;/g, '—')
    .replace(/&ndash;/g, '–')
    .replace(/&hellip;/g, '…')
    .replace(/&middot;/g, '·')
    .replace(/&rarr;|&larr;|&[a-z]+;/g, '')
}

/** A paragraph worth serving: whole (no runtime gap), a sentence (or a caption of five words or more), not an eyebrow
    or a button label. */
function prose(t) {
  if (!t || t.includes(GAP)) return false
  const letters = t.replace(/[^A-Za-z]/g, '')
  if (letters.length < 12) return false
  if (t.replace(/[^A-Z]/g, '').length / letters.length > 0.45) return false
  const words = t.split(' ').length
  return (words >= 5 || (words >= 3 && /[.!?]$/.test(t))) && !/[→←]\s*$/.test(t)
}

/** The outline of one JSX tree: [{ h: level, t } | { p: t } | { a: [href, t] }]. */
export function outlineOf(root) {
  const out = []
  let cur = ''
  /** The same paragraph without its links' words: a line that is only links is a row of links, not a sentence. */
  let plain = ''
  const flush = () => {
    const t = clean(cur)
    const own = clean(plain.replaceAll(GAP, ''))
    cur = ''
    plain = ''
    if (prose(t) && own.split(' ').length >= 3) out.push({ p: t })
  }
  const add = (s) => {
    cur += s
    plain += s
  }
  /** Plain text under a node, or null when any of it is computed. */
  const textOf = (n) => {
    let s = ''
    let ok = true
    const walk = (x) => {
      if (ts.isJsxText(x)) s += jsxText(x)
      else if (ts.isJsxExpression(x)) {
        const e = x.expression
        if (!e) return
        if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) s += e.text
        else ok = false
      } else if (ts.isJsxElement(x)) {
        const tag = tagName(x)
        if (tag === 'br') s += ' '
        else if (!SKIP.has(tag)) x.children.forEach(walk)
      } else if (ts.isJsxSelfClosingElement(x)) {
        if (tagName(x) === 'br') s += ' '
      } else if (ts.isJsxFragment(x)) x.children.forEach(walk)
    }
    walk(n)
    return ok ? clean(s) : null
  }
  const visit = (n) => {
    if (ts.isJsxText(n)) return void add(jsxText(n))
    if (ts.isJsxExpression(n)) {
      const e = n.expression
      if (!e) return
      if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) add(e.text)
      else add(GAP)
      return
    }
    if (ts.isJsxFragment(n)) return n.children.forEach(visit)
    if (!ts.isJsxElement(n) && !ts.isJsxSelfClosingElement(n)) return
    const tag = tagName(n)
    // A button or a field in the middle of a sentence leaves it incomplete: the sentence is dropped, not served broken.
    if (SKIP.has(tag)) return void (/^(button|input|select|textarea|kbd)$/.test(tag) && clean(cur) && add(GAP))
    if (tag === 'br') return void add(' ')
    const viaAttr = HEADING_ATTR[tag]
    if (viaAttr) {
      const t = strAttr(n, viaAttr[0])
      flush()
      if (t) out.push({ h: viaAttr[1], t: clean(t) })
    }
    if (ts.isJsxSelfClosingElement(n)) return
    if (HEADING[tag]) {
      flush()
      const t = textOf(n)
      if (t && t.length > 2) out.push({ h: HEADING[tag], t })
      return
    }
    if (LINK.has(tag)) {
      const href = strAttr(n, 'href') ?? strAttr(n, 'to')
      const t = textOf(n)
      // A link's words stay in its sentence; the link itself is kept when it stands alone as a real address.
      if (t) cur += ` ${t} `
      else cur += GAP
      if (href && t && t.split(' ').length <= 8 && /^(\/[a-z]|https:\/\/)/.test(href) && !/[${}]/.test(href)) out.push({ a: [href, t] })
      return
    }
    const block = !INLINE.has(tag)
    if (block) flush()
    n.children.forEach(visit)
    if (block) flush()
  }
  visit(root)
  flush()
  return out
}

/** Every top-level JSX tree of a source file (the page and its helper components), in source order. With `within`,
    only the trees inside the function (declaration or `const X = () =>`) of that name: a file that holds two pages
    (src/holdermaps/HmLegal.tsx) is read one page at a time. */
export function fileOutline(file, within = null) {
  const sf = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const insideJsx = (n) => {
    for (let a = n.parent; a; a = a.parent) if (ts.isJsxElement(a) || ts.isJsxFragment(a) || ts.isJsxSelfClosingElement(a)) return true
    return false
  }
  const inside = (n) => {
    if (!within) return true
    for (let a = n.parent; a; a = a.parent) {
      if (ts.isFunctionDeclaration(a) && a.name?.getText() === within) return true
      if (ts.isVariableDeclaration(a) && a.name.getText() === within) return true
    }
    return false
  }
  const roots = []
  const walk = (n) => {
    if ((ts.isJsxElement(n) || ts.isJsxFragment(n)) && !insideJsx(n) && inside(n)) roots.push(n)
    ts.forEachChild(n, walk)
  }
  walk(sf)
  const seen = new Set()
  const out = []
  for (const r of roots)
    for (const b of outlineOf(r)) {
      // The same sentence drawn twice in one file (a desktop and a phone layout) is one sentence.
      const k = JSON.stringify(b)
      if (seen.has(k)) continue
      seen.add(k)
      out.push(b)
    }
  return out
}

/** The outline as sections: [{ h, p: [], links: [] }]; the first section may have no heading. The page's own h1
    (when it is plain text) comes back apart: the shell draws exactly one. */
export function sections(outline) {
  const secs = [{ h: null, p: [], links: [] }]
  let h1 = null
  for (const b of outline) {
    if (b.h === 1) {
      h1 ??= b.t
      continue
    }
    if (b.h) secs.push({ h: b.t, level: b.h, p: [], links: [] })
    else if (b.p) secs.at(-1).p.push(b.p)
    else if (b.a && !secs.some((s) => s.links.some((l) => l[0] === b.a[0]))) secs.at(-1).links.push(b.a)
  }
  return { h1, sections: secs.filter((s) => s.p.length || s.links.length) }
}

/** Loads a TypeScript module that imports nothing at runtime (types only), the way build-discovery.mjs does. */
export async function loadTs(root, rel) {
  const out = ts.transpileModule(fs.readFileSync(path.join(root, rel), 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
  return import('data:text/javascript;base64,' + Buffer.from(out).toString('base64'))
}

/** A top-level `const NAME = { … }` (or `[ … ]`) of a source file as plain data: strings, numbers, booleans, arrays and
    objects as written; anything computed (a JSX node, a call, a variable) is left out. Null when there is no such const. */
export function constLiteral(file, name) {
  const sf = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const value = (e) => {
    while (e && (ts.isAsExpression(e) || ts.isParenthesizedExpression(e) || ts.isSatisfiesExpression?.(e))) e = e.expression
    if (!e) return undefined
    if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) return e.text
    if (ts.isNumericLiteral(e)) return Number(e.text)
    if (e.kind === ts.SyntaxKind.TrueKeyword) return true
    if (e.kind === ts.SyntaxKind.FalseKeyword) return false
    if (ts.isArrayLiteralExpression(e)) return e.elements.map(value).filter((v) => v !== undefined)
    if (ts.isObjectLiteralExpression(e)) {
      const o = {}
      for (const p of e.properties) {
        if (!ts.isPropertyAssignment(p) || !(ts.isIdentifier(p.name) || ts.isStringLiteral(p.name))) continue
        const v = value(p.initializer)
        if (v !== undefined) o[p.name.text] = v
      }
      return o
    }
    return undefined
  }
  for (const st of sf.statements) {
    if (!ts.isVariableStatement(st)) continue
    for (const d of st.declarationList.declarations) if (d.name.getText() === name) return value(d.initializer) ?? null
  }
  return null
}
