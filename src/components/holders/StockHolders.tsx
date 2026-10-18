import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { getJson, type HolderSources } from '../../lib/holders'
import { HolderMap } from './HolderMap'

/* The stock page's "Who holds …?" section, decided the same way as the /holders landing's chips: by
   GET /api/holders/sources (server: holdersAvailable(chain, 'stock')). Where stock maps are live it shows
   the map; where they are not, one "coming soon" line that matches the landing, never a map-shaped section
   that then says it cannot be read. For StockPage (owned elsewhere) to drop in place of its section. */

export function StockHolders({ chain, ticker, chainName, tradeHref = '#swap' }: { chain: string; ticker: string; chainName: string; tradeHref?: string }) {
  const [live, setLive] = useState<boolean | null>(null)
  useEffect(() => {
    let alive = true
    getJson<HolderSources>('/api/holders/sources').then((s) => alive && setLive(s ? !!s.chains.find((c) => c.chain === chain)?.stocks : null))
    return () => {
      alive = false
    }
  }, [chain])
  return (
    <section className="px-page pb-8" aria-labelledby="who-holds" id="holders" data-stock-holders={live === false ? 'soon' : 'live'}>
      <h2 id="who-holds" className="heading-4 mb-4">
        Who holds {ticker}?
      </h2>
      {live === false ? (
        <p className="card card-pad m-0 text-[14px] leading-[1.6] text-muted">
          Holder Maps for stocks on {chainName} are coming soon. DeepCore launches already have live maps:{' '}
          <Link to="/holders" className="text-gold underline-offset-4 hover:underline">
            see them on the Holder Map
          </Link>
          .
        </p>
      ) : (
        <HolderMap chain={chain} token={ticker} tradeHref={tradeHref} />
      )}
    </section>
  )
}
