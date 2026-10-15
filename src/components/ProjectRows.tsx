import { useState } from 'react'
import { Link } from 'react-router'
import { comingSoon, projects, TOTAL_SLOTS, type Project } from '../content/projects'
import { fmtTime, fmtUsd, sourceHost, type Stats, type Venue } from '../lib/stats'
import { BlinkDot, statusPill } from './ui'

type SortKey = 'tvlUsd' | 'volume24hUsd' | 'fees24hUsd'
type Dir = 'descending' | 'ascending'

const cols = 'grid grid-cols-[136px_1.5fr_1fr_1fr_1fr_1fr_120px] items-center gap-5 px-7'
const colsNarrow = 'max-[959px]:grid-cols-[136px_1fr] max-[959px]:gap-x-5 max-[959px]:gap-y-3'

function cell(v: Venue | undefined, m: SortKey, state: 'loading' | 'error' | 'ok') {
  if (state === 'loading') return <span className="text-dim">…</span>
  if (!v || v.state !== 'ok') return <span className="text-error">unreadable</span>
  if (m === 'fees24hUsd' && v.feesNative) return `${v.feesNative.amount.toLocaleString('en-US', { maximumFractionDigits: 4 })} ${v.feesNative.symbol}`
  const n = v[m]
  return n === null ? <span className="text-dim">—</span> : fmtUsd(n)
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
    <Link
      to={`/projects/${p.slug}`}
      className={`${cols} ${colsNarrow} min-h-[112px] border-b border-line py-5 text-ink transition-colors last:border-b-0 hover:bg-surface-hover hover:text-ink`}
      style={{ animation: `gl-rise .5s ${index * 0.07}s ease both` }}
    >
      {/* The project's own lockup, on its own ground, large enough to read. */}
      <span className="flex h-[72px] w-[136px] items-center justify-center overflow-hidden rounded-[10px] border-b-[3px] border-line" style={{ background: p.bg, borderBottomColor: p.accent }}>
        <img src={p.logo} alt={p.name} loading="lazy" className="block size-full" style={{ objectFit: p.fit, padding: p.fit === 'contain' ? '10px 14px' : 0 }} />
      </span>
      <span className="flex flex-col gap-[6px]">
        <span className="font-display text-[26px] leading-none font-bold uppercase">{p.name}</span>
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
      {(['tvlUsd', 'volume24hUsd', 'fees24hUsd'] as SortKey[]).map((m) => (
        <span key={m} className="flex flex-col gap-1 font-mono text-[17px] max-[959px]:col-start-2">
          <span>{cell(venue, m, state)}</span>
          <span className="text-[11px] tracking-[.5px] text-faint">{m === 'tvlUsd' ? 'TVL' : m === 'volume24hUsd' ? 'VOLUME 24H' : p.key === 'peddles' ? 'CREATOR FEES 24H' : 'FEES 24H'}</span>
        </span>
      ))}
      <span className="flex flex-col items-end gap-2 max-[959px]:col-start-2 max-[959px]:items-start">
        <span className={statusPill}>{p.status}</span>
        <span className="text-[14px] whitespace-nowrap text-gold">View project →</span>
      </span>
      <span className="col-span-full -mt-2 font-mono text-[12px] leading-[1.5] text-faint max-[959px]:col-start-1">{provenance}</span>
    </Link>
  )
}

/** The projects as rows, sortable by any figure; every row reads its project's own API. */
export function ProjectRows({ data, state }: { data: Stats | null; state: 'loading' | 'error' | 'ok' }) {
  const [sort, setSort] = useState<{ key: SortKey; dir: Dir } | null>(null)
  const [notified, setNotified] = useState(false)
  const venueOf = (key: string) => data?.venues.find((v) => v.key === key)
  const figure = (key: string, m: SortKey) => {
    const v = venueOf(key)
    return v?.state === 'ok' ? (v[m] ?? -1) : -1
  }
  const rows = sort ? [...projects].sort((a, b) => (sort.dir === 'descending' ? figure(b.key, sort.key) - figure(a.key, sort.key) : figure(a.key, sort.key) - figure(b.key, sort.key))) : projects
  const head = (m: SortKey, label: string) => (
    <button
      type="button"
      aria-sort={sort?.key === m ? sort.dir : 'none'}
      onClick={() => setSort((s) => ({ key: m, dir: s?.key === m && s.dir === 'descending' ? 'ascending' : 'descending' }))}
      className={`inline-flex items-center gap-[6px] bg-transparent p-0 text-left font-mono text-[11px] tracking-[1px] transition-colors hover:text-gold ${sort?.key === m ? 'text-gold' : 'text-faint'}`}
    >
      {label} {sort?.key === m ? (sort.dir === 'descending' ? '↓' : '↑') : '↕'}
    </button>
  )
  return (
    <div className="overflow-hidden rounded-card border border-line bg-surface">
      <div className={`${cols} h-11 border-b border-line bg-surface-deep font-mono text-[11px] tracking-[1px] text-faint max-[959px]:hidden`}>
        <span />
        <span>PROJECT</span>
        <span>CHAINS</span>
        {head('tvlUsd', 'TVL')}
        {head('volume24hUsd', 'VOLUME 24H')}
        {head('fees24hUsd', 'FEES 24H')}
        <span />
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
          {/* TODO: send the notify-me sign-up to the mailing list provider. */}
          <button
            type="button"
            aria-pressed={notified}
            onClick={() => setNotified((n) => !n)}
            className={`relative ml-auto min-h-11 whitespace-nowrap rounded-btn border px-[18px] py-3 text-[14px] font-semibold transition-colors ${
              notified ? 'border-success-line bg-success-bg text-green' : 'border-gold-line bg-transparent text-gold hover:border-gold'
            }`}
          >
            {notified ? '✓ On the list' : 'Notify me'}
          </button>
        </div>
      ))}
    </div>
  )
}
