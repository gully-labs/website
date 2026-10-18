import { Activity, BadgeDollarSign, Percent, Receipt } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { AnimatedNumber } from '../../../components/charts/AnimatedNumber'
import { ChartBox } from '../../../components/charts/ChartSkeleton'
import { EChart } from '../../../components/charts/EChart'
import { alpha, axisTooltip, barsPreset, C, itemTooltip, livePoint, PALETTE, ringPreset, tipHtml } from '../../../components/charts/chartPresets'
import { NF } from '../../../components/charts/number-formats'
import { ChainLogo } from '../../../components/logos/ChainLogo'
import { TokenLogo } from '../../../components/logos/TokenLogo'
import { GhostCurves } from '../charts'
import { usePoll } from '../poll'
import { chip, label } from '../styles'
import { KpiRow, KpiTile, RefreshChip, Unknown } from '../ui'
import { usd, type MerchantStats } from './api'
import { Section } from './parts'

/* The store's payments dashboard: KPIs (volume, count, average ticket, conversion opened -> paid) in one row,
   volume per day stacked by chain with payments per day under it, the asset mix and the top links. Live from
   GET /api/developer/merchant/stats, re-read every 30 s (a failed refresh keeps the last figures and says so);
   charts animate in on view and glide on refresh. With no payment yet the charts are ghosted placeholders
   ("Your payments will draw here"), never flat zeros or a $0 ring; a figure the server cannot give shows
   as "—" with a tooltip, never 0. */

const RANGES = ['30d', '90d', '365d'] as const
type Range = (typeof RANGES)[number]
const CHAIN_COLOR: Record<string, string> = { Base: '#5aa9e6', Ethereum: '#c98bdb', 'BNB Chain': '#d9b563', Arbitrum: '#26ab94', 'OP Mainnet': '#ff8a7a', Polygon: '#c98bdb', Avalanche: '#ff8a7a' }
const day = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })

