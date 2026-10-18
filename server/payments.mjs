// Gully Pay: the chains and assets a payment can be made in, how each is priced, and how a payment
// transaction is read from a public node. Used by plan checkout (billing.mjs) and general invoices
// (invoices.mjs). No custody: every payment is a plain transfer straight to GULLY_TREASURY_ADDRESS,
// the same EVM address on every chain listed here.
//
// Every contract address below was checked on its own chain on 2026-10-16 with eth_call:
//   tokens: symbol() and decimals();   feeds: description(), decimals() and latestRoundData().
//   Base      USDC 0x8335…2913 (USDC, 6)                 ETH / USD 0x7104…Bb70 (8 decimals)
//   Ethereum  USDC 0xA0b8…eB48 (USDC, 6), USDT 0xdAC1…1ec7 (USDT, 6)   ETH / USD 0x5f4e…8419 (8)
//   BNB Chain USDT 0x55d3…7955 (USDT, 18), USDC 0x8AC7…580d (USDC, 18)  BNB / USD 0x0567…2aeE (8)
//   Arbitrum  USDC 0xaf88…5831 (USDC, 6)                 ETH / USD 0x639F…a612 (8)
// Do not add an address here without checking it the same way.
//
// Env:
//   GULLY_TREASURY_ADDRESS        the receiving wallet (read in plans.mjs; no fallback, ever)
//   GULLY_RPC_<chainId>           comma-separated RPC URLs that replace the public defaults (tests use these)
//   GULLY_BASE_RPC                older name for GULLY_RPC_8453, still honoured
//   GULLY_MIN_CONFIRMATIONS       older override for Base's confirmations, still honoured
//   GULLY_CONFIRMATIONS_<chainId> confirmations for one chain
//   GULLY_TESTNET_CHAINS          TESTNET ONLY, unset in production: comma-separated testnet chain ids to offer as well
//                                 (only 84532, Base Sepolia, is known). Ignored when NODE_ENV=production.
//   GULLY_FEEPROXY_<chainId>      the ERC20FeeProxy on such a testnet chain (Request has none there; see
//                                 contracts/TESTNET-RESULTS.md). Read only for chains in GULLY_TESTNET_CHAINS.

import { keccak_256 } from './vendor/noble.mjs'
import { isSolanaAsset, readSolanaPayment, SOLANA_ASSETS, SOLANA_CHAIN, SOLANA_CHAIN_ID, solanaPayOn } from './solana-pay.mjs'

/** A Chainlink answer older than this is stale and no quote is given in that coin. */
export const FEED_MAX_AGE_SEC = 2 * 3600

export const CHAINS = {
  8453: {
    id: 8453,
    key: 'base',
    name: 'Base',
    explorer: 'https://basescan.org',
    explorerName: 'Basescan',
    confirmations: 10,
    rpcs: ['https://base.drpc.org', 'https://base-rpc.publicnode.com', 'https://mainnet.base.org', 'https://base-mainnet.public.blastapi.io', 'https://base.gateway.tenderly.co', 'https://1rpc.io/base'],
    feed: { address: '0x71041dddad3595f9ced3dccfbe3d1f4b0a16bb70', decimals: 8, description: 'ETH / USD', maxAgeSec: FEED_MAX_AGE_SEC },
  },
  1: {
    id: 1,
    key: 'ethereum',
    name: 'Ethereum',
    explorer: 'https://etherscan.io',
    explorerName: 'Etherscan',
    confirmations: 6,
    rpcs: ['https://eth.drpc.org', 'https://eth-mainnet.public.blastapi.io', 'https://rpc.mevblocker.io', 'https://ethereum-rpc.publicnode.com', 'https://rpc.flashbots.net', 'https://mainnet.gateway.tenderly.co'],
    feed: { address: '0x5f4ec3df9cbd43714fe2740f5e3616155c5b8419', decimals: 8, description: 'ETH / USD', maxAgeSec: FEED_MAX_AGE_SEC },
  },
  56: {
    id: 56,
    key: 'bnb',
    name: 'BNB Chain',
    explorer: 'https://bscscan.com',
    explorerName: 'BscScan',
    confirmations: 15,
    rpcs: ['https://bsc-rpc.publicnode.com', 'https://bsc-dataseed1.ninicoin.io', 'https://bsc-dataseed.bnbchain.org', 'https://bsc-dataseed1.defibit.io', 'https://bsc-dataseed3.bnbchain.org', 'https://bsc-dataseed2.bnbchain.org'],
    feed: { address: '0x0567f2323251f0aab15c8dfb1967e4e8a7d42aee', decimals: 8, description: 'BNB / USD', maxAgeSec: FEED_MAX_AGE_SEC },
  },
  42161: {
    id: 42161,
    key: 'arbitrum',
    name: 'Arbitrum',
    explorer: 'https://arbiscan.io',
    explorerName: 'Arbiscan',
    confirmations: 10,
    rpcs: ['https://arbitrum.drpc.org', 'https://arbitrum-one-rpc.publicnode.com', 'https://arb1.arbitrum.io/rpc', 'https://arbitrum.gateway.tenderly.co', 'https://arbitrum.meowrpc.com', 'https://1rpc.io/arb'],
    feed: { address: '0x639fe6ab55c921f74e7fac1ee960c0b6293ba612', decimals: 8, description: 'ETH / USD', maxAgeSec: FEED_MAX_AGE_SEC },
  },
}

