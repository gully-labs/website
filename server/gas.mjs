// GET /api/pay/gas: what a Gully Pay payment costs in gas right now on each chain, for the app's Merchant tab
// (its "NETWORK · LIVE" strip). The same reads as scripts/gas-report.mjs, cached for CACHE_MS and shared by
// every caller, so the public RPCs see one round per chain every few minutes at most:
//
//   gas price      eth_gasPrice on the chain
//   coin price     the chain's own Chainlink USD feed (payments.readFeed); when it cannot be read the USD
//                  figures are null with the reason, never a guess (the report script's Coinbase fallback is
//                  left out on purpose: a page should not show a price we did not read from the chain)
//   L1 data fee    OP Stack (Base, OP Mainnet) GasPriceOracle getL1Fee(sample tx); Arbitrum NodeInterface
//                  gasEstimateL1Component; none elsewhere
//   costs          a fee-proxy payment (106k gas) and a plain ERC-20 transfer (65k gas), L1 fee included
//
// A chain whose gas price cannot be read answers { ok: false, error }. Nothing is signed or sent.

import { ASSETS, CHAIN_LIST, FEE_PROXIES, readFeed, rpc } from './payments.mjs'

export const GAS = { approve: 46_000n, pay: 106_000n, transfer: 65_000n }
export const CACHE_MS = 3 * 60_000

// A representative EIP-1559 transaction body (the fee-proxy call), as in scripts/gas-report.mjs.
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

async function l1Fee(chainId, gasPrice) {
  if (chainId === 8453 || chainId === 10) {
    const out = await rpc(chainId, 'eth_call', [{ to: OP_ORACLE, data: SEL_GET_L1_FEE + w(32) + bytesArg(sampleTx) }, 'latest'])
    return { wei: BigInt(out), how: 'OP Stack L1 data fee (GasPriceOracle)' }
  }
  if (chainId === 42161) {
    const data = SEL_L1_COMPONENT + w(BigInt(FEE_PROXIES[42161] ?? OP_ORACLE)) + w(0) + w(96) + bytesArg('0x' + sampleTx.slice(230, 230 + 520))
    const out = await rpc(42161, 'eth_call', [{ to: ARB_NODE_INTERFACE, data }, 'latest'])
    return { wei: word(out, 0) * gasPrice, how: 'Arbitrum L1 data fee (NodeInterface)' }
  }
  return null
}

const round = (v, digits = 6) => (v == null ? null : Number(v.toPrecision(digits)))

async function readChain(c) {
  const row = { chainId: c.id, name: c.name, key: c.key, symbol: ASSETS.find((a) => a.chainId === c.id && a.kind === 'native')?.symbol ?? c.feed.description.split(' / ')[0], feeSplit: !!FEE_PROXIES[c.id] }
  let gasPrice
  try {
    gasPrice = BigInt(await rpc(c.id, 'eth_gasPrice', []))
  } catch (e) {
    return { ...row, ok: false, error: `gas price unreadable: ${String(e?.message ?? e).slice(0, 120)}` }
  }
  const out = { ...row, ok: true, gasPriceGwei: round(Number(gasPrice) / 1e9), coinUsd: null, priceSource: null, l1FeeUsd: null, l1: null, payUsd: null, transferUsd: null, approveUsd: null, note: null }
  const f = await readFeed(c.id)
  if (!f.ok) {
    out.note = 'coin price unreadable right now, so no USD cost'
    return out
  }
  const usd = Number(f.price.answer) / 10 ** f.price.decimals
  out.coinUsd = round(usd)
  out.priceSource = `Chainlink ${f.price.description}`
  let l1 = null
  try {
    l1 = await l1Fee(c.id, gasPrice)
  } catch (e) {
    out.l1 = `L1 data fee unreadable (${String(e?.message ?? e).slice(0, 60)})`
    out.note = 'L1 data fee unreadable: costs shown without it'
  }
  if (l1) {
    out.l1 = l1.how
    out.l1FeeUsd = round((Number(l1.wei) / 1e18) * usd)
  }
  const cost = (gas) => round((Number(gas * gasPrice) / 1e18) * usd + (out.l1FeeUsd ?? 0))
  out.payUsd = cost(GAS.pay)
  out.transferUsd = cost(GAS.transfer)
  out.approveUsd = cost(GAS.approve)
  return out
}

let cache = null // { at, value }
let inflight = null

/** The gas table, from the cache when it is younger than CACHE_MS. */
export async function readGas({ fresh = false } = {}) {
  if (!fresh && cache && Date.now() - cache.at < CACHE_MS) return cache.value
  if (inflight) return inflight
  inflight = (async () => {
    const chains = await Promise.all(CHAIN_LIST.filter((c) => !c.testnet).map((c) => readChain(c).catch((e) => ({ chainId: c.id, name: c.name, key: c.key, ok: false, error: String(e?.message ?? e).slice(0, 120) }))))
    const value = { at: new Date().toISOString(), cacheSeconds: CACHE_MS / 1000, gas: Object.fromEntries(Object.entries(GAS).map(([k, v]) => [k, Number(v)])), chains }
    cache = { at: Date.now(), value }
    return value
  })().finally(() => {
    inflight = null
  })
  return inflight
}

/** Test hook. */
export const clearGasCacheForTest = () => {
  cache = null
}

/** GET /api/pay/gas. Public, cached. */
export async function handleGas(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { Allow: 'GET', 'Content-Type': 'application/json' })
    return res.end(JSON.stringify({ error: 'GET only' }))
  }
  const value = await readGas()
  res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=60' })
  res.end(req.method === 'HEAD' ? undefined : JSON.stringify(value))
}
