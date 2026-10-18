// Gully Security product UI server (server/security-routes.mjs): role gates, quotas, payment gating, publish
// visibility, review requests, rate limits, Server-Sent Events, admin and the public pages' head tags.
//
//   npm run test:security        (no build needed)
//
// The real server runs IN THIS PROCESS on port 8797 (TEST_PORT overrides) with a fresh temporary DATA_DIR and
// every chain's RPC pointed at a closed port. The scan engine is the STUB in scripts/fixtures (the real one is
// part 1 of the platform); it is installed through server/security-engine.mjs's test hook. Payments are
// marked paid in process (the invoice paid hook), since Gully Pay's own checks have their own suite.

import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { createStubEngine } from './fixtures/security-stub-engine.mjs'
import { guardTestRun, makeChecker, makeClient } from './test-helpers.mjs'

const PORT = Number(process.env.TEST_PORT) || 8797
await guardTestRun(PORT)
const BASE = `http://localhost:${PORT}`
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gully-security-'))
const ADMIN = crypto.randomBytes(24).toString('hex')
const TREASURY = '0x' + crypto.randomBytes(20).toString('hex')

Object.assign(process.env, {
  PORT: String(PORT),
  DATA_DIR: tmp,
  TRACKER_DATA: path.join(tmp, 'tracker-history.json'),
  DIST_DIR: path.join(tmp, 'no-dist'),
  ADMIN_TOKEN: ADMIN,
  TRACKER_LOOP: 'off',
  DEEPCORE_LOOP: 'off',
  TRACKER_SKIP_APIS: '1',
  ASK_REMOTE: 'off',
  GULLY_TREASURY_ADDRESS: TREASURY,
  ...Object.fromEntries([1, 56, 8453, 42161, 10, 137, 43114].map((id) => [`GULLY_RPC_${id}`, 'http://127.0.0.1:9'])),
})
for (const k of ['TELEGRAM_BOT_TOKEN', 'ANTHROPIC_API_KEY', 'TELEGRAM_ADMIN_CHAT_ID']) delete process.env[k]

await import('../server/server.mjs')
const engine = await import('../server/security-engine.mjs')
const routes = await import('../server/security-routes.mjs')
const billing = await import('../server/billing.mjs')
const invoices = await import('../server/invoices.mjs')
const store = await import('../server/store.mjs')
const seo = await import('../server/seo.mjs')
const { SECURITY } = await import('../server/plans.mjs')
await new Promise((r) => setTimeout(r, 300))