// Solana (solana-pay.mjs): offered only while GULLY_SOLANA_TREASURY is set.
CHAINS[SOLANA_CHAIN_ID] = SOLANA_CHAIN

// TESTNET ONLY, for live tests of the payment paths (scripts/testnet-fee-proxy.mjs, scripts/testnet-server-e2e.mjs).
// Off unless GULLY_TESTNET_CHAINS names the chain, and never when NODE_ENV=production, so production never offers a
// testnet. Base Sepolia USDC is Circle's (symbol USDC, 6 decimals) and the feed is Chainlink's ETH / USD there,
// both checked with eth_call on 2026-10-17.
const TESTNETS = {
  84532: {
    chain: { id: 84532, key: 'base-sepolia', name: 'Base Sepolia', testnet: true, explorer: 'https://sepolia.basescan.org', explorerName: 'Basescan (Sepolia)', confirmations: 2, rpcs: ['https://sepolia.base.org', 'https://base-sepolia-rpc.publicnode.com'], feed: { address: '0x4adc67696ba383f43dd60a9e78f2c97fbbfc7cb1', decimals: 8, description: 'ETH / USD', maxAgeSec: FEED_MAX_AGE_SEC } },
    assets: [
      { id: 'base-sepolia-usdc', chainId: 84532, symbol: 'USDC', name: 'USD Coin (testnet)', kind: 'token', address: '0x036cbd53842c5426634e7929541ec2318f3dcf7e', decimals: 6 },
      { id: 'base-sepolia-eth', chainId: 84532, symbol: 'ETH', name: 'Ether (testnet)', kind: 'native', address: null, decimals: 18 },
    ],
  },
}
const TESTNET_IDS = process.env.NODE_ENV === 'production' ? [] : [...new Set(String(process.env.GULLY_TESTNET_CHAINS ?? '').split(',').map((s) => Number(s.trim())))].filter((id) => TESTNETS[id])
for (const id of TESTNET_IDS) CHAINS[id] = TESTNETS[id].chain

/** The EVM chains in display order (object keys that are numbers would sort by id). Testnets only when enabled. */
export const CHAIN_LIST = [8453, 1, 56, 42161, ...TESTNET_IDS].map((id) => CHAINS[id])
/** Every chain a payment can be made on right now: the EVM chains, plus Solana when its treasury is set. */
export const publicChains = () => [...CHAIN_LIST, ...(solanaPayOn() ? [SOLANA_CHAIN] : [])]

