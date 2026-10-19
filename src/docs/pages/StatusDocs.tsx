import { StatusBoard } from '../../components/status/StatusBoard'
import { CodeBlock } from '../CodeBlock'
import { C, Callout, ChainName, DocLink, DocPage, Ext, Fields, List, P, Section } from '../DocPage'

const sections = [
  { id: 'live', title: 'Live status' },
  { id: 'page', title: 'The status page' },
  { id: 'checks', title: 'What each check means' },
  { id: 'uptime', title: 'How uptime is computed' },
  { id: 'incidents', title: 'Incidents' },
  { id: 'api', title: 'GET /api/status' },
]

const SHAPE = `type StatusState = 'up' | 'degraded' | 'down' | 'off' | 'unknown'
// off = not configured on this server; off and unknown are left out of uptime

interface StatusBucket {
  t: string            // start of a 30-minute bucket (ISO time)
  up: number | null    // share of checks up in it, 0..1 (null: none counted)
  ms: number | null    // mean latency of the checks in it
}

interface StatusComponent {
  id: string
  group: 'platform' | 'tracker' | 'deepcore' | 'telegram' | 'payments' | 'ai' | 'security' | 'holders'
  name: string
  state: StatusState
  detail: string       // one plain sentence
  checkedAt: string | null
  latencyMs: number | null
  uptime24h: number | null   // 0..1
  history: StatusBucket[]    // the last 24 hours
}

interface StatusIncident {
  id: string
  component: string    // a component id
  name: string
  state: 'down' | 'degraded'
  startedAt: string
  endedAt: string | null     // null while it is still open
  detail: string
}

interface StatusBody {
  generatedAt: string
  overall: 'operational' | 'degraded' | 'major'
  intervalSeconds: number    // 60
  since: string | null       // when this server's history starts
  components: StatusComponent[]
  incidents: StatusIncident[]
}`

const CURL = `curl -s https://api.gullylabs.xyz/api/status | jq '{overall, components: [.components[] | {id, state, uptime24h}]}'`

export function StatusDocs() {
  return (
    <DocPage
      slug="status"
      eyebrow="MORE · STATUS"
      title="Status"
      description="The Gully Labs status page and GET /api/status: what each check means, how 24-hour uptime is computed, how incidents open and close, and the JSON shape."
      lead={
        <>
          Every minute our server checks each part of the stack it can see from inside and keeps 24 hours of results. The public page is <Ext href="https://gullylabs.xyz/status">gullylabs.xyz/status</Ext>; the same data is a JSON endpoint.
        </>
      }
      sections={sections}
    >
      <Section id="live" title="Live status">
        <StatusBoard compact />
      </Section>

      <Section id="page" title="The status page">
        <P>
          <Ext href="https://gullylabs.xyz/status">gullylabs.xyz/status</Ext> shows the overall state, every component with its state now, a plain sentence on what was seen, its 24-hour uptime and a bar per 30 minutes, then the recent incidents.
          Every check is real and read-only, and the response never contains a URL, token, key or setting name: errors are reduced to plain words.
        </P>
      </Section>

      <Section id="checks" title="What each check means">
        <P>Checks run every 60 seconds on the server.</P>
        <Fields
          head={['Component', 'Group', 'Up when']}
          rows={[
            ['Public API', 'platform', 'This server is answering. The detail says how long it has been up'],
            [<>Tracker: <ChainName name="Robinhood Chain, BNB Chain, Solana" /></>, 'tracker', 'The chain’s token prices were read on chain in the last 10 minutes (the newest price reading, not the hourly pool discovery). 10 to 30 minutes old is degraded; older, or no price read at all, is down'],
            ['DeepCore launch poller', 'deepcore', 'The last good poll is within three poll intervals; within ten is degraded'],
            ['Telegram bot webhook', 'telegram', 'Telegram’s getWebhookInfo shows a webhook registered. A delivery error in the last 10 minutes, or more than 100 updates waiting, is degraded. See the Telegram bot page'],
            ['Telegram bot: News channel gate', 'telegram', 'Telegram’s getChatMember shows the bot is an admin of the News channel. If it is not, the gate cannot check membership and lets everyone through: degraded'],
            ['Gully Pay RPC, per payment chain', 'payments', 'A node answers eth_blockNumber (Solana: getSlot). Slower than 4 s is degraded'],
            ['Gully Pay fee proxies', 'payments', 'The treasury is not a fee proxy contract (if it is, checkout is refused: down), and no payment sits on a fee proxy waiting for recovery (degraded)'],
            ['Gully AI', 'ai', 'Configured, with a non-empty search index, and the AI provider answering for our account (a billing or key problem is degraded until an answer succeeds again)'],
            ['Security scan engine', 'security', 'The AI scan is configured. The detail says whether the static-analysis tools are running and what is queued'],
            ['Contract monitors', 'security', 'Watched contracts are read without errors; a chain failing in the last 10 minutes is degraded'],
            ['Holder Map sources, per chain', 'holders', 'The chain has a holder data source configured on this server'],
          ]}
        />
        <P>
          <C>off</C> means the part is not configured on this server (for example the bot without its token): it is shown, but it is not an outage. <C>unknown</C> means the check could not tell, for example before the first read after a restart.
        </P>
        <Callout label="SCANS ARE AI-ONLY FOR NOW">
          “Security scan engine: up” means the AI scan can run. It is not an audit, and a clean scan is not a guarantee. See <DocLink to="gully-security">Gully Security</DocLink>.
        </Callout>
      </Section>

      <Section id="uptime" title="How uptime is computed">
        <List>
          <li>Each check is one sample: up counts 1, degraded counts ½, down counts 0.</li>
          <li>
            <C>off</C> and <C>unknown</C> samples are left out entirely, so a part that is not configured neither helps nor hurts the figure.
          </li>
          <li>
            <C>uptime24h</C> is the counted samples of the last 24 hours averaged, from 0 to 1. With none counted it is empty, shown as “not tracked yet”, never as 0% or 100%.
          </li>
          <li>
            Each 30-minute bucket in <C>history</C> uses the same rule for <C>up</C>, and <C>ms</C> is the mean latency of its checks that were timed.
          </li>
          <li>Samples are kept for 24 hours and saved in the server’s data volume, so a restart or a deploy keeps the history. <C>since</C> says when it starts.</li>
        </List>
        <P>
          <C>overall</C> is <C>major</C> when the Public API is down or three or more components are down, <C>degraded</C> when anything is down or degraded, and <C>operational</C> otherwise.
        </P>
      </Section>

      <Section id="incidents" title="Incidents">
        <P>
          An incident opens when a component goes down or degraded. While it is open its detail follows the latest check, and it is marked down if it got worse. It closes (its <C>endedAt</C> is set) when the component is up again, or switched off on this server. Incidents are recorded automatically from the checks, newest first; the body carries the latest 20.
        </P>
      </Section>

      <Section id="api" title="GET /api/status">
        <P>
          Public, no key, and readable from any origin. It is cached for 30 seconds. The shape:
        </P>
        <CodeBlock lang="js" code={SHAPE} caption="TypeScript" />
        <CodeBlock lang="bash" code={CURL} />
      </Section>
    </DocPage>
  )
}
