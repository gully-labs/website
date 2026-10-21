import { useCallback, useMemo, useState } from 'react'
import { projects } from '../../content/projects'
import { fmtDate, fmtDay, fmtUsd, sourceHost, type Metric, type Stats, type VenueOk } from '../../lib/stats'
import { autoMetric, emptyLine, hasData, lastActive, METRIC_LABEL, METRICS, pointsOf, valueOn, windowDays, type Range } from '../../lib/ledgerSeries'
import { EChart } from '../charts/EChart'
import { GhostChart } from '../charts/GhostChart'
import { esc, useReducedMotion, type ChartEvent } from '../charts/chart-utils'
import { CHART_H, C } from '../charts/chartPresets'
import { VenueLogo } from '../logos/VenueLogo'
import { segBtn, segGroup } from '../ui/seg'

/* The hero ledger's chart: one component for the three things the venues report every day.
   Value locked, Volume and Fees are tabs; the venues are toggles (with their logos) that re-stack the chart.
   The metric opens on whichever has real numbers in the window (volume when trades happened, else value
   locked, else fees) and moves to Volume by itself when trading resumes; once the visitor picks a tab
   it stays for the session. When the chosen metric is zero for the whole window there is no axis and no
   flat line: a ghost shape, badged as not data, and the honest sentence with the date of the last trade.
   The data is the live /api/stats document (useStats polls it every 60 s); a refresh merges into the
   chart, so the marks glide to their new heights instead of redrawing. Nothing here is sample data. */

type State = 'loading' | 'error' | 'ok'
const okOnly = (data: Stats | null) => (data ? data.venues.filter((v): v is VenueOk => v.state === 'ok') : [])
const MONO = "'IBM Plex Mono', monospace"
const DAY = 86400
const STORE = 'gl-ledger-metric'
const NOUN: Record<Metric, string> = { tvl: 'Value locked by day', volume: 'Daily volume', fees: 'Daily fees' }

const readPicked = (): Metric | null => {
  try {
    const v = sessionStorage.getItem(STORE)
    return v === 'tvl' || v === 'volume' || v === 'fees' ? v : null
  } catch {
    return null
  }
}
const savePicked = (m: Metric) => {
  try {
    sessionStorage.setItem(STORE, m)
  } catch {
    /* private window: the choice lasts for this view only */
  }
}