/** Accepted assets, in the order the picker shows them. `native` coins are priced by their chain's feed. */
export const ASSETS = [
  { id: 'base-usdc', chainId: 8453, symbol: 'USDC', name: 'USD Coin', kind: 'token', address: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', decimals: 6 },
  { id: 'base-eth', chainId: 8453, symbol: 'ETH', name: 'Ether', kind: 'native', address: null, decimals: 18 },
  { id: 'eth-usdc', chainId: 1, symbol: 'USDC', name: 'USD Coin', kind: 'token', address: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', decimals: 6 },
  { id: 'eth-usdt', chainId: 1, symbol: 'USDT', name: 'Tether USD', kind: 'token', address: '0xdac17f958d2ee523a2206206994597c13d831ec7', decimals: 6 },
  { id: 'eth-eth', chainId: 1, symbol: 'ETH', name: 'Ether', kind: 'native', address: null, decimals: 18 },
  { id: 'bnb-usdt', chainId: 56, symbol: 'USDT', name: 'Tether USD', kind: 'token', address: '0x55d398326f99059ff775485246999027b3197955', decimals: 18 },
  { id: 'bnb-usdc', chainId: 56, symbol: 'USDC', name: 'USD Coin', kind: 'token', address: '0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d', decimals: 18 },
  { id: 'bnb-bnb', chainId: 56, symbol: 'BNB', name: 'BNB', kind: 'native', address: null, decimals: 18 },
  { id: 'arb-usdc', chainId: 42161, symbol: 'USDC', name: 'USD Coin', kind: 'token', address: '0xaf88d065e77c8cc2239327c5edb3a432268e5831', decimals: 6 },
  { id: 'arb-eth', chainId: 42161, symbol: 'ETH', name: 'Ether', kind: 'native', address: null, decimals: 18 },
  ...SOLANA_ASSETS,
  ...TESTNET_IDS.flatMap((id) => TESTNETS[id].assets),
]
export const ASSET_IDS = ASSETS.map((a) => a.id)
export const assetById = (id) => ASSETS.find((a) => a.id === id) ?? null
export const DEFAULT_ASSET = 'base-usdc'

/** Confirmations a payment on this chain needs before it counts. */
export function confirmationsFor(chainId) {
  const own = Number(process.env[`GULLY_CONFIRMATIONS_${chainId}`])
  if (Number.isInteger(own) && own >= 1) return own
  if (chainId === 8453 && Number(process.env.GULLY_MIN_CONFIRMATIONS) >= 1) return Math.floor(Number(process.env.GULLY_MIN_CONFIRMATIONS))
  return CHAINS[chainId].confirmations
}

/** RPC URLs for a chain, tried in order. */
export function rpcsFor(chainId) {
  const env = String(process.env[`GULLY_RPC_${chainId}`] ?? (chainId === 8453 ? (process.env.GULLY_BASE_RPC ?? '') : '')).trim()
  return env ? env.split(',').map((s) => s.trim()).filter(Boolean) : CHAINS[chainId].rpcs
}

export const txUrl = (chainId, hash) => `${CHAINS[chainId].explorer}/tx/${hash}`
export const addressUrl = (chainId, a) => `${CHAINS[chainId].explorer}/address/${a}`

/** What the browser is told about the assets: no RPC URLs, nothing secret. */
export function publicAssets() {
  return ASSETS.filter((a) => !isSolanaAsset(a) || solanaPayOn()).map((a) => {
    const c = CHAINS[a.chainId]
    return { id: a.id, chainId: a.chainId, chain: c.name, chainKey: c.key, symbol: a.symbol, name: a.name, kind: a.kind, address: a.address, decimals: a.decimals, confirmations: confirmationsFor(a.chainId), explorer: c.explorer, feed: a.kind === 'native' ? { address: c.feed.address, description: c.feed.description } : null }
  })
}

/* ------------------------------------------------------------- amounts --- */

/** Raw units as a trimmed decimal string, e.g. (49000123n, 6) -> "49.000123". BigInt only. */
export function fmtUnits(raw, decimals) {
  const r = BigInt(raw)
  const neg = r < 0n
  const a = neg ? -r : r
  const base = 10n ** BigInt(decimals)
  const frac = (a % base).toString().padStart(decimals, '0').replace(/0+$/, '')
  return `${neg ? '-' : ''}${a / base}${frac ? '.' + frac : ''}`
}

/** "49", "49.5", "1200.00" -> cents as a BigInt; null when not a positive amount with at most 2 decimals. */
export function parseUsdCents(v) {
  const s = typeof v === 'number' ? String(v) : String(v ?? '').trim()
  const m = s.match(/^(\d{1,9})(?:\.(\d{1,2}))?$/)
  if (!m) return null
  const cents = BigInt(m[1]) * 100n + BigInt((m[2] ?? '').padEnd(2, '0'))
  return cents > 0n ? cents : null
}

export const fmtUsd = (cents) => {
  const c = BigInt(cents)
  const r = c % 100n
  return `${(c / 100n).toLocaleString('en-US')}${r ? '.' + r.toString().padStart(2, '0') : ''}`
}

/** The highest tag: a tag moves the amount by at most 9 999 units of the tag step. */
export const MAX_TAG = 9_999
/** Native coins are quoted on a grid of 1e9 wei (9 decimals); the tag sits in the last four of them. */
const NATIVE_STEP = 10n ** 9n

/**
 * The amount a quote asks for, before and after its unique tag.
 *   stablecoin: the USD amount at 1:1, plus tag millionths (0.000001 to 0.009999).
 *   native coin: USD / feed price rounded UP to 9 decimals, plus tag × 0.000000001.
 */
export function quoteAmount(asset, usdCents, tag, price) {
  const cents = BigInt(usdCents)
  if (asset.kind === 'token') {
    const base = cents * 10n ** BigInt(asset.decimals - 2)
    return { base, amount: base + BigInt(tag) * 10n ** BigInt(asset.decimals - 6) }
  }
  const answer = BigInt(price.answer)
  const num = cents * 10n ** BigInt(asset.decimals + price.decimals)
  const den = answer * 100n
  const wei = (num + den - 1n) / den
  // SOL (tagStep 1 lamport): the base is rounded up to 1e4 lamports and the tag fills the last four digits.
  const step = asset.tagStep ? BigInt(asset.tagStep) : NATIVE_STEP
  const grid = asset.tagStep ? step * 10_000n : NATIVE_STEP
  const base = ((wei + grid - 1n) / grid) * grid
  return { base, amount: base + BigInt(tag) * step }
}

/* ----------------------------------------------------------------- rpc --- */

const chainIdOk = new Map() // url -> true once eth_chainId matched

/* Automatic fallback: a URL that times out, answers an HTTP error, rate-limits or returns a non-JSON
   page steps aside for a cool-off (30 s, doubling to 10 min while it keeps failing). Healthy URLs are
   tried first in their configured order; cooling ones only when nothing healthy is left. A plain
   JSON-RPC error from a working node (e.g. an execution revert) does not mark the node unhealthy. */
const cooling = new Map() // url -> { until, strikes }
const isNodeFault = (e) => e?.nodeFault === true

function strike(url) {
  const c = cooling.get(url) ?? { until: 0, strikes: 0 }
  c.strikes = Math.min(c.strikes + 1, 6)
  c.until = Date.now() + Math.min(30_000 * 2 ** (c.strikes - 1), 600_000)
  cooling.set(url, c)
}

/** URLs in the order to try: healthy first, then cooling (soonest back first). */
export function rpcOrder(chainId) {
  const now = Date.now()
  const all = rpcsFor(chainId)
  const healthy = all.filter((u) => (cooling.get(u)?.until ?? 0) <= now)
  const cold = all.filter((u) => (cooling.get(u)?.until ?? 0) > now).sort((a, b) => cooling.get(a).until - cooling.get(b).until)
  return [...healthy, ...cold]
}

async function post(url, method, params) {
  let res
  try {
    res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: AbortSignal.timeout(6_000) })
  } catch (e) {
    throw Object.assign(new Error(`${new URL(url).host}: ${e?.name === 'TimeoutError' ? 'timed out' : 'unreachable'}`), { nodeFault: true })
  }
  if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}`), { nodeFault: true })
  const j = await res.json().catch(() => null)
  if (!j || typeof j !== 'object') throw Object.assign(new Error('not a JSON-RPC answer'), { nodeFault: true })
  if (j.error) {
    const msg = String(j.error.message ?? 'RPC error')
    throw Object.assign(new Error(msg), { nodeFault: /rate|limit|too many|quota|api ?key|unauthori[sz]ed|forbidden|capacity|upgrade/i.test(msg) })
  }
  return j.result
}

/** One JSON-RPC call on a chain. Each URL must first prove it serves that chain (eth_chainId). */
export async function rpc(chainId, method, params) {
  let last
  for (const url of rpcOrder(chainId)) {
    try {
      if (!chainIdOk.get(url)) {
        const id = await post(url, 'eth_chainId', [])
        if (typeof id !== 'string' || Number(BigInt(id)) !== chainId) throw new Error(`node at ${new URL(url).host} is not on chain ${chainId}`)
        chainIdOk.set(url, true)
      }
      const out = await post(url, method, params)
      cooling.delete(url)
      return out
    } catch (e) {
      last = e
      if (isNodeFault(e) || /not on chain/.test(String(e?.message))) strike(url)
    }
  }
  throw last ?? new Error('no RPC configured')
}

/* --------------------------------------------------------------- feeds --- */

const LATEST_ROUND_DATA = '0xfeaf968c'
const feedCache = new Map() // chainId -> { at, value }

/**
 * Chainlink's latest answer on a chain, as { ok: true, price } or { ok: false, status, error }.
 * price = { feed, description, decimals, roundId, answer, updatedAt, readAt } (big numbers as strings).
 */
export async function readFeed(chainId) {
  const c = CHAINS[chainId]
  const hit = feedCache.get(chainId)
  let price = hit && Date.now() - hit.at < 30_000 ? hit.value : null
  if (!price) {
    let out
    try {
      // A chain without feeds of its own (Solana) names the EVM chain its feed is read on (feed.chainId).
      out = await rpc(c.feed.chainId ?? chainId, 'eth_call', [{ to: c.feed.address, data: LATEST_ROUND_DATA }, 'latest'])
    } catch (e) {
      return { ok: false, status: 502, error: `The ${c.feed.description} price on ${c.name} could not be read just now (${String(e?.message ?? e)}). Pay in a stablecoin or try again shortly.` }
    }
    if (typeof out !== 'string' || out.length < 2 + 64 * 5) return { ok: false, status: 502, error: `The ${c.feed.description} feed on ${c.name} gave an unreadable answer. Pay in a stablecoin or try again shortly.` }
    const word = (i) => BigInt('0x' + out.slice(2 + 64 * i, 66 + 64 * i))
    let answer = word(1)
    if (answer >= 1n << 255n) answer -= 1n << 256n // int256
    price = { feed: c.feed.address, description: c.feed.description, decimals: c.feed.decimals, roundId: word(0).toString(), answer: answer.toString(), updatedAt: new Date(Number(word(3)) * 1000).toISOString(), readAt: new Date().toISOString() }
    feedCache.set(chainId, { at: Date.now(), value: price })
  }
  const age = (Date.now() - Date.parse(price.updatedAt)) / 1000
  if (BigInt(price.answer) <= 0n) return { ok: false, status: 503, error: `The ${c.feed.description} feed on ${c.name} reports no valid price. Pay in a stablecoin for now.` }
  if (age > c.feed.maxAgeSec || age < -300) return { ok: false, status: 503, error: `The ${c.feed.description} price on ${c.name} is stale (last updated ${price.updatedAt}), so no quote is given in that coin. Pay in a stablecoin or try again later.` }
  return { ok: true, price }
}

/** Test hook: forget cached feed answers. */
export const clearFeedCacheForTest = () => feedCache.clear()

/* ----------------------------------------------------- reading a payment --- */

const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'
const lower = (v) => (typeof v === 'string' ? v.toLowerCase() : null)
const topicAddress = (t) => (typeof t === 'string' && t.length === 66 ? '0x' + t.slice(26).toLowerCase() : null)
const isHexQty = (v) => typeof v === 'string' && /^0x[0-9a-fA-F]+$/.test(v)

/** Looks for a hash on the other chains, to explain "wrong chain" instead of "not found". */
async function findElsewhere(chainId, txHash) {
  const others = CHAIN_LIST.filter((c) => c.id !== chainId)
  const found = await Promise.all(others.map((c) => rpc(c.id, 'eth_getTransactionByHash', [txHash]).then((t) => (t ? c : null), () => null)))
  return found.find(Boolean) ?? null
}

/**
 * Reads a transaction on the asset's chain and lists what it paid the treasury in that asset.
 * Resolves to
 *   { ok: true, credits: [{ from, value }], blockNumber, blockHex, confirmations, needed }
 *   { ok: false, status, error, pending?, confirmations?, needed? }
 * The receipt and the transaction are read separately and must agree (hash, block, sender, chain).
 * Amounts are BigInt throughout.
 */
export async function readPayment(asset, txHash, treasury, opts = {}) {
  if (isSolanaAsset(asset)) return readSolanaPayment(asset, txHash, treasury, opts)
  const c = CHAINS[asset.chainId]
  const needed = confirmationsFor(c.id)
  let receipt, tx, head
  try {
    ;[receipt, tx, head] = await Promise.all([rpc(c.id, 'eth_getTransactionReceipt', [txHash]), rpc(c.id, 'eth_getTransactionByHash', [txHash]), rpc(c.id, 'eth_blockNumber', [])])
  } catch (e) {
    return { ok: false, status: 502, error: `${c.name} could not be read just now (${String(e?.message ?? e)}). Try again in a minute.` }
  }
  if (!receipt && !tx) {
    const other = await findElsewhere(c.id, txHash)
    if (other) return { ok: false, status: 422, error: `This transaction is on ${other.name}, but this payment was quoted on ${c.name}. Choose ${other.name} and the same asset to have it checked, or write to hello@gullylabs.xyz with the hash.` }
    return { ok: false, status: 202, pending: true, confirmations: 0, needed, error: `${c.name} does not know this transaction yet. If you just sent it, wait a few seconds and check again.` }
  }
  if (!receipt) return { ok: false, status: 202, pending: true, confirmations: 0, needed, error: `The transaction is waiting to be included in a block on ${c.name}.` }
  if (!tx || !isHexQty(receipt.blockNumber) || !isHexQty(tx.blockNumber ?? '')) return { ok: false, status: 502, error: `${c.name}'s node gave an incomplete answer for this transaction. Try again in a minute.` }
  if (tx.chainId != null && isHexQty(tx.chainId) && Number(BigInt(tx.chainId)) !== c.id) return { ok: false, status: 422, error: `This transaction was signed for chain ${Number(BigInt(tx.chainId))}, not ${c.name}.` }
  const agree = lower(receipt.transactionHash) === txHash && lower(tx.hash) === txHash && BigInt(tx.blockNumber) === BigInt(receipt.blockNumber) && (!receipt.from || lower(receipt.from) === lower(tx.from))
  if (!agree) return { ok: false, status: 502, error: `${c.name}'s node gave answers that do not agree for this transaction. Try again in a minute.` }
  if (receipt.status !== '0x1') return { ok: false, status: 422, error: 'This transaction failed on chain, so nothing was paid.' }

  const blockNumber = Number(BigInt(receipt.blockNumber))
  const confirmations = Math.max(0, Number(BigInt(head)) - blockNumber + 1)
  const base = { ok: true, blockNumber, blockHex: receipt.blockNumber, confirmations, needed }

  if (asset.kind === 'native') {
    const to = lower(tx.to)
    const value = isHexQty(tx.value) ? BigInt(tx.value) : 0n
    if (to !== treasury) return { ok: false, status: 422, error: to ? `This transaction sent ${asset.symbol} to another address, not to the Gully Labs treasury.` : 'This transaction created a contract; it paid nothing to the treasury.' }
    if (value === 0n) return { ok: false, status: 422, error: `This transaction sent no ${asset.symbol} to the treasury. Paying in ${asset.symbol} is a plain transfer of the coin, not a token.` }
    return { ...base, credits: [{ from: lower(tx.from), value }] }
  }

  const transfers = (receipt.logs ?? [])
    .filter((l) => Array.isArray(l.topics) && lower(l.topics[0]) === TRANSFER_TOPIC && l.topics.length === 3)
    .map((l) => ({ token: lower(l.address), from: topicAddress(l.topics[1]), to: topicAddress(l.topics[2]), value: isHexQty(l.data) ? BigInt(l.data) : 0n }))
  const credits = transfers.filter((x) => x.token === asset.address && x.to === treasury).map(({ from, value }) => ({ from, value }))
  if (!credits.length) {
    const short = `${asset.address.slice(0, 6)}…${asset.address.slice(-4)}`
    if (transfers.some((x) => x.to === treasury)) return { ok: false, status: 422, error: `This transaction sent a token other than ${asset.symbol} on ${c.name} to the treasury. Only ${asset.symbol} (${short}) counts.` }
    if (transfers.some((x) => x.token === asset.address)) return { ok: false, status: 422, error: `This transaction sent ${asset.symbol}, but not to the Gully Labs treasury address.` }
    if (lower(tx.to) === treasury && isHexQty(tx.value) && BigInt(tx.value) > 0n) return { ok: false, status: 422, error: `This transaction sent the chain's own coin, not ${asset.symbol}. Choose the coin as the asset to pay with it.` }
    return { ok: false, status: 422, error: `This transaction has no ${asset.symbol} transfer to the Gully Labs treasury.` }
  }
  return { ...base, credits: creditFeeProxy(asset, receipt, treasury, credits) }
}

