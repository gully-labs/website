// Live gas-cost table for every Gully Pay EVM chain (server/payments.mjs CHAIN_LIST), read-only:
//
//   node scripts/gas-report.mjs            (GULLY_RPC_<chainId> overrides the public RPCs, as in the server)
//   node scripts/gas-report.mjs --json     (machine-readable)
//
// Per chain: gas price (eth_gasPrice), the coin's USD price (the chain's own Chainlink feed through payments.readFeed;
// Coinbase's spot rate as the fallback when the feed cannot be read), and the USD cost of the three Gully Pay
// transactions at measured gas:
//   approve   46,000 gas   ERC-20 approve(proxy, amount)        (Base Sepolia run: 35.5k–55.4k, contracts/TESTNET-RESULTS.md)
//   fee pay  106,000 gas   ERC20FeeProxy.transferFromWithReferenceAndFee (measured on Base Sepolia: two token legs + event)
//   transfer  65,000 gas   plain ERC-20 transfer (a fresh recipient balance slot)
// On rollups the L1 data fee is added: OP Stack chains (Base, OP Mainnet) through the GasPriceOracle predeploy
// 0x4200…000F getL1Fee(bytes) with a representative serialised transaction; Arbitrum through NodeInterface (0xC8)
// gasEstimateL1Component, which gives the L1 part as extra L2 gas at the current price. Ethereum, BNB Chain, Polygon
// and Avalanche have no L1 fee ("n/a"). Nothing is signed or sent.

import { CHAIN_LIST, FEE_PROXIES, readFeed, rpc } from '../server/payments.mjs'

const GAS = { approve: 46_000n, pay: 106_000n, transfer: 65_000n }
const JSON_OUT = process.argv.includes('--json')

// A representative EIP-1559 transaction body for the L1 data fee: the fee-proxy call (4 + 7*32 + 32 bytes of data)
// with signature and fields. OP's oracle charges by (compressed) size, so the exact bytes matter little; this is the
// shape of our largest transaction. ~ 110 bytes of envelope + 260 bytes of call data.
const sampleTx = '0x02f9' + '01' + 'aa'.repeat(110) + 'c219a14d' + '00'.repeat(12) + 'ab'.repeat(20) + '00'.repeat(12) + 'cd'.repeat(20) + '00'.repeat(31) + '64' + '00'.repeat(31) + 'c0' + '00'.repeat(31) + '01' + '00'.repeat(12) + 'ef'.repeat(20) + '00'.repeat(31) + '08' + '11'.repeat(8) + '00'.repeat(24) + 'ff'.repeat(65)

const OP_ORACLE = '0x420000000000000000000000000000000000000f'
const SEL_GET_L1_FEE = '0x49948e0e' // getL1Fee(bytes)
const ARB_NODE_INTERFACE = '0x00000000000000000000000000000000000000c8'
const SEL_L1_COMPONENT = '0x77d488a2' // gasEstimateL1Component(address,bool,bytes)
const w = (n) => BigInt.asUintN(256, BigInt(n)).toString(16).padStart(64, '0')
const bytesArg = (hex) => {
  const h = hex.replace(/^0x/, '')
  return w(h.length / 2) + h.padEnd(Math.ceil(h.length / 64) * 64, '0')
}
const word = (out, i) => BigInt('0x' + out.slice(2 + 64 * i, 66 + 64 * i))

/** L1 data fee in wei for the sample transaction, or null with a reason. */
async function l1Fee(chainId, gasPrice) {
  if (chainId === 8453 || chainId === 10) {
    const out = await rpc(chainId, 'eth_call', [{ to: OP_ORACLE, data: SEL_GET_L1_FEE + w(32) + bytesArg(sampleTx) }, 'latest'])
    return { wei: BigInt(out), how: 'OP GasPriceOracle getL1Fee(sample tx)' }
  }
  if (chainId === 42161) {
    // gasEstimateL1Component(to, contractCreation, data): (gasEstimateForL1, baseFee, l1BaseFeeEstimate)
    const data = SEL_L1_COMPONENT + w(BigInt(FEE_PROXIES[42161] ?? OP_ORACLE)) + w(0) + w(96) + bytesArg('0x' + sampleTx.slice(230, 230 + 520))
    const out = await rpc(42161, 'eth_call', [{ to: ARB_NODE_INTERFACE, data }, 'latest'])
    const l1Gas = word(out, 0)
    return { wei: l1Gas * gasPrice, how: `Arbitrum NodeInterface: ${l1Gas} L2 gas of L1 data at the current price` }
  }
  return { wei: null, how: 'n/a (not a rollup)' }
}

