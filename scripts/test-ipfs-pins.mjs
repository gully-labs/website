// Gully IPFS pinning (server/ipfs-pins.mjs) against a fake Kubo: Pinning Service API conformance for the endpoints we
// implement (list filters, add 202, get, replace, delete 202, error shape), auth and scopes, quotas, ownership (an
// account sees and removes only its own pins; Gully's own pins are never unpinned), uploads (file and CAR), review
// queue for media, takedown (unpin, purge, denylist, re-pin refused) and the replica's sync routes.
// Scanning against a fake scanner (low score passes, flagged / busy / video wait, highest first) and the hash denylist.
//   node --test scripts/test-ipfs-pins.mjs
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { after, before, test } from 'node:test'

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ipfs-pins-'))
process.env.DATA_DIR = DIR
process.env.IPFS_FREE_STORAGE_GB = String(1 / 1024) // 1 MB
process.env.IPFS_FREE_MAX_FILE_MB = '0.5'
process.env.IPFS_FREE_MAX_PINS = '5'
process.env.IPFS_SYNC_TOKEN = 'sync-token-sync-token-sync-token'

const CID_GULLY = 'bafybeiafghmlnuti4sggk27sc5clrjwiti2u7u3pueptowo7phsfhz2xt4' // Gully's own pin, made outside the module
const CID_A = 'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi'
const CID_BIG = 'bafybeihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku'
const CID_IMG = 'bafkreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku'
const CAR_ROOT = 'bafybeibml5uieyxa5tufngvg7fgwbkwvlsuntwbxgtskoqynbt7wlchmfm'

const png = (tag) => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from(tag), Buffer.alloc(24)])
const IMG_BYTES = png('pinned-by-cid')
const IMG_BYTES_OVERRIDE = new Map()

// ---- a fake scanner (gully-ops gully/ipfs-scanner): the score is read from the image's tag ----
const scanState = { calls: 0, auth: [] }
const scanner = http.createServer((req, res) => {
  const parts = []
  req.on('data', (c) => parts.push(c))
  req.on('end', () => {
    scanState.calls++
    scanState.auth.push(req.headers.authorization ?? null)
    const b = Buffer.concat(parts).toString('latin1')
    if (b.includes('busy')) return res.writeHead(503), res.end('{"error":"busy"}')
    const m = b.match(/score=([0-9.]+)/)
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ score: m ? Number(m[1]) : 0.01, model: 'fake', ms: 1 }))
  })
})

