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
//     never added to a dollar total.

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
  const notes = []
  if (unpriced) notes.push(`${unpriced} token${unpriced === 1 ? '' : 's'} could not be priced and are left out of the dollar figures.`)
  const prov = j.provenance ?? {}
  return {
    volume24hUsd: sumKnown(chains.map((c) => c.volume24hUsd)),
    tvlUsd: sumKnown(chains.map((c) => c.tvlUsd)),
    // Fees the protocol was paid in the window plus what is accrued and not yet collected.
    fees24hUsd: sumKnown(chains.flatMap((c) => [c.feesPaidUsd, c.feesAccruedUsd])),
    daily: seriesOf(byDay),
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
  return {
    volume24hUsd: sumKnown(ok.map(({ j }) => num(j.volumeUsd24h))),
    tvlUsd: sumKnown(ok.map(({ j }) => num(j.tvlUsd))),
    fees24hUsd: sumKnown(ok.map(({ j }) => num(j.fees24hUsd))),
    daily: seriesOf(byDay),
    counts: { pools: sumKnown(ok.map(({ j }) => num(j.counts?.pools))), activeLocks: sumKnown(ok.map(({ j }) => num(j.counts?.activeLocks))), chains: ok.length },
    notes: failed.map((f) => `${f.host.replace('https://', '')} could not be read (${f.error}).`),
    source: { url: ok.map((o) => `${o.host}/v1/stats/overview`).join(' + '), readAt: new Date().toISOString() },
  }
}

async function peddles() {
  const url = 'https://api.peddles.xyz/api/v1/analytics/platform?chainId=4663'
  const j = await getJson(url)
  const d = j.data ?? {}
  const chains = (d.chains ?? [])
    .filter((c) => !c.testnet)
    .map((c) => ({ chainId: c.chainId, tvlUsd: num(c.tvlUsd), volume24hUsd: num(c.volume24hUsd), reason: c.usdUnavailableReason ?? null }))
  // Creator fees are published in the chain's native token only: shown as-is, never added to USD.
  let feesNative = null
  try {
    const w = await getJson('https://api.peddles.xyz/api/v1/analytics/windows?chainId=4663')
    const t = w.data?.creatorFees?.total
    if (t && t.currentRaw !== undefined) feesNative = { symbol: t.symbol, amount: Number(BigInt(t.currentRaw)) / 10 ** t.decimals }
  } catch {
    /* fees stay unknown */
  }
  const notes = chains.filter((c) => c.tvlUsd === null).map((c) => `chain ${c.chainId}: TVL not measured${c.reason ? ` (${c.reason})` : ''}.`)
  notes.push('Creator fees are published in ETH only; they are shown but not added to the dollar total.')
  return {
    volume24hUsd: sumKnown(chains.map((c) => c.volume24hUsd)),
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
  const body = {
    generatedAt: new Date().toISOString(),
    totals: {
      volume24hUsd: sumKnown(ok.map((v) => v.volume24hUsd)),
      tvlUsd: sumKnown(ok.map((v) => v.tvlUsd)),
      fees24hUsd: sumKnown(ok.map((v) => v.fees24hUsd)),
      covers: {
        volume24hUsd: ok.filter((v) => v.volume24hUsd !== null).map((v) => v.key),
        tvlUsd: ok.filter((v) => v.tvlUsd !== null).map((v) => v.key),
        fees24hUsd: ok.filter((v) => v.fees24hUsd !== null).map((v) => v.key),
      },
      unread: venues.filter((v) => v.state === 'error').map((v) => v.key),
    },
    daily: seriesOf(byDay),
    venues,
  }
  cache = { at: Date.now(), body }
  return body
}
