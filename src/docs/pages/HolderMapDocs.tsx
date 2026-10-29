import { CodeBlock } from '../CodeBlock'
import { C, Callout, DocLink, DocPage, Ext, Fields, List, P, Section } from '../DocPage'
import { LaunchHealthChart } from '../LiveCharts'

const sections = [
  { id: 'what', title: 'What it shows' },
  { id: 'sources', title: 'Data sources per chain' },
  { id: 'clusters', title: 'Clusters and hidden links' },
  { id: 'health', title: 'The launch health score' },
  { id: 'live', title: 'Live mode and replay' },
  { id: 'alerts', title: 'Cluster alerts' },
  { id: 'api', title: 'API and embed' },
  { id: 'honesty', title: 'Honesty rules' },
]

const CURL = `curl "https://api.gullylabs.xyz/api/holders/robinhood/NVDA"
curl "https://api.gullylabs.xyz/api/holders/robinhood/0x8d901a1b3f3a57f9c36a71382fa183476c41545b" \\
  -H "Authorization: Bearer $GULLY_API_KEY"`

export function HolderMapDocs() {
  return (
    <DocPage
      slug="holder-map"
      eyebrow="PRODUCTS · HOLDER MAP"
      title="Holder Map"
      description="How the Holder Map works: data sources per chain, clusters and hidden links, the launch health score part by part, live mode, alerts, the API and the honesty rules."
      lead="Who really holds a token: the biggest wallets as bubbles, the ones that trade with each other in gold, and a plain check of every launch we recognise. Any token on Robinhood Chain, BNB Chain, Base, HyperEVM, Gully Chain Testnet and Solana can be mapped."
      sections={sections}
    >
      <Section id="what" title="What it shows">
        <P>
          The Holder Map covers any ERC-20 token on Robinhood Chain, BNB Chain, Base, HyperEVM and Gully Chain Testnet and any SPL token on Solana, plus Gully Launchpad launches, other supported launchpads’ tokens and the stock tokens the tracker follows. Paste an address at <Ext href="https://gullylabs.xyz/holders">gullylabs.xyz/holders</Ext>: it is first checked to be a token
          (an ERC-20 that answers decimals and total supply, or a Solana mint), and with no chain given every supported chain is checked at once (a token on several chains gives a picker). Launch checks and the health score are for Gully Launchpad launches on Gully Chain and the other launchpads we know; a plain token gets holders, clusters and concentration.
        </P>
        <List>
          <li>Every bubble is a wallet, sized by its share of the total supply (or of the listed holders when the supply could not be read; the map says which).</li>
          <li>
            Grey bubbles are not people: trading pools, liquidity and token locks, burn addresses, the token’s own contract, Gully Labs contracts, and exchanges. They are never put in a cluster and never counted in the “top 10 wallets”
            figure.
          </li>
          <li>The summary line says how much the top 10 wallets hold and how much the largest connected cluster holds, across how many wallets. A few plain sentences follow it.</li>
          <li>For stock tokens the map also shows what the top wallets hold at the real share price, and whether they sit on a premium or a discount to it.</li>
        </List>
      </Section>

      <Section id="sources" title="Data sources per chain">
        <P>
          The map reads each token from the cheapest source that is complete, in this order: our own index of the chain’s Transfer logs on an archive node (every transfer, so balances are exact), then Blockscout, then Moralis (the biggest holders). A token with a very long history
          (over 40,000 transfers for tokens nobody listed, or too many chain reads) is not rebuilt in full: it gets a “top holders only” map, labelled as such with the reason, or, when no holder source is available on that chain, a plain “unavailable”. A chain without any source says “holder
          data is not available on this chain yet”. It never shows an empty or made-up map. Which chains map any token today, and how (full history or top holders), is shown on the Holder Map page and in <C>GET /api/holders/sources</C>.
        </P>
        <P>To keep the service fair, new maps of tokens nobody listed are limited per visitor (5 a minute) and across all visitors (30 a minute), address checks too (8 a minute per visitor); maps already built are free for everyone.</P>
        <Fields
          head={['Tokens', 'Holders', 'Links']}
          rows={[
            ['Any ERC-20 and stock tokens (Robinhood Chain, BNB Chain, Base, HyperEVM)', 'Our own Transfer-log index on an archive node (exact balances); past its caps or without one: Blockscout, then Moralis (top holders, labelled)', 'Every transfer since the token was deployed; for top-holders maps, the latest transfers'],
            ['Any ERC-20 on Gully Chain Testnet (Gully Launchpad launches included)', 'Our own Transfer-log index on the chain’s archive node (exact balances); past its caps, our Gully Chain indexer (top holders). The launchpad curve, LP locker, routers and Gully Swap pools are labelled; wallets with a .gully name are shown by it', 'Every transfer since the token was deployed'],
            ['Any SPL token and stock tokens on Solana', 'Every token account of the mint where the RPC allows it, else the 20 largest token accounts, merged by owner (labelled)', 'Not read on Solana yet'],
          ]}
        />
        <P>Labels come from Gully Chain’s own launchpads, lockers and routers, a launchpad’s pools, Uniswap v4 pool managers, the Gully Pay fee proxies, the tracker’s pool and public name tags (exchanges among them) from Blockscout’s metadata service.</P>
      </Section>

      <Section id="clusters" title="Clusters and hidden links">
        <P>
          Two mapped wallets are linked when one sent the token to the other. Linked wallets form a cluster, drawn in kit gold (the largest) or pale gold. A cluster is often one person or team spread across many wallets, but not always: read it as a
          reason to look closer, not as proof.
        </P>
        <P>
          A hidden link joins two mapped wallets through an address that is not on the map (it passed tokens between them). It is drawn as a small hollow node with dashed lines; its tooltip names the address. For launches the deployer’s
          funding of other wallets is a link too.
        </P>
      </Section>

      <Section id="health" title="The launch health score">
        <P>
          Every launch we recognise (Gully Launchpad launches on Gully Chain and the other supported launchpads), mapped from its full transfer history, gets a score from 0 to 100 made of four parts you can read one by one: bundled buying in
          the first block of trading (30 points), the share held by the deployer and the wallets it funded (30), how much the top 10 wallets hold (25) and snipers in the first blocks (15). Every part is read from the launch’s own transfers. Each
          part shows its weight, the points it earned, the figure behind it and a plain reason. Tap a part on the map to light up the wallets behind it.
        </P>
        <P>Live: the newest Gully Chain launches and their score right now, from <C>GET /api/holders/launches</C>. A launch whose map is still being built says so instead of showing a score.</P>
        <LaunchHealthChart />
        <Callout label="ALWAYS FREE">The score, its parts and the bundled and deployer warnings are never behind a plan.</Callout>
        <List>
          <li>A part that could not be read is left out of the score and marked “not known”; it is never counted as good or bad. The card says how many parts were counted.</li>
          <li>
            The weights are the server’s: the API returns each part’s <C>weight</C> and <C>points</C>, so what the page shows is what was scored.
          </li>
        </List>
      </Section>

      <Section id="live" title="Live mode and replay">
        <P>
          On a launch’s map page, live mode reads new transfers every 15 seconds: each one flows as a particle from sender to receiver (addresses that are not on the map come in from the edge), bubbles resize to the new shares, and a LIVE pill shows
          when the map last updated. Under reduced motion the particles are still lines that fade.
        </P>
        <P>The replay slider rebuilds holdings at earlier moments from the token’s own transfers: press play (1× or 4×) to watch holdings concentrate or spread since the launch.</P>
      </Section>

      <Section id="alerts" title="Cluster alerts">
        <P>
          “Alert me” on a map opens the Alerts tab of the app with the token filled in. Pick what to watch (the largest cluster, the top 10, or the deployer’s share) and a threshold; deliveries go to Telegram and webhooks like every other alert, and
          count towards your plan’s alerts. See <DocLink to="plans-alerts">Plans &amp; alerts</DocLink>.
        </P>
      </Section>

      <Section id="api" title="API and embed">
        <P>
          <C>GET /api/holders/:chain/:token</C> answers the whole map as JSON; <C>.csv</C> gives the holder list and <C>/card.png</C> a share card. Requests count against the same keys and limits as the tracker. Field by field:{' '}
          <DocLink to="api" hash="holders">
            API reference
          </DocLink>
          .
        </P>
        <CodeBlock lang="bash" code={CURL} />
        <P>
          To put a map on your own page, use the widget script with <C>data-gully-widget="holders"</C>: see the{' '}
          <DocLink to="widget" hash="holder-map">
            widget guide
          </DocLink>
          .
        </P>
      </Section>

      <Section id="honesty" title="Honesty rules">
        <List>
          <li>Nothing is estimated or typed in: every figure is read from the sources above, with the time it was read.</li>
          <li>A value that could not be read is shown as such, never as zero.</li>
          <li>Labels name only what a source says an address is.</li>
          <li>The map is information, not advice. Clusters and scores are signals to look closer, not verdicts on a person.</li>
        </List>
      </Section>
    </DocPage>
  )
}
