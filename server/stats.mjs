// Cross-venue figures for the home page: one live read of each Gully Labs project's own
// public API, added up where the units agree (USD), with the source kept beside every
// number. Runs on the server (server.mjs in production, a Vite middleware in dev) because
// Peddles' and PeddleQuest's APIs do not allow a foreign browser origin, and because one
// cached read a minute is kinder to four upstreams than every visitor reading them.
//
// Rules, so the page can never show a number nobody measured:
//   - a venue that could not be read is reported as `state: 'error'`, never as zeros;
//   - a figure a venue does not publish is `null`, and the totals say which venues they cover;
//   - a figure published in a token (Peddles' creator fees, in ETH) is passed through as-is and
//     never added to a dollar total;
//   - "all-time" volume is what the venue has recorded since its own `volumeAllSince`, stated
//     beside the figure: Peddles' is its all-time legs valued at the prices its own token endpoint reports.
//
// DeepCore (deepcore.fun) was a venue here until the partnership ended on 2026-10-29. It is a third-party
// platform now, so its figures are no longer read or served (Gully Core, our fork, lives on Gully Chain).

// Under the page's 60 s poll, so every poll lands on a fresh read and the "read HH:MM" stamp moves each time.
import { divergence, mergeDaily, onchainSnapshot } from './peddles.mjs'
import { GULLY_CHAIN, ledgerFigures as gullyLedger } from './gully-chain.mjs'

const CACHE_MS = 45_000
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

// DefiLlama lists Peddles (volume + fees) and PeddleQuest (TVL + fees),
// each from an adapter in its public repositories with a stated methodology. Where a venue's own
// API has no dollar figure or no daily history, DefiLlama's is used and named as the source. Its
// figures lag the venue's own by up to a day (DefiLlama runs adapters daily), which the provenance says.
//
// DefiLlama moves once a day, so each document is cached for LLAMA_TTL_MS; when it cannot be read
// the last good copy (up to LLAMA_STALE_MS old) is served, and a slug it does not know is not asked
// again for LLAMA_MISS_MS. A failure never reaches the page as zeros.
const LLAMA_TTL_MS = 10 * 60_000
const LLAMA_STALE_MS = 36 * 3_600_000
const LLAMA_MISS_MS = 5 * 60_000
const SERIES_DAYS = 120
const llamaCache = new Map() // url -> { at, doc } | { at, error }
const llamaInflight = new Map() // url -> Promise, so one document is read once however many series ask for it

function llamaDoc(url) {
  let p = llamaInflight.get(url)
  if (!p) {
    p = readLlamaDoc(url).finally(() => llamaInflight.delete(url))
    llamaInflight.set(url, p)
  }
  return p
}

async function readLlamaDoc(url) {
  const hit = llamaCache.get(url)
  const now = Date.now()
  if (hit?.doc && now - hit.at < LLAMA_TTL_MS) return hit.doc
  if (hit?.error && now - hit.at < LLAMA_MISS_MS) throw new Error(hit.error)
  try {
    const j = await getJson(url, 20_000)
    if (j.message || j.error) throw new Error(String(j.message ?? j.error))
    llamaCache.set(url, { at: now, doc: j })
    return j
  } catch (e) {
    if (hit?.doc && now - hit.at < LLAMA_STALE_MS) return hit.doc
    llamaCache.set(url, { at: now, error: String(e?.message ?? e) })
    throw e
  }
}

const pointsOf = (rows, tOf, vOf) => {
  const byDay = new Map()
  for (const r of rows ?? []) {
    const t = num(tOf(r))
    const v = num(vOf(r))
    if (t !== null && v !== null) byDay.set(dayKey(t), v)
  }
  return seriesOf(byDay)
}

async function llama(kind, slug) {
  const url = kind === 'tvl' ? `https://api.llama.fi/protocol/${slug}` : `https://api.llama.fi/summary/${kind}/${slug}?excludeTotalDataChartBreakdown=true`
  const j = await llamaDoc(url)
  if (kind === 'tvl') {
    const byChain = j.currentChainTvls ?? {}
    const tvl = Object.entries(byChain).filter(([k]) => !/-|borrowed|staking|pool2/i.test(k)).map(([, v]) => num(v) ?? 0)
    const last = (j.tvl ?? []).at(-1)
    return {
      url,
      tvlUsd: tvl.length ? tvl.reduce((a, b) => a + b, 0) : null,
      at: last ? new Date(last.date * 1000).toISOString() : null,
      points: pointsOf(j.tvl, (r) => r.date, (r) => r.totalLiquidityUSD),
    }
  }
  return { url, total24h: num(j.total24h), total7d: num(j.total7d), totalAllTime: num(j.totalAllTime), chains: j.chains ?? [], methodology: j.methodology ?? null, points: pointsOf(j.totalDataChart, (r) => r[0], (r) => r[1]) }
}

