import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { Link } from 'react-router'
import { AnimatePresence, motion } from 'motion/react'
import { ArrowDownRight, ArrowRight, ArrowUpRight, ChevronLeft, ChevronRight } from 'lucide-react'
import { newTab } from '../LayoutNav'
import { SocialIcon } from '../SocialIcon'
import { StockLogo } from './StockLogo'
import { useReducedMotion } from '../charts/chart-utils'
import { ChartBox } from '../charts/ChartSkeleton'
import { CHART_H } from '../charts/chartPresets'
import { xPost } from '../../lib/share'
import { CHAIN_SHORT, DOWN, fmtGap, fmtPct, fmtPp, moversPost, stockPath, UP, useMovers, type Mover, type MoverWindow } from '../../lib/tracker'

/* Top movers: the stock tokens whose gap to fair (or onchain price) moved most over the last hour or
   day, from the tracker's own five-minute snapshots. A horizontally scrollable strip of cards, each a
   link to the stock's page. Cards rise in on load, glide to their new place when the ranking changes
   (motion layout), each card's bar grows to its move against the biggest move in the list, and a
   changed figure flashes. Under reduced motion cards only fade (no rise, no glide). Nothing is shown
   that the endpoint did not return: too little history reads as such. */

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
          className={`min-h-8 rounded-btn px-3 max-[859px]:min-h-11 max-[859px]:min-w-11 font-mono text-[12px] whitespace-nowrap transition-colors ${value === o.key ? 'bg-gold text-bg' : 'bg-transparent text-muted hover:text-ink'}`}
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

/** The move as a bar, scaled to the largest move in the list; grows in, then glides to new values. */
function MoveBar({ value, max, color }: { value: number | null; max: number; color?: string }) {
  const pct = value === null || !max ? 0 : Math.max(2, (Math.abs(value) / max) * 100)
  return (
    <span aria-hidden className="block h-[3px] overflow-hidden rounded-full bg-line">
      <span
        className="block h-full origin-left rounded-full"
        style={{ width: `${pct}%`, background: color ?? '#a6b0bd', transition: 'width .7s cubic-bezier(.2,.8,.2,1)', animation: 'gl-grow-x .8s .25s cubic-bezier(.2,.8,.2,1) both' }}
      />
    </span>
  )
}

function MoverCard({ m, mode, win, max }: { m: Mover; mode: Mode; win: MoverWindow; max: number }) {
  const main = mode === 'gap' ? m.gapChangePp : m.priceChangePct
  const Arrow = main === null || main === 0 ? ArrowRight : main > 0 ? ArrowUpRight : ArrowDownRight
  const mainText = mode === 'gap' ? fmtPp(m.gapChangePp) : fmtPct(m.priceChangePct)
  const what = mode === 'gap' ? 'gap' : 'onchain price'
  return (
    <Link
      to={stockPath(m)}
      aria-label={`${m.ticker} on ${CHAIN_SHORT[m.chain] ?? m.chain}: ${what} ${mainText} over ${win}, gap now ${fmtGap(m.gapPct)}. Open its page.`}
      className="group flex h-full w-[212px] flex-col gap-3 rounded-panel border border-line bg-surface-deep p-3 text-ink transition-[border-color,transform] duration-200 hover:-translate-y-[2px] hover:border-gold hover:text-ink"
    >
      <span className="flex items-center gap-[10px]">
        <StockLogo row={m} size={30} />
        <span className="flex min-w-0 flex-col">
          <b className="font-display text-[18px] leading-none font-bold">{m.ticker}</b>
          <span className="truncate font-mono text-[11px] text-faint">{CHAIN_SHORT[m.chain] ?? m.chain} · gap {fmtGap(m.gapPct)}</span>
        </span>
      </span>
      <span className="flex flex-col gap-[2px] whitespace-nowrap">
        <span className="flex items-baseline justify-between gap-2 font-mono text-[11px] tracking-[1px] text-faint">
          {mode === 'gap' ? `Δ GAP ${win.toUpperCase()}` : `PRICE ${win.toUpperCase()}`}
          <span className="tracking-normal text-dim">{mode === 'gap' ? `${fmtGap(m.gapThen)} → ${fmtGap(m.gapNow)}` : `Δ gap ${fmtPp(m.gapChangePp)}`}</span>
        </span>
        <span className="inline-flex items-center gap-1 font-mono text-[17px] font-medium" style={{ color: tone(main) }}>
          <Arrow aria-hidden size={15} strokeWidth={2.25} />
          <Flash text={mainText} />
        </span>
        <MoveBar value={main} max={max} color={tone(main)} />
      </span>
      <Spark points={m.spark} color={tone(m.gapNow) ?? '#a6b0bd'} />
    </Link>
  )
}

export function TopMovers({ chain }: { chain: string }) {
  // Retry remounts the strip, which reads the movers afresh.
  const [attempt, setAttempt] = useState(0)
  return <TopMoversView key={attempt} chain={chain} onRetry={() => setAttempt((a) => a + 1)} />
}

