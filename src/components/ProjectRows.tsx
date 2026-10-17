import { useState } from 'react'
import { Link } from 'react-router'
import { motion } from 'motion/react'
import { ArrowUpRight } from 'lucide-react'
import { comingSoon, projects, type Project } from '../content/projects'
import { fmtTime, fmtUsd, sourceHost, type Point, type Stats, type Venue } from '../lib/stats'
import { NotifyMe } from './NotifyMe'
import { BlinkDot } from './ui'
import { ChainLogo } from './logos/ChainLogo'
import { VenueLogo } from './logos/VenueLogo'
import { chainMark } from './logos/registry'

/* The projects as compact cards: venue badge, name, tagline, chains, status, a sparkline of its daily
   volume that draws in when it scrolls into view, then volume, value locked and fees, each with a bar
   against the largest readable figure that grows in on first view. The sort switch re-orders the cards
   with an animated layout change. Every card reads its project's own API (GET /api/stats); a figure a
   venue does not publish is "—" with no bar, a venue that could not be read says so. Motion follows
   the landing's MotionConfig (reduced motion: no growth, no travel; the numbers still update). */

type Col = 'volume' | 'tvl' | 'fees'
type State = 'loading' | 'error' | 'ok'

const COLS: { key: Col; label: string; long: string }[] = [
  { key: 'volume', label: 'VOLUME', long: 'Volume' },
  { key: 'tvl', label: 'TVL', long: 'Value locked' },
  { key: 'fees', label: 'FEES', long: 'Fees' },
]

/** A venue's figure for a column, with a note when it is not the all-time figure. */
function figure(v: Venue | undefined, c: Col): { n: number | null; note?: string } {
  if (!v || v.state !== 'ok') return { n: null }
  if (c === 'tvl') return { n: v.tvlUsd }
  if (c === 'volume') {
    if (v.volumeAllUsd !== null) return { n: v.volumeAllUsd }
    if (v.volume30dUsd !== null && v.volume30dUsd !== undefined) return { n: v.volume30dUsd, note: '30d' }
    return { n: v.volume24hUsd, note: v.volume24hUsd === null ? undefined : '24h' }
  }
  if (v.feesAllUsd !== null && v.feesAllUsd !== undefined) return { n: v.feesAllUsd }
  return { n: v.fees24hUsd, note: v.fees24hUsd === null ? undefined : '24h' }
}

/** Small secondary facts a venue publishes beyond the three figures (DeepCore: hosted sites,
    launches in 24h, dollars in locks). A fact the venue left out reads "—", never 0. */
function extrasOf(v: Venue | undefined): string | null {
  if (!v || v.state !== 'ok' || v.key !== 'deepcore') return null
  const c = v.counts
  const n = (x: number | null | undefined) => (x === null || x === undefined ? '—' : x.toLocaleString('en-US'))
  return `${n(c.sites)} hosted site${c.sites === 1 ? '' : 's'} · ${n(c.launches24h)} launch${c.launches24h === 1 ? '' : 'es'} 24h · ${fmtUsd(v.lockedUsd)} in locks`
}

const WORDS = ['zero', 'one', 'two', 'three', 'four', 'five']
const ease = [0.2, 0.8, 0.2, 1] as const
const SW = 240
const SH = 40

/** The venue's daily volume over its last 30 readings, drawn in once when it comes into view. */
function Spark({ p, daily, state }: { p: Project; daily: Point[] | null; state: State }) {
  const pts = (daily ?? []).slice(-30)
  if (pts.length < 2)
    return (
      <span className="flex h-10 items-center font-mono text-[11px] text-faint">
        {state === 'loading' ? 'reading…' : daily === null ? 'daily series unreadable' : 'no daily series published'}
      </span>
    )
  const max = Math.max(...pts.map((d) => d.v)) || 1
  const xy = pts.map((d, i) => [(i / (pts.length - 1)) * SW, SH - 3 - (d.v / max) * (SH - 6)] as const)
  const line = xy.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ')
  const area = `${line} L${SW} ${SH} L0 ${SH} Z`
  const [lx, ly] = xy[xy.length - 1]
  return (
    <svg viewBox={`0 0 ${SW} ${SH}`} preserveAspectRatio="none" className="block h-10 w-full overflow-visible" role="img" aria-label={`${p.name} daily volume, last ${pts.length} days, peak ${fmtUsd(max)}`}>
      <motion.path d={area} fill={p.accent} initial={{ opacity: 0 }} whileInView={{ opacity: 0.12 }} viewport={{ once: true }} transition={{ duration: 0.6, delay: 0.3 }} />
      <motion.path
        d={line}
        fill="none"
        stroke={p.accent}
        strokeWidth={1.5}
        vectorEffect="non-scaling-stroke"
        strokeLinejoin="round"
        initial={{ pathLength: 0 }}
        whileInView={{ pathLength: 1 }}
        viewport={{ once: true }}
        transition={{ duration: 0.9, ease }}
      />
      <motion.circle cx={lx} cy={ly} r={2.5} fill={p.accent} initial={{ opacity: 0 }} whileInView={{ opacity: 1 }} viewport={{ once: true }} transition={{ delay: 0.8, duration: 0.3 }} />
    </svg>
  )
}

