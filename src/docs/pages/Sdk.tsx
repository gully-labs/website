import { CodeBlock } from '../CodeBlock'
import { C, Callout, DocLink, DocPage, Ext, List, P, Section } from '../DocPage'
import { GapHistoryChart } from '../LiveCharts'

const sections = [
  { id: 'packages', title: 'Packages' },
  { id: 'tracker', title: 'Tracker client' },
  { id: 'widget', title: 'Widget' },
  { id: 'errors', title: 'Errors and limits' },
]

const INSTALL = `npm install @gullylabs/widgets`

const CLIENT = `import { createTrackerClient, isTrusted } from '@gullylabs/widgets/tracker'

const tracker = createTrackerClient({ apiKey: process.env.GULLY_API_KEY }) // key optional

const nvda = await tracker.getStock('robinhood', 'NVDA')       // one row, or nothing
const widest = await tracker.widestGaps(5)                     // trusted gaps, largest first
const flagged = await tracker.getRows({ status: ['premium', 'discount'] })
const history = await tracker.getHistory('robinhood', 'NVDA')  // { time, gapPct, onchain, fair }[]

const stop = tracker.watch((t) => render(t.rows), { onError: console.error })`

const REACT = `import { GullyWidget } from '@gullylabs/widgets/widget/react'

<GullyWidget type="badge" ticker="NVDA" chain="robinhood" />
<GullyWidget type="table" limit={5} theme="light" />`

const VANILLA = `import { mountWidget } from '@gullylabs/widgets/widget'

await mountWidget(document.getElementById('gaps'), { type: 'ticker', chain: 'bsc' })`

const ERRORS = `import { GullyApiError } from '@gullylabs/widgets/tracker'

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
      lead="One small MIT package, @gullylabs/widgets: a typed client for the tracker API, the widget with a loader and a React component, and a Holder Map client with its own component. All optional; the API and the widget work without them. Every other Gully SDK is on the Integrate in 5 minutes page."
      sections={sections}
    >
      <Section id="packages" title="Packages">
        <P>
          The public API now has its own host, <C>api.gullylabs.xyz</C> (same <C>/api/…</C> paths). The packages still default to <C>https://gullylabs.xyz</C>, which keeps serving the API without redirects, so nothing needs to change. Calls made without the packages can use the new host today, and the widget script now loads from <C>embed.gullylabs.xyz</C> (the old script address still works).
        </P>
        <List>
          <li>
            <C>@gullylabs/widgets/tracker</C>: a typed tracker client with no dependencies. Runs in browsers, Node 18+, Bun, Deno and edge runtimes.
          </li>
          <li>
            <C>@gullylabs/widgets/widget</C>: loads <C>widget.js</C> once and mounts widgets, with <C>@gullylabs/widgets/widget/react</C> for React.
          </li>
          <li>
            <C>@gullylabs/widgets/holders</C>: a typed Holder Map client (Gully Chain included) and a React component that frames the map. See <DocLink to="holder-map-integrate">Integrate the Holder Map</DocLink>.
          </li>
        </List>
        <P>
          The package replaces <C>@gullylabs/tracker</C>, <C>@gullylabs/widget</C> and <C>@gullylabs/holders</C> (same APIs; only the package path changes). The other Gully SDKs (<C>@gullylabs/chain</C>, <C>@gullylabs/id</C>, <C>@gullylabs/pay</C>, <C>@gullylabs/security</C>, <C>@gullylabs/kre8-embed</C>, <C>@gullylabs/ads</C>) are on <DocLink to="integrate">Integrate in 5 minutes</DocLink>.
        </P>
        <CodeBlock lang="bash" code={INSTALL} />
        <P>
          Source: <Ext href="https://github.com/gully-labs/sdk">github.com/gully-labs/sdk</Ext>.
        </P>
      </Section>

      <Section id="tracker" title="Tracker client">
        <CodeBlock lang="js" code={CLIENT} />
        <P>
          Rows are the same objects the <DocLink to="api">API reference</DocLink> describes. A price that cannot be read comes back empty, never zero;{' '}
          <C>isTrusted(row)</C> keeps the rows the tracker itself would chart. <C>tracker.rateLimit</C> holds the limit the last response reported.
        </P>
        <P>
          What <C>getHistory('robinhood', 'NVDA')</C> returns right now, drawn from the same endpoint (<C>/api/tracker/history</C>):
        </P>
        <GapHistoryChart chain="robinhood" ticker="NVDA" />
      </Section>

      <Section id="widget" title="Widget">
        <CodeBlock lang="js" code={REACT} />
        <CodeBlock lang="js" code={VANILLA} />
        <P>
          Every option of the <DocLink to="widget">widget guide</DocLink> is a prop. To self-host the script, copy{' '}
          <C>@gullylabs/widgets/widget.js</C> to your site and pass its URL as <C>scriptSrc</C>.
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
