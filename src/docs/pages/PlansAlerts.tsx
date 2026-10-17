import { useEffect, useState } from 'react'
import type { Offer } from '../../pages/developers/api'
import { CodeBlock } from '../CodeBlock'
import { C, Callout, DocLink, DocPage, Ext, Fields, List, P, Section } from '../DocPage'
import { apiOrigin } from '../nav'

const sections = [
  { id: 'plans', title: 'Plans' },
  { id: 'paying', title: 'Paying' },
  { id: 'history', title: 'Longer history' },
  { id: 'alerts', title: 'Gap alerts' },
  { id: 'payload', title: 'Webhook payload' },
  { id: 'verify', title: 'Verifying the signature' },
  { id: 'telegram', title: 'Telegram' },
]

const HISTORY = `curl "https://gullylabs.xyz/api/tracker/history?chain=robinhood&ticker=NVDA&days=90" \\
  -H "Authorization: Bearer $GULLY_API_KEY"`

const SHAPE = `// The body of every delivery (JSON). Types, not sample values.
type Delivery = {
  id: string                       // "dlv_…", unique per delivery
  type: 'alert.triggered' | 'alert.test'
  createdAt: string                // ISO 8601, UTC
  alert: {
    id: string
    name: string | null
    target: { chain: string; ticker: string } | 'any'
    condition: { type: 'gap'; pct: number } | { type: 'status'; status: 'premium' | 'discount' | 'either' }
  }
  events: Array<{                  // empty on alert.test
    chain: string                  // 'robinhood' | 'bsc'
    chainName: string
    ticker: string
    name: string | null
    status: 'premium' | 'discount' | 'drifting' | 'in-line'
    gapPct: number                 // on-chain vs fair, percent, 2 decimals
    fair: number | null            // USD, from the Chainlink feed
    onchain: number | null         // USD, from the token's deepest pool
    poolLiquidityUsd: number | null
    feedUpdatedAt: string | null
    snapshotAt: string             // the tracker snapshot that fired it
  }>
}`

const VERIFY = `// Node 18+ with Express. Verify against the RAW body, before any JSON parsing.
import crypto from 'node:crypto'
import express from 'express'

const SECRET = process.env.GULLY_WEBHOOK_SECRET // whsec_…, shown once when you created the alert
const app = express()

app.post('/hooks/gully', express.raw({ type: 'application/json' }), (req, res) => {
  const ts = req.get('X-Gully-Timestamp') ?? ''
  const sig = req.get('X-Gully-Signature') ?? ''
  const expected = 'sha256=' + crypto.createHmac('sha256', SECRET).update(\`\${ts}.\${req.body}\`).digest('hex')

  const ok = sig.length === expected.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))
  const fresh = Math.abs(Date.now() / 1000 - Number(ts)) < 300 // refuse replays older than 5 minutes
  if (!ok || !fresh) return res.status(401).end()

  const delivery = JSON.parse(req.body.toString('utf8'))
  for (const e of delivery.events) console.log(e.ticker, e.chain, e.gapPct, e.status)
  res.status(204).end() // answer 2xx within 5 seconds
})

app.listen(3000)`