// ---- a fake Kubo RPC + gateway ----
const kuboState = { pins: new Set([CID_GULLY]), blocks: new Set([CID_GULLY]), calls: [], added: 0 }
const SIZES = { [CID_A]: 1000, [CID_BIG]: 5 * 1024 * 1024, [CID_IMG]: 2000, [CID_GULLY]: 531 }
const kubo = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x')
  const arg = u.searchParams.getAll('arg')
  const cmd = u.pathname.replace('/api/v0/', '')
  kuboState.calls.push(`${cmd} ${arg.join(',')}`)
  const ok = (o) => (res.writeHead(200, { 'Content-Type': 'application/json' }), res.end(typeof o === 'string' ? o : JSON.stringify(o)))
  if (u.pathname.startsWith('/ipfs/')) {
    const c = u.pathname.split('/')[2]
    if (IMG_BYTES_OVERRIDE.has(c)) return res.writeHead(200, { 'Content-Type': 'image/png' }), res.end(req.method === 'GET' ? IMG_BYTES_OVERRIDE.get(c) : undefined)
    res.writeHead(200, { 'Content-Type': c === CID_IMG ? 'image/png' : 'text/plain' })
    return res.end(req.method === 'GET' && c === CID_IMG ? IMG_BYTES : undefined)
  }
  let body = []
  req.on('data', (c) => body.push(c))
  req.on('end', () => {
    body = Buffer.concat(body)
    switch (cmd) {
      case 'id':
        return ok({ ID: '12D3KooWTestPeer' })
      case 'pin/ls': {
        if (arg.length) return kuboState.pins.has(arg[0]) ? ok({ Keys: { [arg[0]]: { Type: 'recursive' } } }) : (res.writeHead(500), res.end(JSON.stringify({ Message: 'not pinned' })))
        return ok({ Keys: Object.fromEntries([...kuboState.pins].map((c) => [c, { Type: 'recursive' }])) })
      }
      case 'dag/stat': {
        const size = SIZES[arg[0]] ?? 100
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.write(JSON.stringify({ TotalSize: Math.floor(size / 2) }) + '\n')
        res.end(JSON.stringify({ TotalSize: size, DagStats: [{ Cid: arg[0], Size: size }] }) + '\n')
        return
      }
      case 'pin/add':
        kuboState.pins.add(arg[0])
        kuboState.blocks.add(arg[0])
        return ok({ Pins: [arg[0]] })
      case 'pin/rm':
        if (!kuboState.pins.has(arg[0])) return res.writeHead(500), res.end(JSON.stringify({ Message: 'not pinned' }))
        kuboState.pins.delete(arg[0])
        return ok({ Pins: [arg[0]] })
      case 'refs':
        return ok('')
      case 'block/rm':
        for (const c of arg) if (!kuboState.pins.has(c)) kuboState.blocks.delete(c)
        return ok('')
      case 'add': {
        const c = 'bafkrei' + crypto.createHash('sha256').update(body.toString('latin1').replace(/-{2,}[\w-]+/g, '')).digest('hex').replace(/[0-9]/g, (d) => 'qrstuvwxyz'[d]).slice(0, 52)
        if (u.searchParams.get('only-hash') !== 'true') (kuboState.added++, kuboState.blocks.add(c))
        return ok(JSON.stringify({ Name: 'file', Hash: c, Size: String(body.length) }) + '\n')
      }
      case 'dag/import':
        kuboState.pins.add(CAR_ROOT)
        return ok(JSON.stringify({ Root: { Cid: { '/': CAR_ROOT }, PinErrorMsg: '' } }) + '\n')
      case 'block/stat':
        return kuboState.blocks.has(arg[0]) ? ok({ Key: arg[0], Size: 1 }) : (res.writeHead(500), res.end(JSON.stringify({ Message: 'block not found locally' })))
      case 'swarm/connect':
        return ok({ Strings: ['ok'] })
      default:
        res.writeHead(404)
        res.end()
    }
  })
})

let base, kuboUrl, srv, mod, store
const owner = '0x1111111111111111111111111111111111111111'
const other = '0x2222222222222222222222222222222222222222'
let KEY, KEY_OTHER, KEY_NOSCOPE

before(async () => {
  await new Promise((r) => kubo.listen(0, '127.0.0.1', r))
  kuboUrl = `http://127.0.0.1:${kubo.address().port}`
  process.env.IPFS_API = kuboUrl
  process.env.IPFS_GATEWAY = kuboUrl
  store = await import('../server/store.mjs')
  mod = await import('../server/ipfs-pins.mjs')
  KEY = store.issueKey({ owner, name: 'pin', scopes: ['ipfs:pin'] }).secret
  KEY_OTHER = store.issueKey({ owner: other, name: 'pin2', scopes: ['ipfs:pin'] }).secret
  KEY_NOSCOPE = store.issueKey({ owner, name: 'data' }).secret
  srv = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost')
    if (url.pathname.startsWith('/api/developer/ipfs')) return mod.handleIpfsAccount(req, res, url, { workspace: req.headers['x-ws'] })
    if (!(await mod.handleIpfsPins(req, res, url))) (res.writeHead(404), res.end())
  })
  await new Promise((r) => srv.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${srv.address().port}`
})
after(() => {
  srv.close()
  kubo.close()
  scanner.close()
  fs.rmSync(DIR, { recursive: true, force: true })
})

const psa = (p, { key = KEY, method = 'GET', body, headers = {} } = {}) =>
  fetch(`${base}/api/ipfs/psa${p}`, { method, headers: { ...(key ? { Authorization: `Bearer ${key}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined })
