import { feeText, jupiterFeeText } from '../../components/swap/swapConfig'
import { CodeBlock } from '../CodeBlock'
import { C, Callout, DocLink, DocPage, Ext, Fields, List, P, Section } from '../DocPage'
import { PoolDepth } from '../ProductCharts'

const sections = [
  { id: 'what', title: 'Swaps on stock pages' },
  { id: 'depth', title: 'Pool depth now' },
  { id: 'gates', title: 'Before a swap is shown' },
  { id: 'evm', title: 'EVM chains: LI.FI' },
  { id: 'solana', title: 'Solana: Jupiter' },
  { id: 'fees', title: 'Fees' },
  { id: 'custody', title: 'What we never do' },
]

const GEO = `curl https://gullylabs.xyz/api/geo
# { "country": "DE", "allowed": true, "reason": "ok" }`

const JUP = `curl "https://gullylabs.xyz/api/solana/jupiter/quote?ticker=AAPL&side=buy&with=USDC&amount=25"
# { "quote": { "id", "side", "inSymbol", "outSymbol", "inAmount", "outAmount", "minOut",
#   "priceImpactPct", "route": [{ "label", "percent" }], "platformFee", "feeNote",
#   "slippageBps", "expiresAt" } }`

export function SwapsDocs() {
  return (
    <DocPage
      slug="swaps"
      eyebrow="PRODUCTS · SWAPS"
      title="Swaps"
      description="How swaps work on Gully Labs stock pages: LI.FI on Robinhood Chain and BNB Chain, Jupiter on Solana, the region check (GET /api/geo), the Jupiter proxy, fees, and why your wallet signs everything."
      lead="Each stock page can swap into or out of its token, right beside the gap. The routing is LI.FI on EVM chains and Jupiter on Solana; your own wallet signs every transaction."
      sections={sections}
    >
      <Section id="what" title="Swaps on stock pages">
        <P>
          Open a token from the <Ext href="https://gullylabs.xyz/tracker">tracker</Ext> and its page has a swap card. On Robinhood Chain and BNB Chain it pays with the chain’s native coin (ETH or BNB) through LI.FI; on Solana it buys or sells the
          xStock with SOL or USDC through Jupiter. The card sits next to the live gap so you can see the fair price before you trade.
        </P>
        <P>Swaps are executed by third-party exchanges. The token is issued by a third party that can pause, block or change it; it tracks the stock but is not the share itself.</P>
      </Section>

      <Section id="depth" title="Pool depth now">
        <P>
          How deep each token’s deepest pool is right now, from the tracker (the same pool its onchain price is read from). A shallow pool means more price impact on a swap. A token whose pool could not be read is counted, never drawn as zero.
        </P>
        <PoolDepth />
      </Section>

      <Section id="gates" title="Before a swap is shown">
        <P>Three checks run before any swap code is even loaded:</P>
        <List>
          <li>The token is on a chain we can route: Robinhood Chain or BNB Chain (LI.FI), or Solana (Jupiter).</li>
          <li>
            Your region may see it. The page asks <C>GET /api/geo</C>, which reads the country Cloudflare attaches to the request; no third-party geo service is called. The United States and comprehensively sanctioned countries (Cuba, Iran, North
            Korea, Syria) are not offered swaps. If the country cannot be told (no header, unknown, Tor), the swap is not shown; if the check itself fails, the page fails closed too.
          </li>
          <li>You tick “I understand” under a short notice. The tick is remembered in this browser only.</li>
        </List>
        <CodeBlock lang="bash" code={GEO} />
        <P>A blocked or unknown region still sees the gap, a gap alert button and the pool on DexScreener: never a dead end. The country is a guess from the IP address, not identity.</P>
      </Section>

      <Section id="evm" title="EVM chains: LI.FI">
        <P>
          On Robinhood Chain and BNB Chain the card is the LI.FI widget, locked to the token’s chain and connected to the site’s own wallet connection. For comparison it also shows what DeepCore’s router would give for the same payment (read
          through our cached <C>GET /api/deepcore/quote</C>); “Swap on DeepCore” opens deepcore.fun, nothing is executed from here.
        </P>
      </Section>

      <Section id="solana" title="Solana: Jupiter">
        <P>
          On Solana the card asks this site for a Jupiter quote and an unsigned transaction, so the browser talks only to gullylabs.xyz. Your wallet signs and sends it. The proxy applies the same region check (it answers <C>451</C> where swaps are
          not offered), caches quotes and limits the rate:
        </P>
        <Fields
          head={['Route', 'Limit', 'What it does']}
          rows={[
            ['GET /api/solana/jupiter/quote', '20 a minute per IP', 'A quote to buy the xStock with SOL or USDC, or sell it back; cached 10 s per pair and amount'],
            ['POST /api/solana/jupiter/swap', '6 a minute per IP', 'Turns a quote (valid 60 s) into an unsigned transaction for your wallet: { quoteId, userPublicKey }'],
            ['Slippage', '0.5%', 'Every quote states its minimum out and its price impact'],
          ]}
        />
        <CodeBlock lang="bash" code={JUP} />
        <P>
          More on Solana coverage: <DocLink to="solana">Solana</DocLink>.
        </P>
      </Section>

      <Section id="fees" title="Fees">
        <P>Any fee Gully Labs adds is set by the owner on the server and stated in the quote before you confirm. Exchanges and networks charge their own fees and slippage on top. What this build of the site says:</P>
        <Fields
          head={['Route', 'Router', 'Gully Labs fee on this build']}
          rows={[
            ['Robinhood Chain, BNB Chain', 'LI.FI', feeText()],
            ['Solana', 'Jupiter', jupiterFeeText()],
          ]}
        />
        <P>On Solana the fee and its recipient come from the same server-side record for the quote and the swap, so a page cannot ask for a different fee or recipient. A swap with no usable fee account carries no fee, and the quote says so.</P>
      </Section>

      <Section id="custody" title="What we never do">
        <Callout label="NON-CUSTODIAL">
          Gully Labs never holds your funds or your keys. Quotes and unsigned transactions come from LI.FI or Jupiter through our pages and proxy; your wallet signs and sends every transaction. Swaps are information and tooling, not investment advice.
        </Callout>
      </Section>
    </DocPage>
  )
}
