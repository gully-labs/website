// GET /api/admin/charts?days=7|30|90 — daily series for the admin dashboard's charts (admin.mjs routes
// here behind ADMIN_TOKEN). Read-only: everything is assembled from what the server already records.
//
//   revenue        billing ledger payments (billing.json): USD per day, split by asset symbol and by chain
//   accounts       wallet accounts (developers.json createdAt) and Gully Analytics accounts per day
//   api            origin API requests per day (access.mjs api-usage.json: anonymous, keyed, limited)
//   alerts         alert deliveries per day from alerts.json (gap vs DeepCore launch; test sends left out)
//   ask            Gully AI questions per day from DATA_DIR/ask-log.jsonl, by channel
//   payLinks       invoices made by pay links that were paid, per day (count and USD)
//   webhooks       delivery outcomes per day: Gully Pay merchant webhooks (pay-webhooks.mjs) and alert
//                  webhooks (alerts.json), with the success rate delivered / (delivered + failed)
//
// A day the server did not record is null, never 0: API counts before api-usage.json began
// (`usage.since`), and any series whose store does not exist yet comes back as null with a reason.
// Retention limits are said in `note` (alerts keep their last 50 deliveries; the ask log 90 days;
// pay webhooks the last 1,000 finished deliveries).

import fs from 'node:fs'
import path from 'node:path'
import { accessStats } from './access.mjs'
import { adminAnalyticsAccounts } from './analytics-accounts.mjs'
import { askConfigured } from './ask.mjs'
import { ledger } from './billing.mjs'
import { DATA_DIR } from './http.mjs'
import { deliveries as payDeliveries } from './pay-webhooks.mjs'
import { CHAINS } from './payments.mjs'
import { developers } from './store.mjs'

const DAY = 86_400_000
const dayKey = (t) => new Date(t).toISOString().slice(0, 10)

function dayList(days, now = Date.now()) {
  const out = []
  for (let i = days - 1; i >= 0; i--) out.push(dayKey(now - i * DAY))
  return out
}

/** An all-zero array over `keys`, and a function that adds `n` to the day of time `t` (when in range). */
function counter(keys) {
  const idx = new Map(keys.map((k, i) => [k, i]))
  const arr = keys.map(() => 0)
  const add = (t, n = 1) => {
    const ms = typeof t === 'number' ? t : Date.parse(t)
    if (!Number.isFinite(ms)) return
    const i = idx.get(dayKey(ms))
    if (i !== undefined) arr[i] += n
  }
  return [arr, add]
}

function grouped(keys) {
  const groups = new Map()
  const add = (name, t, n = 1) => {
    if (!groups.has(name)) groups.set(name, counter(keys))
    groups.get(name)[1](t, n)
  }
  const out = () => Object.fromEntries([...groups].map(([k, [arr]]) => [k, arr]))
  return [add, out]
}

const readJsonFile = (f) => {
  try {
    return JSON.parse(fs.readFileSync(f, 'utf8'))
  } catch {
    return null
  }
}

const usd = (cents) => Math.round(Number(cents)) / 100

function revenue(keys) {
  const [total, addTotal] = counter(keys)
  const [count, addCount] = counter(keys)
  const [byAsset, assets] = grouped(keys)
  const [byChain, chains] = grouped(keys)
  const [byKind, kinds] = grouped(keys)
  let unpriced = 0
  for (const p of ledger().payments ?? []) {
    addCount(p.at)
    if (p.usdCents == null) {
      unpriced++
      continue
    }
    const v = usd(p.usdCents)
    addTotal(p.at, v)
    byAsset(p.symbol ?? p.assetId ?? 'unknown', p.at, v)
    byChain(CHAINS[p.chainId]?.name ?? String(p.chainId), p.at, v)
    byKind(p.kind ?? 'plan', p.at, v)
  }
  const round = (o) => Object.fromEntries(Object.entries(o).map(([k, a]) => [k, a.map((x) => Math.round(x * 100) / 100)]))
  return { usd: total.map((x) => Math.round(x * 100) / 100), payments: count, byAsset: round(assets()), byChain: round(chains()), byKind: round(kinds()), unpriced, note: 'USD at the quote, from the Gully Pay ledger (plans, analytics and invoices).' }
}

function accounts(keys) {
  const [wallets, addWallet] = counter(keys)
  for (const a of developers().accounts ?? []) addWallet(a.createdAt)
  const [analytics, addAnalytics] = counter(keys)
  for (const a of adminAnalyticsAccounts()) addAnalytics(a.createdAt)
  return { wallets, analytics }
}

function api(keys) {
  const s = accessStats()
  const byDay = new Map(s.days.map((d) => [d.day, d]))
  const since = s.since ? dayKey(Date.parse(s.since)) : null
  const pick = (f) => keys.map((k) => (byDay.has(k) && (!since || k >= since) ? byDay.get(k)[f] ?? 0 : null))
  return { anonymous: pick('anonymous'), keyed: pick('keyed'), limited: pick('limited'), since: s.since ?? null, note: 'Requests that reached the origin; answers served from Cloudflare’s cache are not counted. The last 30 days are kept in this view.' }
}

