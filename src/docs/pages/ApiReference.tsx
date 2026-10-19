import { CodeBlock } from '../CodeBlock'
import { C, Callout, Details, DocLink, DocPage, Ext, Fields, H3, List, P, Section } from '../DocPage'
import { EXAMPLE_HISTORY, EXAMPLE_TRACKER, FETCHED_AT, TRACKER_ROWS_AT_FETCH } from '../examples'
import { GapIndexChart, LatencySpark, StatusRing } from '../LiveCharts'

const sections = [
  { id: 'basics', title: 'Basics' },
  { id: 'tracker', title: 'GET /api/tracker' },
  { id: 'rows', title: 'Rows' },
  { id: 'history', title: 'GET /api/tracker/history' },
  { id: 'movers', title: 'GET /api/tracker/movers' },
  { id: 'gap-index', title: 'GET /api/tracker/gap-index' },
  { id: 'holders', title: 'Holder Map' },
  { id: 'score', title: 'Gully Score' },
  { id: 'security', title: 'Gully Security' },
  { id: 'stats', title: 'GET /api/stats' },
  { id: 'status', title: 'GET /api/status' },
  { id: 'geo', title: 'GET /api/geo' },
  { id: 'deepcore', title: 'DeepCore' },
  { id: 'solana', title: 'Solana' },
  { id: 'ask', title: 'Gully AI' },
  { id: 'plans', title: 'Plans and alert channels' },
  { id: 'pay', title: 'Gully Pay' },
  { id: 'healthz', title: 'GET /healthz' },
  { id: 'caching', title: 'Caching' },
  { id: 'rate-limits', title: 'Rate limits' },
  { id: 'errors', title: 'Errors' },
  { id: 'examples', title: 'Examples' },
]

const CURL = `curl https://api.gullylabs.xyz/api/tracker

# with an API key, and the rate-limit headers shown
curl -i https://api.gullylabs.xyz/api/tracker \\
  -H "Authorization: Bearer $GULLY_API_KEY"

# one token's gap history
curl "https://api.gullylabs.xyz/api/tracker/history?chain=robinhood&ticker=NVDA"

# the five biggest gap moves over the last hour, and NVDA's own 24h change
curl "https://api.gullylabs.xyz/api/tracker/movers?window=1h&limit=5"
curl "https://api.gullylabs.xyz/api/tracker/movers?window=24h&chain=robinhood&ticker=NVDA"`

