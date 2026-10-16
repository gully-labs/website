import { useState } from 'react'
import { Link } from 'react-router'
import { comingSoon, projects, TOTAL_SLOTS, type Project } from '../content/projects'
import { fmtTime, fmtUsd, sourceHost, type Figure, type Stats, type Venue } from '../lib/stats'
import { ShareMenu } from './Share'
import { NotifyMe } from './NotifyMe'
import { BlinkDot, statusPill } from './ui'

type Dir = 'descending' | 'ascending'

const FIGURES: { key: Figure; label: string }[] = [
  { key: 'tvlUsd', label: 'TVL' },
  { key: 'volumeAllUsd', label: 'VOLUME ALL-TIME' },
  { key: 'volume24hUsd', label: 'VOLUME 24H' },
  { key: 'feesAllUsd', label: 'FEES ALL-TIME' },
]

const cols = 'grid grid-cols-[136px_1.4fr_.9fr_1fr_1fr_1fr_1fr_132px] items-center gap-5 px-7'
const colsNarrow = 'max-[959px]:grid-cols-[136px_1fr] max-[959px]:gap-x-5 max-[959px]:gap-y-3'

function cell(v: Venue | undefined, m: Figure, state: 'loading' | 'error' | 'ok') {
  if (state === 'loading') return <span className="text-dim">…</span>
  if (!v || v.state !== 'ok') return <span className="text-error">unreadable</span>
  if (m === 'volumeAllUsd' && v.volumeAllUsd === null && v.volume30dUsd !== null && v.volume30dUsd !== undefined) return `${fmtUsd(v.volume30dUsd)} · 30d`
  if (m === 'feesAllUsd') {
    const all = v.feesAllUsd ?? null
    const day = v.fees24hUsd
    if (all === null && day === null) return <span className="text-dim">—</span>
    return (
      <>
        {all === null ? <span className="text-dim">—</span> : fmtUsd(all)}
        {day !== null && <span className="ml-2 text-[12px] text-faint">24h {fmtUsd(day)}</span>}
      </>
    )
  }
  const n = v[m]
  return n === null || n === undefined ? <span className="text-dim">—</span> : fmtUsd(n)
}

function Row({ p, venue, state, index }: { p: Project; venue?: Venue; state: 'loading' | 'error' | 'ok'; index: number }) {
  const provenance =
    venue?.state === 'ok'
      ? `Read from ${sourceHost(venue.source.url)} at ${fmtTime(venue.source.readAt)}${venue.notes.length ? ` · ${venue.notes.join(' ')}` : ''}`
      : venue?.state === 'error'
        ? `Could not be read: ${venue.error}`
        : state === 'error'
          ? 'Could not be read.'
          : 'Reading…'
  return (
    <div
      className={`${cols} ${colsNarrow} gl-row-sweep relative min-h-[112px] border-b border-line py-5 text-ink transition-colors last:border-b-0 hover:bg-surface-hover`}
      style={{ animation: `gl-rise .5s ${index * 0.07}s ease both`, ['--sweep-delay' as string]: `${2 + index * 1.1}s` }}
    >
      {/* The project's own lockup, on its own ground, large enough to read. */}
      <Link to={`/projects/${p.slug}`} className="flex h-[72px] w-[136px] items-center justify-center overflow-hidden rounded-[10px] border-b-[3px] border-line" style={{ background: p.bg, borderBottomColor: p.accent }} aria-label={`${p.name} project page`}>
        <img src={p.logo} alt={p.name} loading="lazy" className="block size-full" style={{ objectFit: p.fit, padding: p.fit === 'contain' ? '10px 14px' : 0 }} />
      </Link>
      <span className="flex flex-col gap-[6px]">
        <Link to={`/projects/${p.slug}`} className="font-display text-[26px] leading-none font-bold uppercase text-ink hover:text-gold">
          {p.name}
        </Link>
        <span className="font-mono text-[12px] text-dim">
          {p.tag} · {p.tagline}
        </span>
      </span>
      <span className="flex flex-wrap gap-1 max-[959px]:col-start-2">
        {p.chains.map((c) => (
          <span key={c} className="rounded-full border border-line-strong px-2 py-[2px] font-mono text-[10px] tracking-[.5px] text-muted">
            {c}
          </span>
        ))}
      </span>
      {FIGURES.map((f) => (
        <span key={f.key} className="flex flex-col gap-1 font-mono text-[17px] max-[959px]:col-start-2">
          <span>{cell(venue, f.key, state)}</span>
          <span className="text-[11px] tracking-[.5px] text-faint">{f.label}</span>
        </span>
      ))}
      <span className="flex flex-col items-end gap-2 max-[959px]:col-start-2 max-[959px]:items-start">
        <span className={statusPill}>{p.status}</span>
        <ShareMenu project={p} compact />
        <Link to={`/projects/${p.slug}`} className="text-[14px] whitespace-nowrap text-gold hover:text-gold-hover">
          View project →
        </Link>
      </span>
      <span className="col-span-full -mt-2 font-mono text-[12px] leading-[1.5] text-faint max-[959px]:col-start-1">{provenance}</span>
    </div>
  )
}

