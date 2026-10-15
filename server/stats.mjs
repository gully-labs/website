// Cross-venue figures for the home page: one live read of each Gully Labs project's own
// public API, added up where the units agree (USD), with the source kept beside every
// number. Runs on the server (server.mjs in production, a Vite middleware in dev) because
// Peddles' and PeddleQuest's APIs do not allow a foreign browser origin, and because one
// cached read a minute is kinder to five upstreams than every visitor reading them.
//
// Rules, so the page can never show a number nobody measured:
//   - a venue that could not be read is reported as `state: 'error'`, never as zeros;
//   - a figure a venue does not publish is `null`, and the totals say which venues they cover;
//   - a figure published in a token (Peddles' creator fees, in ETH) is passed through as-is and
//     never added to a dollar total;
//   - "all-time" volume is what the venue has recorded since its own `volumeAllSince`, stated
//     beside the figure: Cartel Family publishes it outright, DeepCore's is the sum of its daily
//     index, Peddles' is its all-time legs valued at the prices its own token endpoint reports.

const CACHE_MS = 60_000
const TIMEOUT_MS = 15_000

const num = (v) => {
  const n = typeof v === 'string' ? Number(v) : v
  return typeof n === 'number' && Number.isFinite(n) ? n : null
}
const sumKnown = (xs) => {
  const real = xs.filter((x) => x !== null && x !== undefined)
  return real.length ? real.reduce((a, b) => a + b, 0) : null
}
const dayKey = (t) => Math.floor(t / 86400) * 86400
const seriesOf = (map) => [...map.entries()].sort((a, b) => a[0] - b[0]).map(([t, v]) => ({ t, v }))
const units = (raw, decimals) => Number(BigInt(raw)) / 10 ** decimals

async function getJson(url, ms = TIMEOUT_MS) {
  const ctl = new AbortController()
  const id = setTimeout(() => ctl.abort(), ms)
  try {
    const res = await fetch(url, { headers: { accept: 'application/json' }, signal: ctl.signal })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return await res.json()
  } finally {
    clearTimeout(id)
  }
}

/* ---------------------------------------------------------------- venues --- */

async function cartel() {
  const url = 'https://cartel.family/api/platform/landing-stats'
  const j = await getJson(url)
  // volume_series is cumulative USD per day; the chart wants the daily flow.
  const cum = (j.volume_series ?? []).map((p) => ({ t: Date.parse(`${p.t}T00:00:00Z`) / 1000, v: num(p.v) ?? 0 }))
  const daily = cum.map((p, i) => ({ t: p.t, v: Math.max(0, p.v - (i ? cum[i - 1].v : 0)) }))
  return {
    volume24hUsd: num(j.volume_24h_usd),
    volumeAllUsd: num(j.volume_usd),
    volumeAllSince: cum.length ? new Date(cum[0].t * 1000).toISOString() : null,
    tvlUsd: null,
    fees24hUsd: null,
    daily,
    counts: { traders: num(j.traders), trades: num(j.trades) },
    notes: ['TVL and fees are not published by this venue.'],
    source: { url, readAt: new Date().toISOString() },
  }
}

