import { CodeBlock } from '../CodeBlock'
import { C, Callout, DocLink, DocPage, Ext, Fields, List, P, Section } from '../DocPage'

/* "Integrate in 5 minutes": every way to put a Gully product in your own site or app, as it is TODAY. Only what is
   published is given as an install command (checked against the npm registry and the public repos: @gullylabs/tracker,
   @gullylabs/widget and @gullylabs/holders 0.1.0, source github.com/gully-labs/sdk); everything else integrates through a
   hosted script or a public HTTP API, with its own docs linked. Packages that are not on npm yet are named as coming,
   never as an install line. Links go only to public pages (no private repositories). */

const sections = [
  { id: 'map', title: 'What integrates how' },
  { id: 'widgets', title: 'Holders, prices, badges' },
  { id: 'id', title: 'Sign in with Gully ID' },
  { id: 'pay', title: 'Payments: Gully Pay' },
  { id: 'chain', title: 'Gully Chain and Gully Core' },
  { id: 'security', title: 'Security reports' },
  { id: 'coming', title: 'Coming to npm' },
  { id: 'versions', title: 'Versions and support' },
]

const INSTALL = `npm install @gullylabs/tracker   # typed client for the stock token tracker API
npm install @gullylabs/widget    # the embeddable widget, with a React component
npm install @gullylabs/holders   # Holder Map client and <HolderMap> React component`

const WIDGETS = `import { createTrackerClient } from '@gullylabs/tracker'
import { createHoldersClient, isMapOk } from '@gullylabs/holders'
import { HolderMap } from '@gullylabs/holders/react'

const widest = await createTrackerClient().widestGaps(5) // stock tokens vs their Chainlink fair price, no key needed

const map = await createHoldersClient().getMap('robinhood', '0x8d901a1b3f3a57f9c36a71382fa183476c41545b')
if (isMapOk(map)) console.log(map.summary.line)

export const Holders = ({ token }) => <HolderMap chain="robinhood" token={token} height={640} />`

const SCRIPT = `<!-- no build step: one script tag, served from embed.gullylabs.xyz -->
<div data-gully-widget="holders" data-chain="robinhood" data-token="0x8d901a1b3f3a57f9c36a71382fa183476c41545b"></div>
<div data-gully-widget="ticker" data-chain="bsc"></div>
<script src="https://embed.gullylabs.xyz/widget.js" async></script>`

const ID = `<!-- Sign in with Gully ID: the hosted SDK, no package -->
<div id="gully-signin"></div>
<script src="https://gullyid.xyz/sdk/v1.js" onload="
  const gid = GullyID.init({ clientId: 'your-client-id', redirectUri: location.origin + '/' })
  gid.renderButton(document.getElementById('gully-signin'), { onSignIn: (session) => console.log(session) })
  // or gid.signIn({ mode: 'popup' | 'redirect' | 'passkey' })
"></script>

<!-- Or the plain OIDC code flow with PKCE against the issuer https://gullyid.xyz: the id_token carries the user's
     wallet and .gully name; verify it on your backend with the issuer's JWKS (/.well-known/openid-configuration). -->`

const PAY = `# Gully Pay is a public HTTP API: checkout, pay links, x402 micropayments, signed webhooks.
curl https://gullypay.xyz/api/x402/status        # networks (Gully Chain included), assets, schemes
# Create a checkout from your server with your merchant key, send the buyer to the returned URL,
# and read the signed webhook when it is paid: https://gullypay.xyz/docs`

const CHAIN = `// Gully Chain Testnet in any EVM library: chain id 485590
import { createPublicClient, defineChain, http } from 'viem'

export const gullyChainTestnet = defineChain({
  id: 485590,
  name: 'Gully Chain Testnet',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: ['https://testnet-rpc.gullychain.xyz'] } },
  blockExplorers: { default: { name: 'Gully Explorer', url: 'https://testnet.gullyscan.xyz' } },
  testnet: true,
})
const client = createPublicClient({ chain: gullyChainTestnet, transport: http() })
console.log(await client.getChainId()) // 485590`

