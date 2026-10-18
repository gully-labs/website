import { BarChart3, BellPlus, ChartCandlestick, ChevronLeft, ChevronRight, Rows3, Search } from 'lucide-react'
import { useMemo, useState } from 'react'
import { NF } from '../../../components/charts/number-formats'
import { Sparkline } from '../../../components/Sparkline'
import { GapBars } from '../../../components/tracker/GapBars'
import { ChainLogo, StockLogo } from '../../../components/tracker/StockLogo'
import { StatusBadge } from '../../../components/tracker/TrackerTable'
import { CHAIN_NAME, CHAIN_SHORT, DOWN, fmtGap, fmtPp, fmtPrice, gapColor, stockPath, UP, useMovers, useTracker, type Mover, type TrackerRow } from '../../../lib/tracker'
import { ExtLink } from '../ExtLink'
import { ErrorLine, Skeleton } from '../parts'
import { chip, pillSm } from '../styles'
import { useSubTab } from '../subtab'
import { SubPanel, SubTabs, type SubTabItem } from '../ui'
import { docsPage, sitePage, type ServiceCtx } from './links'
import { Section, ServiceHeader, type Status } from './ServiceHeader'

/* Tracker, in the app: the public tracker's data (GET /api/tracker, every minute) and its 24h movers
   (GET /api/tracker/movers, the sparklines), filtered by chain. Two sub-tabs keep the page inside the
   900 px budget (owner rule): "Live stocks", a compact table PAGE rows at a time with paging, search and
   the chain filter, and "Gap chart", the widest trusted gaps (press a bar to jump to its row). "Alert" on
   every row opens New gap alert preset to that stock; each stock's public page opens in a new tab. */

const PAGE = 7
const TABS = ['stocks', 'chart'] as const
type Sub = (typeof TABS)[number]

const idOf = (r: { chain: string; ticker: string }) => `${r.chain}:${r.ticker}`
const hhmm = (iso: string) => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'UTC' })
const byGap = (a: TrackerRow, b: TrackerRow) => (b.gapPct === null ? -1 : Math.abs(b.gapPct)) - (a.gapPct === null ? -1 : Math.abs(a.gapPct))

function RowSpark({ m, ticker }: { m: Mover | undefined; ticker: string }) {
  if (!m || m.spark.length < 2) return <span className="font-mono text-[11px] whitespace-nowrap text-faint">not tracked yet</span>
  const vals = m.spark.map((p) => p[1])
  const lo = Math.min(...vals)
  const c = m.gapChangePp === 0 ? '#aeb5be' : m.gapChangePp > 0 ? UP : DOWN
  const text = `${ticker} gap over 24h: ${fmtGap(m.gapThen)} to ${fmtGap(m.gapNow)} (${fmtPp(m.gapChangePp)})`
  return (
    <span className="flex items-center gap-2" title={text}>
      <span className="block h-[22px] w-[84px] shrink-0">
        <Sparkline data={vals.map((v) => v - lo + 1)} color={c} label={text} />
      </span>
      <span className="font-mono text-[11px] whitespace-nowrap" style={{ color: c }}>
        {fmtPp(m.gapChangePp)}
      </span>
    </span>
  )
}

