// Live chart for the "Roadmap: Gully L3" docs page: base fee per gas over the last 128 blocks on the chains the
// L3 could settle to, read through our own GET /api/chain/fee-history (server/fee-history.mjs: eth_feeHistory on
// each chain, cached 20 s), so the browser never calls a third-party RPC. A chain that cannot be read says so;
// nothing is estimated or typed in. ECharts loads on demand inside EChart.

import { useEffect, useMemo, useState } from 'react'
import { ChainLogo } from '../components/logos/ChainLogo'
import { AnimatedNumber } from '../components/charts/AnimatedNumber'
import { EChart } from '../components/charts/EChart'
import { axisTooltip, C, linePreset, PALETTE, tipHtml } from '../components/charts/chartPresets'
import { apiOrigin } from './nav'

interface Parent {
  key: string
  name: string
  color: string
  role: string
}

/** The settlement candidates the spec weighs, plus the public devnet's parent (the server reads the same three). */
const PARENTS: Parent[] = [
  { key: 'arbitrum', name: 'Arbitrum One', color: PALETTE[0], role: 'settlement candidate (recommended)' },
  { key: 'base', name: 'Base', color: PALETTE[1], role: 'settlement candidate' },
  { key: 'arbitrumsepolia', name: 'Arbitrum Sepolia', color: PALETTE[2], role: 'parent of the public devnet (S1)' },
]

const BLOCKS = 128
const EVERY_MS = 20_000

interface FeeRead {
  /** Base fee per gas in gwei, oldest first, one per mined block. */
  gwei: number[]
  /** Number of the newest block in the series. */
  newest: number | null
  at: number
  error: string | null
}

/** One read of GET /api/chain/fee-history: every chain's series, or each chain's own error. */
async function readFeeHistory(): Promise<Record<string, FeeRead>> {
  const fail = (error: string): Record<string, FeeRead> => Object.fromEntries(PARENTS.map((p) => [p.key, { gwei: [], newest: null, at: Date.now(), error }]))
  try {
    const r = await fetch(`${apiOrigin()}/api/chain/fee-history`, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(12_000) })
    const j = (await r.json().catch(() => null)) as { chains?: { key: string; gwei: number[]; newest: number | null; error: string | null }[] } | null
    if (!r.ok || !j || !Array.isArray(j.chains)) return fail(`HTTP ${r.status}`)
    const out = fail('not in the answer')
    for (const c of j.chains) if (out[c.key]) out[c.key] = { gwei: Array.isArray(c.gwei) ? c.gwei.filter((v) => Number.isFinite(v)) : [], newest: c.newest ?? null, at: Date.now(), error: c.error ?? null }
    return out
  } catch (e) {
    return fail(e instanceof Error && e.name === 'TimeoutError' ? 'timed out' : 'unreachable')
  }
}

const digits = (v: number) => (v < 0.01 ? 4 : v < 1 ? 3 : 2)
const gweiText = (v: number) => `${v.toFixed(digits(v))} gwei`
const hhmmss = (t: number) => new Date(t).toISOString().slice(11, 19) + ' UTC'

/**
 * Base fee per gas over the last 128 blocks on Arbitrum One, Base and Arbitrum Sepolia, read every 20 s while
 * the tab is visible. Shorter series are right-aligned so "latest" lines up across chains.
 */
