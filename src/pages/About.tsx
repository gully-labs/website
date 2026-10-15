import { Link } from 'react-router'
import { Seo } from '../components/Seo'
import { eyebrow } from '../components/ui'
import { comingSoon, projects } from '../content/projects'
import { IN_THE_LAB, PROJECTS_LIVE } from '../content/stats'
import { useStats } from '../hooks/useStats'
import { fmtTime, fmtUsd } from '../lib/stats'

const linkCard =
  'flex flex-col gap-[14px] rounded-card border border-line bg-surface p-9 text-left text-ink transition-colors hover:border-gold hover:text-ink'

const words = ['zero', 'one', 'two', 'three', 'four', 'five', 'six']

export function About() {
  const st = useStats()
  const T = st.k === 'ok' ? st.data.totals : null
  const money = (v: number | null | undefined) => (st.k === 'loading' ? '…' : st.k === 'error' || v === null || v === undefined ? '—' : fmtUsd(v))
  const stats = [
    { label: 'PROJECTS LIVE', value: PROJECTS_LIVE, gold: false },
    { label: 'IN THE LAB', value: IN_THE_LAB, gold: false },
    { label: 'TOTAL VALUE LOCKED', value: money(T?.tvlUsd), gold: true },
    { label: 'VOLUME 24H', value: money(T?.volume24hUsd), gold: false },
  ]
  return (
    <>
      <Seo
        title="About"
        description="Gully Labs is a blockchain development company that designs, builds and releases Web3 projects under its own name."
      />

      <section className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,440px),1fr))] items-center gap-[clamp(40px,5cqw,72px)] px-page pt-20 pb-24">
        <div className="flex flex-col gap-6">
          <span className={eyebrow}>ABOUT</span>
          <h1 className="m-0 font-display text-[clamp(56px,7cqw,104px)] leading-[.9] font-extrabold uppercase">
            A lab that ships <span className="text-gold">its own products</span>
          </h1>
          <p className="m-0 text-[18px] leading-[1.6] text-muted">
            Gully Labs is a blockchain development company. We design, build and release Web3 projects under our own
            name, from trading communities to DeFi infrastructure.
          </p>
          <p className="m-0 text-[18px] leading-[1.6] text-muted">
            Running our own products keeps our engineering honest. Partners get a team that has shipped to mainnet and
            supported what it shipped.
          </p>
        </div>
        <div className="relative aspect-square overflow-hidden rounded-modal bg-mascot-bg">
          <img
            src="/assets/mascot-scientist.png"
            alt="Gully Labs chief scientist"
            className="absolute inset-0 size-full animate-float-slow object-cover"
          />
        </div>
      </section>

      <section aria-label="Gully Labs in numbers" className="flex flex-col gap-3 px-page pb-24">
        <dl className="m-0 grid grid-cols-[repeat(auto-fit,minmax(min(100%,220px),1fr))] gap-px overflow-hidden rounded-card border border-line bg-line">
          {stats.map((s) => (
            <div key={s.label} className="flex flex-col gap-2 bg-surface p-7">
              <dt className="font-mono text-[11px] tracking-[1px] text-faint">{s.label}</dt>
              <dd
                className={`m-0 font-display text-[56px] leading-none font-extrabold ${s.gold ? 'text-gold' : 'text-ink'}`}
              >
                {s.value}
              </dd>
            </div>
          ))}
        </dl>
        <p className="m-0 font-mono text-[12px] leading-[1.5] text-faint">
          {st.k === 'ok'
            ? `Value locked and volume read at ${fmtTime(st.data.generatedAt)} from each project's own API, summed over the venues that publish them.`
            : st.k === 'error'
              ? 'The projects could not be read just now.'
              : 'Reading the projects…'}
        </p>
      </section>

      <section className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,400px),1fr))] gap-5 border-t border-line bg-bg-alt px-page py-24">
        <Link to="/#projects" className={linkCard}>
          <span className="font-mono text-[13px] text-gold">01</span>
          <span className="font-display text-[40px] leading-none font-extrabold uppercase">Our own products</span>
          <span className="text-[16px] leading-[1.55] text-muted">
            {words[projects.length + comingSoon.length][0].toUpperCase() + words[projects.length + comingSoon.length].slice(1)} projects funded and built in-house.{' '}
            {words[projects.length][0].toUpperCase() + words[projects.length].slice(1)} are live.
          </span>
          <span className="mt-2 text-[15px] text-gold">See the projects →</span>
        </Link>
        <Link to="/services" className={linkCard}>
          <span className="font-mono text-[13px] text-gold">02</span>
          <span className="font-display text-[40px] leading-none font-extrabold uppercase">Partner work</span>
          <span className="text-[16px] leading-[1.55] text-muted">
            Smart contracts, dApps, infrastructure and audits for teams building on-chain.
          </span>
          <span className="mt-2 text-[15px] text-gold">See the services →</span>
        </Link>
      </section>
    </>
  )
}