async function deepcore() {
  const url = 'https://deepcore.fun/v1/overview'
  const j = await getJson(url, 25_000)
  const items = j.data?.items ?? []
  const byDay = new Map()
  let unpriced = 0
  let launches = 0
  let pools = 0
  const chains = []
  for (const it of items) {
    launches += it.launches?.total ?? 0
    pools += it.pools?.total ?? 0
    const v24 = it.volume?.last24h ?? {}
    unpriced += (v24.unpricedTokens ?? 0) + (it.valueLocked?.unpricedTokens ?? 0)
    for (const d of it.volume?.daily ?? []) byDay.set(dayKey(d.t), (byDay.get(dayKey(d.t)) ?? 0) + (num(d.usd) ?? 0))
    chains.push({
      chainId: it.chainId,
      // A day with no swaps and nothing unpriced is a true zero, which the index reports as null.
      volume24hUsd: num(v24.usd) ?? (v24.swaps === 0 && !v24.unpricedTokens ? 0 : null),
      tvlUsd: num(it.valueLocked?.usd),
      feesPaidUsd: num(it.fees?.paid?.usd),
      feesAccruedUsd: num(it.fees?.accrued?.usd),
    })
  }
  const daily = seriesOf(byDay)
  const notes = []
  if (unpriced) notes.push(`${unpriced} token${unpriced === 1 ? '' : 's'} could not be priced and are left out of the dollar figures.`)
  const prov = j.provenance ?? {}
  return {
    volume24hUsd: sumKnown(chains.map((c) => c.volume24hUsd)),
    // The index's daily dollars, summed from the first day it holds.
    volumeAllUsd: daily.length ? daily.reduce((a, p) => a + p.v, 0) : null,
    volumeAllSince: daily.length ? new Date(daily[0].t * 1000).toISOString() : null,
    tvlUsd: sumKnown(chains.map((c) => c.tvlUsd)),
    // Fees the protocol was paid in the window plus what is accrued and not yet collected.
    fees24hUsd: sumKnown(chains.flatMap((c) => [c.feesPaidUsd, c.feesAccruedUsd])),
    daily,
    chains,
    counts: { launches, pools, chains: items.length },
    notes,
    source: { url, readAt: prov.generatedAt ?? new Date().toISOString() },
  }
}

async function peddleswap() {
  const hosts = ['https://api.peddleswap.xyz', 'https://api-base.peddleswap.xyz', 'https://api-arc.peddleswap.xyz']
  const results = await Promise.allSettled(hosts.map((h) => getJson(`${h}/v1/stats/overview`)))
  const ok = []
  const failed = []
  results.forEach((r, i) =>
    r.status === 'fulfilled' ? ok.push({ host: hosts[i], j: r.value }) : failed.push({ host: hosts[i], error: String(r.reason?.message ?? r.reason) }),
  )
  if (ok.length === 0) throw new Error(`every PeddleSwap API refused: ${failed.map((f) => `${f.host.replace('https://', '')} ${f.error}`).join('; ')}`)
  const byDay = new Map()
  for (const { j } of ok) for (const p of j.volumeSeries ?? []) byDay.set(dayKey(p.t), (byDay.get(dayKey(p.t)) ?? 0) + (num(p.v) ?? 0))
  const daily = seriesOf(byDay)
  return {
    volume24hUsd: sumKnown(ok.map(({ j }) => num(j.volumeUsd24h))),
    // The overview carries 30 days of daily volume, not an all-time figure.
    volumeAllUsd: null,
    volumeAllSince: null,
    volume30dUsd: daily.length ? daily.reduce((a, p) => a + p.v, 0) : null,
    tvlUsd: sumKnown(ok.map(({ j }) => num(j.tvlUsd))),
    fees24hUsd: sumKnown(ok.map(({ j }) => num(j.fees24hUsd))),
    daily,
    counts: { pools: sumKnown(ok.map(({ j }) => num(j.counts?.pools))), activeLocks: sumKnown(ok.map(({ j }) => num(j.counts?.activeLocks))), chains: ok.length },
    notes: ['All-time volume is not published; the last 30 days are.', ...failed.map((f) => `${f.host.replace('https://', '')} could not be read (${f.error}).`)],
    source: { url: ok.map((o) => `${o.host}/v1/stats/overview`).join(' + '), readAt: new Date().toISOString() },
  }
}

