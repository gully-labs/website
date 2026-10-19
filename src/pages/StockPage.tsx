import { useEffect, useState } from 'react'
import { copyWithToast } from '../components/ui/toast'
import { Link, Navigate, useParams } from 'react-router'
import { NotFound } from './NotFound'
import { NewTabMark } from '../components/LayoutLinks'
import { newTab } from '../components/LayoutNav'
import { ArrowLeft, BellRing, Check, Code2, Copy } from 'lucide-react'
import { Seo } from '../components/Seo'
import { SocialIcon } from '../components/SocialIcon'
import { GapHistory } from '../components/tracker/GapHistory'
import { ChainLogo, StockLogo } from '../components/tracker/StockLogo'
import { servable } from '../components/tracker/servable'
import { StatusBadge } from '../components/tracker/TrackerTable'
import { AnimatedNumber } from '../components/charts/AnimatedNumber'
import { NF } from '../components/charts/number-formats'
import { PoolDepth } from '../components/tracker/PoolDepth'
import { xPost } from '../lib/share'
import { track } from '../lib/track'
import { ageText, CHAIN_NAME, DOWN, fmtCompactUsd, fmtGap, fmtPp, gapColor, gapPost, stockPath, UP, useMovers, useTracker, type Load, type Movers, type Tracker, type TrackerRow, fairFeedChain, fairSourceLabel } from '../lib/tracker'
import { APP_URL, isLocalHost } from '../site-host'
import { eyebrow } from '../components/ui'
import { StockSwap } from '../components/swap/StockSwap'
import { HolderMap } from '../components/holders/HolderMap'
import { HoldersChip } from '../components/holders/HoldersChip'
import { TokenLogo } from '../components/logos/TokenLogo'
import { feeText, jupiterFeeText } from '../components/swap/swapConfig'

/* One stock token on one chain: everything the tracker knows about it, read live. Nothing on this page is
   typed in; a value that could not be read says so. */

const EXPLORER: Record<string, string> = { robinhood: 'https://robinhoodchain.blockscout.com/address/', bsc: 'https://bscscan.com/address/', ethereum: 'https://etherscan.io/address/', solana: 'https://solscan.io/account/' }
const card = 'flex flex-col gap-4 rounded-card border border-line bg-surface p-5'
const rise = (i: number) => ({ animation: `gl-rise .55s ${i * 0.06}s ease both` })
/** 0xd060…9EEC: both ends stay visible, so the checksum tail people verify is never cut off. */
const middle = (a: string) => (a.length > 16 ? `${a.slice(0, 8)}…${a.slice(-6)}` : a)
const iconBtn = 'inline-flex size-11 flex-none items-center justify-center rounded-btn border border-line-strong text-muted hover:border-gold hover:text-gold min-[860px]:size-8'

function useNow(ms = 15_000) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms)
    return () => clearInterval(id)
  }, [ms])
  return now
}

function CopyAddress({ label, address, chain }: { label: string; address: string; chain: string }) {
  const [copied, setCopied] = useState(false)
  const base = EXPLORER[chain]
  return (
    <div className="flex flex-col gap-1">
      <span className="font-mono text-[11px] tracking-[1px] text-faint">{label}</span>
      <span className="flex min-w-0 items-center gap-2">
        <code className="min-w-0 flex-1 truncate font-mono text-[13px] text-ink-2" title={address}>
          <span aria-hidden>{middle(address)}</span>
          <span className="sr-only">{address}</span>
        </code>
        <button
          type="button"
          onClick={() => copyWithToast(address, 'Address').then((ok) => ok && (setCopied(true), setTimeout(() => setCopied(false), 1500)))}
          aria-label={`Copy ${label.toLowerCase()}`}
          className={iconBtn}
        >
          {copied ? <Check aria-hidden size={13} className="text-green" /> : <Copy aria-hidden size={13} />}
        </button>
        {base && (
          <a href={base + address} {...newTab} aria-label={`${label} on the explorer (opens in a new tab)`} className={iconBtn}>
            <NewTabMark size={13} className="flex-none" />
          </a>
        )}
      </span>
    </div>
  )
}

