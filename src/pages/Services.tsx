import { Link } from 'react-router'
import { HeroLedger } from '../components/landing/HeroLedger'
import { useStats } from '../hooks/useStats'
import { useContact } from '../components/ContactContext'
import { Seo } from '../components/Seo'
import { ChainChip, VenueChip } from '../components/ProjectRows'
import { btnGold, eyebrow, SectionHeading } from '../components/ui'
import { projects } from '../content/projects'
import { processSteps, services } from '../content/services'

const rise = (i: number) => ({ animation: `gl-rise .55s ${i * 0.07}s ease both` })

/* Services in the ledger's language: a list container of rows that sweep, the process as a
   stepped band, and the projects as proof on their own grounds. Content is the kit's. */
export function Services() {
  const { openContact } = useContact()
  const st = useStats()

  return (
    <>
      <Seo
        title="Services"
        description="Smart contracts, dApps, chain infrastructure and security testing from the team behind the Gully Labs projects."
      />

      <section className="grid grid-cols-[1.1fr_.9fr] items-end gap-[clamp(32px,4cqw,72px)] px-page pt-[72px] pb-16 max-[959px]:grid-cols-1">
        <div className="flex flex-col gap-5">
          <span className={eyebrow} style={rise(0)}>
            SERVICES · THE SAME TEAM, ON YOUR PROJECT
          </span>
          <h1 className="m-0 font-display text-h1 font-extrabold uppercase" style={rise(1)}>
            Build with the team behind <span className="text-gold">the projects</span>
          </h1>
        </div>
        <div className="flex flex-col gap-5" style={rise(2)}>
          <p className="m-0 text-[18px] leading-[1.55] text-muted">
            We take on a small number of partner engagements alongside our own releases, using the same people and the same stack.
          </p>
          <button type="button" onClick={() => openContact()} className={`${btnGold} self-start px-[26px] py-4 text-[16px]`}>
            Start a project
          </button>
        </div>
      </section>

      <section aria-label="Services" className="px-page pb-24">
        <div className="overflow-hidden rounded-card border border-line bg-surface">
          <div className="grid h-11 grid-cols-[72px_1.2fr_1.6fr_160px_140px] items-center gap-6 border-b border-line bg-surface-deep px-7 font-mono text-[11px] tracking-[1px] text-faint max-[959px]:hidden">
            <span>#</span>
            <span>SERVICE</span>
            <span>WHAT IT COVERS</span>
            <span>TYPICAL TIMELINE</span>
            <span />
          </div>
          {services.map((s, i) => (
            <div
              key={s.n}
              className="gl-row-sweep relative grid grid-cols-[72px_1.2fr_1.6fr_160px_140px] items-center gap-6 border-b border-line px-7 py-7 transition-colors last:border-b-0 hover:bg-surface-hover max-[959px]:grid-cols-[72px_minmax(0,1fr)] max-[959px]:gap-y-3 max-[479px]:grid-cols-[48px_minmax(0,1fr)] max-[479px]:gap-x-4 max-[479px]:px-4"
              style={{ ...rise(i + 2), ['--sweep-delay' as string]: `${1 + i * 1.3}s` }}
            >
              <span className="flex flex-col items-start gap-3">
                <span className="flex size-12 items-center justify-center rounded-btn border border-gold-line text-gold">
                  <s.icon aria-hidden size={22} strokeWidth={1.6} />
                </span>
                <span className="font-mono text-[13px] text-gold">{s.n}</span>
              </span>
              <h2 className="m-0 min-w-0 font-display text-h3 font-extrabold break-words uppercase max-[479px]:text-[22px]">{s.name}</h2>
              <div className="flex min-w-0 flex-col gap-3 max-[959px]:col-start-2">
                <span className="text-[16px] leading-[1.55] break-words text-muted">{s.description}</span>
                <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
                  {s.items.map((it) => (
                    <li key={it} className="rounded-full border border-line-strong px-3 py-[5px] font-mono text-[12px] text-ink-2">
                      {it}
                    </li>
                  ))}
                </ul>
              </div>
              <div className="flex min-w-0 flex-col gap-1 max-[959px]:col-start-2">
                <span className="font-display text-[30px] break-words leading-none font-bold">{s.time}</span>
                {/* The column header says it on wide screens; repeat it only where the header is hidden. */}
                <span className="font-mono text-[11px] tracking-[.5px] text-faint min-[960px]:hidden">TYPICAL TIMELINE</span>
              </div>
              <button
                type="button"
                onClick={() => openContact(s.type)}
                className="inline-flex min-h-11 items-center justify-self-end bg-transparent p-0 text-[15px] font-medium whitespace-nowrap text-gold transition-colors hover:text-gold-hover max-[959px]:col-start-2 max-[959px]:justify-self-start"
              >
                Ask about this →
              </button>
            </div>
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-10 border-t border-line bg-bg-alt px-page py-24">
        <SectionHeading label="PROCESS" title="From idea to mainnet" />
        <ol className="m-0 grid list-none grid-cols-[repeat(auto-fit,minmax(min(100%,220px),1fr))] gap-px overflow-hidden rounded-card border border-line bg-line p-0">
          {processSteps.map((st, i) => (
            <li key={st.n} className="relative flex flex-col gap-3 overflow-hidden bg-bg-alt p-7" style={rise(i)}>
              <span className="flex items-center justify-between">
                <span className="font-mono text-[12px] tracking-[1px] text-dim">PHASE {st.n}</span>
                <st.icon aria-hidden size={20} strokeWidth={1.6} className="text-gold" />
              </span>
              <h3 className="m-0 font-display text-h4 font-bold uppercase">{st.name}</h3>
              <span className="text-[15px] leading-[1.55] text-muted">{st.description}</span>
              <span aria-hidden className="absolute inset-x-0 bottom-0 h-[2px] origin-left bg-gold" style={{ animation: `gl-grow-x .8s ${0.3 + i * 0.15}s cubic-bezier(.2,.8,.2,1) both` }} />
            </li>
          ))}
        </ol>
      </section>

      <section className="flex flex-col gap-10 border-t border-line px-page py-24">
        <div className="flex flex-wrap items-end justify-between gap-6">
          <SectionHeading label="PROOF" title="Built by this team" />
          <Link to="/#projects" className="inline-flex min-h-11 items-center text-[16px] font-medium text-gold transition-colors hover:text-gold-hover">
            The live ledger →
          </Link>
        </div>
        <div className="grid grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] items-start gap-6 max-[1099px]:grid-cols-1">
          <div className="flex min-w-0 flex-col gap-3">
            <HeroLedger data={st.k === 'ok' ? st.data : null} state={st.k} />
            <div className="flex flex-wrap gap-2" aria-label="Venues and chains">
              {projects.map((p) => (
                <VenueChip key={p.key} venue={p.key} name={p.name} />
              ))}
              {[...new Set(projects.flatMap((p) => p.chains))].map((c) => (
                <ChainChip key={c} chain={c} />
              ))}
            </div>
            <span className="font-mono text-[11px] text-faint">The venues this team built, read live from each one's own API: daily volume, stacked by venue.</span>
          </div>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,220px),1fr))] gap-4">
          {projects.map((p, i) => (
            <Link
              key={p.slug}
              to={`/projects/${p.slug}`}
              className="flex flex-col overflow-hidden rounded-card border border-line bg-surface text-left text-ink transition-[border-color,transform] duration-200 hover:-translate-y-0.5 hover:border-line-hover hover:text-ink"
              style={rise(i)}
            >
              <div className="flex h-[120px] w-full items-center justify-center" style={{ background: p.bg, padding: p.padSm }}>
                <img src={p.logo} alt={p.name} loading="lazy" decoding="async" width={248} height={120} className="block size-full" style={{ objectFit: p.fit }} />
              </div>
              <div className="flex w-full items-center justify-between border-t-2 px-5 py-4 text-[14px]" style={{ borderTopColor: p.accent }}>
                <span className="font-semibold">{p.name}</span>
                <span className="font-mono text-[11px] text-faint">{p.tag}</span>
              </div>
            </Link>
          ))}
        </div>
        </div>
      </section>
    </>
  )
}
