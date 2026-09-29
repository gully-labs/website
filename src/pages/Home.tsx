import { Link } from 'react-router'
import { HeroMascot } from '../components/HeroMascot'
import { MetricsPanel } from '../components/MetricsPanel'
import { ComingSoonTile, ProjectTile } from '../components/ProjectTile'
import { Seo } from '../components/Seo'
import { btnGold, btnOutline, SectionHeading } from '../components/ui'
import { comingSoon, projects, TOTAL_SLOTS } from '../content/projects'
import { services } from '../content/services'

export function Home() {
  return (
    <>
      <Seo
        title="Web3 projects and blockchain development"
        description="We build and release Web3 products under our own roof. Here's what's out of the lab so far."
      />

      <section className="flex flex-wrap items-center gap-[clamp(32px,4cqw,64px)] px-page py-20">
        <HeroMascot />
        <div className="flex min-w-0 flex-[1_1_480px] flex-col gap-7">
          <h1 className="m-0 font-display text-[clamp(56px,7.8cqw,112px)] leading-[.9] font-extrabold uppercase">
            The projects
            <br />
            behind <span className="text-gold">Gully Labs</span>
          </h1>
          <p className="m-0 max-w-[620px] text-[19px] leading-[1.55] text-muted">
            We build and release Web3 products under our own roof. Here's what's out of the lab so far.
          </p>
          <div className="flex flex-wrap gap-3">
            <Link to="/#projects" className={`${btnGold} px-[26px] py-4 text-[16px]`}>
              Explore the projects
            </Link>
            <Link to="/services" className={`${btnOutline} px-[26px] py-4 text-[16px]`}>
              Our services
            </Link>
          </div>
        </div>
      </section>

      <MetricsPanel />

      <section id="projects" className="flex flex-col gap-12 border-t border-line px-page py-24">
        <div className="flex flex-wrap items-end justify-between gap-6">
          <SectionHeading label={`PROJECTS / ${TOTAL_SLOTS}`} title="Out of the lab" />
          <p className="m-0 max-w-[420px] text-[17px] leading-[1.55] text-muted">
            Four released, two in development. Select a project for details.
          </p>
        </div>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,460px),1fr))] gap-5">
          {projects.map((p, i) => (
            <ProjectTile key={p.slug} project={p} index={i} />
          ))}
          {comingSoon.map((num) => (
            <ComingSoonTile key={num} num={num} />
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-12 border-t border-line bg-bg-alt px-page py-24">
        <div className="flex flex-wrap items-end justify-between gap-6">
          <SectionHeading label="SERVICES" title="The same team, on your project" />
          <Link to="/services" className="text-[16px] font-medium text-gold transition-colors hover:text-gold-hover">
            All services →
          </Link>
        </div>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,260px),1fr))] gap-px overflow-hidden rounded-card border border-line bg-line">
          {services.map((s) => (
            <Link
              key={s.n}
              to="/services"
              className="flex flex-col gap-3 bg-bg-alt p-7 text-ink transition-colors hover:bg-surface-hover hover:text-ink"
            >
              <span className="font-mono text-[13px] text-gold">{s.n}</span>
              <h3 className="m-0 font-display text-[28px] leading-[1.05] font-bold uppercase">{s.name}</h3>
              <span className="flex-1 text-[15px] leading-[1.55] text-muted">{s.description}</span>
              <span className="text-[14px] text-gold">Learn more →</span>
            </Link>
          ))}
        </div>
      </section>
    </>
  )
}
