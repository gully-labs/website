import { DocLink, DocPage, Ext, List, Section } from '../DocPage'

const sections = [{ id: '2026-10-16', title: '16 October 2026' }]

export function Changelog() {
  return (
    <DocPage
      slug="changelog"
      eyebrow="MORE · CHANGELOG"
      title="Changelog"
      description="What changed in the Gully Labs tracker, its API, the widget and these docs."
      lead="What changed, newest first."
      sections={sections}
    >
      <Section id="2026-10-16" title="16 October 2026">
        <List>
          <li>
            <Ext href="https://gullylabs.xyz/tracker">The tracker</Ext> launched: tokenised stocks on Robinhood Chain and BNB Chain against their Chainlink fair price, with a gap history per token.
          </li>
          <li>
            The public <DocLink to="api">API</DocLink>: <code className="font-mono text-[.9em] text-ink">/api/tracker</code> and <code className="font-mono text-[.9em] text-ink">/api/tracker/history</code>.
          </li>
          <li>
            The embeddable <DocLink to="widget">widget</DocLink> (ticker, badge, table) and its <Ext href="https://gullylabs.xyz/widget">builder</Ext>.
          </li>
          <li>
            <DocLink to="api-keys">API keys</DocLink> for higher rate limits.
          </li>
          <li>These docs.</li>
        </List>
      </Section>
    </DocPage>
  )
}