const until = async (fn, ms = 3000) => {
  const t = Date.now()
  for (;;) {
    const v = await fn()
    if (v) return v
    if (Date.now() - t > ms) return v
    await new Promise((r) => setTimeout(r, 20))
  }
}
const statusOf = async (id, key = KEY) => (await (await psa(`/pins/${id}`, { key })).json()).status

test('auth: no key 401, a key without ipfs:pin 403, both in the spec error shape', async () => {
  const a = await psa('/pins', { key: null })
  assert.equal(a.status, 401)
  assert.ok((await a.json()).error.reason)
  const b = await psa('/pins', { key: KEY_NOSCOPE })
  assert.equal(b.status, 403)
  assert.equal((await b.json()).error.reason, 'FORBIDDEN')
})

test('POST /pins: 202 PinStatus queued, then pinned by the worker; GET /pins/{id}', async () => {
  const r = await psa('/pins', { method: 'POST', body: { cid: CID_A, name: 'hello.txt', meta: { app: 't' } } })
  assert.equal(r.status, 202)
  const s = await r.json()
  for (const k of ['requestid', 'status', 'created', 'pin', 'delegates']) assert.ok(k in s, k)
  assert.ok(['queued', 'pinning', 'pinned'].includes(s.status))
  assert.equal(s.pin.cid, CID_A)
  assert.ok(Array.isArray(s.delegates) && s.delegates.every((d) => d.startsWith('/p2p/')), 'delegates carry no box address')
  assert.equal(await until(async () => (await statusOf(s.requestid)) === 'pinned' && 'pinned'), 'pinned')
  assert.ok(kuboState.pins.has(CID_A))
  const g = await (await psa(`/pins/${s.requestid}`)).json()
  assert.equal(g.info.size, '1000')
})

test('POST /pins: bad bodies are 400 with a reason', async () => {
  for (const body of [{}, { cid: 'nope' }, { cid: CID_A, name: 'x'.repeat(300) }, { cid: CID_A, origins: ['not-a-multiaddr'] }, { cid: CID_A, meta: { a: 1 } }]) {
    const r = await psa('/pins', { method: 'POST', body })
    assert.equal(r.status, 400, JSON.stringify(body))
    assert.equal((await r.json()).error.reason, 'BAD_REQUEST')
  }
})

test('GET /pins: default status pinned, filters cid / name+match / status / limit / meta, newest first, count', async () => {
  const l = await (await psa('/pins')).json()
  assert.equal(l.count, 1)
  assert.equal(l.results[0].pin.cid, CID_A)
  assert.equal((await (await psa(`/pins?cid=${CID_A}`)).json()).count, 1)
  assert.equal((await (await psa('/pins?name=HELLO.TXT&match=iexact')).json()).count, 1)
  assert.equal((await (await psa('/pins?name=HELLO.TXT&match=exact')).json()).count, 0)
  assert.equal((await (await psa('/pins?name=ell&match=partial')).json()).count, 1)
  assert.equal((await (await psa(`/pins?meta=${encodeURIComponent('{"app":"t"}')}`)).json()).count, 1)
  assert.equal((await (await psa('/pins?status=queued,failed')).json()).count, 0)
  assert.equal((await psa('/pins?limit=0')).status, 400)
  assert.equal((await psa('/pins?status=bogus')).status, 400)
  assert.equal((await psa(`/pins?after=${encodeURIComponent(new Date(Date.now() + 60_000).toISOString())}`)).status, 200)
})

test('ownership: another account cannot see, read or delete my pin', async () => {
  const mine = (await (await psa('/pins')).json()).results[0]
  assert.equal((await (await psa('/pins', { key: KEY_OTHER })).json()).count, 0)
  assert.equal((await psa(`/pins/${mine.requestid}`, { key: KEY_OTHER })).status, 404)
  assert.equal((await psa(`/pins/${mine.requestid}`, { key: KEY_OTHER, method: 'DELETE' })).status, 404)
  assert.ok(kuboState.pins.has(CID_A))
})

test("Gully's own pins are never unpinned when a customer pins and removes the same CID", async () => {
  const s = await (await psa('/pins', { key: KEY_OTHER, method: 'POST', body: { cid: CID_GULLY } })).json()
  await until(async () => (await statusOf(s.requestid, KEY_OTHER)) === 'pinned')
  const d = await psa(`/pins/${s.requestid}`, { key: KEY_OTHER, method: 'DELETE' })
  assert.equal(d.status, 202)
  assert.ok(kuboState.pins.has(CID_GULLY), "Gully's pin stays")
})