/** Alert deliveries (non-test) from alerts.json, and the alert webhooks' own outcomes. */
function alertDeliveries() {
  const db = readJsonFile(path.join(DATA_DIR, 'alerts.json'))
  if (!db) return null
  const out = []
  for (const a of db.alerts ?? []) for (const d of a.deliveries ?? []) if (!d.test) out.push(d)
  return out
}

function alerts(keys, list) {
  if (!list) return { gap: keys.map(() => 0), launch: keys.map(() => 0), telegram: keys.map(() => 0), webhook: keys.map(() => 0), note: 'No alert has been created on this server yet.' }
  const [gap, addGap] = counter(keys)
  const [launch, addLaunch] = counter(keys)
  const [telegram, addTg] = counter(keys)
  const [webhook, addWh] = counter(keys)
  const seen = new Set()
  for (const d of list) {
    if (d.channel === 'telegram') addTg(d.at)
    else addWh(d.at)
    // One alert firing can go out on two channels under the same payload id: count it once.
    const id = `${d.id}`
    if (seen.has(id)) continue
    seen.add(id)
    if ((d.events ?? []).some((e) => String(e).startsWith('deepcore:'))) addLaunch(d.at)
    else addGap(d.at)
  }
  return { gap, launch, telegram, webhook, note: 'Each alert keeps its last 50 deliveries, so older days of a busy alert may be undercounted.' }
}

function ask(keys) {
  const file = path.join(process.env.DATA_DIR ?? DATA_DIR, 'ask-log.jsonl')
  let text
  try {
    text = fs.readFileSync(file, 'utf8')
  } catch {
    return askConfigured() ? { byChannel: { web: keys.map(() => 0) }, unanswered: keys.map(() => 0), note: 'No question has been asked yet.' } : null
  }
  const [byChannel, channels] = grouped(keys)
  const [unanswered, addUnanswered] = counter(keys)
  const first = keys[0]
  for (const line of text.split('\n')) {
    const at = line.match(/^\{"at":"([^"]+)"/)?.[1]
    if (!at || at.slice(0, 10) < first) continue
    let e
    try {
      e = JSON.parse(line)
    } catch {
      continue
    }
    byChannel(e.channel ?? 'web', e.at)
    if (!e.answered) addUnanswered(e.at)
  }
  const ch = channels()
  return { byChannel: Object.keys(ch).length ? ch : { web: keys.map(() => 0) }, unanswered, note: 'The ask log keeps 90 days.' }
}

function payLinks(keys) {
  const [count, addCount] = counter(keys)
  const [total, addTotal] = counter(keys)
  const l = ledger()
  for (const inv of l.invoices ?? []) {
    if (!inv.linkId || !inv.paidAt) continue
    addCount(inv.paidAt)
    if (inv.usdCents != null) addTotal(inv.paidAt, usd(inv.usdCents))
  }
  return { payments: count, usd: total.map((x) => Math.round(x * 100) / 100), links: (l.links ?? []).length }
}

function webhooks(keys, alertList) {
  const [payOk, addPayOk] = counter(keys)
  const [payFail, addPayFail] = counter(keys)
  const [payPending, addPayPending] = counter(keys)
  for (const d of payDeliveries({ limit: 100_000 })) {
    if (d.test) continue
    if (d.state === 'delivered') addPayOk(d.finishedAt ?? d.createdAt)
    else if (d.state === 'failed') addPayFail(d.finishedAt ?? d.createdAt)
    else addPayPending(d.createdAt)
  }
  const [alertOk, addAlertOk] = counter(keys)
  const [alertFail, addAlertFail] = counter(keys)
  for (const d of alertList ?? []) {
    if (d.channel === 'telegram') continue
    if (d.ok) addAlertOk(d.at)
    else addAlertFail(d.at)
  }
  // Success rate per day over both kinds; a day with no finished delivery has no rate (null).
  const rate = keys.map((_, i) => {
    const ok = payOk[i] + alertOk[i]
    const all = ok + payFail[i] + alertFail[i]
    return all ? Math.round((ok / all) * 1000) / 10 : null
  })
  const sum = (a) => a.reduce((x, y) => x + y, 0)
  const okAll = sum(payOk) + sum(alertOk)
  const allAll = okAll + sum(payFail) + sum(alertFail)
  return {
    pay: { delivered: payOk, failed: payFail, pending: payPending },
    alerts: { delivered: alertOk, failed: alertFail },
    rate,
    rateOverall: allAll ? Math.round((okAll / allAll) * 1000) / 10 : null,
    note: 'Gully Pay merchant webhooks (final state of each delivery, retries included) and gap/launch alert webhooks (each attempt). Test sends are left out.',
  }
}

export function adminCharts(daysIn) {
  const days = [7, 30, 90].includes(Number(daysIn)) ? Number(daysIn) : 30
  const keys = dayList(days)
  const alertList = alertDeliveries()
  const askSeries = ask(keys)
  return {
    generatedAt: new Date().toISOString(),
    days: keys,
    revenue: revenue(keys),
    accounts: accounts(keys),
    api: api(keys),
    alerts: alerts(keys, alertList),
    ask: askSeries ?? { byChannel: null, unanswered: null, note: 'Gully AI is not switched on on this server (no ANTHROPIC_API_KEY), so no questions are recorded.' },
    payLinks: payLinks(keys),
    webhooks: webhooks(keys, alertList),
  }
}
