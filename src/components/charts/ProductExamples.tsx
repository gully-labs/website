import { useMemo, useState, useSyncExternalStore } from 'react'
import { EChart } from './EChart'
import type { ChartEvent } from './chart-utils'
import { areaPreset, axisTooltip, barsPreset, C, CHART_H, itemTooltip, linePreset, PALETTE, ringPreset, tipHtml } from './chartPresets'

/* Illustrations for the product pages, drawn with the site's chart kit so they move and answer
   hover like the real dashboards would. Every figure here is EXAMPLE data, typed in to show what
   the product draws, and each chart says so in a badge and in its accessible label. Nothing here is
   a claim about real customers or usage. */

const fmt = (n: number) => n.toLocaleString('en-US')

export function ExampleBadge() {
  return <span className="rounded-full border border-line-strong px-2 py-[2px] font-mono text-[11px] tracking-[1px] text-faint">EXAMPLE DATA</span>
}

function Frame({ title, sub, children, aside }: { title: string; sub: string; children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <figure className="m-0 flex min-w-0 flex-col gap-4 rounded-card border border-line bg-surface p-5">
      <figcaption className="flex flex-wrap items-start justify-between gap-3">
        <span className="flex min-w-0 flex-col gap-1">
          <span className="font-display text-[20px] leading-none font-bold uppercase">{title}</span>
          <span className="font-mono text-[11px] text-faint">{sub}</span>
        </span>
        <span className="flex items-center gap-2">
          {aside}
          <ExampleBadge />
        </span>
      </figcaption>
      {children}
    </figure>
  )
}

/* ---------- Gully Analytics ---------- */

const FUNNEL = [
  { step: 'Visits', short: 'Visits', n: 12400 },
  { step: 'Wallet connected', short: 'Wallet\nconnected', n: 2180 },
  { step: 'Transaction sent', short: 'Transaction\nsent', n: 640 },
]

/** True on a phone-width window: the funnel then wraps its step names and puts each share under its count. */
const NARROW = '(max-width: 480px)'
function useNarrow() {
  return useSyncExternalStore(
    (cb) => {
      const m = window.matchMedia(NARROW)
      m.addEventListener('change', cb)
      return () => m.removeEventListener('change', cb)
    },
    () => window.matchMedia(NARROW).matches,
    () => false,
  )
}
const CHAINS = [
  { name: 'Base', n: 41 },
  { name: 'Ethereum', n: 23 },
  { name: 'BNB Chain', n: 17 },
  { name: 'Robinhood Chain', n: 12 },
  { name: 'Arc', n: 7 },
]
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const CONNECTS = { week: [210, 262, 248, 301, 356, 322, 381], prev: [180, 205, 231, 226, 268, 254, 290] }

function Funnel() {
  const narrow = useNarrow()
  const option = useMemo(
    () => ({
      grid: { left: 4, right: narrow ? 52 : 70, top: 4, bottom: 4, containLabel: true },
      xAxis: { type: 'value', show: false, max: FUNNEL[0].n },
      yAxis: { type: 'category', inverse: true, data: FUNNEL.map((f) => (narrow ? f.short : f.step)), axisLabel: { color: C.ink2, fontSize: narrow ? 11 : 12, lineHeight: 13 }, axisLine: { show: false }, axisTick: { show: false } },
      tooltip: axisTooltip((ps: ChartEvent[]) => {
        const i = ps[0]?.dataIndex ?? -1
        const f = FUNNEL[i]
        if (!f) return ''
        return tipHtml({
          title: `${f.step} (example)`,
          rows: [
            { name: 'sessions', value: fmt(f.n), color: PALETTE[i] },
            ...(i ? [{ name: 'from previous step', value: `${((f.n / FUNNEL[i - 1].n) * 100).toFixed(1)}%` }] : []),
          ],
        })
      }, 'shadow'),
      series: [
        {
          id: 'funnel',
          ...barsPreset({ horizontal: true, stagger: 120 }),
          barWidth: 22,
          showBackground: true,
          backgroundStyle: { color: C.line, borderRadius: 4 },
          label: { show: true, position: 'right', color: C.ink2, fontSize: narrow ? 11 : 12, lineHeight: 13, formatter: (p: ChartEvent) => `${fmt(p.value)}${p.dataIndex ? `${narrow ? '\n' : ' · '}${((p.value / FUNNEL[0].n) * 100).toFixed(1)}%` : ''}` },
          data: FUNNEL.map((f, i) => ({ value: f.n, itemStyle: { color: PALETTE[i], borderRadius: 4 } })),
        },
      ],
    }),
    [narrow],
  )
  return (
    <EChart
      option={option}
      height={CHART_H.sm}
      steps={{ count: FUNNEL.length }}
      label={`Example funnel: ${FUNNEL.map((f) => `${f.step} ${fmt(f.n)}`).join(', ')}. Example data. Arrow keys step through the steps.`}
    />
  )
}

