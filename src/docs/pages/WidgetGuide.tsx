import { LivePulse } from '../../components/tracker/LivePulse'
import type { ReactNode } from 'react'
import { widgetSnippet, type WidgetOptions } from '../../lib/widgetEmbed'
import { LiveWidget } from '../../pages/widget/LiveWidget'
import { CodeBlock } from '../CodeBlock'
import { C, Callout, DocLink, DocPage, Ext, Fields, H3, List, P, Section } from '../DocPage'
import { WidestGapsLive } from '../LiveCharts'

const sections = [
  { id: 'quick-start', title: 'Quick start' },
  { id: 'options', title: 'Options' },
  { id: 'ticker', title: 'Ticker' },
  { id: 'badge', title: 'Badge' },
  { id: 'table', title: 'Table' },
  { id: 'theming', title: 'Theming and size' },
  { id: 'behaviour', title: 'Behaviour' },
  { id: 'holder-map', title: 'Holder Map' },
  { id: 'csp', title: 'Content Security Policy' },
]

function Example({ options, children }: { options: WidgetOptions; children?: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-3">
      {children}
      <div className={`rounded-lg border border-line p-5 max-[600px]:p-3 ${options.theme === 'light' ? 'bg-ink' : 'bg-bg'}`}>
        <div className={options.type === 'badge' ? 'max-w-[340px]' : undefined}>
          <LiveWidget options={options} />
        </div>
      </div>
      <CodeBlock lang="html" code={widgetSnippet(options)} />
    </div>
  )
}

