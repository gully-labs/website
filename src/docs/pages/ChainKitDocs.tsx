import { Callout, DocLink, DocPage, Ext, Fields, List, P, Section } from '../DocPage'
import { EmptyPulse, StatusChip, StatusHistory } from '../ProductCharts'

const sections = [
  { id: 'what', title: 'What Chain Kit is' },
  { id: 'included', title: 'What is planned' },
  { id: 'request', title: 'Joining the waitlist' },
  { id: 'status', title: 'Status' },
  { id: 'licence', title: 'Built on Blockscout' },
]

export function ChainKitDocs() {
  return (
    <DocPage
      slug="chain-kit"
      eyebrow="PRODUCTS · CHAIN KIT"
      title="Chain Kit"
      description="Chain Kit: a branded Blockscout block explorer for your EVM chain, deployed and operated by Gully Labs. Chain Kit is on a waitlist: join it from the app. What is planned and its status."
      lead="A new chain needs a block explorer on day one. Chain Kit is Blockscout, set up for your chain, in your brand, and run for you by Gully Labs. Chain Kit: join the waitlist. We're finalising the explorer licence before taking orders."
      sections={sections}
    >
      <Section id="what" title="What Chain Kit is">
        <P>
          Chain Kit is a managed deployment of <Ext href="https://github.com/blockscout/blockscout">Blockscout</Ext> for one EVM chain. We size the server and the RPC for your chain, deploy the indexer and the explorer on a domain you choose,
          apply your branding through configuration rather than a fork, and keep it indexed, upgraded and backed up.
        </P>
        <P>
          Chain Kit is on a waitlist: we are finalising the explorer licence before taking orders. The product page is <Ext href="https://gullylabs.xyz/chain-kit">gullylabs.xyz/chain-kit</Ext>.
        </P>
      </Section>

      <Section id="included" title="What is planned">
        <Fields
          head={['Part', 'Scope', 'Notes']}
          rows={[
            ['Full explorer', 'Blockscout', 'Blocks, transactions, addresses, tokens, NFTs, contract verification, APIs and charts'],
            ['Your brand', 'configuration', 'Your name, logos, colours and links across the explorer, so upgrades stay simple'],
            ['Rollups', 'profiles', 'Arbitrum Nitro and Orbit chains like Robinhood Chain, and chains with a stablecoin as gas'],
            ['Operations', 'run for you', 'Provisioning, TLS, backups, upgrades and monitoring, with a runbook for common failures'],
            ['Sizing', 'before any promise', 'A busy rollup needs terabytes; a young chain far less. We size it to your chain first'],
          ]}
        />
      </Section>

      <Section id="request" title="Joining the waitlist">
        <List>
          <li>
            Sign in to the app at <Ext href="https://app.gullylabs.xyz/#chain-kit">app.gullylabs.xyz</Ext> and open <strong className="text-ink">Chain Kit</strong> under Services.
          </li>
          <li>Give an email to reach you and your chain: its name, chain id and an RPC. Then press “Join the waitlist”.</li>
          <li>The card shows “on the waitlist” with the date for your workspace. We write when orders open, and ask about history, settlement layer and sizing then. Nothing is charged.</li>
        </List>
        <P>
          You can also join from <Ext href="https://gullylabs.xyz/chains#waitlist">gullylabs.xyz/chains</Ext> without signing in.
        </P>
      </Section>

      <Section id="status" title="Status">
        <P>
          Chain Kit explorers run on their own servers, so they are not part of this API yet and publish no figures here: the chart below says so rather than drawing made-up numbers. What is live is the Gully Labs API the request goes through,
          checked every minute by our <DocLink to="status">status checks</DocLink>.
        </P>
        <StatusChip id="api" label="PUBLIC API NOW" />
        <StatusHistory ids={['api']} title="PUBLIC API, LAST 24 H" />
        <EmptyPulse text="No Chain Kit explorer reports to this API yet: nothing to chart, nothing shown as zero." />
      </Section>

      <Section id="licence" title="Built on Blockscout">
        <P>
          Chain Kit is built on <Ext href="https://github.com/blockscout/blockscout">Blockscout</Ext>. Your chain, your data and your domain stay yours: you are never locked in.
        </P>
        <Callout label="NO INVENTED FIGURES">The product page’s “charts on day one” are illustrations badged as example data. This page charts only what our API actually reports.</Callout>
      </Section>
    </DocPage>
  )
}
