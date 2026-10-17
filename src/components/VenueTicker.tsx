import { projects } from '../content/projects'
import { fmtUsd, type Stats } from '../lib/stats'
import { Sparkline } from './Sparkline'
import { BlinkDot } from './ui'

/** The hero's live panel: one row per venue with its own lockup, all-time volume, 24h volume
    and the shape of its last two weeks, redrawing on a loop. */
export function VenueTicker({ data, state }: { data: Stats | null; state: 'loading' | 'error' | 'ok' }) {
  return (
    <div className="flex flex-col overflow-hidden rounded-card border border-line bg-surface" aria-label="Venues, live">
      <div className="flex items-center justify-between border-b border-line px-5 py-[14px] font-mono text-[12px] tracking-[1px] text-dim">
        <span>VENUES · VOLUME ALL-TIME</span>
        <span className="flex items-center gap-2 text-green">
          <BlinkDot color="green" />
          LIVE
        </span>
      </div>
      {projects.map((p, i) => {
        const v = data?.venues.find((x) => x.key === p.key)
        const ok = v?.state === 'ok' ? v : null
        const series = ok ? ok.daily.slice(-14).map((d) => d.v) : []
        const all = state !== 'ok' ? (state === 'loading' ? '…' : '—') : ok ? fmtUsd(ok.volumeAllUsd ?? ok.volume30dUsd ?? null) : '—'
        const sub =
          state === 'loading'
            ? 'reading'
            : state === 'error' || !ok
              ? 'unreadable'
              : ok.volumeAllUsd !== null
                ? `24h ${fmtUsd(ok.volume24hUsd)}`
                : ok.volume30dUsd !== null && ok.volume30dUsd !== undefined
                  ? `30 days · 24h ${fmtUsd(ok.volume24hUsd)}`
                  : ok.volume24hUsd !== null
                    ? `24h ${fmtUsd(ok.volume24hUsd)} · all-time not published`
                    : 'not published'
        const bad = sub === 'unreadable'
        return (
          <a
            key={p.key}
            href={p.url}
            target="_blank"
            rel="noopener noreferrer"
            className="gl-row-sweep relative grid grid-cols-[96px_1fr_84px_auto] items-center gap-[14px] border-b border-line px-5 py-3 text-ink transition-colors last:border-b-0 hover:bg-surface-hover hover:text-ink"
            style={{ animation: `gl-rise .5s ${0.25 + i * 0.06}s ease both`, ['--sweep-delay' as string]: `${i * 1.2}s` }}
          >
            <span className="flex h-11 w-24 items-center justify-center overflow-hidden rounded-[8px] border-b-2 border-line" style={{ background: p.bg, borderBottomColor: p.accent }}>
              <img src={p.logo} alt={p.name} className="block size-full" style={{ objectFit: p.fit, padding: p.fit === 'contain' ? '6px 10px' : 0 }} />
            </span>
            <span className="min-w-0">
              <span className="block text-[14px]">{p.name}</span>
              <span className="mt-[2px] block font-mono text-[11px] text-faint">{p.tag}</span>
            </span>
            <span className="h-7 w-[84px]">
              {series.length > 1 ? (
                <Sparkline data={series} color={p.accent} delay={0.2 + i * 0.9} loop />
              ) : (
                <span className="block pt-2 text-right font-mono text-[11px] text-faint">{state === 'ok' ? 'no series' : ''}</span>
              )}
            </span>
            <span className="text-right">
              <span className="block font-mono text-[15px]">{all}</span>
              <span className={`block font-mono text-[11px] ${bad ? 'text-error' : 'text-faint'}`}>{sub}</span>
            </span>
          </a>
        )
      })}
    </div>
  )
}