/** A live price: rolls up on load, then rolls to each new read; unreadable shows a dash. */
function Price({ value }: { value: number | null }) {
  return <AnimatedNumber value={value} format={value !== null && value < 1 ? NF.usd4 : NF.usd} countUp />
}

/** One window's gap change for this stock, from /api/tracker/movers, with why when there is none. */
type KpiCell = { k: string; v: React.ReactNode; c?: string; n: string }

function moveCell(k: string, st: Load<Movers>, row: TrackerRow): KpiCell {
  if (st.k === 'loading') return { k, v: '…', n: 'reading snapshots' }
  if (st.k === 'error') return { k, v: '—', n: 'could not be read' }
  const m = st.data.stock
  if (!m) return { k, v: '—', n: !['premium', 'discount', 'drifting', 'in-line'].includes(row.status) ? 'not a trusted pool now' : `needs ${st.data.window} of snapshots` }
  return { k, v: fmtPp(m.gapChangePp), c: m.gapChangePp === 0 ? undefined : m.gapChangePp > 0 ? UP : DOWN, n: `${fmtGap(m.gapThen)} → ${fmtGap(m.gapNow)}` }
}

function Body({ data, row }: { data: Tracker; row: TrackerRow }) {
  const now = useNow()
  const move1h = useMovers('1h', { limit: 1, chain: row.chain, ticker: row.ticker })
  const move24h = useMovers('24h', { limit: 1, chain: row.chain, ticker: row.ticker })
  const chain = data.chains.find((c) => c.key === row.chain)
  const tone = gapColor(row)
  const siblings = data.rows.filter((r) => r.chain === row.chain && r.ticker !== row.ticker)
  const elsewhere = data.rows.filter((r) => r.ticker === row.ticker && r.chain !== row.chain)
  const shareUrl = `https://gullylabs.xyz${stockPath(row)}`
  // The portal's Alerts tab, naming this stock (?alert=chain:TICKER) so the new-alert dialog can open prefilled.
  const alerts = `${isLocalHost() ? '/app' : `${APP_URL}/`}?alert=${row.chain}:${row.ticker}#alerts`
  // The app is another host in production: it opens in a new tab there (the local /app route stays in place).
  const alertsExt = /^https?:/.test(alerts)
  const embed = `<div data-gully-widget="badge" data-ticker="${row.ticker}" data-chain="${row.chain}"></div>\n<script src="https://gullylabs.xyz/widget.js" async></script>`
  const [copiedEmbed, setCopiedEmbed] = useState(false)

  return (
    <>
      <Seo
        title={`${row.ticker} token price vs fair price`}
        description={`${row.name} (${row.ticker}) token on ${CHAIN_NAME[row.chain] ?? row.chain}: its price in its deepest pool against its ${fairSourceLabel(row)} fair price, the gap, pool depth and history, read live.`}
      />

      <section className="px-page pt-10 pb-8">
        <nav aria-label="Breadcrumb" className="mb-6 flex flex-wrap items-center gap-2 font-mono text-[12px] text-faint" style={rise(0)}>
          <Link to="/tracker" className="inline-flex min-h-11 items-center gap-1 text-muted hover:text-gold">
            <ArrowLeft aria-hidden size={13} /> Stock tracker
          </Link>
          <span>/</span>
          <span className="inline-flex items-center gap-1">
            <ChainLogo chain={row.chain} size={12} /> {CHAIN_NAME[row.chain] ?? row.chain}
          </span>
          <span>/</span>
          <span className="text-ink-2">{row.ticker}</span>
        </nav>

        <div className="flex flex-wrap items-start justify-between gap-6">
          <div className="flex items-center gap-5" style={rise(1)}>
            <StockLogo row={row} size={72} />
            <div className="flex flex-col gap-2">
              <span className={eyebrow}>STOCK TOKEN · {(CHAIN_NAME[row.chain] ?? row.chain).toUpperCase()}</span>
              <h1 className="m-0 flex flex-wrap items-baseline gap-x-4 font-display text-h1 font-extrabold uppercase">
                {row.ticker}{' '}
                <span className="font-sans text-[18px] font-normal normal-case text-muted">{row.name}</span>
              </h1>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2" style={rise(2)}>
            <StatusBadge r={row} />
            {row.pool?.url && (
              <a href={row.pool.url} {...newTab} className="inline-flex min-h-11 items-center gap-2 rounded-btn bg-gold px-4 text-[14px] font-semibold text-bg hover:bg-gold-hover hover:text-bg">
                Open the pool on DexScreener <NewTabMark size={15} className="flex-none" />
              </a>
            )}
            <HoldersChip chain={row.chain} token={row.ticker} symbol={row.ticker} className="!h-11 px-4 text-[14px]" />
            <a href={xPost(gapPost(row), shareUrl)} {...newTab} aria-label={`Post ${row.ticker}'s gap on X (opens in a new tab)`} className="inline-flex size-11 items-center justify-center rounded-btn border border-gold-line text-gold hover:border-gold hover:text-gold">
              <SocialIcon name="X" size={14} />
              <NewTabMark size={11} className="flex-none" />
            </a>
          </div>
        </div>

        <dl className="m-0 mt-8 grid grid-cols-8 gap-px overflow-hidden rounded-card border border-line bg-line max-[1279px]:grid-cols-4 max-[599px]:grid-cols-2" style={rise(3)}>
          {(
            [
              { k: 'ONCHAIN', v: <Price value={row.onchain} />, n: row.pool ? `${row.ticker}/${row.pool.against}` : 'no pool' },
              { k: 'FAIR', v: <Price value={row.fair} />, n: `${fairSourceLabel(row)} · ${ageText(row.feedUpdatedAt, now)}` },
              { k: 'GAP', v: <AnimatedNumber value={row.gapPct} format={NF.signed2} suffix="%" countUp />, c: tone, n: row.status === 'thin' ? 'thin pool, not trusted' : 'onchain vs fair' },
              moveCell('GAP Δ 1H', move1h, row),
              moveCell('GAP Δ 24H', move24h, row),
              { k: 'LIQUIDITY', v: <AnimatedNumber value={row.pool?.liquidityUsd} format={NF.compactUsd} countUp />, n: 'deepest pool' },
              { k: 'VOLUME 24H', v: <AnimatedNumber value={row.pool?.volume24hUsd} format={NF.compactUsd} countUp />, n: 'deepest pool' },
              { k: 'ALL POOLS', v: row.pool ? String(row.pool.pools) : '—', n: row.pool ? `${fmtCompactUsd(row.pool.totalLiquidityUsd)} liquidity` : 'none found' },
            ] as KpiCell[]
          ).map((m) => (
            <div key={m.k} className="flex min-w-0 flex-col gap-1 bg-surface px-5 py-4">
              <dt className="font-mono text-[11px] tracking-[1px] text-faint">{m.k}</dt>
              <dd className="m-0 font-display text-[30px] leading-none font-bold" style={{ color: m.c }}>
                {m.v}
              </dd>
              <span className="text-[12px] text-dim">{m.n}</span>
            </div>
          ))}
        </dl>
      </section>

      <section className="grid grid-cols-[2fr_1fr] items-start gap-5 px-page pb-8 max-[1099px]:grid-cols-1">
        <div className="flex min-w-0 flex-col gap-5">
          <div className={card} style={rise(4)}>
            <h2 className="m-0 font-display text-h4 font-bold uppercase">Gap to fair price</h2>
            <GapHistory chain={row.chain} ticker={row.ticker} inLinePct={data.rules.inLinePct} />
            <span className="font-mono text-[11px] leading-[1.5] text-faint">
              {row.pool ? `${row.pool.dex}${row.pool.labels.length ? ` ${row.pool.labels.join('/')}` : ''} · ${row.ticker}/${row.pool.against}` : 'no pool'} · {chain?.fairMethod ?? 'fair from Chainlink'}
              {row.feedPrices === 'underlying-share' && row.multiplier !== null ? ` · share × ${row.multiplier.toFixed(6)}` : ''}
              {chain ? ` · market ${(row.sessionOpen ?? chain.sessionOpen) ? 'open' : 'closed'} (${row.sessionName ?? chain.sessionName})` : ''}
            </span>
          </div>
          <div className={card} style={rise(5)}>
            <h2 className="m-0 font-display text-h4 font-bold uppercase">Pool depth</h2>
            <PoolDepth pool={row.pool} ticker={row.ticker} />
          </div>
        </div>

        <div className="flex min-w-0 flex-col gap-5">
          <div id="swap" className={`${card} scroll-mt-24`} style={rise(5)}>
            <h2 className="m-0 font-display text-h4 font-bold uppercase">Swap {row.ticker}</h2>
            <StockSwap row={row} alerts={alerts} />
          </div>
          <div className={card} style={rise(6)}>
            <h2 className="m-0 font-display text-h4 font-bold uppercase">Contracts</h2>
            <CopyAddress label="TOKEN" address={row.token} chain={row.chain} />
            <CopyAddress label={row.fairSource === 'backed' ? 'FAIR PRICE SOURCE' : row.chain === 'solana' ? `CHAINLINK FEED · ${fairSourceLabel(row).replace('Chainlink on ', '').toUpperCase()}` : 'CHAINLINK FEED'} address={row.feed} chain={fairFeedChain(row)} />
            {row.pool && <CopyAddress label="POOL" address={row.pool.pair} chain={row.chain} />}
          </div>
          <div className={card} style={rise(7)}>
            <h2 className="m-0 font-display text-h4 font-bold uppercase">Follow {row.ticker}</h2>
            <a
              href={alerts}
              {...(alertsExt ? newTab : {})}
              onClick={() => {
                track('cta-click', { cta: 'stock-alert', page: location.pathname })
                track('launch-app', { from: 'stock-page' })
              }}
              className="inline-flex min-h-11 items-center gap-2 rounded-btn border border-line-strong px-4 text-[14px] text-ink hover:border-gold hover:text-ink"
            >
              <BellRing aria-hidden size={16} className="text-gold" /> Alert me when the gap moves
              {alertsExt && <NewTabMark />}
            </a>
            <button
              type="button"
              onClick={() => copyWithToast(embed, 'Snippet').then((ok) => ok && (setCopiedEmbed(true), setTimeout(() => setCopiedEmbed(false), 1500)))}
              className="inline-flex min-h-11 items-center gap-2 rounded-btn border border-line-strong bg-transparent px-4 text-left text-[14px] text-ink hover:border-gold"
            >
              {copiedEmbed ? <Check aria-hidden size={16} className="text-green" /> : <Code2 aria-hidden size={16} className="text-gold" />}
              {copiedEmbed ? 'Embed code copied' : `Copy a live ${row.ticker} badge for your site`}
            </button>
            {elsewhere.map((r) => (
              <Link key={r.chain} to={stockPath(r)} className="inline-flex min-h-11 items-center gap-2 rounded-btn border border-line-strong px-4 text-[14px] text-ink hover:border-gold hover:text-ink">
                <TokenLogo symbol={r.ticker} chain={servable(r.chain, r.token) ? r.chain : null} address={servable(r.chain, r.token) ? r.token : null} size={16} decorative /> {r.ticker} on {CHAIN_NAME[r.chain] ?? r.chain} · {fmtGap(r.gapPct)}
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* The map itself says "coming soon" where the chain has no archive RPC (the server decides, same as the
          /holders chips), so this section never shows a map-shaped box that cannot be read. */}
      <section className="px-page pb-8" aria-labelledby="who-holds" id="holders">
        <h2 id="who-holds" className="m-0 mb-4 flex items-center gap-3 font-display text-h4 font-bold uppercase">
          <TokenLogo symbol={row.ticker} chain={servable(row.chain, row.token) ? row.chain : null} address={servable(row.chain, row.token) ? row.token : null} size={24} decorative /> Who holds {row.ticker}?
        </h2>
        <HolderMap chain={row.chain} token={row.ticker} tradeHref="#swap" />
      </section>

      <section className="px-page pb-8" aria-labelledby="how-swaps-work">
        <h2 id="how-swaps-work" className="m-0 mb-4 font-display text-h4 font-bold uppercase">How swaps work</h2>
        <dl className="m-0 grid grid-cols-[repeat(auto-fit,minmax(min(100%,260px),1fr))] gap-5">
          {[
            { q: 'Who runs the swap?', a: row.chain === 'solana' ? `The swap card asks Jupiter, Solana's swap aggregator, for the best route among the Solana exchanges that trade ${row.symbol ?? row.ticker} and has it build the transaction; your wallet signs it and those exchanges carry it out.` : `The swap card is LI.FI's widget. LI.FI looks for the best route among the exchanges on ${CHAIN_NAME[row.chain] ?? row.chain} that trade ${row.ticker} and builds the transaction; those exchanges carry it out.` },
            { q: 'Does Gully Labs hold my funds?', a: 'No. Your wallet signs each transaction and tokens move straight between your wallet and the exchange contracts. Gully Labs never has custody and cannot reverse a swap.' },
            { q: 'What does it cost?', a: `The quote shows the network fee, the exchange fees and the expected slippage before you confirm. ${row.chain === 'solana' ? jupiterFeeText() : feeText()}` },
            { q: 'Who can use it?', a: `Not US persons, and not in sanctioned regions; the card stays closed there. ${row.ticker} is issued by a third party whose own terms apply and who can pause or block the token.` },
          ].map((f) => (
            <div key={f.q} className="flex flex-col gap-2 rounded-card border border-line bg-surface p-5">
              <dt className="text-[15px] font-semibold text-ink">{f.q}</dt>
              <dd className="m-0 text-[14px] leading-[1.6] text-muted">{f.a}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="px-page pb-16">
        <h2 className="m-0 mb-4 font-display text-h4 font-bold uppercase">More on {CHAIN_NAME[row.chain] ?? row.chain}</h2>
        <div className="flex flex-wrap gap-2">
          {siblings.map((r) => (
            <Link key={r.ticker} to={stockPath(r)} className="inline-flex min-h-11 items-center gap-2 rounded-full border border-line bg-surface py-[5px] pr-3 pl-[5px] text-[13px] text-ink-2 transition-colors hover:border-gold hover:text-ink">
              <StockLogo row={r} size={22} chainBadge={false} />
              <b className="font-display text-[14px]">{r.ticker}</b>
              <span className="font-mono text-[12px]" style={{ color: gapColor(r) }}>
                {fmtGap(r.gapPct)}
              </span>
            </Link>
          ))}
        </div>
        <p className="m-0 mt-8 max-w-[760px] text-[13px] leading-[1.6] text-faint">
          Information only, not investment advice. Gaps can close or widen before a trade lands, and pools carry fees and slippage. Stock tokens are issued by third parties who can pause, block or change them, and may not be available where you live.
        </p>
      </section>
    </>
  )
}

export function StockPage() {
  const { chain = '', ticker = '' } = useParams()
  const st = useTracker()
  if (st.k === 'loading')
    return (
      <section role="status" aria-label="Reading the tracker" className="min-h-[100svh] px-page pt-10 pb-24">
        <div className="h-[14px] w-[220px] gl-skeleton rounded-full bg-surface" />
        <div className="mt-8 h-[72px] w-[min(420px,100%)] gl-skeleton rounded-card bg-surface" />
        <div className="mt-8 h-[110px] gl-skeleton rounded-card bg-surface" />
        <div className="mt-8 h-[420px] gl-skeleton rounded-card bg-surface" />
      </section>
    )
  if (st.k === 'error')
    return (
      <section className="px-page py-24">
        <p className="m-0 font-mono text-[14px] text-faint">The tracker could not be read just now. Try again in a minute.</p>
      </section>
    )
  const row = st.data.rows.find((r) => r.chain === chain && r.ticker === ticker.toUpperCase())
  // A ticker the tracker does not follow (or not on this chain): say so, with a search, not a silent redirect.
  if (!row) return <NotFound ticker={ticker.toUpperCase()} chain={chain} />
  if (ticker !== row.ticker) return <Navigate to={stockPath(row)} replace />
  return <Body data={st.data} row={row} />
}
