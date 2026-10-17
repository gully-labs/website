import { Link } from 'react-router'
import { Activity, ArrowUpRight, BellRing, KeyRound, Package, Puzzle, type LucideIcon } from 'lucide-react'
import { StockLogo } from './tracker/StockLogo'
import { SectionHeading } from './ui'
import { DEVELOPERS_URL } from '../site-host'
import { CHAIN_SHORT, DOWN, fmtGap, fmtPp, UP, useMovers, useTracker, type TrackerRow } from '../lib/tracker'

const TRUSTED = new Set(['premium', 'discount', 'drifting', 'in-line'])

type Card = { icon: LucideIcon; label: string; title: string; body: string; cta: string } & ({ to: string } | { href: string })
const CARDS: Card[] = [
  { icon: KeyRound, label: 'BUILD', title: 'Developer portal', body: 'Sign in with your wallet, get an API key in seconds and watch your usage live. 60 calls a minute are free with no key.', cta: 'Open the portal', href: DEVELOPERS_URL },
  { icon: BellRing, label: 'ALERTS', title: 'Plans & gap alerts', body: 'Higher limits, a year of gap history and signed webhook alerts when a stock drifts from its fair price. Paid in crypto, no custody.', cta: 'See the plans', to: '/pricing' },
  { icon: Package, label: 'SDK', title: 'TypeScript SDK', body: 'A typed client for the API and the widget as a React component. Open source, MIT.', cta: 'View on GitHub', href: 'https://github.com/gully-labs/sdk' },
  { icon: Puzzle, label: 'EMBED', title: 'Tracker widget', body: 'One script tag puts a live ticker, a one-stock badge or a table of the widest gaps on any site.', cta: 'Build a widget', to: '/widget' },
]

/* The two products built on open source, each with the snippet that starts it. */
const PRODUCTS = [
  { to: '/analytics', code: `<script defer data-web3="true"\n  src="https://analytics.gullylabs.xyz/script.js"\n  data-website-id="…"></script>`, status: 'LIVE', title: 'Gully Analytics', body: 'Web analytics that see the wallet: connects, chains and transactions next to page views, with a visit → wallet → transaction funnel.', cta: 'Explore Gully Analytics' },
  { to: '/chain-kit', code: `# your chain, your brand\nCHAIN_ID=4663\nCHAIN_TYPE=arbitrum\nNETWORK_NAME="Your Chain"`, status: 'ON REQUEST', title: 'Chain Kit', body: 'A branded Blockscout block explorer for your EVM chain, deployed and operated by Gully Labs.', cta: 'Explore Chain Kit' },
]