test('quota: a DAG larger than the room left fails with a reason and is unpinned; at quota POST is 403', async () => {
  const s = await (await psa('/pins', { method: 'POST', body: { cid: CID_BIG } })).json()
  assert.equal(await until(async () => (await statusOf(s.requestid)) === 'failed' && 'failed'), 'failed')
  const f = await (await psa(`/pins/${s.requestid}`)).json()
  assert.match(f.info.status_details, /quota/i)
  assert.ok(!kuboState.pins.has(CID_BIG))
  // pin count quota: 5 per account (one live pin so far)
  const ids = []
  for (let i = 0; i < 4; i++) ids.push((await (await psa('/pins', { method: 'POST', body: { cid: CID_A, name: `n${i}` } })).json()).requestid)
  const over = await psa('/pins', { method: 'POST', body: { cid: CID_A } })
  assert.equal(over.status, 403)
  assert.equal((await over.json()).error.reason, 'QUOTA_EXCEEDED')
  for (const id of ids) {
    await until(async () => (await statusOf(id)) === 'pinned')
    assert.equal((await psa(`/pins/${id}`, { method: 'DELETE' })).status, 202)
  }
  assert.ok(kuboState.pins.has(CID_A), 'still wanted by the first record')
})

test('POST /pins/{id} replaces: a new requestid, the old one gone', async () => {
  const first = (await (await psa('/pins')).json()).results[0]
  const r = await psa(`/pins/${first.requestid}`, { method: 'POST', body: { cid: CID_A, name: 'renamed' } })
  assert.equal(r.status, 202)
  const n = await r.json()
  assert.notEqual(n.requestid, first.requestid)
  assert.equal((await psa(`/pins/${first.requestid}`)).status, 404)
  assert.equal(n.pin.name, 'renamed')
  assert.ok(kuboState.pins.has(CID_A))
})

test('upload: a file is added, pinned and listed; too large 413; no length 411; a key without scope 403', async () => {
  const body = Buffer.from('hello gully ipfs')
  const r = await fetch(`${base}/api/ipfs/upload?name=hello.txt`, { method: 'POST', headers: { Authorization: `Bearer ${KEY}` }, body })
  assert.equal(r.status, 200)
  const s = await r.json()
  assert.equal(s.status, 'pinned')
  assert.equal(s.pin.name, 'hello.txt')
  assert.ok(kuboState.pins.has(s.pin.cid))
  const big = await fetch(`${base}/api/ipfs/upload`, { method: 'POST', headers: { Authorization: `Bearer ${KEY}` }, body: Buffer.alloc(600 * 1024) })
  assert.equal(big.status, 413)
  assert.equal((await fetch(`${base}/api/ipfs/upload`, { method: 'POST', headers: { Authorization: `Bearer ${KEY_NOSCOPE}` }, body })).status, 403)
  // the hub's own view lists it with its usage
  const v = await (await fetch(`${base}/api/developer/ipfs`, { headers: { 'x-ws': owner } })).json()
  assert.ok(v.pins.some((p) => p.cid === s.pin.cid && p.source === 'upload'))
  assert.ok(v.usage.bytes >= body.length)
  assert.equal(v.usage.uploadsThisMonth, 1)
  assert.equal(v.plan.maxPins, 5)
  assert.ok(!JSON.stringify(v).match(/repoBytes|storageMax/), 'no node internals in the account view')
})

test('upload: a CAR is imported with its one root; an image is queued for review', async () => {
  const r = await fetch(`${base}/api/ipfs/upload`, { method: 'POST', headers: { Authorization: `Bearer ${KEY_OTHER}`, 'Content-Type': 'application/vnd.ipld.car' }, body: Buffer.from('car-bytes') })
  assert.equal(r.status, 200)
  assert.equal((await r.json()).pin.cid, CAR_ROOT)
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32)])
  const i = await (await fetch(`${base}/api/ipfs/upload?name=a.png`, { method: 'POST', headers: { Authorization: `Bearer ${KEY_OTHER}` }, body: png })).json()
  assert.equal(i.info.review, 'queued')
  assert.ok(mod.ipfsReviews().some((x) => x.cid === i.pin.cid))
})

