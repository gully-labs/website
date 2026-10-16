import { useMemo, useState } from 'react'
import { projects } from '../content/projects'
import { useCountUp } from '../hooks/useCountUp'
import { fmtDate, fmtDay, fmtTime, fmtUsd, nameOf, type Stats, type Venue, type VenueOk } from '../lib/stats'
import { EChart } from './charts/EChart'
import { esc, type ChartEvent } from './charts/chart-utils'
import { DataTable, EmptySeries, Segmented } from './LiveChart'

/* The ledger: one combined band across the five venues, then the venues' own series stacked.
   Everything is read from /api/stats; a venue that publishes no series is not drawn, and the
   provenance under each chart says so. Bars grow from the baseline, the underline sweeps on
   hover, tiles count up; all of it is off under prefers-reduced-motion (index.css). */

const names = (keys: string[]) => keys.map(nameOf).join(', ')
const accentOf = (key: string) => projects.find((p) => p.key === key)?.accent ?? '#e8c060'
const okOnly = (venues: Venue[]) => venues.filter((v): v is VenueOk => v.state === 'ok')

/* ------------------------------------------------------------------ KPIs --- */

function Kpi({ label, value, cover, gold, note, state, since }: { label: string; value: number | null; cover?: string[]; gold?: boolean; note?: React.ReactNode; state: 'loading' | 'error' | 'ok'; since?: string }) {
  const n = useCountUp(value ?? 0)
  const big = `font-display text-[clamp(40px,3.6cqw,56px)] leading-none font-extrabold tracking-[-.5px] ${gold ? 'text-gold' : 'text-ink'}`
  return (
    <div className="group relative flex flex-col gap-2 overflow-hidden bg-surface px-[26px] py-6">
      <div className="flex justify-between font-mono text-[12px] tracking-[1px] text-dim">
        <span>{label}</span>
        {cover && state === 'ok' && <span>{cover.length}/5</span>}
      </div>
      {state !== 'ok' || value === null ? (
        <div className={`${big} text-dim`}>—</div>
      ) : (
        // The final value is the accessible name; the counting text is presentation only, so a
        // copy of the tile carries the number once.
        <div className={big} role="img" aria-label={fmtUsd(value)} style={{ animation: 'gl-count-flash 1.6s ease both' }}>
          <span aria-hidden>{fmtUsd(n)}</span>
        </div>
      )}
      {since && state === 'ok' && value !== null && <div className="font-mono text-[11px] text-faint">{since}</div>}
      <div className="text-[13px] text-muted">
        {state === 'loading' ? (
          'Reading the venues…'
        ) : state === 'error' ? (
          <span className="text-error">Couldn't load. Try again.</span>
        ) : note ? (
          note
        ) : cover && cover.length ? (
          <>
            from <b className="font-medium text-ink-2">{names(cover)}</b>
          </>
        ) : (
          <span className="text-dim">No venue publishes this figure.</span>
        )}
      </div>
      <span aria-hidden className="absolute inset-x-0 bottom-0 h-[2px] origin-left scale-x-0 bg-gold transition-transform duration-300 group-hover:scale-x-100" />
    </div>
  )
}

export function LedgerBand({ data, state }: { data: Stats | null; state: 'loading' | 'error' | 'ok' }) {
  const T = data?.totals
  // The earliest day any venue's all-time count starts, so the headline says what "all-time" means.
  const since = data
    ? okOnly(data.venues)
        .map((v) => v.volumeAllSince)
        .filter((s): s is string => !!s)
        .sort()[0]
    : undefined
  const unread = T?.unread.length ? <span className="text-error">{names(T.unread)} could not be read</span> : undefined
  return (
    // Re-keyed on every read so the tiles count up again as the figures refresh.
    <div key={data?.generatedAt ?? 'none'} className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,220px),1fr))] gap-px overflow-hidden rounded-card border border-line bg-line">
      <Kpi label="VOLUME ALL-TIME" value={T?.volumeAllUsd ?? null} cover={T?.covers.volumeAllUsd} gold state={state} since={since ? `since ${fmtDate(since)}, the earliest a venue counts from` : undefined} />
      <Kpi label="VOLUME 24H" value={T?.volume24hUsd ?? null} cover={T?.covers.volume24hUsd} state={state} />
      <Kpi label="TOTAL VALUE LOCKED" value={T?.tvlUsd ?? null} cover={T?.covers.tvlUsd} state={state} />
      <Kpi
        label="FEES EARNED ALL-TIME"
        value={T?.feesAllUsd ?? null}
        cover={T?.covers.feesAllUsd}
        state={state}
        since={T && T.fees24hUsd !== null ? `24h ${fmtUsd(T.fees24hUsd)} · from ${names(T.covers.fees24hUsd)}` : undefined}
        note={unread ? <>from <b className="font-medium text-ink-2">{names(T?.covers.feesAllUsd ?? [])}</b> · {unread}</> : undefined}
      />
    </div>
  )
}

