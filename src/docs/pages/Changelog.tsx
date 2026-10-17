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
          <li>
            Onchain prices are now read straight from each token’s deepest pool every refresh; DexScreener and GeckoTerminal only find the pool and report its depth.
          </li>
          <li>
            Every row carries <code className="font-mono text-[.9em] text-ink">logo</code> and <code className="font-mono text-[.9em] text-ink">chainLogo</code>, and every
            chain reports its <code className="font-mono text-[.9em] text-ink">poolSource</code>.
          </li>
          <li>Widget v2: real logos, coloured gaps, value flashes on change, a 24-hour gap chart on the badge, and a sortable, clickable table.</li>
          <li>
            The <Ext href="https://developers.gullylabs.xyz">developer portal</Ext>: sign in with a wallet and create keys instantly, with usage charts and a request log.
          </li>
          <li>
            The <DocLink to="sdk">SDK</DocLink>: <code className="font-mono text-[.9em] text-ink">@gullylabs/tracker</code> and{' '}
            <code className="font-mono text-[.9em] text-ink">@gullylabs/widget</code>.
          </li>
        </List>
      </Section>
    </DocPage>
  )
}
