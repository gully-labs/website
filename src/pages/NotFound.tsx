import { BookOpen, Home, LayoutGrid } from 'lucide-react'
import { Seo } from '../components/Seo'
import { MoversRow } from '../components/tracker/MoversRow'
import { StockSearch } from '../components/tracker/StockSearch'
import { productFigures } from '../console/figures'
import { useLive } from '../console/live'
import { Btn, ProductGrid, SectionHead } from '../console/ui'
import { CHAIN_NAME } from '../lib/tracker'
import { DOCS_URL } from '../site-host'
import { NetworkCard } from './Home'

/* A path no page owns (the server answers it with status 404), or a stock the tracker does not follow. In the
   lab-console language: the plain message and the ways on beside the live network card, then the six products
   (or, for a stock, a search and the live movers). */
export function NotFound({ ticker, chain }: { ticker?: string; chain?: string }) {
  const stock = !!ticker
  const chainName = chain ? (CHAIN_NAME[chain] ?? chain) : null
  const figs = productFigures(useLive())
  return (
    <div className="lcp notfound">
      <Seo title={stock ? `${ticker} not found` : 'Page not found'} description="This page does not exist on gullylabs.xyz." noindex />
      <section className="hero">
        <div className="wrap">
          <div className="copy rise">
            <span className="lab cy">{stock ? 'Stock not found' : '404 · page not found'}</span>
            <h1>
              {stock ? (
                <>
                  We don’t track <span className="grad">{ticker}</span>
                </>
              ) : (
                <>
                  No page <span className="grad">here.</span>
                </>
              )}
            </h1>
            <p className="promise">
              {stock
                ? `There is no stock token ${ticker}${chainName ? ` on ${chainName}` : ''} in the live tracker. Search for it below, or open the tracker to see every token we follow.`
                : 'The link may be old or mistyped. The network is still live: here are the ways on.'}
            </p>
            <div className="ctas">
              <Btn icon={Home} href="/" arrow>
                Home
              </Btn>
              <Btn kind="sec" icon={LayoutGrid} href="/products">
                Products
              </Btn>
              <Btn kind="ter" icon={BookOpen} href={DOCS_URL}>
                Docs
              </Btn>
            </div>
          </div>
          <NetworkCard />
        </div>
      </section>
      <section>
        <div className="wrap">
          {stock ? (
            <div className="flex flex-col gap-6">
              <StockSearch initial={ticker ?? ''} />
              <div className="flex flex-col gap-3">
                <span className="lab">Moving now · live gap change, 24h</span>
                <MoversRow />
              </div>
            </div>
          ) : (
            <>
              <SectionHead label="Products" title="Seven products, one lab">
                Each card opens the product on its own domain.
              </SectionHead>
              <ProductGrid figs={figs} />
            </>
          )}
        </div>
      </section>
    </div>
  )
}
