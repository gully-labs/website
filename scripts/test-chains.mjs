// Test of the Gully Chains waitlist and offer: validation, the per-IP rate limit, the honeypot, escaped storage, admin
// auth, and that every price the page shows comes from server/chains-plans.mjs.
//
//   node scripts/test-chains.mjs      (no build needed; TEST_PORT overrides the port, default 9101)
//
// The real server runs IN THIS PROCESS with a fresh temporary DATA_DIR. Callers are told apart by the
// cf-connecting-ip header, which the rate limit reads.

import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { guardTestRun, makeChecker } from './test-helpers.mjs'

const PORT = Number(process.env.TEST_PORT) || 9101
await guardTestRun(PORT)
const BASE = `http://localhost:${PORT}`
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gully-chains-'))
const ADMIN = crypto.randomBytes(24).toString('hex')
const t = makeChecker()
const { check } = t

Object.assign(process.env, { PORT: String(PORT), DATA_DIR: tmp, TRACKER_DATA: path.join(tmp, 'tracker-history.json'), DIST_DIR: path.join(tmp, 'no-dist'), ADMIN_TOKEN: ADMIN, TRACKER_LOOP: 'off', DEEPCORE_LOOP: 'off', TRACKER_SKIP_APIS: '1', ASK_REMOTE: 'off' })
await import('../server/server.mjs')
await new Promise((r) => setTimeout(r, 300))
const { CHAINS, SERVICES, WAITLIST_CHOICES } = await import('../server/chains-plans.mjs')

const call = async (p, { method = 'GET', body, ip = '10.0.0.1', headers = {}, plain = false } = {}) => {
  const r = await fetch(BASE + p, { method, headers: { 'cf-connecting-ip': ip, ...(body !== undefined ? { 'content-type': 'application/json', ...(plain ? {} : { 'x-requested-with': 'gully' }) } : {}), ...headers }, body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body) })
  const text = await r.text()
  let data = null
  try {
    data = JSON.parse(text)
  } catch {
    /* not json */
  }
  return { status: r.status, data, text }
}
const good = (n = 1) => ({ project: `Project ${n}`, contact: `team${n}@example.com`, useCase: 'defi', scale: 'small', gasToken: 'eth', da: 'rollup', wantsAa: 'yes', wantsDeepcore: 'no', notes: 'hello' })
const post = (body, ip) => call('/api/chains/waitlist', { method: 'POST', body, ip })
const stored = () => JSON.parse(fs.readFileSync(path.join(tmp, 'chains-waitlist.json'), 'utf8'))

