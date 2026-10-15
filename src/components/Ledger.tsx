import { useState } from 'react'
import { projects } from '../content/projects'
import { useCountUp } from '../hooks/useCountUp'
import { fmtDay, fmtTime, fmtUsd, type Stats, type Venue, type VenueOk } from '../lib/stats'
import { DataTable, EmptySeries, nameOf, Segmented } from './LiveChart'

/* The ledger: one combined band across the five venues, then the venues' own series stacked.
   Everything is read from /api/stats; a venue that publishes no series is not drawn, and the
   provenance under each chart says so. Bars grow from the baseline, the underline sweeps on
   hover, tiles count up; all of it is off under prefers-reduced-motion (index.css). */

const names = (keys: string[]) => keys.map(nameOf).join(', ')
const accentOf = (key: string) => projects.find((p) => p.key === key)?.accent ?? '#e8c060'
const okOnly = (venues: Venue[]) => venues.filter((v): v is VenueOk => v.state === 'ok')

const grid =
  'repeating-linear-gradient(180deg,transparent 0,transparent calc(33.33% - 1px),#1a2029 calc(33.33% - 1px),#1a2029 33.33%)'

/* ------------------------------------------------------------------ KPIs --- */

function Kpi({ label, value, cover, gold, note, state }: { label: string; value: number | null; cover?: string[]; gold?: boolean; note?: React.ReactNode; state: 'loading' | 'error' | 'ok' }) {
  const n = useCountUp(value ?? 0)
  const big = `font-display text-[clamp(40px,3.6cqw,56px)] leading-none font-extrabold tracking-[-.5px] ${gold ? 'text-gold' : 'text-ink'}`
  return (
    <div className="group relative flex flex-col gap-2 overflow-hidden bg-surface px-[26px] py-6">
      <div className="flex justify-between font-mono text-[12px] tracking-[1px] text-dim">
        <span>{label}</span>
        {cover && state === 'ok' && <span>{cover.length}/5</span>}
      </div>
      {state !== 'ok' || value === null ? (
        <div className={`${big} text-dim`}>—</div>
      ) : (
        <div className={big}>
          <span className="sr-only">{fmtUsd(value)}</span>
          <span aria-hidden>{fmtUsd(n)}</span>
        </div>
      )}
      <div className="text-[13px] text-muted">
        {state === 'loading' ? (
          'Reading the venues…'
        ) : state === 'error' ? (
          <span className="text-error">Couldn't load. Try again.</span>
        ) : note ? (
          note
        ) : cover && cover.length ? (
          <>
            from <b className="font-medium text-ink-2">{names(cover)}</b>
          </>
        ) : (
          <span className="text-dim">No venue publishes this figure.</span>
        )}
      </div>
      <span aria-hidden className="absolute inset-x-0 bottom-0 h-[2px] origin-left scale-x-0 bg-gold transition-transform duration-300 group-hover:scale-x-100" />
    </div>
  )
}

export function LedgerBand({ data, state }: { data: Stats | null; state: 'loading' | 'error' | 'ok' }) {
  const T = data?.totals
  const live = data ? okOnly(data.venues).length : 0
  const liveN = useCountUp(live)
  return (
    <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,220px),1fr))] gap-px overflow-hidden rounded-card border border-line bg-line">
      <Kpi label="VOLUME 24H" value={T?.volume24hUsd ?? null} cover={T?.covers.volume24hUsd} state={state} />
      <Kpi label="TOTAL VALUE LOCKED" value={T?.tvlUsd ?? null} cover={T?.covers.tvlUsd} gold state={state} />
      <Kpi label="FEES EARNED 24H" value={T?.fees24hUsd ?? null} cover={T?.covers.fees24hUsd} state={state} />
      <div className="group relative flex flex-col gap-2 overflow-hidden bg-surface px-[26px] py-6">
        <div className="font-mono text-[12px] tracking-[1px] text-dim">PROJECTS LIVE</div>
        <div className="font-display text-[clamp(40px,3.6cqw,56px)] leading-none font-extrabold tracking-[-.5px]">
          {state === 'ok' ? String(Math.round(liveN)).padStart(2, '0') : <span className="text-dim">—</span>}
        </div>
        <div className="text-[13px] text-muted">
          {state === 'loading' ? (
            'Reading the venues…'
          ) : state === 'error' || !data ? (
            <span className="text-error">Couldn't load. Try again.</span>
          ) : data.totals.unread.length ? (
            <span className="text-error">{names(data.totals.unread)} could not be read</span>
          ) : (
            `all five venues answered at ${fmtTime(data.generatedAt)}`
          )}
        </div>
        <span aria-hidden className="absolute inset-x-0 bottom-0 h-[2px] origin-left scale-x-0 bg-gold transition-transform duration-300 group-hover:scale-x-100" />
      </div>
    </div>
  )
}