/* --------------------------------------------------- stacked daily volume --- */

export function StackedVolume({ data, state }: { data: Stats | null; state: 'loading' | 'error' | 'ok' }) {
  const [on, setOn] = useState<Record<string, boolean>>(() => Object.fromEntries(projects.map((p) => [p.key, true])))
  const [view, setView] = useState<'chart' | 'table'>('chart')
  const ok = data ? okOnly(data.venues) : []
  const byKey = Object.fromEntries(ok.map((v) => [v.key, v]))
  const withSeries = projects.filter((p) => (byKey[p.key]?.daily.length ?? 0) > 1).map((p) => p.key)
  const days = [...new Set(ok.flatMap((v) => v.daily.map((d) => d.t)))].sort((a, b) => a - b).slice(-14)
  // A day a venue did not report is null (no segment, "—" in the tooltip), never a zero.
  const valueOn = (key: string, t: number) => byKey[key]?.daily.find((d) => d.t === t)?.v ?? null
  const rows = days.map((t) => ({
    t,
    parts: projects.filter((p) => on[p.key] && byKey[p.key]).map((p) => ({ key: p.key, v: valueOn(p.key, t) })),
  }))
  const total = (r: (typeof rows)[number]) => r.parts.reduce((a, p) => a + (p.v ?? 0), 0)
  const drawn = projects.filter((p) => byKey[p.key]?.daily.length)
  const key = `${data?.generatedAt}|${days.join()}|${drawn.map((p) => p.key).join()}|${JSON.stringify(on)}`
  const option = useMemo(
    () => ({
      animationDuration: 900,
      animationEasing: 'cubicOut',
      animationDurationUpdate: 700,
      animationEasingUpdate: 'cubicInOut',
      // The venue chips above are the legend; this hidden one carries their on/off state so a toggle
      // restacks with animation instead of redrawing.
      legend: { show: false, selected: Object.fromEntries(drawn.map((p) => [p.key, on[p.key]])) },
      grid: { left: 0, right: 8, top: 10, bottom: 0, containLabel: true },
      xAxis: { type: 'category', data: days.map(fmtDay), axisLabel: { hideOverlap: true }, axisLine: { lineStyle: { color: '#2c3540' } } },
      yAxis: { type: 'value', splitNumber: 3, axisLabel: { formatter: (v: number) => fmtUsd(v).replace(/\.00$/, '') } },
      tooltip: {
        trigger: 'axis',
        confine: true,
        axisPointer: { type: 'shadow', shadowStyle: { color: 'rgba(166,176,189,.06)' } },
        formatter: (ps: ChartEvent[]) => {
          const t = days[ps[0]?.dataIndex]
          if (t === undefined) return ''
          const shown = drawn.filter((p) => on[p.key])
          const sum = shown.reduce((a, p) => a + (valueOn(p.key, t) ?? 0), 0)
          return `<div style="color:#6c7888">${fmtDay(t)}</div>${shown
            .map((p) => {
              const v = valueOn(p.key, t)
              return `<div><span style="color:${p.accent}">●</span> ${esc(p.name)} <b style="font-weight:500;color:${v === null ? '#6c7888' : '#e8c060'}">${v === null ? 'no reading' : fmtUsd(v)}</b></div>`
            })
            .join('')}<div>total <b style="font-weight:500;color:#e8c060">${fmtUsd(sum)}</b></div>`
        },
      },
      series: drawn.map((p, j) => ({
        id: p.key,
        name: p.key,
        type: 'bar',
        stack: 'volume',
        barCategoryGap: '22%',
        color: p.accent,
        data: days.map((t) => valueOn(p.key, t)),
        animationDelay: (i: number) => i * 35 + j * 60,
        emphasis: { focus: 'series' },
        blur: { itemStyle: { opacity: 0.35 } },
      })),
    }),
    // `key` holds the read, the days, the drawn venues and the toggles
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key],
  )

  let body: React.ReactNode
  if (state === 'loading') body = <p className="m-0 py-6 font-mono text-[12px] text-faint">Reading the venues…</p>
  else if (state === 'error' || !data) body = <p className="m-0 py-6 font-mono text-[12px] text-error">The venues could not be read. Try again.</p>
  else if (view === 'table')
    body = (
      <DataTable
        rows={[...rows].reverse()}
        cols={[
          { label: 'DAY', cell: (r) => fmtDay(r.t) },
          ...projects.map((p) => ({ label: p.name.toUpperCase(), cell: (r: (typeof rows)[number]) => { const x = r.parts.find((q) => q.key === p.key); return x && x.v !== null ? fmtUsd(x.v) : '—' } })),
          { label: 'TOTAL', cell: (r) => fmtUsd(total(r)) },
        ]}
      />
    )
  else if (days.length < 2) body = <EmptySeries n={days.length} />
  else
    body = (
      <EChart
        option={option}
        height={280}
        steps={{ count: days.length }}
        label={`Daily volume by venue, last ${days.length} days: ${rows.map((r) => `${fmtDay(r.t)} ${fmtUsd(total(r))}`).join(', ')}. Arrow keys step through days; the Table view lists every figure.`}
      >
        {/* A slow scan across the bars, so the chart reads as live even between refreshes. */}
        <div aria-hidden className="pointer-events-none absolute inset-y-0 left-0 w-1/3" style={{ background: 'linear-gradient(90deg,transparent,rgba(232,192,96,.06),transparent)', animation: 'gl-scan 5s 1s ease-in-out infinite' }} />
      </EChart>
    )

  return (
    // Not re-keyed on a read: the chart animates from the old figures to the new ones.
    <div className="flex min-w-0 flex-col gap-5 rounded-card border border-line bg-surface p-7">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h3 className="m-0 font-display text-[28px] font-bold uppercase">Volume by venue</h3>
          <span className="font-mono text-[12px] text-faint">
            Daily, last {days.length} days · {withSeries.length ? `${names(withSeries)} publish a series` : 'no venue publishes a series yet'}
          </span>
        </div>
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
      <div className="flex flex-wrap gap-2" role="group" aria-label="Venues shown">
        {projects.map((p) => (
          <button
            key={p.key}
            type="button"
            aria-pressed={on[p.key]}
            onClick={() => setOn((s) => ({ ...s, [p.key]: !s[p.key] }))}
            className={`inline-flex items-center gap-2 rounded-full border border-line bg-transparent px-3 py-[5px] font-mono text-[12px] text-ink-2 transition-opacity ${on[p.key] ? '' : 'opacity-40'}`}
          >
            <span aria-hidden className="size-[9px] rounded-full" style={{ background: p.accent }} />
            {p.name}
            {state === 'ok' && !withSeries.includes(p.key) ? ' · no series' : ''}
          </button>
        ))}
      </div>
      <div className="relative min-h-[280px]">{body}</div>
      {data && (
        <p className="m-0 font-mono text-[12px] leading-[1.5] text-faint">
          Read at {fmtTime(data.generatedAt)} from each venue's own API. A venue with no daily series is not drawn, not shown as zero.
          {data.totals.unread.length ? ` ${names(data.totals.unread)} could not be read.` : ''}
        </p>
      )}
    </div>
  )
}