/** Unix ms at which a block was mined, or null when the node cannot say. */
export async function blockTime(chainId, blockHex) {
  const b = await rpc(chainId, 'eth_getBlockByNumber', [blockHex, false])
  return b?.timestamp ? Number(BigInt(b.timestamp)) * 1000 : null
}

/* ---------------------------------------------------- wallet links (QR) --- */

/** EIP-55 mixed-case checksum of an address (wallets reading a QR check it). */
export function checksumAddress(a) {
  const lowerHex = String(a).toLowerCase().replace(/^0x/, '')
  if (!/^[0-9a-f]{40}$/.test(lowerHex)) throw new Error('not an address')
  const h = keccak_256(new TextEncoder().encode(lowerHex))
  let out = '0x'
  for (let i = 0; i < 40; i++) {
    const nibble = (h[i >> 1] >> (i % 2 ? 0 : 4)) & 15
    out += nibble >= 8 ? lowerHex[i].toUpperCase() : lowerHex[i]
  }
  return out
}

/**
 * The EIP-681 payment request for an exact amount, built from base units with BigInt only:
 *   native coin  ethereum:<treasury>@<chainId>?value=<wei>
 *   ERC-20       ethereum:<token>@<chainId>/transfer?address=<treasury>&uint256=<baseUnits>
 * Wallet support varies, so the pay page also shows the address, amount and token to copy by hand.
 */
