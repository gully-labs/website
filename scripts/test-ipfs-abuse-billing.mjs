// Gully IPFS abuse reports (server/ipfs-abuse.mjs) and paid-tier plumbing (plans.mjs + ipfs-pins.mjs): reports validate,
// rate limit, queue by seriousness and a takedown goes through the existing path; paid tiers are OFF by default and with
// no price; with the flag and a priced tier, checkout opens through Gully Pay, only a verified completed session of the exact
// amount unlocks the tier, and the monthly transfer and gateway meters are enforced.
//   node --test scripts/test-ipfs-abuse-billing.mjs
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { after, before, test } from 'node:test'

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ipfs-ab-'))
process.env.DATA_DIR = DIR
process.env.IPFS_FREE_STORAGE_GB = String(8 / 1024) // 8 MB
process.env.IPFS_FREE_MAX_FILE_MB = '1'
process.env.IPFS_FREE_TRANSFER_GB = String(1 / 1024 / 2) // 0.5 MB a month
process.env.IPFS_SYNC_TOKEN = 'sync-token-sync-token-sync-token'
process.env.GULLYPAY_STORE_ID = '11111111-2222-3333-4444-555555555555'
process.env.GULLYPAY_API_KEY = 'rk_test_key_12345'
process.env.GULLYPAY_WEBHOOK_SIGNING_KEY = 'whsec_test_signing_key_12345'

const CID_BAD = 'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi'
const CID_OK = 'bafybeihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku'
const pins = new Set()
const kubo = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x')
  const arg = u.searchParams.getAll('arg')
  const cmd = u.pathname.replace('/api/v0/', '')
  const parts = []
  req.on('data', (c) => parts.push(c))
  req.on('end', () => {
    const body = Buffer.concat(parts)
    const ok = (o) => (res.writeHead(200, { 'Content-Type': 'application/json' }), res.end(typeof o === 'string' ? o : JSON.stringify(o)))
    if (u.pathname.startsWith('/ipfs/')) return res.writeHead(200, { 'Content-Type': 'text/plain' }), res.end(req.method === 'GET' ? 'x' : undefined)
    if (cmd === 'id') return ok({ ID: 'peer' })
    if (cmd === 'pin/ls') return arg.length && !pins.has(arg[0]) ? (res.writeHead(500), res.end('{"Message":"not pinned"}')) : ok({ Keys: Object.fromEntries([...pins].map((c) => [c, {}])) })
    if (cmd === 'pin/add') return pins.add(arg[0]), ok({})
    if (cmd === 'pin/rm') return pins.delete(arg[0]), ok({})
    if (cmd === 'refs' || cmd === 'block/rm') return ok('')
    if (cmd === 'block/stat') return res.writeHead(500), res.end('{"Message":"no"}')
    if (cmd === 'add') {
      const c = 'bafkrei' + crypto.createHash('sha256').update(body).digest('hex').replace(/[0-9]/g, (d) => 'qrstuvwxyz'[d]).slice(0, 52)
      return ok(JSON.stringify({ Name: 'f', Hash: c, Size: String(body.length) }) + '\n')
    }
    res.writeHead(404)
    res.end()
  })
})

let base, srv, abuse, pinsMod, plans, store
const owner = '0x3333333333333333333333333333333333333333'
before(async () => {
  await new Promise((r) => kubo.listen(0, '127.0.0.1', r))
  process.env.IPFS_API = process.env.IPFS_GATEWAY = `http://127.0.0.1:${kubo.address().port}`
  store = await import('../server/store.mjs')
  abuse = await import('../server/ipfs-abuse.mjs')
  pinsMod = await import('../server/ipfs-pins.mjs')
  plans = await import('../server/plans.mjs')
  srv = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost')
    if (await abuse.handleIpfsAbuse(req, res, url)) return
    if (url.pathname.startsWith('/api/developer/ipfs')) return pinsMod.handleIpfsAccount(req, res, url, { workspace: owner })
    if (!(await pinsMod.handleIpfsPins(req, res, url))) (res.writeHead(404), res.end())
  })
  await new Promise((r) => srv.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${srv.address().port}`
})
after(() => {
  srv.close()
  kubo.close()
  fs.rmSync(DIR, { recursive: true, force: true })
})

const report = (b, ip = '9.9.9.9', h = { 'x-requested-with': 'gully' }) => fetch(`${base}/api/ipfs/report`, { method: 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': ip, ...h }, body: JSON.stringify(b) })

test('cidOf reads a CID from a bare value, a gateway link and a path', () => {
  assert.equal(abuse.cidOf(CID_BAD), CID_BAD)
  assert.equal(abuse.cidOf(`https://ipfs.gullylabs.xyz/ipfs/${CID_BAD}/a.png`), CID_BAD)
  assert.equal(abuse.cidOf('/ipfs/not-a-cid'), null)
  assert.equal(abuse.cidOf('hello'), null)
})