/* ----------------------------------------------------------------- series --- */

const hasValue = (pts) => !!pts?.some((p) => p.v > 0)
const lastNonZero = (pts) => {
  for (let i = (pts?.length ?? 0) - 1; i >= 0; i--) if (pts[i].v > 0) return pts[i].t
  return null
}
const trim = (pts) => pts.slice(-SERIES_DAYS)

/**
 * The daily series of one venue: volume, fees and value locked, each from the venue's own API first and
 * DefiLlama second, with the source named per series.
 *   spec[metric] = { own?: Point[], ownSource?: { name, url }, llama?: slug, now?: number | null (tvl only) }
 * The venue's own series wins when it has any activity or DefiLlama has none; an own series that is empty
 * or flat while DefiLlama shows activity is replaced by DefiLlama's (fallback: true). A series nobody can
 * supply is [] with source null, never zeros. `lastActivity` is the last day with non-zero volume.
 */
export async function buildSeries(spec) {
  const series = { volume: [], fees: [], tvl: [] }
  const sources = { volume: null, fees: null, tvl: null }
  const notes = []
  let fullVolume = []
  const llamaTotals = {}
  const kinds = { volume: 'dexs', fees: 'fees', tvl: 'tvl' }
  await Promise.all(
    Object.entries(kinds).map(async ([metric, kind]) => {
      const s = spec[metric]
      if (!s) return
      let alt = null
      if (s.llama) {
        try {
          alt = await llama(kind, s.llama)
          llamaTotals[metric] = alt
        } catch (e) {
          notes.push(`DefiLlama has no ${metric} history for ${s.llama} (${String(e?.message ?? e).slice(0, 80)}).`)
        }
      }
      const own = s.own ?? []
      const altSource = alt ? { name: 'DefiLlama', url: alt.url, fallback: true } : null
      let pts = own
      let source = own.length ? { name: s.ownSource?.name ?? 'the venue API', url: s.ownSource?.url ?? null, fallback: false } : null
      if (alt?.points.length && (!own.length || (!hasValue(own) && hasValue(alt.points)))) {
        pts = alt.points
        source = altSource
      }
      if (metric === 'tvl' && s.now !== null && s.now !== undefined && pts.length) {
        const today = dayKey(Date.now() / 1000)
        if (pts.at(-1).t < today) {
          pts = [...pts, { t: today, v: s.now }]
          if (source?.fallback) source = { ...source, name: `DefiLlama + ${s.ownSource?.name ?? 'the venue API'} (latest point)` }
        }
      }
      if (metric === 'volume') fullVolume = pts
      series[metric] = trim(pts)
      sources[metric] = source
    }),
  )
  const lastT = lastNonZero(fullVolume)
  return { series, sources, lastActivity: lastT === null ? null : new Date(lastT * 1000).toISOString(), notes, llama: llamaTotals }
}

/** What a venue adds to its document from buildSeries: the series, their sources, lastActivity, and `daily` (volume) for older readers. */
const seriesFields = (b) => ({ series: b.series, sources: b.sources, lastActivity: b.lastActivity, daily: b.series.volume })

/* ---------------------------------------------------------------- venues --- */

/** Each chain's daily TVL summed by day. A chain without a point for a day counts at its last known value
    (the APIs skip days), and a day before a chain's first point counts it as nothing. */
