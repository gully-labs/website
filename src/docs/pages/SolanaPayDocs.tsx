import { CodeBlock } from '../CodeBlock'
import { C, Callout, DocLink, DocPage, Ext, Fields, List, P, Section } from '../DocPage'

const sections = [
  { id: 'what', title: 'What it covers' },
  { id: 'assets', title: 'Assets and prices' },
  { id: 'request', title: 'The transfer request' },
  { id: 'paying', title: 'Three ways to pay' },
  { id: 'rules', title: 'When a payment counts' },
  { id: 'find', title: 'GET /api/solana/pay/find' },
  { id: 'errors', title: 'Refusals you may see' },
  { id: 'off', title: 'When it is off' },
]

const URL_TOKEN = `solana:<treasury>?amount=<tokens>&spl-token=<mint>&reference=<reference>&label=Gully%20Labs&message=<what-for>`
const URL_SOL = `solana:<treasury>?amount=<SOL>&reference=<reference>&label=Gully%20Labs&message=<what-for>`
const FIND = `curl -s "https://gullylabs.xyz/api/solana/pay/find?quote=<quote id>"
# { "reference": "…", "paid": false, "signatures": [ { "signature": "…", "slot": 0, "confirmationStatus": "confirmed", "blockTime": 0 } ] }`

