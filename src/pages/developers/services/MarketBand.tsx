import { Activity, ChartCandlestick, Rocket, Waves } from 'lucide-react'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { AnimatedNumber } from '../../../components/charts/AnimatedNumber'
import { C, sparklinePreset } from '../../../components/charts/chartPresets'
import { EChart } from '../../../components/charts/EChart'
import { NF } from '../../../components/charts/number-formats'
import { GapBars } from '../../../components/tracker/GapBars'
import { CHAIN_SHORT, fmtGap, type HistoryPoint, type TrackerRow, useTracker } from '../../../lib/tracker'
import { ago } from '../api'
import { Skeleton } from '../parts'
import { HBars, LiveMarker } from '../vcharts'
import { deepcoreColor, useLaunches } from './useDeepcore'

/* The Overview's live market band: what is happening across Gully right now, so a brand-new workspace
   (no keys, no traffic yet) opens on live, moving charts instead of flat zeros. Every figure here is
   NETWORK data, labelled as such, never the workspace's own:
     Widest gaps   GET /api/tracker every 30 s, the widest trusted gaps on every chain (animated bars)
     Gap index     the average absolute gap of the 12 widest stock tokens over 24 h, from each one's
                   GET /api/tracker/history (each token re-read every 5 minutes), a line with hover tooltips
     DeepCore      GET /api/deepcore/launches: launches in the last 24 h per chain, and the newest
     API status    this browser's own round trip to GET /healthz every 5 s, as a live sparkline
   Gully Pay has no public network-wide volume, so it is not shown (never invented). */

const TOP = 8
const hhmm = (t: number) => new Date(t).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false })
const idOf = (r: { chain: string; ticker: string }) => `${r.chain}:${r.ticker}`

/* Each token's history is read at most once per HISTORY_TTL per page (shared by every mount of the band),
   so the band costs a handful of calls when it opens and none when the widest set reshuffles or the page
   is revisited: the index is in 30-minute buckets, and the anonymous API limit is per IP. */
const HISTORY_TTL = 5 * 60_000
const histories = new Map<string, { at: number; read: Promise<HistoryPoint[] | null> }>()
function readHistory(id: string): Promise<HistoryPoint[] | null> {
  const hit = histories.get(id)
  if (hit && Date.now() - hit.at < HISTORY_TTL) return hit.read
  const [chain, ticker] = id.split(':')
  const read = fetch(`/api/tracker/history?chain=${encodeURIComponent(chain)}&ticker=${encodeURIComponent(ticker)}`)
    .then((r) => (r.ok ? (r.json() as Promise<{ points: HistoryPoint[] }>) : null))
    .then((d) => d?.points ?? null)
    .catch(() => null)
  histories.set(id, { at: Date.now(), read })
  // A failed read is not kept: the next refresh asks again.
  void read.then((v) => v === null && histories.get(id)?.read === read && histories.delete(id))
  return read
}

/** Average |gap| per 30-minute bucket over the last 24 h, across the given tokens' histories. */
function useGapIndex(rows: TrackerRow[] | null): { points: [number, number][]; state: 'loading' | 'ok' | 'error' } {
  const ids = useMemo(
    () =>
      (rows ?? [])
        .filter((r) => r.gapPct !== null && r.status !== 'thin')
        .sort((a, b) => Math.abs(b.gapPct ?? 0) - Math.abs(a.gapPct ?? 0))
        .slice(0, TOP)
        .map(idOf)
        .sort()
        .join(','),
    [rows],
  )
  const [s, setS] = useState<{ ids: string; points: [number, number][]; state: 'loading' | 'ok' | 'error' }>({ ids: '', points: [], state: 'loading' })
  useEffect(() => {
    if (!ids) return
    let alive = true
    const read = async () => {
      const lists = await Promise.all(ids.split(',').map(readHistory))
      if (!alive) return
      const since = Date.now() / 1000 - 86_400
      const buckets = new Map<number, { sum: number; n: number }>()
      for (const pts of lists)
        for (const p of pts ?? []) {
          if (p[0] < since || !Number.isFinite(p[1])) continue
          const b = Math.floor(p[0] / 1800) * 1800
          const cur = buckets.get(b) ?? { sum: 0, n: 0 }
          cur.sum += Math.abs(p[1])
          cur.n++
          buckets.set(b, cur)
        }
      const points = [...buckets.entries()].sort((a, b) => a[0] - b[0]).map(([t, v]) => [t * 1000, +(v.sum / v.n).toFixed(3)] as [number, number])
      setS({ ids, points, state: lists.some(Boolean) ? 'ok' : 'error' })
    }
    read()
    const id = setInterval(read, HISTORY_TTL)
    return () => {
      alive = false
      clearInterval(id)
    }
  }, [ids])
  return s.ids === ids ? s : { points: [], state: 'loading' }
}

