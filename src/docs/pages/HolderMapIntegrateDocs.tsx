import { CodeBlock } from '../CodeBlock'
import { C, DocLink, DocPage, Ext, Fields, H3, List, P, Section } from '../DocPage'

const sections = [
  { id: 'overview', title: 'Three ways in' },
  { id: 'embed', title: 'The embed' },
  { id: 'frame', title: 'Framing it yourself' },
  { id: 'api', title: 'The public API' },
  { id: 'response', title: 'The map JSON' },
  { id: 'card', title: 'The share card' },
  { id: 'sdk', title: 'The SDK' },
  { id: 'launchpads', title: 'Get your launchpad listed' },
]

const SCRIPT = `<div data-gully-widget="holders"
     data-chain="base"
     data-token="0x0000000000000000000000000000000000000000"
     data-height="640"></div>
<script src="https://gullylabs.xyz/widget.js" async></script>`

const IFRAME = `<iframe
  src="https://gullylabs.xyz/embed/holders/base/0x0000000000000000000000000000000000000000"
  title="Holder Map by Gully Labs"
  loading="lazy"
  style="width:100%;height:760px;border:0;border-radius:12px"></iframe>`

const CURL = `# the map, as JSON (an address, or a ticker the tracker follows)
curl "https://gullylabs.xyz/api/holders/base/0x0000000000000000000000000000000000000000"

# the same with an API key (a higher rate limit)
curl "https://gullylabs.xyz/api/holders/base/0x0000000000000000000000000000000000000000" \\
  -H "Authorization: Bearer $GULLY_API_KEY"

# the share card, a 1200 x 630 PNG
curl -o card.png "https://gullylabs.xyz/api/holders/base/0x0000000000000000000000000000000000000000/card.png"`

const BADGE = `<a href="https://gullylabs.xyz/holders/base/0x0000000000000000000000000000000000000000">
  <img src="https://gullylabs.xyz/api/holders/base/0x0000000000000000000000000000000000000000/card.png"
       alt="Holder Map for this token" width="600" height="315">
</a>`