try {
  /* ---- the offer comes from the config ---- */
  const plans = await call('/api/chains/plans')
  check('GET /api/chains/plans answers 200 and says nothing is live', plans.status === 200 && plans.data?.live === false)
  check('the testnet price is null (TBA) in the config and in the answer', CHAINS.testnet.monthlyUsd === null && plans.data?.testnet?.monthlyUsd === null)
  check('the testnet is free for the configured days', plans.data?.testnet?.freeDays === CHAINS.testnet.freeDays && CHAINS.testnet.freeDays === 30)
  check('managed mainnet price, profit share and DA come from the config', plans.data?.mainnet?.fromUsdPerMonth === CHAINS.mainnet.fromUsdPerMonth && plans.data?.mainnet?.sequencerProfitPct === CHAINS.mainnet.sequencerProfitPct && plans.data?.mainnet?.daAtCost === true && CHAINS.mainnet.fromUsdPerMonth === 3500 && CHAINS.mainnet.sequencerProfitPct === 5)
  check('every service and add-on in the config is in the answer', plans.data?.services?.length === SERVICES.length && plans.data?.addons?.length === CHAINS.addons.length)
  check('the price note says prices may change', /may change/i.test(plans.data?.note ?? ''))
  check('the services are marked included or add-on, and the not-yet-built ones carry a status', SERVICES.every((s) => s.kind === 'included' || s.kind === 'addon') && SERVICES.find((s) => s.id === 'aa')?.status === 'with-testnet' && SERVICES.find((s) => s.id === 'paymaster')?.status === 'with-testnet' && SERVICES.find((s) => s.id === 'usdc-gas')?.status === 'planned' && SERVICES.find((s) => s.id === 'deepcore')?.status === 'planned')
  const source = ['src/pages/Chains.tsx', 'src/pages/chains/Estimator.tsx', 'src/pages/chains/Waitlist.tsx'].map((f) => fs.readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, '$1')), '..', f), 'utf8')).join('\n')
  check('no price or rate is typed into the page source (3,500 / 3500 / 5%)', !/3,?500|\b5\s?%/.test(source))
  check('the page names no competitor', !/\b(conduit|caldera|alchemy|altlayer|raas|gelato|zksync|optimism stack|op stack|polygon cdk)\b/i.test(source + JSON.stringify(plans.data)))

  /* ---- validation ---- */
  const ok = await post(good(1), '10.1.0.1')
  check('a valid sign-up is accepted (201)', ok.status === 201 && ok.data?.ok === true)
  check('it is stored in DATA_DIR', stored().length === 1 && stored()[0].project === 'Project 1')
  const dup = await post(good(1), '10.1.0.2')
  check('the same contact again is not stored twice', dup.status === 200 && dup.data?.alreadyOnList === true && stored().length === 1)
  check('a Telegram handle is accepted as the contact', (await post({ ...good(2), contact: 'gully_team' }, '10.1.0.3')).status === 201 && stored().some((r) => r.contact === '@gully_team'))
  const bad = [
    ['no project name', { ...good(3), project: '  ' }],
    ['a contact that is neither email nor Telegram', { ...good(3), contact: 'nope' }],
    ['an unknown use case', { ...good(3), useCase: 'hax' }],
    ['an unknown scale', { ...good(3), scale: 'huge' }],
    ['an unknown gas token', { ...good(3), gasToken: 'btc' }],
    ['an unknown DA choice', { ...good(3), da: 'celestia' }],
    ['no AA answer', { ...good(3), wantsAa: undefined }],
    ['a non yes/no DeepCore answer', { ...good(3), wantsDeepcore: 'maybe' }],
  ]
  for (const [name, body] of bad) {
    const r = await post(body, '10.1.1.' + (bad.findIndex((b) => b[0] === name) + 1))
    check(`rejected: ${name}`, r.status === 400 && typeof r.data?.error === 'string', `status ${r.status}`)
  }
  check('not JSON is a 400', (await call('/api/chains/waitlist', { method: 'POST', body: 'not json{', ip: '10.1.2.1' })).status === 400)
  check('a request without the x-requested-with header is refused', (await call('/api/chains/waitlist', { method: 'POST', body: JSON.stringify(good(4)), ip: '10.1.2.2', plain: true })).status === 403)
  check('GET on the waitlist is 405', (await call('/api/chains/waitlist', { ip: '10.1.2.3' })).status === 405)
  const before = stored().length
  // The server drops the connection once the body passes the cap (as the contact form does), so a reset also counts.
  const big = await post({ ...good(5), notes: 'x'.repeat(50_000) }, '10.1.2.4').catch(() => ({ status: 0 }))
  check('a body over the size limit is refused and not stored', big.status !== 201 && big.status !== 200 && stored().length === before, `status ${big.status}`)
  await post({ ...good(6), project: 'p'.repeat(500), notes: 'n'.repeat(5000) }, '10.1.2.5')
  const longRow = stored().find((r) => r.contact === 'team6@example.com')
  check('long fields are cut to their limits', longRow?.project.length === 80 && longRow?.notes.length === 2000)

  /* ---- escaped storage ---- */
  await post({ ...good(7), project: '<script>alert(1)</script>', notes: '"><img src=x onerror=alert(1)> & \u0007bell' }, '10.1.3.1')
  const xss = stored().find((r) => r.contact === 'team7@example.com')
  check('HTML is stored escaped', xss && !/[<>]/.test(xss.project + xss.notes) && xss.project.includes('&lt;script&gt;'))
  check('control characters are removed', xss && !/[\u0000-\u0008\u000b-\u001f]/.test(xss.notes))

  /* ---- honeypot ---- */
  const n0 = stored().length
  const hp = await post({ ...good(8), website: 'http://spam.example' }, '10.1.4.1')
  check('a filled honeypot looks like a success', hp.status === 201 && hp.data?.ok === true)
  check('a filled honeypot stores nothing', stored().length === n0 && !stored().some((r) => r.contact === 'team8@example.com'))

  /* ---- rate limit (5 per IP per hour) ---- */
  const codes = []
  for (let i = 0; i < 7; i++) codes.push((await post({ ...good(20 + i) }, '10.9.9.9')).status)
  check('the 6th sign-up from one address in an hour is refused (429)', codes.slice(0, 5).every((c) => c === 201) && codes[5] === 429 && codes[6] === 429, codes.join(','))
  check('another address is not limited', (await post(good(30), '10.9.9.10')).status === 201)

  /* ---- admin ---- */
  check('the admin list without a token is 401', [401, 403].includes((await call('/api/admin/chains/waitlist')).status))
  check('the admin list with a wrong token is refused', [401, 403].includes((await call('/api/admin/chains/waitlist', { headers: { authorization: 'Bearer ' + 'x'.repeat(48) } })).status))
  const adm = await call('/api/admin/chains/waitlist', { headers: { authorization: `Bearer ${ADMIN}` } })
  check('the admin list with the token answers rows, newest first', adm.status === 200 && adm.data?.total === stored().length && adm.data?.rows?.[0]?.at >= adm.data?.rows?.at(-1)?.at)
  check('admin rows carry the answers', adm.data?.rows?.[0] && 'useCase' in adm.data.rows[0] && 'wantsDeepcore' in adm.data.rows[0])
  check('POST to the admin list is 405', (await call('/api/admin/chains/waitlist', { method: 'POST', body: {}, headers: { authorization: `Bearer ${ADMIN}` } })).status === 405)
  check('the waitlist survives in the file after restart-style reload', Array.isArray(stored()) && stored().length === adm.data.total)

  /* ---- SEO ---- */
  const { pageMeta, sitemapFor } = await import('../server/seo.mjs')
  const m = pageMeta('gullylabs.xyz', '/chains')
  check('/chains has SEO meta, found, and a canonical URL', m.found && /Gully Chains/.test(m.title) && m.canonical === 'https://gullylabs.xyz/chains')
  check('the meta description does not claim a chain is live', /testnet is coming/i.test(m.description) && !/\b(is|are) live\b/i.test(m.description))
  check('/chains is in the sitemap', sitemapFor('gullylabs.xyz').includes('<loc>https://gullylabs.xyz/chains</loc>'))
  check('the choices list is in the answer', Object.keys(WAITLIST_CHOICES).every((k) => plans.data?.choices?.[k]?.length === WAITLIST_CHOICES[k].length))
} catch (e) {
  check(`no exception (${e?.stack ?? e})`, false)
}

console.log(`\n${t.passed} passed, ${t.failed} failed`)
try {
  fs.rmSync(tmp, { recursive: true, force: true })
} catch {
  /* temp dir */
}
process.exit(t.failed ? 1 : 0)
