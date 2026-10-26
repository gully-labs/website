/* holdermaps.xyz's 404 (the server answers the path 404 and noindex; server/seo.mjs "Not found · HolderMaps"). */
import { Seo } from '../components/Seo'
import { HmNotFoundBody } from './HmStates'
import { HmSearch } from './HmSearch'
import './hm.css'
import './hm-app.css'

export function HmNotFound() {
  return (
    <div className="hm-page hm-404">
      <Seo title="Not found" description="This page is not on the map. Search any token to see who really holds it, on Gully Chain, Robinhood Chain, BNB Chain, Base, HyperEVM or Solana." noindex />
      <HmNotFoundBody />
      <div className="hm-404-search">
        <h2 className="h3">Or map a token from here</h2>
        <HmSearch compact />
      </div>
    </div>
  )
}
