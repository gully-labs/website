import { Link } from 'react-router'
import { useContact } from '../components/ContactContext'
import { Seo } from '../components/Seo'
import { btnGold, eyebrow, SectionHeading } from '../components/ui'
import { projects } from '../content/projects'
import { processSteps, services } from '../content/services'

export function Services() {
  const { openContact } = useContact()

  return (
    <>
      <Seo
        title="Services"
        description="Smart contracts, dApps, chain infrastructure and security audits from the team behind the Gully Labs projects."
      />

      <section className="flex flex-wrap items-end justify-between gap-10 px-page pt-20 pb-24">
        <div className="flex min-w-0 flex-[1_1_560px] flex-col gap-5">
          <span className={eyebrow}>SERVICES</span>
          <h1 className="m-0 font-display text-[clamp(56px,7.8cqw,112px)] leading-[.9] font-extrabold uppercase">
            Build with the team behind <span className="text-gold">the projects</span>
          </h1>
        </div>
        <div className="flex flex-[0_1_400px] flex-col gap-5">
          <p className="m-0 text-[18px] leading-[1.55] text-muted">
            We take on a small number of partner engagements alongside our own releases, using the same people and the
            same stack.
          </p>
          <button
            type="button"
            onClick={() => openContact()}
            className={`${btnGold} self-start px-[26px] py-4 text-[16px]`}
          >
            Start a project
          </button>
        </div>
      </section>

      <section aria-label="Services" className="flex flex-col border-t border-line px-page pb-24">
        {services.map((s) => (
          <div
            key={s.n}
            className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,280px),1fr))] gap-8 border-b border-line py-12"
          >
            <div className="flex flex-col gap-[10px]">
              <span className="font-mono text-[13px] text-gold">{s.n}</span>
              <h2 className="m-0 font-display text-[clamp(36px,3.5cqw,48px)] leading-[.95] font-extrabold uppercase">
                {s.name}
              </h2>
            </div>
            <div className="flex flex-col gap-4">
              <span className="text-[17px] leading-[1.6] text-muted">{s.description}</span>
              <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
                {s.items.map((it) => (
                  <li
                    key={it}
                    className="whitespace-nowrap rounded-full border border-line-strong px-3 py-[6px] font-mono text-[12px] text-ink-2"
                  >
                    {it}
                  </li>
                ))}
              </ul>
            </div>
            <div className="flex flex-col items-start gap-[6px]">
              <span className="font-mono text-[11px] tracking-[1px] text-faint">TYPICAL TIMELINE</span>
              <span className="font-display text-[32px] font-bold">{s.time}</span>
              <button
                type="button"
                onClick={() => openContact(s.type)}
                className="mt-2 bg-transparent p-0 text-[15px] font-medium text-gold transition-colors hover:text-gold-hover"
              >
                Ask about this →
              </button>
            </div>
          </div>
        ))}
      </section>

      <section className="flex flex-col gap-12 border-t border-line bg-bg-alt px-page py-24">
        <SectionHeading label="PROCESS" title="From idea to mainnet" />
        <ol className="m-0 grid list-none grid-cols-[repeat(auto-fit,minmax(min(100%,220px),1fr))] gap-8 p-0">
          {processSteps.map((st) => (
            <li key={st.n} className="flex flex-col gap-3 border-t-2 border-gold pt-5">
              <span className="font-mono text-[12px] text-dim">PHASE {st.n}</span>
              <h3 className="m-0 font-display text-[28px] font-bold uppercase">{st.name}</h3>
              <span className="text-[15px] leading-[1.55] text-muted">{st.description}</span>
            </li>
          ))}
        </ol>
      </section>

      <section className="flex flex-col gap-10 border-t border-line px-page py-24">
        <SectionHeading label="PROOF" title="Built by this team" />
        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,240px),1fr))] gap-4">
          {projects.map((p) => (
            <Link
              key={p.slug}
              to={`/projects/${p.slug}`}
              className="flex flex-col overflow-hidden rounded-[10px] border border-line bg-surface text-left text-ink transition-colors hover:border-line-hover hover:text-ink"
            >
              <div
                className="flex h-[140px] w-full items-center justify-center"
                style={{ background: p.bg, padding: p.padSm }}
              >
                <img src={p.logo} alt={p.name} loading="lazy" className="block size-full" style={{ objectFit: p.fit }} />
              </div>
              <div
                className="flex w-full justify-between border-t-2 px-5 py-4 text-[14px]"
                style={{ borderTopColor: p.accent }}
              >
                <span className="font-semibold">{p.name}</span>
                <span className="text-gold">→</span>
              </div>
            </Link>
          ))}
        </div>
      </section>
    </>
  )
}