const FETCH = `const res = await fetch('https://api.gullylabs.xyz/api/tracker')
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
      description="Every public Gully Labs endpoint: the tracker (rows, history, movers, gap index), Holder Map, Gully Score, Gully Security, stats, status, geo, DeepCore, Solana and Jupiter, Gully AI, plans and Gully Pay, with response fields, caching, CORS, rate limits and errors."
      lead="Read-only JSON for the tracker, the Holder Map, Gully Score and more, plus the routes our own checkout and AI pages call. No key is needed to start; a key raises the tracker’s rate limit."
      sections={sections}
    >
      <Section id="basics" title="Basics">
        <Fields
          head={['Item', 'Value', 'Notes']}
          rows={[
            ['Base URL', 'https://api.gullylabs.xyz', <>Every endpoint lives under /api, except /healthz and the Score badge. The same paths still answer on <C>https://gullylabs.xyz</C> (no redirect, POSTs included) with a <C>Link: &lt;https://api.gullylabs.xyz/api/…&gt;; rel=&quot;canonical&quot;</C> header, so moving is a change of host only.</>],
            ['Methods', 'GET, OPTIONS', <>The data endpoints are read-only; anything else answers <C>405</C>. The few POST routes (checkout, Gully AI, review requests, Solana) are listed with their section.</>],
            ['Format', 'JSON', 'UTF-8. Times are ISO 8601 in UTC, except history points (Unix seconds) and gap-index points (Unix milliseconds).'],
            ['CORS', 'Access-Control-Allow-Origin: *', <>On <C>/api/tracker*</C>, <C>/api/holders/*</C>, <C>/api/score*</C>, <C>/api/status</C>, <C>/api/plans</C>, <C>/api/alerts/channels</C> and the Security list and stats: call them from any browser origin. The routes behind our own pages (stats, geo, DeepCore, Solana, Gully AI, Gully Pay) send no CORS header.</>],
            ['Auth', 'Optional', <>Send <C>Authorization: Bearer &lt;key&gt;</C> on the tracker and Holder Map for a higher limit. See <DocLink to="api-keys">API keys</DocLink>.</>],
            ['Not found', '404 {"error":"not found"}', <>Any unknown <C>/api/…</C> path answers JSON, never the HTML page.</>],
          ]}
        />
        <P>Prices are US dollars per token. Any price may be empty, meaning it could not be read; it is never replaced with zero.</P>
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
            ['poolsAsOf', 'string, or empty', 'Time of the pool read in use.'],
            ['poolsStale', 'boolean', 'True when the pool read is the last good one, served while every price source for that chain is backing off.'],
            ['poolSource', 'string, or empty', 'Where pool prices came from this cycle: on chain, DexScreener or GeckoTerminal.'],
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
            ['fair', 'number, or empty', 'Fair price in USD per token.'],
            ['feedPrices', 'string', <><C>tokenized-instrument</C> (the feed prices the token) or <C>underlying-share</C> (it prices the share).</>],
            ['multiplier', 'number, or empty', <>Shares per token from <C>uiMultiplier()</C> on BNB Chain; 1 on Robinhood Chain; empty when the feed could not be read.</>],
            ['feedUpdatedAt', 'string, or empty', 'When the feed last updated.'],
            ['feedError', 'string, or empty', 'Why the feed could not be read, if it could not.'],
            ['onchain', 'number, or empty', 'Price in the chosen pool, USD per token.'],
            ['gapPct', 'number, or empty', <>(onchain − fair) / fair × 100. Empty unless both prices were read, and empty on an <C>unverified</C> row (the figure is withheld; see <C>rawGapPct</C>).</>],
            ['rawGapPct', 'number, or empty', <>The same gap before the plausibility check. Equal to <C>gapPct</C> on every row except an <C>unverified</C> one, where it keeps the figure that was withheld. Never chart, rank or alert on it.</>],
            ['status', 'string', <>One of <C>premium</C>, <C>discount</C>, <C>drifting</C>, <C>in-line</C>, <C>thin</C>, <C>unverified</C>, <C>no-pool</C>, <C>pool-unreadable</C>, <C>feed-unreadable</C>. Rules in the <DocLink to="methodology" hash="gap">methodology</DocLink>.</>],
            ['trusted', 'boolean', <>Whether the tracker stands behind this row’s gap: true only for <C>premium</C>, <C>discount</C>, <C>drifting</C> and <C>in-line</C> rows whose pool read is fresh (not <C>poolStale</C>). Top movers and gap alerts use trusted rows only.</>],
            ['untrustedReason', 'string, or empty', <>Why <C>trusted</C> is false, in a sentence, e.g. <C>The pool holds $4,210, under the $10,000 needed to flag a gap.</C> Empty on a trusted row.</>],
            ['onchainSource', 'string, or empty', <><C>chain</C> when this cycle’s onchain price was read from the pool contract itself, <C>api</C> when it is DexScreener’s or GeckoTerminal’s reading (a venue the tracker cannot re-read on chain). Empty when there is no onchain price.</>],
            ['onchainAt', 'string, or empty', <>When that onchain price was read (ISO). For <C>api</C> prices this can be older than <C>generatedAt</C>. Empty when there is no onchain price.</>],
            ['pool', 'Pool, or empty', 'The pool used, below.'],
            ['poolError', 'string, or empty', 'Why pools could not be read, if they could not.'],
            ['logo', 'string, or empty', 'The stock’s logo: the token’s own where it carries the company mark, else the company’s own site icon. An absolute URL on gullylabs.xyz.'],
            ['chainLogo', 'string, or empty', 'The chain’s logo, an absolute URL on gullylabs.xyz.'],
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
        <Details summary="Example response">
          <CodeBlock lang="json" caption={`EXAMPLE · REAL RESPONSE, ${FETCHED_AT}`} code={EXAMPLE_HISTORY} />
        </Details>
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
            ['ticker', 'string, optional', <>With <C>chain</C>: also return that token’s own change in <C>stock</C> (empty when it has none).</>],
          ]}
        />
        <H3>Top level</H3>
        <Fields
          rows={[
            ['window', 'string', <><C>1h</C> or <C>24h</C>.</>],
            ['windowSeconds', 'number', '3600 or 86400.'],
            ['toleranceSeconds', 'number', 'How far the earlier snapshot may sit from exactly one window ago: 15 minutes for 1h, 2 hours for 24h. Further than that and the token is left out.'],
            ['asOf', 'string, or empty', 'The newest snapshot compared. Empty when nothing could be compared.'],
            ['from, to', 'string, or empty', <>The comparison times: <C>to</C> is <C>asOf</C>, <C>from</C> one window earlier. Each row carries its own exact pair.</>],
            ['eligible', 'number', 'Tokens with both points and a trusted status.'],
            ['left', 'object', <>Why the others are out: <C>untrusted</C>, <C>noHistory</C>, <C>staleHistory</C> (latest snapshot over 30 minutes old), <C>tooShort</C>.</>],
            ['historyHours', 'number', 'How many hours the longest series covers.'],
            ['note', 'string, or empty', <>Set when nothing could be ranked, e.g. <C>Needs 24h of snapshots: the longest series so far covers 6.5 h.</C></>],
            ['byGap', 'Mover[]', 'Largest absolute gap change first.'],
            ['byPrice', 'Mover[]', 'Largest absolute onchain price change first.'],
            ['stock', 'Mover, or empty', <>Only with <C>chain</C> and <C>ticker</C>.</>],
          ]}
        />
        <H3>Mover</H3>
        <Fields
          rows={[
            ['chain, ticker, name, token', 'string', 'As in the tracker rows.'],
            ['status, gapPct, onchain, fair', 'see Rows', 'The token’s current status and prices, as in /api/tracker.'],
            ['liquidityUsd', 'number, or empty', 'Liquidity of the pool its price comes from.'],
            ['gapThen, gapNow', 'number', 'Gap % in the earlier and the latest snapshot.'],
            ['gapChangePp', 'number', 'gapNow − gapThen, in percentage points.'],
            ['onchainThen, onchainNow', 'number', 'Onchain price in the two snapshots.'],
            ['priceChangePct', 'number, or empty', 'Onchain price change in %.'],
            ['from, to', 'string', 'Times of the two snapshots compared.'],
            ['spark', '[unixSeconds, gapPct][]', 'The gap over the window, at most 48 points, for a sparkline.'],
          ]}
        />
      </Section>

      <Section id="gap-index" title="GET /api/tracker/gap-index">
        <P>
          One number for the whole market over the last day: the average absolute gap of the widest series, in 30-minute buckets. The series are the eight with the largest absolute latest gap whose latest point is under an hour old. Same gate, CORS and rate limit as <C>/api/tracker</C>; no parameters.
        </P>
        <Fields
          rows={[
            ['top', 'number', 'How many series are averaged (8).'],
            ['tokens', 'string[]', <>The series used, as <C>chain:TICKER</C>.</>],
            ['bucketMinutes', 'number', '30.'],
            ['points', '[ms, avgAbsGapPct][]', 'Oldest first, 24 hours. Time in Unix milliseconds; the average to 3 decimals.'],
            ['generatedAt', 'string (ISO)', 'When it was computed (at most once a minute).'],
          ]}
        />
        <GapIndexChart />
      </Section>

      <Section id="holders" title="Holder Map: /api/holders">
        <P>
          The Holder Map: who holds a DeepCore launch or a tracked stock token, which of the biggest wallets sent tokens to each other (clusters), what known addresses they are, and a plain-English summary. Every path below passes the same gate as the tracker: CORS <C>*</C>, an optional key, and the same per-minute limit (a holder request counts against the tracker’s budget). <C>:chain</C> is <C>robinhood</C>, <C>bsc</C>, <C>base</C>, <C>hyperevm</C> or <C>solana</C> (or the numeric chain id); <C>:token</C> is the token address, a Solana mint, or a tracked stock’s ticker.
        </P>
        <Fields
          head={['Path', 'Answers', 'Cache-Control']}
          variant="routes"
          rows={[
            ['GET /api/holders/launches', <>The newest DeepCore launches on holder chains (12): <C>{'{ state, asOf, launches[] }'}</C>, each with <C>chainKey</C>, <C>chainName</C>, <C>token</C>, <C>symbol</C>, <C>createdAt</C>, <C>path</C>, <C>state</C> (<C>checked</C>, <C>unavailable</C>, or <C>checking</C> while its map is built), <C>health</C> (<C>score</C> 0–100 or empty, <C>level</C>, <C>verdict</C>) and <C>riskLine</C>.</>, 'public, max-age=15'],
            ['GET /api/holders/top?limit=', <>The most scanned maps today (UTC): <C>{'{ day, items[] }'}</C>, each <C>chain</C>, <C>token</C>, <C>symbol</C>, <C>kind</C>, <C>scans</C> (unique visitors), <C>path</C>. <C>limit</C> 1–20, default 10.</>, 'public, max-age=60'],
            ['GET /api/holders/resolve?q=', <>Search: a ticker, a launch symbol, an EVM address or a Solana mint (64 characters at most, a leading <C>$</C> ignored). <C>{'{ matches[] }'}</C>, each <C>chain</C>, <C>chainName</C>, <C>token</C>, <C>symbol</C>, <C>name</C>, <C>kind</C>, <C>path</C>. Anything else matches nothing.</>, 'public, max-age=60'],
            ['GET /api/holders/:chain/:token', <>The map, below.</>, <>public, max-age=60 when <C>state</C> is ok; no-store otherwise</>],
            ['GET /api/holders/:chain/:token.csv', <>The holder list: <C>rank,address,label,balance,percent_of_supply,cluster,flags</C> (<C>percent_of_listed</C> when the supply is unknown). UTF-8, as a download.</>, 'private, no-store'],
            ['GET /api/holders/:chain/:token/card.png', 'A 1200 × 630 share card of the map. Free for everyone.', 'public, max-age=300'],
            ['GET /api/holders/:chain/:token/live?since=', <>Transfers since block <C>since</C> (default: the map’s cursor): <C>{'{ state, since, cursor, transfers[] (from, to, pct, block, at), pcts, asOf, note }'}</C>, 200 at most. <C>state: unsupported</C> on Solana. EVM only.</>, 'no-store (10 s server cache)'],
            ['GET /api/holders/:chain/:token/wallet/:address', <>One wallet on a DeepCore launch: <C>firstBuy</C>, <C>buys</C>, <C>sells</C>, <C>entryPrice</C>, <C>priceNow</C>, <C>pnlPct</C>, <C>otherLaunches</C>. <C>state: unsupported</C> on Solana.</>, 'public, max-age=60'],
          ]}
        />
        <H3>The map</H3>
        <Fields
          rows={[
            ['state', 'string', <><C>ok</C>, <C>not-found</C> (404: the token is neither a DeepCore launch nor a tracked stock), <C>unavailable</C> (200, with <C>reason</C> and <C>needs</C>: the chain’s holder source is not set up on this server), <C>error</C> (502) or <C>busy</C> (429 or 503).</>],
            ['kind', 'string', <><C>deepcore-launch</C> or <C>stock</C>.</>],
            ['chain, token', 'object', <>Chain <C>key</C>, <C>id</C>, <C>name</C>; token <C>address</C>, <C>symbol</C>, <C>name</C>, <C>decimals</C>, <C>supply</C> (empty when unknown) and explorer <C>url</C>.</>],
            ['holders', 'object', <><C>count</C> (empty when unknown), <C>shown</C>, <C>graph</C>, <C>sharesOf</C> (<C>total supply</C> or <C>listed holders</C>), <C>partial</C>.</>],
            ['nodes', 'Node[]', <>Ranked wallets: <C>id</C>, <C>rank</C>, <C>balance</C>, <C>pct</C>, <C>label</C> (<C>kind</C>: deployer, pool, lock, burn, token, deepcore, router, gully, exchange, known), <C>contract</C>, <C>cluster</C>, <C>flags</C> (sniper, bundled, funded-by-deployer, deployer), <C>url</C>; stocks add <C>valueAtFairUsd</C>, <C>premiumUsd</C>, <C>boughtGapPct</C>.</>],
            ['links, clusters, hidden', 'array', <>Transfers and funding between mapped wallets; clusters (<C>id</C>, <C>wallets</C>, <C>count</C>, <C>pct</C>, <C>hasDeployer</C>), largest first; wallets outside the map that connect two groups.</>],
            ['summary', 'object', <><C>top10Pct</C>, <C>largestCluster</C>, <C>line</C>, <C>plain</C> (sentences).</>],
            ['forensics', 'object, or empty', <>Launches only: bundled buyers, snipers, deployer share and funding, liquidity lock, <C>riskLine</C>.</>],
            ['health', 'object', <>Launches only: <C>score</C>, <C>level</C>, <C>verdict</C>, <C>counted</C>, and <C>parts[]</C> with <C>weight</C>, <C>points</C> (empty when not known), <C>value</C>, <C>reason</C>.</>],
            ['fair', 'object, or empty', <>Stocks only: <C>fair</C>, <C>onchain</C>, <C>gapPct</C>, the top 10’s value at fair and premium.</>],
            ['timeline', 'object, or empty', 'Replay frames (24 at most) on the Pro tier.'],
            ['deployerHistory, crossToken', 'object, or empty', 'The deployer’s earlier launches and their outcome; the largest cluster’s wallets in other launches.'],
            ['features, tier, locked', 'object', <>What this caller’s plan includes (<C>holders</C>, <C>replay</C>, <C>csv</C>, <C>alerts</C>, <C>liveMinutes</C>, <C>gated</C>). Gating is off today, so everyone gets the Pro features.</>],
            ['sources, asOf', 'object, string', 'Where each part was read, and when.'],
          ]}
        />
        <P>
          Maps are cached for at least five minutes; a cached answer costs nothing to build. Each address may start 12 new maps a minute (then <C>429</C>, <C>state: busy</C>), and at most three build at once (then <C>503</C>, or the last copy with <C>stale: true</C>). Shares are of the total supply, or of the listed holders when the supply could not be read. A figure that could not be read is left out, never estimated. More in <DocLink to="holder-map">Holder Map</DocLink>.
        </P>
      </Section>

      <Section id="score" title="Gully Score: /api/score">
        <P>
          A 0–100 score for a contract, from nine checks you can read one by one. No key, no tracker limit; CORS <C>*</C> on every answer. Chains: <C>base</C>, <C>ethereum</C>, <C>bnb</C>, <C>arbitrum</C>, <C>optimism</C>, <C>polygon</C>, <C>avalanche</C> (or the chain id). How it is worked out: <DocLink to="gully-score">Gully Score</DocLink>.
        </P>
        <Fields
          head={['Path', 'Answers', 'Cache-Control']}
          variant="routes"
          rows={[
            ['GET /api/score', <>The public index: <C>{'{ scores[], chains[], methodology }'}</C>. Each score: <C>chainId</C>, <C>chainKey</C>, <C>address</C>, <C>name</C>, <C>symbol</C>, <C>score</C>, <C>grade</C>, <C>coverage</C>, <C>computedAt</C>, <C>change</C>. Listed contracts only, best first.</>, 'public, max-age=60'],
            ['GET /api/score/methodology', <><C>{'{ version, minCoverage, ttlHours, components[], rules[] }'}</C>: each component’s <C>id</C>, <C>label</C>, <C>weight</C>, <C>source</C> and <C>what</C>.</>, 'public, max-age=300'],
            ['GET /api/score/:chain/:address', <>One contract: <C>score</C> (empty under 40% coverage), <C>grade</C> (Strong, Fair, Weak, Poor), <C>coverage</C>, <C>components[]</C> (each <C>available</C>, <C>score</C>, <C>value</C>, <C>reason</C>, <C>evidence</C>), <C>history</C>, <C>changes</C>, <C>links</C> (page, badge, explorer), <C>stale</C>.</>, 'public, max-age=60'],
            ['GET /score/:chain/:address/badge.svg', 'An embeddable 232 × 48 badge from the stored score; it never computes one. Letters-only chain keys.', 'public, max-age=3600'],
          ]}
        />
        <P>
          A stored score younger than six hours is returned as is. Otherwise it is computed, at most six times a minute per address and four at once; when that limit is hit, or the chain cannot be read, the stored copy comes back with <C>stale: true</C>, or <C>429</C> / <C>502</C> when there is none. An unknown chain is <C>404</C>, the zero address <C>400</C>, an address with no code <C>404</C>.
        </P>
      </Section>

      <Section id="security" title="Gully Security: /api/security">
        <P>
          Published security reports and the scan counter. Reads are limited to 600 an hour per address (<C>429</C>); every method but GET answers <C>405</C> except the one POST below. More in <DocLink to="gully-security">Gully Security</DocLink>.
        </P>
        <Fields
          head={['Path', 'Answers', 'Headers']}
          variant="routes"
          rows={[
            ['GET /api/security/reports', <><C>{'{ reports[] }'}</C>: up to 200 published reports, newest first, each <C>id</C>, <C>title</C>, <C>input</C>, <C>completedAt</C>, <C>publishedAt</C>, <C>counts</C> (critical, high, medium, low, info), <C>mode</C>, <C>label</C>, <C>url</C>.</>, 'public, max-age=30; CORS *'],
            ['GET /api/security/stats', <><C>{'{ generatedAt, totals, days[] }'}</C>: scans started, done, failed and published, and 30 UTC days of counts, oldest first.</>, 'public, max-age=30; CORS *'],
            ['GET /api/security/reports/:id', <>One published report: <C>{'{ report }'}</C> (proof-of-concept code is kept private). <C>404</C> when it is not published.</>, 'public, max-age=30; no CORS'],
            ['GET /api/security/reports/:id/report.html', 'The same report as a standalone, print-ready HTML page.', 'no-store'],
            ['POST /api/security/review-requests', <>Ask for a Security Review (quoted on request). Needs <C>X-Requested-With: gully</C> (same-site forms only). Body: <C>tier</C> (<C>review</C>; <C>audit</C> is accepted as an enquiry, but audits are not offered yet), <C>name</C>, <C>email</C>, <C>project</C>, <C>scope</C> (20+ characters), optional <C>repo</C>, <C>address</C>, <C>chain</C>, <C>company</C>, <C>timeline</C>, <C>budget</C>. <C>201 {'{ request: { id, tier, status } }'}</C>; <C>400</C> names the field; 5 an hour per address and 3 a day per email.</>, 'no-store'],
          ]}
        />
      </Section>

      <Section id="stats" title="GET /api/stats">
        <P>
          The live totals on the Gully Labs home page: volume, TVL and fees across our projects, each read from that project’s own public API (and DefiLlama where noted) and added up in USD. No parameters, no key; cached on the server for a minute. No CORS header: read it from a server, not a browser on another site.
        </P>
        <Fields
          rows={[
            ['generatedAt', 'string (ISO)', 'When this answer was built.'],
            ['totals', 'object', <><C>volumeAllUsd</C>, <C>volume24hUsd</C>, <C>tvlUsd</C>, <C>fees24hUsd</C>, <C>feesAllUsd</C>: each the sum over the venues that publish it, or empty when none does. <C>covers</C> names the venues in each total; <C>unread</C> the venues that could not be read.</>],
            ['daily', '{ t, v }[]', 'Daily volume in USD summed across the venues read; t in Unix seconds.'],
            ['venues', 'Venue[]', <>One per project (<C>deepcore</C>, <C>peddleswap</C>, <C>peddles</C>, <C>peddlequest</C>): <C>state: ok</C> with its figures, <C>daily</C>, <C>counts</C>, <C>notes</C> and <C>source</C> (<C>url</C>, <C>readAt</C>), or <C>state: error</C> with <C>error</C>. A venue that fails is unreadable, never zero.</>],
          ]}
        />
        <P>
          <C>Cache-Control: public, max-age=30</C>. <C>502</C> only if the whole answer could not be built.
        </P>
      </Section>

      <Section id="status" title="GET /api/status">
        <P>
          The health of every Gully Labs service, as the <DocLink to="status">Status page</DocLink> shows it. The server checks each component every 60 seconds and keeps 24 hours of samples. No key; <C>Cache-Control: public, max-age=30</C> and CORS <C>*</C>.
        </P>
        <Details summary="The answer, as TypeScript">
          <CodeBlock
            lang="js"
            caption="TypeScript · the answer"
            code={`type StatusState = 'up' | 'degraded' | 'down' | 'off' | 'unknown'
  
  interface StatusBucket { t: string; up: number | null; ms: number | null }  // one 30-minute bucket
  
  interface StatusComponent {
    id: string
    group: 'platform' | 'tracker' | 'deepcore' | 'telegram' | 'payments' | 'ai' | 'security' | 'holders'
    name: string
    state: StatusState
    detail: string
    checkedAt: string | null
    latencyMs: number | null
    uptime24h: number | null
    history: StatusBucket[]
  }
  
  interface StatusIncident {
    id: string
    component: string
    name: string
    state: 'down' | 'degraded'
    startedAt: string
    endedAt: string | null      // null while it is still open
    detail: string
  }
  
  interface Status {
    generatedAt: string
    overall: 'operational' | 'degraded' | 'major'
    intervalSeconds: number
    since: string | null        // the first sample kept
    components: StatusComponent[]
    incidents: StatusIncident[]
  }`}
          />
        </Details>
        <List>
          <li>
            <C>off</C> means the component is not configured on this server (Telegram without a bot token, say); <C>unknown</C> means it has not been checked yet. Neither counts towards <C>uptime24h</C>, which is empty until there is a sample.
          </li>
          <li>
            In a <C>history</C> bucket, <C>up</C> is the share of checks that were up (0 to 1) and <C>ms</C> the mean latency; both are empty for a bucket with no checks, never 0.
          </li>
        </List>
        <LatencySpark path="/api/status" everyMs={30_000} />
      </Section>

      <Section id="geo" title="GET /api/geo">
        <P>
          Whether the swap panels may be shown to this visitor, from Cloudflare’s country header. Per visitor, so <C>Cache-Control: private, no-store</C>; no CORS.
        </P>
        <Fields
          rows={[
            ['country', 'string, or empty', 'Two-letter country code, or empty when it could not be determined.'],
            ['allowed', 'boolean', 'False in the blocked regions (US, CU, IR, KP, SY) and when the country is unknown.'],
            ['reason', 'string', <><C>ok</C>, <C>blocked</C>, <C>unknown</C> or <C>local</C> (development).</>],
          ]}
        />
        <P>
          The three swap routes below check the same thing and answer <C>451</C> with <C>code: REGION</C> when it is not allowed.
        </P>
      </Section>

      <Section id="deepcore" title="DeepCore: /api/deepcore">
        <Fields
          head={['Path', 'Answers', 'Limits and cache']}
          variant="routes"
          rows={[
            ['GET /api/deepcore/launches?chain=&limit=', <>DeepCore’s newest launches from the server’s poller: <C>{'{ state (ok, stale, unreadable), launches[], asOf, chains[], error, pollSeconds }'}</C>. Each launch: <C>key</C>, <C>chainId</C>, <C>chainName</C>, <C>token</C>, <C>symbol</C>, <C>createdAt</C>, <C>creator</C>, <C>totalSupply</C>, <C>legs[]</C> (pools, lock), <C>links</C>, <C>locked</C>. <C>chain</C> is 56, 999, 4663 or 8453; <C>limit</C> 1–50, default 50.</>, 'public, max-age=30; no key'],
            ['GET /api/deepcore/quote?chain=&token=&amount=', <>A DeepCore router quote for buying a stock token with the native coin, for comparison only (nothing is signed): <C>{'{ quote }'}</C> with <C>pay</C>, <C>out</C> (amount, minimum), <C>priceImpactPct</C>, <C>fee</C>, <C>route</C> (venues, hops), <C>alternatives</C>, <C>expiresAt</C>, <C>links</C>. <C>chain</C> is <C>robinhood</C> or <C>bsc</C>; <C>token</C> a tracked stock token; <C>amount</C> up to 1000 of the native coin.</>, <>10 a minute per address (<C>429</C>, <C>RATE_LIMITED</C>); answers cached 20 s (<C>cached: true</C>). Region-gated (<C>451</C>).</>],
          ]}
        />
        <P>
          Quote errors carry a <C>code</C>: <C>BAD_CHAIN</C>, <C>BAD_TOKEN</C>, <C>BAD_AMOUNT</C> (400), <C>NO_ROUTE</C> (404), <C>BUSY</C> (429, DeepCore’s own limit), <C>UNREADABLE</C> (502).
        </P>
      </Section>

      <Section id="solana" title="Solana: /api/solana">
        <P>
          The Solana side of the site: a narrow RPC proxy, the Solana Pay lookup and the Jupiter swap proxy for xStocks. No CORS on any of them: they serve our own pages. Unknown paths answer <C>404</C>. More in the <DocLink to="solana">Solana</DocLink> and <DocLink to="swaps">swaps</DocLink> guides.
        </P>
        <Fields
          head={['Path', 'Answers', 'Limits']}
          variant="routes"
          rows={[
            ['POST /api/solana/rpc', <>JSON-RPC 2.0 for six methods only: <C>getLatestBlockhash</C>, <C>getSignatureStatuses</C>, <C>getBalance</C>, <C>getAccountInfo</C>, <C>getTokenAccountsByOwner</C>, <C>sendTransaction</C> (base64, 1,700 characters at most). Params are rebuilt and checked; anything else is <C>-32601</C>. Body 4,000 bytes at most.</>, <>120 reads and 10 sends a minute per address (<C>429</C> as a JSON-RPC error with <C>Retry-After</C>). <C>502</C> when Solana cannot be reached.</>],
            ['GET /api/solana/pay/find?quote=', <>Whether a Solana Pay quote has been paid: <C>{'{ reference, paid, signatures[] }'}</C> (signature, slot, confirmationStatus, blockTime), failed transactions left out. <C>404</C> for an unknown quote.</>, '40 a minute per address.'],
            ['GET /api/solana/jupiter/quote?ticker=&side=&with=&amount=', <>A Jupiter quote for an xStock: <C>side</C> buy or sell, <C>with</C> SOL or USDC. <C>{'{ quote }'}</C> with <C>id</C>, <C>inAmount</C>, <C>outAmount</C>, <C>minOut</C>, <C>priceImpactPct</C>, <C>route</C>, <C>platformFee</C>, <C>slippageBps</C>, <C>expiresAt</C> (60 s).</>, <>20 a minute per address; cached 10 s. Region-gated (<C>451</C>).</>],
            ['POST /api/solana/jupiter/swap', <>Body <C>{'{ quoteId, userPublicKey }'}</C>. Answers <C>{'{ swapTransaction, lastValidBlockHeight, feeAccount }'}</C>: an unsigned transaction for the user’s wallet to sign. A quote older than 60 s is <C>410 EXPIRED</C>.</>, <>6 a minute per address. Region-gated (<C>451</C>).</>],
          ]}
        />
        <P>
          Swap errors carry a <C>code</C>: <C>BAD_TOKEN</C>, <C>BAD_PAIR</C>, <C>BAD_AMOUNT</C>, <C>BAD_USER</C> (400), <C>NO_ROUTE</C> (404), <C>EXPIRED</C> (410), <C>RATE_LIMITED</C> or <C>BUSY</C> (429), <C>REGION</C> (451), <C>UNREADABLE</C> (502).
        </P>
      </Section>

      <Section id="ask" title="Gully AI: /api/ask">
        <P>
          Questions about Gully Labs, answered from the docs and live tools with citations. These routes serve our own pages: no CORS, and the two POSTs need the header <C>X-Requested-With: gully</C> (<C>403</C> without it). More in <DocLink to="gully-ai">Gully AI</DocLink>.
        </P>
        <Fields
          head={['Path', 'Answers', 'Limits']}
          variant="routes"
          rows={[
            ['GET /api/ask/status', <><C>{'{ configured, model, indexSize, updatedAt, retrieval }'}</C>: whether answering is on, and how big the docs index is.</>, 'public, max-age=60'],
            ['POST /api/ask', <>Body <C>{'{ question, history?, holders? }'}</C>: a question of 500 characters at most, the last four turns, optionally a Holder Map token. Answers <C>{'{ id, answer, citations[], live[], cards[], actions[], usedTools, model, retrieval, signedIn }'}</C>; <C>[n]</C> markers in <C>answer</C> point at <C>citations</C>. With <C>Accept: text/event-stream</C> it streams <C>status</C> events (searching, thinking, writing, tool:…) and ends with one <C>answer</C> or <C>error</C> event.</>, <>6 a minute and 60 a day per address, and a daily cap for the whole site (<C>429</C> with <C>Retry-After</C>). <C>503</C> when not configured or busy; <C>413</C> over 16 KB.</>],
            ['POST /api/ask/feedback', <>Body <C>{'{ id, rating }'}</C>, <C>rating</C> up or down, for an answer from the last 24 hours. <C>{'{ ok: true }'}</C>; <C>404</C> once the answer can no longer be rated.</>, '30 a minute per address.'],
          ]}
        />
      </Section>

      <Section id="plans" title="GET /api/plans and /api/alerts/channels">
        <P>
          Both public, <C>Cache-Control: public, max-age=60</C>, CORS <C>*</C>, no rate limit. Every price and limit on the site is read from <C>/api/plans</C>; nothing is typed into a page. Details in <DocLink to="plans-alerts">Plans &amp; alerts</DocLink>.
        </P>
        <Fields
          rows={[
            ['plans', 'Plan[]', <>Tracker API tiers: <C>id</C>, <C>name</C>, <C>priceUsdc</C> (USD per period), <C>perMin</C>, <C>alerts</C>, <C>historyDays</C>, <C>maxKeys</C>, <C>monitors</C>.</>],
            ['anonymous', 'object', <><C>perMin</C> and <C>historyDays</C> without a key.</>],
            ['periodDays, currency', 'number, string', <>What one payment buys (30 days), in <C>USD</C>.</>],
            ['chains, assets', 'array', <>Where Gully Pay takes payment now (only chains with the treasury deployed): each chain’s <C>confirmations</C>, <C>feeProxy</C>, <C>feeSplit</C>; each asset’s <C>id</C>, <C>symbol</C>, <C>kind</C>, <C>address</C>, <C>decimals</C>.</>],
            ['analytics', 'object', <>Gully Analytics <C>plans</C> (<C>sites</C>, <C>eventsPerMonth</C>, <C>priceUsdc</C>), <C>trialDays</C>, <C>graceDays</C>, <C>periodDays</C>.</>],
            ['holderMap, security', 'object', 'Holder Map features per tier, and the Gully Security scan, review and audit offers.'],
            ['checkout', 'object', <><C>{'{ enabled: true, treasury }'}</C>, or <C>{'{ enabled: false, reason }'}</C> when no treasury is configured.</>],
          ]}
        />
        <P>
          <C>GET /api/alerts/channels</C> answers <C>{'{ webhook: { enabled }, telegram: { enabled, bot } }'}</C>, with a <C>reason</C> when Telegram delivery is not configured on this server.
        </P>
      </Section>

      <Section id="pay" title="Gully Pay: /api/pay">
        <P>
          What a payer’s checkout page calls. There is no merchant API key: every route here is public or reached by an unguessable id in a link, and a store is managed only from the app (signed-in session, <C>/api/developer/merchant…</C>, not a public API). No CORS; every POST needs <C>X-Requested-With: gully</C>. Answers are <C>no-store</C> unless noted. Guides: <DocLink to="gully-pay">Gully Pay</DocLink> and <DocLink to="gully-pay-merchants">for merchants</DocLink>.
        </P>
        <Fields
          head={['Path', 'Answers', 'Limits']}
          variant="routes"
          rows={[
            ['GET /api/pay/gas', <>What a payment costs in gas now, per chain: <C>{'{ at, cacheSeconds, gas: { approve, pay, transfer }, chains[] }'}</C>. Each chain: <C>gasPriceGwei</C>, <C>coinUsd</C> and <C>priceSource</C> (the chain’s Chainlink feed), <C>l1FeeUsd</C>, <C>payUsd</C>, <C>transferUsd</C>, <C>approveUsd</C>, <C>note</C>; or <C>ok: false</C> with <C>error</C>. USD figures are empty when the feed cannot be read.</>, 'public, max-age=60; server cache 3 min'],
            ['GET /api/pay/price?asset=', <>A native coin’s USD price from its chain’s Chainlink feed: <C>{'{ asset, symbol, chain, description, price, roundId, updatedAt, readAt }'}</C>. <C>asset</C> is a coin id such as <C>base-eth</C>.</>, '600 an hour; public, max-age=30'],
            ['GET /api/pay/:id', <>A Gully Labs invoice (<C>inv_…</C>): <C>{'{ invoice }'}</C> with <C>number</C>, <C>title</C>, <C>usd</C>, <C>status</C> (open, paid, expired, cancelled), <C>assets</C>, <C>expiresAt</C>, <C>payment</C>, <C>checkout</C>.</>, '600 an hour'],
            ['POST /api/pay/:id/quote', <>Body <C>{'{ asset }'}</C>. A 20-minute quote: <C>{'{ quote }'}</C> with the exact <C>amount</C>, <C>treasury</C>, <C>token</C>, an EIP-681 or Solana Pay <C>uri</C>, the Chainlink <C>price</C> used and <C>expiresAt</C>.</>, '30 an hour'],
            ['POST /api/pay/:id/verify', <>Body <C>{'{ quoteId, txHash }'}</C>. Checks the transaction on chain; <C>200 {'{ invoice }'}</C> when paid, <C>202</C> with <C>confirmations</C> and <C>needed</C> while waiting, <C>409</C> for a reused hash, <C>422</C> for a wrong amount or time.</>, '120 an hour'],
            ['GET /api/pay/l/:id', <>A Gully Labs pay link (<C>pl_…</C>): <C>{'{ link }'}</C> with <C>title</C>, <C>amount</C> (fixed, or open with min and max), <C>assets</C>, <C>state</C>.</>, '600 an hour'],
            ['POST /api/pay/l/:id/invoice', <>Body <C>{'{ usd?, asset? }'}</C>. Starts a checkout: <C>201 {'{ invoice, path }'}</C>, an invoice that expires in an hour.</>, '10 an hour'],
            ['GET /api/pay/m/config', <>Merchant fee settings: <C>feeBps</C>, <C>feePct</C>, <C>freeUsd</C> (fee-free lifetime volume), <C>minStatementUsd</C>, <C>pauseAfterDays</C>, <C>chains</C>, <C>assets</C>.</>, 'public, max-age=60'],
            ['GET /api/pay/m/l/:id, POST …/invoice', <>A store’s pay link (<C>ml_…</C>) and starting its checkout, as above, plus <C>merchant</C> (name, logo, accent, contact) and <C>nonCustodial</C>. A paused store answers <C>423</C>.</>, '600 / 10 an hour'],
            ['GET /api/pay/m/i/:id, POST …/quote, POST …/verify', <>A store’s invoice (<C>mi_…</C>) with line <C>items</C>, <C>recipients</C> per chain, <C>dueAt</C>; quote and verify as above. The quote pays the store’s own wallet and may carry a fee <C>split</C> (approve + pay calls).</>, '600 / 30 / 120 an hour'],
            ['GET /api/pay/m/logo/:sha', 'A store’s uploaded logo.', 'public, max-age=86400, immutable'],
          ]}
        />
        <P>
          Errors are JSON <C>{'{ error }'}</C>: <C>400</C> bad asset, amount or hash; <C>403</C> missing header; <C>404</C> unknown id; <C>409</C> not open, wrong chain or already used; <C>423</C> paused store; <C>429</C> over a limit; <C>502</C> / <C>503</C> chain or price feed unreadable, or no treasury configured. Live gas per chain is drawn on the <DocLink to="gully-pay" hash="gas">Gully Pay</DocLink> page.
        </P>
      </Section>

      <Section id="healthz" title="GET /healthz">
        <P>
          A liveness check for load balancers: <C>200</C> with the plain-text body <C>ok</C> whenever the web server is answering. It says nothing about the services behind it; for those, read <C>/api/status</C>.
        </P>
      </Section>

      <Section id="caching" title="Caching">
        <Fields
          head={['Endpoint', 'Cache-Control', 'Notes']}
          rows={[
            ['/api/tracker', 'public, max-age=30, s-maxage=60, stale-while-revalidate=300', 'The data itself refreshes about every two minutes.'],
            ['/api/tracker/history', 'public, max-age=60, s-maxage=120, stale-while-revalidate=600', 'A new point is added every five minutes.'],
            ['/api/tracker/movers', 'public, max-age=30, s-maxage=60, stale-while-revalidate=300', 'Computed at most once a minute per window. Counted by the same rate limit.'],
            ['/api/tracker/gap-index', 'public, max-age=60, s-maxage=60, stale-while-revalidate=300', 'Computed at most once a minute.'],
            ['/api/holders/…', 'public, max-age=15 to 300', 'Per route in the Holder Map table; maps are built at most every five minutes.'],
            ['/api/score, /api/score/…', 'public, max-age=60 (methodology 300, badge 3600)', 'Scores are recomputed at most every six hours.'],
            ['/api/status', 'public, max-age=30', 'Checks run every 60 seconds.'],
            ['/api/stats', 'public, max-age=30', 'Each project is read at most once a minute.'],
            ['/api/plans, /api/alerts/channels', 'public, max-age=60', ''],
            ['/api/pay/gas', 'public, max-age=60', 'Read from the chains at most every three minutes.'],
            ['/api/chain/fee-history', 'public, max-age=20', 'Base fee per gas over the last 128 blocks on Arbitrum One, Base and Arbitrum Sepolia ({ blocks, chains[]: key, name, role, gwei[], newest, error }), for the Gully L3 roadmap chart. Read at most every 20 seconds.'],
            ['/api/geo, /api/ask, /api/pay/:id …', 'private / no-store', 'Per visitor or per payment: never cached.'],
          ]}
        />
        <P>Answers are cacheable at the edge, so polling more than once a minute gains nothing. A sensible client polls every one to two minutes and keeps its last good answer when a request fails.</P>
      </Section>

      <Section id="rate-limits" title="Rate limits">
        <P>
          These limits apply to <C>/api/tracker*</C> and <C>/api/holders/*</C>; the other routes have their own, listed in their sections. Anonymous requests are limited to <b>60 a minute per IP address</b>. Requests that carry an API key in <C>Authorization: Bearer &lt;key&gt;</C> are counted against the key instead, at <b>600 a minute</b>. Windows are fixed one-minute windows. An unknown or revoked key answers <C>401</C>. Every response also states the limit in force, so a client can read it rather than hard-code it:
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
            ['404', 'an unknown /api/ path', <>Body: <C>{'{"error":"not found"}'}</C>. Check the path.</>],
            ['405', 'a method other than GET or OPTIONS', 'Use GET.'],
            ['401', 'unknown or revoked API key', 'Check the key, or request one at app.gullylabs.xyz.'],
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
          A real answer from <Ext href="https://api.gullylabs.xyz/api/tracker">/api/tracker</Ext>, fetched {FETCHED_AT}, trimmed from {TRACKER_ROWS_AT_FETCH} rows to two (one per chain). Your answer will differ: it is live.
        </P>
        <Details summary="Example response, trimmed">
          <CodeBlock lang="json" caption={`EXAMPLE · REAL RESPONSE, TRIMMED, ${FETCHED_AT}`} code={EXAMPLE_TRACKER} />
        </Details>
        <Callout label="NOT ADVICE" tone="plain">
          The API reports what Chainlink and the pools say. It is not investment advice.
        </Callout>
      </Section>
    </DocPage>
  )
}