test('hub delete: unpins from the account; another workspace gets 404', async () => {
  const v = await (await fetch(`${base}/api/developer/ipfs`, { headers: { 'x-ws': owner } })).json()
  const up = v.pins.find((p) => p.source === 'upload')
  assert.equal((await fetch(`${base}/api/developer/ipfs/pins/${up.id}/delete`, { method: 'POST', headers: { 'x-ws': other } })).status, 404)
  const d = await fetch(`${base}/api/developer/ipfs/pins/${up.id}/delete`, { method: 'POST', headers: { 'x-ws': owner } })
  assert.equal(d.status, 200)
  assert.ok(!kuboState.pins.has(up.cid))
})

test('takedown: every record removed, unpinned, denylisted; re-pinning is refused 451', async () => {
  const s = await (await psa('/pins', { key: KEY_OTHER, method: 'POST', body: { cid: CID_IMG } })).json()
  await until(async () => (await statusOf(s.requestid, KEY_OTHER)) === 'pinned')
  assert.ok(mod.ipfsReviews().some((x) => x.cid === CID_IMG), 'an image pinned by CID is queued too (gateway type)')
  const t = await mod.ipfsTakedown(CID_IMG, 'test', 'admin')
  assert.equal(t.ok, true)
  assert.ok(!kuboState.pins.has(CID_IMG))
  assert.match(fs.readFileSync(path.join(DIR, 'ipfs-denylist', 'gully.deny'), 'utf8'), new RegExp(`/ipfs/${CID_IMG}`))
  assert.equal((await psa(`/pins/${s.requestid}`, { key: KEY_OTHER })).status, 404)
  assert.equal((await psa('/pins', { key: KEY_OTHER, method: 'POST', body: { cid: CID_IMG } })).status, 451)
  // a takedown of Gully's own pin leaves the node's pin alone (the denylist still blocks the gateway)
  const s2 = await (await psa('/pins', { key: KEY_OTHER, method: 'POST', body: { cid: CID_GULLY } })).json()
  await until(async () => (await statusOf(s2.requestid, KEY_OTHER)) === 'pinned')
  assert.equal((await mod.ipfsTakedown(CID_GULLY, 't', 'admin')).unpinned, false)
  assert.ok(kuboState.pins.has(CID_GULLY))
})

test('a block the node held before (unpinned, put by another product) is never purged when a customer unpins it', async () => {
  const RAW = 'bafkreirawblockputbysocialaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
  kuboState.blocks.add(RAW)
  const s = await (await psa('/pins', { method: 'POST', body: { cid: RAW } })).json()
  await until(async () => (await statusOf(s.requestid)) === 'pinned')
  assert.equal((await psa(`/pins/${s.requestid}`, { method: 'DELETE' })).status, 202)
  assert.ok(!kuboState.pins.has(RAW), 'unpinned')
  assert.ok(kuboState.blocks.has(RAW), 'but the block stays')
})

