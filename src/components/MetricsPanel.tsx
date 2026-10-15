import { useState } from 'react'
import { useCountUp } from '../hooks/useCountUp'
import { useStats } from '../hooks/useStats'
import { fmtDay, fmtTime, fmtUsd, sourceHost, type Stats, type Venue } from '../lib/stats'
import { DailyLine, DataTable, nameOf, Segmented, VenueBars } from './LiveChart'
import { BlinkDot } from './ui'

const card = 'flex flex-1 flex-col gap-[10px] rounded-card border border-line bg-surface p-7'
const cardLabel = 'font-mono text-[12px] tracking-[1px]'
const bigValue = 'font-display text-[clamp(44px,4.6cqw,64px)] leading-none font-extrabold tracking-[-.5px]'

const names = (keys: string[]) => keys.map(nameOf).join(', ')

function Big({ value, gold = false }: { value: number | null; gold?: boolean }) {
  const n = useCountUp(value ?? 0)
  const cls = `${bigValue} ${gold ? 'text-gold' : ''}`
  if (value === null) return <div className={`${cls} text-dim`}>—</div>
  return (
    <div className={cls}>
      <span className="sr-only">{fmtUsd(value)}</span>
      <span aria-hidden>{fmtUsd(n)}</span>
    </div>
  )
}

/** Which venues a total covers, in words: a total is only honest with its coverage beside it. */
function Covers({ keys, extra }: { keys: string[]; extra?: string }) {
  return (
    <div className="flex flex-wrap gap-[10px] text-[14px] text-muted">
      {keys.length ? (
        <>
          <span className="font-mono text-dim">{keys.length} of 5 venues</span>
          <span>
            {names(keys)}
            {extra}
          </span>
        </>
      ) : (
        <span className="text-dim">No venue publishes this figure.</span>
      )}
    </div>
  )
}

function StatCard({ label, value, keys, gold, live, extra, state }: { label: string; value: number | null; keys: string[]; gold?: boolean; live?: boolean; extra?: string; state: 'loading' | 'error' | 'ok' }) {
  return (
    <div className={card}>
      <div className={`flex justify-between ${cardLabel}`}>
        <span className="text-dim">{label}</span>
        {live && (
          <span className="flex items-center gap-2 text-green">
            <BlinkDot color="green" />
            LIVE
          </span>
        )}
      </div>
      {state === 'ok' ? <Big value={value} gold={gold} /> : <div className={`${bigValue} text-dim`}>—</div>}
      {state === 'ok' ? (
        <Covers keys={keys} extra={extra} />
      ) : (
        <div className="text-[14px] text-muted">{state === 'loading' ? 'Reading the venues…' : <span className="text-error">Couldn't load. Try again.</span>}</div>
      )}
    </div>
  )
}

/** Home page totals: three count-up cards and the interactive chart, all from /api/stats. */
export function MetricsPanel() {
  const st = useStats()
  const d = st.k === 'ok' ? st.data : null
  const T = d?.totals
  const unread = T?.unread.length ? ` · ${names(T.unread)} unreadable` : ''
  return (
    <section aria-label="Totals across all projects" className="flex flex-wrap gap-5 px-page pb-24">
      <div className="flex min-w-0 flex-[1_1_320px] flex-col gap-5">
        <StatCard label="VOLUME 24H" value={T?.volume24hUsd ?? null} keys={T?.covers.volume24hUsd ?? []} live state={st.k} />
        <StatCard label="TOTAL VALUE LOCKED" value={T?.tvlUsd ?? null} keys={T?.covers.tvlUsd ?? []} gold state={st.k} />
        <StatCard label="FEES EARNED 24H" value={T?.fees24hUsd ?? null} keys={T?.covers.fees24hUsd ?? []} extra={unread} state={st.k} />
      </div>
      <TrendChart data={d} state={st.k} />
    </section>
  )
}

type Metric = 'daily' | 'vol' | 'tvl'
type View = 'chart' | 'table'

function TrendChart({ data, state }: { data: Stats | null; state: 'loading' | 'error' | 'ok' }) {
  const [metric, setMetric] = useState<Metric>('daily')
  const [view, setView] = useState<View>('chart')
  const daily = data?.daily.slice(-14) ?? []
  const venues = data?.venues ?? []
  const withSeries = venues.filter((v): v is Extract<Venue, { state: 'ok' }> => v.state === 'ok' && v.daily.length > 1).map((v) => v.key)
  const pick = (v: Venue) => (v.state === 'ok' ? (metric === 'tvl' ? v.tvlUsd : v.volume24hUsd) : null)
  const title = metric === 'daily' ? 'Volume, all projects' : metric === 'tvl' ? 'Value locked by venue' : 'Volume 24h by venue'
  const sub =
    metric === 'daily' ? `Daily, last ${daily.length} days · summed over the venues that publish a series` : metric === 'tvl' ? 'What each venue holds right now' : "Each venue's last 24 hours"

  let body: React.ReactNode
  if (state === 'loading') body = <p className="m-0 py-6 font-mono text-[12px] text-faint">Reading the venues…</p>
  else if (state === 'error' || !data) body = <p className="m-0 py-6 font-mono text-[12px] text-error">The venues could not be read. Try again.</p>
  else if (metric === 'daily')
    body =
      view === 'chart' ? (
        <DailyLine series={daily} label="Daily volume, all projects" />
      ) : (
        <DataTable rows={[...daily].reverse()} cols={[{ label: 'DAY', cell: (r) => fmtDay(r.t) }, { label: 'VOLUME', cell: (r) => fmtUsd(r.v) }]} />
      )
  else
    body =
      view === 'chart' ? (
        <VenueBars venues={venues} pick={pick} />
      ) : (
        <DataTable
          rows={venues}
          cols={[
            { label: 'VENUE', cell: (v) => nameOf(v.key) },
            { label: metric === 'tvl' ? 'TVL' : 'VOLUME 24H', cell: (v) => (v.state === 'ok' ? fmtUsd(pick(v)) : 'unreadable') },
            { label: 'SOURCE', cell: (v) => (v.state === 'ok' ? sourceHost(v.source.url) : v.error) },
          ]}
        />
      )

  const prov = !data
    ? ''
    : metric === 'daily'
      ? `Read at ${fmtTime(data.generatedAt)} from ${names(withSeries) || 'no venue'}; a venue with no daily series is left out of this line, not shown as zero.`
      : `Read at ${fmtTime(data.generatedAt)} from each venue's own API.${data.totals.unread.length ? ` ${names(data.totals.unread)} could not be read.` : ''}`

  return (
    <div className="flex min-w-0 flex-[2_1_560px] flex-col gap-5 rounded-card border border-line bg-surface p-7">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h3 className="m-0 font-display text-[28px] font-bold uppercase">{title}</h3>
          <span className="font-mono text-[12px] text-faint">{sub}</span>
        </div>
        <div className="flex flex-wrap gap-2">
          <Segmented
            label="Chart metric"
            value={metric}
            onChange={setMetric}
            options={[
              { id: 'daily', label: 'Daily' },
              { id: 'vol', label: 'By venue' },
              { id: 'tvl', label: 'TVL by venue' },
            ]}
          />
          <Segmented
            label="View"
            value={view}
            onChange={setView}
            options={[
              { id: 'chart', label: 'Chart' },
              { id: 'table', label: 'Table' },
            ]}
          />
        </div>
      </div>
      <div className="relative min-h-[260px]">{body}</div>
      {prov && <p className="m-0 font-mono text-[12px] leading-[1.5] text-faint">{prov}</p>}
    </div>
  )
}
