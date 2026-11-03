// The published legal pages (owner decision 2026-11-03): canonical addresses, redirects, head tags, sitemaps, the
// pre-render's footer links, and the page sources themselves (no draft marker, the fixed facts, the CC BY note, the
// consent line on every sign-in / checkout / purchase step, the footer links on every layout).
//
//   npm run test:legal        (no build needed)
//
// The real server runs IN THIS PROCESS on TEST_PORT (default 8841) with a temporary DATA_DIR and a stub dist/; every
// request names its host in the Host header, as Cloudflare does.

import { execFileSync } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { guardTestRun, hostRequest, makeChecker } from './test-helpers.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8')
const exists = (f) => fs.existsSync(path.join(ROOT, f))
const PORT = Number(process.env.TEST_PORT) || 8841
const BASE = `http://localhost:${PORT}`
await guardTestRun(PORT)
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gully-legal-'))
const dist = path.join(tmp, 'dist')
fs.mkdirSync(path.join(dist, 'assets'), { recursive: true })
fs.writeFileSync(
  path.join(dist, 'index.html'),
  '<!doctype html><html><head><meta name="theme-color" content="#06050D" />\n<title>Gully Labs</title><meta name="description" content="x" />\n<meta property="og:site_name" content="Gully Labs" />\n<meta property="og:image" content="https://gullylabs.xyz/brand/social/og-image-1200x630.png" />\n<link rel="canonical" href="https://gullylabs.xyz/" /></head><body><div id="root"></div></body></html>',
)
Object.assign(process.env, {
  PORT: String(PORT),
  DATA_DIR: tmp,
  TRACKER_DATA: path.join(tmp, 'tracker-history.json'),
  DIST_DIR: dist,
  ADMIN_TOKEN: crypto.randomBytes(24).toString('hex'),
  TRACKER_LOOP: 'off',
  TRACKER_SKIP_APIS: '1',
  DEEPCORE_LOOP: 'off',
  ASK_REMOTE: 'off',
  IPFS_API: 'http://127.0.0.1:9',
  IPFS_GATEWAY: 'http://127.0.0.1:9',
  GULLYPAY_STATUS_URL: 'http://127.0.0.1:9',
  GULLYRPC_STATUS_URL: 'http://127.0.0.1:9',
  HOLDERMAPS_PRIMARY: '1',
  SECURITY_PRIMARY: '1',
})
delete process.env.TELEGRAM_BOT_TOKEN
delete process.env.ANTHROPIC_API_KEY

const t = makeChecker()
const { check } = t
const MAIN = 'gullylabs.xyz'
const HM = 'holdermaps.xyz'
const get = (host, p, opts) => hostRequest(BASE, host, p, opts)
const DRAFT = /review by counsel|pending legal review|Draft:|HtmlComment/i
const ldOf = (html) => [...html.matchAll(/<script type="application\/ld\+json">([^<]+)<\/script>/g)].map((x) => JSON.parse(x[1]))
const shellLegal = (html) => /<nav aria-label="Legal">[^]*href="[^"]*\/terms"[^]*href="[^"]*\/privacy"[^]*href="[^"]*\/legal"/.test(html)