/* ------------------------------------------------------------- TVL share --- */

export function TvlShare({ data, state }: { data: Stats | null; state: 'loading' | 'error' | 'ok' }) {
  const rows = data ? projects.map((p) => ({ key: p.key, v: okOnly(data.venues).find((v) => v.key === p.key)?.tvlUsd ?? null })).filter((r): r is { key: string; v: number } => r.v !== null) : []
  const total = rows.reduce((a, r) => a + r.v, 0)
  const missing = projects.filter((p) => !rows.some((r) => r.key === p.key)).map((p) => p.key)
  const key = rows.map((r) => `${r.key}=${r.v}`).join('|')
  // One track, one segment per venue: the segments sweep in from the left and re-share on refresh.
  const option = useMemo(
    () => ({
      animationDuration: 900,
      animationEasing: 'cubicOut',
      animationDurationUpdate: 700,
      animationEasingUpdate: 'cubicInOut',
      grid: { left: 0, right: 0, top: 2, bottom: 2 },
      xAxis: { type: 'value', show: false, min: 0, max: total || 1 },
      yAxis: { type: 'category', show: false, data: ['tvl'] },
      tooltip: {
        trigger: 'item',
        appendTo: 'body',
        formatter: (p: ChartEvent) => `<span style="color:${accentOf(p.seriesId)}">●</span> ${esc(nameOf(p.seriesId))} <b style="font-weight:500;color:#e8c060">${fmtUsd(p.value)}</b> · ${((p.value / total) * 100).toFixed(1)}%`,
      },
      series: rows.map((r, i) => ({
        id: r.key,
        type: 'bar',
        stack: 'tvl',
        barWidth: 14,
        color: accentOf(r.key),
        showBackground: i === 0,
        backgroundStyle: { color: '#1d232c', borderRadius: 7 },
        itemStyle: { borderRadius: rows.length === 1 ? 7 : i === 0 ? [7, 0, 0, 7] : i === rows.length - 1 ? [0, 7, 7, 0] : 0 },
        animationDelay: i * 90,
        emphasis: { focus: 'self' },
        blur: { itemStyle: { opacity: 0.4 } },
        data: [r.v],
      })),
    }),
    // `key` holds every venue's value
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key],
  )
  return (
    <div className="flex min-w-0 flex-col gap-5 self-stretch rounded-card border border-line bg-surface p-7">
      <div className="flex flex-col gap-1">
        <h3 className="m-0 font-display text-[28px] font-bold uppercase">Value locked</h3>
        <span className="font-mono text-[12px] text-faint">Share by venue, right now</span>
      </div>
      {state === 'loading' ? (
        <p className="m-0 py-6 font-mono text-[12px] text-faint">Reading the venues…</p>
      ) : state === 'error' || !data ? (
        <p className="m-0 py-6 font-mono text-[12px] text-error">The venues could not be read. Try again.</p>
      ) : total <= 0 ? (
        <p className="m-0 py-6 font-mono text-[12px] text-faint">Nothing to share out yet.</p>
      ) : (
        <>
          <EChart option={option} height={18} label={`Value locked by venue: ${rows.map((r) => `${nameOf(r.key)} ${((r.v / total) * 100).toFixed(1)}%`).join(', ')}`} />
          <div className="flex flex-col gap-[10px] text-[14px] text-muted">
            {rows.map((r) => (
              <span key={r.key} className="flex items-center gap-[10px]">
                <i aria-hidden className="size-[10px] rounded-full" style={{ background: accentOf(r.key) }} />
                {nameOf(r.key)}
                <span className="ml-auto font-mono text-[12px] text-dim">{fmtUsd(r.v)}</span>
                <b className="w-14 text-right font-mono font-medium text-ink">{((r.v / total) * 100).toFixed(1)}%</b>
              </span>
            ))}
          </div>
        </>
      )}
      {state === 'ok' && (
        <p className="m-0 mt-auto font-mono text-[12px] leading-[1.5] text-faint">
          {rows.length ? `${names(rows.map((r) => r.key))} publish value locked` : 'No venue publishes value locked'}
          {missing.length ? `; ${names(missing)} do not.` : '.'}
        </p>
      )}
    </div>
  )
}
