// Live chart for the "Roadmap: Gully L3" docs page: base fee per gas over the last 128 blocks on the chains the
// L3 could settle to, read from their public RPCs in this browser (owner rule: live data on every surface). A
// chain that cannot be read says so; nothing is estimated or typed in. ECharts loads on demand inside EChart.
//
// Why this still reads third-party RPCs from the browser (checked 2026-10-18): our own GET /api/pay/gas gives one
// current gas price per mainnet payment chain (eth_gasPrice, cached 3 min), not a 128-block base-fee series, and
// it does not cover Arbitrum Sepolia, the devnet's parent. No endpoint of ours serves eth_feeHistory, so the
// figure this chart needs only exists on the chains' own public RPCs.

import { useEffect, useMemo, useState } from 'react'
import { AnimatedNumber } from '../components/charts/AnimatedNumber'
import { EChart } from '../components/charts/EChart'
import { axisTooltip, C, linePreset, PALETTE, tipHtml } from '../components/charts/chartPresets'

interface Parent {
  key: string
  name: string
  /** A public JSON-RPC endpoint that answers browsers (CORS preflight checked 2026-10-17). */
  rpc: string
  color: string
  role: string
}

/** The settlement candidates the spec weighs, plus the public devnet's parent. */
const PARENTS: Parent[] = [
  { key: 'arbitrum', name: 'Arbitrum One', rpc: 'https://arb1.arbitrum.io/rpc', color: PALETTE[0], role: 'settlement candidate (recommended)' },
  { key: 'base', name: 'Base', rpc: 'https://mainnet.base.org', color: PALETTE[1], role: 'settlement candidate' },
  { key: 'arbitrumsepolia', name: 'Arbitrum Sepolia', rpc: 'https://sepolia-rollup.arbitrum.io/rpc', color: PALETTE[2], role: 'parent of the public devnet (S1)' },
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

/** `eth_feeHistory` for the last `BLOCKS` blocks: real base fees from the chain. */
async function readFeeHistory(rpc: string): Promise<FeeRead> {
  try {
    const r = await fetch(rpc, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_feeHistory', params: [`0x${BLOCKS.toString(16)}`, 'latest', []] }),
      signal: AbortSignal.timeout(8_000),
    })
    const j = (await r.json()) as { result?: { oldestBlock?: string; baseFeePerGas?: string[] }; error?: { message?: string } }
    const fees = j.result?.baseFeePerGas
    if (!r.ok || !Array.isArray(fees) || !fees.length) return { gwei: [], newest: null, at: Date.now(), error: j.error?.message ?? `HTTP ${r.status}` }
    // feeHistory returns one extra entry, the next block's base fee. Keep the mined blocks only.
    const mined = fees.slice(0, Math.max(1, fees.length - 1))
    const oldest = j.result?.oldestBlock ? parseInt(j.result.oldestBlock, 16) : null
    return { gwei: mined.map((h) => parseInt(h, 16) / 1e9), newest: oldest !== null && Number.isFinite(oldest) ? oldest + mined.length - 1 : null, at: Date.now(), error: null }
  } catch (e) {
    return { gwei: [], newest: null, at: Date.now(), error: e instanceof Error && e.name === 'TimeoutError' ? 'timed out' : 'unreachable' }
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
      const results = await Promise.all(PARENTS.map(async (p) => [p.key, await readFeeHistory(p.rpc)] as const))
      if (!alive) return
      setReads(Object.fromEntries(results))
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
    <div className="flex flex-col gap-3 rounded-[10px] border border-line bg-surface px-4 py-3">
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
        label={`Base fee per gas over the last ${BLOCKS} blocks on Arbitrum One, Base and Arbitrum Sepolia, read live from their public RPCs`}
        skeleton="line"
        error={allFailed ? 'None of the public RPCs could be read from this browser just now.' : undefined}
        steps={n ? { count: n } : undefined}
      />
      <p className="m-0 font-mono text-[11px] leading-[1.5] text-faint">
        Read with <code className="text-ink-2">eth_feeHistory</code> from arb1.arbitrum.io, mainnet.base.org and sepolia-rollup.arbitrum.io. The base fee is one input to what posting an L3 batch costs; the parent’s own L1 data component is the other, and no public RPC reports it, so it is not shown.
      </p>
    </div>
  )
}
