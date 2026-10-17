import { useId, useState } from 'react'
import { Link } from 'react-router'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { ArrowDownRight, ArrowRight, ArrowUpRight } from 'lucide-react'
import { SocialIcon } from '../SocialIcon'
import { StockLogo } from './StockLogo'
import { xPost } from '../../lib/share'
import { CHAIN_SHORT, DOWN, fmtGap, fmtPct, fmtPp, moversPost, stockPath, UP, useMovers, type Mover, type MoverWindow } from '../../lib/tracker'

/* Top movers: the stock tokens whose gap to fair (or onchain price) moved most over the last hour or
   day, from the tracker's own five-minute snapshots. A horizontally scrollable strip of cards, each a
   link to the stock's page. Cards rise in on load, glide to their new place when the ranking changes,
   and a changed figure flashes. Nothing is shown that the endpoint did not return: too little history
   reads as such. */

type Mode = 'gap' | 'price'
const SHARE_URL = 'https://gullylabs.xyz/tracker'
const tone = (v: number | null) => (v === null || v === 0 ? undefined : v > 0 ? UP : DOWN)

function Segmented<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: { key: T; name: string }[]; onChange: (v: T) => void }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex gap-1 rounded-input border border-line bg-surface-deep p-1">
      {options.map((o) => (
        <button
          key={o.key}
          type="button"
          role="radio"
          aria-checked={value === o.key}
          onClick={() => onChange(o.key)}
          className={`min-h-8 rounded-btn px-3 font-mono text-[12px] whitespace-nowrap transition-colors ${value === o.key ? 'bg-gold text-bg' : 'bg-transparent text-muted hover:text-ink'}`}
        >
          {o.name}
        </button>
      ))}
    </div>
  )
}

