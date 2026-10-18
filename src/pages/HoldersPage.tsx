import { Link, useParams } from 'react-router'
import { Seo } from '../components/Seo'
import { HolderMap } from '../components/holders/HolderMap'
import { useHolderMap } from '../lib/holders'

/* /holders/:chain/:token: one token's Holder Map, full width and first on the screen, with a short guide to
   reading it below. The map itself (and every figure on it) comes from GET /api/holders (server/holders.mjs). */

const CHAIN_NAMES: Record<string, string> = {
  robinhood: 'Robinhood Chain',
  bsc: 'BNB Chain',
  base: 'Base',
  hyperevm: 'HyperEVM',
  solana: 'Solana',
}

export function HoldersPage() {
  const { chain = '', token = '' } = useParams()
  const load = useHolderMap(chain, token)
  const m = load.k === 'ok' ? load.data : null
  const symbol = m && 'token' in m ? (m.token?.symbol ?? null) : null
  const chainName = CHAIN_NAMES[chain] ?? chain
  const isStock = m?.kind === 'stock'
  const title = `Holder Map: ${symbol ?? 'token'} on ${chainName}`
  const comingSoon = m?.state === 'unavailable' && !!m.comingSoon
  const description = m?.state === 'ok' ? `${m.summary.line} ${m.forensics?.riskLine ?? ''}`.trim() : comingSoon ? `Holder data for ${chainName} is coming soon. DeepCore launches already have live Holder Maps on Gully Labs.` : `Who holds ${symbol ?? 'this token'} on ${chainName}: the biggest wallets, the ones that trade with each other, and what that means, read live.`

  return (
    <div className="flex flex-col gap-3 px-[clamp(8px,2cqw,32px)] pt-3 pb-24">
      <Seo title={title} description={description} />
      {/* The map comes first: a one-line breadcrumb, then the map (its title is the page's h1; the
          explainer sits behind its (i) button). */}
      <nav aria-label="Breadcrumb" className="flex flex-wrap gap-x-4 font-mono text-[12px]">
        <Link to="/holders" className="inline-flex min-h-11 items-center text-muted transition-colors hover:text-ink">
          ← HOLDER MAP
        </Link>
        <Link to={isStock && symbol ? `/tracker/${chain}/${symbol}` : '/projects/deepcore'} className="inline-flex min-h-11 items-center text-muted transition-colors hover:text-ink">
          {isStock && symbol ? `${symbol} ON THE TRACKER` : 'DEEPCORE'}
        </Link>
      </nav>
      <HolderMap chain={chain} token={token} page tradeHref={isStock && symbol ? `/tracker/${chain}/${symbol}#swap` : undefined} />
      <section aria-labelledby="hm-how" className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,280px),1fr))] gap-4">
        <h2 id="hm-how" className="sr-only">
          How to read the Holder Map
        </h2>
        {[
          ['Bubbles', 'One wallet each. The bigger the bubble, the bigger its share. Grey bubbles are pools, locks, burn addresses, exchanges and other contracts, not people.'],
          ['Gold clusters', 'Wallets that sent the token to each other are joined into a cluster. A big cluster can be one holder spread across many wallets.'],
          ['Launch check', 'For DeepCore launches: wallets that bought together in the first block of trading are marked bundled, and the deployer and the wallets it funded are named. These warnings are always free.'],
          ['Replay', 'Drag the slider or press play to watch holdings concentrate or spread since launch, rebuilt from the token’s own transfers.'],
        ].map(([t, d]) => (
          <div key={t} className="card card-pad flex flex-col gap-2">
            <h3 className="heading-4">{t}</h3>
            <p className="m-0 text-[14px] leading-[1.6] text-muted">{d}</p>
          </div>
        ))}
      </section>
    </div>
  )
}
