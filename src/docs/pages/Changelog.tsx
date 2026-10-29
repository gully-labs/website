import { StatusBoard } from '../../components/status/StatusBoard'
import { AssetText, C, ChainName, DocLink, DocPage, Ext, List, P, Section } from '../DocPage'

const sections = [
  { id: '2026-10-29', title: '29 October 2026' },
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
      description="What changed in Gully Labs products: the tracker and its API, the widget, Holder Map, Gully Security, Gully Score, Gully Pay, the bot and these docs."
      lead="What changed, newest first."
      sections={sections}
    >
      <P>What is running now, live from the status checks (every part below, checked every minute):</P>
      <StatusBoard compact />
      <Section id="2026-10-29" title="29 October 2026">
        <List>
          <li>
            Gully Core is Gully Chain’s own launchpad and DEX core, built and run by Gully Labs (<Ext href="https://docs.gullychain.xyz/gully-core/">docs.gullychain.xyz/gully-core</Ext>). The features that read another launchpad’s platform are retired: new-launch alerts, the launches screens in the bot and the Mini App, the swap card’s router comparison, Gully AI’s launch and pool tools, and that venue’s figures. Their old API routes answer <C>410 Gone</C>; existing new-launch alerts stay listed and can be deleted.
          </li>
          <li>The Holder Map maps those launchpad tokens like any other token; launch checks cover Gully Launchpad launches and the launchpads in the registry.</li>
        </List>
      </Section>
      <Section id="2026-10-18" title="18 October 2026">
        <List>
          <li>
            Chain Kit, the branded explorer for your chain, moved with Gully Chain: it is open to everyone at <Ext href="https://gullychain.xyz">gullychain.xyz</Ext>, documented on <Ext href="https://docs.gullychain.xyz/">docs.gullychain.xyz</Ext>.
          </li>
          <li>
            <DocLink to="gully-security">Gully Security</DocLink> is live: the <Ext href="https://gullylabs.xyz/security">AI Security Scan</Ext> of a deployed contract, a GitHub repository at a commit, an upload or a web2 codebase, run from the app, with free scans each month by plan. For now it is an AI review only: our static-tools worker is not running yet, so no Slither, Aderyn or fuzzing runs, and every report is labelled “AI review only”. Reports can be published at a stable link (<Ext href="https://gullylabs.xyz/security/reports">published reports</Ext>). A human Security Review is quoted on request. A full audit is not offered.
          </li>
          <li>
            The <DocLink to="gully-score">Gully Score</DocLink> is live at <Ext href="https://gullylabs.xyz/score">gullylabs.xyz/score</Ext>: a 0 to 100 score for any contract from public evidence, every weight and source shown, with an embeddable badge. Contract monitors are live in the app: privileged changes and large outflows on the contracts you watch, by Telegram or signed webhook.
          </li>
          <li>
            The <DocLink to="holder-map">Holder Map</DocLink> is live at <Ext href="https://gullylabs.xyz/holders">gullylabs.xyz/holders</Ext>: who holds a token, the wallets that trade with each other, bundled launch buys, the deployer’s record and a health score, with holder alerts. Maps for tokenised stocks open chain by chain; until a chain’s holder data is connected its pages say “coming soon”.
          </li>
          <li>
            A general <DocLink to="roadmap">Roadmap</DocLink> page listing each track with its status: the Gully L3 (planned) and <DocLink to="roadmap" hash="security">Gully Security</DocLink> (scan, score and monitors live; reviews on request; audits not offered).
          </li>
          <li>
            Telegram announcements from @GullyLabsBot, with a 🔕 Stop announcements button on every one; alerts are never affected. See the <Ext href="https://gullylabs.xyz/legal/privacy">privacy policy</Ext> for what an announcement records.
          </li>
          <li>
            <DocLink to="gully-pay">Gully Pay</DocLink> on three more chains: <ChainName name="OP Mainnet" /> (<AssetText text="USDC, USDT, ETH" />), <ChainName name="Polygon" /> (<AssetText text="USDC, POL" />) and <ChainName name="Avalanche" /> (<AssetText text="USDC, USDT, AVAX" />). Every token and Chainlink feed was read on chain first. Request Network's fee proxy was compared byte for byte with Base's: OP Mainnet's matches and will carry the merchant fee inside the payment once the treasury Safe is deployed there; Polygon's and Avalanche's are other builds, so the fee is invoiced there. Each chain opens for Gully Labs' own checkout once the treasury Safe is deployed on it.
          </li>
          <li>
            The treasury is a Safe, so each chain is now <DocLink to="gully-pay" hash="chains">offered only where the Safe is deployed</DocLink>; the server checks hourly and the admin panel says what to do. Merchant stores get the in-payment fee on the same condition; elsewhere the fee is invoiced as before. A store's own Safe that is not deployed on a chain yet is read again every hour and switches on by itself once it is.
          </li>
          <li>
            A public <Ext href="https://gullylabs.xyz/status">status page</Ext> and <C>GET /api/status</C>: the API, tracker freshness on each chain, the Telegram bot webhook, Gully Pay RPCs per chain, Gully AI, the security scan engine, contract monitors and Holder Map sources, checked every minute by the server, with 24 h uptime and the incident history. See <DocLink to="status">Status</DocLink>.
          </li>
          <li>
            New docs pages: <DocLink to="gully-ai">Gully AI</DocLink>, the <DocLink to="telegram">Telegram bot and Mini App</DocLink>, <DocLink to="chain-kit">Chain Kit</DocLink>, <DocLink to="swaps">Swaps</DocLink> (LI.FI on EVM chains, Jupiter on Solana), <DocLink to="solana">Solana</DocLink> and <DocLink to="status">Status</DocLink>. The <DocLink to="api">API reference</DocLink> now covers every public endpoint group, including <C>/api/pay/gas</C>, <C>/api/tracker/gap-index</C>, <C>/api/holders</C>, <C>/api/score</C> and <C>/api/status</C>; unknown <C>/api/</C> paths answer a JSON 404. The docs have a search box and a live chart on every page.
          </li>
        </List>
      </Section>

      <Section id="2026-10-17" title="17 October 2026">
        <List>
          <li>
            A page for every stock token, such as <Ext href="https://gullylabs.xyz/tracker/robinhood/NVDA">NVDA on Robinhood Chain</Ext>: live price against fair, gap history, the pool, contracts, alerts and an embed snippet.
          </li>
          <li>
            <DocLink to="plans-alerts">Plans and gap alerts</DocLink>: higher limits, signed webhook alerts and up to a year of history, paid in USDC, USDT or the chain's own coin on <ChainName name="Base, Ethereum, BNB Chain, Arbitrum" /> (<ChainName name="OP Mainnet, Polygon, Avalanche" /> followed on 18 October), straight to the Gully Labs treasury.
          </li>
          <li>
            <Ext href="https://gullylabs.xyz/analytics">Gully Analytics</Ext>: web analytics that also see wallet connects, chains and transactions.
          </li>
          <li>
            <Ext href="https://gullylabs.xyz/chain-kit">Chain Kit</Ext>: a branded Blockscout explorer for your chain, operated by Gully Labs.
          </li>
          <li>The widget links each stock to its page.</li>
          <li>A preview of Gully Chains, managed Arbitrum Orbit L3s, starting with Gully Devnet. In development; nothing is live yet.</li>
          <li>
            <DocLink to="roadmap-l3">Roadmap: Gully L3</DocLink>: the consolidated spec (settlement, data availability, gas token, Chain Kit, Gully Pay, Hyperlane as the interop layer at launch), with its status: spec written, devnet prepared, nothing running.
          </li>
          <li>The tracker reads launchpad CL pools through their own pool manager, never as Uniswap v4 pools.</li>
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
            The <Ext href="https://app.gullylabs.xyz">app dashboard</Ext>: sign in with a wallet and create keys instantly, with usage charts and a request log.
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
