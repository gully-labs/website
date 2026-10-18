import { CodeBlock } from '../CodeBlock'
import { GapHistoryChart } from '../LiveCharts'
import { C, DocLink, DocPage, Ext, Fields, List, P, Section } from '../DocPage'

const sections = [
  { id: 'what', title: 'One page per stock token' },
  { id: 'numbers', title: 'The numbers at the top' },
  { id: 'charts', title: 'Gap history and pool depth' },
  { id: 'side', title: 'Swap, contracts and follow' },
  { id: 'holders', title: 'Who holds it' },
  { id: 'missing', title: 'Unreadable and unknown tokens' },
  { id: 'badge', title: 'Put the badge on your site' },
]

const BADGE = `<div data-gully-widget="badge" data-ticker="NVDA" data-chain="robinhood"></div>
<script src="https://gullylabs.xyz/widget.js" async></script>`

export function StockPagesDocs() {
  return (
    <DocPage
      slug="stock-pages"
      eyebrow="PRODUCTS · STOCK PAGES"
      title="Stock pages"
      description="What each tracked stock token's page on gullylabs.xyz/tracker shows: price against fair price, the gap and its change, pool depth and history, contracts, swap, alerts, the Holder Map and an embeddable badge."
      lead={
        <>
          Every token the tracker follows has its own page at <C>gullylabs.xyz/tracker/&lt;chain&gt;/&lt;TICKER&gt;</C>. It is everything the tracker knows about that one token, read live. Nothing on it is typed in by hand.
        </>
      }
      sections={sections}
    >
      <Section id="what" title="One page per stock token">
        <P>
          Open a row in the <Ext href="https://gullylabs.xyz/tracker">tracker</Ext> and you land on its page, for example <C>/tracker/robinhood/NVDA</C>. The chain keys are <C>robinhood</C>, <C>bsc</C> and <C>solana</C>. The same ticker on two chains has two pages, and each links to the other. The page also lists the other tokens on the same chain.
        </P>
        <P>
          Its data is the tracker’s: the page re-reads it every minute, and the figures animate to each new read. Where the tracker prices a token two ways, onchain from its deepest pool and fair from Chainlink or, for some Solana xStocks, the issuer’s quote, the page names the source. How that works is in the <DocLink to="methodology">methodology</DocLink>.
        </P>
      </Section>

      <Section id="numbers" title="The numbers at the top">
        <Fields
          head={['Figure', 'Source', 'Meaning']}
          rows={[
            ['Onchain', 'deepest pool', 'The token’s price in its deepest pool, with the pair it trades against.'],
            ['Fair', 'fair-price feed', 'The fair price, with who priced it and how old the read is.'],
            ['Gap', 'onchain vs fair', 'How far the onchain price is from fair. A thin pool is labelled “thin pool, not trusted”.'],
            ['Gap Δ 1h, Gap Δ 24h', '/api/tracker/movers', 'How much the gap moved over the window, in percentage points, with the gap then and now.'],
            ['Liquidity, Volume 24h', 'deepest pool', 'The deepest pool’s liquidity and 24-hour volume.'],
            ['All pools', 'every pool found', 'How many pools the token has and their total liquidity.'],
          ]}
        />
        <P>
          A status badge beside the title says where the token stands. The two change cells explain themselves when they have no value: “reading snapshots” while loading, “could not be read”, “not a trusted pool now” for a token that is not a trusted reading, or “needs 1h of snapshots” or “needs 24h of snapshots” while there is not enough history yet.
        </P>
      </Section>

      <Section id="charts" title="Gap history and pool depth">
        <P>
          The gap chart shows the last 24 hours or 7 days, as the gap or as onchain against fair, from the tracker’s five-minute snapshots. You can drag to zoom, and the 7-day view adds a slider. Stretches without readings are marked on the chart. Below it, a footer names the pool, the fair-price method and whether the market is open. Pool depth shows the token’s deepest pool.
        </P>
        <GapHistoryChart chain="robinhood" ticker="NVDA" />
        <P>
          The data behind the chart is the public <C>GET /api/tracker/history</C>; see the <DocLink to="api">API reference</DocLink>.
        </P>
      </Section>

      <Section id="side" title="Swap, contracts and follow">
        <List>
          <li>
            <strong className="text-ink">Swap</strong>: a swap card for the token, through LI.FI on Robinhood Chain and BNB Chain and Jupiter on Solana. It stays closed where the region check says so. Your wallet signs everything; see <DocLink to="swaps">Swaps</DocLink>.
          </li>
          <li>
            <strong className="text-ink">Contracts</strong>: the token, its fair-price feed (or the fair-price source) and its pool, each with a copy button and an explorer link (Blockscout, BscScan, Etherscan or Solscan, by chain).
          </li>
          <li>
            <strong className="text-ink">Follow</strong>: “Alert me when the gap moves” opens the app’s Alerts tab with this token ready in the new-alert dialog, a button that copies a live badge for your site, and the same token on other chains.
          </li>
        </List>
        <P>
          The page also has a “Post on X” button that shares the token’s gap, and a link to the pool on DexScreener.
        </P>
      </Section>

      <Section id="holders" title="Who holds it">
        <P>
          Below the cards the page embeds the token’s <DocLink to="holder-map">Holder Map</DocLink>. Where a token has no map, or a chain’s stock maps are not available yet, it says so instead of showing an empty map. A “How swaps work” block answers who runs the swap, custody, cost and who can use it, and the page ends with the note that it is information, not investment advice.
        </P>
      </Section>

      <Section id="missing" title="Unreadable and unknown tokens">
        <List>
          <li>A value that could not be read shows a dash, never zero. If the whole tracker cannot be read the page says so.</li>
          <li>
            A ticker the tracker does not follow, or one on the wrong chain, answers <C>404</C> with a search instead of a silent redirect.
          </li>
          <li>
            A lower-case ticker redirects to the upper-case address (<C>/tracker/bsc/aapl</C> goes to <C>/tracker/bsc/AAPL</C>) if the token exists.
          </li>
        </List>
      </Section>

      <Section id="badge" title="Put the badge on your site">
        <P>
          The page’s “Copy a live badge for your site” button copies this snippet for that token. The options are in the <DocLink to="widget">widget guide</DocLink>.
        </P>
        <CodeBlock lang="html" code={BADGE} />
      </Section>
    </DocPage>
  )
}
