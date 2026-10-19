import { useMemo, useState } from 'react'
import { AnimatedNumber } from '../../components/charts/AnimatedNumber'
import { EChart } from '../../components/charts/EChart'
import type { ChartEvent } from '../../components/charts/chart-utils'
import { axisTooltip, barsPreset, C, linePreset, livePoint, PALETTE, ringPreset, tipHtml } from '../../components/charts/chartPresets'
import { GhostChart } from '../../components/charts/GhostChart'
import { TokenLogo } from '../../components/logos/TokenLogo'
import { NF } from '../../components/charts/number-formats'
import { useLiveSeries } from '../../components/charts/useLiveSeries'
import type { PayAsset } from './api'

/* The pay pages' live charts (loaded on demand with ECharts, from Checkout.tsx and LinkPage.tsx):
   - ConfirmRing: the confirmations of the payer's transaction against what its chain needs, from the
     server's verify answers (202 { confirmations, needed } while it waits, 200 once counted). The ring
     sweeps to each new count.
   - PriceChart: for a native coin, the chain's Chainlink USD price now (GET /api/pay/price, read every
     30 seconds while the page is open) against the price the quote was made at. Points are only what
     this page has read; nothing is back-filled. A read that fails says "unreadable".
   - ChainConfirmations: how many confirmations each accepted chain needs, from the pay link's assets. */

const fmtUsd = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 })
const hhmmss = (t: number) => new Date(t).toISOString().slice(11, 19)

export type RingState = 'waiting' | 'checking' | 'pending' | 'done'

export function ConfirmRing({ n, needed, state, chain }: { n: number; needed: number; state: RingState; chain: string }) {
  const have = state === 'done' ? needed : Math.min(n, needed)
  const color = state === 'done' ? '#74c27b' : C.gold
  const option = useMemo(
    () => ({
      tooltip: { show: false },
      series: [
        {
          id: 'ring',
          ...ringPreset({ radius: ['72%', '94%'], padAngle: 0 }),
          emphasis: { disabled: true },
          silent: true,
          data: [
            { name: 'confirmed', value: have, itemStyle: { color } },
            { name: 'to go', value: Math.max(0, needed - have) || (have ? 0 : 1), itemStyle: { color: C.line } },
          ],
        },
      ],
    }),
    [have, needed, color],
  )
  const text = state === 'done' ? 'Confirmed' : state === 'pending' ? 'Confirming' : state === 'checking' ? 'Reading the chain' : 'Waiting for your transaction'
  return (
    <div className="flex items-center gap-4">
      <div className="relative size-[112px] shrink-0">
        <EChart option={option} height={112} skeleton="ring" label={`Confirmations: ${have} of ${needed} on ${chain}. ${text}.`} />
        <span className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center leading-none">
          <span className="font-display text-[28px] font-extrabold text-ink">
            <AnimatedNumber value={have} />
          </span>
          <span className="mt-1 font-mono text-[11px] text-faint">of {needed}</span>
        </span>
      </div>
      <div className="flex min-w-0 flex-col gap-1">
        <span className="font-mono text-[11px] tracking-[1px] text-faint">CONFIRMATIONS</span>
        <span className={`inline-flex items-center gap-2 text-[15px] ${state === 'done' ? 'text-green' : 'text-ink'}`}>
          {state !== 'done' && <i aria-hidden className={`size-2 rounded-full ${state === 'waiting' ? 'bg-line-strong' : 'animate-pulse bg-gold'}`} />}
          {text}
        </span>
        <span className="text-[13px] leading-[1.5] text-muted">
          {state === 'done' ? `Counted after ${needed} confirmations on ${chain}.` : `${chain} needs ${needed} confirmations before the payment counts. This ring fills as blocks land.`}
        </span>
      </div>
    </div>
  )
}

interface Sample {
  t: number
  price: number
  updatedAt: string
}

