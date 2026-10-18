import { useEffect, useMemo, useState } from 'react'
import { ChartBox } from '../../components/charts/ChartSkeleton'
import { EChart } from '../../components/charts/EChart'
import { areaPreset, axisTooltip, C, linePreset, tipHtml } from '../../components/charts/chartPresets'
import { CodeBlock } from '../CodeBlock'
import { C as Code, Callout, DocLink, DocPage, Fields, List, P, Section } from '../DocPage'
import { apiOrigin } from '../nav'

const sections = [
  { id: 'overview', title: 'Overview' },
  { id: 'setup', title: 'Setup' },
  { id: 'wallets', title: 'Receiving wallets' },
  { id: 'links-invoices', title: 'Links and invoices' },
  { id: 'checkout', title: 'The checkout' },
  { id: 'webhooks', title: 'Webhooks' },
  { id: 'fees', title: 'Fees and statements' },
  { id: 'pause', title: 'The pause policy' },
  { id: 'terms', title: 'Terms' },
]

const EVENT = `{
  "id": "evt_…",                      // the same on every retry and redelivery
  "type": "invoice.paid",             // or invoice.expired, invoice.cancelled, webhook.test
  "createdAt": "2026-10-17T16:01:32.949Z",
  "data": {
    "store": { "name": "Acme Coffee" },
    "invoice": { "id": "mi_…", "number": "INV-0001", "title": "Espresso machine", "usd": "4,900", "usdCents": "490000",
                 "status": "paid", "url": "https://gullylabs.xyz/pay/m/mi_…", "linkId": null,
                 "customer": { "name": "Jane Roe", "email": "jane@example.com" }, "dueAt": "…", "paidAt": "…" },
    "link": null,                     // { id, title, url } when it came from one of your links
    "payment": { "chainId": 8453, "chain": "Base", "asset": "base-usdc", "symbol": "USDC", "amount": "4900.003161",
                 "amountRaw": "4900003161", "usd": "4,900", "txHash": "0x…", "txUrl": "https://basescan.org/tx/0x…",
                 "confirmations": 12, "payer": "0x…", "to": "0x<your wallet>", "paidAt": "…" }
  }
}`

interface Config {
  feeBps: number
  feePct: number
  freeUsd: number
  minStatementUsd: number
  pauseAfterDays: number
}

/** Fee owed against lifetime volume, from the live rate and allowance (GET /api/pay/m/config). */
export function FeeCurve() {
  const [cfg, setCfg] = useState<Config | null>(null)
  const [err, setErr] = useState(false)
  const [tries, setTries] = useState(0)
  useEffect(() => {
    let alive = true
    fetch(`${apiOrigin()}/api/pay/m/config`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: Config) => alive && (setCfg(d), setErr(false)))
      .catch(() => alive && setErr(true))
    return () => {
      alive = false
    }
  }, [tries])
  const option = useMemo(() => {
    if (!cfg) return null
    const top = Math.max(cfg.freeUsd * 4, 20_000)
    const xs = Array.from({ length: 41 }, (_, i) => Math.round((top / 40) * i))
    const fee = xs.map((v) => Math.round(Math.max(0, v - cfg.freeUsd) * cfg.feeBps) / 100 / 100)
    const eff = xs.map((v, i) => (v ? Math.round((fee[i] / v) * 10_000) / 100 : 0))
    const usd = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 })
    return {
      grid: { left: 8, right: 8, top: 40, bottom: 4, containLabel: true },
      legend: { top: 0, left: 0, textStyle: { color: C.muted, fontSize: 11 }, itemWidth: 10, itemHeight: 10 },
      tooltip: axisTooltip((ps: { dataIndex: number }[]) => {
        const i = ps[0]?.dataIndex ?? 0
        return tipHtml({ title: `${usd(xs[i])} lifetime volume`, rows: [{ name: 'Fees in all', value: usd(fee[i]), color: C.gold }, { name: 'Effective rate', value: `${eff[i]}%`, color: '#5aa9e6' }], note: xs[i] <= cfg.freeUsd ? 'Inside the free allowance.' : undefined })
      }),
      xAxis: { type: 'category', boundaryGap: false, data: xs.map((v) => (v >= 1000 ? `$${v / 1000}k` : `$${v}`)), axisLabel: { color: C.faint, fontSize: 10, hideOverlap: true }, axisLine: { lineStyle: { color: C.line } } },
      yAxis: [
        { type: 'value', axisLabel: { color: C.faint, fontSize: 10, formatter: (v: number) => `$${v}` }, splitLine: { lineStyle: { color: C.grid } } },
        { type: 'value', axisLabel: { color: C.faint, fontSize: 10, formatter: (v: number) => `${v}%` }, splitLine: { show: false }, max: cfg.feePct },
      ],
      series: [
        { id: 'fee', name: 'Fees in all', ...areaPreset({ color: C.gold }), data: fee, markLine: { silent: true, symbol: 'none', lineStyle: { color: C.lineHover, type: 'dashed' }, label: { color: C.faint, fontSize: 10, formatter: 'free allowance', position: 'insideEndTop' }, data: [{ xAxis: xs.findIndex((v) => v >= cfg.freeUsd) }] } },
        { id: 'eff', name: 'Effective rate', ...linePreset({ color: '#5aa9e6', dashed: true }), yAxisIndex: 1, data: eff },
      ],
    }
  }, [cfg])
  return (
    <figure className="m-0 flex flex-col gap-2">
      {option ? <EChart option={option} height={240} label={`Fees owed against lifetime volume at ${cfg?.feePct}% after ${cfg?.freeUsd} USD free`} steps={{ count: 41 }} /> : <ChartBox height={240} variant="line" state={err ? 'error' : 'loading'} message="The live fee settings could not be read." onRetry={() => setTries((t) => t + 1)} />}
      <figcaption className="font-mono text-[11px] text-faint">Live from the server's settings (GET /api/pay/m/config){cfg ? `: ${cfg.feePct}% after the first $${cfg.freeUsd.toLocaleString('en-US')}.` : '.'}</figcaption>
    </figure>
  )
}