/** The projects as rows, sortable by any figure; every row reads its project's own API. */
export function ProjectRows({ data, state }: { data: Stats | null; state: 'loading' | 'error' | 'ok' }) {
  const [sort, setSort] = useState<{ key: Figure; dir: Dir } | null>(null)
  const venueOf = (key: string) => data?.venues.find((v) => v.key === key)
  const figure = (key: string, m: Figure) => {
    const v = venueOf(key)
    return v?.state === 'ok' ? (v[m] ?? -1) : -1
  }
  const rows = sort ? [...projects].sort((a, b) => (sort.dir === 'descending' ? figure(b.key, sort.key) - figure(a.key, sort.key) : figure(a.key, sort.key) - figure(b.key, sort.key))) : projects
  const head = (f: { key: Figure; label: string }) => (
    <button
      key={f.key}
      type="button"
      aria-sort={sort?.key === f.key ? sort.dir : 'none'}
      onClick={() => setSort((s) => ({ key: f.key, dir: s?.key === f.key && s.dir === 'descending' ? 'ascending' : 'descending' }))}
      className={`inline-flex items-center gap-[6px] bg-transparent p-0 text-left font-mono text-[11px] tracking-[1px] transition-colors hover:text-gold ${sort?.key === f.key ? 'text-gold' : 'text-faint'}`}
    >
      {f.label} {sort?.key === f.key ? (sort.dir === 'descending' ? '↓' : '↑') : '↕'}
    </button>
  )
  return (
    <div className="overflow-hidden rounded-card border border-line bg-surface">
      <div className={`${cols} h-11 border-b border-line bg-surface-deep font-mono text-[11px] tracking-[1px] text-faint max-[959px]:hidden`}>
        <span />
        <span>PROJECT</span>
        <span>CHAINS</span>
        {FIGURES.map(head)}
        <span className="text-right">SHARE</span>
      </div>
      {rows.map((p, i) => (
        <Row key={p.key} p={p} venue={venueOf(p.key)} state={state} index={i} />
      ))}
      {comingSoon.map((num) => (
        <div
          key={num}
          className="relative flex flex-wrap items-center gap-5 overflow-hidden border-t border-line px-7 py-5"
          style={{ background: 'repeating-linear-gradient(135deg,#10141a 0 12px,#0d1116 12px 24px)' }}
        >
          <div aria-hidden className="absolute inset-0 animate-sweep" style={{ background: 'linear-gradient(90deg,transparent,rgba(232,192,96,.08),transparent)' }} />
          <span aria-hidden className="relative font-display text-[44px] leading-none font-extrabold text-line" style={{ WebkitTextStroke: '1px #3a4452' }}>
            {num}
          </span>
          <div className="relative flex flex-col gap-1">
            <span className="flex items-center gap-2 font-mono text-[12px] tracking-[1.5px] text-dim">
              <BlinkDot color="gold" />
              IN THE LAB · {num} / {TOTAL_SLOTS}
            </span>
            <span className="text-[15px] text-muted">Project {num} is in development. Get an email the day it launches.</span>
          </div>
          <NotifyMe slot={num} />
        </div>
      ))}
    </div>
  )
}