/** Whether the strip can scroll further left or right, kept current as it scrolls or resizes. */
function useScrollEdges(ref: React.RefObject<HTMLUListElement | null>, count: number) {
  const [edges, setEdges] = useState({ prev: false, next: false })
  const measure = useCallback(() => {
    const el = ref.current
    if (!el) return
    setEdges({ prev: el.scrollLeft > 4, next: el.scrollLeft + el.clientWidth < el.scrollWidth - 4 })
  }, [ref])
  useEffect(() => {
    const el = ref.current
    if (!el) return
    measure()
    el.addEventListener('scroll', measure, { passive: true })
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => {
      el.removeEventListener('scroll', measure)
      ro.disconnect()
    }
  }, [ref, measure, count])
  const page = (dir: 1 | -1) => ref.current?.scrollBy({ left: dir * Math.max(224, ref.current.clientWidth - 224), behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' })
  return { edges, page }
}

const arrowBtn = 'absolute top-1/2 z-10 grid size-11 -translate-y-1/2 place-items-center rounded-full border border-line-strong bg-surface-deep text-ink shadow-[0_6px_18px_rgba(0,0,0,.45)] transition-colors hover:border-gold hover:text-gold max-[599px]:hidden'

function TopMoversView({ chain, onRetry }: { chain: string; onRetry: () => void }) {
  const [mode, setMode] = useState<Mode>('gap')
  const [win, setWin] = useState<MoverWindow>('24h')
  const st = useMovers(win, { limit: 10, chain: chain === 'all' ? undefined : chain })
  const reduced = useReducedMotion()
  const titleId = useId()
  const data = st.k === 'ok' ? st.data : null
  const list = data ? (mode === 'gap' ? data.byGap : data.byPrice) : []
  const max = Math.max(0, ...list.map((m) => Math.abs((mode === 'gap' ? m.gapChangePp : m.priceChangePct) ?? 0)))
  const stripRef = useRef<HTMLUListElement>(null)
  const strip = useScrollEdges(stripRef, list.length)
  // The edge that has more cards behind it fades out, so a cut-off card reads as "scroll for more".
  const mask = strip.edges.prev && strip.edges.next ? 'linear-gradient(to right, transparent, #000 48px, #000 calc(100% - 64px), transparent)' : strip.edges.next ? 'linear-gradient(to right, #000 calc(100% - 64px), transparent)' : strip.edges.prev ? 'linear-gradient(to right, transparent, #000 48px)' : undefined

  return (
    <section aria-labelledby={titleId} className="flex min-w-0 flex-col gap-3 rounded-card border border-line bg-surface p-4" style={{ animation: 'gl-rise .5s .3s ease both' }}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <h2 id={titleId} className="m-0 font-display text-h4 font-bold uppercase">
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
              {...newTab}
              aria-label="Share top movers on X (opens in a new tab)"
              className="inline-flex min-h-11 items-center gap-2 rounded-btn border border-gold-line px-3 text-[12px] text-gold hover:border-gold hover:text-gold"
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
            <div key={i} className="h-[150px] w-[212px] flex-none gl-skeleton rounded-panel bg-surface-deep" />
          ))}
        </div>
      )}
      {st.k === 'error' && <ChartBox height={CHART_H.sm} state="error" message="Couldn't load the movers. It also retries every minute." onRetry={onRetry} />}
      {data && list.length === 0 && (
        <p className="m-0 py-4 font-mono text-[12px] text-faint">
          {data.note ?? (chain !== 'all' ? `No trusted pool on this chain has ${win} of snapshots yet.` : `No trusted pool has ${win} of snapshots yet.`)}
        </p>
      )}
      {list.length > 0 && (
        <div className="relative">
        {strip.edges.prev && (
          <button type="button" aria-label="Earlier movers" onClick={() => strip.page(-1)} className={`${arrowBtn} -left-2`}>
            <ChevronLeft aria-hidden size={18} />
          </button>
        )}
        {strip.edges.next && (
          <button type="button" aria-label="More movers" onClick={() => strip.page(1)} className={`${arrowBtn} -right-2`}>
            <ChevronRight aria-hidden size={18} />
          </button>
        )}
        <ul ref={stripRef} aria-label={`Top ${mode === 'gap' ? 'gap' : 'price'} moves over ${win}`} className="m-0 -mx-1 flex list-none snap-x gap-3 overflow-x-auto px-1 pt-[3px] pb-2 [scrollbar-width:thin]" style={{ maskImage: mask, WebkitMaskImage: mask }}>
          <AnimatePresence mode="popLayout">
            {list.map((m, i) => (
              <motion.li
                key={`${m.chain}:${m.ticker}`}
                layout={reduced ? false : 'position'}
                initial={reduced ? { opacity: 0 } : { opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.94 }}
                transition={reduced ? { duration: 0.15, ease: 'linear' } : { duration: 0.35, delay: i * 0.04, layout: { duration: 0.45, ease: [0.2, 0.7, 0.2, 1] } }}
                className="flex-none snap-start"
              >
                <MoverCard m={m} mode={mode} win={win} max={max} />
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
        </div>
      )}
      {data?.asOf && list.length > 0 && (
        <span className="font-mono text-[11px] text-faint">
          Compared {new Date(data.from!).toLocaleString('en-US', { hour: '2-digit', minute: '2-digit', month: 'short', day: 'numeric', hour12: false, timeZone: 'UTC' })} → {new Date(data.to!).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'UTC' })} UTC · {data.eligible} stocks with both points
        </span>
      )}
    </section>
  )
}