export function WidgetGuide() {
  return (
    <DocPage
      slug="widget"
      eyebrow="BUILD · WIDGET"
      title="Widget guide"
      description="Embed the Gully Labs stock token tracker on any page: a live ticker, a one-stock badge or a table of the widest gaps. Every option, theming, behaviour and the CSP it needs."
      lead="Live tracker data on any page, from one script tag and one element. No build step, no dependencies, no key."
      sections={sections}
    >
      <Section id="quick-start" title="Quick start">
        <P>
          Scripts, frames and badges are served from <C>embed.gullylabs.xyz</C>. Snippets you already pasted that load <C>https://gullylabs.xyz/widget.js</C> or frame <C>https://gullylabs.xyz/embed/…</C> keep working: both hosts serve the same files.
        </P>
        <P>Add an element where the widget should appear, and the script once per page:</P>
        <CodeBlock lang="html" code={'<div data-gully-widget="ticker"></div>\n<script src="https://embed.gullylabs.xyz/widget.js" async></script>'} />
        <P>
          Prefer to click? The <Ext href="https://gullylabs.xyz/widget">widget builder</Ext> sets every option with a live preview and writes the snippet for you.
        </P>
      </Section>

      <Section id="options" title="Options">
        <P>Every option is a data attribute on the element. All but the type are optional.</P>
        <Fields
          head={['Attribute', 'Values', 'Meaning']}
          rows={[
            ['data-gully-widget', 'ticker | badge | table', 'Which widget. Anything else draws a ticker.'],
            ['data-chain', 'all | robinhood | bsc', <>Which chain’s stocks. Default <C>all</C>. On a badge it picks the chain when a ticker exists on both.</>],
            ['data-ticker', 'e.g. NVDA', 'Badge only, required: the stock to show.'],
            ['data-theme', 'dark | light', <>Default <C>dark</C>.</>],
            ['data-limit', 'number, 1 to 60', 'Ticker: how many stocks in the strip (default every stock). Table: how many rows (default 5).'],
            ['data-api', 'URL', <>API base. Default <C>https://gullylabs.xyz</C>. Only needed for testing against another deployment.</>],
          ]}
        />
      </Section>

      <Section id="ticker" title="Ticker">
        <Example options={{ type: 'ticker', chain: 'all', theme: 'dark' }}>
          <P>A smooth scrolling strip of every stock with a readable gap: ticker, onchain price, gap to fair. It pauses while the pointer is over it or it has keyboard focus.</P>
        </Example>
      </Section>

      <Section id="badge" title="Badge">
        <Example options={{ type: 'badge', chain: 'robinhood', ticker: 'NVDA', theme: 'dark' }}>
          <P>One stock: its ticker, onchain price and gap to fair, with the fair price and its source underneath. A thin pool or a closed market is said so in the caption.</P>
        </Example>
      </Section>

      <Section id="table" title="Table">
        <P>The table ranks trusted rows by the size of their gap, the same way as this chart, read live from the same API the widget calls:</P>
        <LivePulse source="/api/tracker" every="60 s">
          <WidestGapsLive />
        </LivePulse>
        <Example options={{ type: 'table', chain: 'all', theme: 'light', limit: 5 }}>
          <P>
            The widest gaps, largest first, from pools deep enough to trust (thin pools are left out). With <C>data-chain="all"</C> each row names its chain.
          </P>
        </Example>
      </Section>

      <Section id="theming" title="Theming and size">
        <List>
          <li>
            Two themes, <C>dark</C> and <C>light</C>. Gaps outside the in-line band are teal above fair and vermilion below; in-line gaps and thin pools stay neutral.
          </li>
          <li>Ticker and table fill the width of their element; a badge is at most 340 px wide. Size the element to size the widget. Below 360 px the table drops its fair column so nothing is cut off.</li>
          <li>
            The widget draws inside its own shadow root, so your CSS does not reach in and its CSS does not leak out. The outer box is exposed as a part: <C>[data-gully-widget]::part(widget)</C> can set its border radius or shadow.
          </li>
        </List>
      </Section>

      <Section id="behaviour" title="Behaviour">
        <List>
          <li>One request to the API per page, however many widgets share it, repeated every 60 seconds.</li>
          <li>
            If a refresh fails, the last good figures stay on screen and the footer reads “last read” instead of “live”. Before the first answer the widget says it is reading; if that fails, it says so and retries every minute.
          </li>
          <li>Errors stay inside the widget. Nothing is thrown into your page.</li>
          <li>
            Widgets added after the page loads, for example by a single-page app, are picked up automatically. <C>window.GullyWidget.scan()</C> forces a scan.
          </li>
          <li>Under prefers-reduced-motion the ticker stops scrolling and becomes a strip you can scroll by hand.</li>
          <li>
            Every widget carries a small “Gully Labs tracker” link to <Ext href="https://gullylabs.xyz/tracker">the live tracker</Ext>. It is part of the free embed and stays.
          </li>
        </List>
        <Callout label="KEYS" tone="plain">
          The widget never sends an API key and should not: anything in a page’s HTML is public. Its requests are anonymous and edge-cached. For heavier use, call the <DocLink to="api">API</DocLink> from your server with a <DocLink to="api-keys">key</DocLink>.
        </Callout>
      </Section>

      <Section id="holder-map" title="Holder Map">
        <P>
          Show who holds any token, a Gully Chain launch or a tracked stock token: bubbles sized by share, connected wallets, launch checks and a replay. The same script frames the Holder Map from gullylabs.xyz:
        </P>
        <CodeBlock lang="html" code={'<div data-gully-widget="holders" data-chain="robinhood" data-token="0x8d901a1b3f3a57f9c36a71382fa183476c41545b"></div>\n<script src="https://embed.gullylabs.xyz/widget.js" async></script>'} />
        <List>
          <li>
            <C>data-chain</C>: robinhood, bsc, base, hyperevm or solana. <C>data-token</C>: the token address, or a ticker the tracker follows (NVDA). <C>data-height</C>: 360 to 2000 pixels (default 760).
          </li>
          <li>The map reads its own data inside the frame; your page makes no requests for it. Trades and shares open gullylabs.xyz in a new tab.</li>
          <li>The free embed carries a “Powered by Gully Labs” credit. If your CSP restricts frames, add <C>frame-src https://gullylabs.xyz</C>.</li>
        </List>
      </Section>

      <Section id="csp" title="Content Security Policy">
        <P>If your site sends a Content Security Policy, allow the script and its one API origin:</P>
        <CodeBlock lang="text" caption="CSP" code={'script-src https://gullylabs.xyz;\nconnect-src https://gullylabs.xyz;'} />
        <P>
          Add these to the directives you already have. The widget styles itself with a constructed stylesheet, so it needs no <C>style-src 'unsafe-inline'</C> in browsers that support them; older browsers fall back to a <C>&lt;style&gt;</C> element inside the shadow root.
        </P>
        <H3>Subresource integrity</H3>
        <P>widget.js is updated in place at the same address, so an integrity hash would break on the next release. Use the CSP above instead.</P>
      </Section>
    </DocPage>
  )
}
