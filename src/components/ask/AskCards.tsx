import { ArrowUpRight, PencilLine } from 'lucide-react'
import { useId, useState, type KeyboardEvent } from 'react'
import type { AskAction, AskCard, CardStat } from './askApi'
import { asOfLabel, hrefProps } from './askFormat'

/* Gully AI's live cards and one-tap actions, under an answer. The server builds both from the tool results
   (server/ask.mjs cardsFrom / actionsFrom), so every figure here is exactly what the tool read, with its
   read time. The mini charts are hand-written SVG in the kit's colours: a spark line draws in, bars grow in
   (gl-draw / gl-grow-x, which index.css turns into fades under reduced motion), and both answer pointer and
   keyboard (arrow keys) with the value under the cursor. */

function fmt(v: number | null, unit: string) {
  if (v === null || !Number.isFinite(v)) return 'not read'
  if (unit === '%') return `${v > 0 ? '+' : ''}${v.toFixed(2)}%`
  if (unit === '$') return v.toLocaleString('en-US', { style: 'currency', currency: 'USD', notation: Math.abs(v) >= 100_000 ? 'compact' : 'standard', maximumFractionDigits: Math.abs(v) >= 100 ? 0 : 2 })
  return v.toLocaleString('en-US', { notation: Math.abs(v) >= 100_000 ? 'compact' : 'standard', maximumFractionDigits: 2 })
}

const TONE: Record<NonNullable<CardStat['tone']>, string> = { up: 'text-gold', down: 'text-error', ok: 'text-green', warn: 'text-muted' }

function Spark({ points, unit, label }: { points: number[]; unit: string; label: string }) {
  const [at, setAt] = useState<number | null>(null)
  const W = 240
  const H = 56
  const min = Math.min(...points)
  const max = Math.max(...points)
  const span = max - min || 1
  const x = (i: number) => (i / (points.length - 1)) * (W - 8) + 4
  const y = (v: number) => H - 6 - ((v - min) / span) * (H - 12)
  const d = points.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ')
  const zero = unit === '%' && min < 0 && max > 0 ? y(0) : null
  const last = points.length - 1
  const shown = at ?? last
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowLeft') setAt((a) => Math.max(0, (a ?? last) - 1))
    else if (e.key === 'ArrowRight') setAt((a) => Math.min(last, (a ?? last) + 1))
    else if (e.key === 'Home') setAt(0)
    else if (e.key === 'End') setAt(last)
    else return
    e.preventDefault()
  }
  return (
    <figure className="m-0 flex flex-col gap-1">
      <figcaption className="flex items-baseline justify-between gap-2 font-mono text-[11px] text-faint">
        <span>{label}</span>
        <span className="text-ink" aria-live="polite">
          {at === null ? 'now ' : `point ${at + 1}/${points.length} `}
          <b className="font-medium">{fmt(points[shown], unit)}</b>
        </span>
      </figcaption>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-[56px] w-full cursor-crosshair overflow-visible rounded-[6px] outline-none focus-visible:ring-2 focus-visible:ring-gold"
        role="img"
        tabIndex={0}
        aria-label={`${label}: ${points.length} points from ${fmt(points[0], unit)} to ${fmt(points[last], unit)}, low ${fmt(min, unit)}, high ${fmt(max, unit)}. Use the arrow keys to read each point.`}
        onKeyDown={onKey}
        onPointerMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect()
          setAt(Math.round(Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)) * last))
        }}
        onPointerLeave={() => setAt(null)}
        onBlur={() => setAt(null)}
      >
        {zero !== null && <line x1="0" x2={W} y1={zero} y2={zero} stroke="var(--color-line-strong)" strokeDasharray="3 3" />}
        <path d={d} fill="none" stroke="var(--color-gold)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" pathLength={1} strokeDasharray="1" style={{ animation: 'gl-draw .9s ease-out both' }} />
        <circle cx={x(shown)} cy={y(points[shown])} r="3.5" fill="var(--color-gold)" stroke="var(--color-bg)" strokeWidth="1.5" style={{ animation: 'gl-fade .3s ease .6s both' }} />
      </svg>
    </figure>
  )
}

export function MiniBars({ bars, unit, label }: { bars: { label: string; value: number | null }[]; unit: string; label: string }) {
  const [at, setAt] = useState<number | null>(null)
  const max = Math.max(...bars.map((b) => Math.abs(b.value ?? 0)), 1e-9)
  return (
    <figure className="m-0 flex flex-col gap-1">
      <figcaption className="font-mono text-[11px] text-faint">{label}</figcaption>
      <ul className="m-0 flex list-none flex-col gap-[6px] p-0" aria-label={label}>
        {bars.map((b, i) => {
          const w = b.value === null ? 0 : Math.max(2, (Math.abs(b.value) / max) * 100)
          return (
            <li
              key={`${b.label}-${i}`}
              tabIndex={0}
              onPointerEnter={() => setAt(i)}
              onPointerLeave={() => setAt(null)}
              onFocus={() => setAt(i)}
              onBlur={() => setAt(null)}
              className={`grid grid-cols-[minmax(56px,30%)_1fr_auto] items-center gap-2 rounded-[4px] text-[12px] outline-none focus-visible:ring-2 focus-visible:ring-gold ${at === i ? 'bg-surface-hover' : ''}`}
              title={`${b.label}: ${fmt(b.value, unit)}`}
            >
              <span className="truncate text-ink-2">{b.label}</span>
              <span className="h-[8px] overflow-hidden rounded-full bg-surface-deep" aria-hidden>
                <span className={`block h-full origin-left rounded-full ${b.value !== null && b.value < 0 ? 'bg-dim' : 'bg-gold'}`} style={{ width: `${w}%`, animation: `gl-grow-x .7s cubic-bezier(.2,.7,.2,1) ${i * 60}ms both` }} />
              </span>
              <span className={`font-mono tabular-nums ${at === i ? 'text-gold' : 'text-ink'}`}>{fmt(b.value, unit)}</span>
            </li>
          )
        })}
      </ul>
    </figure>
  )
}

