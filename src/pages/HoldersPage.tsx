import { Link, useParams } from 'react-router'
import { Seo } from '../components/Seo'
import { DeepCheckCard } from '../components/holders/DeepCheck'
import { BadgeBlock } from '../components/holders/BadgeBlock'
import { HolderMap } from '../components/holders/HolderMap'
import { useHolderMap } from '../lib/holders'
import { holderHref } from '../site-host'

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
  const description = m?.state === 'ok' ? `${m.summary.line} ${m.forensics?.riskLine ?? ''}`.trim() : comingSoon ? `Token maps for ${chainName} are coming soon. DeepCore launches already have live Holder Maps on Gully Labs.` : `Who holds ${symbol ?? 'this token'} on ${chainName}: the biggest wallets, the ones that trade with each other, and what that means, read live.`

  return (
    <div className="flex flex-col gap-3 px-[clamp(8px,2cqw,32px)] pt-3 pb-24">
      <Seo title={title} description={description} />
      {/* The map comes first: a one-line breadcrumb, then the map (its title is the page's h1; the
          explainer sits behind its (i) button). */}
      <nav aria-label="Breadcrumb" className="flex flex-wrap gap-x-4 font-mono text-[12px]">
        <Link to={holderHref('/holders')} className="inline-flex min-h-11 items-center text-muted transition-colors hover:text-ink">
          ← HOLDER MAP
        </Link>
        {m?.state === 'ok' && (m.kind === 'token' || m.kind === 'launch') ? (
          <a href={m.token.url} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center text-muted transition-colors hover:text-ink">
            {symbol ? `${symbol} ON THE EXPLORER ↗` : 'EXPLORER ↗'}
          </a>
        ) : isStock && symbol ? (
          <Link to={`/tracker/${chain}/${symbol}`} className="inline-flex min-h-11 items-center text-muted transition-colors hover:text-ink">
            {`${symbol} ON THE TRACKER`}
          </Link>
        ) : (
          // While the map loads, or when it cannot be read, name the chain (it used to say DEEPCORE for any token, D4-1).
          <span data-testid="hm-crumb-chain" className="inline-flex min-h-11 items-center text-muted">
            {chainName.toUpperCase()}
          </span>
        )}
      </nav>
      <HolderMap chain={chain} token={token} page tradeHref={isStock && symbol ? `/tracker/${chain}/${symbol}#swap` : undefined} />
      {m?.state === 'ok' && m.chain && m.token && <DeepCheckCard key={`${m.chain.key}:${m.token.address}`} chain={m.chain.key} token={m.token.address} symbol={symbol} />}
      {m?.state === 'ok' && m.chain && m.token && <BadgeBlock chain={m.chain.key} token={m.token.address} />}
      {/* Five guide cards: one row of five on wide screens, so none sits alone on a row (D4-2). */}
      <section aria-labelledby="hm-how" data-testid="hm-guide" className="grid grid-cols-1 gap-3 min-[640px]:grid-cols-2 min-[1024px]:grid-cols-3 min-[1280px]:grid-cols-5">
        <h2 id="hm-how" className="sr-only">
          How to read the Holder Map
        </h2>
        {[
          ['Bubbles', 'One wallet each. The bigger the bubble, the bigger its share. Grey bubbles are pools, locks, burn addresses, exchanges and other contracts, not people.'],
          ['Gold clusters', 'Wallets that sent the token to each other are joined into a cluster. A big cluster can be one holder spread across many wallets.'],
          ['Top holders only', 'A token with a very long history, or on a chain where we cannot read all of it, shows its biggest holders only. The map says so, and why, under its title.'],
          ['Launch check', 'For DeepCore launches and tokens of launchpads we know: wallets that bought together in the first block of trading are marked bundled, and the deployer and the wallets it funded are named. These warnings are always free.'],
          ['Replay', 'Drag the slider or press play to watch holdings concentrate or spread since launch, rebuilt from the token’s own transfers.'],
        ].map(([t, d]) => (
          <div key={t} className="card card-pad flex flex-col gap-2">
            <h3 className="heading-4">{t}</h3>
            <p className="m-0 text-[13px] leading-[1.55] text-muted">{d}</p>
          </div>
        ))}
      </section>
    </div>
  )
}