export function LedgerChart({ data, state }: { data: Stats | null; state: State }) {
  const [hidden, setHidden] = useState<Record<string, boolean>>({})
  const [pickedMetric, setPickedMetric] = useState<Metric | null>(readPicked)
  const [pickedRange, setPickedRange] = useState<Range | null>(null)
  const reduced = useReducedMotion()
  // The marks are handed to the chart two frames after it exists. The wrapper's first ResizeObserver pass
  // calls resize(), which finishes any running animation at once; data that arrives after it grows in.
  const [armed, setArmed] = useState(false)
  const onChart = useCallback((c: unknown) => {
    if (!c) return setArmed(false)
    requestAnimationFrame(() => requestAnimationFrame(() => setArmed(true)))
  }, [])

  const ok = okOnly(data)
  const range: Range = pickedRange ?? 7
  const auto = autoMetric(ok, range)
  const metric: Metric = pickedMetric ?? auto
  const longest = Math.max(0, ...ok.map((v) => pointsOf(v, metric).length))
  const canRange = longest > 7
  const all = windowDays(ok, metric, canRange ? range : 7)
  // Leading days nobody has a reading for are not days of the chart.
  const firstRead = all.findIndex((t) => ok.some((v) => valueOn(v, metric, t) !== null))
  const days = firstRead < 0 ? [] : all.slice(firstRead)
  const D = days.length
  const withSeries = projects.filter((p) => pointsOf(byKey(ok, p.key), metric).length > 0)
  const shown = withSeries.filter((p) => !hidden[p.key])
  const shownVenues = shown.map((p) => byKey(ok, p.key))
  const grid = shown.map((p) => days.map((t) => valueOn(byKey(ok, p.key), metric, t)))
  const totals = days.map((_, i) => grid.reduce((a, col) => a + (col[i] ?? 0), 0))
  const last = days[D - 1]
  // "LIVE" only when the newest day is the day of the read (UTC); otherwise it is the latest day read.
  const isToday = last !== undefined && !!data && Math.floor(Date.parse(data.generatedAt) / 1000 / DAY) === Math.floor(last / DAY)
  const flows = metric !== 'tvl'
  const totalWord = flows ? 'day total' : 'total locked'

  const key = `${metric}|${D}|${days[0]}|${shown.map((p) => p.key).join()}|${JSON.stringify(grid)}|${isToday}|${reduced}|${armed}`
  const option = useMemo(
    () => ({
      animationDuration: 650,
      animationEasing: 'cubicOut',
      animationDurationUpdate: 650,
      animationEasingUpdate: 'cubicInOut',
      grid: { left: 2, right: 10, top: 22, bottom: 2, containLabel: true },
      xAxis: { type: 'category', boundaryGap: flows, data: days.map(fmtDay), axisLabel: { hideOverlap: true }, axisLine: { lineStyle: { color: C.lineStrong } } },
      // The axis is scaled by the real values only: from zero to what the venues reported.
      yAxis: { type: 'value', min: 0, splitNumber: 3, axisLabel: { formatter: (v: number) => fmtUsd(v).replace(/\.00$/, '') } },
      tooltip: {
        trigger: 'axis',
        confine: true,
        axisPointer: {
          type: 'cross',
          crossStyle: { color: C.axis, type: 'dashed' },
          lineStyle: { color: C.axis, type: 'dashed' },
          label: {
            backgroundColor: C.grid,
            borderColor: C.lineStrong,
            borderWidth: 1,
            color: C.ink,
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
            .map((p, j) => {
              const v = grid[j][i]
              return `<div style="display:flex;gap:14px;justify-content:space-between"><span><span style="color:${p.accent}">■</span> ${esc(p.name)}</span><b style="font-weight:500;color:${v === null ? C.faint : C.ink}">${v === null ? 'no reading' : fmtUsd(v)}</b></div>`
            })
            .join('')
          return `<div style="color:#949daa;margin-bottom:4px">${fmtDay(t)}${i === D - 1 && isToday ? ' · today, so far' : ''}</div>${rows || '<div style="color:#8a94a1">every venue hidden</div>'}<div style="display:flex;gap:14px;justify-content:space-between;border-top:1px solid #2a3542;margin-top:4px;padding-top:4px"><span>${totalWord}</span><b style="font-weight:600;color:#d9b563">${fmtUsd(totals[i])}</b></div>`
        },
      },
      series: [
        ...shown.map((p, j) => ({
          id: `${metric}-${p.key}`,
          name: p.key,
          type: flows ? 'bar' : 'line',
          stack: metric,
          ...(flows
            ? { barCategoryGap: '30%', barMaxWidth: 26, itemStyle: { borderRadius: 2, color: p.accent } }
            : { smooth: 0.2, symbol: 'none', connectNulls: true, lineStyle: { width: 1.6, color: p.accent }, itemStyle: { color: p.accent }, areaStyle: { color: p.accent, opacity: 0.22 } }),
          color: p.accent,
          data: grid[j].map((v) => (armed ? v : null)),
          // Each venue's marks rise after the one below it, left to right.
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
          color: C.green,
          rippleEffect: { brushType: 'stroke', scale: 3.2, period: 2.2 },
          animationDelay: shown.length * 160 + 300,
          label: { show: true, position: 'top', distance: 8, formatter: isToday ? 'LIVE' : 'LATEST', color: C.green, fontFamily: MONO, fontSize: 11, fontWeight: 600 },
          data: D && armed ? [[D - 1, totals[D - 1]]] : [],
        },
      ],
    }),
    // `key` holds the metric, the window, the drawn venues, their values, the toggles and the motion setting
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key],
  )

  const pick = (m: Metric) => {
    setPickedMetric(m)
    savePicked(m)
  }
  const onTabKey = (e: React.KeyboardEvent) => {
    const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0
    if (!step) return
    e.preventDefault()
    const next = METRICS[(METRICS.indexOf(metric) + step + METRICS.length) % METRICS.length]
    pick(next)
    document.getElementById(`ledger-tab-${next}`)?.focus()
  }

  // Which source drew which venue's series, for the line under the chart (full detail in its title).
  const srcOf = (v: VenueOk) => v.sources?.[metric] ?? null
  const bySource = new Map<string, string[]>()
  for (const p of shown) {
    const s = srcOf(byKey(ok, p.key))
    const label = s ? (s.fallback ? 'DefiLlama' : s.name) : null
    if (label) bySource.set(label, [...(bySource.get(label) ?? []), p.name])
  }
  const sourceLine = [...bySource.entries()].map(([s, names]) => (bySource.size > 1 ? `${s} (${names.join(', ')})` : s)).join(' · ')
  const sourceTitle = shown
    .map((p) => {
      const s = srcOf(byKey(ok, p.key))
      return s ? `${p.name}: ${s.name}${s.url ? ` (${sourceHost(s.url)})` : ''}${s.fallback ? ', fallback: the venue publishes no history of its own' : ''}` : null
    })
    .filter(Boolean)
    .join('\n')

  const H = CHART_H.md
  const panelId = 'ledger-panel'
  let chart: React.ReactNode
  if (state === 'loading') chart = <div className="h-[220px] gl-skeleton rounded-tile bg-surface-deep" />
  else if (state === 'error' || !data) chart = <p className="m-0 flex h-[220px] items-center justify-center font-mono text-[12px] text-error">The venues could not be read. Try again in a minute.</p>
  else if (!withSeries.length || D < 1) chart = <GhostChart label={`No venue publishes a daily ${METRIC_LABEL[metric].toLowerCase()} series yet`} height={H} testId="ledger-ghost" />
  else if (!shown.length) chart = <GhostChart label="Every venue is hidden. Press one to show it." height={H} badge={false} testId="ledger-ghost" />
  else if (!hasData(shownVenues, metric, days)) {
    const t = lastActive(shownVenues, metric)
    chart = <GhostChart label={emptyLine(metric, D, t, (s) => fmtDate(new Date(s * 1000).toISOString()))} height={H} badge="NO DATA IN THIS WINDOW · SHAPE ONLY" testId="ledger-ghost" />
  } else
    chart = (
      <EChart
        option={option}
        height={H}
        steps={{ count: D, seriesIndex: 0 }}
        onChart={onChart}
        label={`${NOUN[metric]} by venue, stacked, last ${D} days. ${days.map((t, i) => `${fmtDay(t)} ${fmtUsd(totals[i])}`).join(', ')}. Arrow keys step through the days.`}
      />
    )

  return (
    <div data-testid="ledger-chart" data-metric={metric} data-auto={pickedMetric ? 'false' : 'true'}>
      <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-0 px-[14px] pt-1">
        <div role="tablist" aria-label="Metric" onKeyDown={onTabKey} className={segGroup}>
          {METRICS.map((m) => (
            <button
              key={m}
              id={`ledger-tab-${m}`}
              type="button"
              role="tab"
              aria-selected={metric === m}
              aria-controls={panelId}
              tabIndex={metric === m ? 0 : -1}
              disabled={state === 'loading'}
              onClick={() => pick(m)}
              className={`${segBtn(metric === m)} px-2.5`}
            >
              {METRIC_LABEL[m]}
            </button>
          ))}
        </div>
        {(canRange || state === 'loading') && (
          <div role="group" aria-label="Range" className={segGroup}>
            {([7, 30] as Range[]).map((r) => (
              <button key={r} type="button" aria-pressed={range === r} disabled={state === 'loading'} onClick={() => setPickedRange(r)} className={`${segBtn(range === r)} min-w-11`}>
                {r}D
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="flex flex-wrap gap-x-[6px] px-[14px]" role="group" aria-label="Venues in the chart">
        {projects.map((p) => {
          const v = ok.find((x) => x.key === p.key)
          const has = withSeries.includes(p)
          const on = has && !hidden[p.key]
          // A venue that cannot supply this metric is a legend entry that says so, not a dimmed dead button.
          if (state === 'ok' && !has)
            return (
              <span key={p.key} title={v ? `${p.name} publishes no daily ${METRIC_LABEL[metric].toLowerCase()} series` : `${p.name} could not be read`} className="inline-flex min-h-11 items-center text-[12px]">
                <span className="inline-flex min-h-[30px] items-center gap-[6px] rounded-full border border-dashed border-line px-[10px] text-muted">
                  <span className="opacity-60">
                    <VenueLogo venue={p.key} name={p.name} size={16} decorative />
                  </span>
                  {p.name}
                  <span className="font-mono text-[11px] text-faint">{v ? `no ${metric === 'tvl' ? 'TVL' : metric}` : 'unreadable'}</span>
                </span>
              </span>
            )
          return (
            <button
              key={p.key}
              type="button"
              aria-pressed={on}
              disabled={state !== 'ok'}
              onClick={() => setHidden((h) => ({ ...h, [p.key]: !h[p.key] }))}
              className="group inline-flex min-h-11 items-center bg-transparent p-0 text-[12px] disabled:cursor-default"
            >
              {/* The button is 44 px tall for touch; the pill inside is the visible chip. */}
              <span className={`inline-flex min-h-[30px] items-center gap-[6px] rounded-full border px-[10px] transition-[color,opacity,border-color] duration-200 group-enabled:group-hover:border-line-hover ${on ? 'border-line-strong text-ink' : 'border-line text-faint opacity-70'}`}>
                <span aria-hidden className="inline-flex rounded-[5px] transition-[box-shadow] duration-200" style={{ boxShadow: on ? `0 0 0 1.5px ${p.accent}` : '0 0 0 1.5px transparent' }}>
                  <VenueLogo venue={p.key} name={p.name} size={16} decorative />
                </span>
                {p.name}
              </span>
            </button>
          )
        })}
      </div>
      <div id={panelId} role="tabpanel" aria-labelledby={`ledger-tab-${metric}`} className="px-[6px] pt-[6px]">
        {chart}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 pt-[2px] pb-2 font-mono text-[11px] text-faint">
        <span>
          {NOUN[metric]} · last {D || '—'} days · press a venue to hide it
        </span>
        {sourceLine && state === 'ok' && (
          <span title={sourceTitle} data-testid="ledger-sources">
            Source: {sourceLine}
          </span>
        )}
        {data?.totals.unread.length ? <span>{data.totals.unread.map((k) => projects.find((p) => p.key === k)?.name ?? k).join(', ')} unreadable</span> : null}
      </div>
    </div>
  )
}

function byKey(ok: VenueOk[], key: string): VenueOk {
  return ok.find((v) => v.key === key) ?? EMPTY
}
const EMPTY = { key: '', state: 'ok', daily: [], series: { tvl: [], volume: [], fees: [] } } as unknown as VenueOk
