import { Link } from 'react-router'
import { ArrowRight } from 'lucide-react'
import { ToolsShowcase } from '../components/ToolsShowcase'
import { LedgerBand, StackedVolume, TvlShare } from '../components/Ledger'
import { ProjectRows } from '../components/ProjectRows'
import { Seo } from '../components/Seo'
import { ShareBar, ShareStrip } from '../components/Share'
import { btnGold, btnOutline, eyebrow, SectionHeading } from '../components/ui'
import { VenueTicker } from '../components/VenueTicker'
import { comingSoon, projects, TOTAL_SLOTS } from '../content/projects'
import { services } from '../content/services'
import { useStats } from '../hooks/useStats'

const words = ['zero', 'one', 'two', 'three', 'four', 'five', 'six']
const cap = (s: string) => s[0].toUpperCase() + s.slice(1)

/* The ledger landing: the venues' own figures, added up, then the venues as rows. */
export function Home() {
  const st = useStats()
  const data = st.k === 'ok' ? st.data : null
  return (
    <>
      <Seo
        title="Web3 projects and blockchain development"
        description="Every project Gully Labs ships reports its own volume, value locked and fees. This page reads each one live and adds them up."
      />

      <section className="grid grid-cols-[1.1fr_.9fr] items-center gap-[clamp(32px,4cqw,72px)] px-page pt-[72px] pb-10 max-[959px]:grid-cols-1">
        <div className="flex flex-col gap-[26px]">
          <Link
            to="/analytics"
            className="group inline-flex w-fit items-center gap-3 rounded-full border border-line-strong bg-surface py-[5px] pr-4 pl-[5px] text-[14px] text-ink-2 transition-colors hover:border-gold hover:text-ink"
            style={{ animation: 'gl-rise .6s ease both' }}
          >
            <span className="rounded-full bg-gold px-[10px] py-[3px] font-mono text-[11px] font-medium tracking-[1px] text-bg">NEW</span>
            Gully Analytics: web analytics that see the wallet, 14 days free
            <ArrowRight aria-hidden size={15} className="text-gold transition-transform group-hover:translate-x-[3px]" />
          </Link>
          <span className={`${eyebrow} animate-[gl-rise_.6s_ease_both]`}>GULLY LABS · {words[projects.length].toUpperCase()} VENUES · ONE LEDGER</span>
          <h1 className="m-0 font-display text-[clamp(60px,8.4cqw,124px)] leading-[.88] font-extrabold uppercase" style={{ animation: 'gl-rise .6s .05s ease both' }}>
            Built here.
            <br />
            <span className="text-gold">Measured</span>
            <br />
            live.
          </h1>
          <p className="m-0 max-w-[560px] text-[19px] leading-[1.55] text-muted" style={{ animation: 'gl-rise .6s .12s ease both' }}>
            Every project Gully Labs ships reports its own volume, value locked and fees. This page reads each one and adds them up, with the source
            under every number.
          </p>
          <div className="flex flex-wrap gap-3" style={{ animation: 'gl-rise .6s .2s ease both' }}>
            <Link to="/#projects" className={`${btnGold} px-[26px] py-4 text-[16px]`}>
              See the projects
            </Link>
            <Link to="/services" className={`${btnOutline} px-[26px] py-4 text-[16px]`}>
              Work with us
            </Link>
          </div>
          <div style={{ animation: 'gl-rise .6s .28s ease both' }}>
            <ShareBar data={data} />
          </div>
        </div>
        <div style={{ animation: 'gl-rise .6s .25s ease both' }}>
          <VenueTicker data={data} state={st.k} />
        </div>
      </section>

      <section id="ledger" aria-label="Totals across all projects" className="flex flex-col gap-5 px-page pt-10 pb-24">
        <LedgerBand data={data} state={st.k} />
        <div className="grid grid-cols-[2fr_1fr] gap-5 max-[959px]:grid-cols-1">
          <StackedVolume data={data} state={st.k} />
          <TvlShare data={data} state={st.k} />
        </div>
      </section>

      <section id="projects" className="flex flex-col gap-10 border-t border-line px-page py-24">
        <div className="flex flex-wrap items-end justify-between gap-6">
          <SectionHeading label={`PROJECTS / ${TOTAL_SLOTS}`} title="Out of the lab" />
          <p className="m-0 max-w-[420px] text-[17px] leading-[1.55] text-muted">
            {cap(words[projects.length])} live, {words[comingSoon.length]} in development. Sort by any column; every row reads its project's own API and
            can be shared in one tap.
          </p>
        </div>
        <ProjectRows data={data} state={st.k} />
      </section>

      <ToolsShowcase />

      <ShareStrip data={data} />

      <section className="flex flex-col gap-10 border-t border-line bg-bg-alt px-page py-24">
        <div className="flex flex-wrap items-end justify-between gap-6">
          <SectionHeading label="SERVICES" title="The same team, on your project" />
          <Link to="/services" className="text-[16px] font-medium text-gold transition-colors hover:text-gold-hover">
            All services →
          </Link>
        </div>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,240px),1fr))] gap-5">
          {services.map((s) => (
            <Link key={s.n} to="/services" className="flex flex-col gap-3 border-t border-line-strong pt-5 text-ink transition-colors hover:border-gold hover:text-ink">
              <span className="flex items-center justify-between">
                <span className="font-mono text-[13px] text-gold">{s.n}</span>
                <s.icon aria-hidden size={22} strokeWidth={1.5} className="text-faint" />
              </span>
              <h3 className="m-0 font-display text-[28px] leading-[1.05] font-bold uppercase">{s.name}</h3>
              <span className="text-[15px] leading-[1.55] text-muted">{s.description}</span>
            </Link>
          ))}
        </div>
      </section>
    </>
  )
}
