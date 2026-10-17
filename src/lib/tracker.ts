import { useEffect, useState } from 'react'

/* The /api/tracker document (server/tracker.mjs), typed. A price is a number or null (could not be
   read); `status` says which, so nothing on the page invents a value for a missing one. */

export type TrackerStatus = 'premium' | 'discount' | 'drifting' | 'in-line' | 'thin' | 'no-pool' | 'pool-unreadable' | 'feed-unreadable'

export interface TrackerPool {
  dex: string
  labels: string[]
  against: string
  url: string
  pair: string
  liquidityUsd: number
  volume24hUsd: number
  pools: number
  totalLiquidityUsd: number
  totalVolume24hUsd: number
}

export interface TrackerRow {
  chain: string
  ticker: string
  name: string
  token: string
  feed: string
  fair: number | null
  feedPrices: 'tokenized-instrument' | 'underlying-share'
  /** bStocks: raw token = multiplier shares (ERC-8056). null where the chain has none. */
  multiplier: number | null
  feedUpdatedAt: string | null
  feedError: string | null
  onchain: number | null
  gapPct: number | null
  status: TrackerStatus
  pool: TrackerPool | null
  poolError: string | null
  /** The pool read is the chain's last good one, served while the source is backing off. */
  poolStale?: boolean
}

export interface TrackerChain {
  key: string
  id: number
  name: string
  sessionOpen: boolean
  sessionName: string
  fairMethod: string
  poolsAsOf: string | null
  poolsStale: boolean
  /** Which source answered for the pool prices: DexScreener, or GeckoTerminal when it refused. */
  poolSource: string | null
}

export interface Tracker {
  generatedAt: string
  chains: TrackerChain[]
  rules: { minLiquidityUsd: number; inLinePct: number; flagPct: number }
  sources: { fair: string; onchain: string; tables: string[] }
  rows: TrackerRow[]
}

/** [unixSeconds, gapPct, onchain, fair] */
export type HistoryPoint = [number, number, number, number]

export type Load<T> = { k: 'loading' } | { k: 'error' } | { k: 'ok'; data: T }

const REFRESH_MS = 60_000

/** The tracker, refreshed every minute; a failed refresh keeps the last good read. */
export function useTracker(): Load<Tracker> {
  const [state, setState] = useState<Load<Tracker>>({ k: 'loading' })
  useEffect(() => {
    let alive = true
    const tick = () =>
      fetch('/api/tracker', { headers: { accept: 'application/json' } })
        .then((r) => (r.ok ? (r.json() as Promise<Tracker>) : Promise.reject(new Error(String(r.status)))))
        .then(
          (data) => alive && setState({ k: 'ok', data }),
          () => alive && setState((s) => (s.k === 'ok' ? s : { k: 'error' })),
        )
    tick()
    const id = setInterval(tick, REFRESH_MS)
    return () => {
      alive = false
      clearInterval(id)
    }
  }, [])
  return state
}

export function useHistory(chain: string | null, ticker: string | null): Load<HistoryPoint[]> {
  const key = chain && ticker ? `${chain}:${ticker}` : null
  // The answer is stored with the key it belongs to, so a new selection reads as loading without a
  // synchronous setState inside the effect.
  const [state, setState] = useState<{ key: string | null; load: Load<HistoryPoint[]> }>({ key: null, load: { k: 'loading' } })
  useEffect(() => {
    if (!key || !chain || !ticker) return
    let alive = true
    // Re-read every minute so the chart picks up each new five-minute reading; the state only
    // changes when a reading was added, and a failed re-read keeps the last good one.
    const tick = () =>
      fetch(`/api/tracker/history?chain=${encodeURIComponent(chain)}&ticker=${encodeURIComponent(ticker)}`)
        .then((r) => (r.ok ? (r.json() as Promise<{ points: HistoryPoint[] }>) : Promise.reject(new Error(String(r.status)))))
        .then(
          (d) =>
            alive &&
            setState((s) => {
              const prev = s.key === key && s.load.k === 'ok' ? s.load.data : null
              if (prev && prev.length === d.points.length && prev.at(-1)?.[0] === d.points.at(-1)?.[0]) return s
              return { key, load: { k: 'ok', data: d.points } }
            }),
          () => alive && setState((s) => (s.key === key && s.load.k === 'ok' ? s : { key, load: { k: 'error' } })),
        )
    tick()
    const id = setInterval(tick, REFRESH_MS)
    return () => {
      alive = false
      clearInterval(id)
    }
  }, [key, chain, ticker])
  return state.key === key ? state.load : { k: 'loading' }
}

/* /api/tracker/movers (server/movers.mjs): each trusted token's gap and price change over a window,
   from the tracker's own snapshots. Empty lists with a `note` when there is not enough history. */
export type MoverWindow = '1h' | '24h'

export interface Mover {
  chain: string
  ticker: string
  name: string
  token: string
  status: TrackerStatus
  gapPct: number
  onchain: number | null
  fair: number | null
  liquidityUsd: number | null
  gapThen: number
  gapNow: number
  /** Percentage points, now minus then. */
  gapChangePp: number
  onchainThen: number
  onchainNow: number
  priceChangePct: number | null
  from: string
  to: string
  /** [unixSeconds, gapPct], at most 48 points over the window. */
  spark: [number, number][]
}

