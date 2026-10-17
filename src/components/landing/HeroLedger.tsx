import { useCallback, useMemo, useState } from 'react'
import { projects } from '../../content/projects'
import { fmtDay, fmtTime, fmtUsd, nameOf, type Stats, type VenueOk } from '../../lib/stats'
import { EChart } from '../charts/EChart'
import { esc, useReducedMotion, type ChartEvent } from '../charts/chart-utils'
import { Figure } from './Figure'

/* The hero's ledger card: three combined figures that count up, then the venues' own daily volume as
   stacked bars (ECharts, through the shared wrapper). Everything is read from /api/stats (useStats);
   nothing here is sample data. A venue that publishes no daily series is not drawn, and a day a venue
   did not report adds nothing to its stack and reads "no reading" in the tooltip, never zero. The chips
   are the legend: press one to hide that venue and the rest re-stack. A refresh merges into the live
   chart, so the bars move to their new heights instead of redrawing. */

type State = 'loading' | 'error' | 'ok'
type Range = 7 | 30
const okOnly = (data: Stats | null) => (data ? data.venues.filter((v): v is VenueOk => v.state === 'ok') : [])
const MONO = "'IBM Plex Mono', monospace"
const DAY = 86400

function Kpi({ label, span, value, cover, state }: { label: string; span?: string; value: number | null | undefined; cover?: string[]; state: State }) {
  const shown = state === 'ok' && value !== null && value !== undefined
  return (
    <div className="flex min-w-0 flex-col gap-[2px] border-r border-line px-4 py-3 last:border-r-0 max-[459px]:px-3">
      <span className="truncate font-mono text-[11px] tracking-[1px] text-faint">{label}</span>
      <b className={`font-display text-[30px] leading-none font-bold max-[459px]:text-[22px] ${shown ? 'text-ink' : 'text-dim'}`}>
        {shown ? <Figure value={value} /> : state === 'error' ? 'unreadable' : '—'}
      </b>
      <span className="truncate font-mono text-[11px] text-faint">
        {state === 'loading' ? 'reading…' : state === 'error' ? 'could not be read' : cover?.length ? (
          <>
            {span && <span className="max-[459px]:hidden">{span} · </span>}
            {cover.length}/{projects.length} venues
          </>
        ) : (
          'not published'
        )}
      </span>
    </div>
  )
}

