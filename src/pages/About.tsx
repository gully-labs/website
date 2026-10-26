import { Link } from 'react-router'
import { FlaskConical, Handshake } from 'lucide-react'
import { Seo } from '../components/Seo'
import { VenueBars, VenueTimeline } from '../components/charts/VenueCharts'
import { eyebrow, h2 } from '../components/ui'
import { VenueChip } from '../components/ProjectRows'
import { comingSoon, projects } from '../content/projects'
import { IN_THE_LAB, PROJECTS_LIVE } from '../content/stats'
import { useCountUp } from '../hooks/useCountUp'
import { useStats } from '../hooks/useStats'
import { fmtTime, fmtUsd, nameOf } from '../lib/stats'

const linkCard =
  'group relative flex flex-col gap-[14px] overflow-hidden rounded-card border border-line bg-surface p-7 text-left text-ink transition-colors hover:border-gold hover:text-ink'

const words = ['zero', 'one', 'two', 'three', 'four', 'five', 'six']
const cap = (s: string) => s[0].toUpperCase() + s.slice(1)
const rise = (i: number) => ({ animation: `gl-rise .55s ${i * 0.07}s ease both` })

function Money({ value, state }: { value: number | null | undefined; state: 'loading' | 'error' | 'ok' }) {
  const n = useCountUp(value ?? 0)
  if (state === 'loading') return <span className="text-dim">…</span>
  if (state === 'error' || value === null || value === undefined) return <span className="text-dim">—</span>
  return (
    <span role="img" aria-label={fmtUsd(value)} style={{ animation: 'gl-count-flash 1.6s ease both' }}>
      <span aria-hidden>{fmtUsd(n)}</span>
    </span>
  )
}

function Covers({ keys }: { keys: string[] }) {
  if (!keys.length) return <>from no venue</>
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      from
      {keys.map((k) => (
        <VenueChip key={k} venue={k} name={nameOf(k)} />
      ))}
    </span>
  )
}

