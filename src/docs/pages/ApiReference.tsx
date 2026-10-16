import { CodeBlock } from '../CodeBlock'
import { C, Callout, DocLink, DocPage, Ext, Fields, H3, P, Section } from '../DocPage'
import { EXAMPLE_HISTORY, EXAMPLE_TRACKER, FETCHED_AT, TRACKER_ROWS_AT_FETCH } from '../examples'

const sections = [
  { id: 'basics', title: 'Basics' },
  { id: 'tracker', title: 'GET /api/tracker' },
  { id: 'rows', title: 'Rows' },
  { id: 'history', title: 'GET /api/tracker/history' },
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
curl "https://gullylabs.xyz/api/tracker/history?chain=robinhood&ticker=NVDA"`

const FETCH = `const res = await fetch('https://gullylabs.xyz/api/tracker')
if (res.status === 429) {
  const wait = Number(res.headers.get('Retry-After') ?? 60)
  throw new Error(\`Rate limited, retry in \${wait}s\`)
}
if (!res.ok) throw new Error(\`Tracker answered \${res.status}\`)
const tracker = await res.json()

// The widest trusted gaps: skip thin pools and unreadable prices.
const widest = tracker.rows
  .filter((r) => r.gapPct !== null && r.status !== 'thin')
  .sort((a, b) => Math.abs(b.gapPct) - Math.abs(a.gapPct))
  .slice(0, 5)`

export function ApiReference() {
  return (
    <DocPage
      slug="api"
      eyebrow="BUILD · API"
      title="API reference"
      description="The Gully Labs tracker API: GET /api/tracker and GET /api/tracker/history, every response field, caching, CORS, rate limits, API keys and errors, with a real example response."
      lead="Two read-only JSON endpoints. No key is needed to start; a key raises your rate limit."
      sections={sections}
    >
      <Section id="basics" title="Basics">
        <Fields
          head={['Item', 'Value', 'Notes']}
          rows={[
            ['Base URL', 'https://gullylabs.xyz', 'Both endpoints live under /api/tracker.'],
            ['Methods', 'GET, OPTIONS', 'Anything else answers 405.'],
            ['Format', 'JSON', 'UTF-8. Times are ISO 8601 in UTC, except history points, which use Unix seconds.'],
            ['CORS', 'Access-Control-Allow-Origin: *', 'Call it from any browser origin. Preflight allows the Authorization and Content-Type headers.'],
            ['Auth', 'Optional', <>Send <C>Authorization: Bearer &lt;key&gt;</C> for a higher limit. See <DocLink to="api-keys">API keys</DocLink>.</>],
          ]}
        />
        <P>Prices are US dollars per token. Any price may be <C>null</C>, meaning it could not be read; it is never replaced with zero.</P>
      </Section>

      <Section id="tracker" title="GET /api/tracker">
        <P>The whole tracker: every chain, the rules, the sources and one row per token.</P>
        <H3>Top level</H3>
        <Fields
          rows={[
            ['generatedAt', 'string (ISO)', 'When this answer was built.'],
            ['chains', 'Chain[]', 'One entry per chain, below.'],
            ['rules', 'object', <>The thresholds in force: <C>minLiquidityUsd</C> (pools below are “thin”), <C>inLinePct</C> (gaps below are “in line”), <C>flagPct</C> (gaps at or above are flagged).</>],
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
            ['gapPct', 'number | null', '(onchain − fair) / fair × 100. Null unless both prices were read.'],
            ['status', 'string', <>One of <C>premium</C>, <C>discount</C>, <C>drifting</C>, <C>in-line</C>, <C>thin</C>, <C>no-pool</C>, <C>pool-unreadable</C>, <C>feed-unreadable</C>. Rules in the <DocLink to="methodology" hash="gap">methodology</DocLink>.</>],
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
        <P>One token’s gap history: a snapshot every five minutes, kept for seven days.</P>
        <Fields
          head={['Parameter', 'Type', 'Meaning']}
          rows={[
            ['chain', 'string', <>Chain key, default <C>robinhood</C>. 2 to 12 lowercase letters.</>],
            ['ticker', 'string, required', '1 to 8 letters or dots; case does not matter.'],
          ]}
        />
        <P>
          The answer is <C>{'{ chain, ticker, points }'}</C>, where each point is a tuple <C>[unixSeconds, gapPct, onchain, fair]</C>, oldest first. A chain or ticker the tracker does not know returns an empty <C>points</C> array, not an error.
        </P>
        <CodeBlock lang="json" caption={`EXAMPLE · REAL RESPONSE, ${FETCHED_AT}`} code={EXAMPLE_HISTORY} />
      </Section>

      <Section id="caching" title="Caching">
        <Fields
          head={['Endpoint', 'Cache-Control', 'Notes']}
          rows={[
            ['/api/tracker', 'public, max-age=30, s-maxage=60, stale-while-revalidate=300', 'The data itself refreshes about every two minutes.'],
            ['/api/tracker/history', 'public, max-age=60, s-maxage=120, stale-while-revalidate=600', 'A new point is added every five minutes.'],
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
            ['X-RateLimit-Limit', 'success', 'Requests allowed per minute: 60 anonymous, 600 with a key.'],
            ['X-RateLimit-Remaining', 'success', 'Requests left in it.'],
            ['Retry-After', '429', 'Seconds to wait before trying again.'],
          ]}
        />
        <P>
          Need more? <DocLink to="api-keys">Get a free key</DocLink>, instantly.
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
            ['405', 'a method other than GET or OPTIONS', 'Use GET.'],
            ['401', 'unknown or revoked API key', 'Check the key, or request one at developers.gullylabs.xyz.'],
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