export function HeroLedger({ data, state }: { data: Stats | null; state: State }) {
  const [hidden, setHidden] = useState<Record<string, boolean>>({})
  const [range, setRange] = useState<Range>(30)
  const reduced = useReducedMotion()
  // The bars are handed to the chart two frames after it exists. The wrapper's first ResizeObserver
  // pass calls resize(), which finishes any running animation at once; data that arrives after it
  // grows in as it should.
  const [armed, setArmed] = useState(false)
  const onChart = useCallback((c: unknown) => {
    if (!c) return setArmed(false)
    requestAnimationFrame(() => requestAnimationFrame(() => setArmed(true)))
  }, [])

  const ok = okOnly(data)
  const byKey = Object.fromEntries(ok.map((v) => [v.key, v]))
  const withSeries = projects.filter((p) => (byKey[p.key]?.daily.length ?? 0) > 1)
  const allDays = [...new Set(ok.flatMap((v) => v.daily.map((d) => d.t)))].sort((a, b) => a - b).slice(-30)
  // The range switch only appears when there is more than a week to show.
  const canRange = allDays.length > 7
  const days = canRange ? allDays.slice(-range) : allDays
  const D = days.length
  const valueOn = (key: string, t: number) => byKey[key]?.daily.find((d) => d.t === t)?.v ?? null
  const shown = withSeries.filter((p) => !hidden[p.key])
  const totals = days.map((t) => shown.reduce((a, p) => a + (valueOn(p.key, t) ?? 0), 0))
  const last = days[D - 1]
  // "LIVE" only when the last bar is the day of the read (UTC); otherwise it is the latest day read.
  const isToday = last !== undefined && !!data && Math.floor(Date.parse(data.generatedAt) / 1000 / DAY) === Math.floor(last / DAY)

  const key = `${data?.generatedAt}|${range}|${days.join()}|${withSeries.map((p) => p.key).join()}|${JSON.stringify(hidden)}|${reduced}|${armed}`
  const option = useMemo(
    () => ({
      animationDuration: 650,
      animationEasing: 'cubicOut',
      animationDurationUpdate: 650,
      animationEasingUpdate: 'cubicInOut',
      // The chips are the legend; this hidden one carries their on/off state, so a toggle re-stacks
      // with animation instead of redrawing.
      legend: { show: false, selected: Object.fromEntries(withSeries.map((p) => [p.key, !hidden[p.key]])) },
      grid: { left: 2, right: 10, top: 22, bottom: 2, containLabel: true },
      xAxis: { type: 'category', data: days.map(fmtDay), axisLabel: { hideOverlap: true }, axisLine: { lineStyle: { color: '#2c3540' } } },
      yAxis: { type: 'value', splitNumber: 3, axisLabel: { formatter: (v: number) => fmtUsd(v).replace(/\.00$/, '') } },
      tooltip: {
        trigger: 'axis',
        confine: true,
        axisPointer: {
          type: 'cross',
          crossStyle: { color: '#5c6878', type: 'dashed' },
          lineStyle: { color: '#5c6878', type: 'dashed' },
          label: {
            backgroundColor: '#1a2029',
            borderColor: '#2c3540',
            borderWidth: 1,
            color: '#eef0f2',
            fontFamily: MONO,
            fontSize: 11,
            formatter: (p: ChartEvent) => (p.axisDimension === 'y' ? fmtUsd(Number(p.value)) : p.value),
          },
        },
        formatter: (ps: ChartEvent[]) => {
          const i = ps[0]?.dataIndex
          const t = days[i]
          if (t === undefined) return ''
          const rows = shown
            .map((p) => {
              const v = valueOn(p.key, t)
              return `<div style="display:flex;gap:14px;justify-content:space-between"><span><span style="color:${p.accent}">■</span> ${esc(p.name)}</span><b style="font-weight:500;color:${v === null ? '#7f8b9c' : '#eef0f2'}">${v === null ? 'no reading' : fmtUsd(v)}</b></div>`
            })
            .join('')
          return `<div style="color:#8a96a6;margin-bottom:4px">${fmtDay(t)}${i === D - 1 && isToday ? ' · today, so far' : ''}</div>${rows || '<div style="color:#7f8b9c">every venue hidden</div>'}<div style="display:flex;gap:14px;justify-content:space-between;border-top:1px solid #2c3540;margin-top:4px;padding-top:4px"><span>day total</span><b style="font-weight:600;color:#e8c060">${fmtUsd(totals[i])}</b></div>`
        },
      },
      series: [
        ...withSeries.map((p, j) => ({
          id: p.key,
          name: p.key,
          type: 'bar',
          stack: 'volume',
          barCategoryGap: '30%',
          barMaxWidth: 26,
          color: p.accent,
          itemStyle: { borderRadius: 2 },
          data: days.map((t) => (armed ? valueOn(p.key, t) : null)),
          // Each venue's bars rise after the one below it, left to right.
          animationDelay: (i: number) => j * 160 + i * 14,
          emphasis: { focus: 'series' },
          blur: { itemStyle: { opacity: 0.35 } },
        })),
        {
          id: 'live',
          type: reduced ? 'scatter' : 'effectScatter',
          silent: true,
          tooltip: { show: false },
          z: 10,
          symbolSize: 7,
          color: '#6fcf6a',
          rippleEffect: { brushType: 'stroke', scale: 3.2, period: 2.2 },
          animationDelay: withSeries.length * 160 + 300,
          label: { show: true, position: 'top', distance: 8, formatter: isToday ? 'LIVE' : 'LATEST', color: '#6fcf6a', fontFamily: MONO, fontSize: 11, fontWeight: 600 },
          data: D && armed ? [[D - 1, totals[D - 1]]] : [],
        },
      ],
    }),
    // `key` holds the read, the range, the drawn venues, the toggles and the motion setting
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key],
  )

  const T = data?.totals
  let chart: React.ReactNode
  if (state === 'loading') chart = <div className="h-[230px] animate-pulse rounded-[8px] bg-surface-deep" />
  else if (state === 'error' || !data) chart = <p className="m-0 flex h-[230px] items-center justify-center font-mono text-[12px] text-error">The venues could not be read. Try again in a minute.</p>
  else if (D < 2 || !withSeries.length) chart = <p className="m-0 flex h-[230px] items-center justify-center px-4 text-center font-mono text-[12px] text-faint">No venue publishes a daily series yet, so there is nothing to stack.</p>
  else
    chart = (
      <EChart
        option={option}
        height={230}
        steps={{ count: D }}
        onChart={onChart}
        label={`Daily volume by venue, stacked, last ${D} days. ${days.map((t, i) => `${fmtDay(t)} ${fmtUsd(totals[i])}`).join(', ')}. Arrow keys step through the days.`}
      />
    )

  const seg = (on: boolean) => `min-h-11 min-w-11 rounded-[6px] px-[10px] font-mono text-[11px] transition-colors duration-200 ${on ? 'bg-gold text-bg' : 'bg-transparent text-muted hover:text-ink'}`

  return (
    <div className="min-w-0 overflow-hidden rounded-card border border-line bg-surface transition-[border-color] duration-300 hover:border-line-strong">
      <div className="grid grid-cols-3 border-b border-line">
        <Kpi label="VOLUME" span="all-time" value={T?.volumeAllUsd} cover={T?.covers.volumeAllUsd} state={state} />
        <Kpi label="VALUE LOCKED" value={T?.tvlUsd} cover={T?.covers.tvlUsd} state={state} />
        <Kpi label="FEES" span="all-time" value={T?.feesAllUsd} cover={T?.covers.feesAllUsd} state={state} />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-x-2 px-[14px] pt-1">
        <div className="flex flex-wrap gap-x-[6px]" role="group" aria-label="Venues in the chart">
          {projects.map((p) => {
            const has = withSeries.includes(p)
            const on = has && !hidden[p.key]
            return (
              <button
                key={p.key}
                type="button"
                aria-pressed={on}
                disabled={state === 'ok' && !has}
                title={state === 'ok' && !has ? `${p.name} publishes no daily series` : undefined}
                onClick={() => setHidden((h) => ({ ...h, [p.key]: !h[p.key] }))}
                className="group inline-flex min-h-11 items-center bg-transparent p-0 text-[12px] disabled:cursor-default"
              >
                {/* The button is 44 px tall for touch; the pill inside is the visible chip. */}
                <span className={`inline-flex min-h-[30px] items-center gap-[6px] rounded-full border px-[10px] transition-[color,opacity,border-color] duration-200 group-enabled:group-hover:border-line-hover ${on ? 'border-line-strong text-ink' : 'border-line text-faint opacity-55'}`}>
                  <span aria-hidden className={`size-2 rounded-[2px] transition-transform duration-200 ${on ? 'scale-100' : 'scale-75'}`} style={{ background: p.accent }} />
                  {p.name}
                </span>
              </button>
            )
          })}
        </div>
        {canRange && (
          <div role="group" aria-label="Range" className="flex gap-[2px] rounded-[8px] border border-line p-[2px]">
            {([7, 30] as Range[]).map((r) => (
              <button key={r} type="button" aria-pressed={range === r} onClick={() => setRange(r)} className={seg(range === r)}>
                {r}D
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="px-[6px] pt-[6px]">{chart}</div>
      <div className="flex flex-wrap justify-between gap-x-4 gap-y-1 px-4 pt-[6px] pb-3 font-mono text-[11px] text-faint">
        <span>Daily volume · last {D || '—'} days · press a venue to hide it</span>
        <span>
          {data ? `Live · read ${fmtTime(data.generatedAt)} from each venue's API` : 'Live from each venue’s API'}
          {T?.unread.length ? ` · ${T.unread.map(nameOf).join(', ')} unreadable` : ''}
        </span>
      </div>
    </div>
  )
}
