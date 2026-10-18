import { CodeBlock } from '../CodeBlock'
import { C, Callout, DocLink, DocPage, Ext, Fields, List, P, Section } from '../DocPage'
import { PoolDepth, SolanaGaps } from '../ProductCharts'

const sections = [
  { id: 'coverage', title: 'What we cover on Solana' },
  { id: 'live', title: 'Solana gaps now' },
  { id: 'fair', title: 'Fair price sources' },
  { id: 'onchain', title: 'Onchain price' },
  { id: 'holders', title: 'Holder Map on Solana' },
  { id: 'pay', title: 'Solana Pay in Gully Pay' },
  { id: 'swaps', title: 'Jupiter swaps' },
  { id: 'rpc', title: 'The RPC proxy' },
]

const CURL = `curl -s https://gullylabs.xyz/api/tracker | jq '.rows[] | select(.chain == "solana") | {ticker, symbol, gapPct, status, fairSource}'`

export function SolanaDocs() {
  return (
    <DocPage
      slug="solana"
      eyebrow="PRODUCTS · SOLANA"
      title="Solana"
      description="Gully Labs on Solana: xStocks in the tracker, fair prices from Chainlink or the issuer's quote, the Holder Map on Solana, Solana Pay in Gully Pay, and Jupiter swaps on stock pages."
      lead="Solana is the tracker’s third chain, beside Robinhood Chain and BNB Chain: xStocks are priced two ways like every other token, and Gully Pay accepts SOL, USDC and USDT."
      sections={sections}
    >
      <Section id="coverage" title="What we cover on Solana">
        <List>
          <li>
            <strong className="text-ink">Tracker</strong>: xStocks, Backed Finance’s tokenised stocks (SPL Token-2022), in the same row shape as the EVM chains, so history, movers, the heatmap, the bot’s <C>/gap</C> and <C>/top</C>, and
            gap alerts all work unchanged.
          </li>
          <li>
            <strong className="text-ink">Holder Map</strong>: the largest holders of each tracked xStock.
          </li>
          <li>
            <strong className="text-ink">Gully Pay</strong>: SOL, USDC and USDT through Solana Pay.
          </li>
          <li>
            <strong className="text-ink">Swaps</strong>: buy or sell an xStock with SOL or USDC through Jupiter, on its stock page.
          </li>
        </List>
      </Section>

      <Section id="live" title="Solana gaps now">
        <P>
          Each xStock’s gap to its fair price as the tracker reads it now, coloured by who priced fair. Rows without a gap (no pool, an unreadable feed, an unverified print) are listed by name with their status, never charted as zero.
        </P>
        <SolanaGaps />
        <PoolDepth chain="solana" top={10} />
        <CodeBlock lang="bash" code={CURL} />
      </Section>

      <Section id="fair" title="Fair price sources">
        <P>
          An xStock’s fair price is the underlying share’s price times the token’s own multiplier. xStocks carry Token-2022’s scaled UI amount extension: one token is <C>multiplier</C> shares (dividends raise it, splits multiply it). The multiplier is
          read from the mint every refresh, and a scheduled new one applies from its effective time.
        </P>
        <Fields
          head={['Source', 'fairSource', 'When it is used']}
          rows={[
            ['Chainlink equity feed on BNB Chain or Robinhood Chain', 'chainlink:56 / chainlink:4663', 'First choice: the same feeds the EVM rows use, read on chain'],
            ['Verified Chainlink feed on Ethereum', 'chainlink:1', 'When the share has a verified Ethereum feed'],
            ['The issuer’s quote', 'backed', 'When no Chainlink feed covers the share: Backed’s own xStocks API'],
          ]}
        />
        <P>
          Each row names its source in <C>fairSource</C>, and follows its feed’s own session (NYSE hours for BNB Chain feeds, 24/5 for Robinhood and Ethereum feeds). Outside the session, the gap is against the last session’s price. Details:{' '}
          <DocLink to="methodology">methodology</DocLink>.
        </P>
      </Section>

      <Section id="onchain" title="Onchain price">
        <P>
          DexScreener finds each token’s deepest pool (and reports liquidity and volume) once an hour. Between discoveries the price is read straight from the pool account when it is an Orca Whirlpool, a Raydium CLMM or a Meteora DLMM pool; each
          layout is checked against the pool’s own mints before it is believed. Any other pool keeps DexScreener’s price, labelled as an API reading with its time. The trust rules are the same as on every chain: a thin pool is never flagged, and an
          implausible gap is withheld as “unverified”.
        </P>
      </Section>

      <Section id="holders" title="Holder Map on Solana">
        <P>
          For xStocks the <DocLink to="holder-map">Holder Map</DocLink> reads the 20 largest token accounts over the Solana RPC and merges them by owner; owners that are program accounts are marked as such. Links between wallets (who sent to whom)
          are not read on Solana yet, so a Solana map has no clusters. When this server has no Solana RPC configured, the map says holder data is not available rather than showing an empty one.
        </P>
      </Section>

      <Section id="pay" title="Solana Pay in Gully Pay">
        <P>
          <DocLink to="gully-pay">Gully Pay</DocLink> accepts SOL, USDC and USDT on Solana, with the same quotes, ledger and reuse rule as the EVM chains. Each quote is a Solana Pay transfer request with its own <C>reference</C> key, so a wallet that
          follows the spec lets us find the payment without you pasting a signature.
        </P>
        <List>
          <li>A payment counts once its transaction is finalized and did not fail.</li>
          <li>SOL: the treasury’s own balance rose by the amount. USDC or USDT: the treasury’s associated token account for that mint rose by the amount, in that mint.</li>
          <li>SOL is priced by Chainlink’s SOL / USD feed (read on Arbitrum); an answer older than two hours gives no SOL quote.</li>
          <li>A signature can be used for one payment only, across every chain.</li>
        </List>
        <Callout label="OFF UNTIL SET">Solana checkout is on only when the owner has set the Solana treasury wallet. Unset, Solana assets are not offered and every page says so. There is never a fallback address.</Callout>
        <P>
          The full flow is on the <DocLink to="solana-pay">Solana Pay</DocLink> page.
        </P>
      </Section>

      <Section id="swaps" title="Jupiter swaps">
        <P>
          On a Solana stock page the swap card uses Jupiter: buy the xStock with SOL or USDC, or sell it back. Quotes and the unsigned transaction come through our proxy, behind the same region check as every swap; your wallet signs it. See{' '}
          <DocLink to="swaps">Swaps</DocLink>.
        </P>
      </Section>

      <Section id="rpc" title="The RPC proxy">
        <P>
          Pages talk to Solana only through this site. <C>POST /api/solana/rpc</C> is a narrow JSON-RPC proxy for wallet payments and swap status: it allows <C>getLatestBlockhash</C>, <C>getSignatureStatuses</C>, <C>getBalance</C>,{' '}
          <C>getTokenAccountsByOwner</C>, <C>getAccountInfo</C> (120 a minute per IP) and <C>sendTransaction</C> (10 a minute per IP). <C>GET /api/solana/pay/find?quote=&lt;id&gt;</C> lists signatures that touched a quote’s reference key (40 a minute
          per IP).
        </P>
        <P>
          Explorer links go to <Ext href="https://solscan.io">Solscan</Ext>.
        </P>
      </Section>
    </DocPage>
  )
}