export function HolderMapIntegrateDocs() {
  return (
    <DocPage
      slug="holder-map-integrate"
      eyebrow="BUILD · HOLDER MAP"
      title="Integrate the Holder Map"
      description="Put the Gully Labs Holder Map on a launchpad or any site: the one-tag embed, the framed page, the public JSON API, the share card, and how to get a launchpad listed."
      lead="Show who holds a token, and how the biggest wallets are connected, on your own pages. One script tag, a plain iframe, or the JSON behind it. No key needed to start."
      sections={sections}
    >
      <Section id="overview" title="Three ways in">
        <List>
          <li>
            <b>Embed</b>: one HTML element and the widget script. The map appears inside a responsive frame.
          </li>
          <li>
            <b>API</b>: <C>GET /api/holders/:chain/:token</C> returns the whole map as JSON, with CORS open to any origin, and <C>/card.png</C> returns a share card.
          </li>
          <li>
            <b>Listing</b>: a launchpad can be added to the registry so its launches are recognised. See <a href="#launchpads" className="text-gold underline decoration-gold-line underline-offset-[3px]">Get your launchpad listed</a>.
          </li>
        </List>
        <P>
          What a map contains, where its data comes from and the honesty rules are on the <DocLink to="holder-map">Holder Map</DocLink> page.
        </P>
      </Section>

      <Section id="embed" title="The embed">
        <CodeBlock lang="html" code={SCRIPT} />
        <Fields
          head={['Attribute', 'Values', 'Meaning']}
          rows={[
            ['data-gully-widget', 'holders', 'Selects the Holder Map (the same script also draws the tracker widgets).'],
            ['data-chain', 'robinhood | bsc | base | hyperevm | solana', 'Required. Anything else shows “Holder Map: set data-chain and data-token.”'],
            ['data-token', 'address, or a ticker', <>Required: 1 to 64 letters and digits. The token address, or a ticker the tracker follows (<C>data-ticker</C> is accepted as an alias).</>],
            ['data-height', '360 to 2000', <>Pixels. Default <C>760</C>; a value outside the range falls back to the default.</>],
            ['data-badge', 'true', <>Draws the small badge (<C>/api/holders/:chain/:token/badge.svg</C>) linked to the map, instead of the frame. It uses cached data only.</>],
            ['data-embed-key', 'gle_0x…', <>White-label plans only: your signed embed key (<C>GET /api/developer/partners/embed-key</C>, signed in). Public by design; it unlocks only this option, never the API.</>],
            ['data-theme', 'light | dark', 'White-label plans only. Default dark.'],
            ['data-accent', '#rgb | #rrggbb', 'White-label plans only. Anything that is not a hex colour is ignored.'],
            ['data-api', 'URL', <>Origin to frame. Default <C>https://gullylabs.xyz</C>; only for testing against another deployment.</>],
          ]}
        />
        <List>
          <li>The script adds one lazy-loaded iframe, full width of its element, with rounded corners and a dark background. Size the element to size the map.</li>
          <li>The map reads its own data inside the frame. Your page makes no requests for it and the script sends no key.</li>
          <li>Trades and shares open gullylabs.xyz in a new tab. A “Powered by Gully Labs” credit shows unless the embed carries a valid embed key of a workspace on a white-label plan (Business). The server decides on every load from the live plan: a downgraded plan or a rotated key brings the credit back, and a theme or accent in the URL alone does nothing.</li>
          <li>If your site sends a Content Security Policy, allow the script and the frame: <C>script-src https://gullylabs.xyz; frame-src https://gullylabs.xyz;</C></li>
        </List>
      </Section>

      <Section id="frame" title="Framing it yourself">
        <P>
          The script only builds this iframe. If you prefer to write it yourself, the address is <C>https://gullylabs.xyz/embed/holders/:chain/:token</C>, and it may be framed from any origin:
        </P>
        <CodeBlock lang="html" code={IFRAME} />
        <P>
          Use the same chain keys and token rules as above. The page has no site chrome, so it fits a panel on a token page; give the frame at least 360 px of height.
        </P>
      </Section>

      <Section id="api" title="The public API">
        <CodeBlock lang="bash" code={CURL} />
        <Fields
          variant="routes"
          head={['Route', 'Returns', 'Cache']}
          rows={[
            ['GET /api/holders/:chain/:token', <>The map as JSON. <C>:token</C> is an address (a Solana mint on <C>solana</C>) or a tracked stock ticker. CORS: <C>Access-Control-Allow-Origin: *</C>.</>, 'public, max-age=60 when ok'],
            ['GET /api/holders/:chain/:token.csv', <>The holder list as CSV. Needs a plan that includes it, otherwise <C>403</C>.</>, 'private, no-store'],
            ['GET /api/holders/:chain/:token/card.png', 'A 1200 x 630 share card, free for everyone. Always an image: a branded “coming soon” or “not ready” card when there is no map.', 'public, max-age=300 (60 when not ready)'],
          ]}
        />
        <List>
          <li>
            <C>:chain</C> is a key (<C>robinhood</C>, <C>bsc</C>, <C>base</C>, <C>hyperevm</C>, <C>solana</C>) or the numeric chain id. An unknown chain is <C>404</C>; a token that is neither an address nor a tracked ticker is <C>400</C>.
          </li>
          <li>
            Anonymous calls are limited per IP address; an API key (<C>Authorization: Bearer gl_live_…</C>) raises the limit to its plan. See <DocLink to="api-keys">API keys</DocLink> and the{' '}
            <DocLink to="api" hash="holders">
              API reference
            </DocLink>
            . A new map is built at most 12 times a minute per IP; cached maps are free. Call the API from your server for anything heavier than a page view.
          </li>
          <li>Maps are cached for at least five minutes, so polling faster returns the same answer.</li>
        </List>
      </Section>

      <Section id="response" title="The map JSON">
        <P>
          Always check <C>state</C> first. HTTP status is <C>200</C> for <C>ok</C> and <C>unavailable</C>, <C>404</C> for <C>not-found</C>, <C>429</C> or <C>503</C> for <C>busy</C> and <C>502</C> for <C>error</C>.
        </P>
        <Fields
          head={['Field', 'Type', 'Meaning']}
          rows={[
            ['state', '"ok" | "unavailable" | "not-found" | "busy" | "error"', <>Only <C>ok</C> carries the fields below. The others carry <C>reason</C> (plain words), <C>chain</C>, <C>token.address</C> and <C>asOf</C>; <C>unavailable</C> adds <C>comingSoon</C>.</>],
            ['kind', 'string', <>What was mapped, for example <C>stock</C> or <C>deepcore-launch</C>.</>],
            ['chain', '{ key, id, name }', 'The chain.'],
            ['token', '{ address, symbol, name, decimals, supply, url }', <><C>supply</C> is null when the total supply is not known; <C>url</C> is the explorer page.</>],
            ['asOf', 'ISO time', 'When the map was built.'],
            ['holders', '{ count, shown, graph, sharesOf, partial }', <><C>sharesOf</C> says whether percentages are of <C>total supply</C> or of the <C>listed holders</C>; <C>count</C> may be null.</>],
            ['nodes[]', 'wallet', <><C>id</C>, <C>short</C>, <C>rank</C>, <C>balance</C>, <C>pct</C>, <C>label</C> (<C>{'{ kind, name }'}</C> or null), <C>contract</C>, <C>cluster</C> (a cluster id or null), <C>flags[]</C> and <C>url</C>. On stock tokens also <C>valueAtFairUsd</C>, <C>premiumUsd</C> and <C>boughtGapPct</C>.</>],
            ['links[]', 'edge', <><C>source</C>, <C>target</C>, <C>transfers</C>, <C>pct</C> and <C>kind</C> (<C>transfer</C>, <C>funding</C> or <C>via</C>).</>],
            ['clusters[]', 'group', <><C>id</C>, <C>wallets[]</C>, <C>count</C>, <C>pct</C>, <C>hasDeployer</C>.</>],
            ['summary', '{ top10Pct, largestCluster, line, plain[] }', <>The concentration in numbers and in plain sentences.</>],
            ['forensics', 'object | null', 'Launch checks (deployer share, bundled and sniped buying, funding, liquidity lock). Null for tokens without a complete history.'],
            ['fair', 'object | null', 'Stock tokens: the fair-price overlay.'],
            ['timeline', 'frames | null', 'Replay frames; null on the free view.'],
            ['recentFlows[]', 'transfers', 'The latest large movements.'],
            ['legend[]', '{ kind, text }', 'The label kinds present on this map.'],
            ['features, tier, locked[]', 'object, string, string[]', <>What this caller’s plan includes: <C>features</C> has <C>replay</C>, <C>csv</C>, <C>alerts</C>, <C>holders</C>, <C>liveMinutes</C> and <C>gated</C>.</>],
          ]}
        />
        <P>
          Amounts are in token units, shares are percentages (0 to 100, two decimals). A value that could not be read is <C>null</C>, never zero. Fields can be added over time; read the ones you need and ignore the rest.
        </P>
        <H3>Related routes</H3>
        <List>
          <li>
            <C>GET /api/holders/launches</C>: the newest DeepCore launches on holder chains. <C>GET /api/holders/top?limit=</C>: the most scanned maps today. <C>GET /api/holders/resolve?q=</C>: find a token by name, ticker or address. <C>GET /api/holders/sources</C>: which chains have maps today.
          </li>
        </List>
      </Section>

      <Section id="card" title="The share card">
        <P>
          <C>/card.png</C> is a ready-made preview of a map, drawn from the free view so everyone gets the same picture. Use it as an <C>og:image</C> or as a link badge that leads to the full map:
        </P>
        <CodeBlock lang="html" code={BADGE} />
        <P>
          The full map for any token lives at <C>https://gullylabs.xyz/holders/:chain/:token</C>.
        </P>
      </Section>

      <Section id="sdk" title="The SDK">
        <P>
          A typed client and a React component are coming in <C>@gullylabs/holders</C>: <C>createHoldersClient()</C> with <C>getMap()</C> and <C>cardUrl()</C>, and a <C>&lt;HolderMap chain token height /&gt;</C> component that frames the embed above. It is not published yet; until then use the embed or the API directly. The tracker client and widget are in the <DocLink to="sdk">SDK</DocLink> today.
        </P>
      </Section>

      <Section id="launchpads" title="Get your launchpad listed">
        <P>
          The Holder Map keeps a registry of launchpads. One declarative entry per launchpad is all it takes: its chains, and either a token endpoint on your API or the factory contract and the event it emits when a token is created. Peddles and PeddleSwap are the first two entries.
        </P>
        <P>What we need from you:</P>
        <List>
          <li>Your name, website and the chains you launch on (Robinhood Chain, BNB Chain, Base and HyperEVM are supported).</li>
          <li>
            Either a token endpoint that answers whether an address is one of your launches and names its creator (and ideally the creation block), or your factory or hook contract address per chain with the signature of the event it emits at creation and where the token and creator sit in it.
          </li>
          <li>Optionally the address of the pool or pool manager that holds a launch’s liquidity, so it is labelled on the map.</li>
        </List>
        <P>
          Send these to <Ext href="mailto:hello@gullylabs.xyz">hello@gullylabs.xyz</Ext>. Gully Labs adds the entry, checks it against live launches and replies when it is live. We take contract addresses only from you or from your deployments; we never guess them.
        </P>
      </Section>
    </DocPage>
  )
}
