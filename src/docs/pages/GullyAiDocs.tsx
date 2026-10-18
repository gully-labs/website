import { CodeBlock } from '../CodeBlock'
import { C, Callout, DocLink, DocPage, Ext, Fields, List, P, Section } from '../DocPage'
import { AskStatusPanel, StatusHistory } from '../ProductCharts'

const sections = [
  { id: 'what', title: 'What it answers' },
  { id: 'live', title: 'Live status' },
  { id: 'sources', title: 'Sources and citations' },
  { id: 'tools', title: 'Live tools' },
  { id: 'where', title: 'Where it runs' },
  { id: 'limits', title: 'Limits' },
  { id: 'privacy', title: 'Privacy and safety' },
  { id: 'api', title: 'The API' },
]

const CURL = `curl https://gullylabs.xyz/api/ask/status

curl -X POST https://gullylabs.xyz/api/ask \\
  -H "Content-Type: application/json" \\
  -H "X-Requested-With: gully" \\
  -d '{"question":"What is the gap on NVDA right now?"}'`

export function GullyAiDocs() {
  return (
    <DocPage
      slug="gully-ai"
      eyebrow="PRODUCTS · GULLY AI"
      title="Gully AI"
      description="How Gully AI answers questions about Gully Labs: its sources and citations, the live tools it reads, where it runs (site, ⌘K, docs, app, Telegram), its limits and what it logs."
      lead="An assistant that answers questions about Gully Labs from our own docs and live data, cites where every fact came from, and says “I don’t know” when it does not."
      sections={sections}
    >
      <Section id="what" title="What it answers">
        <P>
          Gully AI answers questions about Gully Labs and its products: the stock token tracker and its API, the widget, API keys, plans and alerts, the Holder Map, Gully Analytics, Gully Pay and merchant stores, Chain Kit, the roadmap, DeepCore,
          the Telegram bot, privacy and the services we offer.
        </P>
        <List>
          <li>It describes; it never advises. It does not predict prices or gaps, and never says whether to buy, sell or hold anything.</li>
          <li>It never invents a price, fee, limit, date, address or link. A figure that is not in a source or a tool result is not given.</li>
          <li>When the sources do not cover a question it searches once more in other words, then says plainly that it does not know and points to these docs or the contact form.</li>
          <li>Answers are short: a few plain sentences or a short list. Live figures appear as a card under the answer.</li>
        </List>
      </Section>

      <Section id="live" title="Live status">
        <P>What this server reports about Gully AI right now, and how quickly the status endpoint answers your browser. Below it, the server’s own 24-hour check of Gully AI from the status page.</P>
        <AskStatusPanel />
        <StatusHistory ids={['ai']} title="GULLY AI CHECK, LAST 24 H" />
      </Section>

      <Section id="sources" title="Sources and citations">
        <P>
          Every answer is built from numbered sources: passages of these docs, the main site, the changelog, the legal pages, the roadmap, the Gully Pay contract notes, the Telegram bot and Mini App, our public READMEs and the blog. Each
          sentence that states a fact carries its source number, like <C>[1]</C>, and the sources are listed as links under the answer.
        </P>
        <P>
          Retrieval is <strong className="text-ink">hybrid</strong> when semantic search is configured: keyword search (BM25) on your question and on a synonym-expanded version of it, plus nearest passages by meaning, fused and re-ranked. Without
          it the mode is <strong className="text-ink">BM25</strong>: keyword search with synonyms. The panel above shows which one this server uses.
        </P>
        <P>
          A fact read live from a tool is cited with a label like <C>[L1]</C> and the time it was read.
        </P>
      </Section>

      <Section id="tools" title="Live tools">
        <P>For anything that changes, Gully AI reads live data first, even when a page seems to cover it. At most three rounds of tool calls happen per answer.</P>
        <Fields
          head={['Tool', 'Who', 'What it reads']}
          rows={[
            ['get_stock', 'everyone', 'One stock token’s latest tracker reading: onchain and fair price, gap, status, pool liquidity, feed session'],
            ['get_top_gaps', 'everyone', 'The widest trusted gaps right now'],
            ['get_ledger', 'everyone', 'The live figures of the Gully Labs projects, as each venue publishes them'],
            ['deepcore_launches', 'everyone', 'The newest or most traded DeepCore launches, with when they were read'],
            ['deepcore_pool', 'everyone', 'One token’s DeepCore pools: price, liquidity, lock, swaps'],
            ['get_holders', 'everyone', 'A token’s Holder Map in summary: top-10 share, clusters, the launch checks'],
            ['get_plans', 'everyone', 'Current plans, limits, payment chains and whether checkout is open'],
            ['get_pay_chains', 'everyone', 'What Gully Pay accepts on which chain, and the confirmations needed'],
            ['get_alert_channels', 'everyone', 'Which alert delivery channels this server offers'],
            ['search_docs', 'everyone', 'Searches the docs, site and blog again in other words'],
            ['get_my_store', 'signed in', 'Your own Gully Pay store, in your active workspace'],
            ['get_my_usage', 'signed in', 'Your own API usage and plan, in your active workspace'],
            ['get_my_alerts', 'signed in', 'Your own alerts, in your active workspace'],
          ]}
        />
        <Callout label="YOUR WORKSPACE ONLY">
          The “my” tools take no workspace from the question: the workspace comes from your signed-in session in the app, never from the model. Signed out, they refuse, and the answer says to sign in to the app.
        </Callout>
      </Section>

      <Section id="where" title="Where it runs">
        <List>
          <li>
            <Ext href="https://gullylabs.xyz/ask">gullylabs.xyz/ask</Ext>, the full page.
          </li>
          <li>
            The launcher on the site and in these docs: the “Ask” button in the top bar, or <C>⌘K</C> (<C>Ctrl+K</C> on Windows and Linux).
          </li>
          <li>
            The app dashboard at <Ext href="https://app.gullylabs.xyz">app.gullylabs.xyz</Ext>, where a signed-in session unlocks the “my” tools for your active workspace.
          </li>
          <li>
            The Telegram bot: <C>/ask &lt;question&gt;</C> or the Gully AI button in <Ext href="https://t.me/GullyLabsBot">@GullyLabsBot</Ext>. A private chat linked to a wallet gets that wallet’s workspace; a group never does. See the{' '}
            <DocLink to="telegram">Telegram bot</DocLink> page.
          </li>
        </List>
      </Section>

      <Section id="limits" title="Limits">
        <Fields
          head={['Limit', 'Default', 'Notes']}
          rows={[
            ['Question length', '500 characters', 'Longer questions are refused with a 400'],
            ['Request body', '16 KB', 'Larger requests get a 413'],
            ['Conversation history', 'last 4 turns', 'Each turn trimmed to 600 characters'],
            ['Per visitor', '6 a minute, 60 a day', 'Counted per IP address; a 429 says when to try again'],
            ['Per Telegram chat', '5 a minute, 60 a day', 'Counted per chat'],
            ['Whole service', '2,000 answers a day', 'Across every surface; the spending cap'],
          ]}
        />
        <P>
          The owner can change these on the server. When Gully AI is not configured on a server, every surface says it is not available (the API answers <C>503</C> with <C>configured: false</C>).
        </P>
      </Section>

      <Section id="privacy" title="Privacy and safety">
        <List>
          <li>Questions are logged for 90 days to find gaps in these docs. The log never holds a raw IP address: only a salted hash of it.</li>
          <li>A thumbs up or down keeps the answer id, the rating, the question and the same hash, also for 90 days.</li>
          <li>
            Retrieved text and tool results are treated as data, not instructions: they are wrapped in blocks tagged with a random id per request, and any instruction inside them is ignored.
          </li>
          <li>Gully AI is information only. It is not investment, financial, legal or tax advice.</li>
        </List>
        <P>
          The full policy is at <Ext href="https://gullylabs.xyz/legal/privacy">gullylabs.xyz/legal/privacy</Ext>.
        </P>
      </Section>

      <Section id="api" title="The API">
        <P>
          <C>GET /api/ask/status</C> answers <C>{'{ configured, model, indexSize, updatedAt, retrieval }'}</C>. <C>POST /api/ask</C> takes <C>{'{ question, history? }'}</C> and needs the header <C>X-Requested-With: gully</C>; it answers{' '}
          <C>{'{ id, answer, citations, live, cards, actions, usedTools, model, signedIn }'}</C>. Send <C>Accept: text/event-stream</C> to get progress events before the answer.
        </P>
        <CodeBlock lang="bash" code={CURL} />
        <P>
          <C>POST /api/ask/feedback</C> with <C>{"{ id, rating: 'up' | 'down' }"}</C> rates an answer from the last 24 hours.
        </P>
      </Section>
    </DocPage>
  )
}
