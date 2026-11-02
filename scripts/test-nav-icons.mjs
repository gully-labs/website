// Every navigation link carries an icon (owner rule 2026-10-30, "need icons on the whole stack").
//
//   npm run test:nav-icons
//
// Renders each nav surface of the site to HTML (Vite SSR, no browser, no build): the gullylabs.xyz header, its Menu
// sheet and footer, the HolderMaps header and footer, the docs header and sidebar, the admin section nav. Inside every
// <nav> (and the Menu sheet) each link must hold an <svg> (a Lucide icon) or an <img> (a kit logo). Fails, naming the
// surface and the link, when one does not.

import { createServer } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const vite = await createServer({ root: ROOT, configFile: false, plugins: [react()], logLevel: 'error', server: { middlewareMode: true, hmr: false }, appType: 'custom', optimizeDeps: { noDiscovery: true, include: [] } })

let failed = 0
let passed = 0
const fail = (msg) => {
  failed++
  console.error(`  FAIL ${msg}`)
}

/** The <a> elements inside every <nav> and inside the Menu sheets, with their inner HTML. */
function navLinks(html) {
  const regions = []
  for (const m of html.matchAll(/<nav\b[^>]*>([\s\S]*?)<\/nav>/g)) regions.push(m[1])
  for (const id of ['lc-sheet', 'hm-sheet', 'docs-sheet']) {
    const i = html.indexOf(`id="${id}"`)
    if (i >= 0) regions.push(html.slice(i))
  }
  const links = []
  for (const r of regions) for (const m of r.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)) links.push({ attrs: m[1], inner: m[2] })
  return links
}

const text = (s) => s.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()

function checkSurface(name, html, { min = 1 } = {}) {
  const links = navLinks(html)
  if (links.length < min) fail(`${name}: expected at least ${min} nav links, found ${links.length}`)
  let bad = 0
  for (const l of links) {
    if (/<svg\b/.test(l.inner) || /<img\b/.test(l.inner)) continue
    bad++
    const href = /href="([^"]*)"/.exec(l.attrs)?.[1] ?? '?'
    fail(`${name}: nav link "${text(l.inner) || href}" (${href}) has no icon`)
  }
  if (!bad && links.length >= min) {
    passed++
    console.log(`  ok   ${name}: ${links.length} nav links, every one with an icon`)
  }
}

try {
  const { createElement: h } = await import('react')
  const { renderToString } = await import('react-dom/server')
  const { MemoryRouter, createMemoryRouter, RouterProvider } = await import('react-router')
  const at = (url, el) => renderToString(h(MemoryRouter, { initialEntries: [url] }, el))

  const chrome = await vite.ssrLoadModule('/src/console/Chrome.tsx')
  const hm = await vite.ssrLoadModule('/src/holdermaps/HmChrome.tsx')
  const admin = await vite.ssrLoadModule('/src/pages/admin/AdminNav.tsx')
  const { PRODUCTS } = await vite.ssrLoadModule('/src/terminal/catalog.ts')

  checkSurface('gullylabs.xyz header', at('/', h(chrome.ConsoleHeader)), { min: 6 })
  checkSurface('gullylabs.xyz Menu sheet', at('/products/pay', h(chrome.ConsoleSheet, { home: false, close: () => {} })), { min: 12 + PRODUCTS.length })
  // Off the home page the footer also lists the site pages.
  checkSurface('gullylabs.xyz footer', at('/pricing', h(chrome.ConsoleFooter)), { min: 6 + PRODUCTS.length + 8 })
  checkSurface('HolderMaps header', at('/', h(hm.HmHeader)), { min: 5 }) // Map a token is the header's button, not a menu item
  checkSurface('HolderMaps footer', at('/', h(hm.HmFooter)), { min: 8 })
  checkSurface('admin section nav', at('/admin', h(admin.AdminNav, { section: 'health', go: () => {} })), { min: 5 })

  // The docs shell: its header links and sidebar, inside a data router (it uses ScrollRestoration).
  const docs = await vite.ssrLoadModule('/src/docs/DocsLayout.tsx')
  const router = createMemoryRouter([{ path: '/docs', Component: docs.DocsLayout, children: [{ index: true, Component: () => null }] }], { initialEntries: ['/docs'] })
  const docsHtml = renderToString(h(RouterProvider, { router }))
  checkSurface('docs sidebar and footer', docsHtml, { min: 20 })
  // The docs header's own links sit outside a <nav>: check them by their targets.
  const header = /<header\b[\s\S]*?<\/header>/.exec(docsHtml)?.[0] ?? ''
  const headerLinks = [...header.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)].filter((m) => !/href="#/.test(m[1]))
  const bare = headerLinks.filter((m) => !/<svg\b|<img\b/.test(m[2]))
  if (!headerLinks.length) fail('docs header: no links found')
  for (const m of bare) fail(`docs header: link "${text(m[2])}" has no icon`)
  if (headerLinks.length && !bare.length) {
    passed++
    console.log(`  ok   docs header: ${headerLinks.length} links, every one with an icon`)
  }
} catch (e) {
  fail(`could not render the nav surfaces: ${e?.stack ?? e}`)
} finally {
  await vite.close()
}

console.log(`\n${passed} surfaces passed, ${failed} failures`)
process.exit(failed ? 1 : 0)
