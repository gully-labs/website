import { useMemo } from 'react'
import { AnimatedNumber } from '../../components/charts/AnimatedNumber'
import { areaPreset, axisTooltip, barsPreset, C, itemTooltip, linePreset, ringPreset, sparklinePreset, tipHtml, type TipRow } from '../../components/charts/chartPresets'
import { EChart } from '../../components/charts/EChart'
import { NF } from '../../components/charts/number-formats'
import type { GapAlert, UsageV2 } from './api'
import { LIMITED_COLOR } from './styles'
import { columns, group } from './usage'

/* The console's animated charts on the shared ECharts kit (src/components/charts): ECharts loads in
   its own chunk on first use, the box holds its size with a skeleton meanwhile, entries animate in
   (areas draw, rings sweep, bars grow) and refreshes glide from the old values, so switching
   24h / 7d / 30d morphs the chart instead of redrawing it. Reduced motion is handled by the kit.
   Every figure is the server's; a figure the server does not know (null) is "not tracked yet",
   never drawn as 0. */

const fmt = (n: number) => n.toLocaleString('en-US')
const compact = (n: number) => (n >= 10_000 ? `${Math.round(n / 1000)}k` : n >= 1000 ? `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k` : String(n))

/** An animated empty chart box (owner rule: empty states still move): a pulsing live dot, the message,
    and a light sweeping along the baseline, the same height as the chart it stands in for. */
export function EmptyChart({ height, title, children }: { height: number; title: string; children?: React.ReactNode }) {
  return (
    <div className="relative flex flex-col items-center justify-center gap-1 overflow-hidden rounded-[10px] border border-dashed border-line-strong px-4 text-center" style={{ height }} data-testid="empty-chart">
      <span className="flex items-center gap-2">
        <span className="relative grid size-3 shrink-0 place-items-center" aria-hidden>
          <span className="absolute size-3 rounded-full bg-gold/40" style={{ animation: 'gl-live-pulse 2.4s ease-out infinite' }} />
          <span className="size-[7px] rounded-full bg-gold" />
        </span>
        <span className="font-mono text-[12px] text-faint">{title}</span>
      </span>
      {children && <span className="max-w-[320px] text-[12px] leading-[1.5] text-dim">{children}</span>}
      <span aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-[linear-gradient(90deg,transparent,rgba(0,210,255,.5),transparent)]" style={{ animation: 'gl-scan 3.2s linear infinite' }} />
    </div>
  )
}

/** The "not tracked yet" box, same height as the chart it stands in for (animated). */
export function NotTracked({ height, children }: { height: number; children?: React.ReactNode }) {
  return (
    <EmptyChart height={height} title="not tracked yet">
      {children}
    </EmptyChart>
  )
}

/* ----------------------------------------------------------- requests --- */

export interface KeySeries {
  id: string
  name: string
  color: string
}

/**
 * Requests over time as stacked areas, one per key, with a crosshair. With `previous` known, a dashed
 * line marks the previous period's average per bucket (the server gives that period's total only).
 */
