import { useCallback, useEffect, useMemo, useState } from 'react'
import { AnimatedNumber } from '../../../components/charts/AnimatedNumber'
import { ChartBox } from '../../../components/charts/ChartSkeleton'
import { EChart } from '../../../components/charts/EChart'
import { alpha, axisTooltip, barsPreset, C, itemTooltip, livePoint, PALETTE, ringPreset, tipHtml } from '../../../components/charts/chartPresets'
import { NF } from '../../../components/charts/number-formats'
import { ChainLogo } from '../../../components/logos/ChainLogo'
import { TokenLogo } from '../../../components/logos/TokenLogo'
import { api } from '../api'
import { chip, label } from '../styles'
import { usd, type MerchantStats } from './api'
import { Section } from './parts'

/* The store's payments dashboard: volume per day stacked by chain, the asset mix, payments per day,
   KPIs (volume, count, average ticket, conversion opened -> paid) and the top links. Live from
   GET /api/developer/merchant/stats, refreshed every 30 s; charts animate in on view and glide on refresh.
   A figure the server cannot give (no payment yet: no average) shows as "—", never 0. */

const RANGES = ['30d', '90d', '365d'] as const
type Range = (typeof RANGES)[number]
const CHAIN_COLOR: Record<string, string> = { Base: '#5aa9e6', Ethereum: '#c98bdb', 'BNB Chain': '#e8c060', Arbitrum: '#1f9e89', 'OP Mainnet': '#e8655a', Polygon: '#9b6bf2', Avalanche: '#d9534f' }
const day = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })

function Kpi({ k, children, sub }: { k: string; children: React.ReactNode; sub?: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-1 rounded-[12px] border border-line bg-bg px-4 py-3">
      <span className={label}>{k}</span>
      <span className="font-display text-[28px] leading-none font-extrabold text-ink">{children}</span>
      {sub && <span className="font-mono text-[11px] text-faint">{sub}</span>}
    </div>
  )
}

