import { CodeBlock } from '../CodeBlock'
import { C, Callout, DocLink, DocPage, Ext, Fields, List, P, Section } from '../DocPage'

const sections = [
  { id: 'packages', title: 'The packages' },
  { id: 'widgets', title: 'Holders and prices' },
  { id: 'chain', title: 'Gully Chain' },
  { id: 'id', title: 'Sign in with Gully' },
  { id: 'pay', title: 'Payments' },
  { id: 'security', title: 'Security badge' },
  { id: 'kre8', title: 'kre8.fun embeds' },
  { id: 'ads', title: 'Gully Ads (beta)' },
  { id: 'versions', title: 'Versions and support' },
]

const WIDGETS = `// npm install @gullylabs/widgets
import { createHoldersClient, isMapOk } from '@gullylabs/widgets/holders'
import { HolderMap } from '@gullylabs/widgets/holders/react'
import { createTrackerClient } from '@gullylabs/widgets/tracker'

const map = await createHoldersClient().getMap('gully', '0x9665E20624F3a896067d75e51645e7E73FC35c48') // Gully Chain, no key
if (isMapOk(map)) console.log(map.summary.line)

const widest = await createTrackerClient().widestGaps(5) // stock tokens vs their Chainlink fair price

export const Holders = ({ token }) => <HolderMap chain="gully" token={token} height={640} />`

const CHAIN = `// npm install @gullylabs/chain viem
import { createPublicClient, http, parseEther, formatEther } from 'viem'
import { gullychainTestnet, testnet, launchpad, names, indexer } from '@gullylabs/chain'

const client = createPublicClient({ chain: gullychainTestnet, transport: http() })
console.log(await client.getChainId()) // 485590

const [token] = await launchpad.listTokens(client, { launchpad: testnet.launchpad.deployments[1].address })
const q = await launchpad.quoteBuy(client, token, parseEther('0.01'))
console.log(formatEther(q.tokensOut), 'tokens for 0.01 ETH')
console.log(await names.resolveName(client, 'gully-test')) // address or null
const { tokens } = await indexer.indexer.tokens()           // no RPC needed`

const ID = `// npm install @gullylabs/id
import { oidc } from '@gullylabs/id'

const cfg = { issuer: 'https://gullyid.xyz', clientId: 'your-client-id', redirectUri: 'https://yourapp.example/callback' }
const { url, state, verifier } = await oidc.authorizeUrl(cfg)
sessionStorage.setItem('gid', JSON.stringify({ state, verifier }))
location.assign(url)

// on /callback
const q = new URLSearchParams(location.search)
const saved = JSON.parse(sessionStorage.getItem('gid'))
if (q.get('state') !== saved.state) throw new Error('state mismatch')
const tokens = await oidc.exchangeCode(cfg, q.get('code'), saved.verifier)`

const PAY = `// npm install @gullylabs/pay
import { GullyPayClient, gullyPay } from '@gullylabs/pay'

// An AI agent that pays HTTP 402s from its own wallet, inside its owner's policy
const agent = gullyPay.agent(process.env.GULLYPAY_AGENT_KEY)
const res = await agent.fetch('https://api.gullypay.xyz/agents/demo/chain-stats')

// Or the x402 facilitator directly
const pay = new GullyPayClient({ facilitatorUrl: 'https://gullypay.xyz/api', apiKey: process.env.GULLYPAY_API_KEY })
console.log(await pay.status()) // networks (Gully Chain included), assets, schemes`

const SECURITY = `<!-- npm install @gullylabs/security -->
<script type="module">
  import { defineSecurityBadge } from '@gullylabs/security'
  defineSecurityBadge()
</script>
<gully-security-badge chain="485590" address="0x…"></gully-security-badge>`

const KRE8 = `<!-- npm install @gullylabs/kre8-embed -->
<script type="module">
  import { defineKre8Embeds } from '@gullylabs/kre8-embed'
  defineKre8Embeds()
</script>
<kre8-coin-card coin="0x…"></kre8-coin-card>
<kre8-back-button creator="alice"></kre8-back-button>`