export function IntegrateDocs() {
  return (
    <DocPage
      slug="integrate"
      eyebrow="START · INTEGRATE"
      title="Integrate in 5 minutes"
      description="Put a Gully product in your own site or app in five minutes: the published @gullylabs packages, the hosted scripts and the public APIs for HolderMaps, the tracker, Gully ID, Gully Pay, Gully Chain and Gully Security."
      lead="Every Gully product can be used from your own site or app today: three small packages on npm, hosted scripts that need no build step, and public HTTP APIs. This page lists what integrates how, with a quickstart each. Only what is published is given as an install line; what is still coming to npm says so."
      sections={sections}
    >
      <Section id="map" title="What integrates how">
        <Fields
          head={['Product', 'Integrate through', 'Docs']}
          variant="routes"
          rows={[
            ['HolderMaps', <><C>@gullylabs/holders</C> on npm, or the <C>embed.gullylabs.xyz</C> script</>, <DocLink to="holder-map-integrate">Integrate the Holder Map</DocLink>],
            ['Stock token tracker', <><C>@gullylabs/tracker</C> and <C>@gullylabs/widget</C> on npm, the script, or the REST API</>, <DocLink to="sdk">SDK</DocLink>],
            ['Gully Score badge', 'An SVG badge and a widget, no package', <DocLink to="badges">Badges</DocLink>],
            ['Gully ID', 'Hosted sign-in script or plain OIDC + PKCE', <Ext href="https://docs.gullychain.xyz/gully-id/">Gully ID sign-in</Ext>],
            ['Gully Pay', 'Public HTTP API: checkout, pay links, x402, webhooks', <Ext href="https://gullypay.xyz/docs">gullypay.xyz/docs</Ext>],
            ['Gully Chain and Gully Core', 'Chain id 485590 in any EVM library; Gully Core contracts and SDK from the chain docs', <Ext href="https://docs.gullychain.xyz/sdks/">docs.gullychain.xyz/sdks</Ext>],
            ['Gully Security', 'Public reports and scans on gullysecurity.xyz; the website API for scores', <DocLink to="gully-security">Gully Security</DocLink>],
          ]}
        />
        <Callout label="Published today">
          On npm under the <C>@gullylabs</C> scope: <C>tracker</C>, <C>widget</C> and <C>holders</C> (0.1.x, MIT, ESM and CommonJS with types, source{' '}
          <Ext href="https://github.com/gully-labs/sdk">github.com/gully-labs/sdk</Ext>). Every other integration below is a hosted script or an HTTP API, so nothing on this page needs a package that does not exist yet.
        </Callout>
      </Section>

      <Section id="widgets" title="Holders, prices and badges: the published packages">
        <CodeBlock lang="bash" code={INSTALL} />
        <CodeBlock lang="js" code={WIDGETS} />
        <P>
          The map of any token, who holds it and how the biggest wallets connect, from <DocLink to="holder-map">HolderMaps</DocLink>; the tracker client returns the same rows the{' '}
          <DocLink to="api">API reference</DocLink> describes. No key is needed; a key from the <Ext href="https://app.gullylabs.xyz">app</Ext> raises the <DocLink to="api-keys">rate limit</DocLink>.
        </P>
        <CodeBlock lang="html" code={SCRIPT} />
        <P>
          Every option of the <DocLink to="widget">widget guide</DocLink> is a <C>data-</C> attribute. The <DocLink to="badges">Gully Score badge</DocLink> is a plain SVG image: one <C>img</C> tag in a README or a page.
        </P>
      </Section>

      <Section id="id" title="Sign in with Gully ID">
        <CodeBlock lang="html" code={ID} />
        <P>
          Create the client in the <Ext href="https://gullyid.xyz/developers/console">Gully ID console</Ext>. The hosted script at <C>https://gullyid.xyz/sdk/v1.js</C> draws the official button and runs the flow; the id_token carries the user's wallet and{' '}
          <C>.gully</C> name. Guide: <Ext href="https://docs.gullychain.xyz/gully-id/">Gully ID sign-in</Ext>.
        </P>
      </Section>

      <Section id="pay" title="Payments: Gully Pay">
        <CodeBlock lang="bash" code={PAY} />
        <P>
          Gully Pay is the payment gateway for every Gully product: checkout, pay links, merchant stores, x402 micropayments and signed webhooks, paid to your own wallets, Gully Chain included. The REST docs, keys and webhook signing are at{' '}
          <Ext href="https://gullypay.xyz/docs">gullypay.xyz/docs</Ext>.
        </P>
      </Section>

      <Section id="chain" title="Gully Chain and Gully Core">
        <CodeBlock lang="js" code={CHAIN} />
        <P>
          Gully Chain Testnet is chain <C>485590</C>: add it to viem, ethers or wagmi with the chain object above. Contract addresses, ABIs, the bridge, <C>.gully</C> names, account abstraction and the Gully Core launchpad and DEX core are documented for builders at{' '}
          <Ext href="https://docs.gullychain.xyz/">docs.gullychain.xyz</Ext>; Gully Core itself, on its five mainnets and the testnet, at <Ext href="https://docs.gullycore.xyz/">docs.gullycore.xyz</Ext>.
        </P>
      </Section>

      <Section id="security" title="Security reports">
        <P>
          Published scan reports and monitors live on <Ext href="https://gullysecurity.xyz">gullysecurity.xyz</Ext>; the <DocLink to="gully-security">Gully Security</DocLink> page explains scans, monitors and the public report pages, and the{' '}
          <DocLink to="gully-score">Gully Score</DocLink> API and badge give a token's health in one number nobody can pay to change.
        </P>
      </Section>

      <Section id="coming" title="Coming to npm">
        <P>
          These SDKs exist in the products' own repositories and are published to npm with the Gully Chain mainnet release; until then this page gives no install line for them, and their products integrate through the hosted scripts and APIs above.
        </P>
        <List>
          <li>
            <C>@gullylabs/chain</C>: Gully Chain for viem (chain objects, every address and ABI, launchpad, swap, <C>.gully</C> names, passkey accounts, bridge, indexer, cross-chain buys). Today: <Ext href="https://docs.gullychain.xyz/sdks/">docs.gullychain.xyz/sdks</Ext>.
          </li>
          <li>
            <C>@gullylabs/id</C>: the OIDC + PKCE client, passkey and email sign-in, the account directory. Today: the hosted script above.
          </li>
          <li>
            <C>@gullylabs/pay</C>: x402 client, Agent Wallets, on-chain payment verification. Today: the HTTP API above.
          </li>
          <li>
            <C>@gullylabs/security</C>, <C>@gullylabs/kre8-embed</C> and <C>@gullylabs/ads</C>: the security badge element, kre8.fun coin cards and the Gully Ads publisher slots. Not published; Gully Ads serving is off in production.
          </li>
        </List>
      </Section>

      <Section id="versions" title="Versions and support">
        <List>
          <li>The published packages are <C>0.x</C>: minor versions may change APIs, patch versions never do. The repository has a CHANGELOG.</li>
          <li>Hosted scripts (<C>embed.gullylabs.xyz/widget.js</C>, <C>gullyid.xyz/sdk/v1.js</C>) are versioned in their URL or stable by contract; the API changelog is in the <DocLink to="changelog">changelog</DocLink>.</li>
          <li>
            Questions: <Ext href="https://discord.com/invite/tY2ErsNNBp">Discord</Ext>, <Ext href="https://x.com/Gully_Labs">@Gully_Labs</Ext>, or <Ext href="https://github.com/gully-labs">GitHub</Ext>.
          </li>
        </List>
      </Section>
    </DocPage>
  )
}
