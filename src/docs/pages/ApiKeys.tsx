import { CodeBlock } from '../CodeBlock'
import { C, Callout, DocLink, DocPage, Ext, List, P, Section } from '../DocPage'

const sections = [
  { id: 'when', title: 'When you need one' },
  { id: 'request', title: 'Requesting a key' },
  { id: 'using', title: 'Using a key' },
  { id: 'limits', title: 'Limits' },
  { id: 'safety', title: 'Keeping it safe' },
]

const USE = `curl -i https://gullylabs.xyz/api/tracker \
  -H "Authorization: Bearer $GULLY_API_KEY"`

const USE_JS = `// On your server, never in browser code.
const res = await fetch('https://gullylabs.xyz/api/tracker', {
  headers: { Authorization: \`Bearer \${process.env.GULLY_API_KEY}\` },
})
console.log(res.headers.get('X-RateLimit-Remaining'))`

export function ApiKeys() {
  return (
    <DocPage
      slug="api-keys"
      eyebrow="BUILD · API KEYS"
      title="API keys"
      description="When you need a Gully Labs API key, how to request one, how to send it as a Bearer token, and how rate limits are reported."
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

      <Section id="request" title="Requesting a key">
        <P>
          Request a key at <Ext href="https://gullylabs.xyz/developers">gullylabs.xyz/developers</Ext>. Tell us what you are building and roughly how often you will call the API.
        </P>
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
          Every successful response carries <C>X-RateLimit-Limit</C> and <C>X-RateLimit-Remaining</C>. Past the limit the API answers <C>429</C> with a <C>Retry-After</C> header in seconds. The figures are read from the headers rather than fixed here, because they can change. Details in the <DocLink to="api" hash="rate-limits">API reference</DocLink>.
        </P>
        <P>The data refreshes about every two minutes, so polling more often than once a minute returns the same answer.</P>
      </Section>

      <Section id="safety" title="Keeping it safe">
        <List>
          <li>Keep the key on a server or in an environment variable. Anything shipped to a browser, an app bundle or a public repository is public.</li>
          <li>Do not put a key in the widget snippet: the widget does not read one.</li>
          <li>If a key is exposed, stop using it and request a new one from the developers page.</li>
        </List>
        <Callout label="TIP" tone="plain">
          To serve many browser users, call the API from your server with your key and cache the answer for a minute. Your users then never touch the limit.
        </Callout>
      </Section>
    </DocPage>
  )
}
