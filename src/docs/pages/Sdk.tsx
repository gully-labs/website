import { CodeBlock } from '../CodeBlock'
import { C, Callout, DocLink, DocPage, Ext, List, P, Section } from '../DocPage'

const sections = [
  { id: 'packages', title: 'Packages' },
  { id: 'tracker', title: 'Tracker client' },
  { id: 'widget', title: 'Widget' },
  { id: 'errors', title: 'Errors and limits' },
]

const INSTALL = `npm install @gullylabs/tracker
npm install @gullylabs/widget`

const CLIENT = `import { createTrackerClient, isTrusted } from '@gullylabs/tracker'

const tracker = createTrackerClient({ apiKey: process.env.GULLY_API_KEY }) // key optional

const nvda = await tracker.getStock('robinhood', 'NVDA')       // one row, or null
const widest = await tracker.widestGaps(5)                     // trusted gaps, largest first
const flagged = await tracker.getRows({ status: ['premium', 'discount'] })
const history = await tracker.getHistory('robinhood', 'NVDA')  // { time, gapPct, onchain, fair }[]

const stop = tracker.watch((t) => render(t.rows), { onError: console.error })`

const REACT = `import { GullyWidget } from '@gullylabs/widget/react'

<GullyWidget type="badge" ticker="NVDA" chain="robinhood" />
<GullyWidget type="table" limit={5} theme="light" />`

const VANILLA = `import { mountWidget } from '@gullylabs/widget'

await mountWidget(document.getElementById('gaps'), { type: 'ticker', chain: 'bsc' })`

const ERRORS = `import { GullyApiError } from '@gullylabs/tracker'

try {
  await tracker.getTracker()
} catch (e) {
  if (e instanceof GullyApiError && e.status === 429) wait(e.retryAfter)
}`

export function Sdk() {
  return (
    <DocPage
      slug="sdk"
      eyebrow="BUILD · SDK"
      title="SDK"
      description="The Gully Labs SDK: a typed TypeScript client for the stock token tracker API, and the embeddable widget with a React component."
      lead="Two small MIT packages: a typed client for the tracker API, and the widget with a loader and a React component. Both are optional; the API and the widget work without them."
      sections={sections}
    >
      <Section id="packages" title="Packages">
        <List>
          <li>
            <C>@gullylabs/tracker</C>: a typed client with no dependencies. Runs in browsers, Node 18+, Bun, Deno and edge runtimes.
          </li>
          <li>
            <C>@gullylabs/widget</C>: loads <C>widget.js</C> once and mounts widgets, with <C>@gullylabs/widget/react</C> for React.
          </li>
        </List>
        <CodeBlock lang="bash" code={INSTALL} />
        <P>
          Source: <Ext href="https://github.com/gully-labs/sdk">github.com/gully-labs/sdk</Ext>.
        </P>
      </Section>

      <Section id="tracker" title="Tracker client">
        <CodeBlock lang="js" code={CLIENT} />
        <P>
          Rows are the same objects the <DocLink to="api">API reference</DocLink> describes. A price that cannot be read is <C>null</C>, never zero;{' '}
          <C>isTrusted(row)</C> keeps the rows the tracker itself would chart. <C>tracker.rateLimit</C> holds the limit the last response reported.
        </P>
      </Section>

      <Section id="widget" title="Widget">
        <CodeBlock lang="js" code={REACT} />
        <CodeBlock lang="js" code={VANILLA} />
        <P>
          Every option of the <DocLink to="widget">widget guide</DocLink> is a prop. To self-host the script, copy{' '}
          <C>@gullylabs/widget/widget.js</C> to your site and pass its URL as <C>scriptSrc</C>.
        </P>
      </Section>

      <Section id="errors" title="Errors and limits">
        <CodeBlock lang="js" code={ERRORS} />
        <Callout label="Limits">
          Anonymous calls get 60 a minute per IP. A key from the <Ext href="https://app.gullylabs.xyz">app dashboard</Ext> raises it to 600. The
          tracker refreshes every minute, so polling faster returns the same data.
        </Callout>
      </Section>
    </DocPage>
  )
}
