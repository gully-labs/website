import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { Activity, Database, Tag } from 'lucide-react'
import { AskPanel } from '../../components/ask/AskPanel'
import { askStatus, type AskStatus } from '../../components/ask/askApi'
import { AnimatedNumber } from '../../components/charts/AnimatedNumber'
import { NF } from '../../components/charts/number-formats'
import { Seo } from '../../components/Seo'
import { LiveTopGaps } from '../../components/tracker/LiveTopGaps'
import { eyebrow, h1 } from '../../components/ui'

/* /ask on the main site: Gully AI on its own page, with what it can read beside it: the size of its
   index (GET /api/ask/status) and the tracker's widest gaps right now, live, which it can also quote.
   Lazy route; the landing never loads it. */

function useStatus() {
  const [s, setS] = useState<AskStatus | null | 'loading'>('loading')
  useEffect(() => {
    let alive = true
    askStatus().then((v) => alive && setS(v))
    return () => {
      alive = false
    }
  }, [])
  return s
}

export function AskPage() {
  const status = useStatus()
  const st = status === 'loading' ? null : status
  return (
    <>
      <Seo title="Gully AI" description="Ask Gully AI about Gully Labs, the stock token tracker, its API, plans and products. Answers come from the docs and the site, with sources." />
      <section className="px-page pt-[72px] pb-24 max-[600px]:pt-10">
        <div className="mx-auto grid w-full max-w-[1200px] grid-cols-[minmax(0,1fr)_400px] items-start gap-10 max-[1099px]:max-w-[760px] max-[1099px]:grid-cols-1">
          <div className="flex min-w-0 flex-col gap-8">
            <header className="flex flex-col gap-4">
              <span className={eyebrow}>GULLY AI</span>
              <h1 className={h1}>
                Ask about <span className="text-gold">Gully Labs</span>
              </h1>
              <p className="m-0 max-w-[620px] text-[17px] leading-[1.6] text-muted">The tracker, its API and widget, plans and alerts, Gully Analytics, Chain Kit and our projects. Answers come from our docs and site, with the sources linked, and live figures where they matter.</p>
            </header>
            <AskPanel variant="page" />
          </div>
          <aside aria-label="What Gully AI reads" className="flex min-w-0 flex-col gap-4 min-[1100px]:sticky min-[1100px]:top-24">
            <div className="flex flex-col gap-3 rounded-card border border-line bg-surface p-5">
              <span className="inline-flex items-center gap-2 font-mono text-[11px] tracking-[1px] text-faint">
                <Database aria-hidden size={14} className="text-gold" /> ITS INDEX
              </span>
              <span className="flex flex-col gap-1">
                {status === 'loading' ? (
                  <span aria-hidden className="h-[34px] w-[90px] gl-skeleton rounded-input bg-surface-deep" />
                ) : st?.indexSize ? (
                  <AnimatedNumber className="font-display text-[34px] leading-none font-bold" value={st.indexSize} format={NF.int} countUp />
                ) : (
                  <span className="font-display text-[22px] leading-none font-bold text-dim">not tracked yet</span>
                )}
                <span className="text-[12px] text-muted">passages from the docs, the site and the changelog</span>
              </span>
              <span className="font-mono text-[11px] text-faint">
                {st?.updatedAt
                  ? `Index built ${new Date(st.updatedAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'UTC' })} UTC`
                  : status === 'loading'
                    ? 'Reading the index…'
                    : 'Index time not published'}
              </span>
            </div>
            <div className="flex flex-col gap-3 rounded-card border border-line bg-surface p-5">
              <span className="inline-flex items-center gap-2 font-mono text-[11px] tracking-[1px] text-faint">
                <Activity aria-hidden size={14} className="text-gold" /> WIDEST GAPS NOW · LIVE
              </span>
              <LiveTopGaps count={8} />
              <span className="text-[12px] leading-[1.5] text-muted">Gully AI reads these live when you ask about a stock. Press a bar to open its page.</span>
              <div className="flex flex-wrap gap-x-4">
                <Link to="/tracker" className="inline-flex min-h-11 items-center gap-1 text-[13px] text-gold hover:text-gold-hover">
                  <Activity aria-hidden size={14} /> Stock tracker
                </Link>
                <Link to="/pricing" className="inline-flex min-h-11 items-center gap-1 text-[13px] text-gold hover:text-gold-hover">
                  <Tag aria-hidden size={14} /> Plans and alerts
                </Link>
              </div>
            </div>
          </aside>
        </div>
      </section>
    </>
  )
}
