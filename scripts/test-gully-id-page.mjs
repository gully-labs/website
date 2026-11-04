// /gully-id: the official cross-link from gullylabs.xyz to gullyid.xyz (Safe Browsing review, 2026-10-31).
//
//   npm run test:gully-id-page     (no build, no server, no network)
//
// Checks: the page renders the kit lockup (byte-identical to the Gully ID brand kit v1 file), says Gully Labs operates
// gullyid.xyz and that it never asks for a seed phrase or private key, links gullyid.xyz and its /about /privacy /terms
// /security pages in a new tab; it has its own head tags and is in the sitemap; the footer links it.

import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { registerHooks } from 'node:module'
import { makeChecker } from './test-helpers.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const t = makeChecker()
const check = t.check

// .tsx pages: JSX compiled with the TypeScript compiler (a devDependency) on load; plain .ts uses Node's type stripping
const ts = (await import('typescript')).default
registerHooks({
  load(url, ctx, next) {
    if (!url.endsWith('.tsx')) return next(url, ctx)
    const src = fs.readFileSync(fileURLToPath(url), 'utf8')
    return { format: 'module', source: ts.transpileModule(src, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText, shortCircuit: true }
  },
  resolve(spec, ctx, next) {
    try {
      return next(spec, ctx)
    } catch (e) {
      if (spec.startsWith('.') && !path.extname(spec)) {
        try {
          return next(`${spec}.ts`, ctx)
        } catch {
          return next(`${spec}.tsx`, ctx)
        }
      }
      throw e
    }
  },
})

// GULLY LABS GRAPHICS/Gully ID/brand-kit/logo/gullyid-lockup-on-dark.svg (brand kit v1)
const KIT_LOCKUP_SHA256 = 'f21e59f3690c25c3a10a4fc78d39c97e57a13c21a4d7b034d4ad9a32f3212c63'
const lockup = fs.readFileSync(path.join(root, 'public/brand/gullyid/gullyid-lockup-on-dark.svg'))
check('the lockup is the kit file, byte-identical', crypto.createHash('sha256').update(lockup).digest('hex') === KIT_LOCKUP_SHA256)

try {
  const { renderToStaticMarkup } = await import('react-dom/server')
  const { createElement } = await import('react')
  const { GullyId } = await import('../src/pages/GullyId.tsx')
  const html = renderToStaticMarkup(createElement(GullyId))
  check('shows the kit lockup as an image', html.includes('src="/brand/gullyid/gullyid-lockup-on-dark.svg"') && html.includes('alt="Gully ID"'))
  check('says Gully Labs operates gullyid.xyz', /built and operated by Gully Labs/.test(html) && html.includes('gullyid.xyz'))
  check('says it never asks for a seed phrase or private key', html.includes('never asks for your seed phrase, recovery phrase or private key'))
  for (const u of ['https://gullyid.xyz', 'https://gullyid.xyz/about', 'https://gullyid.xyz/privacy', 'https://gullyid.xyz/terms', 'https://gullyid.xyz/security'])
    check(`links ${u} in a new tab`, new RegExp(`href="${u.replace(/[.]/g, '\.')}" target="_blank" rel="noopener noreferrer"`).test(html))
  check('names the contact', html.includes('mailto:hello@gullylabs.xyz'))
} catch (e) {
  check(`renders (${e?.stack ?? e})`, false)
}

const { pageMeta, sitemapFor } = await import('../server/seo.mjs')
const m = pageMeta('gullylabs.xyz', '/gully-id')
check('/gully-id has its own head tags', m.found && m.canonical === 'https://gullylabs.xyz/gully-id' && /Gully ID/.test(m.title) && m.description.length > 60, JSON.stringify(m).slice(0, 200))
check('/gully-id is in the sitemap', sitemapFor('gullylabs.xyz').includes('<loc>https://gullylabs.xyz/gully-id</loc>'))
check('the router has the page', fs.readFileSync(path.join(root, 'src/router.tsx'), 'utf8').includes("path: '/gully-id'"))
check('the footer links it (site footer + the hub footer)', /<Link to="\/gully-id"/.test(fs.readFileSync(path.join(root, 'src/components/Footer.tsx'), 'utf8')) && /label: 'Gully ID sign-in', icon: KeyRound, to: '\/gully-id'/.test(fs.readFileSync(path.join(root, 'src/console/Chrome.tsx'), 'utf8')))

console.log(`\n${t.passed} passed, ${t.failed} failed`)
process.exit(t.failed ? 1 : 0)