function Metric({ p, venue, c, max, state, active }: { p: Project; venue?: Venue; c: (typeof COLS)[number]; max: number; state: State; active: boolean }) {
  const f = figure(venue, c.key)
  let text: React.ReactNode
  if (state === 'loading') text = <span className="text-dim">…</span>
  else if (!venue || venue.state !== 'ok') text = <span className="text-error">unreadable</span>
  else if (f.n === null) text = <span className="text-dim" title="This venue does not publish this figure">—</span>
  else
    text = (
      <>
        {f.n > 0 && f.n < 1 ? <span title={fmtUsd(f.n)}>{'<$1'}</span> : fmtUsd(f.n)}
        {f.note && <span className="ml-1 text-[11px] text-faint">{f.note}</span>}
      </>
    )
  const w = f.n !== null && max > 0 ? Math.max(2, (f.n / max) * 100) : 0
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <dt className={`font-mono text-[11px] tracking-[1px] ${active ? 'text-gold' : 'text-faint'}`}>
        <abbr title={c.long} className="no-underline">
          {c.label}
        </abbr>
      </dt>
      <dd className="m-0 flex flex-col gap-1">
        <span className="truncate font-mono text-[13px] whitespace-nowrap">{text}</span>
        <span aria-hidden className="h-1 overflow-hidden rounded-[2px] bg-grid">
          <motion.span
            className="block h-full origin-left rounded-[2px] transition-[width] duration-700"
            style={{ width: `${w}%`, background: p.accent }}
            initial={{ scaleX: 0 }}
            whileInView={{ scaleX: 1 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6, delay: 0.15, ease }}
          />
        </span>
      </dd>
    </div>
  )
}

