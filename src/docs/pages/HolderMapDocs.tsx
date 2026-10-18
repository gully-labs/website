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

const CURL = `curl "https://gullylabs.xyz/api/holders/robinhood/NVDA"
curl "https://gullylabs.xyz/api/holders/robinhood/0x8d901a1b3f3a57f9c36a71382fa183476c41545b" \\
  -H "Authorization: Bearer $GULLY_API_KEY"`

export function HolderMapDocs() {
  return (
    <DocPage
      slug="holder-map"
      eyebrow="PRODUCTS · HOLDER MAP"
      title="Holder Map"
      description="How the Holder Map works: data sources per chain, clusters and hidden links, the launch health score part by part, live mode, alerts, the API and the honesty rules."
      lead="Who really holds a token: the biggest wallets as bubbles, the ones that trade with each other in gold, and a plain check of every DeepCore launch."
      sections={sections}
    >
      <Section id="what" title="What it shows">
        <P>
          The Holder Map covers two kinds of token: DeepCore launches and the stock tokens the tracker follows. Open one at <Ext href="https://gullylabs.xyz/holders">gullylabs.xyz/holders</Ext> by address or ticker, from a stock page, or from a
          launch in the Telegram bot.
        </P>
        <List>
          <li>Every bubble is a wallet, sized by its share of the total supply (or of the listed holders when the supply could not be read; the map says which).</li>
          <li>
            Grey bubbles are not people: trading pools, liquidity and token locks, burn addresses, the token’s own contract, DeepCore and Gully Labs contracts, and exchanges. They are never put in a cluster and never counted in the “top 10 wallets”
            figure.
          </li>
          <li>The summary line says how much the top 10 wallets hold and how much the largest connected cluster holds, across how many wallets. A few plain sentences follow it.</li>
          <li>For stock tokens the map also shows what the top wallets hold at the real share price, and whether they sit on a premium or a discount to it.</li>
        </List>
      </Section>

      <Section id="sources" title="Data sources per chain">
        <P>The map reads each chain from the cheapest source that is complete. A chain without its source says “holder data is not available on this chain yet”; it never shows an empty or made-up map.</P>
        <Fields
          head={['Tokens', 'Holders', 'Links']}
          rows={[
            ['DeepCore launches (BNB Chain, HyperEVM, Robinhood Chain, Base)', 'DeepCore’s own log index: every transfer since the launch, so balances are exact', 'Every transfer between mapped wallets since the launch'],
            ['Stock tokens on Robinhood Chain', 'Blockscout’s API (top holders)', 'The latest transfers, read from the chain'],
            ['Stock tokens on BNB Chain', 'Moralis (top holders)', 'The latest transfers from Moralis'],
            ['Stock tokens on Solana', 'The Solana RPC (the 20 largest token accounts, merged by owner)', 'Not read on Solana yet'],
          ]}
        />
        <P>Labels come from DeepCore’s list of its own contracts, the launch’s lock, the Gully Pay fee proxies, the tracker’s pool and public name tags (exchanges among them) from Blockscout’s metadata service.</P>
      </Section>

      <Section id="clusters" title="Clusters and hidden links">
        <P>
          Two mapped wallets are linked when one sent the token to the other. Linked wallets form a cluster, drawn in kit gold (the largest) or pale gold. A cluster is often one person or team spread across many wallets, but not always: read it as a
          reason to look closer, not as proof.
        </P>
        <P>
          A hidden link joins two mapped wallets through an address that is not on the map (it passed tokens between them). It is drawn as a small hollow node with dashed lines; its tooltip names the address. For DeepCore launches the deployer’s
          funding of other wallets is a link too.
        </P>
      </Section>

      <Section id="health" title="The launch health score">
        <P>
          Every DeepCore launch gets a score from 0 to 100, made of parts you can read one by one: whether the launch liquidity is locked, bundled buying in the first block of trading, snipers in the first blocks, the deployer’s share now, how much
          the top 10 wallets hold, and the deployer’s record of earlier launches. Each part shows its weight, the points it earned, the figure behind it and a plain reason. Tap a part on the map to light up the wallets behind it.
        </P>
        <P>Live: the newest DeepCore launches and their score right now, from <C>GET /api/holders/launches</C>. A launch whose map is still being built says so instead of showing a score.</P>
        <LaunchHealthChart />
        <Callout label="ALWAYS FREE">The score, its parts, the bundled and deployer warnings and the liquidity check are never behind a plan.</Callout>
        <List>
          <li>A part that could not be read is left out of the score and marked “not known”; it is never counted as good or bad. The card says how many parts were counted.</li>
          <li>
            The weights are the server’s: the API returns each part’s <C>weight</C> and <C>points</C>, so what the page shows is what was scored.
          </li>
          <li>The deployer’s record lists their other DeepCore launches with what happened to each (still trading, liquidity pulled, deployer sold, unknown). A deployer with many launches is marked “Serial launcher”.</li>
          <li>Wallets of the largest cluster that also hold other launches are listed under “Same wallets elsewhere”, with links to those maps.</li>
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