export function RequestsChart({ usage, series, height = 260 }: { usage: UsageV2; series: KeySeries[]; height?: number }) {
  const grouped = useMemo(() => group(usage), [usage])
  const cols = useMemo(() => columns(usage, grouped), [usage, grouped])
  const hasLimited = grouped.length > 0 && grouped.every((g) => g.limited !== undefined)
  const prevAvg = usage.previous && grouped.length ? usage.previous.total / grouped.length : null
  const empty = grouped.every((g) => g.total === 0)

  const option = useMemo(() => {
    const names = Object.fromEntries(series.map((s) => [s.id, s]))
    return {
      grid: { left: 44, right: 14, top: 14, bottom: 28 },
      xAxis: { type: 'category', boundaryGap: false, data: cols.map((c) => c.label), axisLabel: { hideOverlap: true } },
      yAxis: { type: 'value', minInterval: 1, splitNumber: 3, axisLabel: { formatter: (v: number) => compact(v) } },
      tooltip: axisTooltip((ps: { dataIndex: number }[]) => {
        const i = ps[0]?.dataIndex ?? -1
        const c = cols[i]
        if (!c) return ''
        const rows: TipRow[] = series.filter((s) => (c.values[s.id] ?? 0) > 0).map((s) => ({ name: names[s.id].name, value: fmt(c.values[s.id] ?? 0), color: s.color }))
        rows.push({ name: 'all keys', value: fmt(c.total), color: C.muted })
        if (hasLimited) rows.push({ name: 'of which 429', value: fmt(c.limited ?? 0), color: LIMITED_COLOR })
        if (prevAvg !== null) rows.push({ name: 'previous period, avg', value: prevAvg < 10 ? prevAvg.toFixed(1) : fmt(Math.round(prevAvg)), color: C.faint })
        return tipHtml({ title: c.long, rows })
      }, 'cross'),
      series: [
        ...series.map((s) => ({
          id: `k-${s.id}`,
          name: s.name,
          ...areaPreset({ color: s.color, fill: 0.3, smooth: 0.15 }),
          stack: 'requests',
          emphasis: { focus: 'series' },
          data: grouped.map((g) => g.keys[s.id] ?? 0),
        })),
        ...(hasLimited ? [{ id: 'limited', name: '429s', ...linePreset({ color: LIMITED_COLOR, width: 1.5, smooth: 0.15 }), data: grouped.map((g) => g.limited ?? 0), z: 4 }] : []),
        ...(prevAvg !== null ? [{ id: 'prev', name: 'Previous period (avg per bucket)', ...linePreset({ color: C.dim, width: 1.25, smooth: 0, dashed: true }), data: grouped.map(() => Math.round(prevAvg * 10) / 10), z: 3 }] : []),
      ],
    }
  }, [cols, grouped, series, hasLimited, prevAvg])

  const sum = grouped.reduce((a, g) => a + g.total, 0)
  return (
    <EChart option={option} height={height} skeleton="line" steps={{ count: grouped.length }} label={empty ? 'No requests in this range yet.' : `${fmt(sum)} requests in this range, stacked by key${usage.previous ? `; previous period ${fmt(usage.previous.total)}` : ''}. Focus and use the arrow keys to read each bucket.`}>
      {empty && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <span className="rounded-[8px] border border-line bg-surface-deep px-3 py-2 font-mono text-[12px] text-faint">No requests in this range yet</span>
        </div>
      )}
    </EChart>
  )
}

/* -------------------------------------------------------- status donut --- */

const STATUS = [
  { k: 'ok', name: '2xx–3xx OK', color: '#3ddc97' },
  { k: 'client', name: '4xx client', color: '#00d2ff' },
  { k: 'limited', name: '429 limited', color: LIMITED_COLOR },
  { k: 'server', name: '5xx server', color: '#9578e8' },
] as const