export function GullyPayMerchantsDocs() {
  return (
    <DocPage
      slug="gully-pay-merchants"
      eyebrow="PRODUCTS · GULLY PAY"
      title="Gully Pay for merchants"
      description="Run your own non-custodial crypto checkout: wallets per chain, pay links and invoices, signed webhooks, a transaction fee only, weekly statements and the pause policy."
      lead="Take USDC, USDT and the chains' own coins on Base, Ethereum, BNB Chain, Arbitrum, OP Mainnet, Polygon and Avalanche, straight into your own wallet. Non-custodial: payments go directly to your wallet. Gully Labs never holds your funds."
      sections={sections}
    >
      <Section id="overview" title="Overview">
        <P>
          Every workspace in the developer portal can be a store. Open the <b>Merchant</b> tab (<Code>developers.gullylabs.xyz/#merchant</Code>), add a receiving wallet and name the store: from then on your pay links and invoices take payments. The checkout, quotes and on-chain checks are the same as{' '}
          <DocLink to="gully-pay">Gully Pay</DocLink> uses for Gully Labs itself; the only difference is where the money goes: your wallet.
        </P>
        <Callout label="NO CUSTODY">The payer sends a plain transfer from their wallet to yours, in their own transaction. We read it back from a public node of that chain. Nothing passes through an account of ours, and we cannot move, hold or refund a payment.</Callout>
      </Section>

      <Section id="setup" title="Setup">
        <List>
          <li>
            <b>Wallets</b>: one address per chain (the same address on every chain is fine).
          </li>
          <li>
            <b>Store profile</b>: name, logo (https, PNG, JPEG, GIF or WebP, 256 KB at most; fetched once and served from our origin), accent colour, support email and website. They head every checkout, which ends with “Powered by Gully Pay”.
          </li>
          <li>
            <b>Roles</b>: owners, admins and billing members run the store (wallets, profile, invoices); developers make pay links and set the webhook; viewers read everything.
          </li>
        </List>
      </Section>

      <Section id="wallets" title="Receiving wallets">
        <List>
          <li>A mixed-case address must match its EIP-55 checksum exactly, so a mistyped character cannot slip through. An all-lower-case (or all-upper-case) address carries no checksum: it is accepted and stored in its checksummed form.</li>
          <li>We read the chain: an address with no code is a wallet (EOA); with code, a contract (a Safe or another smart account); an EIP-7702 delegated EOA is shown as such.</li>
          <li>
            <b>A contract must be deployed on a chain before that chain can be turned on.</b> A Safe's address can exist on a chain before the Safe is deployed there; a payment to it then may be lost. If you say the wallet is a contract, or it is a contract on another of our chains, and it has no code on this one, the chain stays off. Deploy it, then press <b>Check again</b>, or leave it: we read every undeployed wallet again each hour, and the chain switches on by itself once the contract is there (unless you turned it off).
          </li>
          <li>Gully Labs' own treasury cannot be a store wallet.</li>
          <li>
            <b>Never a fee proxy contract.</b> Request Network's <Code>ERC20FeeProxy</Code> (the contract a split payment passes through) has no owner: anything sent straight to its address is lost for good. The form and the server both refuse it as a store wallet, and you should never give its address to a customer as a place to pay. Your customers pay <i>your</i> wallet; the proxy only passes the payment through inside one transaction.
          </li>
        </List>
      </Section>

      <Section id="links-invoices" title="Links and invoices">
        <Fields
          head={['Thing', 'Checkout URL', 'What it holds']}
          rows={[
            ['Pay link', '/pay/m/l/ml_…', 'Title, description, a fixed amount or one the payer chooses between a minimum and a maximum, assets, optional expiry and maximum uses. Each payer gets an invoice of their own (open one hour).'],
            ['Invoice', '/pay/m/mi_…', 'Number (INV-0001… or yours), line items, due date, customer name and email, notes, assets. Payable 30 days past the due date (shown overdue), then it expires.'],
          ]}
        />
        <P>Each has a copy button, a QR code of its checkout URL and a “Pay with crypto” button snippet for your site (the same snippet and popup script as Gully Pay's own links).</P>
      </Section>

      <Section id="checkout" title="The checkout">
        <List>
          <li>Your name, logo and accent; the amount; for an invoice, the line items, who it is billed to and the due date; the wallet it pays on each chain.</li>
          <li>The payer picks a chain and an asset and gets a 20-minute quote for an exact amount (stablecoins 1:1 plus a tag in the last digits; ETH, BNB, POL and AVAX at the Chainlink price on that chain).</li>
          <li>A payment counts only when it sent your wallet exactly the quoted amount in the quoted asset on the quoted chain, inside the quote's time, with the chain's confirmations, and its transaction was never used for anything else, by you, another store or Gully Labs. A transfer to any other address never counts.</li>
          <li>
            Stablecoin payments above your free allowance pay your wallet and Gully Labs' fee in one transaction through Request Network's <Code>ERC20FeeProxy</Code>, which never holds funds. Every quote, QR code and split call is checked on the server (and again in the payer's browser, with a simulation) so that nothing ever names the proxy as a recipient; a payment that cannot pass answers with no payment details at all. Details in{' '}
            <DocLink to="gully-pay" hash="no-stuck-funds">
              Funds can't get stuck
            </DocLink>
            .
          </li>
        </List>
      </Section>

      <Section id="webhooks" title="Webhooks">
        <P>
          One https endpoint per store gets <Code>invoice.paid</Code>, <Code>invoice.expired</Code> and <Code>invoice.cancelled</Code> for your invoices and link checkouts, signed with your own secret (shown once, rotatable). The signing scheme, retries (six attempts over about an hour) and redeliver are Gully Pay's: see{' '}
          <DocLink to="gully-pay" hash="verify">
            verifying the signature
          </DocLink>
          .
        </P>
        <CodeBlock lang="json" code={EVENT} />
      </Section>

      <Section id="fees" title="Fees and statements">
        <P>A transaction fee only: no monthly fee, no set-up fee.</P>
        <FeeCurve />
        <P>Where the fee is collected depends on the chain (the checkout marks each chain, and your store's setup page lists them):</P>
        <Fields
          head={['Chain', 'Stablecoin payment', 'Coin payment']}
          rows={[
            ['Base, Ethereum, BNB Chain, Arbitrum', 'your wallet and the fee are paid in the same transaction (Request Network fee proxy, verified on each chain); the payer pays exactly the quoted amount', 'one transfer to your wallet; the fee is invoiced'],
            ['OP Mainnet', "the proxy is verified there too (byte-identical to Base's); the in-payment fee switches on once Gully Labs' treasury is deployed on that chain, and until then the fee is invoiced", 'one transfer to your wallet; the fee is invoiced'],
            ['Polygon, Avalanche', 'one transfer to your wallet; the fee is invoiced (the fee proxy there is a different build from the one we verified, so it is not used)', 'one transfer to your wallet; the fee is invoiced'],
          ]}
        />
        <List>
          <li>Each workspace's first lifetime volume up to the free allowance is fee-free. A payment that crosses it pays only on the part above it.</li>
          <li>The fee accrues on each confirmed payment at its quoted USD value, exactly (in millionths of a dollar).</li>
          <li>Every Monday at 00:00 UTC, a store that owes $1 or more gets a statement: a normal Gully Labs invoice, payable in crypto through the Gully Pay checkout. Less than $1 rolls into the next week.</li>
          <li>The portal shows the balance, the free allowance left, every statement and a <b>Pay now</b> button. The CSV export lists every payment with its fee.</li>
          <li>
            The fee terms in full: section 5 of the <a href="https://gullylabs.xyz/legal/merchant-terms#s5" className="text-gold underline-offset-4 hover:underline">merchant terms</a>.
          </li>
        </List>
      </Section>

      <Section id="pause" title="The pause policy">
        <List>
          <li>Day 0: the statement is issued. You are told in the activity log and on Telegram if your workspace linked a chat.</li>
          <li>Day 5: a reminder.</li>
          <li>Day 7, still unpaid: your checkouts pause. Payers see “This store's checkout is paused” and no new quote or link checkout starts. A payment already sent against an earlier quote is still checked and recorded: the money is in your wallet either way.</li>
          <li>Paying the statement resumes checkout at once.</li>
        </List>
      </Section>

      <Section id="terms" title="Terms">
        <P>
          Running a store means accepting the{' '}
          <a href="https://gullylabs.xyz/legal/merchant-terms" className="text-gold underline-offset-4 hover:underline">
            Gully Pay merchant terms
          </a>{' '}
          (adapted from Common Paper's Cloud Service Agreement, CC BY 4.0): you tick “I agree” when you add your first receiving wallet.
        </P>
      </Section>
    </DocPage>
  )
}
