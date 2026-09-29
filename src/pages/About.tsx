import { Link } from 'react-router'
import { Seo } from '../components/Seo'
import { eyebrow } from '../components/ui'
import { aboutStats } from '../content/stats'

const linkCard =
  'flex flex-col gap-[14px] rounded-card border border-line bg-surface p-9 text-left text-ink transition-colors hover:border-gold hover:text-ink'

export function About() {
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

      <section aria-label="Gully Labs in numbers" className="px-page pb-24">
        <dl className="m-0 grid grid-cols-[repeat(auto-fit,minmax(min(100%,220px),1fr))] gap-px overflow-hidden rounded-card border border-line bg-line">
          {aboutStats.map((s) => (
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
      </section>

      <section className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,400px),1fr))] gap-5 border-t border-line bg-bg-alt px-page py-24">
        <Link to="/#projects" className={linkCard}>
          <span className="font-mono text-[13px] text-gold">01</span>
          <span className="font-display text-[40px] leading-none font-extrabold uppercase">Our own products</span>
          <span className="text-[16px] leading-[1.55] text-muted">Six projects funded and built in-house. Four are live.</span>
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