export function PaymentsDashboard({ refreshKey }: { refreshKey: number }) {
  const [range, setRange] = useState<Range>('30d')
  const [data, setData] = useState<MerchantStats | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const load = useCallback(() => {
    api<MerchantStats>(`/api/developer/merchant/stats?range=${range}`).then((r) => (r.ok ? (setData(r.data), setErr(null)) : setErr(r.error)))
  }, [range])
  useEffect(() => {
    load()
    const id = setInterval(load, 30_000)
    return () => clearInterval(id)
  }, [load, refreshKey])

  const volumeOption = useMemo(() => {
    if (!data) return null
    const total = data.dates.map((_, i) => data.byChain.reduce((a, s) => a + s.data[i], 0))
    const lastIdx = total.length - 1
    return {
      grid: { left: 8, right: 12, top: 28, bottom: 4, containLabel: true },
      legend: { top: 0, left: 0, data: data.byChain.map((c) => c.name), itemWidth: 10, itemHeight: 10, textStyle: { color: C.muted, fontSize: 11 } },
      tooltip: axisTooltip((ps: { dataIndex: number; seriesName: string; value: number; color: string }[]) => {
        const i = ps[0]?.dataIndex ?? 0
        const rows = ps.filter((p) => p.seriesName !== 'live' && p.value > 0).map((p) => ({ name: p.seriesName, value: usd(p.value), color: p.color }))
        return tipHtml({ title: day(data.dates[i]), rows: rows.length ? rows : [{ name: 'Volume', value: usd(0) }], note: `${data.count[i]} payment${data.count[i] === 1 ? '' : 's'}` })
      }, 'shadow'),
      xAxis: { type: 'category', data: data.dates.map(day), axisTick: { show: false }, axisLabel: { color: C.faint, fontSize: 10, hideOverlap: true }, axisLine: { lineStyle: { color: C.line } } },
      yAxis: { type: 'value', axisLabel: { color: C.faint, fontSize: 10, formatter: (v: number) => (v >= 1000 ? `$${Math.round(v / 100) / 10}k` : `$${v}`) }, splitLine: { lineStyle: { color: C.grid } } },
      series: [
        ...data.byChain.map((s, i) => ({ id: `c-${s.name}`, name: s.name, ...barsPreset({ stagger: 12, focus: 'series' }), stack: 'v', barMaxWidth: 18, color: CHAIN_COLOR[s.name] ?? PALETTE[i % PALETTE.length], data: s.data })),
        { ...livePoint([data.dates.map(day)[lastIdx], total[lastIdx]], C.gold), name: 'live' },
      ],
    }
  }, [data])

  const mixOption = useMemo(() => {
    if (!data) return null
    const mix = data.byAsset.map((s) => ({ name: s.name, value: Math.round(s.data.reduce((a, v) => a + v, 0) * 100) / 100 })).filter((x) => x.value > 0)
    return {
      tooltip: itemTooltip((p: { name: string; value: number; percent: number; color: string }) => tipHtml({ title: p.name, rows: [{ name: 'Volume', value: usd(p.value), color: p.color }, { name: 'Share', value: `${p.percent}%` }] })),
      series: [{ id: 'mix', ...ringPreset(), data: mix.length ? mix : [{ name: 'No payments yet', value: 1, itemStyle: { color: C.line }, tooltip: { show: false } }], color: [...PALETTE] }],
    }
  }, [data])

  const countOption = useMemo(() => {
    if (!data) return null
    return {
      grid: { left: 4, right: 8, top: 8, bottom: 4, containLabel: true },
      tooltip: axisTooltip((ps: { dataIndex: number; value: number }[]) => tipHtml({ title: day(data.dates[ps[0]?.dataIndex ?? 0]), rows: [{ name: 'Payments', value: String(ps[0]?.value ?? 0), color: C.gold }] })),
      xAxis: { type: 'category', data: data.dates.map(day), show: false },
      yAxis: { type: 'value', minInterval: 1, axisLabel: { color: C.faint, fontSize: 10 }, splitLine: { lineStyle: { color: C.grid } } },
      series: [{ id: 'count', ...barsPreset({ stagger: 10 }), color: alpha(C.gold, 0.85), barMaxWidth: 10, data: data.count }],
    }
  }, [data])

  const linksOption = useMemo(() => {
    if (!data || !data.topLinks.length) return null
    const top = [...data.topLinks].reverse()
    return {
      grid: { left: 4, right: 40, top: 4, bottom: 4, containLabel: true },
      tooltip: axisTooltip((ps: { dataIndex: number }[]) => {
        const l = top[ps[0]?.dataIndex ?? 0]
        return tipHtml({ title: l.title, rows: [{ name: 'Volume', value: usd(l.volumeUsd), color: C.gold }, { name: 'Paid', value: String(l.paid) }, { name: 'Checkouts', value: String(l.checkouts) }, { name: 'Views', value: String(l.views) }] })
      }, 'shadow'),
      xAxis: { type: 'value', show: false },
      yAxis: { type: 'category', data: top.map((l) => (l.title.length > 22 ? `${l.title.slice(0, 21)}…` : l.title)), axisTick: { show: false }, axisLine: { show: false }, axisLabel: { color: C.muted, fontSize: 11 } },
      series: [{ id: 'links', ...barsPreset({ horizontal: true, stagger: 40 }), color: C.gold, barMaxWidth: 14, label: { show: true, position: 'right', color: C.muted, fontSize: 11, formatter: (p: { value: number }) => usd(p.value) }, data: top.map((l) => l.volumeUsd) }],
    }
  }, [data])

  const t = data?.totals
  const none = !!data && t?.payments === 0
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
        <span className="flex flex-wrap gap-2" role="radiogroup" aria-label="Range">
          {RANGES.map((r) => (
            <button key={r} type="button" role="radio" aria-checked={range === r} className={chip(range === r, true)} onClick={() => setRange(r)}>
              {r}
            </button>
          ))}
        </span>
      }
    >
      {err && <p className="m-0 font-mono text-[12px] text-error">{err}</p>}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi k="Volume" sub={data ? `last ${data.days} days` : undefined}>
          <AnimatedNumber value={t ? t.volumeUsd : null} format={NF.usd} countUp />
        </Kpi>
        <Kpi k="Payments" sub="confirmed on chain">
          <AnimatedNumber value={t ? t.payments : null} countUp />
        </Kpi>
        <Kpi k="Average ticket" sub={none ? 'no payment yet' : 'per payment'}>
          <AnimatedNumber value={t?.avgTicketUsd ?? null} format={NF.usd} />
        </Kpi>
        <Kpi k="Conversion" sub={t ? `${t.paid} paid of ${t.opened} opened` : undefined}>
          <AnimatedNumber value={t?.conversion != null ? Math.round(t.conversion * 1000) / 10 : null} format={{ maximumFractionDigits: 1 }} suffix="%" />
        </Kpi>
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-2">
          <span className={label}>Volume per day, by chain (USD at the quoted value)</span>
          {volumeOption ? (
            <EChart option={volumeOption} height={240} label={`Daily payment volume by chain over ${data?.days} days: ${usd(t?.volumeUsd)} in total.`} steps={{ count: data?.dates.length ?? 0 }}>
              {none && <span className="pointer-events-none absolute inset-x-4 top-[40%] mx-auto max-w-[360px] rounded-input bg-surface/90 px-3 py-2 text-center font-mono text-[12px] text-faint">No payment in this range yet: the first one shows here within seconds of confirming.</span>}
            </EChart>
          ) : (
            <ChartBox height={240} state={err ? 'error' : 'loading'} onRetry={load} />
          )}
          <span className={label}>Payments per day</span>
          {countOption ? <EChart option={countOption} height={90} label="Payments per day" /> : <ChartBox height={90} state={err ? 'error' : 'loading'} />}
        </div>
        <div className="flex min-w-0 flex-col gap-2">
          <span className={label}>Asset mix</span>
          {mixOption ? (
            <EChart option={mixOption} height={200} skeleton="ring" label="Share of volume by asset and chain">
              <span className="pointer-events-none absolute inset-0 grid place-items-center text-center">
                <span className="flex flex-col items-center">
                  <span className="font-display text-[22px] font-extrabold text-ink">{usd(t?.volumeUsd)}</span>
                  <span className="font-mono text-[10.5px] text-faint">{data?.range}</span>
                </span>
              </span>
            </EChart>
          ) : (
            <ChartBox height={200} variant="ring" state={err ? 'error' : 'loading'} />
          )}
          <ul className="m-0 flex list-none flex-col gap-1 p-0">
            {data?.byAsset.map((a) => {
              const [sym, chain] = a.name.split(' · ')
              const v = a.data.reduce((x, y) => x + y, 0)
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
      <div className="flex min-w-0 flex-col gap-2">
        <span className={label}>Top links by volume</span>
        {linksOption ? <EChart option={linksOption} height={Math.max(90, (data?.topLinks.length ?? 1) * 34)} label="Top pay links by volume" /> : data ? <p className="m-0 text-[13px] text-faint">No link has been opened in this range yet.</p> : <ChartBox height={90} state={err ? 'error' : 'loading'} />}
      </div>
    </Section>
  )
}