/** One live card: title, LIVE and read time, the key figures, a mini chart, and where it came from. */
export function LiveCard({ card }: { card: AskCard }) {
  const id = useId()
  const at = asOfLabel(card.asOf)
  const ch = card.chart
  const series = ch?.type === 'spark' && ch.points.length >= 2 ? ch : null
  const bars = ch?.type === 'bars' && ch.bars.length >= 1 ? ch : null
  return (
    <section aria-labelledby={`${id}-t`} className="flex flex-col gap-3 rounded-[12px] border border-line-strong bg-surface-deep p-4" style={{ animation: 'gl-rise .35s ease both' }} data-testid="ask-card" data-kind={card.kind}>
      <header className="flex flex-wrap items-start justify-between gap-2">
        <span className="flex min-w-0 flex-col">
          <span id={`${id}-t`} className="truncate font-display text-[18px] leading-tight font-bold uppercase text-ink">
            {card.title}
          </span>
          {card.subtitle && <span className="truncate text-[12px] text-muted">{card.subtitle}</span>}
        </span>
        <span className="inline-flex items-center gap-2 font-mono text-[11px] text-faint">
          <span className="inline-flex items-center gap-1 rounded-full border border-success-line px-2 py-[1px] text-green">
            <span aria-hidden className="size-[6px] rounded-full bg-green" style={{ animation: 'gl-live-pulse 2s ease-in-out infinite' }} />
            LIVE {card.cite}
          </span>
          {at && <span>as of {at}</span>}
        </span>
      </header>
      {card.stats.length > 0 && (
        <dl className="m-0 grid grid-cols-[repeat(auto-fit,minmax(min(100%,110px),1fr))] gap-x-4 gap-y-2">
          {card.stats.map((s) => (
            <div key={s.label} className="flex min-w-0 flex-col">
              <dt className="truncate font-mono text-[11px] tracking-[1px] text-faint uppercase">{s.label}</dt>
              <dd className={`m-0 truncate text-[15px] font-medium ${s.tone ? TONE[s.tone] : 'text-ink'}`} style={{ animation: 'gl-count-flash 1.2s ease both' }}>
                {s.value}
              </dd>
            </div>
          ))}
        </dl>
      )}
      {series && <Spark points={series.points} unit={series.unit} label={series.label} />}
      {ch?.type === 'spark' && !series && <p className="m-0 font-mono text-[11px] text-faint">Not enough readings for a series yet.</p>}
      {bars && <MiniBars bars={bars.bars} unit={bars.unit} label={bars.label} />}
      {card.note && <p className="m-0 text-[12px] leading-[1.5] text-faint">{card.note}</p>}
      <footer className="flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[11px]">
        {card.source && (
          <a href={card.source.url} {...hrefProps(card.source.url)} className="inline-flex min-h-11 items-center gap-1 text-faint hover:text-gold">
            Source: {card.source.label} <ArrowUpRight size={11} aria-hidden />
          </a>
        )}
        {card.link && (
          <a href={card.link.url} {...hrefProps(card.link.url)} className="inline-flex min-h-11 items-center gap-1 text-gold hover:text-gold-hover">
            {card.link.label} <ArrowUpRight size={11} aria-hidden />
          </a>
        )}
      </footer>
    </section>
  )
}

/** One-tap follow-ups. A pre-filled form still needs the user's own confirmation there; nothing acts from here. */
export function Actions({ actions }: { actions: AskAction[] }) {
  if (!actions.length) return null
  return (
    <div className="flex flex-col gap-2">
      <span className="font-mono text-[11px] tracking-[1px] text-faint">NEXT STEPS</span>
      <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
        {actions.map((a) => (
          <li key={a.url}>
            <a
              href={a.url}
              {...hrefProps(a.url)}
              title={a.note}
              data-testid="ask-action"
              className="inline-flex min-h-11 items-center gap-2 rounded-full border border-gold-line px-4 text-[14px] text-gold no-underline transition-colors hover:border-gold hover:bg-[rgba(232,192,96,.08)]"
            >
              {a.kind === 'prefill' ? <PencilLine size={14} aria-hidden /> : <ArrowUpRight size={14} aria-hidden />}
              {a.label}
              {a.note && <span className="sr-only">. {a.note}</span>}
            </a>
          </li>
        ))}
      </ul>
      {actions.some((a) => a.kind === 'prefill') && <p className="m-0 font-mono text-[11px] text-faint">Forms open filled in; nothing is created until you confirm there.</p>}
    </div>
  )
}