export function paymentUri(asset, treasuryAddress, amountRaw) {
  const units = BigInt(amountRaw)
  if (units <= 0n) throw new Error('amount must be positive')
  const to = checksumAddress(treasuryAddress)
  if (asset.kind === 'native') return `ethereum:${to}@${asset.chainId}?value=${units.toString()}`
  return `ethereum:${checksumAddress(asset.address)}@${asset.chainId}/transfer?address=${to}&uint256=${units.toString()}`
}

/* ------------------------------------- fee split (Request ERC20FeeProxy) --- */
// One transaction pays a merchant and Gully Labs' fee: Request Network's ERC20FeeProxy (MIT, immutable, no
// owner, holds nothing) does transferFrom(payer -> merchant, amount) and transferFrom(payer -> feeAddress, fee),
// then emits TransferWithReferenceAndFee. Why this contract, the addresses and their checks: contracts/CHOICE.md.
// Tokens only: Request's native-coin proxy sends the fee with a 2300-gas transfer(), which a Safe treasury
// cannot receive (contracts/test, fork tests), so coin payments stay plain transfers with the fee invoiced.

/** ERC20FeeProxy by chain, lowercase. Bytecode checked with eth_getCode; behaviour checked by fork tests. */
export const FEE_PROXIES = {
  1: '0x370de27fdb7d1ff1e1baa7d11c5820a324cf623c', // Request "0.2.0" on Ethereum (the address its SDK uses)
  8453: '0x1892196e80c4c17ea5100da765ab48c1fe2fb814',
  56: '0x0dfbee143b42b41efc5a6f87bfd1ffc78c2f0ac9',
  42161: '0x0dfbee143b42b41efc5a6f87bfd1ffc78c2f0ac9',
}
// A testnet's proxy is the one we deployed there (GULLY_FEEPROXY_<chainId>), only while that testnet is enabled.
for (const id of TESTNET_IDS) {
  const a = String(process.env[`GULLY_FEEPROXY_${id}`] ?? '').trim().toLowerCase()
  if (/^0x[0-9a-f]{40}$/.test(a)) FEE_PROXIES[id] = a
}
const hexOf = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
const keccakHex = (s) => '0x' + hexOf(keccak_256(new TextEncoder().encode(s)))
/** topic0 of TransferWithReferenceAndFee(address,address,uint256,bytes indexed,uint256,address). */
export const FEE_PROXY_TOPIC = keccakHex('TransferWithReferenceAndFee(address,address,uint256,bytes,uint256,address)')
const SEL_PAY = keccakHex('transferFromWithReferenceAndFee(address,address,uint256,bytes,uint256,address)').slice(2, 10)
const SEL_APPROVE = '095ea7b3'
const w256 = (n) => BigInt.asUintN(256, BigInt(n)).toString(16).padStart(64, '0')
const wAddr = (a) => String(a).toLowerCase().replace(/^0x/, '').padStart(64, '0')
const okAddr = (a) => typeof a === 'string' && /^0x[0-9a-fA-F]{40}$/.test(a) && !/^0x0{40}$/.test(a)

