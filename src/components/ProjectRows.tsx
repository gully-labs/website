import { useState } from 'react'
import { Link } from 'react-router'
import { comingSoon, projects, TOTAL_SLOTS, type Project } from '../content/projects'
import { fmtTime, fmtUsd, sourceHost, type Stats, type Venue } from '../lib/stats'
import { NotifyMe } from './NotifyMe'
import { BlinkDot } from './ui'

/* The projects as one sortable table: venue, chains, then volume, value locked and fees, each with a
   bar against the largest readable figure. Every row reads its project's own API (GET /api/stats); a
   figure a venue does not publish is "—" with no bar, a venue that could not be read says so. */

type Dir = 'descending' | 'ascending'
type Col = 'volume' | 'tvl' | 'fees'
type State = 'loading' | 'error' | 'ok'

const COLS: { key: Col; label: string }[] = [
  { key: 'volume', label: 'VOLUME' },
  { key: 'tvl', label: 'TVL' },
  { key: 'fees', label: 'FEES' },
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

/** Small secondary facts a venue publishes beyond the three columns (DeepCore: hosted sites,
    launches in 24h, dollars in locks). A fact the venue left out reads "—", never 0. */
function extrasOf(v: Venue | undefined): string | null {
  if (!v || v.state !== 'ok' || v.key !== 'deepcore') return null
  const c = v.counts
  const n = (x: number | null | undefined) => (x === null || x === undefined ? '—' : x.toLocaleString('en-US'))
  return `${n(c.sites)} hosted site${c.sites === 1 ? '' : 's'} · ${n(c.launches24h)} launch${c.launches24h === 1 ? '' : 'es'} 24h · ${fmtUsd(v.lockedUsd)} in locks`
}

const initials = (name: string) =>
  name
    .split(/(?=[A-Z])|\s+/)
    .filter(Boolean)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()

function Cell({ p, venue, c, max, state }: { p: Project; venue?: Venue; c: Col; max: number; state: State }) {
  const f = figure(venue, c)
  let text: React.ReactNode
  if (state === 'loading') text = <span className="text-dim">…</span>
  else if (!venue || venue.state !== 'ok') text = <span className="text-error">unreadable</span>
  else if (f.n === null) text = <span className="text-dim" title="This venue does not publish this figure">—</span>
  else
    text = (
      <>
        {fmtUsd(f.n)}
        {f.note && <span className="ml-[6px] text-[11px] text-faint">{f.note}</span>}
      </>
    )
  const w = f.n !== null && max > 0 ? Math.max(2, (f.n / max) * 100) : 0
  return (
    <td className="min-w-[120px] px-2 py-3">
      <span className="flex flex-col gap-1">
        <span className="font-mono text-[13px] whitespace-nowrap">{text}</span>
        <span aria-hidden className="h-1 overflow-hidden rounded-[2px] bg-grid">
          <span className="block h-full rounded-[2px] transition-[width] duration-600" style={{ width: `${w}%`, background: p.accent }} />
        </span>
      </span>
    </td>
  )
}

const WORDS = ['zero', 'one', 'two', 'three', 'four', 'five']

/** The projects as rows, sortable by volume, value locked or fees; every row reads its project's own API. */
export function ProjectRows({ data, state }: { data: Stats | null; state: State }) {
  const [sort, setSort] = useState<{ key: Col; dir: Dir }>({ key: 'volume', dir: 'descending' })
  const venueOf = (key: string) => data?.venues.find((v) => v.key === key)
  const value = (key: string, c: Col) => figure(venueOf(key), c).n ?? -1
  const rows = [...projects].sort((a, b) => (sort.dir === 'descending' ? value(b.key, sort.key) - value(a.key, sort.key) : value(a.key, sort.key) - value(b.key, sort.key)))
  const maxOf = (c: Col) => Math.max(0, ...projects.map((p) => figure(venueOf(p.key), c).n ?? 0))

  return (
    <div className="flex flex-col gap-2">
      <div className="relative overflow-x-auto rounded-card border border-line bg-surface max-[759px]:hidden">
        <table className="w-full min-w-[760px] border-collapse">
          <caption className="sr-only">Gully Labs projects with their volume, value locked and fees, read live from each project's API</caption>
          <thead>
            <tr className="text-left font-mono text-[11px] tracking-[1px] text-faint">
              <th scope="col" className="px-4 py-3 font-medium">
                VENUE
              </th>
              <th scope="col" className="px-2 py-3 font-medium">
                CHAINS
              </th>
              {COLS.map((c) => {
                const on = sort.key === c.key
                return (
                  <th key={c.key} scope="col" aria-sort={on ? sort.dir : 'none'} className="px-2 py-[6px] font-medium">
                    <button
                      type="button"
                      onClick={() => setSort((s) => ({ key: c.key, dir: s.key === c.key && s.dir === 'descending' ? 'ascending' : 'descending' }))}
                      className={`min-h-11 bg-transparent p-0 font-mono text-[11px] tracking-[1px] transition-colors hover:text-ink ${on ? 'text-gold' : 'text-faint'}`}
                    >
                      {c.label} {on ? (sort.dir === 'descending' ? '↓' : '↑') : '↕'}
                    </button>
                  </th>
                )
              })}
              <th scope="col" className="px-4 py-3">
                <span className="sr-only">Links</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => {
              const venue = venueOf(p.key)
              const provenance =
                venue?.state === 'ok'
                  ? `Read from ${sourceHost(venue.source.url)} at ${fmtTime(venue.source.readAt)}${venue.notes.length ? ` · ${venue.notes.join(' ')}` : ''}`
                  : venue?.state === 'error'
                    ? `Could not be read: ${venue.error}`
                    : undefined
              return (
                <tr key={p.key} className="border-t border-line transition-colors hover:bg-surface-hover" title={provenance}>
                  <td className="px-4 py-3">
                    <Link to={`/projects/${p.slug}`} className="group flex items-center gap-3 text-ink hover:text-ink">
                      <span aria-hidden className="grid size-[34px] flex-none place-items-center rounded-[8px] font-display text-[15px] font-extrabold text-bg" style={{ background: p.accent }}>
                        {initials(p.name)}
                      </span>
                      <span className="flex flex-col leading-[1.2]">
                        <b className="font-semibold group-hover:text-gold">{p.name}</b>
                        <span className="text-[12px] text-dim">{p.tagline}</span>
                        {extrasOf(venue) && <span className="mt-[2px] font-mono text-[11px] text-faint">{extrasOf(venue)}</span>}
                      </span>
                    </Link>
                  </td>
                  <td className="px-2 py-3 text-[12px] text-muted">{p.chains.join(' · ')}</td>
                  {COLS.map((c) => (
                    <Cell key={c.key} p={p} venue={venue} c={c.key} max={maxOf(c.key)} state={state} />
                  ))}
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    <a href={p.url} target="_blank" rel="noopener" className="inline-flex min-h-11 items-center text-[13px] text-gold hover:text-gold-hover">
                      Visit ↗<span className="sr-only"> {p.name}</span>
                    </a>
                  </td>
                </tr>
              )
            })}
            {comingSoon.length > 0 && (
              <tr className="border-t border-line">
                <td colSpan={6} className="px-4 py-3">
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="flex items-center gap-2 font-mono text-[12px] text-faint">
                      <BlinkDot color="gold" />+ {WORDS[comingSoon.length] ?? comingSoon.length} venue{comingSoon.length === 1 ? '' : 's'} in development · IN THE LAB · {comingSoon.join(', ')} / {TOTAL_SLOTS}
                    </span>
                    <NotifyMe slot={comingSoon[0]} />
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {/* Phone: one card per venue, the three figures side by side, sorted by the same control. */}
      <div className="flex flex-col gap-2 min-[760px]:hidden">
        <div role="group" aria-label="Sort by" className="flex gap-[2px] rounded-[8px] border border-line p-[2px]">
          {COLS.map((c) => {
            const on = sort.key === c.key
            return (
              <button
                key={c.key}
                type="button"
                aria-pressed={on}
                onClick={() => setSort((s) => ({ key: c.key, dir: s.key === c.key && s.dir === 'descending' ? 'ascending' : 'descending' }))}
                className={`min-h-11 flex-1 rounded-[6px] font-mono text-[11px] tracking-[1px] transition-colors ${on ? 'bg-gold text-bg' : 'bg-transparent text-muted'}`}
              >
                {c.label} {on ? (sort.dir === 'descending' ? '↓' : '↑') : ''}
              </button>
            )
          })}
        </div>
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {rows.map((p) => {
            const venue = venueOf(p.key)
            return (
              <li key={p.key} className="flex flex-col gap-3 rounded-card border border-line bg-surface p-4">
                <div className="flex items-center gap-3">
                  <Link to={`/projects/${p.slug}`} className="flex min-w-0 flex-1 items-center gap-3 text-ink hover:text-ink">
                    <span aria-hidden className="grid size-[34px] flex-none place-items-center rounded-[8px] font-display text-[15px] font-extrabold text-bg" style={{ background: p.accent }}>
                      {initials(p.name)}
                    </span>
                    <span className="flex min-w-0 flex-col leading-[1.2]">
                      <b className="font-semibold">{p.name}</b>
                      <span className="truncate text-[12px] text-dim">{p.chains.join(' · ')}</span>
                      {extrasOf(venue) && <span className="mt-[2px] font-mono text-[11px] text-faint">{extrasOf(venue)}</span>}
                    </span>
                  </Link>
                  <a href={p.url} target="_blank" rel="noopener" className="inline-flex min-h-11 items-center text-[13px] text-gold">
                    Visit ↗<span className="sr-only"> {p.name}</span>
                  </a>
                </div>
                <table className="w-full table-fixed border-collapse">
                  <thead>
                    <tr className="text-left font-mono text-[10px] tracking-[1px] text-faint">
                      {COLS.map((c) => (
                        <th key={c.key} scope="col" className="px-2 pb-1 font-medium first:pl-0">
                          {c.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="[&>td]:min-w-0 [&>td]:py-0 [&>td:first-child]:pl-0">
                      {COLS.map((c) => (
                        <Cell key={c.key} p={p} venue={venue} c={c.key} max={maxOf(c.key)} state={state} />
                      ))}
                    </tr>
                  </tbody>
                </table>
              </li>
            )
          })}
          {comingSoon.length > 0 && (
            <li className="flex flex-col gap-3 rounded-card border border-dashed border-line-strong p-4">
              <span className="flex items-center gap-2 font-mono text-[12px] text-faint">
                <BlinkDot color="gold" />+ {WORDS[comingSoon.length] ?? comingSoon.length} venue{comingSoon.length === 1 ? '' : 's'} in development
              </span>
              <NotifyMe slot={comingSoon[0]} />
            </li>
          )}
        </ul>
      </div>
      <p className="m-0 font-mono text-[11px] leading-[1.5] text-faint">
        {state === 'ok' && data ? `Read at ${fmtTime(data.generatedAt)}. ` : ''}Volume and fees are all-time unless marked. — means the venue does not publish that figure; on a wide screen, hover a row for its source.
      </p>
    </div>
  )
}