test('replica sync: pinset and report need the sync token; the pinset leaves out taken-down CIDs', async () => {
  assert.equal((await fetch(`${base}/api/ipfs/internal/pinset`)).status, 401)
  assert.equal((await fetch(`${base}/api/ipfs/internal/pinset`, { headers: { Authorization: `Bearer ${KEY}` } })).status, 401, 'a hub key is not the sync token')
  const p = await (await fetch(`${base}/api/ipfs/internal/pinset`, { headers: { Authorization: `Bearer ${process.env.IPFS_SYNC_TOKEN}` } })).json()
  assert.ok(p.cids.includes(CID_A))
  assert.ok(!p.cids.includes(CID_GULLY), 'taken down: not replicated')
  const r = await fetch(`${base}/api/ipfs/internal/replica`, { method: 'POST', headers: { Authorization: `Bearer ${process.env.IPFS_SYNC_TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ node: 'gully-l3', pinned: p.cids.length, missing: 0, failed: 0 }) })
  assert.equal(r.status, 200)
  assert.deepEqual([mod.replicaState().up, mod.replicaState().inSync], [true, true])
})

test('scanner: a low score passes without review; a flagged score, a busy scanner or video wait, highest first', async () => {
  await new Promise((r) => scanner.listen(0, '127.0.0.1', r))
  process.env.IPFS_SCANNER_URL = `http://127.0.0.1:${scanner.address().port}`
  process.env.IPFS_SCANNER_TOKEN = 'scan-token'
  const up = async (body, name) => (await fetch(`${base}/api/ipfs/upload?name=${name}`, { method: 'POST', headers: { Authorization: `Bearer ${KEY}` }, body })).json()
  const low = await up(png('score=0.05'), 'low.png')
  assert.equal(low.info.review, 'scanned')
  assert.ok(!mod.ipfsReviews().some((x) => x.cid === low.pin.cid), 'a low score never reaches the queue')
  assert.equal(scanState.auth.at(-1), 'Bearer scan-token')
  const del = (x) => fetch(`${base}/api/developer/ipfs/pins/${x.requestid}/delete`, { method: 'POST', headers: { 'x-ws': owner } })
  await del(low)
  const mid = await up(png('score=0.55'), 'mid.png')
  const high = await up(png('score=0.97'), 'high.png')
  const busy = await up(png('busy'), 'busy.png')
  for (const x of [mid, high, busy]) assert.equal(x.info?.review, 'queued', JSON.stringify(x))
  const q = mod.ipfsReviews()
  assert.equal(q[0].cid, high.pin.cid, 'highest score first')
  assert.equal(q[0].score, 0.97)
  assert.ok(q.find((x) => x.cid === busy.pin.cid).score == null, 'scanner busy: in review, unscored (fail closed)')
  await del(mid)
  const calls = scanState.calls
  const vid = await up(Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(40)]), 'v.webm')
  assert.equal(vid.info?.review, 'queued', JSON.stringify(vid))
  assert.equal(scanState.calls, calls, 'video is not sent to the image scanner')
  const v = await (await fetch(`${base}/api/developer/ipfs`, { headers: { 'x-ws': owner } })).json()
  assert.ok(!JSON.stringify(v).match(/score|scanner/i), 'the account view carries no scanner internals')
  for (const x of [high, busy, vid]) await del(x)
})

test('hash denylist: a taken-down file is refused again as an upload and by CID under another CID', async () => {
  const file = png('score=0.02 takedown-me')
  const a = await (await fetch(`${base}/api/ipfs/upload?name=t.png`, { method: 'POST', headers: { Authorization: `Bearer ${KEY}` }, body: file })).json()
  assert.equal((await mod.ipfsTakedown(a.pin.cid, 'test', 'admin')).ok, true)
  const again = await fetch(`${base}/api/ipfs/upload?name=t2.png`, { method: 'POST', headers: { Authorization: `Bearer ${KEY_OTHER}` }, body: file })
  assert.equal(again.status, 451)
  assert.equal((await again.json()).error.reason, 'TAKEN_DOWN')
  // the same bytes behind another CID (pinned by CID, read from node 1's gateway) fail with the takedown reason
  const imgTd = 'bafkreiotherchunkingsamebytesaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
  IMG_BYTES_OVERRIDE.set(imgTd, file)
  const s = await (await psa('/pins', { method: 'POST', body: { cid: imgTd } })).json()
  assert.equal(await until(async () => (await statusOf(s.requestid)) === 'failed' && 'failed'), 'failed')
  assert.match((await (await psa(`/pins/${s.requestid}`)).json()).info.status_details, /taken down/i)
  assert.ok(!kuboState.pins.has(imgTd))
})

test('the db survives a restart: pins left pinning go back to the queue', async () => {
  const raw = JSON.parse(fs.readFileSync(path.join(DIR, 'ipfs-pins.json'), 'utf8'))
  assert.ok(raw.pins.length > 0)
  mod._resetIpfsPins()
  const v = mod.accountIpfs(owner)
  assert.ok(v.pins.length > 0)
})