export function summedTvl(perChain) {
  const chains = perChain.map((list) => {
    const m = new Map()
    for (const p of list ?? []) {
      const v = num(p?.v)
      if (v !== null && Number.isFinite(p?.t)) m.set(dayKey(p.t), v)
    }
    return m
  })
  const days = [...new Set(chains.flatMap((m) => [...m.keys()]))].sort((a, b) => a - b)
  const last = chains.map(() => 0)
  return days.map((t) => ({ t, v: chains.reduce((a, m, i) => (m.has(t) ? (last[i] = m.get(t)) : last[i]) + a, 0) }))
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
  const own = { name: 'PeddleSwap API', url: ok.map((o) => `${o.host}/v1/stats/overview`).join(' + ') }
  const tvlUsd = sumKnown(ok.map(({ j }) => num(j.tvlUsd)))
  const built = await buildSeries({ volume: { own: daily, ownSource: own, llama: 'peddleswap' }, fees: { llama: 'peddleswap' }, tvl: { own: summedTvl(ok.map(({ j }) => j.tvlSeries)), llama: 'peddleswap', now: tvlUsd, ownSource: own } })
  return {
    ...seriesFields(built),
    volume24hUsd: sumKnown(ok.map(({ j }) => num(j.volumeUsd24h))),
    // The overview carries 30 days of daily volume, not an all-time figure.
    volumeAllUsd: null,
    volumeAllSince: null,
    volume30dUsd: daily.length ? daily.reduce((a, p) => a + p.v, 0) : null,
    tvlUsd,
    fees24hUsd: sumKnown(ok.map(({ j }) => num(j.fees24hUsd))),
    feesAllUsd: null,
    sourceNote: "PeddleSwap's own API, daily",
    counts: { pools: sumKnown(ok.map(({ j }) => num(j.counts?.pools))), activeLocks: sumKnown(ok.map(({ j }) => num(j.counts?.activeLocks))), chains: ok.length },
    notes: ['All-time volume is not published; the last 30 days are.', ...built.notes, ...failed.map((f) => `${f.host.replace('https://', '')} could not be read (${f.error}).`)],
    source: { url: ok.map((o) => `${o.host}/v1/stats/overview`).join(' + '), readAt: new Date().toISOString() },
  }
}

const chainList = (chains) => chains.map((c) => c.name).join(', ')
const pct = (x) => `${x > 0 ? '+' : ''}${(x * 100).toFixed(1)}%`
const fmtUsdPlain = (v) => `$${Number(v).toLocaleString('en-US', { maximumFractionDigits: 2 })}`
// The day each chain's fee hook was created (DefiLlama's adapter `start`, the hook's deploy block).
const PEDDLES_START = { 8453: '2026-09-27', 4663: '2026-09-29', 5042: '2026-10-01', 56: '2026-10-01' }

/** The on-chain picture of Peddles' contracts (server/peddles.mjs), without the per-day arrays. */
function onchainOf(snap) {
  const chains = snap.chains.map(({ daily: _daily, ...c }) => c)
  const live = snap.chains.every((c) => c.started && c.caughtUp)
  const progress = snap.chains.reduce((a, c) => a + c.progress, 0) / snap.chains.length
  return { live, progress, chains, readAt: snap.at, label: `on chain · ${chainList(snap.chains)}` }
}

