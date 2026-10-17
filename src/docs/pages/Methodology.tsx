import { CodeBlock } from '../CodeBlock'
import { C, Callout, DocLink, DocPage, Fields, H3, List, P, Section } from '../DocPage'

const sections = [
  { id: 'two-prices', title: 'Two prices' },
  { id: 'fair', title: 'Fair price' },
  { id: 'onchain', title: 'Onchain price' },
  { id: 'gap', title: 'The gap and its status' },
  { id: 'sessions', title: 'Market sessions' },
  { id: 'freshness', title: 'Refresh, staleness, history' },
  { id: 'limits', title: 'Limits' },
]

export function Methodology() {
  return (
    <DocPage
      slug="methodology"
      eyebrow="START · METHODOLOGY"
      title="Tracker methodology"
      description="How the Gully Labs tracker reads a stock token's fair price from Chainlink and its onchain price from the deepest pool, and the rules that decide when a gap is flagged."
      lead="How each number is read, how the gap is computed, and the rules that keep a small pool or a closed market from making a headline."
      sections={sections}
    >
      <Section id="two-prices" title="Two prices">
        <P>For every token in the tracker’s feed table, on every chain it covers, two numbers are read live on each refresh:</P>
        <List>
          <li>
            <strong className="text-ink">Fair</strong>: the Chainlink feed for that stock, read on chain.
          </li>
          <li>
            <strong className="text-ink">Onchain</strong>: the token’s price in its deepest pool, read straight from that pool’s contract.
          </li>
        </List>
        <P>Both are in US dollars per token. Each is either a number or unreadable; an unreadable price is never replaced with zero or with an older figure.</P>
      </Section>

      <Section id="fair" title="Fair price">
        <P>
          Every feed is read with <C>latestRoundData()</C> in one batched call per chain. A round whose answer is zero or negative, or whose update time is zero, counts as unreadable. The answer is scaled by the feed’s decimals.
        </P>
        <H3>Robinhood Chain</H3>
        <P>
          The feeds price the token itself (<C>feedPrices: "tokenized-instrument"</C>), so fair is the feed’s answer.
        </P>
        <H3>BNB Chain</H3>
        <P>
          The feeds price the underlying <em>share</em> (<C>feedPrices: "underlying-share"</C>). One raw bStock token is a number of shares given by the token’s own <C>uiMultiplier()</C> (ERC-8056, where 1e18 means 1.0). The multiplier is read on chain on every refresh, because the issuer changes it at a split.
        </P>
        <CodeBlock lang="text" caption="BNB CHAIN" code={'fair = share price (Chainlink) × uiMultiplier() / 1e18'} />
        <P>
          If the multiplier cannot be read, or reads as zero, the fair price is unreadable for that token. The multiplier used is returned in each row as <C>multiplier</C>.
        </P>
      </Section>

      <Section id="onchain" title="Onchain price">
        <P>
          Once an hour the tracker asks DexScreener (GeckoTerminal if DexScreener refuses) for every pool of every token, 30 tokens per request. For each token it keeps the pools with a positive price and picks one: pools quoted against a native coin or a dollar stablecoin come first (WETH, ETH, WBNB, BNB, USDC, USDG, USDT, USD1, FDUSD), then the deepest by liquidity.
        </P>
        <P>
          Between those reads, every refresh prices the chosen pool from the chain itself: <C>slot0()</C> on a v3 pool, <C>StateView.getSlot0</C> on a Uniswap v4 pool. The pool’s ratio is turned into dollars with $1 for a dollar stablecoin, Chainlink’s ETH/USD or BNB/USD feed for the native coin, and this cycle’s fair price where the quote is itself a stock token. The chain’s <C>poolSource</C> says <C>on chain</C> when this is the source.
        </P>
        <P>
          The row’s <C>pool</C> object names the pool used, its liquidity and 24-hour volume, and totals across every pool found for the token. Liquidity and volume come from the hourly read, because the chain does not publish them in a usable form.
        </P>
      </Section>

      <Section id="gap" title="The gap and its status">
        <CodeBlock lang="text" caption="GAP" code={'gapPct = (onchain − fair) / fair × 100'} />
        <P>Every row carries a status, decided in this order:</P>
        <Fields
          head={['Status', 'Rule', 'Meaning']}
          rows={[
            ['feed-unreadable', 'fair is null', 'The Chainlink feed (or, on BNB Chain, the multiplier) could not be read.'],
            ['pool-unreadable', 'pool read failed', 'DexScreener could not be read for this chain.'],
            ['no-pool', 'onchain is null', 'No pool with a usable price was found.'],
            ['unverified', 'onchain ≥ 5× or ≤ 1/5 of fair; or |gap| ≥ 15% unless the pool holds $1,000,000+ and was read on chain this cycle', <>The figure is implausible for a tokenised stock: far more often a bad print (a misread venue, an old API reading, a decimals slip) than a price. <C>gapPct</C> is withheld (null), the figure stays in <C>rawGapPct</C>, and <C>untrustedReason</C> says why. Never flagged, ranked, alerted on or recorded in the history.</>],
            ['thin', 'liquidity < $10,000', 'The chosen pool is too small to trust. Shown, never flagged.'],
            ['in-line', '|gap| < 1%', 'Within the noise. Robinhood Chain feeds only move on a 0.5% deviation.'],
            ['drifting', '1% ≤ |gap| < 2%', 'Moving away from fair, not yet flagged.'],
            ['premium', 'gap ≥ 2%', 'Flagged: trading above fair.'],
            ['discount', 'gap ≤ −2%', 'Flagged: trading below fair.'],
          ]}
        />
        <P>
          The thresholds are returned with every response in <C>rules</C> (<C>minLiquidityUsd</C>, <C>inLinePct</C>, <C>flagPct</C>, <C>implausiblePct</C>, <C>trustLiquidityUsd</C>, <C>unitsRatio</C>), so a client never has to hard-code them.
        </P>
        <H3 id="trust">Trust and provenance</H3>
        <P>
          Every row says whether the tracker stands behind its gap. <C>trusted</C> is true only for <C>premium</C>, <C>discount</C>, <C>drifting</C> and <C>in-line</C> rows whose pool read is fresh; otherwise <C>untrustedReason</C> gives the reason in a sentence (a thin pool, an implausible figure, an unreadable source, or a pool read served from the last good one while sources back off). Top movers and gap alerts only ever use trusted rows; the five-minute history skips every row without a gap (an unverified row included) and every stale pool read.
        </P>
        <P>
          <C>onchainSource</C> says where this cycle’s onchain price came from: <C>chain</C> when the pool contract was read directly, <C>api</C> when it is the price API’s reading for a venue that cannot be re-read on chain. <C>onchainAt</C> is when that price was read, so an API reading shows its own age.
        </P>
      </Section>

      <Section id="sessions" title="Market sessions">
        <P>Stock feeds follow market hours. Each chain reports whether its session is open now:</P>
        <List>
          <li>
            <strong className="text-ink">Robinhood Chain, 24/5</strong>: Chainlink’s US equities 24/5 session, Sunday 20:00 to Friday 20:00, New York time.
          </li>
          <li>
            <strong className="text-ink">BNB Chain, NYSE hours</strong>: 09:30 to 16:00 New York time, Monday to Friday.
          </li>
        </List>
        <P>
          Outside its session a feed holds its last value, so the gap is measured against the last session’s close, not presented as a live mispricing. Market holidays are not modelled: on a holiday the session reads as open and the feed’s update time, returned as <C>feedUpdatedAt</C>, shows how old the fair price is.
        </P>
      </Section>

      <Section id="freshness" title="Refresh, staleness, history">
        <List>
          <li>The tracker reads its sources at most once every two minutes. Every visitor and every API caller share that one read.</li>
          <li>
            If the chain cannot be read and neither API answers, that chain backs off (one minute, doubling, at most 30 minutes) and keeps serving its last good pool read, marked <C>poolsStale: true</C> with its time in <C>poolsAsOf</C>, and <C>poolStale: true</C> on each row. A pool read older than six hours is dropped rather than shown. Fair prices stay live throughout.
          </li>
          <li>
            Every five minutes one snapshot per token is recorded, and kept for seven days. Rows without a gap, or with a stale pool read, are not recorded. The <DocLink to="api" hash="history">history endpoint</DocLink> serves them.
          </li>
        </List>
      </Section>

      <Section id="limits" title="Limits">
        <List>
          <li>The onchain price is one pool’s price as DexScreener reports it, not a volume-weighted average across venues.</li>
          <li>Liquidity figures are DexScreener’s, in US dollars.</li>
          <li>Only tokens in the tracker’s verified feed tables are covered; a stock token without a Chainlink feed on its chain does not appear.</li>
          <li>A gap may not be tradable: pool depth, fees, slippage and issuer rules all stand between a gap and a profit.</li>
        </List>
        <Callout label="NOT ADVICE">The tracker reports what Chainlink and the pools say, with the rules above. It is not investment advice and makes no promise about any token.</Callout>
      </Section>
    </DocPage>
  )
}
