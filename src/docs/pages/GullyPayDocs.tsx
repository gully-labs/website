import { CodeBlock } from '../CodeBlock'
import { C, Callout, DocLink, DocPage, Fields, List, P, Section } from '../DocPage'
import { PayCoverage } from '../LiveCharts'

const sections = [
  { id: 'overview', title: 'Overview' },
  { id: 'links', title: 'Pay links' },
  { id: 'checkout', title: 'The checkout' },
  { id: 'qr', title: 'Wallet QR codes' },
  { id: 'button', title: 'Pay with crypto button' },
  { id: 'webhooks', title: 'Webhooks' },
  { id: 'payload', title: 'Event payload' },
  { id: 'verify', title: 'Verifying the signature' },
  { id: 'retries', title: 'Delivery and retries' },
]

const BUTTON = `<a href="https://gullylabs.xyz/pay/l/pl_XXXXXXXXXXXXXXXX" target="_blank" rel="noopener"
   data-gully-pay="popup" style="display:inline-flex;align-items:center;min-height:44px;padding:0 20px;
   border-radius:10px;background:#e8c060;color:#0b0e13;font:600 15px/1 system-ui,sans-serif;text-decoration:none">
  Pay with crypto
</a>
<!-- Optional: opens the checkout in a popup instead of a new tab. -->
<script src="https://gullylabs.xyz/pay-button.js" async></script>`

const URIS = `# native coin: value in wei
ethereum:<treasury>@<chainId>?value=<wei>
ethereum:0xAbC…123@8453?value=20416667000004321

# ERC-20: the token contract, then transfer(address, uint256) in base units
ethereum:<token>@<chainId>/transfer?address=<treasury>&uint256=<baseUnits>
ethereum:0x8AC7…580d@56/transfer?address=0xAbC…123&uint256=1500003161000000000000`

const SHAPE = `// The body of every event (JSON). Types, not sample values.
type GullyPayEvent = {
  id: string                         // "evt_…": the same on every retry and redelivery, so drop duplicates by id
  type: 'invoice.paid' | 'invoice.expired' | 'invoice.cancelled' | 'webhook.test'
  createdAt: string                  // ISO 8601, UTC
  data: {
    invoice: {                       // absent on webhook.test
      id: string                     // "inv_…"
      number: string                 // "GL-0042"
      title: string
      usd: string                    // "1,500" (display)
      usdCents: string               // "150000"
      status: 'paid' | 'expired' | 'open' | 'cancelled'
      url: string                    // the checkout
      linkId: string | null          // the pay link it came from
      createdAt: string
      expiresAt: string
      paidAt: string | null
      cancelledAt: string | null     // set on invoice.cancelled
    }
    link: { id: string; title: string; url: string } | null
    payment?: {                      // invoice.paid only
      chainId: number                // 8453 | 1 | 56 | 42161
      chain: string                  // "Base"
      asset: string                  // "base-usdc", "bnb-bnb", …
      symbol: string                 // "USDC"
      decimals: number
      amount: string                 // exact, in the asset: "1500.003161"
      amountRaw: string              // base units: "1500003161"
      usd: string | null
      txHash: string
      txUrl: string                  // on the chain's explorer
      blockNumber: number
      confirmations: number          // when it was accepted (at least the chain's minimum)
      payer: string                  // the address that sent it
      to: string                     // the Gully Labs treasury
      paidAt: string
      price: { description: string; answer: string; updatedAt: string; roundId: string; feed: string } | null // native coins
    }
  }
}`

