import { useMemo } from 'react'
import { AnimatedNumber } from '../../components/charts/AnimatedNumber'
import { EChart } from '../../components/charts/EChart'
import { areaPreset, axisTooltip, C, linePreset, tipHtml } from '../../components/charts/chartPresets'
import { useLiveSeries } from '../../components/charts/useLiveSeries'
import { ChainLogo } from '../../components/logos/ChainLogo'

/* "What your settlement layer costs right now": the base fee per gas over the last 128 blocks of Arbitrum One (where a
   mainnet chain settles) and Arbitrum Sepolia (where a testnet chain does), read through our own
   GET /api/chain/fee-history (server/fee-history.mjs, cached 20 s) and polled on the same 20 s. Real readings only. */

const EVERY_MS = 20_000
const CHAINS = [
  { key: 'arbitrum', name: 'Arbitrum One', note: 'mainnet settles here', color: C.gold },
  { key: 'arbitrumsepolia', name: 'Arbitrum Sepolia', note: 'testnet settles here', color: C.blue },
] as const

interface Series {
  key: string
  gwei: number[]
  newest: number | null
  error: string | null
}
const digits = (v: number) => (v < 0.01 ? 4 : v < 1 ? 3 : 2)

async function read(signal: AbortSignal): Promise<Record<string, Series>> {
  const r = await fetch('/api/chain/fee-history', { headers: { accept: 'application/json' }, signal })
  const j = (await r.json().catch(() => null)) as { chains?: Series[] } | null
  if (!r.ok || !j || !Array.isArray(j.chains)) throw new Error(`HTTP ${r.status}`)
  return Object.fromEntries(j.chains.map((c) => [c.key, { ...c, gwei: (c.gwei ?? []).filter((v) => Number.isFinite(v)) }]))
}

export function FeeLive() {
  const { data, loading, error, refresh } = useLiveSeries(read, EVERY_MS)
  const readable = useMemo(() => CHAINS.filter((c) => (data?.[c.key]?.gwei.length ?? 0) >= 2), [data])
  const n = readable.length ? Math.max(...readable.map((c) => data![c.key].gwei.length)) : 0
  const axisDigits = useMemo(() => {
    const all = readable.flatMap((c) => data![c.key].gwei)
    if (!all.length) return 2
    const hi = Math.max(...all)
    const span = hi - Math.min(...all)
    return span > 0 ? Math.min(6, Math.max(digits(hi), Math.ceil(-Math.log10(span / 5)))) : digits(hi)
  }, [readable, data])
  const option = useMemo(
    () => ({
      grid: { left: 4, right: 12, top: 10, bottom: 4, containLabel: true },
      xAxis: { type: 'category', boundaryGap: false, data: Array.from({ length: n }, (_, i) => String(i - (n - 1))), axisLabel: { formatter: (v: string) => (v === '0' ? 'now' : v), interval: Math.max(0, Math.floor(n / 4) - 1) } },
      // Enough decimals for the tick step, so a narrow range never repeats a label (0.020, 0.020, ...; D4-13).
      yAxis: { type: 'value', scale: true, axisLabel: { formatter: (v: number) => v.toFixed(axisDigits) } },
      tooltip: axisTooltip((ps: { seriesName: string; dataIndex: number; value: number | null; color: string }[]) => {
        const ago = n - 1 - (ps[0]?.dataIndex ?? 0)
        return tipHtml({ title: ago === 0 ? 'latest block' : `${ago} blocks ago`, rows: ps.filter((s) => typeof s.value === 'number').map((s) => ({ name: s.seriesName, value: `${(s.value as number).toFixed(digits(s.value as number))} gwei`, color: s.color })) })
      }),
      series: readable.map((c, k) => {
        const g = data![c.key].gwei
        return { id: c.key, name: c.name, ...(k === 0 ? areaPreset({ color: c.color, width: 1.75, smooth: 0, fill: 0.2 }) : linePreset({ color: c.color, width: 1.5, smooth: 0 })), data: [...Array<null>(n - g.length).fill(null), ...g] }
      }),
    }),
    [readable, data, n, axisDigits],
  )
  return (
    <div className="flex min-w-0 flex-col gap-3 rounded-card border border-line bg-card-token p-5 max-[600px]:p-4" data-testid="chains-fee">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-display text-[20px] leading-none font-bold uppercase">What your settlement layer costs right now</span>
        <span className="font-mono text-[11px] tracking-[1px] text-faint">LIVE · REFRESHES EVERY 20 S</span>
      </div>
      <div className="grid grid-cols-2 gap-3">
        {CHAINS.map((c) => {
          const g = data?.[c.key]?.gwei
          const last = g?.length ? g[g.length - 1] : null
          return (
            <div key={c.key} className="flex min-w-0 flex-col gap-1 rounded-btn border border-line bg-surface-deep px-3 py-2">
              <span className="flex items-center gap-2 font-mono text-[11px] tracking-[1px] text-faint">
                <ChainLogo chain={c.name} size={16} decorative />
                <span className="size-2 rounded-full" style={{ background: c.color }} />
                {c.name.toUpperCase()}
              </span>
              <span className="font-display text-[24px] leading-none font-bold">
                {last !== null ? <AnimatedNumber value={last} format={{ minimumFractionDigits: digits(last), maximumFractionDigits: digits(last) }} suffix=" gwei" /> : <span className="text-[13px] font-normal text-muted">{loading ? 'reading…' : 'not readable just now'}</span>}
              </span>
              <span className="font-mono text-[11px] text-dim">{c.note}</span>
            </div>
          )
        })}
      </div>
      <EChart option={option} height={230} label="Base fee per gas over the last 128 blocks on Arbitrum One and Arbitrum Sepolia, read live through the Gully Labs API" skeleton="line" error={!loading && readable.length === 0 && !!error ? 'The fee could not be read just now.' : undefined} onRetry={refresh} />
      <p className="m-0 font-mono text-[11px] leading-[1.5] text-faint">Base fee per gas, last 128 blocks. One input to what posting a batch costs, not a quote.</p>
    </div>
  )
}