type Ping = { t: number; ms: number | null }

/** This browser's round trip to GET /healthz, every 5 s while the tab is visible (the last 36). */
function useLatency(): Ping[] {
  const [pings, setPings] = useState<Ping[]>([])
  useEffect(() => {
    let alive = true
    const ping = () => {
      if (document.visibilityState === 'hidden') return
      const t0 = performance.now()
      fetch('/healthz', { cache: 'no-store' })
        .then((r) => (r.ok ? performance.now() - t0 : null))
        .catch(() => null)
        .then((ms) => alive && setPings((p) => [...p, { t: Date.now(), ms: ms === null ? null : Math.round(ms) }].slice(-36)))
    }
    ping()
    const id = setInterval(ping, 5_000)
    return () => {
      alive = false
      clearInterval(id)
    }
  }, [])
  return pings
}

function Tile({ icon, title, sub, figure, children, testId }: { icon: ReactNode; title: string; sub: string; figure: ReactNode; children: ReactNode; testId: string }) {
  return (
    <section className="flex min-w-0 flex-col gap-2 rounded-[14px] border border-line bg-surface p-4" aria-label={title} data-testid={testId} style={{ animation: 'gl-fade .4s ease both' }}>
      <div className="flex items-start justify-between gap-2">
        <span className="flex min-w-0 flex-col gap-[2px]">
          <span className="flex items-center gap-2 text-[13px] font-semibold text-ink">
            <span className="text-gold">{icon}</span>
            {title}
          </span>
          <span className="truncate font-mono text-[11px] text-faint">{sub}</span>
        </span>
        <span className="shrink-0 text-right">{figure}</span>
      </div>
      {children}
    </section>
  )
}

function LineChart({ points, color, fmt, label, height = 120 }: { points: [number, number][]; color: string; fmt: (v: number) => string; label: string; height?: number }) {
  const key = points.map((p) => p.join(':')).join(',')
  const option = useMemo(
    () => sparklinePreset({ data: points.map((p) => p[1]), labels: points.map((p) => hhmm(p[0])), color, fmt }),
    // `key` is the series by value
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key, color],
  )
  return <EChart option={option} height={height} skeleton="line" label={label} />
}