/** Reads the coin's price every 30 s while mounted (useLiveSeries: paused in a hidden tab); returns the samples and the last error. */
function usePriceSamples(assetId: string) {
  const [samples, setSamples] = useState<Sample[]>([])
  const live = useLiveSeries(async (signal) => {
    const r = await fetch(`/api/pay/price?asset=${encodeURIComponent(assetId)}`, { signal })
    const d = (await r.json().catch(() => null)) as { price?: string; updatedAt?: string; error?: string } | null
    if (!r.ok) throw new Error(d?.error ?? `The server answered ${r.status}.`)
    if (!d || !Number.isFinite(Number(d.price))) throw new Error('The price answer was unreadable.')
    const sample = { t: Date.now(), price: Number(d.price), updatedAt: String(d.updatedAt ?? '') }
    if (!signal.aborted) setSamples((prev) => [...prev, sample].slice(-120))
    return sample
  }, 30_000)
  const error = live.error ? (live.error instanceof Error ? live.error.message : 'The price could not be read.') : null
  return { samples, error }
}

export function PriceChart(props: PriceChartProps) {
  // Keyed by asset: switching coin starts a fresh line (the old asset's reads are simply not shown).
  return <PriceChartBody key={props.asset.id} {...props} />
}

type PriceChartProps = Parameters<typeof PriceChartBody>[0]

function PriceChartBody({ asset, quoted }: { asset: Pick<PayAsset, 'id' | 'symbol' | 'chain'> & Partial<Pick<PayAsset, 'chainKey' | 'address'>> & { feed?: PayAsset['feed'] }; quoted?: { answer: string; updatedAt: string; label?: string } | null }) {
  const { samples, error } = usePriceSamples(asset.id)
  const q = quoted ? Number(quoted.answer) : null
  const qt = quoted ? Date.parse(quoted.updatedAt) : null
  const now = samples.at(-1)?.price ?? null
  const delta = q && now !== null ? ((now - q) / q) * 100 : null
  const points: [number, number][] = [...(q && qt ? [[qt, q] as [number, number]] : []), ...samples.map((s) => [s.t, s.price] as [number, number])]
  const pointsKey = JSON.stringify(points)
  const option = useMemo(
    () => ({
      grid: { left: 4, right: 8, top: 18, bottom: 4, containLabel: true },
      xAxis: { type: 'time', axisLabel: { color: C.axis, fontSize: 11, hideOverlap: true, formatter: (v: number) => hhmmss(v).slice(0, 5) }, axisLine: { lineStyle: { color: C.lineStrong } }, splitLine: { show: false } },
      yAxis: { type: 'value', scale: true, splitNumber: 3, splitLine: { lineStyle: { color: C.grid } }, axisLabel: { color: C.axis, fontSize: 11, formatter: (v: number) => `$${Math.round(v).toLocaleString('en-US')}` } },
      tooltip: axisTooltip((ps: ChartEvent[]) => {
        const p = ps[0]
        if (!p) return ''
        const [t, v] = p.value as [number, number]
        const isQuote = qt !== null && t === qt
        return tipHtml({
          title: isQuote ? `Chainlink price the quote used · ${hhmmss(t)} UTC` : `Read at ${hhmmss(t)} UTC`,
          rows: [
            { name: `${asset.symbol} / USD`, value: fmtUsd(v), color: C.gold },
            ...(q && !isQuote ? [{ name: 'vs quote', value: `${v >= q ? '+' : ''}${(((v - q) / q) * 100).toFixed(3)}%`, valueColor: v >= q ? '#74c27b' : C.error }] : []),
          ],
        })
      }),
      series: [
        {
          id: 'price',
          ...linePreset({ color: C.gold, width: 2, smooth: 0 }),
          showSymbol: true,
          symbolSize: 5,
          data: points,
          ...(q ? { markLine: { silent: true, symbol: 'none', lineStyle: { color: PALETTE[1], type: [4, 4] }, label: { color: PALETTE[1], fontSize: 11, formatter: 'quote' }, data: [{ yAxis: q }] } } : {}),
        },
        livePoint(points.length ? points[points.length - 1] : null),
      ],
    }),
    // points is rebuilt from samples and the quote
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pointsKey, q, asset.symbol],
  )
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <span className="flex min-w-0 flex-col gap-1">
          <span className="inline-flex items-center gap-2 font-mono text-[11px] tracking-[1px] text-faint">
            <TokenLogo symbol={asset.symbol} chain={asset.chainKey} address={asset.address} size={16} decorative />
            {asset.symbol} PRICE · CHAINLINK ON {asset.chain.toUpperCase()}
          </span>
          <span className="font-display text-[24px] leading-none font-extrabold text-ink">
            <AnimatedNumber value={now} format={NF.usd} fallback={error ? 'unreadable' : '—'} />
          </span>
        </span>
        {q !== null && (
          <span className="font-mono text-[12px] text-muted">
            {quoted?.label ?? 'at quote'} {fmtUsd(q)}
            {delta !== null && (
              <b className={`ml-2 font-medium ${delta >= 0 ? 'text-green' : 'text-error'}`}>
                <AnimatedNumber value={delta} format={{ signDisplay: 'exceptZero', minimumFractionDigits: 3, maximumFractionDigits: 3 }} suffix="%" />
              </b>
            )}
          </span>
        )}
      </div>
      {points.length < 2 && !error ? (
        <GhostChart variant="line" height={150} label={`${asset.symbol} price will draw here as it is read`} />
      ) : (
        <EChart option={option} height={150} skeleton="line" error={!samples.length && error ? `Price unreadable: ${error}` : undefined} label={`${asset.symbol} price in USD from Chainlink on ${asset.chain === 'Solana' ? 'Arbitrum' : asset.chain}${now !== null ? `, now ${fmtUsd(now)}` : ''}${q ? `, ${fmtUsd(q)} at quote time` : ''}. Read every 30 seconds while this page is open.`} />
      )}
      <span className="font-mono text-[11px] leading-[1.5] text-faint">
        Read live every 30 seconds while this page is open{q ? '. Your amount stays fixed at the quoted price until the quote runs out.' : '.'}
      </span>
    </div>
  )
}

