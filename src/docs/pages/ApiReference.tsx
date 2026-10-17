import { CodeBlock } from '../CodeBlock'
import { C, Callout, DocLink, DocPage, Ext, Fields, H3, P, Section } from '../DocPage'
import { EXAMPLE_HISTORY, EXAMPLE_TRACKER, FETCHED_AT, TRACKER_ROWS_AT_FETCH } from '../examples'
import { LatencySpark, StatusRing } from '../LiveCharts'

const sections = [
  { id: 'basics', title: 'Basics' },
  { id: 'tracker', title: 'GET /api/tracker' },
  { id: 'rows', title: 'Rows' },
  { id: 'history', title: 'GET /api/tracker/history' },
  { id: 'movers', title: 'GET /api/tracker/movers' },
  { id: 'caching', title: 'Caching' },
  { id: 'rate-limits', title: 'Rate limits' },
  { id: 'errors', title: 'Errors' },
  { id: 'examples', title: 'Examples' },
]

const CURL = `curl https://gullylabs.xyz/api/tracker

# with an API key, and the rate-limit headers shown
curl -i https://gullylabs.xyz/api/tracker \\
  -H "Authorization: Bearer $GULLY_API_KEY"

# one token's gap history
curl "https://gullylabs.xyz/api/tracker/history?chain=robinhood&ticker=NVDA"

# the five biggest gap moves over the last hour, and NVDA's own 24h change
curl "https://gullylabs.xyz/api/tracker/movers?window=1h&limit=5"
curl "https://gullylabs.xyz/api/tracker/movers?window=24h&chain=robinhood&ticker=NVDA"`

const FETCH = `const res = await fetch('https://gullylabs.xyz/api/tracker')
if (res.status === 429) {
  const wait = Number(res.headers.get('Retry-After') ?? 60)
  throw new Error(\`Rate limited, retry in \${wait}s\`)
}
if (!res.ok) throw new Error(\`Tracker answered \${res.status}\`)
const tracker = await res.json()

// The widest trusted gaps: skips thin pools, unverified and unreadable prices.
const widest = tracker.rows
  .filter((r) => r.trusted && r.gapPct !== null)
  .sort((a, b) => Math.abs(b.gapPct) - Math.abs(a.gapPct))
  .slice(0, 5)`

