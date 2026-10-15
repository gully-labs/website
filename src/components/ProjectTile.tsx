import { useState } from 'react'
import { Link } from 'react-router'
import { TOTAL_SLOTS, type Project } from '../content/projects'
import { fmtTime, metricsOf, sourceHost, type Venue } from '../lib/stats'
import { Sparkline } from './Sparkline'
import { BlinkDot, statusPill } from './ui'

const tile = 'flex flex-col overflow-hidden rounded-card border border-line bg-surface text-ink'
const art = 'h-[clamp(200px,22cqw,280px)] w-full'
const strip = 'flex w-full flex-wrap items-center justify-between gap-5 border-t-[3px] bg-surface-deep px-7 py-[14px]'
const info = 'flex w-full flex-1 flex-wrap items-center justify-between gap-6 border-t border-line px-7 py-6'
const title = 'font-display text-[30px] font-bold uppercase'
const body = 'text-[15px] leading-[1.5] text-muted'

/** A project's figures, read from its own API. `venue` is undefined while loading. */
export function ProjectTile({ project: p, index, venue, failed }: { project: Project; index: number; venue?: Venue; failed?: boolean }) {
  const metrics = failed && !venue ? metricsOf({ key: p.key, state: 'error', error: 'could not be read' }) : metricsOf(venue)
  const series = venue?.state === 'ok' ? venue.daily.slice(-14).map((d) => d.v) : []
  const provenance =
    venue?.state === 'ok'
      ? `Read from ${sourceHost(venue.source.url)} at ${fmtTime(venue.source.readAt)}${venue.notes.length ? ` · ${venue.notes[0]}` : ''}`
      : venue?.state === 'error'
        ? `Could not be read: ${venue.error}`
        : failed
          ? 'Could not be read.'
          : 'Reading…'
  return (
    <Link
      to={`/projects/${p.slug}`}
      className={`${tile} transition-[border-color,transform] duration-200 hover:-translate-y-0.5 hover:border-line-hover hover:text-ink`}
      style={{ animation: `gl-rise .6s ${index * 0.08}s ease both` }}
    >
      <div className={`${art} flex items-center justify-center`} style={{ background: p.bg, padding: p.pad }}>
        <img src={p.logo} alt={p.name} loading="lazy" className="block size-full" style={{ objectFit: p.fit }} />
      </div>
      <div className={strip} style={{ borderTopColor: p.accent }}>
        <div className="flex gap-7 font-mono">
          {metrics.map((m) => (
            <div key={m.label} className="flex flex-col gap-[2px]">
              <span className="text-[11px] text-faint">{m.label}</span>
              <span className={`text-[17px] ${m.missing ? 'text-dim' : 'text-ink'}`}>{m.value}</span>
            </div>
          ))}
        </div>
        <div className="flex h-10 w-[140px] items-center justify-end">
          {series.length > 1 ? (
            <Sparkline data={series} color={p.accent} delay={0.3 + index * 0.15} />
          ) : (
            <span className="font-mono text-[11px] text-faint">{venue ? 'no series yet' : ''}</span>
          )}
        </div>
      </div>
      <div className={info}>
        <div className="flex flex-[1_1_240px] flex-col gap-[6px]">
          <div className="flex flex-wrap items-baseline gap-3">
            <h3 className={`m-0 ${title}`}>{p.name}</h3>
            <span className="font-mono text-[12px] text-dim">{p.tag}</span>
          </div>
          <span className={body}>{p.description}</span>
        </div>
        <div className="flex flex-none flex-col items-end gap-2">
          <span className={statusPill}>{p.status}</span>
          <span className="text-[14px] text-gold">View project →</span>
        </div>
      </div>
      <p className="m-0 px-7 pb-4 font-mono text-[12px] leading-[1.5] text-faint">{provenance}</p>
    </Link>
  )
}

export function ComingSoonTile({ num }: { num: string }) {
  const [notified, setNotified] = useState(false)

  return (
    <div className={tile} style={{ animation: 'gl-rise .6s .4s ease both' }}>
      <div
        className={`${art} relative flex items-center justify-center overflow-hidden`}
        style={{ background: 'repeating-linear-gradient(135deg,#10141a 0 12px,#0d1116 12px 24px)' }}
      >
        <div
          aria-hidden
          className="absolute inset-0 animate-sweep"
          style={{ background: 'linear-gradient(90deg,transparent,rgba(232,192,96,.08),transparent)' }}
        />
        <div className="relative flex flex-col items-center gap-[10px]">
          <span
            aria-hidden
            className="font-display text-[clamp(64px,8cqw,110px)] leading-[.9] font-extrabold text-line"
            style={{ WebkitTextStroke: '1px #3a4452' }}
          >
            {num}
          </span>
          <span className="flex items-center gap-2 font-mono text-[12px] tracking-[1.5px] text-dim">
            <BlinkDot color="gold" />
            IN THE LAB
          </span>
        </div>
      </div>
      <div className={`${strip} min-h-[70px] border-line-strong font-mono`}>
        <span className="text-[12px] text-dim">STATUS · IN DEVELOPMENT</span>
        <span className="text-[12px] text-dim">
          {num} / {TOTAL_SLOTS}
        </span>
      </div>
      <div className={info}>
        <div className="flex flex-[1_1_240px] flex-col gap-[6px]">
          <h3 className={`m-0 ${title}`}>Project {num}</h3>
          <span className={body}>In the lab now. Get an email the day it launches.</span>
        </div>
        {/* TODO: send the notify-me sign-up to the mailing list provider. */}
        <button
          type="button"
          aria-pressed={notified}
          onClick={() => setNotified((n) => !n)}
          className={`min-h-11 flex-none whitespace-nowrap rounded-btn border px-[18px] py-3 text-[14px] font-semibold transition-colors ${
            notified ? 'border-success-line bg-success-bg text-green' : 'border-gold-line bg-transparent text-gold hover:border-gold'
          }`}
        >
          {notified ? '✓ On the list' : 'Notify me'}
        </button>
      </div>
    </div>
  )
}