export function SolanaPayDocs() {
  return (
    <DocPage
      slug="solana-pay"
      eyebrow="PRODUCTS · SOLANA PAY"
      title="Solana Pay"
      description="How Gully Pay takes SOL, USDC and USDT on Solana: the Solana Pay transfer request and its reference key, paying by QR, wallet or pasted signature, when a payment counts, the find endpoint and the refusals."
      lead={
        <>
          <DocLink to="gully-pay">Gully Pay</DocLink> takes SOL, USDC and USDT on Solana as Solana Pay transfer requests. Each quote has its own reference key, so a phone wallet that follows the spec pays from a QR code and the page finds the payment by itself.
        </>
      }
      sections={sections}
    >
      <Section id="what" title="What it covers">
        <P>
          Solana Pay works in Gully Labs’ own checkout: the quotes made for the pay page and the app’s checkout. It uses the same quotes, ledger and one-signature-one-payment rule as the EVM chains. Merchant stores take the EVM chains for now, so a store does not offer Solana.
        </P>
        <P>
          The specification is the <Ext href="https://docs.solanapay.com/spec">Solana Pay transfer request</Ext>. Solana as a whole (the tracker, Holder Map and swaps) is on the <DocLink to="solana">Solana</DocLink> page.
        </P>
      </Section>

      <Section id="assets" title="Assets and prices">
        <Fields
          head={['Asset', 'How it is paid', 'How it is priced']}
          rows={[
            ['USDC', 'SPL token, mint EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v, 6 decimals', 'One USDC per dollar of the quote'],
            ['USDT', 'SPL token, mint Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB, 6 decimals', 'One USDT per dollar of the quote'],
            ['SOL', 'A plain transfer of the coin, 9 decimals', 'Chainlink’s SOL / USD feed, read on Arbitrum'],
          ]}
        />
        <P>
          The SOL feed is read through Arbitrum’s RPCs, because Chainlink’s SOL / USD price feed we use lives there. If the feed’s last answer is older than two hours, no SOL quote is given and the page suggests a stablecoin. The feed and its last answer are shown on the quote.
        </P>
      </Section>

      <Section id="request" title="The transfer request">
        <P>The QR code on the pay page, and the link behind it, is a Solana Pay transfer request built on the server from the quote’s exact base units, so the amount is never rounded.</P>
        <CodeBlock lang="text" code={URL_TOKEN} caption="USDC or USDT" />
        <CodeBlock lang="text" code={URL_SOL} caption="SOL" />
        <List>
          <li>
            <C>reference</C> is a fresh public key (32 random bytes) made for that one quote. A wallet that follows the spec adds it as a read-only account to the transfer, which is what lets us find the payment on chain.
          </li>
          <li>
            <C>amount</C> is a plain decimal with no exponent. Each open quote in an asset has a different amount, so an exact transfer names its quote; the unique part is in lamports for SOL.
          </li>
          <li>A quote lives 20 minutes, and a payment may be mined up to 10 minutes after it runs out.</li>
        </List>
      </Section>

      <Section id="paying" title="Three ways to pay">
        <List>
          <li>
            <strong className="text-ink">Scan the QR</strong> with a Solana Pay wallet. While the quote can still be paid, the page asks <C>GET /api/solana/pay/find</C> about every five seconds, and hands the first signature it sees to the normal check: “Payment seen on Solana: checking it now.”
          </li>
          <li>
            <strong className="text-ink">Pay with wallet</strong>: connect a Wallet Standard wallet in the browser and sign one transaction that pays the treasury the exact quoted amount and carries the quote’s reference. For USDC and USDT the transaction first creates the treasury’s token account if it is missing, and the payer covers its rent once (about 0.002 SOL). For SOL a small amount is kept back for the network fee. If the wallet does not hold enough, the page says so and nothing is sent.
          </li>
          <li>
            <strong className="text-ink">Paste the signature</strong> of a payment made from any wallet. It is the transaction signature (base58, 87 or 88 characters), not a <C>0x</C> hash. The reference is optional here, because the quote’s exact amount already names it.
          </li>
        </List>
      </Section>

      <Section id="rules" title="When a payment counts">
        <List>
          <li>The transaction is finalized, which takes about 15 seconds, and did not fail. Anything less answers “not finalized yet”: check again shortly.</li>
          <li>
            SOL: the treasury’s own balance rose by the amount. USDC or USDT: the treasury’s associated token account for that mint rose by the amount, in that mint, under the classic SPL Token program. A transfer to any other account or in any other mint does not count.
          </li>
          <li>The amount is at least the quote’s minimum, and a payment from a wallet other than the signed-in one must equal the quoted amount exactly.</li>
          <li>It falls inside the quote’s life: not made before the checkout was opened (two minutes of clock skew are allowed), and not mined more than 10 minutes after the quote ran out.</li>
          <li>The signature was never used before for any payment, on any chain.</li>
        </List>
        <P>
          If an amount is short or cannot be matched, nothing is applied, and the message asks you to write to <C>team@gullylabs.xyz</C> with the signature so the difference can be settled by hand.
        </P>
      </Section>

      <Section id="find" title="GET /api/solana/pay/find">
        <P>
          Lists the signatures that touched a quote’s reference key, newest first, at most 10, with failed transactions left out. It is what the pay page polls. It takes the quote’s id, and the answer says whether the quote is already marked paid.
        </P>
        <CodeBlock lang="bash" code={FIND} />
        <Fields
          head={['Status', 'When', 'Meaning']}
          rows={[
            ['200', 'A Solana quote', 'reference, paid and signatures (possibly empty).'],
            ['404', 'An unknown quote, or one without a reference', 'There is no such Solana quote.'],
            ['429', 'More than 40 requests a minute from one address', 'Sent with Retry-After: 20.'],
            ['502', 'Solana could not be read', 'Try again in a minute.'],
          ]}
        />
        <P>
          A signature found this way is only a lead. It still passes the same checks as one you paste, and it is the verify step that records a payment. The narrow RPC proxy the wallet payment uses is described on the <DocLink to="solana" hash="rpc">Solana</DocLink> page.
        </P>
      </Section>

      <Section id="errors" title="Refusals you may see">
        <Fields
          head={['Message says', 'Status', 'Cause']}
          rows={[
            ['Not a Solana signature', '400', 'A 0x hash, or text that is not base58, was given for a Solana quote.'],
            ['Failed on Solana, so nothing was paid', '422', 'The transaction ran and failed.'],
            ['Not finalized yet', '202', 'Seen but not final, or not yet known to the node. Check again shortly.'],
            ['Sent SOL to another address', '422', 'The treasury was not a recipient.'],
            ['Sent a token other than USDC or USDT', '422', 'Only the two mints above count.'],
            ['Not its associated account', '422', 'The token went to another account of the treasury; write to team@gullylabs.xyz.'],
            ['Already used for a payment', '409', 'One signature pays one thing.'],
            ['Paid before your checkout was opened, or after its quote ran out', '422', 'It falls outside the quote’s life.'],
            ['Solana could not be read just now', '502', 'Every RPC failed; try again in a minute.'],
          ]}
        />
      </Section>

      <Section id="off" title="When it is off">
        <Callout label="OFF UNTIL SET">
          Solana checkout is on only while the owner has set the Solana treasury wallet. Unset, Solana assets are not offered, and a quote on Solana is refused with “Payments on Solana cannot be taken yet”. There is never a fallback address.
        </Callout>
      </Section>
    </DocPage>
  )
}
