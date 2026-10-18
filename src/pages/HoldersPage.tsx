import { Link, useParams } from 'react-router'
import { Seo } from '../components/Seo'
import { HolderMap } from '../components/holders/HolderMap'
import { eyebrow } from '../components/ui'
import { useHolderMap } from '../lib/holders'

/* /holders/:chain/:token: one token's Holder Map, full width, with a short guide to reading it. The map
   itself (and every figure on it) comes from GET /api/holders (server/holders.mjs). */

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
  const description = m?.state === 'ok' ? `${m.summary.line} ${m.forensics?.riskLine ?? ''}`.trim() : `Who holds ${symbol ?? 'this token'} on ${chainName}: the biggest wallets, the ones that trade with each other, and what that means, read live.`

  return (
    <div className="flex flex-col gap-6 px-[clamp(12px,2.5cqw,40px)] pt-6 pb-24">
      <Seo title={title} description={description} />
      <nav aria-label="Breadcrumb" className="flex flex-wrap gap-x-4 font-mono text-[13px]">
        <Link to="/holders" className="py-2 text-muted transition-colors hover:text-ink">
          ← HOLDER MAP
        </Link>
        <Link to={isStock && symbol ? `/tracker/${chain}/${symbol}` : '/projects/deepcore'} className="py-2 text-muted transition-colors hover:text-ink">
          {isStock && symbol ? `${symbol} ON THE TRACKER` : 'DEEPCORE'}
        </Link>
      </nav>
      <div className="flex flex-col gap-3">
        <span className={eyebrow}>HOLDER MAP · GULLY LABS</span>
        <h1 className="m-0 font-display text-[clamp(34px,4cqw,56px)] leading-[.92] font-extrabold uppercase">Who holds {symbol ?? 'this token'}?</h1>
        <p className="m-0 max-w-[720px] text-[17px] leading-[1.6] text-muted">
          Every bubble is a wallet, sized by how much of the token it holds. Gold bubbles are wallets that sent the token to each other, which often means one person or team behind many wallets. Read live; nothing on this page is typed in.
        </p>
      </div>
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
          <div key={t} className="flex flex-col gap-2 rounded-card border border-line bg-surface p-5">
            <h3 className="m-0 font-display text-[22px] font-bold uppercase">{t}</h3>
            <p className="m-0 text-[14px] leading-[1.6] text-muted">{d}</p>
          </div>
        ))}
      </section>
    </div>
  )
}
