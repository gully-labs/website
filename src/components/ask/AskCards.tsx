import { ArrowUpRight, PencilLine } from 'lucide-react'
import { useId } from 'react'
import { MiniBars } from '../charts/MiniBars'
import { MiniSpark } from '../charts/MiniSpark'
import type { AskAction, AskCard, CardStat } from './askApi'
import { asOfLabel, hrefProps } from './askFormat'

/* Gully AI's live cards and one-tap actions, under an answer. The server builds both from the tool results
   (server/ask.mjs cardsFrom / actionsFrom), so every figure here is exactly what the tool read, with its
   read time. The mini charts are the kit's MiniSpark and MiniBars (src/components/charts): they draw in on
   view, answer pointer and keyboard with the value under the cursor, and ghost when there is too little. */

function fmt(v: number | null, unit: string) {
  if (v === null || !Number.isFinite(v)) return 'not read'
  if (unit === '%') return `${v > 0 ? '+' : ''}${v.toFixed(2)}%`
  if (unit === '$') return v.toLocaleString('en-US', { style: 'currency', currency: 'USD', notation: Math.abs(v) >= 100_000 ? 'compact' : 'standard', maximumFractionDigits: Math.abs(v) >= 100 ? 0 : 2 })
  return v.toLocaleString('en-US', { notation: Math.abs(v) >= 100_000 ? 'compact' : 'standard', maximumFractionDigits: 2 })
}

const TONE: Record<NonNullable<CardStat['tone']>, string> = { up: 'text-gold', down: 'text-error', ok: 'text-green', warn: 'text-muted' }

function Spark({ points, unit, label }: { points: number[]; unit: string; label: string }) {
  return (
    <figure className="m-0 flex flex-col gap-1">
      <figcaption className="flex items-baseline justify-between gap-2 font-mono text-[11px] text-faint">
        <span>{label}</span>
        <span className="text-ink">
          now <b className="font-medium">{fmt(points[points.length - 1] ?? null, unit)}</b>
        </span>
      </figcaption>
      <MiniSpark data={points} label={label} fmt={(v) => fmt(v, unit)} height={56} zero={unit === '%'} />
    </figure>
  )
}

function Bars({ bars, unit, label }: { bars: { label: string; value: number | null }[]; unit: string; label: string }) {
  return <MiniBars bars={bars} label={label} orientation="rows" fmt={(v) => fmt(v, unit)} />
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
      {bars && <Bars bars={bars.bars} unit={bars.unit} label={bars.label} />}
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
              className="inline-flex min-h-11 items-center gap-2 rounded-full border border-gold-line px-4 text-[14px] text-gold no-underline transition-colors hover:border-gold hover:bg-[rgba(0,210,255,.08)]"
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