const EXAMPLE = `{
  "id": "evt_52roREs1HZFpEvSu",
  "type": "invoice.paid",
  "createdAt": "2026-10-17T16:01:32.949Z",
  "data": {
    "invoice": { "id": "inv_YyRDxuWTBu6ZnYlPVsGCjQ", "number": "GL-0001", "title": "Chain Kit setup", "usd": "1,500",
                 "usdCents": "150000", "status": "paid", "url": "https://gullylabs.xyz/pay/inv_YyRDxuWTBu6ZnYlPVsGCjQ",
                 "linkId": "pl_aV2bqpQu_I9b6Hem", "createdAt": "2026-10-17T16:01:32.866Z",
                 "expiresAt": "2026-10-17T17:01:32.866Z", "paidAt": "2026-10-17T16:01:32.945Z", "cancelledAt": null },
    "link": { "id": "pl_aV2bqpQu_I9b6Hem", "title": "Chain Kit setup", "url": "https://gullylabs.xyz/pay/l/pl_aV2bqpQu_I9b6Hem" },
    "payment": { "chainId": 56, "chain": "BNB Chain", "asset": "bnb-usdc", "symbol": "USDC", "decimals": 18,
                 "amount": "1500.003161", "amountRaw": "1500003161000000000000", "usd": "1,500",
                 "txHash": "0x94a2…b907", "txUrl": "https://bscscan.com/tx/0x94a2…b907", "blockNumber": 4999970,
                 "confirmations": 31, "payer": "0xabab…abab", "to": "0xba9c…af82",
                 "paidAt": "2026-10-17T16:01:32.945Z", "price": null }
  }
}`

const VERIFY = `// Node 18+ with Express. Verify against the RAW body, before any JSON parsing.
import crypto from 'node:crypto'
import express from 'express'

const SECRET = process.env.GULLY_PAY_WEBHOOK_SECRET // whsec_…, shown once when the endpoint was set
const seen = new Set() // use your database in production

const app = express()
app.post('/hooks/gully', express.raw({ type: 'application/json' }), (req, res) => {
  const ts = req.get('X-Gully-Timestamp') ?? ''
  const sig = req.get('X-Gully-Signature') ?? ''
  const expected = 'sha256=' + crypto.createHmac('sha256', SECRET).update(\`\${ts}.\${req.body}\`).digest('hex')

  const ok = sig.length === expected.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))
  const fresh = Math.abs(Date.now() / 1000 - Number(ts)) < 300 // refuse replays older than 5 minutes
  if (!ok || !fresh) return res.status(401).end()

  const event = JSON.parse(req.body.toString('utf8'))
  if (seen.has(event.id)) return res.status(200).end() // a retry of one you already handled
  seen.add(event.id)

  if (event.type === 'invoice.paid') {
    const p = event.data.payment
    console.log('paid', event.data.invoice.id, p.amount, p.symbol, 'on', p.chain, p.txHash)
  }
  res.status(204).end() // answer 2xx within 5 seconds; do slow work after answering
})

app.listen(3000)`

const PY = `# Python 3, any framework: body is the raw request bytes.
import hashlib, hmac, time

def verify(body: bytes, ts: str, sig: str, secret: str) -> bool:
    expected = 'sha256=' + hmac.new(secret.encode(), f'{ts}.'.encode() + body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(sig, expected) and abs(time.time() - int(ts)) < 300`