/* The landing's "new" section: the tracker as a live preview (real reads only), then the developer tools. */
export function ToolsShowcase() {
  const st = useTracker()
  const movers = useMovers('24h', { limit: 1 })
  const mover = movers.k === 'ok' ? (movers.data.byGap[0] ?? null) : null
  const rows = st.k === 'ok' ? st.data.rows : []
  const trusted = rows.filter((r) => TRUSTED.has(r.status) && r.gapPct !== null)
  const widest = [...trusted].sort((a, b) => Math.abs(b.gapPct!) - Math.abs(a.gapPct!)).slice(0, 5)
  const max = Math.max(1, ...widest.map((r) => Math.abs(r.gapPct!)))
  const gaps = trusted.map((r) => Math.abs(r.gapPct!)).sort((a, b) => a - b)
  const median = gaps.length ? gaps[Math.floor(gaps.length / 2)] : null
  const flagged = rows.filter((r) => r.status === 'premium' || r.status === 'discount').length
  const chains = st.k === 'ok' ? st.data.chains.length : null

  return (
    <section id="tools" className="flex flex-col gap-10 border-t border-line px-page py-24">
      <div className="flex flex-wrap items-end justify-between gap-6">
        <SectionHeading label="NEW · TOOLS & PRODUCTS" title={<>Built for traders <span className="text-gold">and builders</span></>} />
        <p className="m-0 max-w-[460px] text-[17px] leading-[1.55] text-muted">
          The live data our projects run on, open to everyone, and two products for teams: analytics that see the wallet, and block explorers for new chains.
        </p>
      </div>

      <Link
        to="/tracker"
        className="group grid grid-cols-[1fr_1.1fr] gap-8 overflow-hidden rounded-card border border-line bg-surface p-8 text-ink transition-colors hover:border-gold hover:text-ink max-[959px]:grid-cols-1 max-[959px]:p-6"
      >
        <div className="flex flex-col gap-5">
          <span className="inline-flex w-fit items-center gap-2 rounded-full border border-gold-line px-3 py-1 font-mono text-[12px] tracking-[1px] text-gold">
            <Activity aria-hidden size={14} strokeWidth={2} />
            LIVE · STOCK TOKEN TRACKER
          </span>
          <h3 className="m-0 font-display text-[clamp(34px,4cqw,52px)] leading-[.95] font-extrabold uppercase">
            Is your stock token <span className="text-gold">fairly priced?</span>
          </h3>
          <p className="m-0 max-w-[480px] text-[16px] leading-[1.6] text-muted">
            Every tokenised stock on Robinhood Chain and BNB Chain, priced from its deepest pool on chain against its Chainlink fair price. The gap, the depth
            and the feed time, refreshed every minute.
          </p>
          <dl className="m-0 grid grid-cols-3 gap-4 border-t border-line pt-5">
            {[
              ['STOCKS', st.k === 'ok' ? String(rows.length) : '—', chains ? `on ${chains} chains` : ' '],
              ['TYPICAL GAP', median === null ? '—' : `${median.toFixed(2)}%`, 'median, trusted pools'],
              ['FLAGGED', st.k === 'ok' ? String(flagged) : '—', 'off by 2% or more'],
            ].map(([k, v, n]) => (
              <div key={k} className="flex flex-col gap-1">
                <dt className="font-mono text-[11px] tracking-[1px] text-faint">{k}</dt>
                <dd className="m-0 font-display text-[34px] leading-none font-extrabold">{v}</dd>
                <span className="text-[12px] text-dim">{n}</span>
              </div>
            ))}
          </dl>
          <span className="mt-auto inline-flex items-center gap-2 text-[16px] font-semibold text-gold">
            Open the tracker <ArrowUpRight aria-hidden size={17} className="transition-transform group-hover:translate-x-[2px] group-hover:-translate-y-[2px]" />
          </span>
        </div>

        <div className="flex flex-col gap-2 rounded-card border border-line bg-bg p-5" aria-label="Widest gaps right now">
          <span className="mb-1 flex items-center justify-between font-mono text-[11px] tracking-[1px] text-faint">
            <span>WIDEST GAPS RIGHT NOW</span>
            <span className="flex items-center gap-2">
              <i aria-hidden className="size-[7px] animate-pulse rounded-full bg-green" />
              LIVE
            </span>
          </span>
          {st.k === 'loading' && Array.from({ length: 5 }, (_, i) => <div key={i} className="h-[52px] animate-pulse rounded-[8px] bg-surface" />)}
          {st.k === 'error' && <p className="m-0 py-10 text-center font-mono text-[13px] text-faint">The tracker could not be read just now.</p>}
          {st.k === 'ok' && widest.length === 0 && <p className="m-0 py-10 text-center font-mono text-[13px] text-faint">No trusted pool to compare yet.</p>}
          {widest.map((r: TrackerRow, i) => {
            const up = r.gapPct! >= 0
            return (
              <div
                key={`${r.chain}:${r.ticker}`}
                className="grid grid-cols-[auto_1fr_auto] items-center gap-3 rounded-[8px] border border-line bg-surface px-3 py-[10px]"
                style={{ animation: `gl-rise .5s ${i * 0.07}s ease both` }}
              >
                <StockLogo row={r} size={30} />
                <span className="flex min-w-0 flex-col gap-[6px]">
                  <span className="flex items-baseline gap-2 truncate">
                    <b className="font-display text-[16px] font-bold">{r.ticker}</b>
                    <span className="truncate text-[13px] text-dim">
                      {r.name} · {CHAIN_SHORT[r.chain] ?? r.chain}
                    </span>
                  </span>
                  <span className="relative h-[4px] overflow-hidden rounded-full bg-line">
                    <span
                      className="absolute inset-y-0 left-0 origin-left rounded-full"
                      style={{ width: `${(Math.abs(r.gapPct!) / max) * 100}%`, background: up ? UP : DOWN, animation: `gl-grow-x .9s ${0.2 + i * 0.07}s cubic-bezier(.2,.7,.2,1) both` }}
                    />
                  </span>
                </span>
                <b className="font-mono text-[15px] font-medium" style={{ color: up ? UP : DOWN }}>
                  {fmtGap(r.gapPct)}
                </b>
              </div>
            )
          })}
          {mover && (
            <span className="mt-1 flex flex-wrap items-baseline gap-x-2 rounded-[8px] border border-line px-3 py-2 font-mono text-[12px] text-muted">
              <span className="text-[11px] tracking-[1px] text-faint">BIGGEST MOVER 24H</span>
              <b className="font-display text-[15px] font-bold text-ink">{mover.ticker}</b>
              <span className="text-faint">{CHAIN_SHORT[mover.chain] ?? mover.chain}</span>
              <span style={{ color: mover.gapChangePp > 0 ? UP : mover.gapChangePp < 0 ? DOWN : undefined }}>gap {fmtPp(mover.gapChangePp)}</span>
              <span className="text-faint">
                ({fmtGap(mover.gapThen)} → {fmtGap(mover.gapNow)})
              </span>
            </span>
          )}
          {st.k === 'ok' && <span className="mt-1 font-mono text-[11px] text-faint">Read from Chainlink and the pools themselves. Not investment advice.</span>}
        </div>
      </Link>

      <div className="grid grid-cols-2 gap-5 max-[959px]:grid-cols-1">
        {PRODUCTS.map((p, i) => (
          <Link
            key={p.to}
            to={p.to}
            className="group flex flex-col overflow-hidden rounded-card border border-line bg-surface text-ink transition-[border-color,transform] duration-200 hover:-translate-y-1 hover:border-gold hover:text-ink"
            style={{ animation: `gl-rise .55s ${i * 0.08}s ease both` }}
          >
            <span className="flex flex-1 flex-col gap-4 p-7">
              <span className="flex items-center justify-between gap-3">
                <span className="font-display text-[34px] leading-none font-bold uppercase">{p.title}</span>
                <span className="rounded-full border border-gold-line px-3 py-1 font-mono text-[11px] tracking-[1px] whitespace-nowrap text-gold">{p.status}</span>
              </span>
              <span className="text-[15px] leading-[1.55] text-muted">{p.body}</span>
              <pre className="m-0 overflow-x-auto rounded-[10px] border border-line bg-bg px-4 py-3 font-mono text-[12.5px] leading-[1.6] text-ink-2 transition-colors group-hover:border-gold-line">
                <code>{p.code}</code>
              </pre>
              <span className="mt-auto inline-flex items-center gap-2 pt-1 text-[15px] font-semibold text-gold">
                {p.cta} <ArrowUpRight aria-hidden size={16} />
              </span>
            </span>
          </Link>
        ))}
      </div>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,260px),1fr))] gap-5">
        {CARDS.map((c) => {
          const inner = (
            <>
              <span className="flex items-center justify-between">
                <span className="flex size-11 items-center justify-center rounded-btn border border-gold-line text-gold transition-colors group-hover:bg-gold group-hover:text-bg">
                  <c.icon aria-hidden size={20} strokeWidth={1.75} />
                </span>
                <span className="font-mono text-[11px] tracking-[1.5px] text-faint">{c.label}</span>
              </span>
              <h3 className="m-0 font-display text-[26px] leading-[1.05] font-bold uppercase">{c.title}</h3>
              <p className="m-0 text-[15px] leading-[1.55] text-muted">{c.body}</p>
              <span className="mt-auto inline-flex items-center gap-2 pt-2 text-[15px] font-semibold text-gold">
                {c.cta} <ArrowUpRight aria-hidden size={16} />
              </span>
            </>
          )
          const cls = 'group flex flex-col gap-4 rounded-card border border-line bg-surface p-7 text-ink transition-[border-color,transform] duration-200 hover:-translate-y-1 hover:border-gold hover:text-ink'
          return 'to' in c ? (
            <Link key={c.title} to={c.to} className={cls}>
              {inner}
            </Link>
          ) : (
            <a key={c.title} href={c.href} className={cls}>
              {inner}
            </a>
          )
        })}
      </div>
    </section>
  )
}
