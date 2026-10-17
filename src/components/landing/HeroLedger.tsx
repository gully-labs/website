import { useState } from 'react'
import { projects } from '../../content/projects'
import { fmtDay, fmtTime, fmtUsd, nameOf, type Stats, type VenueOk } from '../../lib/stats'

/* The hero's ledger card: three combined figures, then the venues' own daily volume stacked.
   Everything is read from /api/stats (useStats); nothing here is sample data. A venue that publishes
   no daily series is not drawn, and a day a venue did not report adds nothing to the stack and reads
   "no reading" in the tooltip, never zero. The chips are the legend: press one to hide that venue. */

const W = 600
const H = 220
const MAX_DAYS = 30

type State = 'loading' | 'error' | 'ok'
const okOnly = (data: Stats | null) => (data ? data.venues.filter((v): v is VenueOk => v.state === 'ok') : [])

function Kpi({ label, span, value, cover, state }: { label: string; span?: string; value: number | null | undefined; cover?: string[]; state: State }) {
  const shown = state === 'ok' && value !== null && value !== undefined
  return (
    <div className="flex min-w-0 flex-col gap-[2px] border-r border-line px-4 py-3 last:border-r-0 max-[459px]:px-3">
      <span className="truncate font-mono text-[10px] tracking-[1px] text-faint">{label}</span>
      <b className={`font-display text-[30px] leading-none font-bold max-[459px]:text-[24px] ${shown ? 'text-ink' : 'text-dim'}`}>{shown ? fmtUsd(value) : state === 'error' ? 'unreadable' : '—'}</b>
      <span className="truncate font-mono text-[10px] text-faint">
        {state === 'loading' ? 'reading…' : state === 'error' ? 'could not be read' : cover?.length ? `${span ? `${span} · ` : ''}${cover.length}/${projects.length} venues` : 'not published'}
      </span>
    </div>
  )
}

