import { Link } from 'react-router'
import { Activity, ArrowUpRight, KeyRound, Newspaper, Puzzle, type LucideIcon } from 'lucide-react'
import { StockLogo } from './tracker/StockLogo'
import { SectionHeading } from './ui'
import { DEVELOPERS_URL } from '../site-host'
import { CHAIN_SHORT, DOWN, fmtGap, UP, useTracker, type TrackerRow } from '../lib/tracker'

const BLOG_URL = 'https://blog.gullylabs.xyz'
const TRUSTED = new Set(['premium', 'discount', 'drifting', 'in-line'])

type Card = { icon: LucideIcon; label: string; title: string; body: string; cta: string } & ({ to: string } | { href: string })
const CARDS: Card[] = [
  { icon: Puzzle, label: 'EMBED', title: 'Tracker widget', body: 'One script tag puts a live ticker, a one-stock badge or a table of the widest gaps on any site.', cta: 'Build a widget', to: '/widget' },
  { icon: KeyRound, label: 'BUILD', title: 'Developer portal', body: 'Sign in with your wallet, get an API key in seconds and watch your usage live. 60 calls a minute are free with no key.', cta: 'Open the portal', href: DEVELOPERS_URL },
  { icon: Newspaper, label: 'READ', title: 'The Gully blog', body: 'How we build: launches, research on tokenised stocks and the numbers behind every venue.', cta: 'Read the blog', href: BLOG_URL },
]

/* The landing's "new" section: the tracker as a live preview (real reads only), then the developer tools. */
export function ToolsShowcase() {
  const st = useTracker()
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
        <SectionHeading label="NEW · FREE TOOLS" title={<>Built for traders <span className="text-gold">and builders</span></>} />
        <p className="m-0 max-w-[440px] text-[17px] leading-[1.55] text-muted">
          The same live data our projects run on, open to everyone: a stock token tracker, an embeddable widget, a public API and a blog.
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
          {st.k === 'ok' && <span className="mt-1 font-mono text-[11px] text-faint">Read from Chainlink and the pools themselves. Not investment advice.</span>}
        </div>
      </Link>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,280px),1fr))] gap-5">
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