/** The window's gap as a tiny line with a zero rule; only drawn with two or more points. */
function Spark({ points, color }: { points: [number, number][]; color: string }) {
  if (points.length < 2) return <span aria-hidden className="h-[26px]" />
  const W = 188
  const H = 26
  const t0 = points[0][0]
  const t1 = points[points.length - 1][0]
  const vals = points.map((p) => p[1])
  const lo = Math.min(0, ...vals)
  const hi = Math.max(0, ...vals)
  const span = hi - lo || 1
  const x = (t: number) => ((t - t0) / (t1 - t0 || 1)) * W
  const y = (v: number) => H - 2 - ((v - lo) / span) * (H - 4)
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${x(p[0]).toFixed(1)},${y(p[1]).toFixed(1)}`).join('')
  return (
    <svg aria-hidden width="100%" height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="block overflow-visible">
      <line x1={0} x2={W} y1={y(0)} y2={y(0)} stroke="#2c3540" strokeDasharray="2 3" />
      <path d={d} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" pathLength={1} style={{ strokeDasharray: 1, animation: 'gl-draw .9s .15s ease-out both' }} />
      <circle cx={x(t1)} cy={y(vals[vals.length - 1])} r={2.2} fill={color} />
    </svg>
  )
}

/** A figure that flashes gold when its value changes (keyed on the text). */
const Flash = ({ text, color, className = '' }: { text: string; color?: string; className?: string }) => (
  <span key={text} className={className} style={{ color, animation: 'gl-count-flash .9s ease-out' }}>
    {text}
  </span>
)

function MoverCard({ m, mode, win }: { m: Mover; mode: Mode; win: MoverWindow }) {
  const main = mode === 'gap' ? m.gapChangePp : m.priceChangePct
  const Arrow = main === null || main === 0 ? ArrowRight : main > 0 ? ArrowUpRight : ArrowDownRight
  const mainText = mode === 'gap' ? fmtPp(m.gapChangePp) : fmtPct(m.priceChangePct)
  const what = mode === 'gap' ? 'gap' : 'onchain price'
  return (
    <Link
      to={stockPath(m)}
      aria-label={`${m.ticker} on ${CHAIN_SHORT[m.chain] ?? m.chain}: ${what} ${mainText} over ${win}, gap now ${fmtGap(m.gapPct)}. Open its page.`}
      className="group flex h-full w-[212px] flex-col gap-3 rounded-[10px] border border-line bg-surface-deep p-3 text-ink transition-[border-color,transform] duration-200 hover:-translate-y-[2px] hover:border-gold hover:text-ink"
    >
      <span className="flex items-center gap-[10px]">
        <StockLogo row={m} size={30} />
        <span className="flex min-w-0 flex-col">
          <b className="font-display text-[18px] leading-none font-bold">{m.ticker}</b>
          <span className="truncate font-mono text-[10px] text-faint">{CHAIN_SHORT[m.chain] ?? m.chain} · gap {fmtGap(m.gapPct)}</span>
        </span>
      </span>
      <span className="flex flex-col gap-[2px] whitespace-nowrap">
        <span className="flex items-baseline justify-between gap-2 font-mono text-[10px] tracking-[1px] text-faint">
          {mode === 'gap' ? `Δ GAP ${win.toUpperCase()}` : `PRICE ${win.toUpperCase()}`}
          <span className="tracking-normal text-dim">{mode === 'gap' ? `${fmtGap(m.gapThen)} → ${fmtGap(m.gapNow)}` : `Δ gap ${fmtPp(m.gapChangePp)}`}</span>
        </span>
        <span className="inline-flex items-center gap-1 font-mono text-[17px] font-medium" style={{ color: tone(main) }}>
          <Arrow aria-hidden size={15} strokeWidth={2.25} />
          <Flash text={mainText} />
        </span>
      </span>
      <Spark points={m.spark} color={tone(m.gapNow) ?? '#a6b0bd'} />
    </Link>
  )
}

export function TopMovers({ chain }: { chain: string }) {
  const [mode, setMode] = useState<Mode>('gap')
  const [win, setWin] = useState<MoverWindow>('24h')
  const st = useMovers(win, { limit: 10, chain: chain === 'all' ? undefined : chain })
  const reduced = useReducedMotion()
  const titleId = useId()
  const data = st.k === 'ok' ? st.data : null
  const list = data ? (mode === 'gap' ? data.byGap : data.byPrice) : []

  return (
    <section aria-labelledby={titleId} className="flex min-w-0 flex-col gap-3 rounded-card border border-line bg-surface p-4" style={{ animation: 'gl-rise .5s .3s ease both' }}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <h2 id={titleId} className="m-0 font-display text-[20px] leading-none font-bold uppercase">
            Top movers
          </h2>
          <span className="font-mono text-[11px] text-faint">
            {data?.asOf ? `change since ${win} ago · trusted pools · from five-minute snapshots` : `change over the last ${win} · trusted pools`}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Segmented<Mode>
            label="Rank by"
            value={mode}
            onChange={setMode}
            options={[
              { key: 'gap', name: 'Gap moves' },
              { key: 'price', name: 'Price moves' },
            ]}
          />
          <Segmented<MoverWindow>
            label="Window"
            value={win}
            onChange={setWin}
            options={[
              { key: '1h', name: '1h' },
              { key: '24h', name: '24h' },
            ]}
          />
          {data && list.length > 0 && (
            <a
              href={xPost(moversPost(data, mode), SHARE_URL)}
              target="_blank"
              rel="noopener"
              className="inline-flex min-h-10 items-center gap-2 rounded-btn border border-gold-line px-3 text-[12px] text-gold hover:border-gold hover:text-gold"
            >
              <SocialIcon name="X" size={12} />
              Share top movers
            </a>
          )}
        </div>
      </div>

      {st.k === 'loading' && (
        <div aria-hidden className="flex gap-3 overflow-hidden">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="h-[150px] w-[212px] flex-none animate-pulse rounded-[10px] bg-surface-deep" />
          ))}
        </div>
      )}
      {st.k === 'error' && <p className="m-0 py-4 font-mono text-[12px] text-faint">The movers could not be read just now. It retries every minute.</p>}
      {data && list.length === 0 && (
        <p className="m-0 py-4 font-mono text-[12px] text-faint">
          {data.note ?? (chain !== 'all' ? `No trusted pool on this chain has ${win} of snapshots yet.` : `No trusted pool has ${win} of snapshots yet.`)}
        </p>
      )}
      {list.length > 0 && (
        <ul aria-label={`Top ${mode === 'gap' ? 'gap' : 'price'} moves over ${win}`} className="m-0 -mx-1 flex list-none snap-x gap-3 overflow-x-auto px-1 pt-[3px] pb-2">
          <AnimatePresence initial={!reduced} mode="popLayout">
            {list.map((m, i) => (
              <motion.li
                key={`${m.chain}:${m.ticker}`}
                layout={!reduced}
                initial={reduced ? false : { opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={reduced ? undefined : { opacity: 0, scale: 0.94 }}
                transition={{ duration: 0.35, delay: reduced ? 0 : i * 0.04, layout: { duration: 0.45, ease: [0.2, 0.7, 0.2, 1] } }}
                className="flex-none snap-start"
              >
                <MoverCard m={m} mode={mode} win={win} />
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      )}
      {data?.asOf && list.length > 0 && (
        <span className="font-mono text-[10px] text-faint">
          Compared {new Date(data.from!).toLocaleString('en-US', { hour: '2-digit', minute: '2-digit', month: 'short', day: 'numeric', hour12: false, timeZone: 'UTC' })} → {new Date(data.to!).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'UTC' })} UTC · {data.eligible} stocks with both points
        </span>
      )}
    </section>
  )
}