export function HeroLedger({ data, state }: { data: Stats | null; state: State }) {
  const [hidden, setHidden] = useState<Record<string, boolean>>({})
  const [day, setDay] = useState<number | null>(null)

  const ok = okOnly(data)
  const byKey = Object.fromEntries(ok.map((v) => [v.key, v]))
  const withSeries = projects.filter((p) => (byKey[p.key]?.daily.length ?? 0) > 1)
  const days = [...new Set(ok.flatMap((v) => v.daily.map((d) => d.t)))].sort((a, b) => a - b).slice(-MAX_DAYS)
  const valueOn = (key: string, t: number) => byKey[key]?.daily.find((d) => d.t === t)?.v ?? null
  const shown = withSeries.filter((p) => !hidden[p.key])

  const D = days.length
  const totals = days.map((t) => shown.reduce((a, p) => a + (valueOn(p.key, t) ?? 0), 0))
  const max = Math.max(1, ...totals) * 1.1
  const X = (i: number) => (D > 1 ? (i / (D - 1)) * W : 0)
  const Y = (v: number) => H - (v / max) * (H - 8)

  // Each venue is a band from the running base to base + its value; hidden venues are flat (zero
  // thickness) so the paths keep their shape and the rest re-stack with a transition.
  const layers: { key: string; color: string; d: string }[] = []
  let base = days.map(() => 0)
  for (const p of withSeries) {
    const top = base.map((b, i) => b + (hidden[p.key] ? 0 : (valueOn(p.key, days[i]) ?? 0)))
    const up = top.map((v, i) => `${X(i).toFixed(1)} ${Y(v).toFixed(1)}`).join(' L')
    const down = base.map((_, i) => `${X(D - 1 - i).toFixed(1)} ${Y(base[D - 1 - i]).toFixed(1)}`).join(' L')
    layers.push({ key: p.key, color: p.accent, d: `M${up} L${down} Z` })
    base = top
  }

  const pick = (clientX: number, el: HTMLElement) => {
    const r = el.getBoundingClientRect()
    if (D < 2 || r.width <= 0) return
    setDay(Math.max(0, Math.min(D - 1, Math.round(((clientX - r.left) / r.width) * (D - 1)))))
  }
  const onKey = (e: React.KeyboardEvent) => {
    if (D < 2) return
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault()
      setDay((d) => Math.max(0, Math.min(D - 1, (d ?? D - 1) + (e.key === 'ArrowRight' ? 1 : -1))))
    } else if (e.key === 'Escape') setDay(null)
  }

  const T = data?.totals
  let chart: React.ReactNode
  if (state === 'loading') chart = <div className="h-[230px] animate-pulse rounded-[8px] bg-surface-deep" />
  else if (state === 'error' || !data) chart = <p className="m-0 flex h-[230px] items-center justify-center font-mono text-[12px] text-error">The venues could not be read. Try again in a minute.</p>
  else if (D < 2 || !withSeries.length) chart = <p className="m-0 flex h-[230px] items-center justify-center px-4 text-center font-mono text-[12px] text-faint">No venue publishes a daily series yet, so there is nothing to stack.</p>
  else
    chart = (
      <div
        className="relative touch-pan-y outline-none"
        tabIndex={0}
        role="img"
        aria-label={`Daily volume by venue, stacked, last ${D} days. ${days.map((t, i) => `${fmtDay(t)} ${fmtUsd(totals[i])}`).join(', ')}. Arrow keys step through days.`}
        onPointerMove={(e) => pick(e.clientX, e.currentTarget)}
        onPointerDown={(e) => pick(e.clientX, e.currentTarget)}
        onPointerLeave={() => setDay(null)}
        onKeyDown={onKey}
        onBlur={() => setDay(null)}
      >
        <svg aria-hidden viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="block h-[230px] w-full">
          <g stroke="#1a2029">
            <line x1="0" y1="55" x2={W} y2="55" />
            <line x1="0" y1="110" x2={W} y2="110" />
            <line x1="0" y1="165" x2={W} y2="165" />
          </g>
          {layers.map((l) => (
            <path
              key={l.key}
              d={l.d}
              fill={l.color}
              fillOpacity={0.8}
              stroke="#10141a"
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
              style={{ d: `path('${l.d}')`, transition: 'd .6s cubic-bezier(.2,.8,.2,1)' } as React.CSSProperties}
            />
          ))}
          {day !== null && <line x1={X(day)} y1="0" x2={X(day)} y2={H} stroke="#eef0f2" strokeOpacity=".5" vectorEffect="non-scaling-stroke" />}
        </svg>
        <span className="pointer-events-none absolute top-1 right-2 font-mono text-[10px] text-faint">{fmtUsd(max / 1.1)}</span>
        {day !== null && (
          <div
            className="pointer-events-none absolute top-[10px] grid grid-cols-[auto_auto_auto] items-center gap-x-[10px] gap-y-[2px] rounded-[6px] border border-line-strong bg-[rgba(13,17,22,.96)] px-[10px] py-2 font-mono text-[11px]"
            style={{ left: `${(day / (D - 1)) * 100}%`, transform: `translateX(${day > D * 0.6 ? '-105%' : '10px'})` }}
          >
            <span className="col-span-full text-faint">
              {fmtDay(days[day])} · {fmtUsd(totals[day])}
            </span>
            {shown.map((p) => {
              const v = valueOn(p.key, days[day])
              return [
                <span key={`${p.key}c`} className="size-2 rounded-[2px]" style={{ background: p.accent }} />,
                <span key={`${p.key}n`} className="text-muted">
                  {p.name}
                </span>,
                <span key={`${p.key}v`} className={`text-right ${v === null ? 'text-faint' : ''}`}>
                  {v === null ? 'no reading' : fmtUsd(v)}
                </span>,
              ]
            })}
          </div>
        )}
      </div>
    )

  return (
    <div className="min-w-0 overflow-hidden rounded-card border border-line bg-surface">
      <div className="grid grid-cols-3 border-b border-line">
        <Kpi label="VOLUME" span="all-time" value={T?.volumeAllUsd} cover={T?.covers.volumeAllUsd} state={state} />
        <Kpi label="VALUE LOCKED" value={T?.tvlUsd} cover={T?.covers.tvlUsd} state={state} />
        <Kpi label="FEES" span="all-time" value={T?.feesAllUsd} cover={T?.covers.feesAllUsd} state={state} />
      </div>
      <div className="flex flex-wrap gap-[6px] px-[14px] pt-[10px]" role="group" aria-label="Venues in the chart">
        {projects.map((p) => {
          const has = withSeries.includes(p)
          const on = has && !hidden[p.key]
          return (
            <button
              key={p.key}
              type="button"
              aria-pressed={on}
              disabled={state === 'ok' && !has}
              title={state === 'ok' && !has ? `${p.name} publishes no daily series` : undefined}
              onClick={() => (setHidden((h) => ({ ...h, [p.key]: !h[p.key] })), setDay(null))}
              className={`inline-flex min-h-[30px] items-center gap-[6px] rounded-full border border-line-strong bg-transparent px-[10px] text-[12px] transition-[color,opacity] duration-200 disabled:cursor-default ${on ? 'text-ink' : 'text-faint opacity-55'}`}
            >
              <span aria-hidden className="size-2 rounded-[2px]" style={{ background: p.accent }} />
              {p.name}
            </button>
          )
        })}
      </div>
      <div className="px-[6px] pt-[6px]">{chart}</div>
      <div className="flex flex-wrap justify-between gap-x-4 gap-y-1 px-4 pt-[6px] pb-3 font-mono text-[10px] text-faint">
        <span>Daily volume · last {D || '—'} days · press a venue to hide it</span>
        <span>
          {data ? `Live · read ${fmtTime(data.generatedAt)} from each venue's API` : 'Live from each venue’s API'}
          {T?.unread.length ? ` · ${T.unread.map(nameOf).join(', ')} unreadable` : ''}
        </span>
      </div>
    </div>
  )
}
