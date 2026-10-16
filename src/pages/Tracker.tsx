import { useEffect, useMemo, useState } from 'react'
import { Seo } from '../components/Seo'
import { SocialIcon } from '../components/SocialIcon'
import { GapBars } from '../components/tracker/GapBars'
import { GapHistory } from '../components/tracker/GapHistory'
import { StatusBadge, TrackerTable } from '../components/tracker/TrackerTable'
import { eyebrow } from '../components/ui'
import { useCountUp } from '../hooks/useCountUp'
import { xPost } from '../lib/share'
import { ageText, CHAIN_NAME, DOWN, fmtCompactUsd, fmtGap, fmtPrice, gapPost, UP, useTracker, type TrackerRow } from '../lib/tracker'

const SHARE_URL = 'https://gullylabs.xyz/tracker'
const rise = (i: number) => ({ animation: `gl-rise .55s ${i * 0.06}s ease both` })
const card = 'flex min-w-0 flex-col gap-5 rounded-card border border-line bg-surface p-7 max-[600px]:p-5'

function Kpi({ label, value, fmt, note, tone }: { label: string; value: number | null; fmt: (v: number) => string; note: React.ReactNode; tone?: string }) {
  const n = useCountUp(value ?? 0, 1400)
  return (
    <div className="group relative flex min-w-0 flex-col gap-2 overflow-hidden bg-surface px-6 py-5">
      <span className="font-mono text-[11px] tracking-[1px] text-faint">{label}</span>
      <span className="font-display text-[clamp(30px,3cqw,44px)] leading-none font-extrabold" style={{ color: tone }} role="img" aria-label={value === null ? 'not available' : fmt(value)}>
        <span aria-hidden>{value === null ? '—' : fmt(n)}</span>
      </span>
      <span className="truncate text-[13px] text-muted">{note}</span>
      <span aria-hidden className="absolute inset-x-0 bottom-0 h-[2px] origin-left scale-x-0 bg-gold transition-transform duration-300 group-hover:scale-x-100" />
    </div>
  )
}

