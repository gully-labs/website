// DeepCore is RETIRED (owner, 2026-11-08). This test proves the retirement end to end in the real server (in this
// process, fresh DATA_DIR): no poller, no store, no network; the two public endpoints and the Telegram Mini App feed
// answer 410 with a pointer to Gully Core; the "DeepCore new launch" alert kind is neither offered nor creatable; the
// status page has no DeepCore rows; Gully AI has no DeepCore tools; the admin health has no poller. Nothing upstream is
// read: DEEPCORE_API points at a port that must never be called, and the module has no reader to call it with.
//
//   npm run test:deepcore-retired        (no build needed; TEST_PORT overrides the port, default 8796)

import crypto from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { makeChecker, makeClient, guardTestRun } from './test-helpers.mjs'

const PORT = Number(process.env.TEST_PORT) || 8796
await guardTestRun(PORT)
const BASE = `http://localhost:${PORT}`
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gully-dc-'))
const t = makeChecker()
const { check } = t
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/* A stand-in for api.deepcore.fun that records every call: the retired server must make none. */
const dcCalls = []
const stub = http.createServer((req, res) => {
  dcCalls.push(req.url)
  res.writeHead(200, { 'content-type': 'application/json' })
  res.end('{}')
})
await new Promise((r) => stub.listen(0, '127.0.0.1', r))

Object.assign(process.env, {
  PORT: String(PORT),
  DATA_DIR: tmp,
  TRACKER_DATA: path.join(tmp, 'tracker-history.json'),
  DIST_DIR: path.join(tmp, 'no-dist'),
  ADMIN_TOKEN: crypto.randomBytes(24).toString('hex'),
  TRACKER_LOOP: 'off',
  TRACKER_SKIP_APIS: '1',
  GULLY_RPC_1: 'http://127.0.0.1:9',
  GULLY_RPC_56: 'http://127.0.0.1:9',
  GULLY_RPC_8453: 'http://127.0.0.1:9',
  GULLY_RPC_42161: 'http://127.0.0.1:9',
  GULLY_RPC_10: 'http://127.0.0.1:9',
  GULLY_RPC_137: 'http://127.0.0.1:9',
  GULLY_RPC_43114: 'http://127.0.0.1:9',
  GULLY_ALLOW_LOOPBACK_WEBHOOKS: '1',
  DEEPCORE_API: `http://127.0.0.1:${stub.address().port}`,
  DEEPCORE_LOOP: 'on', // even when asked for, the retired module polls nothing
  ASK_REMOTE: 'off',
})
delete process.env.TELEGRAM_BOT_TOKEN
delete process.env.GULLY_TREASURY_ADDRESS
await import('../server/server.mjs')
const dc = await import('../server/deepcore.mjs')
await sleep(300)

const wallet = privateKeyToAccount(generatePrivateKey())
const dev = makeClient(BASE)
const get = async (p) => {
  const r = await fetch(BASE + p)
  const text = await r.text()
  let j = null
  try {
    j = JSON.parse(text)
  } catch {
    j = null
  }
  return { status: r.status, j, h: r.headers }
}

try {
  /* ------------------------------------------------------------- the module --- */
  check('the module exports only the two 410 handlers and the retired note (no reader, no poller, no chains)', Object.keys(dc).sort().join() === 'RETIRED,handleDeepcoreLaunches,handleDeepcoreQuote' && /retired on 2026-11-08/.test(dc.RETIRED), Object.keys(dc).join())
  check('nothing was written to DATA_DIR/deepcore.json', !fs.existsSync(path.join(tmp, 'deepcore.json')))

  /* ----------------------------------------------------------- the endpoints --- */
  const l = await get('/api/deepcore/launches')
  check('GET /api/deepcore/launches answers 410 gone with code RETIRED and the Gully Core link', l.status === 410 && l.j?.code === 'RETIRED' && l.j?.gullyCore === 'https://gullycore.xyz', `${l.status} ${JSON.stringify(l.j)}`)
  check('the 410 is cacheable (no client hammers a retired route)', /max-age=3600/.test(l.h.get('cache-control') ?? ''))
  const q = await get('/api/deepcore/quote?chain=robinhood&token=0x0000000000000000000000000000000000000001&amount=1')
  check('GET /api/deepcore/quote answers 410 too', q.status === 410 && q.j?.code === 'RETIRED')
  const lim = await get('/api/deepcore/launches?chain=8453&limit=5')
  check('any query shape gets the same 410 (no validation errors on a retired route)', lim.status === 410)

  /* ----------------------------------------------------------- the alert kind --- */
  await dev.signIn(wallet)
  const view = (await dev.call('/api/developer/alerts')).data
  check('the alerts view no longer offers the "DeepCore new launch" kind', Array.isArray(view.kinds) && !view.kinds.some((k) => k.id === 'deepcore-launch') && view.kinds.some((k) => k.id === 'gap'))
  const created = await dev.post('/api/developer/alerts', { name: 'New launches', condition: { type: 'deepcore-launch', chainId: null }, webhookUrl: 'http://127.0.0.1:9/hook' })
  check('creating a launch alert answers 410 with the reason', created.status === 410 && created.data?.code === 'RETIRED' && /retired on 2026-11-08/.test(created.data?.error ?? ''), `${created.status} ${JSON.stringify(created.data)}`)
  const stillNone = (await dev.call('/api/developer/alerts')).data.alerts.length
  check('and leaves no alert behind', stillNone === 0)
  const gap = await dev.post('/api/developer/alerts', { condition: { type: 'gap', pct: 2 }, webhookUrl: 'http://127.0.0.1:9/hook' })
  check('gap alerts still work as before (the plan’s one alert)', gap.status === 201, `${gap.status} ${gap.data?.error ?? ''}`)

  /* ---------------------------------------------------------- status and AI --- */
  const st = await get('/api/status')
  const rows = st.j?.components ?? st.j?.results ?? st.j?.rows ?? []
  const names = JSON.stringify(st.j ?? {})
  check('the status page has no DeepCore poller row and no DeepCore Holder Map row', st.status === 200 && !/DeepCore launch poller|Holder Map: DeepCore/.test(names), `${st.status} ${rows.length} rows`)
  const ids = (st.j?.components ?? []).map((c) => c.id)
  check('the status page has no deepcore component or group', !ids.some((id) => /deepcore/.test(id)) && !(st.j?.components ?? []).some((c) => c.group === 'deepcore'), ids.join())
  const ask = await get('/api/ask/status')
  check('GET /api/ask/status lists no deepcore_* tool', ask.status === 200 && !/deepcore/.test(JSON.stringify(ask.j)), `${ask.status}`)
  const logo = await get('/api/logo/base/0x1111111111111111111111111111111111111111.png?s=64')
  check('the logo service answers without the partner list (any status, no call to it)', logo.status > 0)
  const tg = await get('/api/tg/launches')
  check('the Telegram Mini App launch feed answers 410 (or is gated before it, never 200 with launches)', tg.status === 410 || (tg.status !== 200 && !(tg.j?.launches?.length > 0)), `${tg.status}`)

  /* ------------------------------------------------------------- no network --- */
  await sleep(500)
  check('the retired server never called DeepCore’s API', dcCalls.length === 0, `${dcCalls.length} calls: ${dcCalls.slice(0, 3).join(' ')}`)
} catch (e) {
  check(`no exception (${e?.stack ?? e})`, false)
}

console.log(`\n${t.passed} passed, ${t.failed} failed`)
stub.close()
fs.rmSync(tmp, { recursive: true, force: true })
process.exit(t.failed ? 1 : 0)
