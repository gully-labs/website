import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router'
import { ArrowRight, BookOpen, KeyRound, Puzzle } from 'lucide-react'
import { NewTabMark } from '../components/LayoutLinks'
import { newTab } from '../components/LayoutNav'
import { APP_URL, DOCS_URL } from '../site-host'
import { ChainLogo, StockLogo } from '../components/tracker/StockLogo'
import { Seo } from '../components/Seo'
import { SocialIcon } from '../components/SocialIcon'
import { GapBars } from '../components/tracker/GapBars'
import { GapHeatmap } from '../components/tracker/GapHeatmap'
import { GapHistory } from '../components/tracker/GapHistory'
import { ChainCompare, GapHistogram, LiquidityRing, LiquidityScatter } from '../components/tracker/MoreCharts'
import { StatusBadge, TrackerTable } from '../components/tracker/TrackerTable'
import { TopMovers } from '../components/tracker/TopMovers'
import { AnimatedNumber } from '../components/charts/AnimatedNumber'
import { NF, type NumberFormat } from '../components/charts/number-formats'
import { eyebrow } from '../components/ui'
import { xPost } from '../lib/share'
import { ageText, CHAIN_NAME, DOWN, fmtCompactUsd, fmtGap, fmtPrice, gapColor, gapPost, stockPath, UP, useTracker, type TrackerRow, fairSourceLabel } from '../lib/tracker'
import { C } from '../components/charts/chartPresets'

const SHARE_URL = 'https://gullylabs.xyz/tracker'
const rise = (i: number) => ({ animation: `gl-rise .5s ${i * 0.05}s ease both` })
const card = 'flex min-w-0 flex-col gap-4 rounded-card border border-line bg-surface p-5'
const cardTitle = 'm-0 font-display text-h4 font-bold uppercase'
const cardSub = 'font-mono text-[11px] text-faint'
const idOf = (r: TrackerRow) => `${r.chain}:${r.ticker}`

/** A headline figure that rolls up on load and rolls to each new value on refresh (AnimatedNumber);
    one that could not be read shows a dash, never zero. */
function Kpi({ label, value, nf, suffix, note, tone }: { label: string; value: number | null; nf: NumberFormat; suffix?: string; note: React.ReactNode; tone?: string }) {
  return (
    <div className="group relative flex min-w-0 flex-col gap-1 overflow-hidden bg-surface px-4 py-3">
      <span className="font-mono text-[11px] tracking-[1px] text-faint">{label}</span>
      <AnimatedNumber className="font-display text-[clamp(24px,2.2cqw,32px)] leading-none font-extrabold" style={{ color: tone }} value={value} format={nf} suffix={suffix} countUp />
      <span className="truncate text-[12px] text-muted">{note}</span>
      <span aria-hidden className="absolute inset-x-0 bottom-0 h-[2px] origin-left scale-x-0 bg-gold transition-transform duration-300 group-hover:scale-x-100" />
    </div>
  )
}

function Card({ title, sub, children, i, className = '' }: { title: string; sub?: string; children: React.ReactNode; i: number; className?: string }) {
  return (
    <section className={`${card} ${className}`} style={rise(i)}>
      <div className="flex flex-col gap-1">
        <h2 className={cardTitle}>{title}</h2>
        {sub && <span className={cardSub}>{sub}</span>}
      </div>
      {children}
    </section>
  )
}

/* Stock tokens against their fair price, live, on every chain the tracker reads. Compact: one band
   of headline figures, then a grid of charts, then the table. */
/* Where a builder goes next: the same figures as JSON, as an embed, or with a higher rate limit. */
const BUILD = [
  { title: 'Public API', body: 'Every row on this page as JSON, plus 7 days of gap history. 60 calls a minute with no key.', href: `${DOCS_URL}/api`, icon: BookOpen, ext: true },
  { title: 'Embed widget', body: 'One script tag puts a live gap card for any stock on your site.', href: '/widget', icon: Puzzle, ext: false },
  { title: 'App dashboard', body: 'Sign in with a wallet and create API keys instantly: 600 calls a minute, with usage in one place.', href: APP_URL, icon: KeyRound, ext: true },
]