const t = makeChecker()
const { check } = t
const wallet = () => privateKeyToAccount(generatePrivateKey())
const W = { owner: wallet(), admin: wallet(), dev: wallet(), bill: wallet(), viewer: wallet(), other: wallet() }
const A = Object.fromEntries(Object.entries(W).map(([k, w]) => [k, w.address.toLowerCase()]))
const C = Object.fromEntries(Object.keys(W).map((k) => [k, makeClient(BASE)]))
for (const k of Object.keys(W)) if ((await C[k].signIn(W[k])).status !== 200) throw new Error(`sign-in failed for ${k}`)
const { owner: O, admin: AD, dev: D, bill: B, viewer: V, other: X } = C
const stub = createStubEngine({ stepMs: 120 })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const forbiddenRole = (r) => r.status === 403 && r.data?.code === 'forbidden-role'
const adminCall = (p, body) => fetch(BASE + p, { method: body ? 'POST' : 'GET', headers: { authorization: `Bearer ${ADMIN}`, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }).then(async (r) => ({ status: r.status, data: await r.json().catch(() => null), headers: r.headers }))
const pub = (p, init) => fetch(BASE + p, init).then(async (r) => ({ status: r.status, data: await r.json().catch(() => null), headers: r.headers }))
const ADDR = '0x' + '1b'.repeat(20)
const scanBody = (input, extra = {}) => ({ input, ...extra })
/** Polls one scan until `until(view)` or the timeout. */
async function waitFor(client, id, until, ms = 8_000) {
  const end = Date.now() + ms
  let last = null
  while (Date.now() < end) {
    last = (await client.call(`/api/developer/security/scans/${id}`)).data?.scan
    if (last && until(last)) return last
    await sleep(80)
  }
  return last
}
/** Marks a scan's invoice paid the way invoices.mjs does after a verified transfer, and runs the paid hooks. */
function payInvoice(invoiceId) {
  const inv = billing.ledger().invoices.find((i) => i.id === invoiceId)
  const payment = billing.recordPayment({ kind: 'invoice', invoiceId, txHash: '0x' + crypto.randomBytes(32).toString('hex'), chainId: 8453, assetId: 'usdc-base', symbol: 'USDC', decimals: 6, amountRaw: '99000000', usdCents: inv.usdCents, price: null, quoteId: null, from: '0x' + '22'.repeat(20), blockNumber: 1 }, null)
  inv.paymentId = payment.id
  inv.paidAt = payment.at
  billing.save()
  for (const h of invoices.invoicePaidHooks) h(inv, payment)
}

try {
  /* ------------------------------------------------------------- team --- */
  for (const [k, role] of [['admin', 'admin'], ['dev', 'developer'], ['bill', 'billing'], ['viewer', 'viewer']]) {
    const inv = await O.post('/api/developer/team/invite', { role })
    const token = String(inv.data?.link ?? '').split('#invite=')[1]
    const acc = await C[k].post('/api/developer/invite/accept', { token })
    if (acc.status !== 200 || acc.data?.active?.role !== role) throw new Error(`could not add ${k} as ${role}: ${acc.status}`)
  }

  /* --------------------------------------------------------- no engine --- */
  {
    const g = await O.call('/api/developer/security')
    check('overview: engine not installed until part 1 lands (or a stub)', g.status === 200 && g.data.engine.installed === false && g.data.quota.freePerMonth === SECURITY.scan.freePerMonth.free && g.data.chains.length >= 5, JSON.stringify(g.data?.engine))
    const r = await O.post('/api/developer/security/scans', scanBody({ kind: 'address', chain: 'base', address: ADDR }))
    check('no engine: a new scan is 503 engine-missing and nothing is stored', r.status === 503 && r.data.code === 'engine-missing' && (await O.call('/api/developer/security/scans')).data.scans.length === 0, `${r.status}`)
  }
  engine.setEngineForTest(stub)

  /* ------------------------------------------------------- role gates --- */
  {
    check('no session: 401', (await O.call('/api/developer/security', { useCookie: false })).status === 401)
    check('POST without X-Requested-With: 403', (await O.call('/api/developer/security/scans', { method: 'POST', body: scanBody({ kind: 'address', chain: 'base', address: ADDR }) })).status === 403)
    check('viewer cannot start a scan (forbidden-role)', forbiddenRole(await V.post('/api/developer/security/scans', scanBody({ kind: 'address', chain: 'base', address: ADDR }))))
    check('billing cannot start a scan (forbidden-role)', forbiddenRole(await B.post('/api/developer/security/scans', scanBody({ kind: 'address', chain: 'base', address: ADDR }))))
    check('viewer can read the overview', (await V.call('/api/developer/security')).data?.canPublish === false)
    check('admin sees canPublish', (await AD.call('/api/developer/security')).data?.canPublish === true)
  }

  /* ------------------------------------------------------- validation --- */
  {
    const bad = async (input, upload) => (await D.post('/api/developer/security/scans', { input, upload })).status === 400
    check('400: unknown kind', await bad({ kind: 'binary' }))
    check('400: unknown chain', await bad({ kind: 'address', chain: 'tron', address: ADDR }))
    check('400: malformed address', await bad({ kind: 'address', chain: 'base', address: '0x1234' }))
    check('400: zero address', await bad({ kind: 'address', chain: 'base', address: '0x' + '0'.repeat(40) }))
    check('400: repo that is not GitHub owner/name', await bad({ kind: 'repo', repo: 'https://gitlab.com/a/b' }))
    check('400: commit that is not hex', await bad({ kind: 'repo', repo: 'gully-labs/sdk', commit: 'main' }))
    check('400: upload with a bad name', await bad({ kind: 'upload' }, { name: 'evil.exe', data: Buffer.from('x').toString('base64') }))
    check('400: upload over the size cap', await bad({ kind: 'upload' }, { name: 'big.zip', data: Buffer.alloc(SECURITY.scan.maxUploadBytes + 10).toString('base64') }))
    check('400: upload missing', await bad({ kind: 'upload' }))
  }

  /* --------------------------------------------------- quota and pay --- */
  let freeId
  let paidId
  let invoiceId
  {
    const r = await D.post('/api/developer/security/scans', scanBody({ kind: 'address', chain: 'base', address: ADDR }, { expect: { priceUsd: 0 } }))
    freeId = r.data?.scan?.id
    check('developer: the free scan starts (201), engine called with the workspace', r.status === 201 && r.data.scan.free === true && r.data.scan.priceUsd === 0 && stub.calls.length === 1 && stub.calls[0].workspace === A.owner, `${r.status} ${JSON.stringify(r.data).slice(0, 160)}`)
    check('the scan id is ours (sec_…), not the engine id', /^sec_[\w-]{16}$/.test(freeId ?? '') && !JSON.stringify(r.data).includes('stub_1'))
    const q = (await O.call('/api/developer/security')).data.quota
    check('quota: free plan used 1 of 1, next costs the configured price', q.used === 1 && q.left === 0 && q.nextPriceUsd === SECURITY.scan.priceUsd, JSON.stringify(q))
    const again = await D.post('/api/developer/security/scans', scanBody({ kind: 'repo', repo: 'gully-labs/sdk' }, { expect: { priceUsd: 0 } }))
    check('price changed since confirm: 409 price-changed, nothing created', again.status === 409 && again.data.code === 'price-changed' && stub.calls.length === 1)
    delete process.env.GULLY_TREASURY_ADDRESS
    const off = await D.post('/api/developer/security/scans', scanBody({ kind: 'repo', repo: 'gully-labs/sdk' }, { expect: { priceUsd: SECURITY.scan.priceUsd } }))
    check('checkout off (no treasury): 402, nothing charged', off.status === 402 && off.data.code === 'checkout-off')
    process.env.GULLY_TREASURY_ADDRESS = TREASURY
    const paid = await D.post('/api/developer/security/scans', scanBody({ kind: 'repo', repo: 'https://github.com/gully-labs/sdk', commit: 'ABCDEF1' }, { expect: { priceUsd: SECURITY.scan.priceUsd } }))
    paidId = paid.data?.scan?.id
    invoiceId = paid.data?.payment?.invoiceId
    check('beyond the quota: 202 with a Gully Pay invoice, scan awaiting payment, engine not called', paid.status === 202 && paid.data.scan.status === 'awaiting_payment' && /^inv_/.test(invoiceId ?? '') && paid.data.payment.payUrl === `/pay/${invoiceId}` && paid.data.payment.usd === SECURITY.scan.priceUsd && stub.calls.length === 1, JSON.stringify(paid.data).slice(0, 200))
    check('repo input normalised to owner/name and a lower-case commit', paid.data?.scan?.input?.repo === 'gully-labs/sdk' && paid.data.scan.input.commit === 'abcdef1')
    const inv = await pub(`/api/pay/${invoiceId}`)
    check('the invoice is a real open Gully Pay invoice for the price', inv.status === 200 && inv.data.invoice.status === 'open' && inv.data.invoice.usdCents === String(SECURITY.scan.priceUsd * 100) && /AI Security Scan/.test(inv.data.invoice.title))
    payInvoice(invoiceId)
    const started = await waitFor(D, paidId, (s) => s.status !== 'awaiting_payment')
    check('once the invoice is paid the scan starts', started?.status !== 'awaiting_payment' && stub.calls.length === 2 && stub.calls[1].input.repo === 'gully-labs/sdk' && started.payment.status === 'paid', started?.status)
    // A second paid scan, cancelled before payment: the invoice is cancelled too. (Two scans are running, the
    // most at once, so they are finished first.)
    check('a third scan while two run is refused (429), paid or not', (await D.post('/api/developer/security/scans', scanBody({ kind: 'web2', repo: 'gully-labs/website' }))).data?.code === 'too-many-active')
    stub.finishAll()
    const c = await D.post('/api/developer/security/scans', scanBody({ kind: 'web2', repo: 'gully-labs/website' }, { expect: { priceUsd: SECURITY.scan.priceUsd } }))
    const cc = await D.post(`/api/developer/security/scans/${c.data.scan.id}/cancel`)
    check('cancel before payment: scan cancelled and its invoice cancelled', cc.status === 200 && cc.data.scan.status === 'cancelled' && (await pub(`/api/pay/${c.data.payment.invoiceId}`)).data.invoice.status === 'cancelled')
    check('viewer cannot cancel (forbidden-role)', forbiddenRole(await V.post(`/api/developer/security/scans/${paidId}/cancel`)))
  }

  /* --------------------------------------------------------- progress --- */
  {
    const done = await waitFor(O, freeId, (s) => s.status === 'done')
    check('the scan walks the steps to done with a report', done?.status === 'done' && done.progress?.pct === 100 && done.report?.findings?.length === 4 && done.counts?.high === 1, done?.status)
    check('the full view carries the draft PoC to members', !!done?.report?.findings?.find((f) => f.id === 'F-1')?.poc)
    check('another workspace cannot read it (404)', (await X.call(`/api/developer/security/scans/${freeId}`)).status === 404)
    // SSE: a new paid scan's stream ends on its terminal event.
    await adminCall(`/api/admin/accounts/${A.owner}/plan`, { plan: 'pro', days: 30 })
    const s = await D.post('/api/developer/security/scans', scanBody({ kind: 'address', chain: 'arbitrum', address: ADDR }, { expect: { priceUsd: 0 } }))
    check('pro plan: more free scans (201)', s.status === 201, `${s.status} ${s.data?.error ?? ''}`)
    const res = await fetch(`${BASE}/api/developer/security/scans/${s.data.scan.id}/events`, { headers: { cookie: D.cookie } })
    const text = await res.text()
    const events = [...text.matchAll(/event: scan\ndata: (.+)\n\n/g)].map((m) => JSON.parse(m[1]))
    check('SSE: text/event-stream, several scan events, ends with done', res.headers.get('content-type')?.startsWith('text/event-stream') && events.length >= 3 && events.at(-1).status === 'done' && events.some((e) => e.status === 'analysing'), events.map((e) => e.status).join(','))
  }

  /* ------------------------------------------- failures, active limit --- */
  {
    routes.resetSecurityLimitsForTest()
    const f = await D.post('/api/developer/security/scans', scanBody({ kind: 'repo', repo: 'gully-labs/will-fail' }))
    const ff = await waitFor(D, f.data.scan.id, (s) => s.status === 'failed')
    check('a failed scan reports failed with the engine reason', ff?.status === 'failed' && /FIXTURE/.test(ff.failure ?? ''), ff?.status)
    const q1 = (await O.call('/api/developer/security')).data.quota
    check('a failed scan does not use the free quota', q1.used === 2, JSON.stringify(q1))
    // Two running: the third is refused.
    const a1 = await D.post('/api/developer/security/scans', scanBody({ kind: 'address', chain: 'ethereum', address: ADDR }))
    check('one more free scan on pro', a1.status === 201, `${a1.status} ${a1.data?.error ?? ''}`)
    await adminCall(`/api/admin/accounts/${A.owner}/plan`, { plan: 'business', days: 30 })
    const a2 = await D.post('/api/developer/security/scans', scanBody({ kind: 'address', chain: 'polygon', address: ADDR }))
    const a3 = await D.post('/api/developer/security/scans', scanBody({ kind: 'address', chain: 'bsc', address: ADDR }))
    check(`at most ${SECURITY.scan.maxActive} scans run at once (429 too-many-active)`, a2.status === 201 && a3.status === 429 && a3.data.code === 'too-many-active', `${a2.status} ${a3.status}`)
    const cancel = await D.post(`/api/developer/security/scans/${a2.data.scan.id}/cancel`)
    check('cancel a running scan', cancel.status === 200 && cancel.data.scan.status === 'cancelled', `${cancel.status} ${cancel.data?.scan?.status}`)
    check('cancel a finished scan is 409', (await D.post(`/api/developer/security/scans/${freeId}/cancel`)).status === 409)
    stub.finishAll()
  }

  /* ---------------------------------------------------------- publish --- */
  {
    routes.resetSecurityLimitsForTest()
    check('developer cannot publish (forbidden-role)', forbiddenRole(await D.post(`/api/developer/security/scans/${freeId}/publish`, { published: true })))
    check('publish needs { published: boolean }', (await O.post(`/api/developer/security/scans/${freeId}/publish`, {})).status === 400)
    const running = await O.post('/api/developer/security/scans', scanBody({ kind: 'address', chain: 'optimism', address: ADDR }))
    check('a scan that is not done cannot be published (409)', (await O.post(`/api/developer/security/scans/${running.data.scan.id}/publish`, { published: true })).status === 409)
    check('unpublished report: public 404', (await pub(`/api/security/reports/${freeId}`)).status === 404)
    const p = await O.post(`/api/developer/security/scans/${freeId}/publish`, { published: true })
    check('owner publishes: public URL, not indexable by default', p.status === 200 && p.data.scan.published && p.data.scan.publicUrl === `/security/reports/${freeId}` && p.data.scan.indexable === false)
    const r = await pub(`/api/security/reports/${freeId}`)
    check('public report: 200, noindex header, findings and tools', r.status === 200 && r.headers.get('x-robots-tag') === 'noindex' && r.data.report.findings.length === 4 && r.data.report.tools.some((x) => !x.ran && x.reason))
    check('public report: never the draft PoC, the cost or the workspace', !JSON.stringify(r.data).includes('contract Attack') && !('cost' in r.data.report) && !JSON.stringify(r.data).includes(A.owner) && r.data.report.findings[0].hasPoc === true)
    const list = await pub('/api/security/reports')
    check('public index lists it with severity counts', list.data.reports.length === 1 && list.data.reports[0].id === freeId && list.data.reports[0].counts.high === 1)
    check('head tags: published report is a page, noindex', seo.pageMeta('gullylabs.xyz', `/security/reports/${freeId}`).found === true && seo.pageMeta('gullylabs.xyz', `/security/reports/${freeId}`).noindex === true)
    check('sitemap: a noindex report is left out', !seo.sitemapFor('gullylabs.xyz').includes(freeId) && seo.sitemapFor('gullylabs.xyz').includes('/security<'))
    const admin = await AD.post(`/api/developer/security/scans/${freeId}/publish`, { published: true, indexable: true })
    check('workspace admin can publish and opt in to indexing', admin.status === 200 && admin.data.scan.indexable === true)
    check('indexable: no X-Robots-Tag, head tags indexable, in the sitemap', !(await pub(`/api/security/reports/${freeId}`)).headers.get('x-robots-tag') && !seo.pageMeta('gullylabs.xyz', `/security/reports/${freeId}`).noindex && seo.sitemapFor('gullylabs.xyz').includes(`/security/reports/${freeId}`))
    const un = await O.post(`/api/developer/security/scans/${freeId}/publish`, { published: false })
    check('unpublish: public 404, head tags 404, out of the index', un.status === 200 && (await pub(`/api/security/reports/${freeId}`)).status === 404 && seo.pageMeta('gullylabs.xyz', `/security/reports/${freeId}`).found === false && (await pub('/api/security/reports')).data.reports.length === 0)
    check('unknown or malformed report ids are 404', (await pub('/api/security/reports/sec_AAAAAAAAAAAAAAAA')).status === 404 && (await pub('/api/security/reports/sec_short')).status === 404 && (await pub('/api/security/reports/a%2Fb')).status === 404)
    await O.post(`/api/developer/security/scans/${freeId}/publish`, { published: true })
    check('admin can take a report down', (await adminCall(`/api/admin/security/scans/${freeId}/unpublish`, {})).status === 200 && (await pub(`/api/security/reports/${freeId}`)).status === 404)
  }

  /* ------------------------------------------------------------ stats --- */
  {
    const s = await pub('/api/security/stats')
    const today = s.data.days.at(-1)
    check('stats: real counts only (started, done, failed) and 30 days', s.status === 200 && s.data.days.length === 30 && s.data.totals.started >= 5 && s.data.totals.failed === 1 && today.started === s.data.totals.started, JSON.stringify(s.data.totals))
  }

  /* --------------------------------------------------- review requests --- */
  {
    routes.resetSecurityLimitsForTest()
    const good = { tier: 'review', name: 'Ada', email: 'ada@example.com', project: 'Vaults', scope: 'Two vault contracts and a router, about 900 lines of Solidity.', repo: 'gully-labs/sdk', chain: 'base', address: ADDR, timeline: 'next month' }
    check('review request: needs X-Requested-With', (await pub('/api/security/review-requests', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(good) })).status === 403)
    const post = (b) => pub('/api/security/review-requests', { method: 'POST', headers: { 'content-type': 'application/json', 'x-requested-with': 'gully' }, body: JSON.stringify(b) })
    check('review request: a short scope is 400', (await post({ ...good, scope: 'hi' })).status === 400)
    check('review request: a bad email is 400', (await post({ ...good, email: 'nope' })).status === 400)
    const ok = await post(good)
    check('review request: stored (201)', ok.status === 201 && /^rr_/.test(ok.data.request.id) && ok.data.request.status === 'new')
    check('review request: in the existing admin enquiries inbox', store.listEnquiries().some((e) => e.securityReviewId === ok.data.request.id && e.types.includes('Security Review')))
    const bot = await post({ ...good, email: 'bot@example.com', website: 'http://spam' })
    const adm = await adminCall('/api/admin/security')
    check('honeypot: answered 201 but stored nowhere', bot.status === 201 && adm.data.reviews.length === 1)
    check('rate limit: the 6th request from one address in an hour is 429', (await post({ ...good, email: 'c@example.com' })).status === 201 && (await post({ ...good, email: 'd@example.com' })).status === 429)
    routes.resetSecurityLimitsForTest()
    for (let i = 0; i < 3; i++) await post({ ...good, project: `P${i}` })
    check('rate limit: at most 3 requests per email per day', (await post({ ...good, project: 'P9' })).status === 429)
    const audit = await post({ ...good, tier: 'audit', email: 'f@example.com' })
    check('an Audit request is accepted (the tier is not sold yet, requests are taken)', audit.status === 201 && audit.data.request.tier === 'audit')
  }

  /* -------------------------------------------------------- rate limits --- */
  {
    routes.resetSecurityLimitsForTest()
    let last
    for (let i = 0; i < 21; i++) last = await D.post('/api/developer/security/scans', { input: { kind: 'nope' } })
    check('rate limit: 20 scan requests per workspace per hour, then 429', last.status === 429)
    routes.resetSecurityLimitsForTest()
  }

  /* ------------------------------------------------------------- admin --- */
  {
    check('admin: needs the token', (await pub('/api/admin/security')).status === 401)
    const a = await adminCall('/api/admin/security')
    check('admin: queue, 30 days, failures, review requests', a.status === 200 && Array.isArray(a.data.queue) && a.data.days.length === 30 && a.data.failures.some((f) => f.status === 'failed') && a.data.reviews.length >= 3 && a.data.engine.installed === true, JSON.stringify(a.data?.totals))
    const id = a.data.reviews[0].id
    check('admin: a bad review status is 400', (await adminCall(`/api/admin/security/reviews/${id}`, { status: 'maybe' })).status === 400)
    const up = await adminCall(`/api/admin/security/reviews/${id}`, { status: 'quoted', note: 'Sent a quote.' })
    check('admin: review status and note saved', up.status === 200 && up.data.review.status === 'quoted' && up.data.review.note === 'Sent a quote.')
  }

  /* -------------------------------------------------- persistence, paid restart --- */
  {
    const raw = JSON.parse(fs.readFileSync(path.join(tmp, 'security.json'), 'utf8'))
    check('stored: jobs and reviews in DATA_DIR/security.json', raw.jobs.length >= 6 && raw.reviews.length >= 3)
    check('stored: no upload bytes or secrets in the job records', !JSON.stringify(raw.jobs).includes('"data"'))
    check('plans: GET /api/plans carries the security offer', (await pub('/api/plans')).data.security.scan.priceUsd === SECURITY.scan.priceUsd)
    check('head tags: /security and /security/reports are pages', seo.pageMeta('gullylabs.xyz', '/security').found && seo.pageMeta('gullylabs.xyz', '/security/reports').found)
  }
} catch (e) {
  check(`no exception (${String(e?.stack ?? e).split('\n').slice(0, 3).join(' | ')})`, false)
}

stub.finishAll?.()
fs.rmSync(tmp, { recursive: true, force: true })
console.log(`\n${t.passed} passed, ${t.failed} failed`)
process.exit(t.failed ? 1 : 0)