/** The projects as cards, sortable by volume, value locked or fees; every card reads its project's own API. */
export function ProjectCards({ data, state }: { data: Stats | null; state: State }) {
  const [sort, setSort] = useState<Col>('volume')
  const venueOf = (key: string) => data?.venues.find((v) => v.key === key)
  const value = (key: string, c: Col) => figure(venueOf(key), c).n ?? -1
  const rows = [...projects].sort((a, b) => value(b.key, sort) - value(a.key, sort))
  const maxOf = (c: Col) => Math.max(0, ...projects.map((p) => figure(venueOf(p.key), c).n ?? 0))

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div role="group" aria-label="Sort the projects by" className="flex gap-[2px] rounded-[8px] border border-line p-[2px]">
          {COLS.map((c) => {
            const on = sort === c.key
            return (
              <button
                key={c.key}
                type="button"
                aria-pressed={on}
                onClick={() => setSort(c.key)}
                className={`relative min-h-11 min-w-[72px] rounded-[6px] bg-transparent px-3 font-mono text-[11px] tracking-[1px] transition-colors duration-200 ${on ? 'text-bg' : 'text-muted hover:text-ink'}`}
              >
                {on && <motion.span layoutId="project-sort" aria-hidden className="absolute inset-0 rounded-[6px] bg-gold" transition={{ type: 'spring', stiffness: 500, damping: 40 }} />}
                <span className="relative">{c.label} ↓</span>
              </button>
            )
          })}
        </div>
        <span className="font-mono text-[11px] text-faint" aria-live="polite">
          Sorted by {COLS.find((c) => c.key === sort)?.long.toLowerCase()}, largest first
        </span>
      </div>
      <ul className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(min(100%,310px),1fr))] gap-3 p-0">
        {rows.map((p, i) => {
          const venue = venueOf(p.key)
          const extras = extrasOf(venue)
          const provenance =
            venue?.state === 'ok'
              ? `Read from ${sourceHost(venue.source.url)} at ${fmtTime(venue.source.readAt)}${venue.notes.length ? ` · ${venue.notes.join(' ')}` : ''}`
              : venue?.state === 'error'
                ? `Could not be read: ${venue.error}`
                : undefined
          return (
            <motion.li
              key={p.key}
              layout="position"
              initial={{ opacity: 0, y: 14 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '-40px' }}
              transition={{ duration: 0.45, delay: i * 0.05, ease, layout: { type: 'spring', stiffness: 380, damping: 36 } }}
              title={provenance}
              className="group flex min-w-0 flex-col gap-3 rounded-card border border-line bg-surface p-4 transition-[border-color,background-color,box-shadow] duration-200 hover:border-line-hover hover:bg-surface-hover hover:shadow-[0_10px_30px_rgba(0,0,0,.35)]"
            >
              <div className="flex items-start gap-3">
                <VenueLogo venue={p.key} name={p.name} size={40} decorative className="ring-1 ring-line-strong transition-transform duration-200 group-hover:scale-105" />
                <span className="flex min-w-0 flex-1 flex-col leading-[1.25]">
                  <Link to={`/projects/${p.slug}`} className="relative w-fit font-semibold text-ink before:absolute before:-inset-y-3 before:inset-x-0 before:content-[''] hover:text-gold">
                    {p.name}
                  </Link>
                  <span className="text-[12px] text-dim">{p.tagline}</span>
                </span>
                <span className={`flex-none rounded-full border px-2 py-px font-mono text-[11px] ${venue?.state === 'error' ? 'border-line-strong text-error' : 'border-success-line text-green'}`}>{venue?.state === 'error' ? 'UNREAD' : p.status.toUpperCase()}</span>
              </div>
              <span className="-mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 font-mono text-[11px] text-faint">
                {p.chains.map((c) => (
                  <span key={c} className="inline-flex items-center gap-1.5">
                    {chainMark(c) && <ChainLogo chain={c} size={14} decorative />}
                    {c}
                  </span>
                ))}
              </span>
              <Spark p={p} daily={venue ? (venue.state === 'ok' ? venue.daily : null) : []} state={state} />
              <dl className="m-0 grid grid-cols-3 gap-3">
                {COLS.map((c) => (
                  <Metric key={c.key} p={p} venue={venue} c={c} max={maxOf(c.key)} state={state} active={c.key === sort} />
                ))}
              </dl>
              <div className="mt-auto flex items-center justify-between gap-2 border-t border-line pt-2">
                <span className="min-w-0 font-mono text-[11px] leading-[1.4] text-faint">{extras ?? (state === 'ok' && venue?.state === 'ok' ? `read ${fmtTime(venue.source.readAt)}` : '')}</span>
                <a href={p.url} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 min-w-11 flex-none items-center justify-end gap-1 text-[13px] text-gold hover:text-gold-hover">
                  Visit <ArrowUpRight aria-hidden size={13} />
                  <span className="sr-only"> {p.name}</span>
                <span className="sr-only"> (opens in a new tab)</span></a>
              </div>
            </motion.li>
          )
        })}
        {comingSoon.length > 0 && (
          <motion.li
            layout="position"
            initial={{ opacity: 0, y: 14 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-40px' }}
            transition={{ duration: 0.45, delay: rows.length * 0.05, ease }}
            className="flex min-w-0 flex-col justify-center gap-3 rounded-card border border-dashed border-line-strong p-4"
          >
            <span className="flex items-center gap-2 font-mono text-[12px] text-faint">
              <BlinkDot color="gold" />+ {WORDS[comingSoon.length] ?? comingSoon.length} venue{comingSoon.length === 1 ? '' : 's'} in development
            </span>
            <span className="font-display text-[26px] leading-none font-extrabold text-dim uppercase">
              Project {comingSoon.join(', ')} · in the lab
            </span>
            <NotifyMe slot={comingSoon[0]} />
          </motion.li>
        )}
      </ul>
      <p className="m-0 font-mono text-[11px] leading-[1.5] text-faint">
        {state === 'ok' && data ? `Read at ${fmtTime(data.generatedAt)}. ` : ''}Volume and fees are all-time unless marked. — means the venue does not publish that figure; hover a card for its source.
      </p>
    </div>
  )
}
