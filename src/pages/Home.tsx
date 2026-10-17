import { lazy, Suspense } from 'react'
import { Link } from 'react-router'
import { ArrowUpRight } from 'lucide-react'
import { useContact } from '../components/ContactContext'
import { HeroLedger } from '../components/landing/HeroLedger'
import { Seo } from '../components/Seo'
import { btnGold, btnOutline } from '../components/ui'
import { projects } from '../content/projects'
import { useStats } from '../hooks/useStats'
import { usePlans } from '../lib/plans'

/* The landing, about four screens: the hero with the live ledger of every venue, then (one lazy chunk,
   with the animation library) a product console with a live demo per product, the venues as cards,
   pricing on one switch, services and the open-source strip. */

const Below = lazy(() => import('../components/landing/Below'))

const words = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven']

export function Home() {
  const st = useStats()
  const data = st.k === 'ok' ? st.data : null
  const [plans] = usePlans()
  const { openContact } = useContact()

  return (
    <>
      <Seo
        title="Web3 projects and blockchain development"
        description="Gully Labs ships on-chain venues and the tools around them: a stock token tracker with swaps and alerts, wallet-aware analytics, branded block explorers, a free API and crypto billing. Every venue's figures are read live."
      />

      <section id="top" className="flex flex-wrap items-center gap-8 px-page pt-12 pb-10 max-[599px]:pt-8">
        <div className="flex min-w-0 flex-[1_1_380px] flex-col gap-[18px]" style={{ animation: 'gl-rise .6s cubic-bezier(.2,.8,.2,1) both' }}>
          <span className="flex items-center gap-2 font-mono text-[12px] tracking-[1.5px] text-gold">
            <span aria-hidden className="size-[7px] flex-none rounded-full bg-green" style={{ animation: 'gl-pulse-ring 1.8s infinite' }} />
            {(words[projects.length] ?? String(projects.length)).toUpperCase()} VENUES · TEN PRODUCTS · ONE LEDGER
          </span>
          <h1 className="m-0 font-display text-[clamp(54px,7cqw,96px)] leading-[.88] font-extrabold uppercase">
            Built here.
            <br />
            <span className="text-gold">Measured</span> live.
          </h1>
          <p className="m-0 max-w-[480px] text-[16px] leading-[1.5] text-muted">
            Gully Labs ships on-chain venues and the tools around them: a stock token tracker with swaps and alerts, analytics that see the wallet, branded block explorers, a free API, and crypto billing. Try each one below.
          </p>
          <div className="flex flex-wrap gap-[10px]">
            <Link to="/tracker" className={`${btnGold} inline-flex min-h-11 items-center gap-2 px-5`}>
              Launch the tracker <ArrowUpRight aria-hidden size={16} />
            </Link>
            <button type="button" onClick={() => openContact()} className={`${btnOutline} inline-flex min-h-11 items-center px-[18px]`}>
              Start a project
            </button>
          </div>
        </div>
        <div id="ledger" className="min-w-0 flex-[1.3_1_520px] scroll-mt-[72px]" style={{ animation: 'gl-rise .6s .08s cubic-bezier(.2,.8,.2,1) both' }}>
          <HeroLedger data={data} state={st.k} />
        </div>
      </section>

      {/* The skeleton holds roughly the sections' height, so the footer does not jump up and back. */}
      <Suspense fallback={<div aria-hidden className="min-h-[2400px] border-t border-line" />}>
        <Below data={data} state={st.k} plans={plans} />
      </Suspense>
    </>
  )
}