/* Stock tokens against their fair price, live, on every chain the tracker reads. */
export function Tracker() {
  const st = useTracker()
  const [chain, setChain] = useState<string>('all')
  const [selected, setSelected] = useState<string | null>(null)
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 15_000)
    return () => clearInterval(id)
  }, [])

  const data = st.k === 'ok' ? st.data : null
  const rows = useMemo(() => (data ? data.rows.filter((r) => chain === 'all' || r.chain === chain) : []), [data, chain])
  const trusted = rows.filter((r) => r.gapPct !== null && r.status !== 'thin')
  const premium = [...trusted].sort((a, b) => (b.gapPct ?? 0) - (a.gapPct ?? 0))[0]
  const discount = [...trusted].sort((a, b) => (a.gapPct ?? 0) - (b.gapPct ?? 0))[0]
  const median = (() => {
    const v = trusted.map((r) => Math.abs(r.gapPct ?? 0)).sort((a, b) => a - b)
    return v.length ? (v.length % 2 ? v[(v.length - 1) / 2] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2) : null
  })()
  const liquidity = rows.reduce((a, r) => a + (r.pool?.totalLiquidityUsd ?? 0), 0)
  const volume = rows.reduce((a, r) => a + (r.pool?.totalVolume24hUsd ?? 0), 0)
  const flagged = rows.filter((r) => r.status === 'premium' || r.status === 'discount').length

  // Default selection: the widest trusted gap, so the detail panel opens on something worth seeing.
  const pick = selected && rows.some((r) => `${r.chain}:${r.ticker}` === selected) ? selected : trusted.length ? `${[...trusted].sort((a, b) => Math.abs(b.gapPct ?? 0) - Math.abs(a.gapPct ?? 0))[0].chain}:${[...trusted].sort((a, b) => Math.abs(b.gapPct ?? 0) - Math.abs(a.gapPct ?? 0))[0].ticker}` : null
  const sel: TrackerRow | undefined = rows.find((r) => `${r.chain}:${r.ticker}` === pick)
  const select = (id: string) => {
    setSelected(id)
    document.getElementById('tracker-detail')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }

  const chains = data?.chains ?? []
  const shareText = data
    ? `${rows.length} tokenised stocks checked live against their fair price on ${chain === 'all' ? chains.map((c) => c.name).join(' and ') : CHAIN_NAME[chain]}. ${flagged ? `${flagged} off by 2%+ right now.` : 'All in line right now.'} by @Gully_Labs`
    : 'Live fair-price tracker for tokenised stocks by @Gully_Labs'

  return (
    <>
      <Seo title="Stock token tracker" description="Live: every tokenised stock on Robinhood Chain and BNB Chain against its fair price, with the gap, pool depth and feed time. Read from Chainlink and the pools themselves." />

      <section className="flex flex-col gap-6 px-page pt-[64px] pb-10">
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div className="flex max-w-[760px] flex-col gap-5">
            <span className={eyebrow} style={rise(0)}>
              TRACKER · TOKENISED STOCKS · LIVE
            </span>
            <h1 className="m-0 font-display text-[clamp(48px,6.4cqw,96px)] leading-[.9] font-extrabold uppercase" style={rise(1)}>
              Is your stock token <span className="text-gold">fairly priced?</span>
            </h1>
            <p className="m-0 text-[18px] leading-[1.55] text-muted" style={rise(2)}>
              Every tokenised stock on Robinhood Chain and BNB Chain, priced two ways: what it trades at in its deepest pool, and what it should be worth from Chainlink. The gap is the story.
            </p>
          </div>
          <div className="flex flex-col items-start gap-3" style={rise(3)}>
            <div className="flex flex-wrap gap-2">
              {chains.map((c) => (
                <span key={c.key} className="inline-flex items-center gap-2 rounded-full border border-line-strong px-3 py-[6px] font-mono text-[12px] text-ink-2">
                  <span className={`size-[7px] rounded-full ${c.sessionOpen ? 'bg-green' : 'bg-faint'}`} style={c.sessionOpen ? { animation: 'gl-blink 1.6s ease-in-out infinite' } : undefined} />
                  {c.name} · {c.sessionOpen ? 'market open' : 'market closed'}
                </span>
              ))}
            </div>
            <a href={xPost(shareText, SHARE_URL)} target="_blank" rel="noopener" className="inline-flex min-h-11 items-center gap-2 rounded-btn bg-gold px-[18px] text-[14px] font-semibold text-bg transition-colors hover:bg-gold-hover hover:text-bg">
              <SocialIcon name="X" size={14} />
              Share the tracker
            </a>
          </div>
        </div>

        <div role="tablist" aria-label="Chain" className="flex w-fit gap-1 rounded-input border border-line bg-surface p-1" style={rise(4)}>
          {[{ key: 'all', name: 'All chains' }, ...chains].map((c) => (
            <button
              key={c.key}
              role="tab"
              type="button"
              aria-selected={chain === c.key}
              onClick={() => setChain(c.key)}
              className={`rounded-btn px-4 py-2 font-mono text-[12px] transition-colors ${chain === c.key ? 'bg-gold text-bg' : 'bg-transparent text-muted hover:text-ink'}`}
            >
              {c.name}
              {data && <span className={`ml-2 ${chain === c.key ? 'text-bg/70' : 'text-faint'}`}>{c.key === 'all' ? data.rows.length : data.rows.filter((r) => r.chain === c.key).length}</span>}
            </button>
          ))}
        </div>

        {st.k === 'loading' && <p className="m-0 font-mono text-[13px] text-faint">Reading every feed and pool…</p>}
        {st.k === 'error' && <p className="m-0 font-mono text-[13px] text-error">The tracker could not be read just now. It retries every minute.</p>}
        {data?.chains.some((c) => c.poolsStale) && (
          <p className="m-0 rounded-input border border-gold-line bg-[rgba(232,192,96,.06)] px-4 py-3 font-mono text-[12px] text-ink-2">
            Pool prices for {data.chains.filter((c) => c.poolsStale).map((c) => `${c.name} are from ${ageText(c.poolsAsOf, now)}`).join('; ')}: the price source is briefly limiting requests. Fair prices are live.
          </p>
        )}

        {data && (
          <div key={`${data.generatedAt}-${chain}`} className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,190px),1fr))] gap-px overflow-hidden rounded-card border border-line bg-line" style={rise(5)}>
            <Kpi label="STOCKS TRACKED" value={rows.length} fmt={(v) => String(Math.round(v))} note={`${trusted.length} with a pool deep enough to trust`} />
            <Kpi label="TYPICAL GAP" value={median} fmt={(v) => `${v.toFixed(2)}%`} note="median, trusted pools" />
            <Kpi label="WIDEST PREMIUM" value={premium?.gapPct ?? null} fmt={(v) => fmtGap(v)} tone={UP} note={premium ? `${premium.ticker} · ${fmtPrice(premium.onchain)}` : 'none'} />
            <Kpi label="WIDEST DISCOUNT" value={discount?.gapPct ?? null} fmt={(v) => fmtGap(v)} tone={DOWN} note={discount ? `${discount.ticker} · ${fmtPrice(discount.onchain)}` : 'none'} />
            <Kpi label="POOL LIQUIDITY" value={liquidity} fmt={(v) => fmtCompactUsd(v)} note="across every pool of these tokens" />
            <Kpi label="VOLUME 24H" value={volume} fmt={(v) => fmtCompactUsd(v)} note="DexScreener, all pools" />
          </div>
        )}
      </section>

      {data && (
        <>
          <section className="grid grid-cols-[1.05fr_1fr] gap-5 px-page pb-10 max-[1099px]:grid-cols-1">
            <div className={card} style={rise(0)}>
              <div className="flex flex-col gap-1">
                <h2 className="m-0 font-display text-[28px] font-bold uppercase">Gap to fair price</h2>
                <span className="font-mono text-[12px] text-faint">Every stock, widest premium at the top. Click a bar for its history.</span>
              </div>
              <GapBars rows={rows} inLinePct={data.rules.inLinePct} selected={pick} onSelect={select} />
            </div>

            <div id="tracker-detail" className={`${card} scroll-mt-24`} style={rise(1)}>
              {sel ? (
                <>
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="flex flex-col gap-2">
                      <span className="font-mono text-[12px] text-faint">{CHAIN_NAME[sel.chain] ?? sel.chain}</span>
                      <h2 className="m-0 flex items-baseline gap-3 font-display text-[40px] leading-none font-extrabold uppercase">
                        {sel.ticker}
                        <span className="font-sans text-[16px] font-normal normal-case text-muted">{sel.name}</span>
                      </h2>
                    </div>
                    <StatusBadge r={sel} />
                  </div>
                  <dl className="m-0 grid grid-cols-[repeat(auto-fit,minmax(110px,1fr))] gap-px overflow-hidden rounded-[10px] border border-line bg-line">
                    {[
                      { k: 'ONCHAIN', v: fmtPrice(sel.onchain) },
                      { k: 'FAIR', v: fmtPrice(sel.fair) },
                      { k: 'GAP', v: fmtGap(sel.gapPct), c: sel.gapPct === null ? undefined : sel.gapPct >= 0 ? UP : DOWN },
                      { k: 'LIQUIDITY', v: fmtCompactUsd(sel.pool?.liquidityUsd) },
                    ].map((m) => (
                      <div key={m.k} className="flex flex-col gap-1 bg-surface-deep px-4 py-3">
                        <dt className="font-mono text-[10px] tracking-[1px] text-faint">{m.k}</dt>
                        <dd className="m-0 font-mono text-[16px]" style={{ color: m.c }}>
                          {m.v}
                        </dd>
                      </div>
                    ))}
                  </dl>
                  <GapHistory chain={sel.chain} ticker={sel.ticker} inLinePct={data.rules.inLinePct} />
                  <div className="flex flex-col gap-1 border-t border-line pt-4 font-mono text-[12px] leading-[1.6] text-faint">
                    <span>
                      Pool: {sel.pool ? `${sel.pool.dex}${sel.pool.labels.length ? ` ${sel.pool.labels.join('/')}` : ''} · ${sel.ticker}/${sel.pool.against} · ${sel.pool.pools} pool${sel.pool.pools === 1 ? '' : 's'} found` : sel.poolError ? `could not be read (${sel.poolError})` : 'none found'}
                    </span>
                    <span>
                      Fair: Chainlink, updated {ageText(sel.feedUpdatedAt, now)}
                      {sel.feedPrices === 'underlying-share' && sel.multiplier !== null ? ` · share price × multiplier ${sel.multiplier.toFixed(6)}` : ' · prices the token itself'}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {sel.pool?.url && (
                      <a href={sel.pool.url} target="_blank" rel="noopener" className="inline-flex min-h-11 items-center rounded-btn border border-line-strong px-4 text-[14px] font-medium text-ink transition-colors hover:border-gold hover:text-ink">
                        Open the pool ↗
                      </a>
                    )}
                    <a href={xPost(gapPost(sel), SHARE_URL)} target="_blank" rel="noopener" className="inline-flex min-h-11 items-center gap-2 rounded-btn border border-gold-line px-4 text-[14px] font-medium text-gold transition-colors hover:border-gold hover:text-gold">
                      <SocialIcon name="X" size={13} />
                      Post this gap
                    </a>
                  </div>
                </>
              ) : (
                <p className="m-0 font-mono text-[12px] text-faint">Select a stock to see its history.</p>
              )}
            </div>
          </section>

          <section className="px-page pb-16">
            <TrackerTable rows={rows} selected={pick} onSelect={select} now={now} />
          </section>

          <section className="border-t border-line bg-bg-alt px-page py-16">
            <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,300px),1fr))] gap-10">
              <div className="flex flex-col gap-3">
                <span className={eyebrow}>HOW IT WORKS</span>
                <p className="m-0 text-[15px] leading-[1.6] text-muted">
                  <b className="font-medium text-ink-2">Onchain</b> is the price in each token's deepest pool, preferring pools against ETH, BNB or a dollar stablecoin, read from DexScreener. <b className="font-medium text-ink-2">Fair</b> is Chainlink. On Robinhood Chain the feed prices the token itself. On BNB Chain it prices the share, so it is multiplied by the token's own multiplier, read on chain every refresh.
                </p>
              </div>
              <div className="flex flex-col gap-3">
                <span className={eyebrow}>WHAT THE COLOURS MEAN</span>
                <p className="m-0 text-[15px] leading-[1.6] text-muted">
                  Under {data.rules.inLinePct}% is in line: feeds only move on small deviations, so smaller gaps are noise. {data.rules.flagPct}% or more is flagged. A pool under {fmtCompactUsd(data.rules.minLiquidityUsd)} is drawn hollow and never flagged. When a market is closed, feeds hold their last value and gaps compare against it.
                </p>
              </div>
              <div className="flex flex-col gap-3">
                <span className={eyebrow}>READ THIS FIRST</span>
                <p className="m-0 text-[15px] leading-[1.6] text-muted">
                  Information only, not investment advice. A gap can close or widen before any trade lands, and pools carry fees and slippage. Stock tokens are issued by third parties who can pause, block or change them.
                </p>
              </div>
            </div>
            <p className="m-0 mt-10 font-mono text-[12px] leading-[1.6] text-faint">
              Read at {new Date(data.generatedAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'UTC' })} UTC and refreshed every minute. History is recorded every five minutes from {data.chains.map((c) => c.name).join(' and ')}. Sources: {data.sources.fair}; {data.sources.onchain}.
            </p>
          </section>
        </>
      )}
    </>
  )
}