/** The 8-byte payment reference for a quote (the proxy indexes keccak256 of it as topic1). */
export const paymentReference = (quoteId) => '0x' + hexOf(keccak_256(new TextEncoder().encode(`gully-pay:${quoteId}`))).slice(0, 16)

/** floor(amountRaw * bps / 10000), BigInt. */
export const feeOf = (amountRaw, bps) => (BigInt(amountRaw) * BigInt(bps)) / 10_000n

/**
 * Marks a quote to be paid through the fee proxy: of `amountRaw` (what the payer sends in total), `feeRaw` goes
 * to `feeTo` (the treasury) and the rest to the quote's recipient (`quote.treasury`). Leaves native coin, chains
 * without a proxy and zero fees alone (plain transfer, fee invoiced as before). Returns the quote.
 * `feeRaw`, when given, is the fee in the token's base units as sized by the caller (a store's fee covers only
 * the part of the payment above its free allowance, merchants.mjs); otherwise it is `bps` of the whole amount.
 * A fee that is not below the amount is refused.
 */
export function withFeeSplit(quote, { bps, feeTo, feeRaw = null }) {
  const a = assetById(quote.assetId)
  const fee = feeRaw != null ? BigInt(feeRaw) : feeOf(quote.amountRaw, bps)
  if (!a || a.kind !== 'token' || !FEE_PROXIES[a.chainId] || fee <= 0n || fee >= BigInt(quote.amountRaw) || !okAddr(feeTo) || !okAddr(quote.treasury)) return quote
  if (feeTo.toLowerCase() === quote.treasury.toLowerCase()) return quote
  return Object.assign(quote, { feeRaw: fee.toString(), feeTo: feeTo.toLowerCase(), ref: paymentReference(quote.id) })
}

