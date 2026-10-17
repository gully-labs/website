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
// Venues disagree on units: PeddleSwap stamps its days in milliseconds, the others in seconds.
const dayKey = (t) => Math.floor((t > 1e11 ? t / 1000 : t) / 86400) * 86400
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

/* ------------------------------------------------------------- DefiLlama --- */

// DefiLlama lists Peddles (volume + fees), PeddleQuest (TVL + fees) and DeepCore (all three),
// each from an adapter in its public repositories with a stated methodology. Where a venue's own
// API has no dollar figure, DefiLlama's is used and named as the source. Its figures lag the
// venue's own by up to a day (DefiLlama runs adapters daily), which the provenance says.
async function llama(kind, slug) {
  const url = kind === 'tvl' ? `https://api.llama.fi/protocol/${slug}` : `https://api.llama.fi/summary/${kind}/${slug}?excludeTotalDataChart=true&excludeTotalDataChartBreakdown=true`
  const j = await getJson(url, 20_000)
  if (j.message || j.error) throw new Error(String(j.message ?? j.error))
  if (kind === 'tvl') {
    const byChain = j.currentChainTvls ?? {}
    const tvl = Object.entries(byChain).filter(([k]) => !/-|borrowed|staking|pool2/i.test(k)).map(([, v]) => num(v) ?? 0)
    const last = (j.tvl ?? []).at(-1)
    return { url, tvlUsd: tvl.length ? tvl.reduce((a, b) => a + b, 0) : null, at: last ? new Date(last.date * 1000).toISOString() : null }
  }
  return { url, total24h: num(j.total24h), total7d: num(j.total7d), totalAllTime: num(j.totalAllTime), chains: j.chains ?? [], methodology: j.methodology ?? null }
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
    feesAllUsd: null,
    daily,
    counts: { traders: num(j.traders), trades: num(j.trades) },
    notes: ['TVL and fees are not published by this venue.'],
    source: { url, readAt: new Date().toISOString() },
  }
}

// DeepCore's documented public API host. The old path on the app host is read only if the API
// host refuses, so a move or outage of one never blanks the venue.
export const DEEPCORE_HOSTS = ['https://api.deepcore.fun', 'https://deepcore.fun']

// Every chain must state a figure for the sum to be stated: a chain that leaves it out makes the
// total unknown, never a smaller number.
const sumAll = (xs) => (xs.length && xs.every((x) => x !== null && x !== undefined) ? xs.reduce((a, b) => a + b, 0) : null)

/** The figures the landing shows beside DeepCore's dollars, from one /v1/overview document:
    hosted sites (pads), launches in the last 24 hours, locks and the dollars they hold. */
export function deepcoreExtras(items) {
  const lockUsd = items.map((it) => num(it.locks?.usd))
  const unpricedLocks = items.reduce((a, it) => a + (num(it.locks?.unpricedLocks) ?? 0), 0)
  return {
    sites: sumAll(items.map((it) => num(it.sites?.total))),
    sites24h: sumAll(items.map((it) => num(it.sites?.last24h))),
    launches24h: sumAll(items.map((it) => num(it.launches?.last24h))),
    locks: sumAll(items.map((it) => num(it.locks?.count))),
    lockedUsd: sumAll(lockUsd),
    unpricedLocks,
  }
}