export function ChainConfirmations({ assets }: { assets: PayAsset[] }) {
  const chains = [...new Map(assets.map((a) => [a.chain, a.confirmations])).entries()]
  const chainsKey = JSON.stringify(chains)
  const option = useMemo(
    () => ({
      grid: { left: 4, right: 40, top: 4, bottom: 4, containLabel: true },
      xAxis: { type: 'value', show: false, max: Math.max(1, ...chains.map((c) => c[1])) },
      yAxis: { type: 'category', inverse: true, data: chains.map((c) => c[0]), axisLabel: { color: C.ink2, fontSize: 12 }, axisLine: { show: false }, axisTick: { show: false } },
      tooltip: axisTooltip((ps: ChartEvent[]) => {
        const c = chains[ps[0]?.dataIndex]
        return c ? tipHtml({ title: c[0], rows: [{ name: 'confirmations needed', value: String(c[1]), color: C.gold }] }) : ''
      }, 'shadow'),
      series: [{ id: 'conf', ...barsPreset({ horizontal: true, stagger: 90 }), barWidth: 14, showBackground: true, backgroundStyle: { color: C.line, borderRadius: 4 }, label: { show: true, position: 'right', color: C.ink2, fontSize: 12 }, data: chains.map((c, i) => ({ value: c[1], itemStyle: { color: PALETTE[i % PALETTE.length], borderRadius: 4 } })) }],
    }),
    // chains derive from assets
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [chainsKey],
  )
  if (!chains.length) return null
  return (
    <div className="flex flex-col gap-2">
      <span className="font-mono text-[11px] tracking-[1px] text-faint">CONFIRMATIONS EACH CHAIN NEEDS</span>
      <EChart option={option} height={Math.max(90, chains.length * 34)} steps={{ count: chains.length }} label={`Confirmations needed: ${chains.map((c) => `${c[0]} ${c[1]}`).join(', ')}.`} />
    </div>
  )
}