/**
 * What the wallet sends for a split quote, built here so the page only relays it:
 *   approve: token.approve(proxy, amountRaw)   (skipped by the page when the allowance already covers it)
 *   pay:     proxy.transferFromWithReferenceAndFee(token, recipient, amountRaw - feeRaw, ref, feeRaw, feeTo)
 * null for a quote without a split.
 */
export function quoteSplit(quote) {
  const a = assetById(quote?.assetId)
  const proxy = a && FEE_PROXIES[a.chainId]
  if (!proxy || a.kind !== 'token' || !quote.feeRaw || !quote.feeTo || !quote.ref) return null
  const total = BigInt(quote.amountRaw)
  const fee = BigInt(quote.feeRaw)
  if (fee <= 0n || fee >= total) return null
  const ref = quote.ref.replace(/^0x/, '')
  const refWords = ref.padEnd(Math.ceil(ref.length / 64) * 64, '0')
  const data = '0x' + SEL_PAY + wAddr(a.address) + wAddr(quote.treasury) + w256(total - fee) + w256(6 * 32) + w256(fee) + wAddr(quote.feeTo) + w256(ref.length / 2) + refWords
  return {
    proxy,
    spender: proxy,
    ref: quote.ref,
    merchantRaw: (total - fee).toString(),
    feeRaw: fee.toString(),
    feeTo: quote.feeTo,
    approve: { to: a.address, data: '0x' + SEL_APPROVE + wAddr(proxy) + w256(total) },
    approveReset: { to: a.address, data: '0x' + SEL_APPROVE + wAddr(proxy) + w256(0) },
    pay: { to: proxy, data },
  }
}