export function MarketBand({ onPick }: { onPick?: () => void }) {
  const tr = useTracker(30_000)
  const rows = tr.k === 'ok' ? tr.data.rows : null
  const widest = useMemo(() => (rows ?? []).filter((r) => r.gapPct !== null && r.status !== 'thin').sort((a, b) => Math.abs(b.gapPct ?? 0) - Math.abs(a.gapPct ?? 0)), [rows])
  const index = useGapIndex(rows)
  const dc = useLaunches()
  const pings = useLatency()
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(id)
  }, [])

  const d = dc.k === 'ok' && dc.data.state !== 'unreadable' ? dc.data : null
  const day = d ? d.launches.filter((l) => now - Date.parse(l.createdAt) <= 86_400_000) : []
  const perChain = d ? [...new Map(d.launches.map((l) => [l.chainId, l.chainName])).entries()].map(([id, name]) => ({ name, value: day.filter((l) => l.chainId === id).length, color: deepcoreColor(id) })) : []
  const newest = d?.launches[0]
  const lastMs = [...pings].reverse().find((p) => p.ms !== null)?.ms ?? null
  const okPings = pings.filter((p) => p.ms !== null) as { t: number; ms: number }[]
  const down = pings.length > 0 && pings[pings.length - 1].ms === null
  const indexNow = index.points.at(-1)?.[1] ?? null

  return (
    <section aria-labelledby="mk-title" className="@container flex flex-col gap-3" data-testid="market-band">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h2 id="mk-title" className="m-0 text-[15px] font-semibold text-ink">
          Live across Gully
        </h2>
        <span className="inline-flex items-center gap-2 rounded-full border border-line-strong px-[10px] py-[2px] font-mono text-[11px] text-ink-2">
          <span className="relative grid size-2 place-items-center" aria-hidden>
            <span className="absolute size-2 rounded-full bg-green/50" style={{ animation: 'gl-live-pulse 2.4s ease-out infinite' }} />
            <span className="size-[6px] rounded-full bg-green" />
          </span>
          NETWORK · LIVE
        </span>
        <span className="font-mono text-[11px] text-faint">market data across Gully, not your account</span>
      </div>
      {/* 1, 2 or 4 tiles a row by the band's own width (never 3 + 1). */}
      <div className="grid grid-cols-1 gap-3 @min-[560px]:grid-cols-2 @min-[1060px]:grid-cols-4" data-testid="mk-grid">
        <Tile
          testId="mk-gaps"
          icon={<ChartCandlestick size={15} aria-hidden />}
          title="Widest gaps now"
          sub={`Robinhood, BNB, Solana · every 30 s`}
          figure={widest[0] ? <AnimatedNumber value={widest[0].gapPct} format={NF.signed2} suffix="%" className="font-display text-[22px] leading-none font-bold text-gold" /> : <span className="font-mono text-[11px] text-faint">{tr.k === 'error' ? 'unreadable' : '…'}</span>}
        >
          {tr.k !== 'ok' ? <Skeleton h={150} /> : widest.length ? <GapBars rows={widest.slice(0, 6)} inLinePct={tr.data.rules.inLinePct} selected={null} onSelect={() => onPick?.()} /> : <LiveMarker text="No trusted gap right now" height={150} />}
          {widest[0] && <span className="truncate font-mono text-[11px] text-faint">{`widest: ${widest[0].ticker} on ${CHAIN_SHORT[widest[0].chain] ?? widest[0].chain}, ${fmtGap(widest[0].gapPct)}`}</span>}
        </Tile>

        <Tile
          testId="mk-index"
          icon={<Waves size={15} aria-hidden />}
          title="Gap index · 24h"
          sub={`average |gap|, ${TOP} widest stock tokens`}
          figure={indexNow !== null ? <AnimatedNumber value={indexNow} format={NF.fixed2} suffix="%" className="font-display text-[22px] leading-none font-bold" /> : <span className="font-mono text-[11px] text-faint">{index.state === 'error' ? 'unreadable' : '…'}</span>}
        >
          {index.points.length >= 2 ? (
            <LineChart points={index.points} color={C.gold} fmt={(v) => `${v.toFixed(2)}%`} label={`Average absolute gap of the ${TOP} widest stock tokens over 24 hours, now ${indexNow?.toFixed(2)}%.`} height={150} />
          ) : index.state === 'loading' ? (
            <Skeleton h={150} />
          ) : (
            <LiveMarker text="Not enough history for a series yet" height={150} />
          )}
        </Tile>

        <Tile
          testId="mk-deepcore"
          icon={<Rocket size={15} aria-hidden />}
          title="DeepCore launches · 24h"
          sub="per chain, from DeepCore's indexer"
          figure={d ? <AnimatedNumber value={day.length} className="font-display text-[22px] leading-none font-bold" /> : <span className="font-mono text-[11px] text-faint">{dc.k === 'loading' ? '…' : 'unreadable'}</span>}
        >
          {!d ? dc.k === 'loading' ? <Skeleton h={120} /> : <LiveMarker text="The launch list is unreadable right now" height={120} /> : perChain.length ? <HBars rows={perChain} label={`DeepCore launches in the last 24 hours: ${perChain.map((c) => `${c.name} ${c.value}`).join(', ')}.`} /> : <LiveMarker text="Watching DeepCore for launches" height={120} />}
          {newest && (
            <span key={newest.key} className="flex min-w-0 items-center gap-2 font-mono text-[11px] text-ink-2" style={{ animation: 'gl-fade .5s ease both' }} data-testid="mk-newest">
              <span className="size-[6px] shrink-0 rounded-full" style={{ background: deepcoreColor(newest.chainId) }} aria-hidden />
              <span className="truncate">
                newest: <b className="font-medium text-ink">{newest.symbol ?? newest.token.slice(0, 8)}</b> on {newest.chainName}, {ago(newest.createdAt)}
              </span>
            </span>
          )}
        </Tile>

        <Tile
          testId="mk-status"
          icon={<Activity size={15} aria-hidden />}
          title="API status"
          sub="round trip from this browser · every 5 s"
          figure={down ? <span className="font-mono text-[12px] text-error">unreachable</span> : <AnimatedNumber value={lastMs} suffix=" ms" className="font-display text-[22px] leading-none font-bold text-green" />}
        >
          {okPings.length >= 2 ? (
            <LineChart points={okPings.map((p) => [p.t, p.ms])} color="#6fcf6a" fmt={(v) => `${Math.round(v)} ms`} label={`API round trip from this browser, last ${okPings.length} checks, now ${lastMs ?? 'unknown'} ms.`} height={150} />
          ) : (
            <LiveMarker text={down ? 'GET /healthz did not answer' : 'Measuring the round trip…'} height={150} />
          )}
        </Tile>
      </div>
    </section>
  )
}
