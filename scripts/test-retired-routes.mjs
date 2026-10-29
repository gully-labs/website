// What is left of the DeepCore integration, which ended on 2026-10-29: its old routes answer 410 Gone, a new
// "new-launch" alert is refused, and a stored alert of that retired kind still lists (in neutral words, never
// evaluated) and can be deleted.
//
//   npm run test:retired-routes        (no build needed; TEST_PORT overrides the port, default 8796)
//
// The real server runs IN THIS PROCESS with a fresh DATA_DIR, seeded with one alert of the retired kind.
// Nothing upstream is read.

import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { makeChecker, makeClient, guardTestRun } from './test-helpers.mjs'

const PORT = Number(process.env.TEST_PORT) || 8796
await guardTestRun(PORT)
const BASE = `http://localhost:${PORT}`
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gully-retired-'))
const t = makeChecker()
const { check } = t
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const wallet = privateKeyToAccount(generatePrivateKey())
const owner = wallet.address.toLowerCase()

// One alert of the retired kind, as an older server stored it.
const OLD_ID = 'oldlaunch1'
fs.writeFileSync(
  path.join(tmp, 'alerts.json'),
  JSON.stringify({
    alerts: [{ id: OLD_ID, owner, name: '', chain: null, ticker: null, condition: { type: 'deepcore-launch', chainId: 8453 }, webhook: { url: 'https://example.com/hook', secret: 'whsec_x' }, telegram: null, enabled: true, createdAt: '2026-10-20T10:00:00.000Z', lastFiredAt: null, disarmed: {}, deliveries: [], pendingLaunches: [] }],
  }),
)

Object.assign(process.env, {
  PORT: String(PORT),
  DATA_DIR: tmp,
  TRACKER_DATA: path.join(tmp, 'tracker-history.json'),
  DIST_DIR: path.join(tmp, 'no-dist'),
  ADMIN_TOKEN: crypto.randomBytes(24).toString('hex'),
  TRACKER_LOOP: 'off',
  TRACKER_SKIP_APIS: '1',
  ASK_REMOTE: 'off',
})
delete process.env.TELEGRAM_BOT_TOKEN
delete process.env.GULLY_TREASURY_ADDRESS
await import('../server/server.mjs')
const { evaluateAlerts } = await import('../server/alerts.mjs')
await sleep(300)

const dev = makeClient(BASE)
const get = async (p) => {
  const r = await fetch(BASE + p)
  return { status: r.status, j: await r.json().catch(() => null) }
}

try {
  /* ------------------------------------------------------------ 410 Gone --- */
  for (const p of ['/api/deepcore/launches', '/api/deepcore/launches?chain=8453', '/api/deepcore/quote?chain=robinhood&token=0x0&amount=1', '/api/tg/launches']) {
    const r = await get(p)
    check(`${p} answers 410 with the reason`, r.status === 410 && /ended on 2026-10-29/.test(r.j?.error ?? ''), `${r.status} ${JSON.stringify(r.j)}`)
  }

  /* ------------------------------------------- the retired alert kind --- */
  await dev.signIn(wallet)
  const view = (await dev.call('/api/developer/alerts')).data
  check('the alerts view no longer offers a new-launch kind', Array.isArray(view?.kinds) && !view.kinds.some((k) => /launch/i.test(`${k.id} ${k.label}`)), JSON.stringify(view?.kinds))
  const old = view?.alerts?.find((a) => a.id === OLD_ID)
  check('a stored alert of the retired kind still lists, as kind "retired"', old?.kind === 'retired', JSON.stringify(old))
  check('it carries no DeepCore wording besides its stored condition type', old && !/deepcore/i.test(JSON.stringify({ ...old, condition: null })), JSON.stringify(old))

  const made = await dev.post('/api/developer/alerts', { condition: { type: 'deepcore-launch', chainId: null }, webhookUrl: 'https://example.com/hook' })
  check('creating a new-launch alert is refused (400) with a plain reason', made.status === 400 && /retired on 2026-10-29/.test(made.data?.error ?? ''), `${made.status} ${made.data?.error}`)

  const test = await dev.post(`/api/developer/alerts/${OLD_ID}/test`)
  check('a retired alert sends no test delivery (409)', test.status === 409, `${test.status}`)
  const resume = await dev.post(`/api/developer/alerts/${OLD_ID}/resume`)
  check('a retired alert cannot be resumed (409)', resume.status === 409, `${resume.status}`)

  const fired = await evaluateAlerts([], Date.now())
  check('the tracker round never evaluates it', Array.isArray(fired) && fired.length === 0)

  const del = await dev.post(`/api/developer/alerts/${OLD_ID}/delete`)
  const after = (await dev.call('/api/developer/alerts')).data
  check('a retired alert can still be deleted', del.status === 200 && !after.alerts.some((a) => a.id === OLD_ID), `${del.status}`)

  /* ------------------------------------------------- nothing reads DeepCore --- */
  // The venue list itself (reading /api/stats would call every live upstream).
  const { VENUES } = await import('../server/stats.mjs')
  check('/api/stats has no deepcore venue to read', VENUES.length > 0 && !VENUES.some((v) => v.key === 'deepcore'), VENUES.map((v) => v.key).join())
} catch (e) {
  check(`no exception (${e?.stack ?? e})`, false)
}

console.log(`\n${t.passed} passed, ${t.failed} failed`)
fs.rmSync(tmp, { recursive: true, force: true })
process.exit(t.failed ? 1 : 0)