async function peddles() {
  // Peddles' own API: value locked as Peddles measures it, 24h volume, users, creator fees in ETH. It is the
  // fallback for what the chain scan has not covered yet, and no longer required for the venue to be read.
  const base = 'https://api.peddles.xyz/api/v1'
  const url = `${base}/analytics/platform?chainId=4663`
  const notes = []
  const sources = []
  let api = null
  try {
    const j = await getJson(url)
    const d = j.data ?? {}
    api = {
      chains: (d.chains ?? []).filter((c) => !c.testnet).map((c) => ({ chainId: c.chainId, tvlUsd: num(c.tvlUsd), volume24hUsd: num(c.volume24hUsd), reason: c.usdUnavailableReason ?? null })),
      launches24h: num(d.launches24h),
      users: num(d.totalUsers),
    }
    sources.push(url)
  } catch (e) {
    notes.push(`Peddles' own API could not be read (${String(e?.message ?? e)}).`)
  }
  let feesNative = null
  let apiSince = null
  try {
    const w = await getJson(`${base}/analytics/windows?chainId=4663`)
    const t = w.data?.creatorFees?.total
    if (t && t.currentRaw !== undefined) feesNative = { symbol: t.symbol, amount: units(t.currentRaw, t.decimals) }
    apiSince = w.data?.allTime?.volume?.since ?? null
  } catch {
    /* creator fees stay unknown */
  }
  // DefiLlama: the cross-check, and the history for the days our scan has not covered yet.
  let dex = null
  let fees = null
  try {
    ;[dex, fees] = await Promise.all([llama('dexs', 'peddles'), llama('fees', 'peddles')])
    sources.push(dex.url, fees.url)
  } catch (e) {
    notes.push(`DefiLlama could not be read (${String(e?.message ?? e)}).`)
  }
  const nowSec = Math.floor(Date.now() / 1000)
  const snap = onchainSnapshot()
  const doc = peddlesFrom({ api: api && { ...api, since: apiSince }, feesNative, dex, fees, snap, notes, sources, nowSec })
  // The daily series: our on-chain days first (a day is ours once every chain's scan has passed it), DefiLlama's for
  // the days before; value locked is Peddles' own figure, then DefiLlama's. buildSeries names each series' source.
  const volume = mergeDaily(snap.chains, dex?.points ?? [], nowSec, 'v')
  const feeDays = mergeDaily(snap.chains, [], nowSec, 'fees')
  const mixed = (m) => (m.llamaDays ? 'on chain + DefiLlama' : doc.onchain.label)
  const own = { name: 'Peddles API', url }
  const built = await buildSeries({
    volume: { own: volume.onchainDays ? volume.daily : [], ownSource: { name: mixed(volume), url: null }, llama: 'peddles' },
    fees: { own: feeDays.onchainDays ? feeDays.daily : [], ownSource: { name: doc.onchain.label, url: null }, llama: 'peddles' },
    tvl: { llama: 'peddles', now: doc.tvlUsd, ownSource: own },
  })
  doc.notes.push(...built.notes)
  return { ...doc, ...seriesFields(built) }
}

