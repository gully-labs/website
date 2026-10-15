import { projects } from '../content/projects'
import { fmtUsd, type Stats } from '../lib/stats'
import { Sparkline } from './Sparkline'
import { BlinkDot } from './ui'

/** The hero's live panel: one row per venue, its 24h volume and the shape of its last two weeks. */
export function VenueTicker({ data, state }: { data: Stats | null; state: 'loading' | 'error' | 'ok' }) {
  return (
    <div className="flex flex-col overflow-hidden rounded-card border border-line bg-surface" aria-label="Venues, live">
      <div className="flex items-center justify-between border-b border-line px-5 py-[14px] font-mono text-[12px] tracking-[1px] text-dim">
        <span>VENUES · VOLUME 24H</span>
        <span className="flex items-center gap-2 text-green">
          <BlinkDot color="green" />
          LIVE
        </span>
      </div>
      {projects.map((p, i) => {
        const v = data?.venues.find((x) => x.key === p.key)
        const series = v?.state === 'ok' ? v.daily.slice(-14).map((d) => d.v) : []
        const value = state !== 'ok' ? (state === 'loading' ? '…' : '—') : v?.state === 'ok' ? fmtUsd(v.volume24hUsd) : '—'
        const note =
          state === 'loading' ? 'reading' : state === 'error' ? 'unreadable' : v?.state === 'ok' ? (v.volume24hUsd === null ? 'not published' : 'volume 24h') : 'unreadable'
        const bad = note === 'unreadable'
        return (
          <a
            key={p.key}
            href={p.url}
            target="_blank"
            rel="noopener"
            className="grid grid-cols-[22px_1fr_72px_auto] items-center gap-[14px] border-b border-line px-5 py-3 text-ink transition-colors last:border-b-0 hover:bg-surface-hover hover:text-ink"
            style={{ animation: `gl-rise .5s ${0.25 + i * 0.06}s ease both` }}
          >
            <span aria-hidden className="size-[10px] rounded-full" style={{ background: p.accent }} />
            <span className="min-w-0">
              <span className="block text-[14px]">{p.name}</span>
              <span className="mt-[2px] block font-mono text-[11px] text-faint">{p.tag}</span>
            </span>
            <span className="h-6 w-[72px]">
              {series.length > 1 ? <Sparkline data={series} color={p.accent} delay={0.2 + i * 0.1} /> : <span className="block pt-1 text-right font-mono text-[10px] text-faint">{state === 'ok' ? 'no series' : ''}</span>}
            </span>
            <span className="text-right">
              <span className="block font-mono text-[14px]">{value}</span>
              <span className={`block font-mono text-[11px] ${bad ? 'text-error' : 'text-faint'}`}>{note}</span>
            </span>
          </a>
        )
      })}
    </div>
  )
}
