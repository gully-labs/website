import { lazy, Suspense, useEffect, useState } from 'react'
import { Link } from 'react-router'
import { AppWindow, Send, Sparkles } from 'lucide-react'
import { askStatus } from '../components/ask/askApi'
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

const words = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten']
/** The products in the console below (ProductConsole CONSOLE_TABS): the eyebrow counts what you can see. */
const PRODUCTS = 9

/** Where "Ask Gully AI" goes: the live panel in the console below when Gully AI is on, else its page. */
function useAskHref() {
  const [href, setHref] = useState('/ask')
  useEffect(() => {
    let alive = true
    askStatus().then((s) => alive && s?.configured && setHref('/#ask'))
    return () => {
      alive = false
    }
  }, [])
  return href
}

export function Home() {
  const st = useStats()
  const data = st.k === 'ok' ? st.data : null
  const [plans] = usePlans()
  const { openContact } = useContact()
  const askHref = useAskHref()
  const venues = words[projects.length] ?? String(projects.length)

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
            <span className="max-[419px]:hidden">
              {venues.toUpperCase()} VENUES · {words[PRODUCTS].toUpperCase()} PRODUCTS · ONE LEDGER
            </span>
            <span className="min-[420px]:hidden">
              {projects.length} VENUES · {PRODUCTS} PRODUCTS
            </span>
          </span>
          <h1 className="m-0 font-display text-h1 font-extrabold uppercase">
            Built here.
            <br />
            <span className="text-gold">Measured</span> live.
          </h1>
          <p className="m-0 max-w-[480px] text-[16px] leading-[1.5] text-muted">
            Gully Labs ships on-chain venues and the tools around them: a stock token tracker with swaps and alerts, analytics that see the wallet, branded block explorers, a free API, and crypto billing. Try each one below.
          </p>
          <div className="flex flex-wrap gap-[10px] max-[479px]:flex-col">
            <Link to="/tracker" className={`${btnGold} inline-flex min-h-11 items-center justify-center gap-2 px-5`}>
              <AppWindow aria-hidden size={16} /> Launch app
            </Link>
            <button type="button" onClick={() => openContact()} className={`${btnOutline} inline-flex min-h-11 items-center justify-center gap-2 px-[18px]`}>
              <Send aria-hidden size={16} /> Start a project
            </button>
            <Link to={askHref} className="group inline-flex min-h-11 items-center justify-center gap-2 rounded-btn border border-gold-line px-[18px] text-[15px] font-medium text-gold transition-colors hover:border-gold hover:bg-[rgba(232,192,96,.06)] hover:text-gold">
              <Sparkles aria-hidden size={16} className="transition-transform duration-200 group-hover:rotate-12" /> Ask Gully AI
            </Link>
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
