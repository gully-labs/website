import { Activity, ChartCandlestick, Waves } from 'lucide-react'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { AnimatedNumber } from '../../../components/charts/AnimatedNumber'
import { C } from '../../../components/charts/chartPresets'
import { NF } from '../../../components/charts/number-formats'
import { CHAIN_SHORT, fmtGap, useTracker } from '../../../lib/tracker'
import { Skeleton } from '../parts'
import { HBars, LiveMarker } from '../vcharts'
import { useHealthPings } from './health'
import { LineChart } from './LineChart'
import { StatusPill as KitPill } from '../../../components/ui/StatusPill'

/* The Overview's live market band: what is happening across Gully right now, so a brand-new workspace
   (no keys, no traffic yet) opens on live, moving charts instead of flat zeros. Every figure here is
   NETWORK data, labelled as such, never the workspace's own:
     Widest gaps   GET /api/tracker every 30 s, the widest trusted gaps on every chain (animated bars)
     Gap index     the average absolute gap of the 8 widest stock tokens over 24 h, in 30-minute buckets,
                   from GET /api/tracker/gap-index (one call, every 5 minutes), a line with hover tooltips
     API status    this browser's own round trip to GET /healthz every 5 s, as a live sparkline
   Gully Pay has no public network-wide volume, so it is not shown (never invented). */

const TOP = 8 // server/tracker.mjs GAP_INDEX_TOP
/** The band's mini chart height: three tiles in one ~140 px row. */
const MINI = 84

/** GET /api/tracker/gap-index: the server's 24h index of the TOP widest tokens (one call, cached there for a
    minute), re-read every five minutes; a failed re-read keeps the last good series. */
function useGapIndex(): { points: [number, number][]; top: number; state: 'loading' | 'ok' | 'error' } {
  const [s, setS] = useState<{ points: [number, number][]; top: number; state: 'loading' | 'ok' | 'error' }>({ points: [], top: TOP, state: 'loading' })
  useEffect(() => {
    let alive = true
    const read = () =>
      fetch('/api/tracker/gap-index')
        .then((r) => (r.ok ? (r.json() as Promise<{ points: [number, number][]; top: number }>) : Promise.reject(new Error(String(r.status)))))
        .then(
          (d) => alive && setS({ points: d.points, top: d.top, state: 'ok' }),
          () => alive && setS((p) => (p.state === 'ok' ? p : { ...p, state: 'error' })),
        )
    read()
    const id = setInterval(read, 5 * 60_000)
    return () => {
      alive = false
      clearInterval(id)
    }
  }, [])
  return s
}

/** A mini chart tile (~140 px): one header row (icon, title, live figure; the source as a tooltip), an optional
    one-line sub, the chart. */
function Tile({ icon, title, sub, figure, children, testId, onTitle }: { icon: ReactNode; title: string; sub: string; figure: ReactNode; children: ReactNode; testId: string; onTitle?: () => void }) {
  const name = (
    <>
      <span className="text-gold">{icon}</span>
      <span className="truncate">{title}</span>
    </>
  )
  return (
    <section className="flex min-w-0 flex-col gap-1 rounded-[12px] border border-line bg-surface px-3 py-2" aria-label={title} data-testid={testId} title={sub} style={{ animation: 'gl-fade .4s ease both' }}>
      <div className="flex min-h-7 items-center justify-between gap-2">
        {onTitle ? (
          <button type="button" onClick={onTitle} className="flex min-w-0 items-center gap-2 text-[13px] font-semibold text-ink hover:text-gold">
            {name}
          </button>
        ) : (
          <span className="flex min-w-0 items-center gap-2 text-[13px] font-semibold text-ink">{name}</span>
        )}
        <span className="shrink-0 text-right">{figure}</span>
      </div>
      {children}
    </section>
  )
}