export function StatusDonut({ byStatus, height = 180 }: { byStatus: UsageV2['byStatus']; height?: number }) {
  const total = byStatus ? byStatus.ok + byStatus.client + byStatus.limited + byStatus.server : 0
  const option = useMemo(
    () => ({
      tooltip: itemTooltip((p: { name: string; value: number; color: string }) => tipHtml({ rows: [{ name: p.name, value: `${fmt(p.value)} · ${total ? ((p.value / total) * 100).toFixed(1) : 0}%`, color: p.color }] })),
      series: [
        {
          id: 'status',
          ...ringPreset({ radius: ['66%', '92%'] }),
          data: STATUS.map((s): { name: string; value: number; itemStyle: { color: string } } => ({ name: s.name, value: byStatus?.[s.k] ?? 0, itemStyle: { color: s.color } })).filter((d) => !total || d.value > 0).concat(total ? [] : [{ name: 'no requests', value: 1, itemStyle: { color: C.grid } }]),
        },
      ],
    }),
    [byStatus, total],
  )
  if (!byStatus) return <NotTracked height={height}>Status counts start with your keys&apos; first request.</NotTracked>
  return (
    <div className="flex flex-wrap items-center gap-4">
      <div className="relative" style={{ width: height, height }}>
        <EChart option={option} height={height} skeleton="ring" label={`Answers by status: ${STATUS.map((s) => `${s.name} ${fmt(byStatus[s.k])}`).join(', ')}.`}>
          <span className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
            <AnimatedNumber value={total} format={NF.int} countUp className="font-display text-[26px] leading-none font-bold" />
            <span className="text-[11px] text-dim">answers</span>
          </span>
        </EChart>
      </div>
      <ul className="m-0 flex min-w-[150px] flex-1 list-none flex-col gap-[6px] p-0 font-mono text-[12px]">
        {STATUS.map((s) => (
          <li key={s.k} className="flex items-center gap-2">
            <i className="inline-block size-[9px] shrink-0 rounded-full" style={{ background: s.color }} aria-hidden />
            <span className="flex-1 text-muted">{s.name}</span>
            <span className="text-ink">{fmt(byStatus[s.k])}</span>
            <span className="w-[46px] text-right text-faint">{total ? `${((byStatus[s.k] / total) * 100).toFixed(byStatus[s.k] / total < 0.1 ? 1 : 0)}%` : '—'}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

/* -------------------------------------------------------- endpoint bars --- */

export function EndpointBars({ byEndpoint, since }: { byEndpoint: UsageV2['byEndpoint']; since: string | null }) {
  const rows = useMemo(() => byEndpoint ?? [], [byEndpoint])
  const height = Math.max(120, 24 + rows.length * 34)
  const option = useMemo(() => {
    const list = [...rows].reverse()
    return {
      grid: { left: 8, right: 54, top: 6, bottom: 6, containLabel: true },
      xAxis: { type: 'value', show: false },
      yAxis: { type: 'category', data: list.map((r) => r.endpoint), axisLabel: { color: C.muted, fontSize: 11 } },
      tooltip: axisTooltip((ps: { dataIndex: number }[]) => {
        const r = list[ps[0]?.dataIndex ?? -1]
        return r ? tipHtml({ rows: [{ name: r.endpoint, value: fmt(r.count), color: C.gold }] }) : ''
      }, 'shadow'),
      series: [
        {
          id: 'ep',
          ...barsPreset({ horizontal: true, stagger: 60 }),
          barMaxWidth: 16,
          itemStyle: { color: C.gold, borderRadius: [0, 3, 3, 0] },
          label: { show: true, position: 'right', color: C.muted, fontSize: 11, formatter: (p: { value: number }) => compact(p.value) },
          data: list.map((r) => r.count),
        },
      ],
    }
  }, [rows])
  if (!byEndpoint) return <NotTracked height={120}>Per-endpoint counts are recorded from now on; older traffic has none.</NotTracked>
  if (!rows.length)
    return (
      <EmptyChart height={120} title={`No requests in this range${since ? ` · counted since ${new Date(since).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : ''}`} />
    )
  return <EChart option={option} height={height} label={`Requests by endpoint: ${rows.map((r) => `${r.endpoint} ${fmt(r.count)}`).join(', ')}.`} />
}

/* ----------------------------------------------------------- key spark --- */

export function KeySpark({ values, labels, color, label, width = 96, height = 28 }: { values: number[]; labels?: string[]; color: string; label: string; width?: number; height?: number }) {
  const option = useMemo(() => sparklinePreset({ data: values, labels, color, area: true, pulse: false, fmt }), [values, labels, color])
  return (
    <span className="block shrink-0" style={{ width }}>
      <EChart option={option} height={height} skeleton="line" label={label} />
    </span>
  )
}

/* ------------------------------------------------------- alert timeline --- */

/** Each alert's deliveries over time, one row per alert: filled = delivered, red = failed, hollow = test. */
export function AlertTimeline({ alerts, nameOf }: { alerts: GapAlert[]; nameOf: (a: GapAlert) => string }) {
  const withLog = alerts.filter((a) => a.deliveries.length)
  const height = Math.max(140, 56 + withLog.length * 34)
  const option = useMemo(() => {
    const names = withLog.map(nameOf)
    const pts = (pred: (d: GapAlert['deliveries'][number]) => boolean) =>
      withLog.flatMap((a, row) => {
        const seen = new Set<string>()
        return a.deliveries.filter((d) => {
          if (!pred(d)) return false
          const k = `${d.id}:${d.ok}`
          if (seen.has(k)) return false
          seen.add(k)
          return true
        }).map((d) => ({ value: [Date.parse(d.at), row], d }))
      })
    const tip = (p: { data: { d: GapAlert['deliveries'][number]; value: [number, number] } }) => {
      const d = p.data.d
      return tipHtml({ title: new Date(d.at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }), rows: [{ name: names[p.data.value[1]] ?? '', value: d.test ? 'test' : d.ok ? 'delivered' : 'failed', valueColor: d.ok ? '#3ddc97' : LIMITED_COLOR }, { name: 'channel', value: `${d.channel}${d.status ? ` · ${d.status}` : ''}` }], note: d.error ?? (d.events.length ? d.events.map((e) => e.split(':')[1] ?? e).join(', ') : undefined) })
    }
    const scatter = (id: string, name: string, color: string, data: unknown[], hollow = false) => ({
      id,
      name,
      type: 'scatter',
      data,
      symbolSize: 11,
      itemStyle: hollow ? { color: 'transparent', borderColor: color, borderWidth: 1.5 } : { color, shadowBlur: 6, shadowColor: `${color}66` },
      animationDuration: 700,
      animationEasing: 'backOut',
      animationDelay: (i: number) => Math.min(i * 25, 500),
      emphasis: { scale: 1.6 },
      tooltip: itemTooltip(tip),
    })
    return {
      grid: { left: 8, right: 16, top: 10, bottom: 26, containLabel: true },
      xAxis: { type: 'time', axisLabel: { hideOverlap: true }, splitLine: { show: true, lineStyle: { color: C.grid } } },
      yAxis: { type: 'category', data: names, inverse: true, axisLabel: { color: C.muted, width: 120, overflow: 'truncate' }, splitLine: { show: true, lineStyle: { color: C.grid } } },
      tooltip: itemTooltip(tip),
      series: [scatter('ok', 'delivered', '#3ddc97', pts((d) => !d.test && d.ok)), scatter('fail', 'failed', LIMITED_COLOR, pts((d) => !d.test && !d.ok)), scatter('test', 'test', C.dim, pts((d) => d.test), true)],
    }
  }, [withLog, nameOf])
  if (!withLog.length) return <EmptyChart height={140} title="No deliveries yet: firings and tests appear here as they happen" />
  const fired = withLog.reduce((a, x) => a + x.deliveries.filter((d) => !d.test).length, 0)
  return <EChart option={option} height={height} label={`Alert deliveries over time: ${fired} firings across ${withLog.length} alerts.`} />
}

/* ------------------------------------------------------------ quota ring --- */

export interface RingSlice {
  name: string
  value: number
  color: string
}

/** Events used against a quota: one slice per site, the rest of the quota grey. Sweeps in. */
export function QuotaRing({ slices, quota, size = 150, caption }: { slices: RingSlice[]; quota: number; size?: number; caption: string }) {
  const used = slices.reduce((a, s) => a + s.value, 0)
  const pct = quota > 0 ? (used / quota) * 100 : null
  const option = useMemo(
    () => ({
      tooltip: itemTooltip((p: { name: string; value: number; color: string }) => tipHtml({ rows: [{ name: p.name, value: `${fmt(p.value)} · ${quota ? ((p.value / quota) * 100).toFixed(1) : 0}% of quota`, color: p.color }] })),
      series: [
        {
          id: 'quota',
          ...ringPreset({ radius: ['70%', '92%'], padAngle: slices.length > 1 ? 0.8 : 0 }),
          data: [...slices.map((s) => ({ name: s.name, value: s.value, itemStyle: { color: s.color } })), { name: 'left this month', value: Math.max(0, quota - used), itemStyle: { color: C.grid }, emphasis: { disabled: true } }],
        },
      ],
    }),
    [slices, quota, used],
  )
  return (
    <div className="flex flex-col items-center gap-1">
      <div className="relative" style={{ width: size, height: size }}>
        <EChart option={option} height={size} skeleton="ring" label={`${caption}: ${fmt(used)} of ${fmt(quota)} events (${pct === null ? 'unknown' : `${pct.toFixed(1)}%`}).`}>
          <span className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
            <AnimatedNumber value={pct === null ? null : Math.min(999, pct)} format={{ maximumFractionDigits: pct !== null && pct < 10 ? 1 : 0 }} suffix="%" countUp className={`font-display text-[24px] leading-none font-bold ${pct !== null && pct >= 100 ? 'text-error' : ''}`} />
            <span className="text-[11px] text-dim">of quota</span>
          </span>
        </EChart>
      </div>
      <span className="max-w-[160px] truncate text-center text-[12px] text-muted" title={caption}>
        {caption}
      </span>
      <span className="font-mono text-[11px] text-faint">
        {compact(used)} / {compact(quota)}
      </span>
    </div>
  )
}

/* ------------------------------------------------------ generic bar charts --- */

export interface HBar {
  name: string
  value: number
  color?: string
  note?: string
}

/** Horizontal bars, busiest first, growing in from the axis; hover reads the value. */
export function HBars({ rows, label, unit = '', rowH = 32, minH = 96 }: { rows: HBar[]; label: string; unit?: string; rowH?: number; minH?: number }) {
  const height = Math.max(minH, 20 + rows.length * rowH)
  const option = useMemo(() => {
    const list = [...rows].reverse()
    return {
      grid: { left: 8, right: 48, top: 4, bottom: 4, containLabel: true },
      xAxis: { type: 'value', show: false },
      yAxis: { type: 'category', data: list.map((r) => r.name), axisLabel: { color: C.muted, fontSize: 11, width: 130, overflow: 'truncate' } },
      tooltip: axisTooltip((ps: { dataIndex: number }[]) => {
        const r = list[ps[0]?.dataIndex ?? -1]
        return r ? tipHtml({ rows: [{ name: r.name, value: `${fmt(r.value)}${unit}`, color: r.color ?? C.gold }], note: r.note }) : ''
      }, 'shadow'),
      series: [
        {
          id: 'h',
          ...barsPreset({ horizontal: true, stagger: 60 }),
          barMaxWidth: 14,
          label: { show: true, position: 'right', color: C.muted, fontSize: 11, formatter: (p: { value: number }) => compact(p.value) },
          data: list.map((r) => ({ value: r.value, itemStyle: { color: r.color ?? C.gold, borderRadius: [0, 3, 3, 0] } })),
        },
      ],
    }
  }, [rows, unit])
  return <EChart option={option} height={height} label={label} />
}

export interface DayStack {
  /** Category label (a day). */
  label: string
  values: Record<string, number>
}

/** Vertical bars per day, stacked by kind; bars grow in with a stagger and glide on refresh. */
export function StackedDays({ days, kinds, label, height = 170 }: { days: DayStack[]; kinds: { id: string; name: string; color: string }[]; label: string; height?: number }) {
  const option = useMemo(
    () => ({
      grid: { left: 36, right: 8, top: 10, bottom: 24 },
      xAxis: { type: 'category', data: days.map((d) => d.label), axisLabel: { hideOverlap: true } },
      yAxis: { type: 'value', minInterval: 1, splitNumber: 3 },
      tooltip: axisTooltip((ps: { dataIndex: number }[]) => {
        const d = days[ps[0]?.dataIndex ?? -1]
        if (!d) return ''
        const rows = kinds.filter((k) => d.values[k.id]).map((k) => ({ name: k.name, value: fmt(d.values[k.id]), color: k.color }))
        return tipHtml({ title: d.label, rows: rows.length ? rows : [{ name: 'nothing', value: '0' }] })
      }, 'shadow'),
      series: kinds.map((k) => ({ id: k.id, name: k.name, ...barsPreset({ stagger: 25, focus: 'series' }), stack: 'd', barMaxWidth: 22, itemStyle: { color: k.color, borderRadius: 0 }, data: days.map((d) => d.values[k.id] ?? 0) })),
    }),
    [days, kinds],
  )
  return <EChart option={option} height={height} label={label} steps={{ count: days.length }} />
}

/** A live marker for a card whose data does not exist yet: a pulsing dot on a faint baseline, never a 0. */
export function LiveMarker({ text, height = 64 }: { text: string; height?: number }) {
  return (
    <div className="relative flex items-center gap-3 overflow-hidden rounded-[10px] border border-dashed border-line-strong px-3" style={{ height }}>
      <span className="relative grid size-3 shrink-0 place-items-center" aria-hidden>
        <span className="absolute size-3 rounded-full bg-gold/40" style={{ animation: 'gl-live-pulse 2.4s ease-out infinite' }} />
        <span className="size-[7px] rounded-full bg-gold" />
      </span>
      <span className="font-mono text-[11px] text-faint">{text}</span>
      <span aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-[linear-gradient(90deg,transparent,rgba(0,210,255,.5),transparent)]" style={{ animation: 'gl-scan 3.2s linear infinite' }} />
    </div>
  )
}