const ADS = `// npm install @gullylabs/ads@beta
// your server: sign the serve request with your site key (the key never reaches the browser)
import { signServeRequest } from '@gullylabs/ads/server'
// your page
import { defineAdSlot } from '@gullylabs/ads'
defineAdSlot()
// <gully-ad-slot site="your-site-id" slot="sidebar"></gully-ad-slot>`

export function IntegrateDocs() {
  return (
    <DocPage
      slug="integrate"
      eyebrow="START · INTEGRATE"
      title="Integrate in 5 minutes"
      description="Every Gully SDK on npm under @gullylabs, with a five-minute quickstart each: Gully Chain, Gully ID, Gully Pay, HolderMaps and widgets, Gully Security, kre8.fun embeds and Gully Ads."
      lead="Every Gully product ships a TypeScript SDK on npm under the @gullylabs scope: ESM and CommonJS builds with types, MIT, semver 0.x, nothing but the built code in the tarball, and a README whose quickstart runs against production in five minutes. Pick the ones you need; each works alone."
      sections={sections}
    >
      <Section id="packages" title="The packages">
        <Fields
          head={['Package', 'Use it for', 'Source']}
          variant="routes"
          rows={[
            [<C>@gullylabs/widgets</C>, 'HolderMaps client and <HolderMap> frame, the stock token tracker client and widget', <Ext href="https://github.com/gully-labs/sdk/tree/main/packages/widgets">gully-labs/sdk</Ext>],
            [<C>@gullylabs/chain</C>, 'Gully Chain: chain objects for viem, every address and ABI, launchpad, swap, .gully names, passkey accounts, bridge, indexer, CLI', <Ext href="https://github.com/gully-labs/gullychain-sdk">gullychain-sdk</Ext>],
            [<C>@gullylabs/id</C>, 'Sign in with Gully (OIDC + PKCE), passkey and email sign-in, the account directory', <Ext href="https://github.com/gully-labs/gully-id/tree/main/sdk">gully-id</Ext>],
            [<C>@gullylabs/pay</C>, 'Gully Pay: x402 micropayments, Agent Wallets, the MCP server, on-chain payment verification', <Ext href="https://github.com/gully-labs/gull-pay/tree/main/packages/pay-sdk">gull-pay</Ext>],
            [<C>@gullylabs/security</C>, 'Gully Security scans of a token and the "Secured by Gully Security" badge', <Ext href="https://github.com/gully-labs/sdk/tree/main/packages/security">gully-labs/sdk</Ext>],
            [<C>@gullylabs/kre8-embed</C>, 'kre8.fun coin cards, Drop and track players and "Back this" buttons on your own site', <Ext href="https://github.com/gully-labs/sdk/tree/main/packages/kre8-embed">gully-labs/sdk</Ext>],
            [<C>@gullylabs/ads</C>, 'Gully Ads publisher SDK (beta): ad slots with signed serve requests and reporting', <Ext href="https://github.com/gully-labs/sdk/tree/main/packages/ads">gully-labs/sdk</Ext>],
          ]}
        />
        <Callout label="Gully Chain">
          Every SDK supports Gully Chain Testnet (chain id <C>485590</C>) today and picks up mainnet when it is live. Building on the chain itself? The same page for chain builders is{' '}
          <Ext href="https://docs.gullychain.xyz/sdks/">docs.gullychain.xyz/sdks</Ext>.
        </Callout>
      </Section>

      <Section id="widgets" title="Holders and prices: @gullylabs/widgets">
        <CodeBlock lang="js" code={WIDGETS} />
        <P>
          The map of any token, who holds it and how the biggest wallets connect, from <DocLink to="holder-map">HolderMaps</DocLink>; the same package carries the{' '}
          <DocLink to="sdk">tracker client and widget</DocLink>. It replaces <C>@gullylabs/tracker</C>, <C>@gullylabs/widget</C> and <C>@gullylabs/holders</C>. No key needed; a key from the{' '}
          <Ext href="https://app.gullylabs.xyz">app</Ext> raises the <DocLink to="api-keys">rate limit</DocLink>.
        </P>
      </Section>

      <Section id="chain" title="Gully Chain: @gullylabs/chain">
        <CodeBlock lang="js" code={CHAIN} />
        <P>
          <C>viem</C> is the only dependency (a peer). Subpath imports (<C>@gullylabs/chain/launchpad</C>, <C>/names</C>, <C>/accounts</C>, <C>/abis</C>) keep bundles small, the <C>gullychain</C> CLI prints addresses and ABIs, and <C>@gullylabs/chain/xchain</C> quotes cross-chain buys across Relay, LI.FI and the Hyperlane warp route. Chain docs:{' '}
          <Ext href="https://docs.gullychain.xyz/">docs.gullychain.xyz</Ext>.
        </P>
      </Section>

      <Section id="id" title="Sign in with Gully: @gullylabs/id">
        <CodeBlock lang="js" code={ID} />
        <P>
          Create the client in the <Ext href="https://gullyid.xyz/developers/console">Gully ID console</Ext>. The id_token carries the user's Gully Chain wallet, <C>.gully</C> name and reputation; verify it on your backend with the issuer's JWKS. No build step? The hosted button is{' '}
          <C>https://gullyid.xyz/sdk/v1.js</C>. Guide: <Ext href="https://docs.gullychain.xyz/gully-id/">Gully ID sign-in</Ext>.
        </P>
      </Section>

      <Section id="pay" title="Payments: @gullylabs/pay">
        <CodeBlock lang="js" code={PAY} />
        <P>
          <C>@gullylabs/pay/wallet</C> adds on-chain verification (<C>verifyStablecoinPayment</C>), the token registry and wallet helpers (needs <C>viem</C>). Gully Pay is the gateway for every Gully product; docs at{' '}
          <Ext href="https://gullypay.xyz/docs">gullypay.xyz/docs</Ext>.
        </P>
      </Section>

      <Section id="security" title="Security badge: @gullylabs/security">
        <CodeBlock lang="html" code={SECURITY} />
        <P>
          The badge is the official "Secured by Gully Security" kit image, linking to the token's public report on <Ext href="https://gullysecurity.xyz">gullysecurity.xyz</Ext>. The same package has the typed client to start a scan and read its report; see{' '}
          <DocLink to="gully-security">Gully Security</DocLink>.
        </P>
      </Section>

      <Section id="kre8" title="kre8.fun embeds: @gullylabs/kre8-embed">
        <CodeBlock lang="html" code={KRE8} />
        <P>
          Each element is a sandboxed iframe served by kre8.fun; messages are checked against the kre8.fun origin and a per-instance nonce, no auth tokens cross the frame, and any money action opens kre8.fun in a new tab. React:{' '}
          <C>@gullylabs/kre8-embed/react</C>.
        </P>
      </Section>

      <Section id="ads" title="Gully Ads (beta): @gullylabs/ads">
        <CodeBlock lang="js" code={ADS} />
        <P>
          Gully Ads is not live yet (serving is off in production), so the package is published under the <C>beta</C> tag. Impressions count at 50% visible for one second; clicks are reported with the token the server issued with the creative.
        </P>
      </Section>

      <Section id="versions" title="Versions and support">
        <List>
          <li>All packages start at <C>0.x</C>: minor versions may change APIs, patch versions never do. Each repository has a CHANGELOG.</li>
          <li>Releases are tagged and published with npm provenance, so every tarball links back to the commit that built it.</li>
          <li>
            Questions: <Ext href="https://discord.com/invite/tY2ErsNNBp">Discord</Ext>, <Ext href="https://x.com/Gully_Labs">@Gully_Labs</Ext>, or <Ext href="https://github.com/gully-labs">GitHub</Ext>.
          </li>
        </List>
      </Section>
    </DocPage>
  )
}