export default function TrackerView({ ctx }: { ctx: ServiceCtx }) {
  const st = useTracker()
  const [sub, setSub] = useSubTab<Sub>('tracker', TABS, 'stocks', { hashOnOpen: false })
  const [chain, setChain] = useState('all')
  const [q, setQ] = useState('')
  const [page, setPage] = useState(0)
  const [selected, setSelected] = useState<string | null>(null)
  const movers = useMovers('24h', { limit: 50, ...(chain === 'all' ? {} : { chain }) })
  const data = st.k === 'ok' ? st.data : null
  const rows = useMemo(() => (data ? data.rows.filter((r) => chain === 'all' || r.chain === chain) : []), [data, chain])
  const spark = useMemo(() => new Map((movers.k === 'ok' ? movers.data.byGap : []).map((m) => [idOf(m), m])), [movers])
  const trusted = rows.filter((r) => r.gapPct !== null && r.status !== 'thin')
  const byAbs = [...trusted].sort((a, b) => Math.abs(b.gapPct ?? 0) - Math.abs(a.gapPct ?? 0))
  const median = (() => {
    const v = trusted.map((r) => Math.abs(r.gapPct ?? 0)).sort((a, b) => a - b)
    return v.length ? (v.length % 2 ? v[(v.length - 1) / 2] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2) : null
  })()
  const flagged = rows.filter((r) => r.status === 'premium' || r.status === 'discount').length
  // Pools with no readable liquidity are left out, never counted as $0; the note says when the sum is partial.
  const liqKnown = rows.filter((r) => typeof r.pool?.totalLiquidityUsd === 'number' && Number.isFinite(r.pool.totalLiquidityUsd))
  const liquidity = data && liqKnown.length ? liqKnown.reduce((a, r) => a + (r.pool!.totalLiquidityUsd as number), 0) : null
  const liqMissing = rows.length - liqKnown.length
  const needle = q.trim().toLowerCase()
  const shown = useMemo(() => [...rows].filter((r) => !needle || r.ticker.toLowerCase().includes(needle) || r.name.toLowerCase().includes(needle)).sort(byGap), [rows, needle])
  const pages = Math.max(1, Math.ceil(shown.length / PAGE))
  const pg = Math.min(page, pages - 1)

  const status: Status = st.k === 'ok' ? { tone: 'live', text: `live · ${hhmm(st.data.generatedAt)} UTC` } : st.k === 'error' ? { tone: 'down', text: 'unreadable' } : { tone: 'checking', text: 'reading…' }
  const chains = data?.chains ?? []
  const pending = st.k === 'error' ? 'unreadable' : '…'
  const pickChain = (k: string) => {
    setChain(k)
    setPage(0)
  }
  const items: SubTabItem<Sub>[] = [
    { id: 'stocks', label: 'Live stocks', icon: <Rows3 size={15} aria-hidden />, count: data ? rows.length : null },
    { id: 'chart', label: 'Gap chart', icon: <BarChart3 size={15} aria-hidden /> },
  ]

  const chainChips = (
    <div role="group" aria-label="Chain" className="flex flex-wrap gap-2" data-testid="tracker-chains">
      {[{ key: 'all', name: 'All chains' }, ...chains].map((c) => (
        <button key={c.key} type="button" aria-pressed={chain === c.key} onClick={() => pickChain(c.key)} className={chip(chain === c.key, true)}>
          {c.key !== 'all' && <ChainLogo chain={c.key} size={14} />}
          {c.key === 'all' ? c.name : (CHAIN_SHORT[c.key] ?? c.name)}
          {data && <span className={chain === c.key ? 'text-bg/70' : 'text-faint'}>{c.key === 'all' ? data.rows.length : data.rows.filter((r) => r.chain === c.key).length}</span>}
        </button>
      ))}
    </div>
  )

  return (
    <>
      <ServiceHeader
        icon={ChartCandlestick}
        title="Tracker"
        desc="Every tokenised stock on Robinhood Chain, BNB Chain and Solana against its fair price, read live from Chainlink and the pools."
        status={status}
        docs={docsPage('methodology')}
        page={{ href: sitePage('/tracker') }}
        tiles={[
          { label: 'STOCKS', value: data ? rows.length : null, unknown: pending, note: `${trusted.length} trusted pools` },
          { label: 'OFF BY 2%+', value: data ? flagged : null, unknown: pending, tone: flagged ? '#d9b563' : undefined, note: 'flagged now' },
          { label: 'TYPICAL GAP', value: median, format: NF.fixed2, suffix: '%', unknown: st.k === 'ok' ? 'not tracked yet' : pending, note: 'median, trusted pools' },
          { label: 'WIDEST', value: byAbs[0]?.gapPct ?? null, format: NF.signed2, suffix: '%', unknown: st.k === 'ok' ? 'none' : pending, tone: (byAbs[0]?.gapPct ?? 0) >= 0 ? UP : DOWN, note: byAbs[0] ? `${byAbs[0].ticker} · ${CHAIN_SHORT[byAbs[0].chain] ?? byAbs[0].chain}` : '—' },
          { label: 'LIQUIDITY', value: liquidity, format: NF.compactUsd, unknown: data ? 'not tracked yet' : pending, note: data && liqMissing && liqKnown.length ? `partial: ${liqMissing} pool${liqMissing === 1 ? '' : 's'} unreadable` : 'all pools', title: data && liqMissing ? `${liqMissing} of ${rows.length} pools have no readable liquidity; they are left out of this sum.` : undefined },
        ]}
      />

      <SubTabs items={items} value={sub} onChange={setSub} label="Tracker sections" idBase="tracker" />

      {st.k === 'error' && <ErrorLine>The tracker could not be read just now. It retries every minute.</ErrorLine>}

      <SubPanel idBase="tracker" value={sub}>
        {sub === 'chart' ? (
          <Section title="Gap to fair price" sub="widest trusted gaps · press a bar to find its row" aside={chainChips}>
            {data ? (
              byAbs.length ? (
                <GapBars
                  rows={byAbs.slice(0, 10)}
                  inLinePct={data.rules.inLinePct}
                  selected={selected}
                  onSelect={(id) => {
                    setSelected(id)
                    setQ('')
                    const at = [...rows].sort(byGap).findIndex((r) => idOf(r) === id)
                    setPage(at >= 0 ? Math.floor(at / PAGE) : 0)
                    setSub('stocks')
                  }}
                />
              ) : (
                <p className="m-0 animate-[gl-skeleton_2s_ease-in-out_infinite] font-mono text-[12px] text-faint">Not tracked yet: no trusted pool has a gap on this chain right now.</p>
              )
            ) : (
              <Skeleton h={280} />
            )}
          </Section>
        ) : (
          <Section
            title="Live stocks"
            sub={data ? `${shown.length} of ${rows.length} · widest gap first · every minute` : 'reading every feed and pool…'}
            aside={
              <span className="flex flex-wrap items-center gap-2">
                {chainChips}
                <label className="relative flex min-h-11 w-[200px] max-w-full items-center">
                  <span className="sr-only">Search stocks</span>
                  <Search size={14} aria-hidden className="pointer-events-none absolute left-3 text-faint" />
                  <input
                    type="search"
                    value={q}
                    onChange={(e) => {
                      setQ(e.target.value)
                      setPage(0)
                    }}
                    placeholder="NVDA, Tesla…"
                    aria-label="Search stocks"
                    className="h-11 w-full rounded-full border border-line-strong bg-bg pr-3 pl-8 text-[13px] text-ink outline-none focus:border-gold"
                  />
                </label>
              </span>
            }
          >
            {!data ? (
              <Skeleton h={320} />
            ) : (
              <div className="-mx-4">
                <table className="w-full border-collapse text-[13px]" data-testid="tracker-rows" data-total={shown.length}>
                  <thead>
                    <tr className="border-b border-line text-left font-mono text-[11px] tracking-[1px] text-faint">
                      <th className="px-4 py-2 font-medium">STOCK</th>
                      <th className="px-2 py-2 text-right font-medium max-[640px]:hidden">ONCHAIN</th>
                      <th className="px-2 py-2 text-right font-medium max-[760px]:hidden">FAIR</th>
                      <th className="px-2 py-2 text-right font-medium">GAP</th>
                      <th className="px-2 py-2 font-medium max-[560px]:hidden">24H</th>
                      <th className="px-2 py-2 font-medium max-[1000px]:hidden">STATUS</th>
                      <th className="px-4 py-2 text-right font-medium">
                        <span className="sr-only">Actions</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((r: TrackerRow, n) => {
                      const id = idOf(r)
                      const i = n - pg * PAGE
                      // Rows off this page stay in the table as empty hidden markers, so the filtered set is countable.
                      if (i < 0 || i >= PAGE) return <tr key={id} data-row={id} hidden aria-hidden />
                      const on = selected === id
                      return (
                        <tr key={id} id={`trk-${id}`} data-row={id} className={`border-b border-line transition-colors last:border-b-0 ${on ? 'bg-surface-hover' : 'hover:bg-surface-hover'}`} style={{ animation: `gl-fade .3s ${Math.min(i * 0.03, 0.3)}s ease-out both` }}>
                          <td className="px-4 py-[6px]">
                            <span className="flex items-center gap-2">
                              <StockLogo row={r} size={24} active={on} />
                              <span className="flex min-w-0 flex-col leading-tight">
                                <b className={`font-display text-[15px] font-bold ${on ? 'text-gold' : 'text-ink'}`}>{r.ticker}</b>
                                <span className="truncate font-mono text-[11px] text-faint" title={CHAIN_NAME[r.chain] ?? r.chain}>
                                  {CHAIN_SHORT[r.chain] ?? r.chain}
                                </span>
                              </span>
                            </span>
                          </td>
                          <td className="px-2 py-[6px] text-right font-mono max-[640px]:hidden">{fmtPrice(r.onchain)}</td>
                          <td className="px-2 py-[6px] text-right font-mono text-muted max-[760px]:hidden">{fmtPrice(r.fair)}</td>
                          <td className="px-2 py-[6px] text-right font-mono font-medium whitespace-nowrap" style={{ color: gapColor(r) }}>
                            {fmtGap(r.gapPct)}
                          </td>
                          <td className="px-2 py-[6px] max-[560px]:hidden">
                            <RowSpark m={spark.get(id)} ticker={r.ticker} />
                          </td>
                          <td className="px-2 py-[6px] max-[1000px]:hidden">
                            <StatusBadge r={r} />
                          </td>
                          <td className="px-4 py-[6px]">
                            <span className="flex items-center justify-end gap-1">
                              <button type="button" onClick={() => ctx.createAlert(id)} aria-label={`Add a gap alert for ${r.ticker} on ${CHAIN_NAME[r.chain] ?? r.chain}`} title="Add a gap alert" className="relative inline-flex min-h-9 items-center gap-1 rounded-full border border-gold-line px-[10px] text-[12px] text-gold transition-colors after:absolute after:inset-x-0 after:-inset-y-[4px] hover:border-gold max-[859px]:min-h-11">
                                <BellPlus size={13} aria-hidden />
                                <span className="max-[640px]:sr-only">Alert</span>
                              </button>
                              <ExtLink href={sitePage(stockPath(r))} className="relative inline-flex min-h-9 items-center gap-1 rounded-full border border-line-strong px-[10px] text-[12px] text-ink-2 transition-colors after:absolute after:inset-x-0 after:-inset-y-[4px] hover:border-gold hover:text-ink max-[859px]:min-h-11">
                                <span className="max-[640px]:sr-only">Page</span>
                                <span className="sr-only"> for {r.ticker}</span>
                              </ExtLink>
                            </span>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
                {!shown.length && <p className="m-0 px-4 py-6 text-center font-mono text-[12px] text-faint">Nothing matches.</p>}
              </div>
            )}
            {data && shown.length > 0 && (
              <nav aria-label="Stock pages" className="flex flex-wrap items-center justify-between gap-2" data-testid="tracker-pager">
                <span className="min-w-0 truncate font-mono text-[11px] text-faint" title={movers.k === 'ok' && movers.data.note ? movers.data.note : undefined}>
                  {pg * PAGE + 1}–{Math.min(shown.length, pg * PAGE + PAGE)} of {shown.length}
                  {movers.k === 'ok' && movers.data.note ? ` · ${movers.data.note}` : ''}
                </span>
                <span className="flex items-center gap-2">
                  <button type="button" className={pillSm} disabled={pg === 0} onClick={() => setPage(pg - 1)} aria-label="Previous page of stocks">
                    <ChevronLeft size={14} aria-hidden /> Prev
                  </button>
                  <span className="font-mono text-[12px] text-dim" aria-live="polite">
                    {pg + 1} / {pages}
                  </span>
                  <button type="button" className={pillSm} disabled={pg >= pages - 1} onClick={() => setPage(pg + 1)} aria-label="Next page of stocks">
                    Next <ChevronRight size={14} aria-hidden />
                  </button>
                </span>
              </nav>
            )}
          </Section>
        )}
      </SubPanel>
    </>
  )
}
