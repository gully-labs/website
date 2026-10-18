import { useEffect, useState } from 'react'
import type { AlertChannels, Offer } from '../../pages/developers/api'
import { CodeBlock } from '../CodeBlock'
import { C, Callout, DocLink, DocPage, Ext, Fields, List, P, Section } from '../DocPage'
import { apiOrigin } from '../nav'

const sections = [
  { id: 'plans', title: 'Plans' },
  { id: 'paying', title: 'Paying' },
  { id: 'history', title: 'Longer history' },
  { id: 'alerts', title: 'Gap alerts' },
  { id: 'deepcore-launches', title: 'DeepCore launch alerts' },
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
    condition: { type: 'gap'; pct: number; direction: 'above' | 'below' | 'both' } | { type: 'status'; status: 'premium' | 'discount' | 'either' }
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

const LAUNCH = `// An alert of kind 'deepcore-launch'. Same headers, signature and envelope as above.
type LaunchDelivery = {
  id: string
  type: 'alert.triggered' | 'alert.test'
  createdAt: string
  alert: {
    id: string
    name: string | null
    kind: 'deepcore-launch'
    target: { deepcoreChainId: 56 | 999 | 4663 | 8453 | null }   // null = every chain
    condition: { type: 'deepcore-launch'; chainId: number | null }
  }
  events: Array<{                    // oldest launch first; up to 20 in one delivery
    kind: 'deepcore.launch'
    chainId: number                  // 56 BNB Chain, 999 HyperEVM, 4663 Robinhood Chain, 8453 Base
    chainKey: string                 // 'bsc' | 'hyperevm' | 'robinhood' | 'base'
    chainName: string
    token: string                    // the new token's address
    symbol: string | null
    createdAt: string                // the launch's block time, ISO 8601
    txHash: string | null
    pools: Array<{
      poolId: string | null
      kind: 'CL' | 'Bin' | null
      quote: string | null           // the symbol it is paired with
      locked: boolean | null         // true: DeepCore's indexer has a lock record; null: unknown
      lockId: string | null
    }>
    links: { token: string; launch: string; swap: string }   // pages on deepcore.fun
    snapshotAt: string               // the DeepCore poll that saw it
  }>
}

// Create one from the dashboard, or with the same session API the dashboard uses:
// POST /api/developer/alerts
// { "name": "Base launches", "condition": { "type": "deepcore-launch", "chainId": 8453 }, "webhookUrl": "https://…", "telegram": true }`

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

function useChannels() {
  const [ch, setCh] = useState<AlertChannels | null | 'error'>(null)
  useEffect(() => {
    let alive = true
    fetch(`${apiOrigin()}/api/alerts/channels`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then(
        (c: AlertChannels) => alive && setCh(c),
        () => alive && setCh('error'),
      )
    return () => {
      alive = false
    }
  }, [])
  return ch
}

export function PlansAlerts() {
  const offer = useOffer()
  const channels = useChannels()
  return (
    <DocPage
      slug="plans-alerts"
      eyebrow="BUILD · PLANS & ALERTS"
      title="Plans & alerts"
      description="Paid plans for the Gully Labs tracker API, paid in ETH, BNB, USDC or USDT on Base, Ethereum, BNB Chain or Arbitrum with no custody; gap alerts by webhook or Telegram; the webhook payload and how to verify its signature."
      lead="The API stays free. Paid plans raise the per-key rate limit, add gap alerts and keep a longer history. You pay in ETH, BNB, USDC or USDT from your own wallet straight to ours."
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
              rows={offer.plans.map((p) => [p.name, p.priceUsdc ? `${p.priceUsdc} USD / ${offer.periodDays} days` : 'free', `${p.perMin.toLocaleString('en-US')} requests a minute per key, ${p.alerts} alert${p.alerts === 1 ? '' : 's'}, ${p.historyDays} days of history, up to ${p.maxKeys} keys`])}
            />
            <P>
              Without a key: {offer.anonymous.perMin} requests a minute per IP address and {offer.anonymous.historyDays} days of history.
            </P>
            {!offer.checkout.enabled && <Callout label="NOT ON SALE YET">{offer.checkout.reason}</Callout>}
          </>
        )}
      </Section>

      <Section id="paying" title="Paying">
        <P>
          Prices are in US dollars. You pay in ETH, BNB, USDC or USDT on Base, Ethereum, BNB Chain or Arbitrum, straight to the Gully Labs treasury wallet, which is the same address on every chain.
        </P>
        {offer && offer !== 'error' && (
          <Fields
            head={['Chain', 'Confirmations', 'Assets']}
            rows={offer.chains.map((c): [string, string, string] => [
              `${c.name} (${c.id})`,
              String(c.confirmations),
              offer.assets
                .filter((a) => a.chainId === c.id)
                .map((a) => (a.kind === 'native' ? `${a.symbol} (priced by Chainlink ${a.feed?.description})` : `${a.symbol} ${a.address?.slice(0, 6)}…${a.address?.slice(-4)}`))
                .join(', '),
            ])}
          />
        )}
        <List>
          <li>
            Open <b>Plan &amp; billing</b> on the <Ext href="https://app.gullylabs.xyz">app dashboard</Ext>, choose a plan, then a chain and an asset. You get a quote: the exact amount to send and the treasury address, valid for 20 minutes.
          </li>
          <li>
            Stablecoins count one to one with the dollar; the quote adds a few millionths as a tag. ETH and BNB are priced by the Chainlink USD feed on the same chain at the moment of the quote and rounded up, with a unique tail in the last digits. The quote shows the feed, its round and when it last updated. If the feed is more than two hours old, no quote is given in that coin.
          </li>
          <li>
            Press <b>Pay with a wallet</b> for a one-click transfer (the wallet is asked to switch to the quote’s chain), or send the amount from any wallet or exchange and paste the transaction hash.
          </li>
          <li>
            The server reads the receipt and the transaction from a public node of that chain and checks that they agree. A payment counts when it succeeded, is on the quote’s chain, paid the treasury in the quoted asset, has the confirmations above, and its hash was never used before on any chain. The plan starts the moment it is confirmed.
          </li>
          <li>
            From the wallet you signed in with, at least the price counts: any stablecoin amount from the dollar price up, or at least the quoted amount of ETH or BNB (paying more is accepted, paying less is refused and says by how much). From any other wallet or an exchange, send the exact quoted amount: its last digits tag the payment as yours, so nobody watching the treasury can claim it. A coin payment must be mined while its quote holds (ten minutes of grace).
          </li>
          <li>A payment buys {offer && offer !== 'error' ? offer.periodDays : 30} days. Paying again for the same plan adds them to the end; a different plan starts that day. Nothing renews by itself: to cancel, don’t pay again. When a plan lapses you are back on Free and your keys keep working at the Free limit.</li>
        </List>
        <Callout label="NO CUSTODY">The payment goes straight to the treasury wallet in your own transfer. We hold no balance and no card, and nothing leaves your wallet unless you sign it.</Callout>
        <P>
          Other Gully Labs work (Chain Kit, Gully Analytics, services) is billed with an invoice link of the form <C>gullylabs.xyz/pay/…</C>. It takes the same assets and checks; since nobody signs in there, a payment matches an invoice only by the exact quoted amount. Once paid, the page links the transaction and a printable receipt.
        </P>
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
            ['gap', '{ type: "gap", pct, direction }', <>The gap between on-chain and fair price is at least <C>pct</C> percent. <C>direction</C> picks the side: <C>above</C> a premium (gap ≥ +pct), <C>below</C> a discount (gap ≤ −pct), or <C>both</C> (the default, and what alerts made before directions read as).</>],
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

      <Section id="deepcore-launches" title="DeepCore launch alerts">
        <P>
          A second kind of alert watches <Ext href="https://deepcore.fun">DeepCore</Ext>, the launchpad and DEX in the Gully Labs family, for new token launches. It has no stock: it watches one DeepCore chain, or every chain when <C>chainId</C> is left empty.
        </P>
        <Fields
          head={['Condition', 'Body', 'Fires when']}
          rows={[['deepcore-launch', '{ type: "deepcore-launch", chainId }', <>A token launches on DeepCore on that chain: <C>56</C> BNB Chain, <C>999</C> HyperEVM, <C>4663</C> Robinhood Chain or <C>8453</C> Base; <C>null</C> for any of them.</>]]}
        />
        <List>
          <li>DeepCore’s public API (<C>GET /v1/launches</C>) is read every 90 seconds. Each launch fires once, the first time it is seen; after a restart nothing already seen is sent again.</li>
          <li>Only launches made after the alert was created count (with an hour of slack for indexer lag), so a new alert does not replay the backlog.</li>
          <li>One delivery at most every 5 minutes per alert: launches seen in the meantime wait and go out together, up to the 20 most recent.</li>
          <li>A paused, muted or over-the-plan alert neither sends nor queues: launches it missed are not sent later.</li>
          <li>It counts against your plan’s alerts like a gap alert, and delivers the same way: webhook, Telegram or both, signed the same way (see below).</li>
          <li>When DeepCore cannot be read, nothing fires and nothing is invented; the next good read catches up on launches it has not seen.</li>
        </List>
        <CodeBlock lang="js" code={LAUNCH} caption="TypeScript · a launch delivery" />
        <P>
          In Telegram, anyone can ask the bot <C>/launches</C> for the five latest DeepCore launches on every chain, or <C>/launches base</C> (also <C>bsc</C>, <C>robinhood</C>, <C>hyperevm</C>, or a chain id) for one chain. It reads the same 90-second cache as the alerts, says when the list is older because DeepCore could not be read, and names any chain DeepCore itself could not read. Launch information is not advice.
        </P>
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
        {channels === null && <P>Checking whether this server has its Telegram bot configured…</P>}
        {channels === 'error' && <Callout label="UNAVAILABLE">Whether Telegram is configured could not be read just now (GET /api/alerts/channels). The Alerts tab of the dashboard always shows it.</Callout>}
        {channels && channels !== 'error' && !channels.telegram.enabled && (
          <Callout label="NOT CONFIGURED YET">Telegram delivery works only when the server has its bot configured, and it is not configured yet. Everything below applies once it is; webhooks work today.</Callout>
        )}
        <P>
          An alert can message a Telegram chat as well as, or instead of, calling a webhook{channels && channels !== 'error' && channels.telegram.bot ? <> (the bot is <Ext href={`https://t.me/${channels.telegram.bot}`}>@{channels.telegram.bot}</Ext>)</> : null}. In the Alerts tab of the dashboard press <C>Connect Telegram</C>: it opens the bot with a one-time code (ten minutes, single use) that links the chat to your wallet account, so there is no chat id to copy. <C>Add to a group</C> does the same for a group; only the person who linked a group can unlink it. Then tick Telegram on any alert.
        </P>
        <List>
          <li>Each message names the stock and chain, the gap, the on-chain and fair prices, the status and the pool liquidity, with a link to the stock page.</li>
          <li>
            <C>Open NVDA</C> opens the stock page; <C>Mute 24h</C> pauses that alert, on every channel, for 24 hours. <C>Resume</C> in the dashboard ends a mute early.
          </li>
          <li>Deliveries appear in the alert&apos;s log like webhook ones, with the result Telegram gave.</li>
          <li>
            In the chat, <C>/alerts</C> lists your alerts and <C>/stop</C> unlinks. Anyone can ask the bot <C>/gap NVDA</C> (or <C>/gap NVDA bsc</C>) and <C>/top</C> for the five widest trusted gaps. A figure the tracker could not read is said to be unreadable, never shown as zero.
          </li>
        </List>
        <P>
          Which channels the server offers is public at <C>GET /api/alerts/channels</C>.
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