function ChainsRing() {
  const [hover, setHover] = useState<number | null>(null)
  const option = useMemo(
    () => ({
      tooltip: itemTooltip((p: ChartEvent) => tipHtml({ title: 'Wallet connects by chain (example)', rows: [{ name: p.name, value: `${p.value}%`, color: p.color }] })),
      series: [{ id: 'chains', ...ringPreset({ radius: ['58%', '90%'] }), data: CHAINS.map((c, i) => ({ name: c.name, value: c.n, itemStyle: { color: PALETTE[i] } })) }],
    }),
    [],
  )
  const cur = hover === null ? null : CHAINS[hover]
  return (
    <div className="flex items-center gap-5 max-[480px]:flex-col">
      <div className="relative size-[150px] flex-none">
        <EChart
          option={option}
          height={CHART_H.sm}
          skeleton="ring"
          steps={{ count: CHAINS.length }}
          label={`Example: wallet connects by chain, ${CHAINS.map((c) => `${c.name} ${c.n}%`).join(', ')}. Example data.`}
          onEvents={{ mouseover: (p) => setHover(p.dataIndex), mouseout: () => setHover(null) }}
        >
          <span aria-hidden className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
            <span className="font-display text-[22px] leading-none font-extrabold text-ink">{cur ? `${cur.n}%` : '5'}</span>
            <span className="mt-1 font-mono text-[11px] text-faint">{cur ? cur.name : 'chains'}</span>
          </span>
        </EChart>
      </div>
      <ul className="m-0 flex w-full min-w-0 flex-1 list-none flex-col gap-[5px] p-0" aria-hidden>
        {CHAINS.map((c, i) => (
          <li key={c.name} className={`flex items-center gap-2 rounded-btn px-1 text-[13px] transition-colors ${hover === i ? 'bg-surface-hover' : ''}`}>
            <i className="size-[9px] flex-none rounded-bar" style={{ background: PALETTE[i] }} />
            <span className="truncate text-ink-2">{c.name}</span>
            <span className="ml-auto font-mono text-[12px] text-muted">{c.n}%</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function ConnectsLine() {
  const option = useMemo(
    () => ({
      grid: { left: 0, right: 10, top: 28, bottom: 0, containLabel: true },
      legend: { top: 0, right: 0, data: ['this week', 'last week'] },
      xAxis: { type: 'category', boundaryGap: false, data: DAYS },
      yAxis: { type: 'value', splitNumber: 3 },
      tooltip: axisTooltip(
        (ps: ChartEvent[]) =>
          tipHtml({ title: `${DAYS[ps[0]?.dataIndex]} (example)`, rows: ps.map((p: ChartEvent) => ({ name: p.seriesName, value: fmt(p.value), color: p.color })) }),
        'cross',
      ),
      series: [
        { id: 'prev', name: 'last week', ...linePreset({ color: C.muted, width: 1.5, dashed: true }), data: CONNECTS.prev },
        { id: 'week', name: 'this week', ...areaPreset({ color: C.gold }), data: CONNECTS.week },
      ],
    }),
    [],
  )
  return <EChart option={option} height={CHART_H.md} skeleton="line" steps={{ count: DAYS.length, seriesIndex: 1 }} label={`Example: wallet connects per day this week, ${CONNECTS.week.join(', ')}, against last week. Example data.`} />
}

export function AnalyticsExample() {
  return (
    <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,420px),1fr))] gap-4">
      <Frame title="Visit → wallet → transaction" sub="the funnel on the Web3 tab">
        <Funnel />
      </Frame>
      <Frame title="Wallet connects" sub="per day, against the week before">
        <ConnectsLine />
      </Frame>
      <Frame title="Chains" sub="where connected wallets were">
        <ChainsRing />
      </Frame>
    </div>
  )
}

/* ---------- Chain Kit ---------- */

const HOURS = Array.from({ length: 24 }, (_, i) => `${String(i).padStart(2, '0')}:00`)
// A smooth daily cycle with a little texture: example only.
const TXS = HOURS.map((_, i) => Math.round(3200 + 1900 * Math.sin(((i - 8) / 24) * 2 * Math.PI) + ((i * 37) % 11) * 60))
const BLOCK_TIME = HOURS.map((_, i) => Number((2 + ((i * 13) % 7) * 0.03).toFixed(2)))

export function ChainKitExample() {
  const [view, setView] = useState<'tx' | 'blocks'>('tx')
  const option = useMemo(
    () => ({
      grid: { left: 0, right: 10, top: 12, bottom: 0, containLabel: true },
      xAxis: { type: 'category', data: HOURS, axisLabel: { interval: 3 } },
      yAxis: view === 'tx' ? { type: 'value', splitNumber: 3, min: 0, max: null, axisLabel: { formatter: (v: number) => (v >= 1000 ? `${v / 1000}k` : String(v)) } } : { type: 'value', splitNumber: 3, min: 1.8, max: 2.3, axisLabel: { formatter: (v: number) => `${v.toFixed(1)}s` } },
      tooltip: axisTooltip((ps: ChartEvent[]) => {
        const i = ps[0]?.dataIndex ?? -1
        return i < 0 ? '' : tipHtml({ title: `${HOURS[i]} UTC (example)`, rows: [view === 'tx' ? { name: 'transactions', value: fmt(TXS[i]), color: C.gold } : { name: 'avg block time', value: `${BLOCK_TIME[i].toFixed(2)} s`, color: PALETTE[1] }] })
      }, view === 'tx' ? 'shadow' : 'cross'),
      series: [view === 'tx' ? { id: 'tx', ...barsPreset({ stagger: 18 }), itemStyle: { color: C.gold, borderRadius: [3, 3, 0, 0] }, data: TXS } : { id: 'bt', ...areaPreset({ color: PALETTE[1], smooth: 0.3 }), data: BLOCK_TIME }],
    }),
    [view],
  )
  return (
    <Frame
      title="Explorer charts"
      sub="what your chain's explorer home page draws"
      aside={
        <span role="group" aria-label="Chart" className="flex gap-1 rounded-input border border-line bg-bg p-1">
          {(
            [
              ['tx', 'Transactions'],
              ['blocks', 'Block time'],
            ] as const
          ).map(([id, name]) => (
            <button
              key={id}
              type="button"
              aria-pressed={view === id}
              onClick={() => setView(id)}
              className={`min-h-11 rounded-btn px-3 font-mono text-[12px] transition-colors ${view === id ? 'bg-gold text-bg' : 'bg-transparent text-muted hover:text-ink'}`}
            >
              {name}
            </button>
          ))}
        </span>
      }
    >
      <EChart
        key={view}
        option={option}
        height={CHART_H.md}
        skeleton={view === 'tx' ? 'bars' : 'line'}
        steps={{ count: HOURS.length }}
        label={view === 'tx' ? `Example: transactions per hour over a day, from ${fmt(Math.min(...TXS))} to ${fmt(Math.max(...TXS))}. Example data.` : `Example: average block time per hour, ${Math.min(...BLOCK_TIME)} to ${Math.max(...BLOCK_TIME)} seconds. Example data.`}
      />
    </Frame>
  )
}