test('report: needs the form header, a CID and a category; bad email refused; nothing is removed by a report', async () => {
  assert.equal((await report({ cid: CID_BAD, category: 'illegal' }, '1.1.1.1', {})).status, 403)
  assert.equal((await report({ cid: 'nope', category: 'illegal' })).status, 400)
  assert.equal((await report({ cid: CID_BAD, category: 'bogus' })).status, 400)
  assert.equal((await report({ cid: CID_BAD, category: 'illegal', email: 'x' })).status, 400)
  const ok = await report({ cid: `https://ipfs.gullylabs.xyz/ipfs/${CID_BAD}`, category: 'copyright', details: 'mine', email: 'a@b.co' })
  assert.equal(ok.status, 201)
  assert.ok((await ok.json()).id)
  assert.equal((await report({ cid: CID_BAD, category: 'copyright' })).status, 200, 'the same report from the same address the same day is a duplicate')
  assert.equal((await report({ website: 'spam', cid: CID_OK, category: 'other' }, '2.2.2.2')).status, 201, 'a filled honeypot looks filed')
  assert.equal(abuse.ipfsReports().length, 1, 'the honeypot filed nothing')
})

test('report: five an hour per address, then 429', async () => {
  let last
  for (let i = 0; i < 7; i++) last = await report({ cid: CID_OK, category: 'other', details: String(i) }, '3.3.3.3')
  assert.equal(last.status, 429)
})

test('admin queue: serious categories first; takedown goes through the existing path and closes every open report of the CID', async () => {
  await report({ cid: CID_OK, category: 'csam' }, '4.4.4.4')
  await report({ cid: CID_BAD, category: 'illegal' }, '5.5.5.5')
  const q = abuse.ipfsReports().filter((r) => r.state === 'open')
  assert.equal(q[0].category, 'csam')
  assert.equal(q[0].cid, CID_OK)
  const csam = q[0]
  const out = await abuse.decideReport(csam.id, 'takedown', 'admin')
  assert.equal(out.status, 200)
  assert.equal(abuse.ipfsReports().find((r) => r.id === csam.id).state, 'actioned')
  // the takedown denied the CID: pinning it is now refused
  const key = store.issueKey({ owner, name: 'pin', scopes: ['ipfs:pin'] }).secret
  const pin = await fetch(`${base}/api/ipfs/psa/pins`, { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'content-type': 'application/json' }, body: JSON.stringify({ cid: CID_OK }) })
  assert.equal(pin.status, 451)
  const dis = abuse.ipfsReports().find((r) => r.state === 'open' && r.cid === CID_BAD)
  assert.equal((await abuse.decideReport(dis.id, 'dismiss', 'admin')).status, 200)
  assert.equal((await abuse.decideReport(dis.id, 'dismiss', 'admin')).status, 409)
  assert.equal((await abuse.decideReport('nope', 'dismiss', 'admin')).status, 404)
})

test('paid tiers are OFF by default: no plan, no price, subscribe is 402', async () => {
  assert.equal(plans.ipfsPaidEnabled(), false)
  assert.deepEqual(plans.ipfsPaidPlans(), [])
  assert.equal(plans.publicPlans().ipfs.paid.enabled, false)
  const r = await fetch(`${base}/api/developer/ipfs/subscribe`, { method: 'POST', body: '{"plan":"pro"}' })
  assert.equal(r.status, 402)
  assert.equal(plans.ipfsPlanOf(owner).id, 'free')
  // a flag with no priced tier, or a priced tier with no flag, is still off
  process.env.IPFS_PAID_ENABLED = '1'
  assert.equal(plans.ipfsPaidEnabled(), false)
  process.env.IPFS_PAID_PLANS_JSON = JSON.stringify([{ id: 'pro', name: 'Pro', storageGb: 100 }])
  assert.deepEqual(plans.ipfsPaidPlans(), [], 'a tier with no price is dropped, never defaulted')
  delete process.env.IPFS_PAID_ENABLED
  delete process.env.IPFS_PAID_PLANS_JSON
})

test('free transfer meter: uploads past the monthly cap are refused with nothing deleted', async () => {
  const up = (n, tag) => fetch(`${base}/api/developer/ipfs/upload?name=${tag}`, { method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: Buffer.alloc(n, tag.charCodeAt(0)) })
  assert.equal((await up(300_000, 'a')).status, 200)
  const r = await up(300_000, 'b')
  assert.equal(r.status, 403)
  assert.match((await r.json()).error.details, /Monthly upload and pin transfer used up/)
  const acct = await (await fetch(`${base}/api/developer/ipfs`)).json()
  assert.equal(acct.usage.transferBytes, 300_000)
  assert.equal(acct.usage.pins, 1)
})

