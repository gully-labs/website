/* holdermaps.xyz's 404 (the server answers the path 404 and noindex; server/seo.mjs "Not found · HolderMaps"), in the
   Gully Terminal style: the backpack mascot, what happened, the search with its chain picker, and the live ticker of today's most scanned maps. */
import { Seo } from '../components/Seo'
import { HmNotFoundBody } from './HmStates'
import { HmSearch } from './HmSearch'
import { Tape } from './HmTape'
import { usePoll } from './hooks'
import type { TopScanned } from '../lib/holders'
import '../terminal/terminal.css'
import './hm.css'
import './hm-app.css'

export function HmNotFound() {
  const top = usePoll<TopScanned>('/api/holders/top?limit=20', 60_000)
  return (
    <div className="gt hmt hm-404">
      <Seo title="Not found" description="This page is not on the map. Search any token to see who really holds it, on Gully Chain, Robinhood Chain, BNB Chain, Base, HyperEVM or Solana." noindex />
      <Tape items={top.k === 'ok' ? top.data.items : null} state={top.k} />
      <div className="hm-wrap">
        <div className="hmt-sec">
          <HmNotFoundBody />
        </div>
        <section className="hmt-sec" aria-labelledby="hm-404-q">
          <div className="gt-panel">
            <header>
              <h2 className="gt-k" id="hm-404-q">
                Or map a token from here
              </h2>
            </header>
            <div className="hmt-card">
              <HmSearch compact />
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}