/* --------------------------------------------------- stacked daily volume --- */

export function StackedVolume({ data, state }: { data: Stats | null; state: 'loading' | 'error' | 'ok' }) {
  const [on, setOn] = useState<Record<string, boolean>>(() => Object.fromEntries(projects.map((p) => [p.key, true])))
  const [view, setView] = useState<'chart' | 'table'>('chart')
  const [hover, setHover] = useState(-1)
  const ok = data ? okOnly(data.venues) : []
  const byKey = Object.fromEntries(ok.map((v) => [v.key, v]))
  const withSeries = projects.filter((p) => (byKey[p.key]?.daily.length ?? 0) > 1).map((p) => p.key)
  const days = [...new Set(ok.flatMap((v) => v.daily.map((d) => d.t)))].sort((a, b) => a - b).slice(-14)
  const rows = days.map((t) => ({
    t,
    parts: projects.filter((p) => on[p.key] && byKey[p.key]).map((p) => ({ key: p.key, v: byKey[p.key].daily.find((d) => d.t === t)?.v ?? 0 })),
  }))
  const total = (r: (typeof rows)[number]) => r.parts.reduce((a, p) => a + p.v, 0)
  const max = Math.max(...rows.map(total), 1e-9)

  let body: React.ReactNode
  if (state === 'loading') body = <p className="m-0 py-6 font-mono text-[12px] text-faint">Reading the venues…</p>
  else if (state === 'error' || !data) body = <p className="m-0 py-6 font-mono text-[12px] text-error">The venues could not be read. Try again.</p>
  else if (view === 'table')
    body = (
      <DataTable
        rows={[...rows].reverse()}
        cols={[
          { label: 'DAY', cell: (r) => fmtDay(r.t) },
          ...projects.map((p) => ({ label: p.name.toUpperCase(), cell: (r: (typeof rows)[number]) => { const x = r.parts.find((q) => q.key === p.key); return x ? fmtUsd(x.v) : '—' } })),
          { label: 'TOTAL', cell: (r) => fmtUsd(total(r)) },
        ]}
      />
    )
  else if (days.length < 2) body = <EmptySeries n={days.length} />
  else
    body = (
      <div className="relative flex h-[280px] gap-3">
        <div aria-hidden className="flex w-11 flex-none flex-col justify-between pb-[22px] text-right font-mono text-[11px] text-axis">
          {[max, (max * 2) / 3, max / 3, 0].map((v, i) => (
            <span key={i}>{fmtUsd(v)}</span>
          ))}
        </div>
        <div className="relative flex flex-1 items-stretch gap-[6px] pb-[22px]" style={{ background: grid, backgroundSize: '100% calc(100% - 22px)', backgroundRepeat: 'no-repeat' }}>
          {rows.map((r, i) => (
            <div
              key={r.t}
              tabIndex={0}
              aria-label={`${fmtDay(r.t)} ${fmtUsd(total(r))}`}
              className={`relative flex flex-1 flex-col-reverse overflow-hidden rounded-t-[3px] outline-offset-0 ${hover === i ? 'outline outline-1 outline-line-hover' : ''}`}
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(-1)}
              onFocus={() => setHover(i)}
              onBlur={() => setHover(-1)}
            >
              {r.parts.map((p, j) => (
                <div
                  key={p.key}
                  className="w-full"
                  style={{ height: `${(p.v / max) * 100}%`, background: accentOf(p.key), transformOrigin: 'bottom', animation: `gl-grow .7s ${i * 0.04 + j * 0.03}s cubic-bezier(.2,.8,.2,1) both` }}
                />
              ))}
            </div>
          ))}
          <div aria-hidden className="absolute inset-x-0 bottom-0 flex justify-between font-mono text-[11px] text-axis">
            <span>{fmtDay(days[0])}</span>
            <span>{fmtDay(days[Math.floor(days.length / 2)])}</span>
            <span>{fmtDay(days[days.length - 1])}</span>
          </div>
          {hover >= 0 && rows[hover] && (
            <div
              className="pointer-events-none absolute z-10 rounded-input border border-line-strong bg-surface-deep px-[10px] py-2 font-mono text-[12px] whitespace-nowrap text-ink"
              style={{ left: `${((hover + 0.5) / rows.length) * 100}%`, top: 6, transform: 'translateX(-50%)' }}
            >
              {fmtDay(rows[hover].t)}
              {rows[hover].parts.map((p) => (
                <div key={p.key}>
                  <span style={{ color: accentOf(p.key) }}>●</span> {nameOf(p.key)} <b className="font-medium text-gold">{fmtUsd(p.v)}</b>
                </div>
              ))}
              <div>
                total <b className="font-medium text-gold">{fmtUsd(total(rows[hover]))}</b>
              </div>
            </div>
          )}
        </div>
      </div>
    )

  return (
    <div className="flex min-w-0 flex-col gap-5 rounded-card border border-line bg-surface p-7">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h3 className="m-0 font-display text-[28px] font-bold uppercase">Volume by venue</h3>
          <span className="font-mono text-[12px] text-faint">
            Daily, last {days.length} days · {withSeries.length ? `${names(withSeries)} publish a series` : 'no venue publishes a series yet'}
          </span>
        </div>
        <Segmented
          label="View"
          value={view}
          onChange={setView}
          options={[
            { id: 'chart', label: 'Chart' },
            { id: 'table', label: 'Table' },
          ]}
        />
      </div>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Venues shown">
        {projects.map((p) => (
          <button
            key={p.key}
            type="button"
            aria-pressed={on[p.key]}
            onClick={() => setOn((s) => ({ ...s, [p.key]: !s[p.key] }))}
            className={`inline-flex items-center gap-2 rounded-full border border-line bg-transparent px-3 py-[5px] font-mono text-[12px] text-ink-2 transition-opacity ${on[p.key] ? '' : 'opacity-40'}`}
          >
            <span aria-hidden className="size-[9px] rounded-full" style={{ background: p.accent }} />
            {p.name}
            {state === 'ok' && !withSeries.includes(p.key) ? ' · no series' : ''}
          </button>
        ))}
      </div>
      <div className="relative min-h-[280px]">{body}</div>
      {data && (
        <p className="m-0 font-mono text-[12px] leading-[1.5] text-faint">
          Read at {fmtTime(data.generatedAt)} from each venue's own API. A venue with no daily series is not drawn, not shown as zero.
          {data.totals.unread.length ? ` ${names(data.totals.unread)} could not be read.` : ''}
        </p>
      )}
    </div>
  )
}