export function MarketBand({ onPick }: { onPick?: () => void }) {
  const tr = useTracker(30_000)
  const rows = tr.k === 'ok' ? tr.data.rows : null
  const widest = useMemo(() => (rows ?? []).filter((r) => r.gapPct !== null && r.status !== 'thin').sort((a, b) => Math.abs(b.gapPct ?? 0) - Math.abs(a.gapPct ?? 0)), [rows])
  const index = useGapIndex()
  const pings = useHealthPings(5_000).slice(-36)
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
        <KitPill tone="live">NETWORK · LIVE</KitPill>
        <span className="font-mono text-[11px] text-faint">market data across Gully, not your account</span>
      </div>
      {/* 1 or 3 tiles a row by the band's own width (never 2 + 1). */}
      <div className="grid grid-cols-1 gap-3 @min-[820px]:grid-cols-3" data-testid="mk-grid">
        <Tile
          testId="mk-gaps"
          icon={<ChartCandlestick size={15} aria-hidden />}
          title="Widest gaps now"
          onTitle={onPick}
          sub={`Robinhood, BNB, Solana · every 30 s`}
          figure={widest[0] ? <AnimatedNumber value={widest[0].gapPct} format={NF.signed2} suffix="%" className="font-display text-[20px] leading-none font-bold text-gold" /> : <span className="font-mono text-[11px] text-faint">{tr.k === 'error' ? 'unreadable' : '…'}</span>}
        >
          {tr.k !== 'ok' ? (
            <Skeleton h={MINI} />
          ) : widest.length ? (
            <HBars
              rowH={22}
              minH={MINI}
              rows={widest.slice(0, 3).map((r) => ({ name: `${r.ticker} · ${CHAIN_SHORT[r.chain] ?? r.chain}`, value: +Math.abs(r.gapPct ?? 0).toFixed(2), color: (r.gapPct ?? 0) >= 0 ? '#20a0c4' : '#ff6b81', note: `${fmtGap(r.gapPct)} vs fair price` }))}
              unit="%"
              label={`Widest gaps now: ${widest.slice(0, 3).map((r) => `${r.ticker} ${fmtGap(r.gapPct)}`).join(', ')}.`}
            />
          ) : (
            <LiveMarker text="No trusted gap right now" height={MINI} />
          )}
        </Tile>

        <Tile
          testId="mk-index"
          icon={<Waves size={15} aria-hidden />}
          title="Gap index · 24h"
          sub={`average |gap|, ${index.top} widest stock tokens`}
          figure={indexNow !== null ? <AnimatedNumber value={indexNow} format={NF.fixed2} suffix="%" className="font-display text-[20px] leading-none font-bold" /> : <span className="font-mono text-[11px] text-faint">{index.state === 'error' ? 'unreadable' : '…'}</span>}
        >
          {index.points.length >= 2 ? (
            <LineChart points={index.points} color={C.gold} fmt={(v) => `${v.toFixed(2)}%`} label={`Average absolute gap of the ${index.top} widest stock tokens over 24 hours, now ${indexNow?.toFixed(2)}%.`} height={MINI} />
          ) : index.state === 'loading' ? (
            <Skeleton h={MINI} />
          ) : (
            <LiveMarker text="Not enough history for a series yet" height={MINI} />
          )}
        </Tile>

        <Tile
          testId="mk-status"
          icon={<Activity size={15} aria-hidden />}
          title="API status"
          sub="round trip from this browser · every 5 s"
          figure={down ? <span className="font-mono text-[12px] text-error">unreachable</span> : <AnimatedNumber value={lastMs} suffix=" ms" className="font-display text-[20px] leading-none font-bold text-green" />}
        >
          {okPings.length >= 2 ? (
            <LineChart points={okPings.map((p) => [p.t, p.ms])} color="#3ddc97" fmt={(v) => `${Math.round(v)} ms`} label={`API round trip from this browser, last ${okPings.length} checks, now ${lastMs ?? 'unknown'} ms.`} height={MINI} />
          ) : (
            <LiveMarker text={down ? 'GET /healthz did not answer' : 'Measuring the round trip…'} height={MINI} />
          )}
        </Tile>
      </div>
    </section>
  )
}
