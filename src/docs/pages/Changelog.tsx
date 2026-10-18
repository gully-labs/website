import { DocLink, DocPage, Ext, List, Section } from '../DocPage'

const sections = [
  { id: '2026-10-18', title: '18 October 2026' },
  { id: '2026-10-17', title: '17 October 2026' },
  { id: '2026-10-16', title: '16 October 2026' },
]

export function Changelog() {
  return (
    <DocPage
      slug="changelog"
      eyebrow="MORE · CHANGELOG"
      title="Changelog"
      description="What changed in the Gully Labs tracker, its API, the widget and these docs."
      lead="What changed, newest first."
      sections={sections}
    >
      <Section id="2026-10-18" title="18 October 2026">
        <List>
          <li>
            <DocLink to="gully-pay">Gully Pay</DocLink> on three more chains: OP Mainnet (USDC, USDT, ETH), Polygon (USDC, POL) and Avalanche (USDC, USDT, AVAX). Every token and Chainlink feed was read on chain first, and Request Network's fee proxy on each chain was compared byte for byte with the Base and Ethereum deployments.
          </li>
          <li>
            The treasury is a Safe, so each chain is now <DocLink to="gully-pay" hash="chains">offered only where the Safe is deployed</DocLink>; the server checks hourly and the admin panel says what to do. Merchant stores get the in-payment fee on the same condition; elsewhere the fee is invoiced as before.
          </li>
        </List>
      </Section>

      <Section id="2026-10-17" title="17 October 2026">
        <List>
          <li>
            A page for every stock token, such as <Ext href="https://gullylabs.xyz/tracker/robinhood/NVDA">NVDA on Robinhood Chain</Ext>: live price against fair, gap history, the pool, contracts, alerts and an embed snippet.
          </li>
          <li>
            <DocLink to="plans-alerts">Plans and gap alerts</DocLink>: higher limits, signed webhook alerts and up to a year of history, paid in USDC, USDT or the chain's own coin on Base, Ethereum, BNB Chain or Arbitrum (OP Mainnet, Polygon and Avalanche followed on 18 October), straight to the Gully Labs treasury.
          </li>
          <li>
            <Ext href="https://gullylabs.xyz/analytics">Gully Analytics</Ext>: web analytics that also see wallet connects, chains and transactions.
          </li>
          <li>
            <Ext href="https://gullylabs.xyz/chain-kit">Chain Kit</Ext>: a branded Blockscout explorer for your chain, operated by Gully Labs.
          </li>
          <li>The widget links each stock to its page.</li>
          <li>
            The <Ext href="https://gullylabs.xyz/">landing page</Ext> describes DeepCore as it is today (launchpad, hosted Launchpads and DEXes, router) and shows its hosted sites, launches in the last 24 hours and dollars in locks, read from <Ext href="https://api.deepcore.fun/v1/overview">api.deepcore.fun</Ext>.
          </li>
          <li>A preview of Gully Chains, managed Arbitrum Orbit L3s, starting with Gully Devnet. In development; nothing is live yet.</li>
          <li>The tracker reads DeepCore pools through DeepCore's own pool manager, never as Uniswap v4 pools.</li>
        </List>
      </Section>
      <Section id="2026-10-16" title="16 October 2026">
        <List>
          <li>
            <Ext href="https://gullylabs.xyz/tracker">The tracker</Ext> launched: tokenised stocks on Robinhood Chain and BNB Chain against their Chainlink fair price, with a gap history per token.
          </li>
          <li>
            The public <DocLink to="api">API</DocLink>: <code className="font-mono text-[.9em] text-ink">/api/tracker</code> and <code className="font-mono text-[.9em] text-ink">/api/tracker/history</code>.
          </li>
          <li>
            The embeddable <DocLink to="widget">widget</DocLink> (ticker, badge, table) and its <Ext href="https://gullylabs.xyz/widget">builder</Ext>.
          </li>
          <li>
            <DocLink to="api-keys">API keys</DocLink> for higher rate limits.
          </li>
          <li>These docs.</li>
          <li>
            Onchain prices are now read straight from each token’s deepest pool every refresh; DexScreener and GeckoTerminal only find the pool and report its depth.
          </li>
          <li>
            Every row carries <code className="font-mono text-[.9em] text-ink">logo</code> and <code className="font-mono text-[.9em] text-ink">chainLogo</code>, and every
            chain reports its <code className="font-mono text-[.9em] text-ink">poolSource</code>.
          </li>
          <li>Widget v2: real logos, coloured gaps, value flashes on change, a 24-hour gap chart on the badge, and a sortable, clickable table.</li>
          <li>
            The <Ext href="https://app.gullylabs.xyz">developer portal</Ext>: sign in with a wallet and create keys instantly, with usage charts and a request log.
          </li>
          <li>
            The <DocLink to="sdk">SDK</DocLink>: <code className="font-mono text-[.9em] text-ink">@gullylabs/tracker</code> and{' '}
            <code className="font-mono text-[.9em] text-ink">@gullylabs/widget</code>.
          </li>
        </List>
      </Section>
    </DocPage>
  )
}