export function GullyPayDocs() {
  return (
    <DocPage
      slug="gully-pay"
      eyebrow="PRODUCTS · GULLY PAY"
      title="Gully Pay"
      description="Gully Pay: invoices and reusable pay links in ETH, BNB, USDC or USDT on four chains, wallet QR codes, the Pay with crypto button, and signed merchant webhooks with how to verify them."
      lead="Non-custodial crypto billing: every payment is a plain transfer from the payer’s wallet straight to the treasury, read back from the chain. Invoices, reusable pay links, a hosted checkout and signed webhooks."
      sections={sections}
    >
      <Section id="overview" title="Overview">
        <P>
          An <b>invoice</b> (<C>/pay/inv_…</C>) asks for one US dollar amount. The payer picks a chain and an asset and gets a quote: the exact amount to send, valid for 20 minutes. Stablecoins count one to one with a unique tag in the last digits; ETH and BNB are priced by the Chainlink USD feed on the same chain. A payment is
          checked on chain (success, right chain, right asset, the treasury, the exact amount, enough confirmations, never used before) before the invoice is marked paid. The same rules as{' '}
          <DocLink to="plans-alerts" hash="paying">
            API plans
          </DocLink>{' '}
          apply.
        </P>
        <Fields
          head={['Chain', 'Confirmations', 'Assets']}
          rows={[
            ['Base (8453)', '10', 'USDC (6 decimals), ETH'],
            ['Ethereum (1)', '6', 'USDC, USDT (6 decimals), ETH'],
            ['BNB Chain (56)', '15', 'USDT, USDC (18 decimals), BNB'],
            ['Arbitrum (42161)', '10', 'USDC (6 decimals), ETH'],
          ]}
        />
        <P>
          The live list, read from <C>GET /api/plans</C> as you look at this page (hover a chain for its assets and confirmations):
        </P>
        <PayCoverage />
        <Callout label="NO CUSTODY">Nothing is held in between: the transfer goes to the treasury in the payer’s own transaction. If no treasury is configured, every page says checkout is closed and shows no amount or QR.</Callout>
      </Section>

      <Section id="links" title="Pay links">
        <P>
          A pay link (<C>/pay/l/pl_…</C>, an unguessable id) is reusable: every payer who opens it gets an invoice of their own, linked back to the link, then lands in the checkout. Links are made in the admin dashboard.
        </P>
        <Fields
          rows={[
            ['title, description', 'string', 'Shown on the link, the checkout and the receipt.'],
            ['amount', 'fixed | open', <>A fixed USD amount, or <C>open</C>: the payer types an amount between a minimum and a maximum. The server checks it; the page cannot change it.</>],
            ['assets', 'string[]', 'Which chain and asset pairs it takes (all by default).'],
            ['active', 'boolean', 'Switched off links take no payments.'],
            ['expiresAt', 'date | null', 'After it, the link takes no payments.'],
            ['maxUses', 'number | null', 'How many paid uses it allows. Checkouts in progress count against it, so a one-off link cannot be paid twice.'],
            ['webhook', 'https URL | null', <>Where its events go (<a href="#webhooks">webhooks</a>).</>],
          ]}
        />
        <List>
          <li>An invoice made from a link stays open for an hour. Its quote holds 20 minutes and can be renewed.</li>
          <li>Each address may start ten checkouts from links an hour.</li>
          <li>A switched-off, expired or used-up link says so plainly and starts no checkout.</li>
        </List>
      </Section>

      <Section id="checkout" title="The checkout">
        <List>
          <li>Title, amount and a status pill: awaiting payment, confirming, paid, expired or cancelled.</li>
          <li>Assets grouped by chain; the exact amount, large; a wallet QR; copy buttons for the amount, the treasury address and the token contract.</li>
          <li>A countdown on the quote, and a new quote when it runs out. A payment sent in time can still be checked after.</li>
          <li><b>Pay with wallet</b> sends the exact transfer from a connected wallet. Or send from anywhere and paste the transaction hash.</li>
          <li>Live confirmations (<C>n / needed</C>), then a receipt with the explorer link, ready to print or save as PDF.</li>
        </List>
      </Section>

      <Section id="qr" title="Wallet QR codes">
        <P>
          Every quote carries an <C>uri</C>: an EIP-681 payment request for the exact amount, built on the server from base units (never floating point). The QR encodes it.
        </P>
        <CodeBlock lang="bash" code={URIS} />
        <Callout label="CHECK BEFORE SENDING" tone="plain">
          Wallet support for EIP-681 varies: some read only the address, some ignore the amount or the chain. The checkout always shows the address, the exact amount and the token contract with copy buttons. Check the amount and the network in the wallet before sending.
        </Callout>
      </Section>

      <Section id="button" title="Pay with crypto button">
        <P>
          Paste this on any site to send buyers to a pay link or an invoice. The link alone opens the checkout in a new tab; the optional script opens it in a popup window. The admin shows the snippet for each link and invoice.
        </P>
        <CodeBlock lang="html" code={BUTTON} />
        <P>
          The checkout cannot be put in an iframe: its pages send <C>frame-ancestors</C> limited to Gully Labs itself, so wallet prompts and the address bar stay visible to the payer.
        </P>
      </Section>

      <Section id="webhooks" title="Webhooks">
        <P>A pay link, an invoice, or a default endpoint for everything else can have a webhook. When an invoice has its own, or its link has one, events go there; otherwise to the default, if set.</P>
        <Fields
          head={['Event', 'When', 'Data']}
          rows={[
            ['invoice.paid', 'The payment is confirmed and the invoice marked paid.', 'invoice, link, payment'],
            ['invoice.expired', 'An open invoice ran out without a payment.', 'invoice, link'],
            ['invoice.cancelled', 'Gully Labs cancelled the invoice; it can no longer be paid. A cancelled invoice never sends invoice.expired afterwards.', 'invoice, link'],
            ['webhook.test', 'The admin pressed Send test event.', 'target, message'],
          ]}
        />
        <List>
          <li>https only. No user name or password in the URL. The host must resolve only to public addresses: private, loopback, link-local and reserved ranges are refused, and the request goes to the address that was checked.</li>
          <li>The signing secret (<C>whsec_…</C>) is shown once, when the endpoint is set. Rotating it shows the new one once; the old one stops at once.</li>
          <li>Five-second timeout, redirects not followed, the response body is not read.</li>
        </List>
      </Section>

      <Section id="payload" title="Event payload">
        <CodeBlock lang="js" code={SHAPE} />
        <CodeBlock lang="json" code={EXAMPLE} caption="An invoice.paid event" />
      </Section>

      <Section id="verify" title="Verifying the signature">
        <P>Every request carries two headers. The signature is an HMAC-SHA256, with your secret, of the timestamp, a dot, and the raw body:</P>
        <Fields
          head={['Header', 'Value', '']}
          rows={[
            ['X-Gully-Timestamp', 'unix seconds', 'When it was sent. Refuse old ones (five minutes) to stop replays.'],
            ['X-Gully-Signature', 'sha256=<hex>', <>hex(HMAC-SHA256(secret, <C>{'`${timestamp}.${rawBody}`'}</C>))</>],
          ]}
        />
        <CodeBlock lang="js" code={VERIFY} />
        <CodeBlock lang="text" code={PY} caption="Python" />
        <P>
          It is the same scheme as{' '}
          <DocLink to="plans-alerts" hash="verify">
            gap alerts
          </DocLink>
          , so one verifier serves both.
        </P>
      </Section>

      <Section id="retries" title="Delivery and retries">
        <List>
          <li>The first attempt goes out at once. Any answer other than 2xx, a timeout or a network error is retried after 1, 5, 10, 20 and 30 minutes: six attempts over about an hour. Then the delivery is marked failed.</li>
          <li>Retries carry the same event <C>id</C> and body; each is signed again with the current secret and timestamp.</li>
          <li>The queue is stored on disk, so a restart loses nothing: attempts that came due while the server was down go out when it is back.</li>
          <li>Each link and invoice shows its delivery log in the admin: event, state, attempts, last answer.</li>
          <li>
            A finished delivery (failed or delivered) can be <b>redelivered</b> from the admin, for example after your endpoint was down for longer than the retries. The same event goes out again, with the same <C>id</C> and body, as a new delivery with its own six attempts. Your handler should already drop an <C>id</C> it has handled.
          </li>
          <li>Events may arrive out of order and, rarely, more than once. Treat <C>invoice.paid</C> as the source of truth for a sale and look the invoice up by id.</li>
        </List>
      </Section>
    </DocPage>
  )
}
