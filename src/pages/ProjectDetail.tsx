import { Link, Navigate, useParams } from 'react-router'
import { useContact } from '../components/ContactContext'
import { Seo } from '../components/Seo'
import { Sparkline } from '../components/Sparkline'
import { btnOutline, statusPill } from '../components/ui'
import { projectNumber, projects, TOTAL_SLOTS } from '../content/projects'

const cardTitle = 'm-0 font-display text-[28px] font-bold uppercase'

export function ProjectDetail() {
  const { slug } = useParams()
  const { openContact } = useContact()
  const index = projects.findIndex((p) => p.slug === slug)
  if (index < 0) return <Navigate to="/" replace />

  const p = projects[index]
  const next = projects[(index + 1) % projects.length]
  const stats = [...p.metrics, { label: 'CATEGORY', value: p.tag }, { label: 'STATUS', value: p.status }]

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
        </div>
      </div>

      <dl className="m-0 grid grid-cols-[repeat(auto-fit,minmax(min(100%,200px),1fr))] gap-px overflow-hidden rounded-card border border-line bg-line">
        {stats.map((s) => (
          <div key={s.label} className="flex flex-col gap-[6px] bg-surface px-7 py-6">
            <dt className="font-mono text-[11px] tracking-[1px] text-faint">{s.label}</dt>
            <dd className="m-0 font-display text-[40px] leading-none font-bold">{s.value}</dd>
          </div>
        ))}
      </dl>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,420px),1fr))] gap-5">
        <div className="flex flex-col gap-5 rounded-card border border-line bg-surface p-7">
          <div className="flex flex-col gap-1">
            <h2 className={cardTitle}>Activity</h2>
            <span className="font-mono text-[12px] text-faint">Last 9 months · sample data</span>
          </div>
          <div
            className="h-[220px]"
            style={{
              background:
                'repeating-linear-gradient(180deg,transparent 0,transparent calc(25% - 1px),#1a2029 calc(25% - 1px),#1a2029 25%)',
            }}
          >
            <Sparkline key={p.slug} data={p.series} color={p.accent} large label={`${p.name} activity, last 9 months`} />
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