/** Peddles' venue document from its parts. Pure; exported for the tests. */
export function peddlesFrom({ api, feesNative, dex, fees, snap, notes = [], sources = [], nowSec }) {
  const oc = onchainOf(snap)
  const sum = (f) => snap.chains.reduce((a, c) => a + (c[f] ?? 0), 0)
  const merged = mergeDaily(snap.chains, dex?.points ?? dex?.daily ?? [], nowSec)
  if (!oc.live && !dex && !api) throw new Error('neither the chain scan, Peddles nor DefiLlama could be read')

  let volumeAllUsd
  let volumeAllSince = null
  let volume24hUsd
  let feesAllUsd
  let fees24hUsd
  let tvlUsd
  let divergenceNote = null
  const apiTvl = sumKnown((api?.chains ?? []).map((c) => c.tvlUsd))
  if (oc.live) {
    volumeAllUsd = sum('volumeAllUsd')
    volumeAllSince = new Date(Math.min(...snap.chains.map((c) => Date.parse(`${PEDDLES_START[c.chainId] ?? '2026-09-27'}T00:00:00Z`)))).toISOString()
    volume24hUsd = sum('volume24hUsd')
    feesAllUsd = sum('feesAllUsd')
    fees24hUsd = sum('fees24hUsd')
    // Value locked stays Peddles' own figure: launch pools hold mostly the launched token, and valuing that side at
    // its own thin pool price would overstate it. The chain scan's paired-asset side is on the project page.
    tvlUsd = apiTvl
    sources.unshift(`on chain: ${chainList(snap.chains)}`)
    const dv = divergence(volumeAllUsd, dex?.totalAllTime ?? null)
    const df = divergence(feesAllUsd, fees?.totalAllTime ?? null)
    if (dv || df) {
      const parts = []
      if (dv) parts.push(`volume ${fmtUsdPlain(dv.ours)} against DefiLlama's ${fmtUsdPlain(dv.theirs)} (${pct(dv.pct)})`)
      if (df) parts.push(`fees ${fmtUsdPlain(df.ours)} against DefiLlama's ${fmtUsdPlain(df.theirs)} (${pct(df.pct)})`)
      divergenceNote = `Our on-chain all-time differs from DefiLlama's by more than 10%: ${parts.join('; ')}. Ours is shown; DefiLlama lags up to a day and prices with its own feeds.`
      console.warn(`[stats] peddles: ${divergenceNote}`)
      notes.push(divergenceNote)
    }
    notes.push(`Read from the Peddles contracts on ${chainList(snap.chains)}: every swap on a pool PeddlesFeeHook registered, valued at Chainlink prices.`)
    const unpriced = sum('unpricedSwaps')
    if (unpriced) notes.push(`${unpriced} swap${unpriced === 1 ? '' : 's'} in an asset with no price feed (a tokenised stock without a Chainlink feed on that chain) ${unpriced === 1 ? 'is' : 'are'} counted but not valued.`)
    const latest = sum('latestPriced')
    if (latest) notes.push(`${latest} backfilled amount${latest === 1 ? ' was' : 's were'} valued at the current price because the node keeps no older state.`)
  } else {
    volumeAllUsd = dex?.totalAllTime ?? null
    volumeAllSince = api?.since ?? null
    volume24hUsd = sumKnown((api?.chains ?? []).map((c) => c.volume24hUsd))
    feesAllUsd = fees?.totalAllTime ?? null
    fees24hUsd = fees?.total24h ?? null
    tvlUsd = apiTvl
    notes.push(`Reading the Peddles contracts on chain: ${Math.round(oc.progress * 100)}% of the history scanned. Until it is complete, all-time volume and fees are DefiLlama's (its Peddles adapter, up to a day behind) and value locked is Peddles' own.`)
  }
  if (merged.llamaDays && merged.onchainDays) notes.push(`The daily chart is read on chain for ${merged.onchainDays} day${merged.onchainDays === 1 ? '' : 's'}; ${merged.llamaDays} earlier day${merged.llamaDays === 1 ? ' is' : 's are'} DefiLlama's.`)
  if (feesNative) notes.push('Creator fees are published by Peddles in ETH only; they are shown beside the dollar figure, not added to it.')
  return {
    volume24hUsd,
    volumeAllUsd,
    volumeAllSince,
    volume7dUsd: oc.live ? sum('volume7dUsd') : (dex?.total7d ?? null),
    volume30dUsd: oc.live ? sum('volume30dUsd') : null,
    tvlUsd,
    fees24hUsd,
    feesAllUsd,
    feesNative,
    daily: merged.daily,
    chains: api?.chains ?? [],
    counts: {
      launches: oc.live ? sum('launches') : null,
      launches24h: oc.live ? sum('launches24h') : (api?.launches24h ?? null),
      pools: oc.live ? sum('pools') : null,
      swaps: oc.live ? sum('swaps') : null,
      swaps24h: oc.live ? sum('swaps24h') : null,
      users: api?.users ?? null,
      chains: snap.chains.length,
    },
    onchain: { ...oc, divergence: divergenceNote, llamaAllTimeUsd: dex?.totalAllTime ?? null, llamaFeesAllUsd: fees?.totalAllTime ?? null, onchainDays: merged.onchainDays, llamaDays: merged.llamaDays },
    sourceNote: oc.live ? oc.label : merged.daily.length ? 'DefiLlama daily, while the on-chain scan catches up' : 'no daily series yet',
    notes,
    source: { url: sources.join(' + '), readAt: new Date(nowSec * 1000).toISOString() },
  }
}