export function Tracker() {
  const st = useTracker()
  const [chain, setChain] = useState<string>('all')
  // A link may name a stock (?stock=robinhood:NVDA, used by the widget) to open on it.
  const [selected, setSelected] = useState<string | null>(() => {
    try {
      return new URLSearchParams(window.location.search).get('stock')
    } catch {
      return null
    }
  })
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 15_000)
    return () => clearInterval(id)
  }, [])

  const data = st.k === 'ok' ? st.data : null
  const rows = useMemo(() => (data ? data.rows.filter((r) => chain === 'all' || r.chain === chain) : []), [data, chain])
  const trusted = rows.filter((r) => r.gapPct !== null && r.status !== 'thin')
  const byAbs = [...trusted].sort((a, b) => Math.abs(b.gapPct ?? 0) - Math.abs(a.gapPct ?? 0))
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
  const pick = selected && rows.some((r) => idOf(r) === selected) ? selected : byAbs[0] ? idOf(byAbs[0]) : null
  const sel = rows.find((r) => idOf(r) === pick)
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
      <Seo title="Stock token tracker" description="Live: every tokenised stock on Robinhood Chain, BNB Chain and Solana against its fair price, with the gap, pool depth and feed time. Read from Chainlink (or, for some Solana xStocks, the issuer) and the pools themselves." />

      <section className="flex flex-col gap-4 px-page pt-10 pb-5">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="flex min-w-0 flex-col gap-2">
            <span className={eyebrow} style={rise(0)}>
              TRACKER · TOKENISED STOCKS · LIVE
            </span>
            <h1 className="m-0 font-display text-h1 font-extrabold uppercase" style={rise(1)}>
              Is your stock token <span className="text-gold whitespace-nowrap">fairly priced?</span>
            </h1>
            <p className="m-0 max-w-[680px] text-[15px] leading-[1.5] text-muted" style={rise(2)}>
              Every tokenised stock on Robinhood Chain, BNB Chain and Solana: its price in its deepest pool against its fair price from Chainlink (for Solana xStocks without a feed, the issuer's quote).
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2" style={rise(3)}>
            {chains.map((c) => (
              <span key={c.key} className="inline-flex items-center gap-2 rounded-full border border-line-strong px-3 py-[5px] font-mono text-[11px] text-ink-2">
                <span className={`size-[6px] rounded-full ${c.sessionOpen ? 'bg-green' : 'bg-faint'}`} style={c.sessionOpen ? { animation: 'gl-blink 1.6s ease-in-out infinite' } : undefined} />
                <ChainLogo chain={c.key} size={14} />
                {c.name} · {c.sessionOpen ? 'open' : 'closed'}
              </span>
            ))}
            <a href={xPost(shareText, SHARE_URL)} {...newTab} aria-label="Share the tracker on X (opens in a new tab)" className="inline-flex min-h-9 max-[859px]:min-h-11 items-center gap-2 rounded-btn bg-gold px-4 text-[13px] font-semibold text-bg transition-colors hover:bg-gold-hover hover:text-bg">
              <SocialIcon name="X" size={13} />
              Share
            </a>
          </div>
        </div>

        <div role="tablist" aria-label="Chain" className="flex w-fit max-w-full gap-1 overflow-x-auto rounded-input border border-line bg-surface p-1" style={rise(4)}>
          {[{ key: 'all', name: 'All chains' }, ...chains].map((c) => (
            <button
              key={c.key}
              role="tab"
              type="button"
              aria-selected={chain === c.key}
              onClick={() => setChain(c.key)}
              className={`inline-flex items-center gap-1.5 rounded-btn px-3 py-[6px] font-mono text-[12px] whitespace-nowrap transition-colors max-[859px]:min-h-11 ${chain === c.key ? 'bg-gold text-bg' : 'bg-transparent text-muted hover:text-ink'}`}
            >
              <ChainLogo chain={c.key} size={14} />
              {c.name}
              {data && <span className={`ml-2 ${chain === c.key ? 'text-bg/70' : 'text-faint'}`}>{c.key === 'all' ? data.rows.length : data.rows.filter((r) => r.chain === c.key).length}</span>}
            </button>
          ))}
        </div>

        {st.k === 'loading' && (
          // Holds the page's shape while the first read lands, so the footer never rises and drops.
          <div role="status" aria-label="Reading every feed and pool" className="flex min-h-[100svh] flex-col gap-4">
            <div className="h-[86px] gl-skeleton rounded-card bg-surface" />
            <div className="h-[230px] gl-skeleton [animation-delay:.1s] rounded-card bg-surface" />
            <div className="grid grid-cols-3 gap-4 max-[1199px]:grid-cols-2 max-[759px]:grid-cols-1">
              <div className="h-[420px] gl-skeleton [animation-delay:.2s] rounded-card bg-surface" />
              <div className="col-span-2 h-[420px] gl-skeleton [animation-delay:.3s] rounded-card bg-surface max-[1199px]:col-span-1" />
            </div>
          </div>
        )}
        {st.k === 'error' && <p className="m-0 font-mono text-[13px] text-error">The tracker could not be read just now. It retries every minute.</p>}
        {data?.chains.some((c) => c.poolsStale) && (
          <p className="m-0 rounded-input border border-gold-line bg-[rgba(217,181,99,.06)] px-4 py-2 font-mono text-[12px] text-ink-2">
            Pool prices for {data.chains.filter((c) => c.poolsStale).map((c) => `${c.name} are from ${ageText(c.poolsAsOf, now)}`).join('; ')}: the price source is briefly limiting requests. Fair prices are live.
          </p>
        )}

        {data && (
          <div key={`${data.generatedAt}-${chain}`} data-testid="tracker-kpis" className="grid grid-cols-2 gap-px overflow-hidden rounded-card border border-line bg-line [&>*:last-child]:col-span-2 min-[640px]:grid-cols-4 min-[1000px]:grid-cols-7 min-[1000px]:[&>*:last-child]:col-span-1" style={rise(5)}>
            {/* Seven figures: one row of seven from 1000 px; below, 4 or 2 columns with the last one spanning the
                leftover cells, so no empty grey cell is left at the end (D4-9). */}
            <Kpi label="STOCKS" value={rows.length} nf={NF.int} note={`${trusted.length} trusted pools`} />
            <Kpi label="TYPICAL GAP" value={median} nf={NF.fixed2} suffix="%" note="median" />
            <Kpi label="OFF BY 2%+" value={flagged} nf={NF.int} tone={flagged ? C.gold : undefined} note="flagged now" />
            <Kpi label="TOP PREMIUM" value={premium?.gapPct ?? null} nf={NF.signed2} suffix="%" tone={UP} note={premium ? premium.ticker : 'none'} />
            <Kpi label="TOP DISCOUNT" value={discount?.gapPct ?? null} nf={NF.signed2} suffix="%" tone={DOWN} note={discount ? discount.ticker : 'none'} />
            <Kpi label="LIQUIDITY" value={liquidity} nf={NF.compactUsd} note="all pools" />
            <Kpi label="VOLUME 24H" value={volume} nf={NF.compactUsd} note="all pools" />
          </div>
        )}
        {data && <TopMovers chain={chain} />}
      </section>

      {data && (
        <>
          <section className="grid grid-cols-[1fr_1fr_1fr] gap-4 px-page pb-4 max-[1199px]:grid-cols-2 max-[759px]:grid-cols-1">
            <Card i={0} title="Gap to fair price" sub="widest gaps · click a bar for its history" className="row-span-2 max-[1199px]:row-span-1">
              <GapBars rows={rows} inLinePct={data.rules.inLinePct} selected={pick} onSelect={select} fill />
            </Card>

            <section id="tracker-detail" className={`${card} col-span-2 scroll-mt-24 max-[1199px]:col-span-1`} style={rise(1)}>
              {sel ? (
                <>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <StockLogo row={sel} size={44} />
                      <div className="flex flex-col gap-1">
                        <span className={cardSub}>{CHAIN_NAME[sel.chain] ?? sel.chain}</span>
                        <h2 className="m-0 flex flex-wrap items-baseline gap-x-3 font-display text-h4 font-extrabold uppercase">
                          {sel.ticker}{' '}
                          <span className="font-sans text-[14px] font-normal normal-case text-muted">{sel.name}</span>
                        </h2>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <StatusBadge r={sel} />
                      <Link to={stockPath(sel)} className="inline-flex min-h-8 items-center gap-1 rounded-btn whitespace-nowrap max-[859px]:min-h-11 border border-gold-line px-3 text-[12px] text-gold hover:border-gold hover:text-gold">
                        {sel.ticker} page →
                      </Link>
                      {sel.pool?.url && (
                        <a href={sel.pool.url} {...newTab} className="inline-flex min-h-8 items-center gap-1 rounded-btn border border-line-strong px-3 text-[12px] whitespace-nowrap text-ink hover:border-gold hover:text-ink max-[859px]:min-h-11">
                          Pool <NewTabMark size={12} />
                        </a>
                      )}
                      <a href={xPost(gapPost(sel), SHARE_URL)} {...newTab} aria-label={`Post ${sel.ticker}'s gap on X (opens in a new tab)`} className="inline-flex size-8 max-[859px]:size-11 items-center justify-center rounded-btn border border-gold-line text-gold hover:border-gold hover:text-gold">
                        <SocialIcon name="X" size={12} />
                      </a>
                    </div>
                  </div>
                  <dl className="m-0 grid grid-cols-4 gap-px overflow-hidden rounded-panel border border-line bg-line max-[520px]:grid-cols-2">
                    {[
                      { k: 'ONCHAIN', v: fmtPrice(sel.onchain) },
                      { k: 'FAIR', v: fmtPrice(sel.fair) },
                      { k: 'GAP', v: fmtGap(sel.gapPct), c: gapColor(sel) },
                      { k: 'LIQUIDITY', v: fmtCompactUsd(sel.pool?.liquidityUsd) },
                    ].map((m) => (
                      <div key={m.k} className="flex flex-col gap-1 bg-surface-deep px-3 py-2">
                        <dt className="font-mono text-[11px] tracking-[1px] text-faint">{m.k}</dt>
                        <dd className="m-0 font-mono text-[15px]" style={{ color: m.c }}>
                          {m.v}
                        </dd>
                      </div>
                    ))}
                  </dl>
                  <GapHistory chain={sel.chain} ticker={sel.ticker} inLinePct={data.rules.inLinePct} />
                  <span className="font-mono text-[11px] leading-[1.5] text-faint">
                    {sel.pool ? `${sel.pool.dex}${sel.pool.labels.length ? ` ${sel.pool.labels.join('/')}` : ''} · ${sel.ticker}/${sel.pool.against}` : 'no pool'} · fair from {fairSourceLabel(sel)}, updated {ageText(sel.feedUpdatedAt, now)}
                    {sel.feedPrices === 'underlying-share' && sel.multiplier !== null ? ` · share × ${sel.multiplier.toFixed(6)}` : ''}
                  </span>
                </>
              ) : (
                <p className="m-0 font-mono text-[12px] text-faint">Select a stock to see its history.</p>
              )}
            </section>

            <Card i={2} title="How far off" sub="stocks per gap band · trusted pools">
              <GapHistogram rows={rows} />
            </Card>
            <Card i={3} title="Depth vs gap" sub="do thin pools drift further?">
              <LiquidityScatter rows={rows} inLinePct={data.rules.inLinePct} onSelect={select} />
            </Card>
          </section>

          <section className="grid grid-cols-[1fr_1fr] gap-4 px-page pb-6 max-[759px]:grid-cols-1">
            <Card i={4} title="Gap heatmap" sub="every trusted stock · tile size = pool liquidity · colour = gap · click a tile for its page" className="col-span-2 max-[759px]:col-span-1">
              <GapHeatmap rows={rows} inLinePct={data.rules.inLinePct} />
            </Card>
            <Card i={5} title="Where the liquidity is" sub="deepest stock pools, all venues">
              <LiquidityRing rows={rows} />
            </Card>
            <Card i={6} title="Chain against chain" sub={chains.map((c) => c.name).join(', ').replace(/, ([^,]*)$/, ' and $1')}>
              <ChainCompare rows={data.rows} chains={chains} />
            </Card>
          </section>

          <section className="px-page pb-12">
            <TrackerTable rows={rows} selected={pick} onSelect={select} now={now} />
          </section>

          <section aria-label="Build with this data" className="px-page pb-12">
            <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,260px),1fr))] gap-3">
              {BUILD.map((b) => (
                <a key={b.title} href={b.href} {...(b.ext ? newTab : {})} className="group flex items-start gap-4 rounded-card border border-line bg-surface p-5 text-ink transition-colors hover:border-gold hover:text-ink">
                  <span className="flex size-10 flex-none items-center justify-center rounded-btn border border-gold-line text-gold">
                    <b.icon aria-hidden size={18} strokeWidth={1.75} />
                  </span>
                  <span className="flex min-w-0 flex-col gap-1">
                    <span className="flex items-center gap-2 font-display text-[18px] font-bold uppercase">
                      {b.title}
                      {b.ext ? <NewTabMark size={15} className="text-faint transition-colors group-hover:text-gold" /> : <ArrowRight aria-hidden size={15} className="text-faint transition-colors group-hover:text-gold" />}
                    </span>
                    <span className="text-[14px] leading-[1.5] text-muted">{b.body}</span>
                  </span>
                </a>
              ))}
            </div>
          </section>

          <section className="border-t border-line bg-bg-alt px-page py-10">
            <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,280px),1fr))] gap-8">
              <div className="flex flex-col gap-2">
                <span className={eyebrow}>HOW IT WORKS</span>
                <p className="m-0 text-[14px] leading-[1.6] text-muted">
                  <b className="font-medium text-ink-2">Onchain</b> is each token's deepest pool, pools against ETH, BNB or a dollar stablecoin first, priced straight from the pool contract every minute. DexScreener and GeckoTerminal find the pool and report its liquidity and volume. <b className="font-medium text-ink-2">Fair</b> is Chainlink: on Robinhood Chain the feed prices the token; on BNB Chain it prices the share, multiplied by the token's onchain multiplier. On Solana, an xStock's fair price is the share price from a Chainlink feed on BNB Chain, Robinhood Chain or Ethereum (else the issuer's own quote) times the token's onchain multiplier, and Orca, Raydium CLMM and Meteora DLMM pools are read straight from their accounts.
                </p>
              </div>
              <div className="flex flex-col gap-2">
                <span className={eyebrow}>WHAT THE COLOURS MEAN</span>
                <p className="m-0 text-[14px] leading-[1.6] text-muted">
                  Under {data.rules.inLinePct}% is in line; {data.rules.flagPct}% or more is flagged. A pool under {fmtCompactUsd(data.rules.minLiquidityUsd)} is drawn hollow and never flagged. When a market is closed, feeds hold their last value.
                </p>
              </div>
              <div className="flex flex-col gap-2">
                <span className={eyebrow}>READ THIS FIRST</span>
                <p className="m-0 text-[14px] leading-[1.6] text-muted">Information only, not investment advice. Gaps can close or widen before a trade lands, and pools carry fees and slippage. Stock tokens are issued by third parties who can pause, block or change them.</p>
              </div>
            </div>
            <p className="m-0 mt-6 font-mono text-[11px] leading-[1.6] text-faint">
              Read at {new Date(data.generatedAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'UTC' })} UTC, refreshed every minute; history every five minutes. Pool prices now from {[...new Set(data.chains.map((c) => c.poolSource).filter(Boolean))].join(' and ') || 'no source'}. Sources: {data.sources.fair}; {data.sources.onchain}.
            </p>
          </section>
        </>
      )}
    </>
  )
}
