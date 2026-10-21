// Validates the contracts registry and the discovery files built from it.
//   npm run test:contracts   (no build, no network, no server on a fixed port)
//
//   - src/content/contracts.ts: every field, EIP-55 checksum, unique chain+address, owner set, explorer URL on the
//     chain's explorer, Sourcify fields consistent, and the entry's `source` file exists and contains the address
//     (sibling repos live next to this checkout under PROJECTS; a missing repo fails, it is never skipped)
//   - the treasury Safe and the Request Network proxy are present and the proxy is marked third-party
//   - server/data/{contracts.json,llms.txt,llms-full.txt} equal what scripts/build-discovery.mjs builds now
//   - server/discovery.mjs serves them with cache headers and open CORS
//   - the home page head carries Organization and SoftwareApplication JSON-LD
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { keccak_256 } from '../server/vendor/noble.mjs'
import { build } from './build-discovery.mjs'
import { handleDiscovery } from '../server/discovery.mjs'
import { pageMeta, renderHead, sitemapFor } from '../server/seo.mjs'
import { makeChecker } from './test-helpers.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const projects = path.resolve(root, '..')
const t = makeChecker()
const { check } = t

const out = ts.transpileModule(fs.readFileSync(path.join(root, 'src/content/contracts.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
const { contracts, CONTRACT_CHAINS } = await import('data:text/javascript;base64,' + Buffer.from(out).toString('base64'))

function checksum(a) {
  const lo = a.slice(2).toLowerCase()
  const h = Buffer.from(keccak_256(Buffer.from(lo, 'ascii'))).toString('hex')
  return '0x' + [...lo].map((c, i) => (parseInt(h[i], 16) >= 8 ? c.toUpperCase() : c)).join('')
}
const sourceFile = (source) => {
  const i = source.indexOf(':')
  const repo = source.slice(0, i)
  return path.join(repo === 'website' ? root : path.join(projects, repo), source.slice(i + 1))
}

// ---------------------------------------------------------------- the registry
const bad = []
const seen = new Set()
const texts = new Map()
for (const c of contracts) {
  const fail = (m) => bad.push(`${c.id}: ${m}`)
  for (const k of ['id', 'name', 'role', 'project', 'chain', 'address', 'owner', 'explorerUrl', 'source']) if (typeof c[k] !== 'string' || !c[k]) fail(`missing ${k}`)
  if (!/^0x[0-9a-fA-F]{40}$/.test(c.address)) fail('address format')
  else if (checksum(c.address) !== c.address) fail('not EIP-55 checksummed')
  if (c.id !== `${c.chainId}:${c.address.toLowerCase()}`) fail('id does not match chain and address')
  if (seen.has(c.id)) fail('duplicate')
  seen.add(c.id)
  if (c.owner !== 'gully-labs' && c.owner !== 'third-party') fail(`owner ${c.owner}`)
  const chain = CONTRACT_CHAINS.find((x) => x.id === c.chainId)
  if (!chain) fail(`unknown chain ${c.chainId}`)
  else if (c.explorerUrl !== `${chain.explorer}/address/${c.address}`) fail('explorer URL')
  if (!Array.isArray(c.kind) || !c.kind.length) fail('kind')
  if ((c.verification === null) !== (c.verifiedSource === null)) fail('verification and verifiedSource disagree')
  if (c.verifiedSource && c.verifiedSource !== `https://repo.sourcify.dev/${c.chainId}/${c.address}`) fail('verifiedSource URL')
  if (c.audit !== null && !/^https:\/\//.test(c.audit)) fail('audit must be null or an https link')
  if (!/^[A-Za-z0-9._-]+:[^\s]+$/.test(c.source)) fail('source format')
  else {
    const file = sourceFile(c.source)
    if (!fs.existsSync(file)) fail(`source file missing: ${file}`)
    else {
      if (!texts.has(file)) texts.set(file, fs.readFileSync(file, 'utf8').toLowerCase())
      if (!texts.get(file).includes(c.address.toLowerCase())) fail(`${c.source} does not contain the address`)
    }
  }
}
check(`registry has entries (${contracts.length})`, contracts.length > 0)
check(`every entry valid (${bad.length} problems)`, bad.length === 0, bad.slice(0, 3).join(' | '))
if (bad.length) console.log(bad.slice(0, 20).join('\n'))

const TREASURY = '0xCaf7C1ce6F234bED687264cBE6210a4ab5c12fd6'
check('treasury Safe listed on Ethereum, Base, BNB Chain and Arbitrum', [1, 8453, 56, 42161].every((id) => contracts.some((c) => c.chainId === id && c.address === TREASURY && c.kind.includes('fee-address'))))
const proxies = contracts.filter((c) => c.kind.includes('fee-proxy'))
check('Request ERC20FeeProxy listed and every one third-party', proxies.length >= 4 && proxies.every((c) => c.owner === 'third-party'))
check('only fee proxies are third-party', contracts.filter((c) => c.owner === 'third-party').every((c) => c.kind.includes('fee-proxy')))
check('no fee proxy is also our treasury', !proxies.some((c) => c.address === TREASURY))

// ---------------------------------------------------------------- the built files
const built = await build()
for (const [name, body] of Object.entries(built)) check(`server/data/${name} is up to date (run node scripts/build-discovery.mjs)`, fs.readFileSync(path.join(root, 'server/data', name), 'utf8').split(String.fromCharCode(13)).join('') === body)
const json = JSON.parse(built['contracts.json'])
check('contracts.json lists every contract', json.contracts.length === contracts.length)
check('llms.txt starts with an H1 and links the docs and contracts', built['llms.txt'].startsWith('# Gully Labs') && built['llms.txt'].includes('docs.gullylabs.xyz/contracts') && built['llms.txt'].includes('/.well-known/contracts.json'))
check('llms-full.txt lists every address', contracts.every((c) => built['llms-full.txt'].includes(c.address)))
check('llms files keep building/planned out of the live lists', !/## Products and features \(live\)[\s\S]*?\(planned\)[\s\S]*?## Projects/.test(built['llms.txt']) && /## Roadmap \(not available yet\)/.test(built['llms-full.txt']))

// ---------------------------------------------------------------- serving
const srv = http.createServer((req, res) => {
  if (!handleDiscovery(req, res, new URL(req.url, 'http://x'))) res.writeHead(404).end()
})
await new Promise((r) => srv.listen(0, '127.0.0.1', r))
const base = `http://127.0.0.1:${srv.address().port}`
try {
  const r = await fetch(`${base}/.well-known/contracts.json`)
  check('contracts.json: 200 JSON', r.status === 200 && /application\/json/.test(r.headers.get('content-type')))
  check('contracts.json: open CORS', r.headers.get('access-control-allow-origin') === '*')
  check('contracts.json: cache headers', /max-age=\d+/.test(r.headers.get('cache-control') ?? ''))
  check('contracts.json: parses and matches', (await r.json()).contracts.length === contracts.length)
  const o = await fetch(`${base}/.well-known/contracts.json`, { method: 'OPTIONS' })
  check('contracts.json: OPTIONS 204 with CORS', o.status === 204 && o.headers.get('access-control-allow-origin') === '*')
  const l = await fetch(`${base}/llms.txt`)
  check('llms.txt: 200 text/plain', l.status === 200 && /text\/plain/.test(l.headers.get('content-type')) && (await l.text()).startsWith('# Gully Labs'))
  const f = await fetch(`${base}/llms-full.txt`)
  check('llms-full.txt: 200 text/plain', f.status === 200 && /text\/plain/.test(f.headers.get('content-type')))
  const p = await fetch(`${base}/llms.txt`, { method: 'POST' })
  check('POST is 405', p.status === 405)
  check('other paths are not handled', (await fetch(`${base}/other`)).status === 404)
} finally {
  srv.close()
}

// ---------------------------------------------------------------- JSON-LD on the home page
const html = renderHead('<!doctype html><html><head><title>x</title></head><body></body></html>', pageMeta('gullylabs.xyz', '/'))
const ld = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]))
const org = ld.find((x) => x['@type'] === 'Organization')
const app = ld.find((x) => x['@type'] === 'SoftwareApplication')
check('home head has Organization JSON-LD', !!org && org.name === 'Gully Labs' && org.url === 'https://gullylabs.xyz' && /gully-mark-512\.png$/.test(org.logo))
check('Organization sameAs: X, GitHub, Telegram, YouTube, TikTok, Facebook, Medium', ['https://x.com/Gully_Labs', 'https://github.com/gully-labs', 'https://t.me/GullyLabsNews', 'https://www.youtube.com/@Gully_Labs', 'https://www.tiktok.com/@gully_labs', 'https://www.facebook.com/gullylabsllc', 'https://medium.com/@labsgully'].every((u) => org?.sameAs.includes(u)))
check('home head has SoftwareApplication JSON-LD', !!app && app.name === 'Gully Labs' && !!app.applicationCategory && !!app.description)
check('logo file exists in the brand kit copy', fs.existsSync(path.join(root, 'public/brand/gully-mark-512.png')))
const tracker = renderHead('<html><head></head></html>', pageMeta('gullylabs.xyz', '/tracker'))
check('other pages do not carry Organization JSON-LD', !tracker.includes('"Organization","name":"Gully Labs","url":"https://gullylabs.xyz","logo"'))
const docsMeta = pageMeta('docs.gullylabs.xyz', '/contracts')
check('docs /contracts has SEO meta', docsMeta.found === true && docsMeta.canonical === 'https://docs.gullylabs.xyz/contracts')

// ---------------------------------------------------------------- the legal pages
const terms = pageMeta('gullylabs.xyz', '/legal/terms')
check('/legal/terms has its own title and canonical, and is indexable', terms.found === true && terms.title === 'Terms of Service · Gully Labs' && terms.canonical === 'https://gullylabs.xyz/legal/terms' && !terms.noindex)
check('/legal/terms, /legal/privacy and /legal/merchant-terms are in the sitemap', ['terms', 'privacy', 'merchant-terms'].every((x) => sitemapFor('gullylabs.xyz').includes(`<loc>https://gullylabs.xyz/legal/${x}</loc>`)))

console.log(`\n${t.passed} passed, ${t.failed} failed`)
process.exit(t.failed ? 1 : 0)