/** Coinbase spot rate as the fallback when the chain's feed is unreadable. */
async function coinbaseUsd(symbol) {
  const r = await fetch(`https://api.coinbase.com/v2/prices/${symbol}-USD/spot`, { signal: AbortSignal.timeout(8000) })
  const j = await r.json()
  return Number(j?.data?.amount)
}

const fmtUsd = (v) => (v == null ? '—' : v < 0.0001 ? `$${v.toFixed(7)}` : v < 0.01 ? `$${v.toFixed(5)}` : v < 1 ? `$${v.toFixed(4)}` : `$${v.toFixed(2)}`)
const fmtGwei = (wei) => {
  const g = Number(wei) / 1e9
  return g < 0.01 ? `${g.toFixed(5)} gwei` : g < 10 ? `${g.toFixed(3)} gwei` : `${g.toFixed(1)} gwei`
}

const rows = []
for (const c of CHAIN_LIST) {
  const row = { chainId: c.id, chain: c.name, symbol: c.feed.description.split(' / ')[0] }
  try {
    const gasPrice = BigInt(await rpc(c.id, 'eth_gasPrice', []))
    row.gasPriceWei = gasPrice.toString()
    row.gasPrice = fmtGwei(gasPrice)
    const f = await readFeed(c.id)
    let usd
    if (f.ok) {
      usd = Number(f.price.answer) / 10 ** f.price.decimals
      row.priceSource = `Chainlink ${f.price.description}`
    } else {
      usd = await coinbaseUsd(row.symbol === 'MATIC' ? 'POL' : row.symbol)
      row.priceSource = `Coinbase spot (feed: ${f.error.split('.')[0]})`
    }
    row.coinUsd = usd
    let l1 = { wei: null, how: 'n/a' }
    try {
      l1 = await l1Fee(c.id, gasPrice)
    } catch (e) {
      l1 = { wei: null, how: `L1 fee unreadable: ${String(e?.message ?? e).slice(0, 60)}` }
    }
    row.l1FeeHow = l1.how
    row.l1FeeUsd = l1.wei == null ? null : (Number(l1.wei) / 1e18) * usd
    const cost = (gas) => (Number(gas * gasPrice) / 1e18) * usd + (row.l1FeeUsd ?? 0)
    row.approveUsd = cost(GAS.approve)
    row.payUsd = cost(GAS.pay)
    row.transferUsd = cost(GAS.transfer)
    row.feeProxy = FEE_PROXIES[c.id] ?? null
  } catch (e) {
    row.error = String(e?.message ?? e)
  }
  rows.push(row)
}

if (JSON_OUT) {
  console.log(JSON.stringify({ at: new Date().toISOString(), gas: Object.fromEntries(Object.entries(GAS).map(([k, v]) => [k, Number(v)])), rows }, null, 2))
} else {
  const head = ['Chain', 'Gas price', 'Coin (USD)', 'Approve 46k', 'Fee pay 106k', 'Transfer 65k', 'L1 data fee', 'Price source']
  const table = rows.map((r) =>
    r.error ? [r.chain, `error: ${r.error.slice(0, 50)}`, '', '', '', '', '', ''] : [r.chain, r.gasPrice, `${r.symbol} ${r.coinUsd.toLocaleString('en-US', { maximumFractionDigits: r.coinUsd < 10 ? 4 : 2 })}`, fmtUsd(r.approveUsd), fmtUsd(r.payUsd), fmtUsd(r.transferUsd), r.l1FeeUsd == null ? r.l1FeeHow : `${fmtUsd(r.l1FeeUsd)} (${r.l1FeeHow.split(':')[0].split('(')[0].trim()})`, r.priceSource],
  )
  const widths = head.map((h, i) => Math.max(h.length, ...table.map((t) => String(t[i]).length)))
  const line = (cells) => '| ' + cells.map((c, i) => String(c).padEnd(widths[i])).join(' | ') + ' |'
  console.log(`Gully Pay gas report, ${new Date().toISOString()} (USD at the chain's Chainlink feed; L1 data fee included in the three costs where it applies)`)
  console.log(line(head))
  console.log('|' + widths.map((w) => '-'.repeat(w + 2)).join('|') + '|')
  for (const t of table) console.log(line(t))
}
process.exit(0)