async function peddles() {
  const base = 'https://api.peddles.xyz/api/v1'
  const url = `${base}/analytics/platform?chainId=4663`
  const j = await getJson(url)
  const d = j.data ?? {}
  const chains = (d.chains ?? [])
    .filter((c) => !c.testnet)
    .map((c) => ({ chainId: c.chainId, tvlUsd: num(c.tvlUsd), volume24hUsd: num(c.volume24hUsd), reason: c.usdUnavailableReason ?? null }))
  const notes = chains.filter((c) => c.tvlUsd === null).map((c) => `chain ${c.chainId}: TVL not measured${c.reason ? ` (${c.reason})` : ''}.`)
  // Creator fees and all-time volume come from the windows document, per asset in token units.
  let feesNative = null
  let volumeAllUsd = null
  let volumeAllSince = null
  try {
    const w = await getJson(`${base}/analytics/windows?chainId=4663`)
    const t = w.data?.creatorFees?.total
    if (t && t.currentRaw !== undefined) feesNative = { symbol: t.symbol, amount: units(t.currentRaw, t.decimals) }
    // All-time volume is published per asset (WETH and tokenised stocks) in token units, and no
    // Peddles endpoint prices them, so it cannot be shown in dollars without inventing a rate.
    const legs = w.data?.allTime?.volume?.legs ?? []
    volumeAllSince = w.data?.allTime?.volume?.since ?? null
    volumeAllUsd = null
    if (legs.length) notes.push(`All-time volume is published per asset in token units (${legs.map((l) => l.symbol).join(', ')}) with no price, so it is not shown in dollars.`)
  } catch {
    /* fees and all-time stay unknown */
  }
  notes.push('Creator fees are published in ETH only; they are shown but not added to the dollar total.')
  return {
    volume24hUsd: sumKnown(chains.map((c) => c.volume24hUsd)),
    volumeAllUsd,
    volumeAllSince,
    tvlUsd: sumKnown(chains.map((c) => c.tvlUsd)),
    fees24hUsd: null,
    feesNative,
    daily: [],
    chains,
    counts: { launches24h: num(d.launches24h), pools: num(d.poolCount), users: num(d.totalUsers), chains: chains.length },
    notes,
    source: { url, readAt: new Date().toISOString() },
  }
}

async function peddlequest() {
  // A quest platform: reward pools are escrowed on chain; there is no trading volume, TVL or
  // fee stream, and no public stats endpoint yet. The read proves the site is up, nothing more.
  const url = 'https://peddlequest.xyz/'
  const res = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(TIMEOUT_MS) })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return {
    volume24hUsd: null,
    volumeAllUsd: null,
    volumeAllSince: null,
    tvlUsd: null,
    fees24hUsd: null,
    daily: [],
    counts: {},
    notes: ['Quests, not trading: no volume, TVL or fee stream. Escrow figures are not published yet.'],
    source: { url, readAt: new Date().toISOString() },
  }
}

export const VENUES = [
  { key: 'cartel-family', read: cartel },
  { key: 'deepcore', read: deepcore },
  { key: 'peddleswap', read: peddleswap },
  { key: 'peddles', read: peddles },
  { key: 'peddlequest', read: peddlequest },
]

let cache = null

/** The combined document the page renders. Cached for a minute; never throws for one bad venue. */
export async function readStats() {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.body
  const settled = await Promise.allSettled(VENUES.map((v) => v.read()))
  const venues = VENUES.map((v, i) => {
    const r = settled[i]
    return r.status === 'fulfilled'
      ? { key: v.key, state: 'ok', ...r.value }
      : { key: v.key, state: 'error', error: String(r.reason?.message ?? r.reason) }
  })
  const ok = venues.filter((v) => v.state === 'ok')
  const byDay = new Map()
  for (const v of ok) for (const p of v.daily ?? []) byDay.set(p.t, (byDay.get(p.t) ?? 0) + p.v)
  const covers = (field) => ok.filter((v) => v[field] !== null && v[field] !== undefined).map((v) => v.key)
  const body = {
    generatedAt: new Date().toISOString(),
    totals: {
      volumeAllUsd: sumKnown(ok.map((v) => v.volumeAllUsd)),
      volume24hUsd: sumKnown(ok.map((v) => v.volume24hUsd)),
      tvlUsd: sumKnown(ok.map((v) => v.tvlUsd)),
      fees24hUsd: sumKnown(ok.map((v) => v.fees24hUsd)),
      covers: { volumeAllUsd: covers('volumeAllUsd'), volume24hUsd: covers('volume24hUsd'), tvlUsd: covers('tvlUsd'), fees24hUsd: covers('fees24hUsd') },
      unread: venues.filter((v) => v.state === 'error').map((v) => v.key),
    },
    daily: seriesOf(byDay),
    venues,
  }
  cache = { at: Date.now(), body }
  return body
}