export function PaymentsDashboard({ refreshKey, children }: { refreshKey: number; children?: React.ReactNode }) {
  const [range, setRange] = useState<Range>('30d')
  const stats = usePoll<MerchantStats>(`/api/developer/merchant/stats?range=${range}`, 30_000)
  const data = stats.data
  const failed = !data && (!!stats.error || stats.timedOut)
  const { reload } = stats
  // A change elsewhere on the tab (a link made, a wallet added) reads the stats again at once.
  useEffect(() => {
    if (refreshKey) void reload()
  }, [refreshKey, reload])

  const volumeOption = useMemo(() => {
    if (!data) return null
    const total = data.dates.map((_, i) => data.byChain.reduce((a, s) => a + s.data[i], 0))
    const lastIdx = total.length - 1
    return {
      grid: { left: 8, right: 12, top: 26, bottom: 4, containLabel: true },
      legend: data.byChain.length > 1 ? { top: 0, left: 0, data: data.byChain.map((c) => c.name), itemWidth: 10, itemHeight: 10, textStyle: { color: C.muted, fontSize: 11 } } : undefined,
      tooltip: axisTooltip((ps: { dataIndex: number; seriesName: string; value: number; color: string }[]) => {
        const i = ps[0]?.dataIndex ?? 0
        const rows = ps.filter((p) => p.seriesName !== 'live' && p.value > 0).map((p) => ({ name: p.seriesName, value: usd(p.value), color: p.color }))
        return tipHtml({ title: day(data.dates[i]), rows: rows.length ? rows : [{ name: 'Volume', value: usd(0) }], note: `${data.count[i]} payment${data.count[i] === 1 ? '' : 's'}` })
      }, 'shadow'),
      xAxis: { type: 'category', data: data.dates.map(day), axisTick: { show: false }, axisLabel: { color: C.faint, fontSize: 11, hideOverlap: true }, axisLine: { lineStyle: { color: C.line } } },
      yAxis: { type: 'value', axisLabel: { color: C.faint, fontSize: 11, formatter: (v: number) => (v >= 1000 ? `$${Math.round(v / 100) / 10}k` : `$${v}`) }, splitLine: { lineStyle: { color: C.grid } } },
      series: [
        ...data.byChain.map((s, i) => ({ id: `c-${s.name}`, name: s.name, ...barsPreset({ stagger: 12, focus: 'series' }), stack: 'v', barMaxWidth: 18, color: CHAIN_COLOR[s.name] ?? PALETTE[i % PALETTE.length], data: s.data })),
        { ...livePoint([data.dates.map(day)[lastIdx], total[lastIdx]], C.gold), name: 'live' },
      ],
    }
  }, [data])

  const mixOption = useMemo(() => {
    if (!data) return null
    const mix = data.byAsset.map((s) => ({ name: s.name, value: Math.round(s.data.reduce((a, v) => a + v, 0) * 100) / 100 })).filter((x) => x.value > 0)
    if (!mix.length) return null
    return {
      tooltip: itemTooltip((p: { name: string; value: number; percent: number; color: string }) => tipHtml({ title: p.name, rows: [{ name: 'Volume', value: usd(p.value), color: p.color }, { name: 'Share', value: `${p.percent}%` }] })),
      series: [{ id: 'mix', ...ringPreset(), data: mix, color: [...PALETTE] }],
    }
  }, [data])

  const countOption = useMemo(() => {
    if (!data) return null
    return {
      grid: { left: 4, right: 8, top: 6, bottom: 4, containLabel: true },
      tooltip: axisTooltip((ps: { dataIndex: number; value: number }[]) => tipHtml({ title: day(data.dates[ps[0]?.dataIndex ?? 0]), rows: [{ name: 'Payments', value: String(ps[0]?.value ?? 0), color: C.gold }] })),
      xAxis: { type: 'category', data: data.dates.map(day), show: false },
      yAxis: { type: 'value', minInterval: 1, axisLabel: { color: C.faint, fontSize: 11 }, splitLine: { lineStyle: { color: C.grid } } },
      series: [{ id: 'count', ...barsPreset({ stagger: 10 }), color: alpha(C.gold, 0.85), barMaxWidth: 10, data: data.count }],
    }
  }, [data])

  const linksOption = useMemo(() => {
    if (!data || !data.topLinks.some((l) => l.volumeUsd > 0)) return null
    const top = [...data.topLinks].reverse()
    return {
      grid: { left: 4, right: 40, top: 4, bottom: 4, containLabel: true },
      tooltip: axisTooltip((ps: { dataIndex: number }[]) => {
        const l = top[ps[0]?.dataIndex ?? 0]
        return tipHtml({ title: l.title, rows: [{ name: 'Volume', value: usd(l.volumeUsd), color: C.gold }, { name: 'Paid', value: String(l.paid) }, { name: 'Checkouts', value: String(l.checkouts) }, { name: 'Views', value: String(l.views) }] })
      }, 'shadow'),
      xAxis: { type: 'value', show: false },
      yAxis: { type: 'category', data: top.map((l) => (l.title.length > 22 ? `${l.title.slice(0, 21)}…` : l.title)), axisTick: { show: false }, axisLine: { show: false }, axisLabel: { color: C.muted, fontSize: 11 } },
      series: [{ id: 'links', ...barsPreset({ horizontal: true, stagger: 40 }), color: C.gold, barMaxWidth: 12, label: { show: true, position: 'right', color: C.muted, fontSize: 11, formatter: (p: { value: number }) => usd(p.value) }, data: top.map((l) => l.volumeUsd) }],
    }
  }, [data])

  const t = data?.totals
  const none = !!data && t?.payments === 0
  const why = failed ? 'the stats could not be read right now' : 'reading…'
  const kpi = (v: number | null | undefined, node: React.ReactNode, whyNull = why) => (data && v != null ? node : <Unknown why={data ? whyNull : why} />)
  return (
    <Section
      id="m-dashboard"
      title="Payments"
      sub={
        <span className="inline-flex items-center gap-2">
          <span aria-hidden className="size-2 animate-[gl-blink_1.6s_ease-in-out_infinite] rounded-full bg-green" /> Live from the chain checks; refreshes every 30 s.
        </span>
      }
      action={
        <span className="flex flex-wrap items-center gap-2">
          <RefreshChip error={stats.stale ? stats.error : null} onRetry={() => void stats.reload()} />
          <span className="flex gap-1" role="radiogroup" aria-label="Range">
            {RANGES.map((r) => (
              <button key={r} type="button" role="radio" aria-checked={range === r} className={`${chip(range === r, true)} min-h-9 relative after:absolute after:inset-x-0 after:-inset-y-[4px] px-3 max-[600px]:min-h-11`} onClick={() => setRange(r)}>
                {r}
              </button>
            ))}
          </span>
        </span>
      }
    >
      <KpiRow label="Store payments">
        <KpiTile i={0} label="Volume" icon={<BadgeDollarSign size={13} aria-hidden />} note={data ? `last ${data.days} days` : undefined}>
          {kpi(t?.volumeUsd, <AnimatedNumber value={t?.volumeUsd ?? null} format={NF.usd} countUp />)}
        </KpiTile>
        <KpiTile i={1} label="Payments" icon={<Receipt size={13} aria-hidden />} note="confirmed on chain">
          {kpi(t?.payments, <AnimatedNumber value={t?.payments ?? null} countUp />)}
        </KpiTile>
        <KpiTile i={2} label="Average ticket" icon={<Activity size={13} aria-hidden />} note={none ? 'no payment yet' : 'per payment'}>
          {kpi(t?.avgTicketUsd, <AnimatedNumber value={t?.avgTicketUsd ?? null} format={NF.usd} />, 'no payment yet, so no average')}
        </KpiTile>
        <KpiTile i={3} label="Conversion" icon={<Percent size={13} aria-hidden />} note={t ? `${t.paid} paid of ${t.opened} opened` : undefined}>
          {kpi(t?.conversion, <AnimatedNumber value={t?.conversion != null ? Math.round(t.conversion * 1000) / 10 : null} format={{ maximumFractionDigits: 1 }} suffix="%" />, 'no checkout opened yet')}
        </KpiTile>
      </KpiRow>
      {none ? (
        <GhostCurves height={110} title="Your payments will draw here">
          <span className="max-w-[440px] text-[13px] text-muted">Volume per day by chain, payments per day and the asset mix appear within seconds of your first confirmed payment.</span>
        </GhostCurves>
      ) : (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <div className="flex min-w-0 flex-col gap-1">
            <span className={label}>Volume per day, by chain (USD at the quoted value)</span>
            {volumeOption ? <EChart option={volumeOption} height={200} label={`Daily payment volume by chain over ${data?.days} days: ${usd(t?.volumeUsd)} in total.`} steps={{ count: data?.dates.length ?? 0 }} /> : <ChartBox height={200} state={failed ? 'error' : 'loading'} onRetry={() => void stats.reload()} />}
            <span className={label}>Payments per day</span>
            {countOption ? <EChart option={countOption} height={70} label="Payments per day" /> : <ChartBox height={70} state={failed ? 'error' : 'loading'} />}
          </div>
          <div className="flex min-w-0 flex-col gap-1">
            <span className={label}>Asset mix</span>
            {mixOption ? (
              <EChart option={mixOption} height={170} skeleton="ring" label="Share of volume by asset and chain">
                <span className="pointer-events-none absolute inset-0 grid place-items-center text-center">
                  <span className="flex flex-col items-center">
                    <span className="font-display text-[20px] font-extrabold text-ink">{usd(t?.volumeUsd)}</span>
                    <span className="font-mono text-[11px] text-faint">{data?.range}</span>
                  </span>
                </span>
              </EChart>
            ) : data ? (
              <GhostCurves height={170} title="No volume in this range" />
            ) : (
              <ChartBox height={170} variant="ring" state={failed ? 'error' : 'loading'} />
            )}
            <ul className="m-0 flex list-none flex-col gap-1 p-0">
              {data?.byAsset
                .map((a) => ({ a, v: a.data.reduce((x, y) => x + y, 0) }))
                .filter(({ v }) => v > 0)
                .map(({ a, v }) => {
                  const [sym, chain] = a.name.split(' · ')
                  return (
                    <li key={a.name} className="flex items-center gap-2 text-[12px] text-muted">
                      <span className="relative inline-flex">
                        <TokenLogo symbol={sym} size={16} decorative />
                        <ChainLogo chain={chain} size={10} decorative className="absolute -right-1 -bottom-1" />
                      </span>
                      <span className="flex-1">{a.name}</span>
                      <span className="font-mono text-ink-2">{usd(v)}</span>
                    </li>
                  )
                })}
            </ul>
          </div>
        </div>
      )}
      {linksOption && (
        <div className="flex min-w-0 flex-col gap-1">
          <span className={label}>Top links by volume</span>
          <EChart option={linksOption} height={Math.max(80, (data?.topLinks.length ?? 1) * 28)} label="Top pay links by volume" />
        </div>
      )}
      {children}
    </Section>
  )
}