export interface Movers {
  window: MoverWindow
  windowSeconds: number
  toleranceSeconds: number
  asOf: string | null
  from: string | null
  to: string | null
  eligible: number
  historyHours: number
  note: string | null
  limit: number
  chain: string | null
  byGap: Mover[]
  byPrice: Mover[]
  stock?: Mover | null
}

/** Top movers over one window, re-read every minute; a failed re-read keeps the last good answer. */
export function useMovers(window: MoverWindow, opts: { limit?: number; chain?: string; ticker?: string } = {}): Load<Movers> {
  const q = new URLSearchParams({ window, limit: String(opts.limit ?? 10) })
  if (opts.chain) q.set('chain', opts.chain)
  if (opts.ticker) q.set('ticker', opts.ticker)
  const key = q.toString()
  const [state, setState] = useState<{ key: string | null; load: Load<Movers> }>({ key: null, load: { k: 'loading' } })
  useEffect(() => {
    let alive = true
    const tick = () =>
      fetch(`/api/tracker/movers?${key}`, { headers: { accept: 'application/json' } })
        .then((r) => (r.ok ? (r.json() as Promise<Movers>) : Promise.reject(new Error(String(r.status)))))
        .then(
          (data) => alive && setState({ key, load: { k: 'ok', data } }),
          () => alive && setState((s) => (s.key === key && s.load.k === 'ok' ? s : { key, load: { k: 'error' } })),
        )
    tick()
    const id = setInterval(tick, REFRESH_MS)
    return () => {
      alive = false
      clearInterval(id)
    }
  }, [key])
  return state.key === key ? state.load : { k: 'loading' }
}

/** A change in percentage points, signed. */
export const fmtPp = (v: number | null) => (v === null ? '—' : `${v > 0 ? '+' : v < 0 ? '−' : '±'}${Math.abs(v).toFixed(2)} pp`)
export const fmtPct = (v: number | null) => (v === null ? '—' : `${v > 0 ? '+' : v < 0 ? '−' : '±'}${Math.abs(v).toFixed(2)}%`)

/** The post a visitor shares about the top movers, from the figures on screen. */
export function moversPost(m: Movers, mode: 'gap' | 'price'): string {
  const list = (mode === 'gap' ? m.byGap : m.byPrice).slice(0, 3)
  if (!list.length) return 'Live fair-price tracker for tokenised stocks by @Gully_Labs'
  const items = list.map((e) => (mode === 'gap' ? `$${e.ticker} ${fmtPp(e.gapChangePp).replace(' pp', 'pp')} (now ${fmtGap(e.gapNow)})` : `$${e.ticker} ${fmtPct(e.priceChangePct)}`))
  return `Biggest stock token ${mode === 'gap' ? 'gap moves vs fair price' : 'onchain price moves'}, last ${m.window}: ${items.join(' · ')}. Live tracker by @Gully_Labs`
}

export const fmtPrice = (v: number | null) =>
  v === null ? '—' : `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: v < 1 ? 4 : 2 })}`

export const fmtGap = (v: number | null) => (v === null ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(2)}%`)

export const fmtCompactUsd = (v: number | null | undefined) => {
  if (v === null || v === undefined) return '—'
  if (v >= 1e9) return `$${(v / 1e9).toFixed(2)}B`
  if (v >= 1e6) return `$${(v / 1e6).toFixed(2)}M`
  if (v >= 1e3) return `$${(v / 1e3).toFixed(1)}K`
  return `$${v.toFixed(0)}`
}

export const ageText = (iso: string | null, now: number) => {
  if (!iso) return '—'
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000))
  if (s < 90) return `${s}s ago`
  if (s < 5400) return `${Math.round(s / 60)}m ago`
  if (s < 172800) return `${Math.round(s / 3600)}h ago`
  return `${Math.round(s / 86400)}d ago`
}

/* Premium and discount use the CVD-safe pair (teal above, vermilion below), never red/green alone. */
/** The page of one stock token on one chain. */
export const stockPath = (r: { chain: string; ticker: string }) => `/tracker/${r.chain}/${r.ticker}`

export const UP = '#1f9e89'
export const DOWN = '#e4572e'

export const STATUS_LABEL: Record<TrackerStatus, string> = {
  premium: 'Premium',
  discount: 'Discount',
  drifting: 'Drifting',
  'in-line': 'In line',
  thin: 'Thin pool',
  'no-pool': 'No pool',
  'pool-unreadable': 'Pool unreadable',
  'feed-unreadable': 'Feed unreadable',
}

export const CHAIN_NAME: Record<string, string> = { robinhood: 'Robinhood Chain', bsc: 'BNB Chain' }
export const CHAIN_SHORT: Record<string, string> = { robinhood: 'Robinhood', bsc: 'BNB' }

/** The post a visitor shares about one token's gap. */
export function gapPost(r: TrackerRow): string {
  if (r.gapPct === null) return `${r.ticker} on Robinhood Chain: live fair-price check`
  const dir = r.gapPct >= 0 ? 'above' : 'below'
  return `$${r.ticker} token trades ${Math.abs(r.gapPct).toFixed(2)}% ${dir} its fair price on ${CHAIN_NAME[r.chain] ?? r.chain} (${fmtPrice(r.onchain)} vs ${fmtPrice(r.fair)}). Live tracker by @Gully_Labs`
}