async function peddlequest() {
  // A quest platform: reward pools are escrowed on chain and there is no trading volume. Value locked (the escrowed
  // reward pools) is DefiLlama's (its PeddleQuest TVL adapter). Quests created, rewards funded and fees are read on
  // chain from PeddlesQuestEscrow, PeddlesPromotionMarket and PeddlesQuestBadge on all four chains, by the same scan
  // as Peddles; until that scan is complete, fees are DefiLlama's.
  const [tvl, fees] = await Promise.all([llama('tvl', 'peddlequest'), llama('fees', 'peddlequest')])
  const nowSec = Math.floor(Date.now() / 1000)
  const snap = onchainSnapshot()
  const oc = onchainOf(snap)
  const sum = (f) => snap.chains.reduce((a, c) => a + (c[f] ?? 0), 0)
  const notes = ['Quests, not trading: no volume, so it has no bars in the daily volume chart. Value locked is the reward pools escrowed on chain, read from DefiLlama (its PeddleQuest adapter), which lags by up to a day.']
  let feesAllUsd = fees.totalAllTime
  let divergenceNote = null
  if (oc.live) {
    feesAllUsd = sum('questFeesUsd')
    const df = divergence(feesAllUsd, fees.totalAllTime)
    if (df) {
      divergenceNote = `Our on-chain all-time fees (${fmtUsdPlain(df.ours)}) differ from DefiLlama's (${fmtUsdPlain(df.theirs)}) by ${pct(df.pct)}. Ours is shown.`
      console.warn(`[stats] peddlequest: ${divergenceNote}`)
      notes.push(divergenceNote)
    }
    notes.push(`Quests, rewards funded and fees are read on chain from PeddlesQuestEscrow, PeddlesPromotionMarket and PeddlesQuestBadge on ${chainList(snap.chains)}.`)
  } else notes.push('Fees are read from DefiLlama while the on-chain scan catches up.')
  const days = mergeDaily(snap.chains, [], nowSec, 'qf')
  const built = await buildSeries({
    fees: { own: days.onchainDays ? days.daily : [], ownSource: { name: oc.label, url: null }, llama: 'peddlequest' },
    tvl: { llama: 'peddlequest' },
  })
  notes.push(...built.notes)
  return {
    ...seriesFields(built),
    volume24hUsd: null,
    volumeAllUsd: null,
    volumeAllSince: null,
    tvlUsd: tvl.tvlUsd,
    fees24hUsd: fees.total24h,
    feesAllUsd,
    noVolume: true,
    counts: { quests: oc.live ? sum('quests') : null, questRewardsUsd: oc.live ? sum('questRewardsUsd') : null },
    onchain: { ...oc, divergence: divergenceNote, llamaFeesAllUsd: fees.totalAllTime },
    sourceNote: oc.live ? `value locked from DefiLlama · quests and fees ${oc.label}` : 'value locked and fees from DefiLlama',
    notes,
    source: { url: `${oc.live ? `on chain: ${chainList(snap.chains)} + ` : ''}${tvl.url} + ${fees.url}`, readAt: tvl.at ?? new Date().toISOString() },
  }
}

async function gullychain() {
  // Our own L3 testnet, read from its indexer (server/gully-chain.mjs): launches, graduations, holders and trades.
  // Every amount is in TEST ETH, which has no dollar value, so every USD field is null and nothing here enters the
  // totals or the stacked daily chart; the venue carries its own `native` figures and daily series instead.
  const f = await gullyLedger()
  const n = f.native
  return {
    volume24hUsd: null,
    volumeAllUsd: null,
    volumeAllSince: n.volumeAllSince,
    tvlUsd: null,
    fees24hUsd: null,
    feesAllUsd: null,
    daily: [],
    series: { volume: [], fees: [], tvl: [] },
    sources: { volume: { name: 'Gully Chain indexer (test ETH, not charted in dollars)', url: `${GULLY_CHAIN.indexer}/tokens`, fallback: false }, fees: null, tvl: null },
    lastActivity: f.lastActivity,
    native: { symbol: n.symbol, testnet: true, volume24h: n.volume24h, volumeAll: n.volumeAll, liquidity: n.liquidity, mcap: n.mcap, daily: n.daily },
    testnet: true,
    noUsd: true,
    counts: f.counts,
    chains: [{ chainId: GULLY_CHAIN.id, name: GULLY_CHAIN.name, testnet: true }],
    notes: [
      'Gully Chain Testnet: every figure is in test ETH, which has no dollar value, so nothing here is added to the totals or drawn in the dollar charts.',
      `${f.counts.launches} launchpad token${f.counts.launches === 1 ? '' : 's'} (${f.counts.graduated} graduated), ${f.counts.holders} holder balances and ${f.counts.swaps} trades, read from our own indexer at block ${f.head.block}.`,
    ],
    sourceNote: `Gully Chain indexer · block ${f.head.block}`,
    source: { url: `${GULLY_CHAIN.indexer}/tokens + ${GULLY_CHAIN.indexer}/head`, readAt: f.readAt },
  }
}

export const VENUES = [
  { key: 'peddleswap', read: peddleswap },
  { key: 'peddles', read: peddles },
  { key: 'peddlequest', read: peddlequest },
  { key: 'gullychain', read: gullychain },
]

let cache = null

/** Tests: forget the cached document and (unless documentOnly) every cached DefiLlama read. */
export function resetStatsForTest({ documentOnly = false } = {}) {
  cache = null
  if (documentOnly) return
  llamaCache.clear()
  llamaInflight.clear()
}

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
    lastActivity: ok.map((v) => v.lastActivity).filter(Boolean).sort().at(-1) ?? null,
    venues,
  }
  cache = { at: Date.now(), body }
  return body
}
