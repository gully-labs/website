// Gully Security product UI server (server/security-routes.mjs) on the REAL scan engine (server/security):
// role gates, quotas, payment gating, the engine's refusals, duplicates, publish visibility, review requests,
// rate limits, Server-Sent Events, the HTML report, admin and the public pages' head tags.
//
//   npm run test:security-routes        (no build needed)
//
// The real server runs IN THIS PROCESS on port 8797 (TEST_PORT overrides) with a fresh temporary DATA_DIR and
// every chain's RPC pointed at a closed port. The engine's outbound calls go to a local stub
// (scripts/fixtures/security-engine-stubs.mjs: explorers, GitHub, RPC, Claude; the static-tools worker absent,
// as on the server today, so scans are "AI review only"). Payments are marked paid in process (the invoice
// paid hook), since Gully Pay's own checks have their own suite.

import crypto from 'node:crypto'
import fs from 'node:fs'
import zlib from 'node:zlib'
import os from 'node:os'
import path from 'node:path'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { installEngineStubs } from './fixtures/security-engine-stubs.mjs'
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

const stubs = await installEngineStubs()
await import('../server/server.mjs')
const routes = await import('../server/security-routes.mjs')
const engineAdapter = await import('../server/security-engine.mjs')
const billing = await import('../server/billing.mjs')
const invoices = await import('../server/invoices.mjs')
const store = await import('../server/store.mjs')
const seo = await import('../server/seo.mjs')
const { publishedReportFor } = await import('../server/security/reports.mjs')
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const forbiddenRole = (r) => r.status === 403 && r.data?.code === 'forbidden-role'
const adminCall = (p, body) => fetch(BASE + p, { method: body ? 'POST' : 'GET', headers: { authorization: `Bearer ${ADMIN}`, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }).then(async (r) => ({ status: r.status, data: await r.json().catch(() => null), headers: r.headers }))
const pub = (p, init) => fetch(BASE + p, init).then(async (r) => ({ status: r.status, data: await r.json().catch(() => null), headers: r.headers }))
const VERIFIED = { kind: 'address', chain: 'base', address: stubs.ADDR_VERIFIED }
/** A one-file zip (stored, no compression): enough for the engine's input checks. */
function storedZip(name, text) {
  const data = Buffer.from(text)
  const n = Buffer.from(name)
  const crc = zlib.crc32(data)
  const local = Buffer.alloc(30)
  local.writeUInt32LE(0x04034b50, 0)
  local.writeUInt16LE(20, 4)
  local.writeUInt32LE(crc, 14)
  local.writeUInt32LE(data.length, 18)
  local.writeUInt32LE(data.length, 22)
  local.writeUInt16LE(n.length, 26)
  const central = Buffer.alloc(46)
  central.writeUInt32LE(0x02014b50, 0)
  central.writeUInt16LE(20, 4)
  central.writeUInt16LE(20, 6)
  central.writeUInt32LE(crc, 16)
  central.writeUInt32LE(data.length, 20)
  central.writeUInt32LE(data.length, 24)
  central.writeUInt16LE(n.length, 28)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(1, 8)
  end.writeUInt16LE(1, 10)
  end.writeUInt32LE(46 + n.length, 12)
  end.writeUInt32LE(30 + n.length + data.length, 16)
  return Buffer.concat([local, n, data, central, n, end])
}
const create = (client, input, extra = {}) => client.post('/api/developer/security/scans', { input, ...extra })
/** Polls one scan until `until(view)` or the timeout. */
async function waitFor(client, id, until, ms = 20_000) {
  const end = Date.now() + ms
  let last = null
  while (Date.now() < end) {
    last = (await client.call(`/api/developer/security/scans/${id}`)).data?.scan
    if (last && until(last)) return last
    await sleep(100)
  }
  return last
}
const finished = (s) => ['done', 'failed', 'cancelled'].includes(s.status)
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

  /* ---------------------------------------------------------- engine state --- */
  {
    const g = await O.call('/api/developer/security')
    check('overview: engine state (AI on, static-tools worker off), quota, chains with logo keys', g.status === 200 && g.data.engine.ai === true && g.data.engine.worker === false && g.data.quota.freePerMonth === SECURITY.scan.freePerMonth.free && g.data.chains.some((c) => c.key === 'bnb' && c.logo === 'bsc'), JSON.stringify(g.data?.engine))
    stubs.setAi(false)
    engineAdapter.resetStatusCacheForTest()
    const r = await create(D, { kind: 'github', repo: stubs.REPO })
    check('no AI and no worker: a code scan is 503 engine-unavailable, nothing stored', r.status === 503 && r.data.code === 'engine-unavailable' && (await O.call('/api/developer/security/scans')).data.scans.length === 0, `${r.status} ${r.data?.code}`)
    stubs.setAi(true)
    engineAdapter.resetStatusCacheForTest()
  }

  /* ------------------------------------------------------- role gates --- */
  {
    check('no session: 401', (await O.call('/api/developer/security', { useCookie: false })).status === 401)
    check('POST without X-Requested-With: 403', (await O.call('/api/developer/security/scans', { method: 'POST', body: { input: VERIFIED } })).status === 403)
    check('viewer cannot start a scan (forbidden-role)', forbiddenRole(await create(V, VERIFIED)))
    check('billing cannot start a scan (forbidden-role)', forbiddenRole(await create(B, VERIFIED)))
    check('viewer can read the overview, cannot publish', (await V.call('/api/developer/security')).data?.canPublish === false)
    check('admin sees canPublish', (await AD.call('/api/developer/security')).data?.canPublish === true)
  }

  /* ------------------------------------------------------- validation --- */
  {
    const bad = async (input, upload, code = 400) => (await D.post('/api/developer/security/scans', { input, upload })).status === code
    check('400: unknown kind', await bad({ kind: 'binary' }))
    check('400: unknown chain', await bad({ kind: 'address', chain: 'tron', address: stubs.ADDR_VERIFIED }))
    check('400: malformed address', await bad({ kind: 'address', chain: 'base', address: '0x1234' }))
    check('400: zero address', await bad({ kind: 'address', chain: 'base', address: '0x' + '0'.repeat(40) }))
    check('400: repo that is not GitHub owner/name', await bad({ kind: 'github', repo: 'https://gitlab.com/a/b' }))
    check('400: commit that is not hex', await bad({ kind: 'github', repo: stubs.REPO, commit: 'main' }))
    check('400: upload with a bad name', await bad({ kind: 'upload' }, { name: 'evil.exe', data: Buffer.from('x').toString('base64') }))
    check('413: upload over the size cap', await bad({ kind: 'upload' }, { name: 'big.zip', data: Buffer.alloc(SECURITY.scan.maxUploadBytes + 10).toString('base64') }, 413))
    const nz = await D.post('/api/developer/security/scans', { input: { kind: 'upload' }, upload: { name: 'code.zip', data: Buffer.from('not a zip at all').toString('base64') } })
    check("400: the engine's own refusal (not a zip) in plain words, before any charge", nz.status === 400 && /scan engine cannot take this input: the file is not a zip archive/.test(nz.data.error ?? '') && nz.data.code === 'bad-upload', nz.data?.error)
  }

  /* --------------------------------------------------- quota and pay --- */
  let freeId
  let paidId
  {
    const r = await create(D, VERIFIED, { expect: { priceUsd: 0 } })
    freeId = r.data?.scan?.id
    check('developer: the free scan starts (201) in the engine', r.status === 201 && r.data.scan.free === true && r.data.scan.priceUsd === 0 && ['queued', 'fetching', 'analysing', 'triaging', 'reporting', 'done'].includes(r.data.scan.status), `${r.status} ${JSON.stringify(r.data).slice(0, 200)}`)
    check('the scan id is ours (sec_…), not the engine one (scn_…)', /^sec_[\w-]{16}$/.test(freeId ?? '') && !JSON.stringify(r.data).includes('scn_'))
    const dup = await create(D, VERIFIED, { expect: { priceUsd: SECURITY.scan.priceUsd } })
    check('the same target while it runs: that scan back, duplicate: true, nothing charged', dup.status === 200 && dup.data.scan.id === freeId && dup.data.scan.duplicate === true && !dup.data.payment)
    const q = (await O.call('/api/developer/security')).data.quota
    check('quota: free plan used 1 of 1, next costs the configured price', q.used === 1 && q.left === 0 && q.nextPriceUsd === SECURITY.scan.priceUsd, JSON.stringify(q))
    const again = await create(D, { kind: 'github', repo: stubs.REPO, commit: stubs.COMMIT.slice(0, 10) }, { expect: { priceUsd: 0 } })
    check('price changed since confirm: 409 price-changed', again.status === 409 && again.data.code === 'price-changed')
    delete process.env.GULLY_TREASURY_ADDRESS
    const off = await create(D, { kind: 'github', repo: stubs.REPO, commit: stubs.COMMIT.slice(0, 10) }, { expect: { priceUsd: SECURITY.scan.priceUsd } })
    check('checkout off (no treasury): 402, nothing charged', off.status === 402 && off.data.code === 'checkout-off')
    process.env.GULLY_TREASURY_ADDRESS = TREASURY
    const paid = await create(D, { kind: 'github', repo: `https://github.com/${stubs.REPO}`, commit: stubs.COMMIT.slice(0, 10).toUpperCase() }, { expect: { priceUsd: SECURITY.scan.priceUsd } })
    paidId = paid.data?.scan?.id
    const invoiceId = paid.data?.payment?.invoiceId
    check('beyond the quota: 202 with a Gully Pay invoice, awaiting payment', paid.status === 202 && paid.data.scan.status === 'awaiting_payment' && /^inv_/.test(invoiceId ?? '') && paid.data.payment.payUrl === `/pay/${invoiceId}` && paid.data.payment.usd === SECURITY.scan.priceUsd, JSON.stringify(paid.data).slice(0, 200))
    check('repo input normalised to owner/name and a lower-case commit', paid.data?.scan?.input?.repo === stubs.REPO && paid.data.scan.input.commit === stubs.COMMIT.slice(0, 10))
    const inv = await pub(`/api/pay/${invoiceId}`)
    check('the invoice is a real open Gully Pay invoice for the price', inv.status === 200 && inv.data.invoice.status === 'open' && inv.data.invoice.usdCents === String(SECURITY.scan.priceUsd * 100) && /AI Security Scan/.test(inv.data.invoice.title))
    const done = await waitFor(O, freeId, finished)
    check('the free scan finishes with the engine report ("AI review only")', done?.status === 'done' && done.mode === 'ai-only' && /AI review only/.test(done.label ?? '') && done.report?.findings?.length >= 1 && done.progress?.pct === 100, `${done?.status} ${done?.mode} ${done?.failure ?? ''}`)
    check('the report: verifiedByHuman false, PoC draft-not-executed, disclaimer, no "audit" in title or label', done?.report?.findings.every((f) => f.verifiedByHuman === false) && done.report.findings.some((f) => f.poc?.status === 'draft-not-executed') && /not an audit/.test(done.report.disclaimer) && !/audit/i.test(`${done.report.title} ${done.report.label}`))
    payInvoice(invoiceId)
    const started = await waitFor(D, paidId, (s) => s.status !== 'awaiting_payment')
    check('once the invoice is paid the scan starts', !!started && started.status !== 'awaiting_payment' && started.payment.status === 'paid', started?.status)
    const paidDone = await waitFor(D, paidId, finished)
    check('the paid repo scan finishes', paidDone?.status === 'done', `${paidDone?.status} ${paidDone?.failure ?? ''}`)
    const c = await create(D, { kind: 'github', repo: stubs.REPO, ref: 'main' }, { expect: { priceUsd: SECURITY.scan.priceUsd } })
    const cc = await D.post(`/api/developer/security/scans/${c.data.scan.id}/cancel`)
    check('cancel before payment: scan and invoice cancelled', cc.status === 200 && cc.data.scan.status === 'cancelled' && (await pub(`/api/pay/${c.data.payment.invoiceId}`)).data.invoice.status === 'cancelled')
    check('viewer cannot cancel (forbidden-role)', forbiddenRole(await V.post(`/api/developer/security/scans/${paidId}/cancel`)))
    check('another workspace cannot read a scan (404)', (await X.call(`/api/developer/security/scans/${freeId}`)).status === 404)
    const html = await fetch(`${BASE}/api/developer/security/scans/${freeId}/report.html`, { headers: { cookie: D.cookie } })
    const text = await html.text()
    check('Export PDF: the engine HTML report, print-ready, noindex, with the PoC for members', html.status === 200 && /text\/html/.test(html.headers.get('content-type')) && /gs-report/.test(text) && /draft-not-executed/.test(text) && html.headers.get('x-robots-tag') === 'noindex')
  }

  /* ------------------------------------------- failures, SSE, active limit --- */
  {
    routes.resetSecurityLimitsForTest()
    await adminCall(`/api/admin/accounts/${A.owner}/plan`, { plan: 'business', days: 30 })
    const f = await create(D, { kind: 'github', repo: 'acme/missing', commit: 'abcdef1' })
    const ff = await waitFor(D, f.data?.scan?.id, finished)
    check('a failed scan shows the plain reason', ff?.status === 'failed' && /not found/i.test(ff.failure ?? ''), `${ff?.status} ${ff?.failure}`)
    const q1 = (await O.call('/api/developer/security')).data.quota
    check('a failed scan does not use the free quota', q1.used === 1, JSON.stringify(q1))
    stubs.setDelay(1_500)
    const s1 = await create(D, { kind: 'address', chain: 'arbitrum', address: stubs.ADDR_VERIFIED })
    const s2 = await create(D, { kind: 'address', chain: 'ethereum', address: stubs.ADDR_VERIFIED })
    const s3 = await create(D, { kind: 'address', chain: 'polygon', address: stubs.ADDR_VERIFIED })
    check(`at most ${SECURITY.scan.maxActive} scans at once (429 too-many-active)`, s1.status === 201 && s2.status === 201 && s3.status === 429 && s3.data.code === 'too-many-active', `${s1.status} ${s2.status} ${s3.status}`)
    const cancel = await D.post(`/api/developer/security/scans/${s2.data.scan.id}/cancel`)
    check('cancel a queued scan (the engine runs one at a time)', cancel.status === 200 && cancel.data.scan.status === 'cancelled', `${cancel.status} ${cancel.data?.scan?.status}`)
    const res = await fetch(`${BASE}/api/developer/security/scans/${s1.data.scan.id}/events`, { headers: { cookie: D.cookie } })
    const text = await res.text()
    const events = [...text.matchAll(/event: scan\ndata: (.+)\n\n/g)].map((m) => JSON.parse(m[1]))
    check('SSE: several scan events with pct and the step message, ending with done', res.headers.get('content-type')?.startsWith('text/event-stream') && events.length >= 3 && events.at(-1).status === 'done' && events.some((e) => typeof e.progress?.pct === 'number' && e.progress.message), events.map((e) => `${e.status}:${e.progress?.pct}`).join(','))
    check('cancel a finished scan is 409', (await D.post(`/api/developer/security/scans/${freeId}/cancel`)).status === 409)
    stubs.setDelay(0)
  }

  /* ---------------------------------------------------------- publish --- */
  {
    routes.resetSecurityLimitsForTest()
    check('developer cannot publish (forbidden-role)', forbiddenRole(await D.post(`/api/developer/security/scans/${freeId}/publish`, { published: true })))
    check('publish needs { published: boolean }', (await O.post(`/api/developer/security/scans/${freeId}/publish`, {})).status === 400)
    stubs.setDelay(800)
    const running = await create(O, { kind: 'address', chain: 'optimism', address: stubs.ADDR_VERIFIED })
    check('a scan that is not done cannot be published (409)', (await O.post(`/api/developer/security/scans/${running.data.scan.id}/publish`, { published: true })).status === 409)
    stubs.setDelay(0)
    check('unpublished report: public 404', (await pub(`/api/security/reports/${freeId}`)).status === 404)
    const p = await O.post(`/api/developer/security/scans/${freeId}/publish`, { published: true })
    check('owner publishes: public URL, not indexable by default', p.status === 200 && p.data.scan.published && p.data.scan.publicUrl === `/security/reports/${freeId}` && p.data.scan.indexable === false)
    const r = await pub(`/api/security/reports/${freeId}`)
    check('public report: 200, noindex header, findings, tools, mode label', r.status === 200 && r.headers.get('x-robots-tag') === 'noindex' && r.data.report.findings.length >= 1 && r.data.report.tools.some((x) => x.status !== 'ran') && /AI review only/.test(r.data.report.label))
    check('public report: never the PoC code or the workspace (the PoC status stays)', !JSON.stringify(r.data).includes('test_reenter') && !JSON.stringify(r.data).includes(A.owner) && r.data.report.findings.some((f) => f.poc?.status === 'draft-not-executed' && f.poc.code === ''))
    const ph = await fetch(`${BASE}/api/security/reports/${freeId}/report.html`)
    const phText = await ph.text()
    check('public printable HTML: the engine render of the snapshot, no PoC code', ph.status === 200 && /gs-report/.test(phText) && !phText.includes('test_reenter'))
    const list = await pub('/api/security/reports')
    check('public index lists it with severity counts', list.data.reports.length === 1 && list.data.reports[0].id === freeId && list.data.reports[0].counts.high >= 1)
    const pr = publishedReportFor(8453, stubs.ADDR_VERIFIED)
    check('Gully Score source: publishedReportFor gives the published report with its severities', pr?.status === 'published' && pr.url.endsWith(`/security/reports/${freeId}`) && pr.severities.high >= 1 && publishedReportFor(1, stubs.ADDR_VERIFIED) === null, JSON.stringify(pr))
    check('head tags: published report is a page, noindex', seo.pageMeta('gullylabs.xyz', `/security/reports/${freeId}`).found === true && seo.pageMeta('gullylabs.xyz', `/security/reports/${freeId}`).noindex === true)
    check('sitemap: a noindex report is left out', !seo.sitemapFor('gullylabs.xyz').includes(freeId) && seo.sitemapFor('gullylabs.xyz').includes('/security<'))
    const admin = await AD.post(`/api/developer/security/scans/${freeId}/publish`, { published: true, indexable: true })
    check('workspace admin can publish and opt in to indexing', admin.status === 200 && admin.data.scan.indexable === true)
    check('indexable: no X-Robots-Tag, head tags indexable, in the sitemap', !(await pub(`/api/security/reports/${freeId}`)).headers.get('x-robots-tag') && !seo.pageMeta('gullylabs.xyz', `/security/reports/${freeId}`).noindex && seo.sitemapFor('gullylabs.xyz').includes(`/security/reports/${freeId}`))
    const un = await O.post(`/api/developer/security/scans/${freeId}/publish`, { published: false })
    check('unpublish: public 404, head tags 404, out of the index', un.status === 200 && (await pub(`/api/security/reports/${freeId}`)).status === 404 && seo.pageMeta('gullylabs.xyz', `/security/reports/${freeId}`).found === false && (await pub('/api/security/reports')).data.reports.length === 0)
    check('unknown or malformed report ids are 404', (await pub('/api/security/reports/sec_AAAAAAAAAAAAAAAA')).status === 404 && (await pub('/api/security/reports/sec_short')).status === 404)
    await O.post(`/api/developer/security/scans/${freeId}/publish`, { published: true })
    check('admin can take a report down', (await adminCall(`/api/admin/security/scans/${freeId}/unpublish`, {})).status === 200 && (await pub(`/api/security/reports/${freeId}`)).status === 404)
    check('Gully Score source: an unpublished report no longer counts', publishedReportFor(8453, stubs.ADDR_VERIFIED) === null)
  }

  /* ------------------------------------------------------------ stats --- */
  {
    const s = await pub('/api/security/stats')
    const today = s.data.days.at(-1)
    check('stats: real counts only (started, done, failed), 30 days, CORS for the docs host', s.status === 200 && s.data.days.length === 30 && s.data.totals.started >= 4 && s.data.totals.failed === 1 && today.started === s.data.totals.started && s.headers.get('access-control-allow-origin') === '*', JSON.stringify(s.data.totals))
  }

  /* --------------------------------------------------- review requests --- */
  {
    routes.resetSecurityLimitsForTest()
    const good = { tier: 'review', name: 'Ada', email: 'ada@example.com', project: 'Vaults', scope: 'Two vault contracts and a router, about 900 lines of Solidity.', repo: stubs.REPO, chain: 'base', address: stubs.ADDR_VERIFIED, timeline: 'next month' }
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
    check('admin: engine state, queue, 30 days, failures, review requests', a.status === 200 && a.data.engine.ai === true && a.data.engine.worker === false && Array.isArray(a.data.queue) && a.data.days.length === 30 && a.data.failures.some((f) => f.status === 'failed') && a.data.reviews.length >= 3, JSON.stringify(a.data?.engine))
    const id = a.data.reviews[0].id
    check('admin: a bad review status is 400', (await adminCall(`/api/admin/security/reviews/${id}`, { status: 'maybe' })).status === 400)
    const up = await adminCall(`/api/admin/security/reviews/${id}`, { status: 'quoted', note: 'Sent a quote.' })
    check('admin: review status and note saved', up.status === 200 && up.data.review.status === 'quoted' && up.data.review.note === 'Sent a quote.')
  }

  /* --------------------------------------------------------- persistence --- */
  {
    const raw = JSON.parse(fs.readFileSync(path.join(tmp, 'security.json'), 'utf8'))
    check('stored: jobs and reviews in DATA_DIR/security.json, the engine queue in DATA_DIR/security/', raw.jobs.length >= 6 && raw.reviews.length >= 3 && fs.existsSync(path.join(tmp, 'security', 'scans.json')))
    check('stored: no upload bytes in the job records', !JSON.stringify(raw.jobs).includes('"data"'))
    check('plans: GET /api/plans carries the security offer', (await pub('/api/plans')).data.security.scan.priceUsd === SECURITY.scan.priceUsd)
    check('head tags: /security and /security/reports are pages', seo.pageMeta('gullylabs.xyz', '/security').found && seo.pageMeta('gullylabs.xyz', '/security/reports').found)
  }
  /* ------------------------------------------- privacy: housekeeping --- */
  {
    // CORS: the published-report JSON is open to any origin like the other public reads; preflights answer 204.
    const list = await pub('/api/security/reports')
    const one = list.data.reports[0]?.id ?? 'sec_nonexistent00000'
    const rr = await pub(`/api/security/reports/${one}`)
    check('CORS: /api/security/reports/:id has Access-Control-Allow-Origin: *', rr.headers.get('access-control-allow-origin') === '*', `${rr.status} ${rr.headers.get('access-control-allow-origin')}`)
    const pre = await fetch(`${BASE}/api/security/reports/${one}`, { method: 'OPTIONS', headers: { origin: 'https://docs.gullylabs.xyz', 'access-control-request-method': 'GET' } })
    check('CORS: OPTIONS on a public security read is 204 with Allow and the CORS headers', pre.status === 204 && /GET/.test(pre.headers.get('allow') ?? '') && pre.headers.get('access-control-allow-origin') === '*' && /GET/.test(pre.headers.get('access-control-allow-methods') ?? ''), `${pre.status} ${pre.headers.get('allow')}`)
    const preStats = await fetch(`${BASE}/api/security/stats`, { method: 'OPTIONS' })
    check('CORS: OPTIONS /api/security/stats is 204', preStats.status === 204 && preStats.headers.get('access-control-allow-origin') === '*')
    const preReview = await fetch(`${BASE}/api/security/review-requests`, { method: 'OPTIONS', headers: { origin: 'https://evil.example' } })
    check('CORS: the review form preflight grants no origin (same-origin only)', preReview.status === 204 && !preReview.headers.get('access-control-allow-origin') && /POST/.test(preReview.headers.get('allow') ?? ''))

    // (b) An unpaid scan's uploaded code is deleted after 24 hours, the invoice cancelled, and it is in the history.
    // No free scans left for anyone, so this one waits for payment.
    const freeBefore = { ...SECURITY.scan.freePerMonth }
    for (const k of Object.keys(SECURITY.scan.freePerMonth)) SECURITY.scan.freePerMonth[k] = 0
    const up = await create(D, { kind: 'upload' }, { upload: { name: 'unpaid.zip', data: storedZip('src/Unpaid.sol', 'pragma solidity ^0.8.20; contract Unpaid { uint x; }').toString('base64') }, expect: { priceUsd: SECURITY.scan.priceUsd } })
    Object.assign(SECURITY.scan.freePerMonth, freeBefore)
    const upId = up.data?.scan?.id
    const file = path.join(tmp, 'security-uploads', `${upId}.bin`)
    check('unpaid upload: (setup) 202 awaiting payment, bytes on disk', up.status === 202 && up.data.scan.status === 'awaiting_payment' && fs.existsSync(file), `${up.status} ${JSON.stringify(up.data).slice(0, 200)}`)
    check('unpaid upload: kept before 24 h', routes.sweepUnpaidUploads({ now: Date.now() + 23 * 3_600_000 }).length === 0 && fs.existsSync(file))
    const swept = routes.sweepUnpaidUploads({ now: Date.now() + 25 * 3_600_000 })
    check('unpaid upload: deleted once unpaid for 24 h', swept.includes(upId) && !fs.existsSync(file), JSON.stringify(swept))
    const after = (await D.call(`/api/developer/security/scans/${upId}`)).data?.scan
    check('unpaid upload: the scan is cancelled and its history says the upload was deleted', after?.status === 'cancelled' && after.cancelReason === 'unpaid-24h' && after.history.some((h) => h.event === 'upload-deleted' && /unpaid for 24 hours/.test(h.text)), JSON.stringify(after ?? null).slice(0, 300))
    check('unpaid upload: its invoice is cancelled, so it cannot be paid for a scan that cannot run', (await pub(`/api/pay/${up.data?.payment?.invoiceId}`)).data?.invoice?.status === 'cancelled')
    check('unpaid upload: a second sweep changes nothing', routes.sweepUnpaidUploads({ now: Date.now() + 26 * 3_600_000 }).length === 0)

    // Admin Health: Holder Map sources from holders.mjs holdersSourceHealth(): env var names only, never values.
    const h = await adminCall('/api/admin/health')
    const hm = h.data?.holders ?? []
    check('admin health: Holder Map sources per chain (source, env name, stocks, launches)', h.status === 200 && hm.length >= 5 && hm.every((c) => typeof c.available === 'boolean' && typeof c.launches === 'boolean' && 'env' in c && 'source' in c) && hm.find((c) => c.chain === 'robinhood')?.reason === 'not configured: GULLY_RPC_4663 (archive RPC) or BLOCKSCOUT_API_KEY', JSON.stringify(hm).slice(0, 300))
    check('admin health: DeepCore launches map on Base without a key', hm.find((c) => c.chain === 'base')?.launches === true)

    // (c) The 180-day prune runs daily from the engine's start (startLoops), not only at boot.
    check('housekeeping: started with the engine, prune daily and the upload sweep hourly', JSON.stringify(engineAdapter.housekeepingForTest()) === JSON.stringify([86_400_000, 3_600_000]), JSON.stringify(engineAdapter.housekeepingForTest()))
    const scansDir = path.join(tmp, 'security', 'scans')
    const before = fs.existsSync(scansDir) ? fs.readdirSync(scansDir).length : 0
    const none = await engineAdapter.housekeepNow({ now: Date.now() + 179 * 86_400_000, sweep: false })
    check('prune: nothing younger than 180 days is removed', none.pruned.length === 0 && before > 0, `${before} ${JSON.stringify(none)}`)
    const old = await engineAdapter.housekeepNow({ now: Date.now() + 181 * 86_400_000, sweep: false })
    const left = fs.existsSync(scansDir) ? fs.readdirSync(scansDir) : []
    check('prune: finished scans older than 180 days go, with their folders (report included)', old.pruned.length > 0 && old.pruned.every((id) => !left.includes(id)), `${JSON.stringify(old.pruned)} left ${left.length}`)
  }
} catch (e) {
  check(`no exception (${String(e?.stack ?? e).split('\n').slice(0, 3).join(' | ')})`, false)
}

stubs.close()
fs.rmSync(tmp, { recursive: true, force: true })
console.log(`\n${t.passed} passed, ${t.failed} failed`)
process.exit(t.failed ? 1 : 0)