export function ParentChainBaseFee() {
  const [reads, setReads] = useState<Record<string, FeeRead>>({})
  useEffect(() => {
    let alive = true
    let timer: ReturnType<typeof setTimeout> | undefined
    const tick = async () => {
      if (typeof document !== 'undefined' && document.hidden) {
        timer = setTimeout(tick, EVERY_MS)
        return
      }
      const results = await readFeeHistory()
      if (!alive) return
      setReads(results)
      timer = setTimeout(tick, EVERY_MS)
    }
    tick()
    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [])

  const readable = useMemo(() => PARENTS.filter((p) => (reads[p.key]?.gwei.length ?? 0) >= 2), [reads])
  const checked = Object.keys(reads).length > 0
  const allFailed = checked && readable.length === 0
  const n = readable.length ? Math.max(...readable.map((p) => reads[p.key].gwei.length)) : 0

  const option = useMemo(() => {
    const labels = Array.from({ length: n }, (_, i) => String(i - (n - 1)))
    const fmtAxis = (v: number) => v.toFixed(digits(v))
    return {
      grid: { left: 8, right: 16, top: 30, bottom: 28, containLabel: true },
      legend: { top: 0, left: 0, textStyle: { color: C.muted }, data: readable.map((p) => p.name) },
      xAxis: {
        type: 'category',
        boundaryGap: false,
        data: labels,
        axisLabel: { formatter: (v: string) => (v === '0' ? 'latest' : v), interval: Math.max(0, Math.floor(n / 8) - 1) },
        name: 'blocks ago',
        nameLocation: 'middle',
        nameGap: 24,
        nameTextStyle: { color: C.faint, fontFamily: 'IBM Plex Mono', fontSize: 11 },
      },
      yAxis: { type: 'value', scale: true, axisLabel: { formatter: fmtAxis }, splitLine: { lineStyle: { color: C.grid } }, name: 'gwei', nameTextStyle: { color: C.faint, fontFamily: 'IBM Plex Mono', fontSize: 11 } },
      tooltip: axisTooltip((ps: { seriesName: string; dataIndex: number; value: number | null; color: string }[]) => {
        const i = ps[0]?.dataIndex ?? -1
        if (i < 0) return ''
        const ago = n - 1 - i
        return tipHtml({
          title: ago === 0 ? 'latest block' : `${ago} blocks ago`,
          rows: ps
            .filter((s) => typeof s.value === 'number')
            .map((s) => {
              const p = readable.find((x) => x.name === s.seriesName)
              const newest = p ? reads[p.key].newest : null
              return { name: s.seriesName, value: `${gweiText(s.value as number)}${newest !== null ? ` · #${newest - ago}` : ''}`, color: s.color }
            }),
        })
      }),
      series: readable.map((p) => {
        const g = reads[p.key].gwei
        const data: (number | null)[] = [...Array<null>(n - g.length).fill(null), ...g]
        return { id: p.key, name: p.name, ...linePreset({ color: p.color, width: 1.75, smooth: 0 }), data }
      }),
    }
  }, [readable, reads, n])

  return (
    <div className="flex flex-col gap-3 rounded-card border border-line bg-card-token px-4 py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-mono text-[11px] tracking-[1px] text-faint">BASE FEE PER GAS · LAST {BLOCKS} BLOCKS · LIVE FROM EACH CHAIN’S PUBLIC RPC</span>
        <span className="font-mono text-[11px] text-dim">{checked ? `read ${hhmmss(Math.max(...Object.values(reads).map((r) => r.at)))}` : 'reading…'}</span>
      </div>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,180px),1fr))] gap-3">
        {PARENTS.map((p) => {
          const r = reads[p.key]
          const last = r?.gwei.length ? r.gwei[r.gwei.length - 1] : null
          return (
            <div key={p.key} className="flex min-w-0 flex-col gap-1 rounded-[8px] border border-line bg-surface-deep px-3 py-2">
              <span className="flex items-center gap-2 font-mono text-[11px] tracking-[1px] text-faint">
                <ChainLogo chain={p.name} size={16} decorative />
                <span className="size-2 rounded-full" style={{ background: p.color }} />
                {p.name.toUpperCase()}
              </span>
              <span className="font-display text-[26px] leading-none font-bold text-ink">
                {last !== null ? (
                  <AnimatedNumber value={last} format={{ minimumFractionDigits: digits(last), maximumFractionDigits: digits(last) }} suffix=" gwei" />
                ) : (
                  <span className="text-[14px] font-normal text-muted">{!r ? 'reading…' : `unreadable (${r.error})`}</span>
                )}
              </span>
              <span className="font-mono text-[11px] text-dim">
                {p.role}
                {r?.newest !== null && r?.newest !== undefined ? ` · block #${r.newest}` : ''}
              </span>
            </div>
          )
        })}
      </div>
      <EChart
        option={option}
        height={240}
        label={`Base fee per gas over the last ${BLOCKS} blocks on Arbitrum One, Base and Arbitrum Sepolia, read live through the Gully Labs API`}
        skeleton="line"
        error={allFailed ? 'None of the chains could be read just now.' : undefined}
        steps={n ? { count: n } : undefined}
      />
      <p className="m-0 font-mono text-[11px] leading-[1.5] text-faint">
        Read by our server with <code className="text-ink-2">eth_feeHistory</code> from each chain’s public RPC (GET /api/chain/fee-history, cached 20 s). The base fee is one input to what posting an L3 batch costs; the parent’s own L1 data component is the other, and no public RPC reports it, so it is not shown.
      </p>
    </div>
  )
}