export function ApiReference() {
  return (
    <DocPage
      slug="api"
      eyebrow="BUILD · API"
      title="API reference"
      description="The Gully Labs tracker API: GET /api/tracker, GET /api/tracker/history and GET /api/tracker/movers, every response field, caching, CORS, rate limits, API keys and errors, with a real example response."
      lead="Three read-only JSON endpoints. No key is needed to start; a key raises your rate limit."
      sections={sections}
    >
      <Section id="basics" title="Basics">
        <Fields
          head={['Item', 'Value', 'Notes']}
          rows={[
            ['Base URL', 'https://gullylabs.xyz', 'Every endpoint lives under /api/tracker.'],
            ['Methods', 'GET, OPTIONS', 'Anything else answers 405.'],
            ['Format', 'JSON', 'UTF-8. Times are ISO 8601 in UTC, except history points, which use Unix seconds.'],
            ['CORS', 'Access-Control-Allow-Origin: *', 'Call it from any browser origin. Preflight allows the Authorization and Content-Type headers.'],
            ['Auth', 'Optional', <>Send <C>Authorization: Bearer &lt;key&gt;</C> for a higher limit. See <DocLink to="api-keys">API keys</DocLink>.</>],
          ]}
        />
        <P>Prices are US dollars per token. Any price may be <C>null</C>, meaning it could not be read; it is never replaced with zero.</P>
        <P>Live, from your browser: the response time of <C>/api/tracker</C>, measured every 10 seconds while this tab is open, and the rows it returns by status.</P>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,300px),1fr))] gap-3">
          <LatencySpark path="/api/tracker" />
          <StatusRing />
        </div>
      </Section>

      <Section id="tracker" title="GET /api/tracker">
        <P>The whole tracker: every chain, the rules, the sources and one row per token.</P>
        <H3>Top level</H3>
        <Fields
          rows={[
            ['generatedAt', 'string (ISO)', 'When this answer was built.'],
            ['chains', 'Chain[]', 'One entry per chain, below.'],
            ['rules', 'object', <>The thresholds in force: <C>minLiquidityUsd</C> (pools below are “thin”), <C>inLinePct</C> (gaps below are “in line”), <C>flagPct</C> (gaps at or above are flagged), <C>implausiblePct</C> (a gap this wide needs a deep pool read on chain to be believed), <C>trustLiquidityUsd</C> (how deep that pool must be) and <C>unitsRatio</C> (an onchain price this many times fair, or this fraction of it, is a units error).</>],
            ['sources', 'object', <><C>fair</C> and <C>onchain</C> describe the two price sources; <C>tables</C> names the feed table used per chain.</>],
            ['rows', 'Row[]', <>One per token. See <DocLink to="api" hash="rows">Rows</DocLink>.</>],
          ]}
        />
        <H3>chains[]</H3>
        <Fields
          rows={[
            ['key', 'string', <>Chain key used everywhere else: <C>robinhood</C> or <C>bsc</C>.</>],
            ['id', 'number', 'EVM chain id (4663, 56).'],
            ['name', 'string', 'Display name.'],
            ['sessionOpen', 'boolean', <>Whether the chain’s feed session is open now. See <DocLink to="methodology" hash="sessions">sessions</DocLink>.</>],
            ['sessionName', 'string', <><C>24/5</C> or <C>NYSE hours</C>.</>],
            ['fairMethod', 'string', 'How fair is derived on this chain, in words.'],
            ['poolsAsOf', 'string | null', 'Time of the pool read in use.'],
            ['poolsStale', 'boolean', 'True when the pool read is the last good one, served while every price source for that chain is backing off.'],
            ['poolSource', 'string | null', 'Where pool prices came from this cycle: on chain, DexScreener or GeckoTerminal.'],
          ]}
        />
      </Section>

      <Section id="rows" title="Rows">
        <Fields
          rows={[
            ['chain', 'string', 'Chain key.'],
            ['ticker', 'string', 'Stock ticker, e.g. NVDA.'],
            ['name', 'string', 'Company name.'],
            ['token', 'string', 'Token contract address.'],
            ['feed', 'string', 'Chainlink feed address.'],
            ['fair', 'number | null', 'Fair price in USD per token.'],
            ['feedPrices', 'string', <><C>tokenized-instrument</C> (the feed prices the token) or <C>underlying-share</C> (it prices the share).</>],
            ['multiplier', 'number | null', <>Shares per token from <C>uiMultiplier()</C> on BNB Chain; 1 on Robinhood Chain; null when the feed could not be read.</>],
            ['feedUpdatedAt', 'string | null', 'When the feed last updated.'],
            ['feedError', 'string | null', 'Why the feed could not be read, if it could not.'],
            ['onchain', 'number | null', 'Price in the chosen pool, USD per token.'],
            ['gapPct', 'number | null', <>(onchain − fair) / fair × 100. Null unless both prices were read, and null on an <C>unverified</C> row (the figure is withheld; see <C>rawGapPct</C>).</>],
            ['rawGapPct', 'number | null', <>The same gap before the plausibility check. Equal to <C>gapPct</C> on every row except an <C>unverified</C> one, where it keeps the figure that was withheld. Never chart, rank or alert on it.</>],
            ['status', 'string', <>One of <C>premium</C>, <C>discount</C>, <C>drifting</C>, <C>in-line</C>, <C>thin</C>, <C>unverified</C>, <C>no-pool</C>, <C>pool-unreadable</C>, <C>feed-unreadable</C>. Rules in the <DocLink to="methodology" hash="gap">methodology</DocLink>.</>],
            ['trusted', 'boolean', <>Whether the tracker stands behind this row’s gap: true only for <C>premium</C>, <C>discount</C>, <C>drifting</C> and <C>in-line</C> rows whose pool read is fresh (not <C>poolStale</C>). Top movers and gap alerts use trusted rows only.</>],
            ['untrustedReason', 'string | null', <>Why <C>trusted</C> is false, in a sentence, e.g. <C>The pool holds $4,210, under the $10,000 needed to flag a gap.</C> Null on a trusted row.</>],
            ['onchainSource', 'string | null', <><C>chain</C> when this cycle’s onchain price was read from the pool contract itself, <C>api</C> when it is DexScreener’s or GeckoTerminal’s reading (a venue the tracker cannot re-read on chain). Null when there is no onchain price.</>],
            ['onchainAt', 'string | null', <>When that onchain price was read (ISO). For <C>api</C> prices this can be older than <C>generatedAt</C>. Null when there is no onchain price.</>],
            ['pool', 'Pool | null', 'The pool used, below.'],
            ['poolError', 'string | null', 'Why pools could not be read, if they could not.'],
            ['logo', 'string | null', 'The stock’s logo: the token’s own where it carries the company mark, else the company’s own site icon. An absolute URL on gullylabs.xyz.'],
            ['chainLogo', 'string | null', 'The chain’s logo, an absolute URL on gullylabs.xyz.'],
            ['poolStale', 'boolean', 'True when the pool figures are the last good read rather than a fresh one.'],
          ]}
        />
        <H3>pool</H3>
        <Fields
          rows={[
            ['dex', 'string', 'The venue’s id, as DexScreener or GeckoTerminal names it.'],
            ['labels', 'string[]', 'Venue labels, e.g. v3.'],
            ['against', 'string', 'Symbol of the other token in the pool.'],
            ['url', 'string', 'The pool on DexScreener or GeckoTerminal.'],
            ['pair', 'string', 'Pool address.'],
            ['liquidityUsd', 'number', 'Liquidity of this pool.'],
            ['volume24hUsd', 'number', '24-hour volume of this pool.'],
            ['pools', 'number', 'How many pools with a price were found for the token.'],
            ['totalLiquidityUsd', 'number', 'Liquidity summed over those pools.'],
            ['totalVolume24hUsd', 'number', '24-hour volume summed over those pools.'],
          ]}
        />
      </Section>

      <Section id="history" title="GET /api/tracker/history">
        <P>One token’s gap history: a snapshot every five minutes. Seven days are open to everyone; paid plans keep more (see <DocLink to="plans-alerts">Plans &amp; alerts</DocLink>).</P>
        <Fields
          head={['Parameter', 'Type', 'Meaning']}
          rows={[
            ['chain', 'string', <>Chain key, default <C>robinhood</C>. 2 to 12 lowercase letters.</>],
            ['ticker', 'string, required', '1 to 8 letters or dots; case does not matter.'],
            ['days', 'integer, optional', <>Window in days, from 1 up to what your plan includes. Without it you get the last seven days, as before. Over your plan’s limit answers <C>403</C>; past seven days the answer adds <C>days</C> and is not cached publicly.</>],
          ]}
        />
        <P>
          The answer is <C>{'{ chain, ticker, points }'}</C>, where each point is a tuple <C>[unixSeconds, gapPct, onchain, fair]</C>, oldest first. A chain or ticker the tracker does not know returns an empty <C>points</C> array, not an error.
        </P>
        <CodeBlock lang="json" caption={`EXAMPLE · REAL RESPONSE, ${FETCHED_AT}`} code={EXAMPLE_HISTORY} />
      </Section>

      <Section id="movers" title="GET /api/tracker/movers">
        <P>
          Top movers: how each token’s gap to fair, and its onchain price, changed over the last hour or day, computed from the same five-minute snapshots as the history. For every token the latest snapshot is compared with the snapshot closest to one window earlier. Only tokens whose status is trusted right now (<C>premium</C>, <C>discount</C>, <C>drifting</C> or <C>in-line</C>) and that have both points are ranked; nothing is interpolated.
        </P>
        <Fields
          head={['Parameter', 'Type', 'Meaning']}
          rows={[
            ['window', 'string, optional', <><C>24h</C> (default) or <C>1h</C>.</>],
            ['limit', 'integer, optional', <>How many rows per ranking, 1 to 50, default 10.</>],
            ['chain', 'string, optional', <>Rank one chain only, e.g. <C>bsc</C>.</>],
            ['ticker', 'string, optional', <>With <C>chain</C>: also return that token’s own change in <C>stock</C> (null when it has none).</>],
          ]}
        />
        <H3>Top level</H3>
        <Fields
          rows={[
            ['window', 'string', <><C>1h</C> or <C>24h</C>.</>],
            ['windowSeconds', 'number', '3600 or 86400.'],
            ['toleranceSeconds', 'number', 'How far the earlier snapshot may sit from exactly one window ago: 15 minutes for 1h, 2 hours for 24h. Further than that and the token is left out.'],
            ['asOf', 'string | null', 'The newest snapshot compared. Null when nothing could be compared.'],
            ['from, to', 'string | null', <>The comparison times: <C>to</C> is <C>asOf</C>, <C>from</C> one window earlier. Each row carries its own exact pair.</>],
            ['eligible', 'number', 'Tokens with both points and a trusted status.'],
            ['left', 'object', <>Why the others are out: <C>untrusted</C>, <C>noHistory</C>, <C>staleHistory</C> (latest snapshot over 30 minutes old), <C>tooShort</C>.</>],
            ['historyHours', 'number', 'How many hours the longest series covers.'],
            ['note', 'string | null', <>Set when nothing could be ranked, e.g. <C>Needs 24h of snapshots: the longest series so far covers 6.5 h.</C></>],
            ['byGap', 'Mover[]', 'Largest absolute gap change first.'],
            ['byPrice', 'Mover[]', 'Largest absolute onchain price change first.'],
            ['stock', 'Mover | null', <>Only with <C>chain</C> and <C>ticker</C>.</>],
          ]}
        />
        <H3>Mover</H3>
        <Fields
          rows={[
            ['chain, ticker, name, token', 'string', 'As in the tracker rows.'],
            ['status, gapPct, onchain, fair', 'see Rows', 'The token’s current status and prices, as in /api/tracker.'],
            ['liquidityUsd', 'number | null', 'Liquidity of the pool its price comes from.'],
            ['gapThen, gapNow', 'number', 'Gap % in the earlier and the latest snapshot.'],
            ['gapChangePp', 'number', 'gapNow − gapThen, in percentage points.'],
            ['onchainThen, onchainNow', 'number', 'Onchain price in the two snapshots.'],
            ['priceChangePct', 'number | null', 'Onchain price change in %.'],
            ['from, to', 'string', 'Times of the two snapshots compared.'],
            ['spark', '[unixSeconds, gapPct][]', 'The gap over the window, at most 48 points, for a sparkline.'],
          ]}
        />
      </Section>

      <Section id="caching" title="Caching">
        <Fields
          head={['Endpoint', 'Cache-Control', 'Notes']}
          rows={[
            ['/api/tracker', 'public, max-age=30, s-maxage=60, stale-while-revalidate=300', 'The data itself refreshes about every two minutes.'],
            ['/api/tracker/history', 'public, max-age=60, s-maxage=120, stale-while-revalidate=600', 'A new point is added every five minutes.'],
            ['/api/tracker/movers', 'public, max-age=30, s-maxage=60, stale-while-revalidate=300', 'Computed at most once a minute per window. Counted by the same rate limit.'],
          ]}
        />
        <P>Answers are cacheable at the edge, so polling more than once a minute gains nothing. A sensible client polls every one to two minutes and keeps its last good answer when a request fails.</P>
      </Section>

      <Section id="rate-limits" title="Rate limits">
        <P>
          Anonymous requests are limited to <b>60 a minute per IP address</b>. Requests that carry an API key in <C>Authorization: Bearer &lt;key&gt;</C> are counted against the key instead, at <b>600 a minute</b>. Windows are fixed one-minute windows. An unknown or revoked key answers <C>401</C>. Every response also states the limit in force, so a client can read it rather than hard-code it:
        </P>
        <Fields
          head={['Header', 'On', 'Meaning']}
          rows={[
            ['X-RateLimit-Limit', 'success', 'Requests allowed per minute: 60 anonymous, 600 with a Free key, more on a paid plan.'],
            ['X-RateLimit-Remaining', 'success', 'Requests left in it.'],
            ['Retry-After', '429', 'Seconds to wait before trying again.'],
          ]}
        />
        <P>
          Need more? <DocLink to="api-keys">Get a free key</DocLink>, instantly. A key on a paid plan gets that plan’s higher limit; see <DocLink to="plans-alerts">Plans &amp; alerts</DocLink>.
        </P>
      </Section>

      <Section id="errors" title="Errors">
        <P>
          Errors are JSON with a single <C>error</C> string.
        </P>
        <Fields
          head={['Status', 'When', 'What to do']}
          rows={[
            ['400', 'history: chain or ticker malformed', <>Check the parameters. Body: <C>{'{"error":"chain and ticker"}'}</C>.</>],
            ['400', 'movers: window, limit, chain or ticker malformed', <>Use <C>window=1h</C> or <C>24h</C>, a <C>limit</C> from 1 to 50, and a <C>ticker</C> only with a <C>chain</C>.</>],
            ['405', 'a method other than GET or OPTIONS', 'Use GET.'],
            ['401', 'unknown or revoked API key', 'Check the key, or request one at developers.gullylabs.xyz.'],
            ['403', 'history: days beyond what your plan includes',<>Ask for fewer days, or move to a plan with more history. The body names your limit in <C>historyDays</C>.</>],
            ['429', 'rate limit exceeded', 'Wait for Retry-After seconds, or use an API key.'],
            ['502', 'the tracker could not be built at all', 'Retry in a minute. A partial failure is not a 502: it shows as unreadable rows.'],
          ]}
        />
      </Section>

      <Section id="examples" title="Examples">
        <CodeBlock lang="bash" code={CURL} />
        <CodeBlock lang="js" code={FETCH} />
        <H3 id="example-response">Example response</H3>
        <P>
          A real answer from <Ext href="https://gullylabs.xyz/api/tracker">/api/tracker</Ext>, fetched {FETCHED_AT}, trimmed from {TRACKER_ROWS_AT_FETCH} rows to two (one per chain). Your answer will differ: it is live.
        </P>
        <CodeBlock lang="json" caption={`EXAMPLE · REAL RESPONSE, TRIMMED, ${FETCHED_AT}`} code={EXAMPLE_TRACKER} />
        <Callout label="NOT ADVICE" tone="plain">
          The API reports what Chainlink and the pools say. It is not investment advice.
        </Callout>
      </Section>
    </DocPage>
  )
}
