import { Link, Navigate, useParams } from 'react-router'
import { useContact } from '../components/ContactContext'
import { DailyLine, EmptySeries } from '../components/LiveChart'
import { Seo } from '../components/Seo'
import { ShareMenu } from '../components/Share'
import { btnOutline, statusPill } from '../components/ui'
import { projectNumber, projects, TOTAL_SLOTS } from '../content/projects'
import { useStats } from '../hooks/useStats'
import { ChainLogo } from '../components/logos/ChainLogo'
import { chainMark } from '../components/logos/registry'
import { fmtTime, fmtUsd, metricsOf, sourceHost } from '../lib/stats'
import { LaunchHolders } from '../components/holders/LaunchHolders'

const cardTitle = 'm-0 font-display text-[28px] font-bold uppercase'

export function ProjectDetail() {
  const { slug } = useParams()
  const { openContact } = useContact()
  const st = useStats()
  const index = projects.findIndex((p) => p.slug === slug)
  if (index < 0) return <Navigate to="/" replace />

  const p = projects[index]
  const next = projects[(index + 1) % projects.length]
  const venue = st.k === 'ok' ? st.data.venues.find((v) => v.key === p.key) : undefined
  const live = st.k === 'error' ? metricsOf({ key: p.key, state: 'error', error: 'could not be read' }) : metricsOf(venue)
  // Four live figures when the venue answers; a figure the venue does not publish reads "not published".
  // Category and status are already in the header, so they no longer take a tile.
  const usd = (label: string, n: number | null | undefined) => ({ label, value: n === null || n === undefined ? 'not published' : fmtUsd(n), missing: n === null || n === undefined })
  const stats =
    venue?.state === 'ok'
      ? [
          usd(p.key === 'peddlequest' ? 'ESCROWED (TVL)' : 'TVL', venue.tvlUsd),
          venue.volumeAllUsd === null && venue.volume30dUsd !== null && venue.volume30dUsd !== undefined ? usd('VOLUME 30 DAYS', venue.volume30dUsd) : usd('VOLUME ALL-TIME', venue.volumeAllUsd),
          usd('VOLUME 24H', venue.volume24hUsd),
          usd('FEES ALL-TIME', venue.feesAllUsd),
        ]
      : [...live, { label: 'CATEGORY', value: p.tag }, { label: 'STATUS', value: p.status }]
  const series = venue?.state === 'ok' ? venue.daily.slice(-30) : []
  const provenance =
    venue?.state === 'ok'
      ? `Read from ${sourceHost(venue.source.url)} at ${fmtTime(venue.source.readAt)}.${venue.notes.length ? ` ${venue.notes.join(' ')}` : ''}`
      : venue?.state === 'error'
        ? `Could not be read: ${venue.error}`
        : st.k === 'error'
          ? 'Could not be read.'
          : 'Reading…'

  return (
    <div className="flex flex-col gap-10 px-page pt-10 pb-24">
      <Seo title={p.name} description={`${p.tagline}. ${p.description}`} />

      <Link
        to="/#projects"
        className="self-start py-2 font-mono text-[13px] text-muted transition-colors hover:text-ink"
      >
        ← ALL PROJECTS
      </Link>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,440px),1fr))] items-center gap-[clamp(32px,4cqw,56px)]">
        <div
          className="flex h-[clamp(240px,30cqw,400px)] items-center justify-center overflow-hidden rounded-card border border-b-[3px] border-line"
          style={{ background: p.bg, borderBottomColor: p.accent, padding: p.pad }}
        >
          <img src={p.logo} alt={p.name} className="block size-full" style={{ objectFit: p.fit }} />
        </div>
        <div className="flex min-w-0 flex-col gap-5">
          <div className="flex flex-wrap items-center gap-3 font-mono text-[12px]">
            <span className="whitespace-nowrap text-dim">
              {projectNumber(index)} / {TOTAL_SLOTS} · {p.tag}
            </span>
            <span className={statusPill}>{p.status}</span>
          </div>
          <h1 className="m-0 font-display text-[clamp(52px,6.5cqw,96px)] leading-[.9] font-extrabold uppercase">
            {p.name}
          </h1>
          <div className="font-mono text-[15px]" style={{ color: p.accent }}>
            {p.tagline}
          </div>
          <p className="m-0 max-w-[560px] text-[18px] leading-[1.6] text-muted">{p.description}</p>
          <div className="flex flex-wrap gap-2">
            {p.chains.map((c) => (
              <span key={c} className="inline-flex items-center gap-1.5 rounded-full border border-line-strong py-[3px] pr-[10px] pl-[4px] font-mono text-[11px] tracking-[.5px] text-muted">
                {chainMark(c) ? <ChainLogo chain={c} size={16} decorative /> : <span className="w-[6px]" />}
                {c}
              </span>
            ))}
          </div>
          <div className="mt-2 flex flex-wrap gap-3">
            <a
              href={p.url}
              target="_blank"
              rel="noopener"
              className="whitespace-nowrap rounded-btn px-[26px] py-4 font-semibold text-bg transition-[filter] hover:text-bg hover:brightness-110"
              style={{ background: p.accent }}
            >
              Visit {p.name} ↗
            </a>
            <button
              type="button"
              onClick={() => openContact()}
              className={`${btnOutline} px-[26px] py-4 text-[16px]`}
            >
              Build something similar
            </button>
          </div>
          <ShareMenu project={p} />
        </div>
      </div>

      <div className="flex flex-col gap-3">
        <dl className="m-0 grid grid-cols-[repeat(auto-fit,minmax(min(100%,200px),1fr))] gap-px overflow-hidden rounded-card border border-line bg-line">
          {stats.map((s) => (
            <div key={s.label} className="flex flex-col gap-[6px] bg-surface px-7 py-6">
              <dt className="font-mono text-[11px] tracking-[1px] text-faint">{s.label}</dt>
              <dd className={`m-0 font-display leading-none font-bold ${'missing' in s && s.missing ? 'text-[22px] text-dim' : 'text-[40px]'}`}>{s.value}</dd>
            </div>
          ))}
        </dl>
        <p className="m-0 font-mono text-[12px] leading-[1.5] text-faint">{provenance}</p>
      </div>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,420px),1fr))] gap-5">
        <div className="flex flex-col gap-5 rounded-card border border-line bg-surface p-7">
          <div className="flex flex-col gap-1">
            <h2 className={cardTitle}>Volume</h2>
            <span className="font-mono text-[12px] text-faint">
              {series.length > 1 ? `Daily, last ${series.length} days · read from ${sourceHost(venue!.state === 'ok' ? venue!.source.url : '')}` : 'Daily'}
            </span>
          </div>
          <div className="min-h-[220px]">
            {st.k === 'loading' ? (
              <p className="m-0 py-6 font-mono text-[12px] text-faint">Reading…</p>
            ) : series.length > 1 ? (
              <DailyLine key={p.slug} series={series} color={p.accent} label={`${p.name} daily volume`} />
            ) : venue?.state === 'ok' ? (
              <EmptySeries n={series.length} />
            ) : (
              <p className="m-0 py-6 font-mono text-[12px] text-error">Could not be read.</p>
            )}
          </div>
        </div>
        <div className="flex flex-col gap-5 rounded-card border border-line bg-surface p-7">
          <h2 className={cardTitle}>What we built</h2>
          <ul className="m-0 flex list-none flex-col p-0">
            {p.built.map((b) => (
              <li key={b} className="flex items-baseline gap-[14px] border-t border-line py-4 text-[17px]">
                <span aria-hidden className="font-mono text-[13px]" style={{ color: p.accent }}>
                  +
                </span>
                {b}
              </li>
            ))}
          </ul>
        </div>
      </div>

      {p.key === 'deepcore' && (
        <section aria-labelledby="dc-holders" className="flex flex-col gap-4 rounded-card border border-line bg-surface p-7">
          <div className="flex flex-col gap-1">
            <h2 id="dc-holders" className={cardTitle}>
              Latest launches · who holds them
            </h2>
            <span className="font-mono text-[12px] text-faint">Holder Maps by Gully Labs: bundled buys, the deployer’s share and connected wallets, for every new DeepCore token.</span>
          </div>
          <LaunchHolders />
        </section>
      )}

      <Link
        to={`/projects/${next.slug}`}
        className="flex flex-wrap items-center justify-between gap-6 rounded-card border border-line bg-surface p-7 text-ink transition-colors hover:border-line-hover hover:text-ink"
      >
        <span className="font-mono text-[12px] text-dim">NEXT PROJECT</span>
        <span className="font-display text-[clamp(32px,4cqw,48px)] font-extrabold uppercase">{next.name} →</span>
      </Link>
    </div>
  )
}
