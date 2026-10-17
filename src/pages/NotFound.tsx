import { Link } from 'react-router'
import { Activity, BookOpen, Home } from 'lucide-react'
import { NewTabMark } from '../components/LayoutLinks'
import { newTab } from '../components/LayoutNav'
import { Seo } from '../components/Seo'
import { MoversRow } from '../components/tracker/MoversRow'
import { StockSearch } from '../components/tracker/StockSearch'
import { btnGold, btnOutline, eyebrow, h1 } from '../components/ui'
import { CHAIN_NAME } from '../lib/tracker'
import { DOCS_URL } from '../site-host'

/* A path no page owns (the server answers it with status 404), or a stock the tracker does not follow.
   It says so plainly and offers the ways on: the tracker, the docs, home, a stock search and the live
   movers. */
export function NotFound({ ticker, chain }: { ticker?: string; chain?: string }) {
  const stock = !!ticker
  const chainName = chain ? (CHAIN_NAME[chain] ?? chain) : null
  return (
    <>
      <Seo title={stock ? `${ticker} not found` : 'Page not found'} description="This page does not exist on gullylabs.xyz." noindex />
      <section className="flex min-h-[100svh] flex-col gap-10 px-page pt-[72px] pb-24 max-[600px]:pt-10">
        <div className="flex flex-col gap-5">
          <span className={eyebrow}>{stock ? 'STOCK NOT FOUND' : '404 · PAGE NOT FOUND'}</span>
          <h1 className={h1}>
            {stock ? (
              <>
                We don’t track <span className="text-gold">{ticker}</span>
              </>
            ) : (
              <>
                No page <span className="text-gold">here</span>
              </>
            )}
          </h1>
          <p className="m-0 max-w-[620px] text-[17px] leading-[1.6] text-muted">
            {stock
              ? `There is no stock token ${ticker}${chainName ? ` on ${chainName}` : ''} in the live tracker. Search for it below, or open the tracker to see every token we follow.`
              : 'The link may be old or mistyped. Here are the ways on.'}
          </p>
          <div className="flex flex-wrap gap-3">
            <Link to="/tracker" className={`${btnGold} inline-flex min-h-11 items-center gap-2 px-5 text-[15px]`}>
              <Activity aria-hidden size={16} /> Open the tracker
            </Link>
            <a href={DOCS_URL} {...newTab} className={`${btnOutline} inline-flex min-h-11 items-center gap-2 px-5 text-[15px]`}>
              <BookOpen aria-hidden size={16} /> Docs
              <NewTabMark size={14} />
            </a>
            <Link to="/" className={`${btnOutline} inline-flex min-h-11 items-center gap-2 px-5 text-[15px]`}>
              <Home aria-hidden size={16} /> Home
            </Link>
          </div>
        </div>
        <StockSearch initial={ticker ?? ''} />
        <div className="flex flex-col gap-3">
          <span className="font-mono text-[11px] tracking-[1px] text-faint">MOVING NOW · LIVE GAP CHANGE, 24H</span>
          <MoversRow />
        </div>
      </section>
    </>
  )
}