test('paid tier: checkout through Gully Pay, unlocked only by a completed session of the exact amount; limits then follow the tier', async () => {
  process.env.IPFS_PAID_ENABLED = '1'
  process.env.IPFS_PAID_PLANS_JSON = JSON.stringify([{ id: 'pro', name: 'Pro', priceUsdPerGbMonth: 0.05, storageGb: 100, maxFileMb: 50, maxPins: 99, transferGb: 10, egressGb: 1 / 1024 }])
  assert.equal(plans.ipfsPaidEnabled(), true)
  const pro = plans.ipfsPaidPlans()[0]
  assert.equal(pro.monthlyCents, 500)
  const gp = await import('../server/gullypay.mjs')
  const seen = []
  gp.setGullyPayFetchForTest(async (u, init) => (seen.push({ u: String(u), body: JSON.parse(init.body) }), new Response(JSON.stringify({ sessionId: 'sess_ipfs_1', checkoutUrl: 'https://checkout.gullypay.xyz/sess_ipfs_1' }), { status: 200 })))
  const sub = (plan) => fetch(`${base}/api/developer/ipfs/subscribe`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ plan }) })
  assert.equal((await sub('nope')).status, 400)
  const r = await sub('pro')
  assert.equal(r.status, 202)
  assert.equal((await r.json()).checkoutUrl, 'https://checkout.gullypay.xyz/sess_ipfs_1')
  assert.equal(seen[0].body.amount, 500)
  assert.match(seen[0].body.clientReferenceId, /^ipfs:[0-9a-f]{16}:pro$/)
  assert.equal(plans.ipfsPlanOf(owner).id, 'free', 'opening a checkout unlocks nothing')
  const ev = (o) => ({ type: 'checkout.session.completed', eventId: 'e1', object: { id: 'sess_ipfs_1', clientReferenceId: seen[0].body.clientReferenceId, status: 'completed', currency: 'USD', crypto: { chain: 'base' }, ...o } })
  assert.equal(pinsMod.onGullyPayIpfsEvent(ev({ amount: 499 })), 'ignored')
  assert.equal(pinsMod.onGullyPayIpfsEvent(ev({ amount: 500, crypto: { chain: 'base-sepolia' } })), 'ignored', 'no testnet coins')
  assert.equal(pinsMod.onGullyPayIpfsEvent({ ...ev({ amount: 500 }), object: { ...ev({ amount: 500 }).object, id: 'sess_other' } }), 'ignored')
  assert.equal(plans.ipfsPlanOf(owner).id, 'free')
  assert.equal(pinsMod.onGullyPayIpfsEvent(ev({ amount: 500 })), 'handled')
  assert.equal(plans.ipfsPlanOf(owner).id, 'pro')
  assert.equal(pinsMod.onGullyPayIpfsEvent(ev({ amount: 500 })), 'handled', 'the same session twice buys one month')
  const acct = await (await fetch(`${base}/api/developer/ipfs`)).json()
  assert.equal(acct.plan.id, 'pro')
  assert.ok(acct.billing.paidUntil)
  // the pro tier's transfer cap is large: the upload the free meter refused now works
  const up = await fetch(`${base}/api/developer/ipfs/upload?name=c`, { method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: Buffer.alloc(300_000, 99) })
  assert.equal(up.status, 200)
})

test('gateway meter: the edge reports bytes per CID, attributed to the holders; over the plan, new uploads are refused', async () => {
  const acct = await (await fetch(`${base}/api/developer/ipfs`)).json()
  const cid = acct.pins[0].cid
  const rep = (b, token = 'sync-token-sync-token-sync-token') => fetch(`${base}/api/ipfs/internal/egress`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(b) })
  assert.equal((await rep({ bytesByCid: { [cid]: 10 } }, 'wrong')).status, 401)
  assert.equal((await (await rep({ bytesByCid: { [cid]: 2_000_000, [CID_BAD]: 5, nope: 7 } })).json()).attributed, 2_000_000)
  const after = await (await fetch(`${base}/api/developer/ipfs`)).json()
  assert.equal(after.usage.egressBytes, 2_000_000)
  const up = await fetch(`${base}/api/developer/ipfs/upload?name=d`, { method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: Buffer.alloc(1000, 100) })
  assert.equal(up.status, 403)
  assert.match((await up.json()).error.details, /gateway traffic used up/)
})

test('server.mjs routes /api/ipfs/report to the abuse handler, before the pinning routes', () => {
  const src = fs.readFileSync(new URL('../server/server.mjs', import.meta.url), 'utf8')
  const a = src.indexOf('await handleIpfsAbuse(req, res, url)')
  assert.ok(a > 0, 'the abuse handler is called')
  assert.ok(a < src.indexOf('await handleIpfsPins(req, res, url)'))
})