function useOffer() {
  const [offer, setOffer] = useState<Offer | null | 'error'>(null)
  useEffect(() => {
    let alive = true
    fetch(`${apiOrigin()}/api/plans`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then(
        (o: Offer) => alive && setOffer(o),
        () => alive && setOffer('error'),
      )
    return () => {
      alive = false
    }
  }, [])
  return offer
}

export function PlansAlerts() {
  const offer = useOffer()
  return (
    <DocPage
      slug="plans-alerts"
      eyebrow="BUILD · PLANS & ALERTS"
      title="Plans & alerts"
      description="Paid plans for the Gully Labs tracker API, paid in USDC on Base with no custody; gap alerts by webhook or Telegram; the webhook payload and how to verify its signature."
      lead="The API stays free. Paid plans raise the per-key rate limit, add gap alerts and keep a longer history. You pay in USDC from your own wallet straight to ours."
      sections={sections}
    >
      <Section id="plans" title="Plans">
        <P>
          A plan belongs to your wallet account and applies to every key it holds. The limits below are read live from <C>GET /api/plans</C>, the same source the <Ext href="https://gullylabs.xyz/pricing">pricing page</Ext> and the dashboard use.
        </P>
        {offer === null && <P>Reading the plans…</P>}
        {offer === 'error' && <Callout label="UNAVAILABLE">The plans could not be read just now. They are always on the pricing page and at /api/plans.</Callout>}
        {offer && offer !== 'error' && (
          <>
            <Fields
              head={['Plan', 'Price', 'Includes']}
              rows={offer.plans.map((p) => [p.name, p.priceUsdc ? `${p.priceUsdc} USDC / ${offer.periodDays} days` : 'free', `${p.perMin.toLocaleString('en-US')} requests a minute per key, ${p.alerts} alert${p.alerts === 1 ? '' : 's'}, ${p.historyDays} days of history, up to ${p.maxKeys} keys`])}
            />
            <P>
              Without a key: {offer.anonymous.perMin} requests a minute per IP address and {offer.anonymous.historyDays} days of history.
            </P>
            {!offer.checkout.enabled && <Callout label="NOT ON SALE YET">{offer.checkout.reason}</Callout>}
          </>
        )}
      </Section>

      <Section id="paying" title="Paying">
        <List>
          <li>
            Open <b>Plan &amp; billing</b> on the <Ext href="https://developers.gullylabs.xyz">developer dashboard</Ext> and choose a plan. It shows the exact USDC amount and the Gully Labs treasury address on Base.
          </li>
          <li>
            Press <b>Pay with a wallet</b> for a one-click USDC transfer, or send the amount from any wallet or exchange and paste the transaction hash.
          </li>
          <li>
            The server reads the transaction from a public Base node. It counts when it succeeded, sent at least the plan’s price in USDC (<C>0x8335…2913</C>) to the treasury, has a few blocks on top, and was never used before. The plan starts the moment it is confirmed.
          </li>
          <li>
            A payment from the wallet you signed in with always matches you. From any other wallet, send the exact amount the checkout shows: its last digits tag the payment as yours, so nobody watching the treasury can claim it.
          </li>
          <li>A payment buys {offer && offer !== 'error' ? offer.periodDays : 30} days. Paying again for the same plan adds them to the end; a different plan starts that day. Nothing renews by itself: to cancel, don’t pay again. When a plan lapses you are back on Free and your keys keep working at the Free limit.</li>
        </List>
        <Callout label="NO CUSTODY">The USDC goes straight to the treasury wallet in your own transfer. We hold no balance and no card, and nothing leaves your wallet unless you sign it.</Callout>
      </Section>

      <Section id="history" title="Longer history">
        <P>
          <C>GET /api/tracker/history</C> takes <C>days</C>, up to what your plan includes. Without it the answer is the last seven days, unchanged. Asking for more than your plan includes answers <C>403</C> with your limit in <C>historyDays</C>. History is what the tracker recorded since long-term storage began; days before that are simply absent, never filled in.
        </P>
        <CodeBlock lang="bash" code={HISTORY} />
      </Section>

      <Section id="alerts" title="Gap alerts">
        <P>An alert watches one stock (chain and ticker) or every stock the tracker follows, for one condition:</P>
        <Fields
          head={['Condition', 'Body', 'Fires when']}
          rows={[
            ['gap', '{ type: "gap", pct }', <>The gap between on-chain and fair price is at least <C>pct</C> percent, above or below.</>],
            ['status', '{ type: "status", status }', <>The tracker flags the stock <C>premium</C>, <C>discount</C>, or <C>either</C>.</>],
          ]}
        />
        <List>
          <li>Alerts are checked on every tracker snapshot, every five minutes.</li>
          <li>Per stock, an alert fires when its condition becomes true and re-arms once it is false again. It does not repeat while the condition simply stays true.</li>
          <li>Each alert sends at most one delivery every 30 minutes. Stocks that trigger during that pause go out with the next delivery if their condition still holds.</li>
          <li>Only rows the tracker would itself flag count: a readable feed and pool, a pool deep enough to flag, a fresh pool read and an open feed session. Anything else neither fires nor re-arms.</li>
          <li>Each delivery is logged in the dashboard with its HTTP status (the last 50 per alert). Use <b>Test</b> to send an <C>alert.test</C> delivery with no events.</li>
          <li>When a plan lapses, the alerts beyond the Free allowance stay listed but are paused until you delete some or upgrade; the oldest ones keep running.</li>
        </List>
        <H3Note />
      </Section>

      <Section id="payload" title="Webhook payload">
        <P>
          We <C>POST</C> JSON with these headers: <C>Content-Type: application/json</C>, <C>X-Gully-Timestamp</C> (Unix seconds) and <C>X-Gully-Signature</C> (<C>sha256=</C> and the hex HMAC). Answer with any <C>2xx</C> within 5 seconds; we do not follow redirects and do not retry, and the status is shown in your delivery log.
        </P>
        <CodeBlock lang="js" code={SHAPE} caption="TypeScript · shape of a delivery" />
      </Section>

      <Section id="verify" title="Verifying the signature">
        <P>
          The signature is HMAC-SHA256 with the alert’s secret over <C>{'`${timestamp}.${rawBody}`'}</C>. The secret (<C>whsec_…</C>) is shown once when you create the alert; <b>New secret</b> replaces it. Compare in constant time and refuse old timestamps.
        </P>
        <CodeBlock lang="js" code={VERIFY} caption="Node · Express receiver" />
        <P>
          Webhook URLs must be <C>https://</C> on a public address. The host is resolved before every delivery and private, loopback, link-local and other reserved addresses are refused. See <DocLink to="api-keys">API keys</DocLink> for keeping secrets out of browser code; the same applies here.
        </P>
      </Section>

      <Section id="telegram" title="Telegram">
        <P>
          When the server has a Telegram bot configured, an alert can also message a chat: send <C>/start</C> to the bot, paste the chat id it replies with into the alert, and press Test. When no bot is configured the dashboard does not offer Telegram.
        </P>
      </Section>
    </DocPage>
  )
}

function H3Note() {
  return (
    <Callout label="GOOD TO KNOW" tone="plain">
      A new alert whose condition already holds fires on the next snapshot: from the alert’s point of view, the condition has just become true.
    </Callout>
  )
}