export function About() {
  const st = useStats()
  const T = st.k === 'ok' ? st.data.totals : null
  return (
    <>
      <Seo
        title="About"
        description="Gully Labs is a blockchain development company that designs, builds and releases Web3 projects under its own name."
      />

      <section className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,440px),1fr))] items-center gap-[clamp(40px,5cqw,72px)] px-page pt-[72px] pb-24">
        <div className="flex flex-col gap-6">
          <span className={eyebrow} style={rise(0)}>
            ABOUT · GULLY LABS
          </span>
          <h1 className="m-0 font-display text-h1 font-extrabold uppercase" style={rise(1)}>
            A lab that ships <span className="text-gold">its own products</span>
          </h1>
          <p className="m-0 text-[18px] leading-[1.6] text-muted" style={rise(2)}>
            Gully Labs is a blockchain development company. We design, build and release Web3 projects under our own name, from trading
            communities to DeFi infrastructure.
          </p>
          <p className="m-0 text-[18px] leading-[1.6] text-muted" style={rise(3)}>
            Running our own products keeps our engineering honest. Partners get a team that has shipped to mainnet and supported what it
            shipped.
          </p>
        </div>
        <div className="relative aspect-square overflow-hidden rounded-modal bg-mascot-bg" style={rise(2)}>
          <img src="/brand/mascots/mascot-3-coding-feathered.png" width={564} height={896} alt="The Gully Labs mascot at work" className="absolute inset-0 size-full animate-float-slow object-contain" />
        </div>
      </section>

      <section aria-label="Gully Labs in numbers" className="flex flex-col gap-3 px-page pb-24">
        <dl className="m-0 grid grid-cols-[repeat(auto-fit,minmax(min(100%,220px),1fr))] gap-px overflow-hidden rounded-card border border-line bg-line">
          {[
            { label: 'PROJECTS LIVE', value: <>{PROJECTS_LIVE}</>, gold: false, note: <span className="flex flex-wrap gap-1.5">{projects.map((p) => <VenueChip key={p.key} venue={p.key} name={p.name} />)}</span> },
            { label: 'IN THE LAB', value: <>{IN_THE_LAB}</>, gold: false, note: `slot ${comingSoon.join(', ')}` },
            { label: 'TOTAL VALUE LOCKED', value: <Money value={T?.tvlUsd} state={st.k} />, gold: true, note: T ? <Covers keys={T.covers.tvlUsd} /> : '' },
            { label: 'VOLUME ALL-TIME', value: <Money value={T?.volumeAllUsd} state={st.k} />, gold: false, note: T ? <Covers keys={T.covers.volumeAllUsd} /> : '' },
          ].map((s, i) => (
            <div key={s.label} className="group relative flex flex-col gap-2 overflow-hidden bg-surface p-7" style={rise(i)}>
              <dt className="font-mono text-[11px] tracking-[1px] text-faint">{s.label}</dt>
              <dd className={`m-0 font-display text-[56px] leading-none font-extrabold ${s.gold ? 'text-gold' : 'text-ink'}`}>{s.value}</dd>
              {s.note && <span className="min-w-0 text-[13px] break-words text-muted">{s.note}</span>}
              <span aria-hidden className="absolute inset-x-0 bottom-0 h-[2px] origin-left scale-x-0 bg-gold transition-transform duration-300 group-hover:scale-x-100" />
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

      <section aria-labelledby="venues-title" className="flex flex-col gap-8 px-page pb-24">
        <div className="flex flex-col gap-3">
          <span className={eyebrow}>THE VENUES · LIVE</span>
          <h2 id="venues-title" className={h2}>
            What we shipped, <span className="text-gold">measured</span>
          </h2>
        </div>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,460px),1fr))] gap-5">
          <div className="flex min-w-0 flex-col gap-4 rounded-card border border-line bg-surface p-5">
            <h3 className="m-0 font-display text-h4 font-bold uppercase">Measured since</h3>
            <span className="-mt-2 font-mono text-[11px] text-faint">from the start of each venue's all-time count to today</span>
            <VenueTimeline st={st} />
          </div>
          <div className="flex min-w-0 flex-col gap-4 rounded-card border border-line bg-surface p-5">
            <h3 className="m-0 font-display text-h4 font-bold uppercase">Side by side</h3>
            <span className="-mt-2 font-mono text-[11px] text-faint">each venue's own figure, read live</span>
            <VenueBars st={st} />
          </div>
        </div>
      </section>

      <section className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,400px),1fr))] gap-5 border-t border-line bg-bg-alt px-page py-24">
        <Link to="/#projects" className={linkCard} style={rise(0)}>
          <span className="flex items-center justify-between">
            <span className="flex size-12 items-center justify-center rounded-btn border border-gold-line text-gold transition-colors group-hover:bg-gold group-hover:text-bg">
              <FlaskConical aria-hidden size={22} strokeWidth={1.6} />
            </span>
            <span className="font-mono text-[13px] text-gold">01</span>
          </span>
          <span className="font-display text-[40px] leading-none font-extrabold uppercase">Our own products</span>
          <span className="text-[16px] leading-[1.55] text-muted">
            {cap(words[projects.length + comingSoon.length])} projects funded and built in-house. {cap(words[projects.length])} are live.
          </span>
          <span className="mt-2 inline-flex min-h-11 items-center text-[15px] text-gold">See the projects →</span>
          <span aria-hidden className="absolute inset-x-0 bottom-0 h-[2px] origin-left scale-x-0 bg-gold transition-transform duration-300 group-hover:scale-x-100" />
        </Link>
        <Link to="/services" className={linkCard} style={rise(1)}>
          <span className="flex items-center justify-between">
            <span className="flex size-12 items-center justify-center rounded-btn border border-gold-line text-gold transition-colors group-hover:bg-gold group-hover:text-bg">
              <Handshake aria-hidden size={22} strokeWidth={1.6} />
            </span>
            <span className="font-mono text-[13px] text-gold">02</span>
          </span>
          <span className="font-display text-[40px] leading-none font-extrabold uppercase">Partner work</span>
          <span className="text-[16px] leading-[1.55] text-muted">Smart contracts, dApps, infrastructure and security testing for teams building onchain.</span>
          <span className="mt-2 inline-flex min-h-11 items-center text-[15px] text-gold">See the services →</span>
          <span aria-hidden className="absolute inset-x-0 bottom-0 h-[2px] origin-left scale-x-0 bg-gold transition-transform duration-300 group-hover:scale-x-100" />
        </Link>
      </section>
    </>
  )
}
