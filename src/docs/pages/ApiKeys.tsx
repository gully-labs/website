import { LivePulse } from '../../components/tracker/LivePulse'
import { CodeBlock } from '../CodeBlock'
import { C, Callout, DocLink, DocPage, Ext, List, P, Section } from '../DocPage'
import { PlanLimitsLive } from '../LiveCharts'

const sections = [
  { id: 'when', title: 'When you need one' },
  { id: 'get', title: 'Getting a key' },
  { id: 'manage', title: 'Managing keys' },
  { id: 'using', title: 'Using a key' },
  { id: 'limits', title: 'Limits' },
  { id: 'safety', title: 'Keeping it safe' },
]

const USE = `curl -i https://api.gullylabs.xyz/api/tracker \
  -H "Authorization: Bearer $GULLY_API_KEY"`

const USE_JS = `// On your server, never in browser code.
const res = await fetch('https://api.gullylabs.xyz/api/tracker', {
  headers: { Authorization: \`Bearer \${process.env.GULLY_API_KEY}\` },
})
console.log(res.headers.get('X-RateLimit-Remaining'))`

export function ApiKeys() {
  return (
    <DocPage
      slug="api-keys"
      eyebrow="BUILD · API KEYS"
      title="API keys"
      description="When you need a Gully Labs API key, how to get one instantly by signing in with a wallet, how to send it as a Bearer token, and how rate limits are reported."
      lead="The API is open without a key. A key raises your rate limit and counts your requests against your own allowance instead of your IP address."
      sections={sections}
    >
      <Section id="when" title="When you need one">
        <List>
          <li>Not for the widget: it is anonymous and shares one cached request per page.</li>
          <li>Not for trying the API, or for a page that reads it once a minute.</li>
          <li>Yes for a backend, bot or app that calls the API often, or from shared infrastructure where many callers share one IP address.</li>
        </List>
      </Section>

      <Section id="get" title="Getting a key">
        <P>
          Keys are free and issued instantly at <Ext href="https://app.gullylabs.xyz">app.gullylabs.xyz</Ext>. There is no form and no approval:
        </P>
        <List>
          <li>Press <b>Connect wallet</b> and pick any browser wallet or Coinbase Wallet. Your wallet address is your account; there is no email or password.</li>
          <li>Sign the message your wallet shows. It is Sign-In with Ethereum (EIP-4361): a signature, not a transaction, so it costs nothing and moves nothing. It names app.gullylabs.xyz, expires after ten minutes and can be used once.</li>
          <li>Open <b>API keys</b>, press <b>Create key</b> and name it. The key works at once. Copy it then: it is shown in full only once, because we store only a hash of it.</li>
        </List>
        <P>Smart-contract wallets (EIP-1271, including ones not deployed yet, ERC-6492) are accepted on Ethereum, Base, BNB Chain and Robinhood Chain. A sign-in lasts 30 days on that browser.</P>
      </Section>

      <Section id="manage" title="Managing keys">
        <List>
          <li>A wallet can hold up to five live keys. Each has its own 600-a-minute allowance.</li>
          <li><b>Rotate</b> gives a key a new secret and stops the old one immediately; its name and usage history stay.</li>
          <li><b>Revoke</b> stops a key for good.</li>
          <li>The dashboard shows requests per hour or day for each key, the error rate, and the last 50 requests with status and latency. Answers served from the edge cache never reach our servers and are not counted.</li>
          <li>A key issued through the earlier request form keeps working. Link it to your wallet from the API keys page to manage it there.</li>
        </List>
      </Section>

      <Section id="using" title="Using a key">
        <P>
          Send it in the <C>Authorization</C> header as a Bearer token, on either endpoint:
        </P>
        <CodeBlock lang="bash" code={USE} />
        <CodeBlock lang="js" code={USE_JS} />
      </Section>

      <Section id="limits" title="Limits">
        <P>
          Every successful response carries <C>X-RateLimit-Limit</C> and <C>X-RateLimit-Remaining</C>. Past the limit the API answers <C>429</C> with a <C>Retry-After</C> header in seconds. Today that is 60 requests a minute per IP address without a key and 600 a minute with one; read the headers rather than hard-coding either, because they can change. Details in the <DocLink to="api" hash="rate-limits">API reference</DocLink>.
        </P>
        <P>The data refreshes about every two minutes, so polling more often than once a minute returns the same answer.</P>
        <P>What a key gets on each plan, read live from <C>GET /api/plans</C>:</P>
        <LivePulse source="/api/plans" every="2 min">
          <PlanLimitsLive />
        </LivePulse>
      </Section>

      <Section id="safety" title="Keeping it safe">
        <List>
          <li>Keep the key on a server or in an environment variable. Anything shipped to a browser, an app bundle or a public repository is public.</li>
          <li>Do not put a key in the widget snippet: the widget does not read one.</li>
          <li>If a key is exposed, rotate or revoke it in the Gully Labs app; the old secret stops working at once.</li>
        </List>
        <Callout label="TIP" tone="plain">
          To serve many browser users, call the API from your server with your key and cache the answer for a minute. Your users then never touch the limit.
        </Callout>
      </Section>
    </DocPage>
  )
}