try {
  await import('../server/server.mjs')
  const hosts = await import('../server/hosts.mjs')
  await new Promise((r) => setTimeout(r, 300))

  /* -------------------------------------------------------- hosts.mjs --- */
  check('legalCanonicalPath: /legal/terms -> /terms, /legal/privacy -> /privacy, /terms/ -> /terms; others null', hosts.legalCanonicalPath('/legal/terms') === '/terms' && hosts.legalCanonicalPath('/legal/privacy/') === '/privacy' && hosts.legalCanonicalPath('/terms/') === '/terms' && hosts.legalCanonicalPath('/terms') === '/terms' && hosts.legalCanonicalPath('/legal/merchant-terms') === null && hosts.legalCanonicalPath('/legal') === null)
  const r = (p) => hosts.holderMapsRoute(HM, p, '')
  check('holdermaps route: /terms and /privacy are its own pages; /legal/terms and /legal/privacy move to them; /legal goes to gullylabs.xyz', r('/terms').kind === 'allow' && r('/privacy').kind === 'allow' && r('/legal/terms').location === '/terms' && r('/legal/privacy').location === '/privacy' && r('/legal').location === `https://${MAIN}/legal`, JSON.stringify([r('/legal/terms'), r('/legal')]))

  /* ------------------------------------------------------ gullylabs.xyz --- */
  for (const [p, h1, title] of [
    ['/terms', 'Terms of Service', 'Terms of Service · Gully Labs'],
    ['/privacy', 'Privacy Policy', 'Privacy Policy · Gully Labs'],
    ['/legal', 'Legal: Terms and Privacy for every Gully product', 'Legal: Terms and Privacy for every Gully product · Gully Labs'],
  ]) {
    const res = await get(MAIN, p)
    const ld = ldOf(res.text)
    check(`gullylabs.xyz${p}: 200, title, canonical, indexable`, res.status === 200 && res.text.includes(`<title>${title}</title>`) && res.text.includes(`<link rel="canonical" href="https://${MAIN}${p}" />`) && !/noindex/.test(res.text) && !res.headers['x-robots-tag'], `${res.status} ${res.text.match(/<title>[^<]*<\/title>/)?.[0]}`)
    check(`gullylabs.xyz${p}: pre-rendered h1, Terms / Privacy / Legal footer links, no draft marker`, res.text.includes(`<h1>${h1}</h1>`) && shellLegal(res.text) && !DRAFT.test(res.text))
    check(`gullylabs.xyz${p}: OG + Twitter tags with the kit image, JSON-LD WebPage published by Gully Labs LLC`, res.text.includes('<meta property="og:image" content="https://gullylabs.xyz/brand/social/og-image-1200x630.png" />') && res.text.includes(`<meta property="og:title" content="${title}" />`) && ld.some((l) => l['@type'] === 'WebPage' && l.url === `https://${MAIN}${p}` && l.publisher?.name === 'Gully Labs LLC'))
  }
  const idx = await get(MAIN, '/legal')
  const want = ['holdermaps.xyz', 'gullychain.xyz', 'kre8.fun', 'gullypay.xyz', 'gullyid.xyz', 'gullyrpc.xyz', 'gullyai.xyz', 'gullysecurity.xyz', 'gullystudio.xyz'].flatMap((d) => [`https://${d}/terms`, `https://${d}/privacy`])
  check('gullylabs.xyz/legal: links every product\'s Terms and Privacy Policy, kre8 content policy and copyright, the merchant and scan terms', [...want, 'https://kre8.fun/content-policy', 'https://kre8.fun/copyright', '/legal/merchant-terms', '/legal/scan-terms', '/terms', '/privacy'].every((u) => idx.text.includes(`href="${u}"`)) && idx.text.includes('Privacy Policy'), want.filter((u) => !idx.text.includes(`href="${u}"`)).join(' '))

  for (const [from, to] of [['/legal/terms', '/terms'], ['/legal/privacy', '/privacy'], ['/terms/', '/terms'], ['/legal/terms?x=1', '/terms?x=1']]) {
    const res = await get(MAIN, from)
    check(`gullylabs.xyz${from}: 301 to ${to}`, res.status === 301 && res.headers.location === to, `${res.status} ${res.headers.location}`)
  }
  for (const p of ['/legal/merchant-terms', '/legal/scan-terms']) {
    const res = await get(MAIN, p)
    check(`gullylabs.xyz${p}: still a page (the website runs Gully Pay stores and scans), canonical on itself`, res.status === 200 && res.text.includes(`<link rel="canonical" href="https://${MAIN}${p}" />`) && shellLegal(res.text))
  }
  check('gullylabs.xyz/gully-pay/merchant-terms: still 301 to /legal/merchant-terms', (await get(MAIN, '/gully-pay/merchant-terms')).headers.location === '/legal/merchant-terms')
  for (const host of ['app.gullylabs.xyz', 'pay.gullylabs.xyz']) {
    const res = await get(host, '/terms')
    check(`${host}/terms: 301 to gullylabs.xyz/terms`, res.status === 301 && res.headers.location === `https://${MAIN}/terms`, `${res.status} ${res.headers.location}`)
  }
  const home = await get(MAIN, '/')
  check('gullylabs.xyz/: the pre-render carries the Terms / Privacy / Legal footer links', home.status === 200 && shellLegal(home.text))
  const sm = (await get(MAIN, '/sitemap.xml')).text
  check('gullylabs.xyz sitemap: /terms, /privacy, /legal, the merchant and scan terms; not the old /legal/terms or /legal/privacy', ['/terms', '/privacy', '/legal', '/legal/merchant-terms', '/legal/scan-terms'].every((p) => sm.includes(`<loc>https://${MAIN}${p}</loc>`)) && !sm.includes(`${MAIN}/legal/terms<`) && !sm.includes(`${MAIN}/legal/privacy<`))

  /* ------------------------------------------------------ holdermaps.xyz --- */
  for (const [p, title] of [
    ['/terms', 'Terms of Service · HolderMaps'],
    ['/privacy', 'Privacy Policy · HolderMaps'],
  ]) {
    const res = await get(HM, p)
    const ld = ldOf(res.text)
    check(`holdermaps.xyz${p}: 200 (served here, not a hop to gullylabs.xyz), HolderMaps title and kit head, canonical holdermaps.xyz${p}`, res.status === 200 && !res.headers.location && res.text.includes(`<title>${title}</title>`) && res.text.includes(`<link rel="canonical" href="https://${HM}${p}" />`) && res.text.includes('<meta property="og:site_name" content="HolderMaps" />') && res.text.includes('https://holdermaps.xyz/brand/holdermaps/og-image-1200x630.png'), `${res.status} ${res.headers.location ?? ''} ${res.text.match(/<title>[^<]*<\/title>/)?.[0]}`)
    check(`holdermaps.xyz${p}: pre-rendered h1, Terms / Privacy / Legal footer links, JSON-LD by Gully Labs LLC, no draft marker`, res.text.includes(`<h1>${title.replace(' · HolderMaps', '')}</h1>`) && shellLegal(res.text) && ld.some((l) => l['@type'] === 'WebPage' && l.url === `https://${HM}${p}` && l.publisher?.name === 'Gully Labs LLC') && !DRAFT.test(res.text))
  }
  for (const [from, to] of [['/legal/terms', '/terms'], ['/legal/privacy', '/privacy'], ['/terms/', '/terms'], ['/legal', `https://${MAIN}/legal`]]) {
    const res = await get(HM, from)
    check(`holdermaps.xyz${from}: 301 to ${to}`, res.status === 301 && res.headers.location === to, `${res.status} ${res.headers.location}`)
  }
  const hmHome = await get(HM, '/')
  check('holdermaps.xyz/: the pre-render carries the Terms / Privacy / Legal footer links', hmHome.status === 200 && shellLegal(hmHome.text))
  const hsm = (await get(HM, '/sitemap.xml')).text
  check('holdermaps.xyz sitemap: /terms and /privacy', hsm.includes(`<loc>https://${HM}/terms</loc>`) && hsm.includes(`<loc>https://${HM}/privacy</loc>`))

  /* ------------------------------------------------------- page sources --- */
  const PAGES = ['src/pages/legal/Terms.tsx', 'src/pages/legal/Privacy.tsx', 'src/pages/legal/MerchantTerms.tsx', 'src/pages/legal/ScanTerms.tsx', 'src/pages/legal/LegalIndex.tsx', 'src/pages/legal/kit.tsx', 'src/holdermaps/HmLegal.tsx']
  for (const f of PAGES) {
    const s = read(f)
    check(`${f}: no draft marker, no old contact address`, !DRAFT.test(s) && !/hello@gullylabs\.xyz|labsgully@gmail\.com/.test(s))
  }
  const kit = read('src/pages/legal/kit.tsx')
  check('kit: Gully Labs LLC, Oregon, USA, team@gullylabs.xyz, the State of Oregon, last updated November 3, 2026', kit.includes("entity: 'Gully Labs LLC'") && kit.includes("place: 'Oregon, USA'") && kit.includes("email: 'team@gullylabs.xyz'") && kit.includes("law: 'the State of Oregon, USA'") && kit.includes("updated: 'November 3, 2026'"))
  check('kit: the CC BY note in the exact words, both URLs linked in a new tab', kit.includes('Adapted from the Basecamp open-source policies (') && kit.includes("BASECAMP_URL = 'https://github.com/basecamp/policies'") && kit.includes("CC_BY_URL = 'https://creativecommons.org/licenses/by/4.0/'") && kit.includes('). Changed by {LEGAL.entity} for {product}. This page is also available under CC BY 4.0.') && kit.includes("rel: 'noopener noreferrer'") && kit.includes("target: '_blank'"))
  check('kit: a table of contents (sticky beside the text, collapsible on phones), Last updated, a ~70ch measure', kit.includes('data-testid="legal-toc"') && kit.includes('sticky top-24') && kit.includes('<details') && kit.includes('Last updated') && kit.includes('70ch'))
  for (const f of ['src/pages/legal/Terms.tsx', 'src/pages/legal/Privacy.tsx', 'src/pages/legal/ScanTerms.tsx', 'src/pages/legal/MerchantTerms.tsx']) {
    const s = read(f)
    check(`${f}: laid out with LegalPage, governed by Oregon law where it names a law, Gully Labs LLC named`, s.includes('<LegalPage') && s.includes('Gully Labs LLC') && (!/governed by the laws/.test(s) || s.includes('governed by the laws of the State of Oregon, USA')))
  }
  check('MerchantTerms: Common Paper attribution kept, MERCHANT_TERMS_VERSION equals server/merchants.mjs', read('src/pages/legal/MerchantTerms.tsx').includes('adapted="common-paper"') && read('src/pages/legal/MerchantTerms.tsx').match(/MERCHANT_TERMS_VERSION = '([^']+)'/)?.[1] === read('server/merchants.mjs').match(/MERCHANT_TERMS_VERSION = '([^']+)'/)?.[1])
  const terms = read('src/pages/legal/Terms.tsx')
  const n = (s) => [...s.matchAll(/<S n=\{(\d+)\}/g)].map((m) => Number(m[1]))
  check('Terms: sections s1…s20 in order (Gully AI cites them), 18+', n(terms).join() === Array.from({ length: 20 }, (_, i) => i + 1).join() && terms.includes('at least 18 years old'))
  check('Privacy: sections s1…s15 in order, the retention table in s11', n(read('src/pages/legal/Privacy.tsx')).join() === Array.from({ length: 15 }, (_, i) => i + 1).join() && /<S n=\{11\} title="How long we keep it">[^]*RETENTION\.map/.test(read('src/pages/legal/Privacy.tsx')))
  const NAMES = { US: 'the United States', CU: 'Cuba', IR: 'Iran', KP: 'North Korea', SY: 'Syria' }
  const blocked = [...read('server/geo.mjs').match(/SWAP_BLOCKED = new Set\(\[([^\]]*)\]\)/)[1].matchAll(/'([A-Z]{2})'/g)].map((m) => m[1])
  check('Terms: names every country geo.mjs SWAP_BLOCKED hides the swap in', blocked.length > 0 && blocked.every((c) => NAMES[c] && terms.includes(NAMES[c])), blocked.join())
  check('Privacy: names the analytics this site actually loads (index.html: analytics.gullylabs.xyz, the Umami fork) and the processors', read('index.html').includes('https://analytics.gullylabs.xyz/script.js') && /Umami/.test(read('src/pages/legal/Privacy.tsx')) && ['Cloudflare', 'OVHcloud', 'Anthropic', 'Moralis', 'dRPC'].every((p) => read('src/pages/legal/Privacy.tsx').includes(p)))
  const hm = read('src/holdermaps/HmLegal.tsx')
  check('HolderMaps terms: bubble maps, the Deep check price read live (never typed), dRPC and Moralis, labels can be wrong, not advice, Gully Chain', /bubble map/.test(hm) && hm.includes('useDeepOffer') && !/\$\d/.test(hm.replace(/\$\{[^}]*\}/g, '')) && hm.includes('dRPC') && hm.includes('Moralis') && hm.includes('Labels and clusters can be wrong') && hm.includes('Not financial advice') && hm.includes('Gully Chain'))
  check('Deep check price lives in server/plans.mjs (HOLDER_DEEP.priceUsd)', /HOLDER_DEEP = \{[^}]*priceUsd: \d+/.test(read('server/plans.mjs')))

  /* ------------------------------------------------------ footers + consent --- */
  const chrome = read('src/console/Chrome.tsx')
  check('gullylabs.xyz footer (every page, the home included): Terms, Privacy, Legal', /const legal: Item\[\] = \[[^\]]*to: '\/terms'[^\]]*to: '\/privacy'[^\]]*to: '\/legal'/.test(chrome) && chrome.includes('data-testid="footer-legal"'))
  check('holdermaps.xyz footer: its own /terms and /privacy, and gullylabs.xyz/legal', /label: 'Terms', icon: FileText, to: '\/terms'/.test(read('src/holdermaps/HmChrome.tsx')) && /label: 'Privacy', icon: FileText, to: '\/privacy'/.test(read('src/holdermaps/HmChrome.tsx')) && read('src/holdermaps/HmChrome.tsx').includes("href: 'https://gullylabs.xyz/legal'"))
  check('app.gullylabs.xyz and docs footers: Terms, Privacy, Legal', ['/terms', '/privacy', '/legal'].every((p) => read('src/pages/developers/AppShell.tsx').includes('${SITE_URL}' + p) && read('src/docs/DocsLayout.tsx').includes('${SITE}' + p)))
  check('holdermaps.xyz: clicks on /terms and /privacy stay on holdermaps.xyz', /\(terms\|privacy\)/.test(read('src/lib/holderMapsLinks.ts')))
  const consent = read('src/components/legal/ConsentLine.tsx')
  check('ConsentLine: "By continuing you agree to the Terms and Privacy Policy", links in a new tab', consent.includes('By continuing you agree to the') && consent.includes('Privacy Policy') && consent.includes('target="_blank"'))
  for (const f of ['src/pages/developers/Billing.tsx', 'src/pages/developers/Keys.tsx', 'src/pages/developers/security/NewScan.tsx', 'src/holdermaps/HmDeepCheck.tsx', 'src/components/holders/DeepCheck.tsx']) check(`${f}: shows the consent line`, read(f).includes('<ConsentLine'))
  check('wallet sign-in (both entry points): "By continuing you agree to the Terms and Privacy Policy"', read('src/pages/developers/DevelopersPage.tsx').includes('By continuing you agree to the') && read('src/pages/developers/WalletSignIn.tsx').includes('By continuing you agree to the'))
  check('router: /terms, /privacy and /legal are pages; /legal/terms and /legal/privacy navigate to them; holdermaps.xyz has its own', /path: '\/terms', lazy: \(\) => import\('\.\/pages\/legal\/Terms'\)/.test(read('src/router.tsx')) && /path: '\/legal', lazy/.test(read('src/router.tsx')) && read('src/router.tsx').includes("{ path: '/legal/terms', element: <Navigate to=\"/terms\" replace /> }") && read('src/router.tsx').includes('HmTermsPage'))

  /* ---------------------------------------------------- licence + Gully AI --- */
  check('LICENSES/POLICIES.md: names the adapted files, the Basecamp and Common Paper sources, CC BY 4.0', exists('LICENSES/POLICIES.md') && ['src/pages/legal/Terms.tsx', 'src/pages/legal/Privacy.tsx', 'src/holdermaps/HmLegal.tsx', 'github.com/basecamp/policies', 'creativecommons.org/licenses/by/4.0', 'Common Paper'].every((s) => read('LICENSES/POLICIES.md').includes(s)))
  const out = path.join(tmp, 'ask-index.json')
  execFileSync(process.execPath, [path.join(ROOT, 'scripts/build-ask-index.mjs'), '--out', out, '--features', path.join(ROOT, 'scripts/fixtures/features.sample.ts')], { stdio: 'pipe' })
  const chunks = JSON.parse(fs.readFileSync(out, 'utf8')).chunks.filter((c) => c.source === 'Legal')
  check('Gully AI index: the legal pages are cited at their canonical URLs (/terms#s1…s20, /privacy#s1…s15), never /legal/terms', Array.from({ length: 20 }, (_, i) => `https://${MAIN}/terms#s${i + 1}`).every((u) => chunks.some((c) => c.url === u)) && Array.from({ length: 15 }, (_, i) => `https://${MAIN}/privacy#s${i + 1}`).every((u) => chunks.some((c) => c.url === u)) && !chunks.some((c) => /\/legal\/(terms|privacy)/.test(c.url)) && !chunks.some((c) => DRAFT.test(c.text)), `${chunks.length} legal chunks`)
} finally {
  console.log(`\n${t.passed} passed, ${t.failed} failed`)
  fs.rmSync(tmp, { recursive: true, force: true })
  process.exit(t.failed ? 1 : 0)
}