/* ------------------------------------------------------------- TVL share --- */

export function TvlShare({ data, state }: { data: Stats | null; state: 'loading' | 'error' | 'ok' }) {
  const rows = data ? projects.map((p) => ({ key: p.key, v: okOnly(data.venues).find((v) => v.key === p.key)?.tvlUsd ?? null })).filter((r): r is { key: string; v: number } => r.v !== null) : []
  const total = rows.reduce((a, r) => a + r.v, 0)
  const missing = projects.filter((p) => !rows.some((r) => r.key === p.key)).map((p) => p.key)
  return (
    <div className="flex min-w-0 flex-col gap-5 self-start rounded-card border border-line bg-surface p-7">
      <div className="flex flex-col gap-1">
        <h3 className="m-0 font-display text-[28px] font-bold uppercase">Value locked</h3>
        <span className="font-mono text-[12px] text-faint">Share by venue, right now</span>
      </div>
      {state === 'loading' ? (
        <p className="m-0 py-6 font-mono text-[12px] text-faint">Reading the venues…</p>
      ) : state === 'error' || !data ? (
        <p className="m-0 py-6 font-mono text-[12px] text-error">The venues could not be read. Try again.</p>
      ) : total <= 0 ? (
        <p className="m-0 py-6 font-mono text-[12px] text-faint">Nothing to share out yet.</p>
      ) : (
        <>
          <div className="flex h-[14px] overflow-hidden rounded-full bg-line" role="img" aria-label={rows.map((r) => `${nameOf(r.key)} ${((r.v / total) * 100).toFixed(1)}%`).join(', ')}>
            {rows.map((r, i) => (
              <div
                key={r.key}
                title={`${nameOf(r.key)} ${fmtUsd(r.v)} · ${((r.v / total) * 100).toFixed(1)}%`}
                className="h-full"
                style={{ width: `${(r.v / total) * 100}%`, background: accentOf(r.key), transformOrigin: 'left', animation: `gl-grow-x .8s ${i * 0.09}s cubic-bezier(.2,.8,.2,1) both` }}
              />
            ))}
          </div>
          <div className="flex flex-col gap-[10px] text-[14px] text-muted">
            {rows.map((r) => (
              <span key={r.key} className="flex items-center gap-[10px]">
                <i aria-hidden className="size-[10px] rounded-full" style={{ background: accentOf(r.key) }} />
                {nameOf(r.key)}
                <span className="ml-auto font-mono text-[12px] text-dim">{fmtUsd(r.v)}</span>
                <b className="w-14 text-right font-mono font-medium text-ink">{((r.v / total) * 100).toFixed(1)}%</b>
              </span>
            ))}
          </div>
        </>
      )}
      {state === 'ok' && (
        <p className="m-0 font-mono text-[12px] leading-[1.5] text-faint">
          {rows.length ? `${names(rows.map((r) => r.key))} publish value locked` : 'No venue publishes value locked'}
          {missing.length ? `; ${names(missing)} do not.` : '.'}
        </p>
      )}
    </div>
  )
}
