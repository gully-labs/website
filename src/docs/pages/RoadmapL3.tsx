import { ParentChainBaseFee } from '../ParentChainBaseFee'
import { C, Callout, DocLink, DocPage, Ext, Fields, H3, List, P, Section } from '../DocPage'

const sections = [
  { id: 'status', title: 'Status' },
  { id: 'what', title: 'What the Gully L3 is' },
  { id: 'settlement', title: 'Settlement chain' },
  { id: 'da', title: 'Data availability' },
  { id: 'gas', title: 'Gas token' },
  { id: 'interop', title: 'Interop: Hyperlane' },
  { id: 'pay', title: 'Gully Pay on the L3' },
  { id: 'aggregators', title: 'Swaps and bridges today' },
  { id: 'devnet', title: 'The devnet, and what you can do now' },
  { id: 'decisions', title: 'Open decisions' },
  { id: 'sources', title: 'Sources' },
]

export function RoadmapL3() {
  return (
    <DocPage
      slug="roadmap-l3"
      eyebrow="MORE · ROADMAP"
      title="Roadmap: Gully L3"
      description="The plan for the Gully L3: an Arbitrum chain settling to Arbitrum One with Chain Kit, Gully Pay and Hyperlane as its interop layer. Status: spec written, devnet prepared, nothing running."
      lead="An Arbitrum (Orbit) chain run by Gully Labs, with Chain Kit as its explorer, Gully Pay native on it, and Hyperlane as its interop layer once it launches. This page summarises the spec for developers and says exactly what exists today."
      sections={sections}
    >
      <Section id="status" title="Status">
        <Callout label="HONEST STATUS · 17 OCTOBER 2026">
          <strong className="text-ink">Spec written. Devnet prepared. Nothing is running.</strong> There is no public RPC, no explorer, no faucet, no bridge and no Hyperlane
          deployment yet. The light devnet (one Arbitrum Nitro node in dev mode, chain id 412346) and the Hyperlane validator and relayer are prepared as compose files that
          refuse to start without free disk and RAM. The <DocLink to="changelog">changelog</DocLink> will say when any of this goes live; until then, the waitlist in the{' '}
          <Ext href="https://app.gullylabs.xyz">app dashboard</Ext> is the only thing you can join.
        </Callout>
        <Fields
          head={['Stage', 'Chain', 'State']}
          rows={[
            ['S0 · light devnet', 'Nitro --dev, chain id 412346, in-memory parent', 'Prepared, not started. Local testing of Chain Kit, Stylus, Gully Pay and the Hyperlane agents.'],
            ['S1 · Gully Devnet', 'A public Arbitrum chain on Arbitrum Sepolia', 'Planned. Public RPC, Chain Kit explorer, faucet, canonical bridge, Hyperlane to Arbitrum Sepolia.'],
            ['S2 · Gully L3', 'Production, settling to Arbitrum One (recommended)', 'Planned. Gully venues, Gully Pay, Warp Routes for USDC and ETH, aggregator listings.'],
          ]}
        />
        <P>
          The Gully L3 is one track of the <DocLink to="roadmap">Roadmap</DocLink>, next to Gully Security.
        </P>
      </Section>

      <Section id="what" title="What the Gully L3 is">
        <P>
          An Arbitrum chain (the stack formerly branded Orbit): Nitro, deployed with the Arbitrum chain SDK through the parent chain’s <C>RollupCreator</C> and <C>TokenBridgeCreator</C>,
          with the Gully stack attached on day one.
        </P>
        <List>
          <li>
            <strong className="text-ink">Explorer</strong>: Chain Kit, our Blockscout fork, with its Arbitrum profile (<C>CHAIN_TYPE=arbitrum</C>, traces from the node’s <C>debug</C> API).
          </li>
          <li>
            <strong className="text-ink">Payments</strong>: <DocLink to="gully-pay">Gully Pay</DocLink> native on the chain, with USDC and ETH as assets, verified on chain the way it is today.
          </li>
          <li>
            <strong className="text-ink">Interop</strong>: Hyperlane. A Mailbox on the L3, Warp Routes for USDC and ETH from Arbitrum One (and Base) into it, and our own validator and relayer.
          </li>
          <li>
            <strong className="text-ink">Analytics, alerts, Gully AI</strong> read it like any other chain.
          </li>
        </List>
        <P>
          The chain id for the public chains is not chosen yet: 412346 is the fixed id of the dev node and will not be reused for a public chain. It will be registered in{' '}
          <C>ethereum-lists/chains</C> and the Hyperlane registry before the devnet opens.
        </P>
      </Section>

      <Section id="settlement" title="Settlement chain">
        <P>
          Both Arbitrum One and Base have canonical <C>RollupCreator</C> factories, so either can be the parent. The spec recommends <strong className="text-ink">Arbitrum One</strong>: the
          tooling we forked, the Chain Kit profile, the tracker’s Robinhood Chain coverage and the Arbitrum ecosystem programs are all Arbitrum-shaped, and Base liquidity still
          reaches the L3 through a Base→L3 Warp Route and, later, the aggregators. The public devnet settles to Arbitrum Sepolia.
        </P>
        <P>
          The parent’s gas price is one input to what posting a batch costs. These are the base fees on the candidates right now, read from their public RPCs by our server; a
          chain that cannot be read says so.
        </P>
        <ParentChainBaseFee />
        <P>
          The other input, the parent’s own L1 data component, varies with Ethereum blob prices and is not reported by any public RPC, so the spec asks for a real batch to be measured on each testnet before the decision is final.
        </P>
      </Section>

      <Section id="da" title="Data availability">
        <Fields
          head={['Mode', 'How', 'Trade-off']}
          rows={[
            ['Rollup (recommended)', 'Batches are posted to the parent chain as calldata or blobs. No extra infrastructure.', 'Security is the parent’s. Costs track the parent’s gas; for an L3 the parent is an L2, so already cheap.'],
            ['AnyTrust', 'A Data Availability Committee you run (one DA server per member) signs certificates; the batch poster posts the certificate. Falls back to posting full data if signatures do not arrive.', 'Lower DA fees, but N machines around the clock, and a committee run by one operator removes no trust.'],
          ]}
        />
        <P>The devnet and the launch use Rollup mode. AnyTrust is reconsidered only if the batch poster’s measured spend on Arbitrum Sepolia, projected to production volume, exceeds the cost of a real committee.</P>
      </Section>

      <Section id="gas" title="Gas token">
        <P>
          <strong className="text-ink">ETH</strong>. A custom ERC-20 gas token is possible (18 decimals, no transfer fee, no rebasing, no transfer callbacks, already on the parent chain) but in Rollup mode it needs a fee
          token pricer contract supplying the ETH/token rate to reimburse the batch poster, and every wallet, bridge and aggregator must learn the token. Gully has no token, and the
          spec does not propose one.
        </P>
      </Section>

      <Section id="interop" title="Interop: Hyperlane">
        <Callout label="OWNER DECISION · 17 OCTOBER 2026" tone="plain">
          Hyperlane is the interop layer for the Gully L3 <strong className="text-ink">when it launches, not before</strong>. LI.FI and Relay stay the swap and bridge aggregators for the chains Gully Pay offers today.
        </Callout>
        <H3>What gets deployed on the L3</H3>
        <Fields
          head={['Contract', 'Role', 'Setting']}
          rows={[
            ['Mailbox', 'Dispatches and processes messages', 'One per chain, deployed with hyperlane core deploy.'],
            ['Default ISM', 'Verifies inbound messages', 'Devnet: a trusted-relayer ISM (testing). Public chain: a multisig ISM per origin; for messages from Arbitrum, the public Arbitrum validator set already in the registry.'],
            ['Merkle tree hook', 'Inserts each message into the tree validators sign', 'Default hook.'],
            ['Interchain gas paymaster', 'Senders pay the relayer in the origin chain’s gas', 'Gas oracle entries for Arbitrum One (and Base) kept current by us.'],
            ['Validator announce', 'Validators publish where their signatures live', 'One per chain.'],
          ]}
        />
        <P>Nothing is deployed on Arbitrum One, Base or Arbitrum Sepolia: their Mailboxes already exist (addresses in the Hyperlane registry).</P>
        <H3>Warp Routes</H3>
        <P>
          A <strong className="text-ink">USDC</strong> route locks native USDC on Arbitrum One (collateral) and mints a synthetic USDC on the L3; Base can be added as a second collateral chain. An{' '}
          <strong className="text-ink">ETH</strong> route is the fast path beside the canonical bridge, whose withdrawals wait the parent’s challenge window. Route contracts are owned by the team multisig, never a server key.
        </P>
        <H3>Who secures messages leaving the L3</H3>
        <P>
          Validators sign checkpoints of their origin chain, so messages <em>from</em> the L3 are only as safe as the validators we run: one on the devnet, 2 of 3 in different regions with keys in a KMS at launch, external operators invited once there is value to protect.
        </P>
        <H3>Versions pinned in the spec</H3>
        <List>
          <li>
            Hyperlane CLI <C>@hyperlane-xyz/cli</C> 45.0.1, registry 26.1.0.
          </li>
          <li>
            Agents <C>ghcr.io/hyperlane-xyz/hyperlane-agent:agents-v2.3.0</C>, pinned by digest, 220 MB compressed; each capped at 1 GB RAM in our compose file.
          </li>
        </List>
      </Section>

      <Section id="pay" title="Gully Pay on the L3">
        <List>
          <li>
            <strong className="text-ink">Native</strong>: the L3 joins the payment chains with ETH and the Warp Route USDC; verification is the same receipt-and-transfer check as today.
          </li>
          <li>
            <strong className="text-ink">Cross-chain in</strong>: a payer on Arbitrum One or Base sends into the USDC Warp Route with the merchant’s L3 address as recipient. The invoice shows <C>settling</C> until the Mailbox delivers on the L3; both transaction hashes are on the receipt.
          </li>
          <li>
            <strong className="text-ink">Cross-chain out</strong>: merchant payouts to Arbitrum One are Warp transfers paid for in L3 ETH, with the fee quoted before the merchant confirms.
          </li>
          <li>Fee splits (the merchant fee proxy) deploy unchanged.</li>
        </List>
      </Section>

      <Section id="aggregators" title="Swaps and bridges today">
        <P>
          For Base, Ethereum, BNB Chain and Arbitrum One, Gully Pay’s checkout keeps using <Ext href="https://li.fi">LI.FI</Ext> and <Ext href="https://relay.link">Relay</Ext>. Relay says it can be added to “any EVM-chain, such as … Arbitrum Orbit chains” on request; LI.FI prioritises by customer demand. Both are asked to list the L3 once it has a registered chain id, a stable RPC, Chain Kit’s API, the Warp Routes and DEX liquidity.
        </P>
      </Section>

      <Section id="devnet" title="The devnet, and what you can do now">
        <P>
          The light devnet is one Nitro container in dev mode, chain id 412346, with an in-memory parent chain, run only on a machine with 15 GB free. It is for testing Chain Kit’s Arbitrum profile, Stylus contracts, Gully Pay flows and the Hyperlane agents against a chain we control. It has no bridge (its parent is simulated), so the first Hyperlane exercise is a message between it and Arbitrum Sepolia.
        </P>
        <P>
          If you want to be told when the public devnet opens, join the Gully Chains waitlist in the <Ext href="https://app.gullylabs.xyz">app dashboard</Ext>. If you want to run the pieces yourself, the compose files and runbooks are in the site repository under <C>ops/devnet</C> and <C>ops/l3</C>.
        </P>
      </Section>

      <Section id="decisions" title="Open decisions">
        <Fields
          head={['Decision', 'Options', 'Recommended']}
          rows={[
            ['Settlement chain', 'Arbitrum One · Base', 'Arbitrum One; devnet on Arbitrum Sepolia'],
            ['Data availability', 'Rollup · AnyTrust', 'Rollup; re-decide on measured batch costs'],
            ['Gas token', 'ETH · custom ERC-20', 'ETH'],
            ['Validator set', 'ours only · ours plus external', '1 of 1 on the devnet, 2 of 3 at launch, open later'],
            ['Interop layer', 'Hyperlane (decided)', 'Hyperlane at launch; LI.FI and Relay for today’s chains'],
          ]}
        />
      </Section>

      <Section id="sources" title="Sources">
        <P>Everything above was read from primary sources on 17 October 2026; the full spec carries each quote and figure with its link.</P>
        <List>
          <li>
            Arbitrum: <Ext href="https://docs.arbitrum.io/launch-arbitrum-chain/arbitrum-chain-sdk-introduction">chain SDK introduction</Ext>,{' '}
            <Ext href="https://docs.arbitrum.io/launch-arbitrum-chain/deploy/canonical-factory-contracts">canonical factory contracts</Ext>,{' '}
            <Ext href="https://docs.arbitrum.io/launch-arbitrum-chain/features/common/data-availability/choose-anytrust">choose AnyTrust</Ext>,{' '}
            <Ext href="https://docs.arbitrum.io/launch-arbitrum-chain/features/common/gas-and-fees/choose-custom-gas-token">custom gas token</Ext>.
          </li>
          <li>
            Hyperlane: <Ext href="https://docs.hyperlane.xyz/docs/guides/chains/deploy-hyperlane">deploy to a new chain</Ext>,{' '}
            <Ext href="https://docs.hyperlane.xyz/docs/operate/validators/run-validators">run validators</Ext>,{' '}
            <Ext href="https://docs.hyperlane.xyz/docs/operate/relayer/run-relayer">run a relayer</Ext>,{' '}
            <Ext href="https://docs.hyperlane.xyz/docs/guides/quickstart/deploy-warp-route">Warp Routes</Ext>,{' '}
            <Ext href="https://github.com/hyperlane-xyz/hyperlane-registry">registry</Ext>.
          </li>
          <li>
            Aggregators: <Ext href="https://docs.relay.link/resources/supported-chains">Relay supported chains</Ext>,{' '}
            <Ext href="https://docs.li.fi/introduction/learn-more/getting-integrated-by-lifi">getting integrated by LI.FI</Ext>.
          </li>
        </List>
      </Section>
    </DocPage>
  )
}