async function deepcore() {
  let url = null
  let j = null
  const failed = []
  for (const host of DEEPCORE_HOSTS) {
    try {
      j = await getJson(`${host}/v1/overview`, 25_000)
      if (!Array.isArray(j?.data?.items)) throw new Error('no items in the overview')
      url = `${host}/v1/overview`
      break
    } catch (e) {
      failed.push(`${host.replace('https://', '')} ${String(e?.message ?? e)}`)
      j = null
    }
  }
  if (!j) throw new Error(`every DeepCore host refused: ${failed.join('; ')}`)
  const items = j.data.items
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
  const extras = deepcoreExtras(items)
  const notes = failed.map((f) => `${f} could not be read; the fallback host was used.`)
  if (extras.unpricedLocks) notes.push(`${extras.unpricedLocks} lock${extras.unpricedLocks === 1 ? '' : 's'} could not be priced and are left out of the locked dollars.`)
  if (unpriced) notes.push(`${unpriced} token${unpriced === 1 ? '' : 's'} could not be priced and are left out of the dollar figures.`)
  const prov = j.provenance ?? {}
  // The index's fee figures carry no window: `paid` is what the protocol has collected and
  // `accrued` what is owed and not yet collected, so together they are fees earned to date.
  const feesAllUsd = sumKnown(chains.flatMap((c) => [c.feesPaidUsd, c.feesAccruedUsd]))
  let fees24hUsd = null
  const sources = [url]
  try {
    const f = await llama('fees', 'deepcore')
    fees24hUsd = f.total24h
    sources.push(f.url)
    notes.push("Fees in the last 24 hours are read from DefiLlama's DeepCore adapter, which lags by up to a day.")
  } catch (e) {
    notes.push(`DefiLlama could not be read for 24h fees (${String(e?.message ?? e)}).`)
  }
  return {
    volume24hUsd: sumKnown(chains.map((c) => c.volume24hUsd)),
    // The index's daily dollars, summed from the first day it holds.
    volumeAllUsd: daily.length ? daily.reduce((a, p) => a + p.v, 0) : null,
    volumeAllSince: daily.length ? new Date(daily[0].t * 1000).toISOString() : null,
    tvlUsd: sumKnown(chains.map((c) => c.tvlUsd)),
    fees24hUsd,
    feesAllUsd,
    // Dollars held in DeepCore locks (launch liquidity locked forever, timed LP locks, token locks
    // and vesting), as the index values them. Not added to any total: it overlaps value locked.
    lockedUsd: extras.lockedUsd,
    daily,
    chains,
    counts: { launches, pools, chains: items.length, sites: extras.sites, sites24h: extras.sites24h, launches24h: extras.launches24h, locks: extras.locks },
    notes,
    source: { url: sources.join(' + '), readAt: prov.generatedAt ?? new Date().toISOString() },
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
    feesAllUsd: null,
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
    volumeAllSince = w.data?.allTime?.volume?.since ?? null
  } catch {
    /* fees stay unknown */
  }
  // Peddles publishes all-time volume per asset in token units and no price. DefiLlama's Peddles
  // adapter (its public dimension-adapters repository) prices the same swaps in dollars, so the
  // dollar figures for all-time volume and fees come from there, named as such.
  let fees24hUsd = null
  let feesAllUsd = null
  const sources = [url]
  try {
    const [dex, fees] = await Promise.all([llama('dexs', 'peddles'), llama('fees', 'peddles')])
    volumeAllUsd = dex.totalAllTime
    fees24hUsd = fees.total24h
    feesAllUsd = fees.totalAllTime
    sources.push(dex.url, fees.url)
    notes.push('All-time volume and fees in dollars are read from DefiLlama (its Peddles adapter), which lags by up to a day.')
  } catch (e) {
    notes.push(`DefiLlama could not be read for all-time volume and fees (${String(e?.message ?? e)}).`)
  }
  notes.push('Creator fees are published in ETH only; they are shown beside the dollar figure, not added to it.')
  return {
    volume24hUsd: sumKnown(chains.map((c) => c.volume24hUsd)),
    volumeAllUsd,
    volumeAllSince,
    tvlUsd: sumKnown(chains.map((c) => c.tvlUsd)),
    fees24hUsd,
    feesAllUsd,
    feesNative,
    daily: [],
    chains,
    counts: { launches24h: num(d.launches24h), pools: num(d.poolCount), users: num(d.totalUsers), chains: chains.length },
    notes,
    source: { url: sources.join(' + '), readAt: new Date().toISOString() },
  }
}

async function peddlequest() {
  // A quest platform: reward pools are escrowed on chain and there is no trading volume. Its own
  // API publishes no figures; DefiLlama's PeddleQuest adapters report the escrowed reward pools
  // as TVL and what the platform charges as fees, on all four chains.
  const [tvl, fees] = await Promise.all([llama('tvl', 'peddlequest'), llama('fees', 'peddlequest')])
  return {
    volume24hUsd: null,
    volumeAllUsd: null,
    volumeAllSince: null,
    tvlUsd: tvl.tvlUsd,
    fees24hUsd: fees.total24h,
    feesAllUsd: fees.totalAllTime,
    daily: [],
    counts: {},
    notes: ['Quests, not trading: no volume. Value locked is the reward pools escrowed on chain and fees are what the platform charges, both read from DefiLlama (its PeddleQuest adapters), which lags by up to a day.'],
    source: { url: `${tvl.url} + ${fees.url}`, readAt: tvl.at ?? new Date().toISOString() },
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
      feesAllUsd: sumKnown(ok.map((v) => v.feesAllUsd)),
      covers: { volumeAllUsd: covers('volumeAllUsd'), volume24hUsd: covers('volume24hUsd'), tvlUsd: covers('tvlUsd'), fees24hUsd: covers('fees24hUsd'), feesAllUsd: covers('feesAllUsd') },
      unread: venues.filter((v) => v.state === 'error').map((v) => v.key),
    },
    daily: seriesOf(byDay),
    venues,
  }
  cache = { at: Date.now(), body }
  return body
}