/**
 * Fee-proxy payments in a receipt to `payee` in `asset` whose fee went to `feeTo`, each backed by the two
 * Transfer logs it caused: [{ from, amount, fee, ref }] (BigInt amounts; ref = keccak256 of the reference).
 */
export function feeProxyPayments(asset, receipt, payee, feeTo) {
  const proxy = FEE_PROXIES[asset.chainId]
  if (!proxy || asset.kind !== 'token' || !payee || !feeTo || payee === feeTo) return []
  const logs = receipt?.logs ?? []
  const transfer = (from, to, value) => logs.some((l) => lower(l.address) === asset.address && Array.isArray(l.topics) && lower(l.topics[0]) === TRANSFER_TOPIC && topicAddress(l.topics[1]) === from && topicAddress(l.topics[2]) === to && isHexQty(l.data) && BigInt(l.data) === value)
  const out = []
  for (const l of logs) {
    if (lower(l.address) !== proxy || !Array.isArray(l.topics) || lower(l.topics[0]) !== FEE_PROXY_TOPIC || typeof l.data !== 'string' || l.data.length !== 2 + 5 * 64) continue
    const word = (i) => l.data.slice(2 + i * 64, 2 + (i + 1) * 64)
    const [token, to, feeAddress] = [word(0), word(1), word(4)].map((x) => '0x' + x.slice(24))
    const amount = BigInt('0x' + word(2))
    const fee = BigInt('0x' + word(3))
    if (token !== asset.address || to !== payee || feeAddress !== feeTo || fee === 0n) continue
    // The payer is whoever the merchant leg came from; the fee leg must come from the same wallet.
    const leg = logs.find((x) => lower(x.address) === asset.address && Array.isArray(x.topics) && lower(x.topics[0]) === TRANSFER_TOPIC && topicAddress(x.topics[2]) === payee && isHexQty(x.data) && BigInt(x.data) === amount)
    const from = leg && topicAddress(leg.topics[1])
    if (!from || !transfer(from, feeAddress, fee)) continue
    out.push({ from, amount, fee, ref: lower(l.topics[1]) ?? null })
  }
  return out
}

/** The treasury (fee recipient) from the environment, lowercase, or null. Same rule as plans.treasury(). */
const envTreasury = () => {
  const t = String(process.env.GULLY_TREASURY_ADDRESS ?? '').trim()
  return okAddr(t) ? t.toLowerCase() : null
}

/**
 * readPayment's credits with fee-proxy payments made whole: the merchant leg's credit becomes amount + fee
 * (what the payer paid against the quote) and carries { fee, ref }. Plain transfers pass through unchanged.
 */
export function creditFeeProxy(asset, receipt, payee, credits, feeTo = envTreasury()) {
  const out = credits.map((c) => ({ ...c }))
  for (const p of feeProxyPayments(asset, receipt, payee, feeTo)) {
    const c = out.find((x) => x.from === p.from && x.value === p.amount && x.fee == null)
    if (c) Object.assign(c, { value: p.amount + p.fee, fee: p.fee, ref: p.ref })
  }
  return out
}
