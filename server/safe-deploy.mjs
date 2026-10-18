// One-click Safe deployment for Gully Pay: deploy a Safe (multisig) at the SAME address on another chain,
// or a brand-new one, from inside the app, with the user's own wallet signing. The server never holds a
// key and never sends a transaction: it works out the exact factory call, the user's wallet sends it.
//
// Why: a Safe exists only on the chains where it was deployed. Its address is counterfactual elsewhere,
// and a payment to an address with no code there is lost. merchants.mjs inspectWallet refuses a store
// wallet on such a chain, and the admin panel shows the same for our own treasury (GULLY_TREASURY_ADDRESS).
// Instead of only refusing, we offer to deploy the Safe there.
//
// How a Safe is reproduced at the same address: Safe's ProxyFactory deploys proxies with CREATE2, so the
// address depends only on the factory address, the singleton (master copy), the initializer (the `setup`
// call: owners, threshold, fallback handler…) and the salt nonce. Safe's official factory and singletons
// live at the same addresses on every chain (safe-deployments, pinned below with their code hashes), so
// calling createProxyWithNonce(singleton, initializer, saltNonce) on the target chain's factory gives
// the same address, provided the inputs are exactly the original ones. Owners and threshold can be read
// from the Safe, but the salt nonce and the exact initializer are not stored on chain: we take them from
// the Safe's creation transaction (our own record of a Safe we helped create, a transaction the user
// pastes, the first block the Safe had code in (binary search over eth_getCode, then that block's
// ProxyCreation log), or Safe's transaction service as a last hint) and VERIFY them by recomputing the
// CREATE2 address: nothing is offered unless the prediction equals the Safe's address, on the origin
// chain with the original inputs and on the target chain with the target factory's own creation code.
//
// Guard rails: the factory, the singleton and the fallback handler must have code on the target chain
// whose keccak equals the pinned hash; the setup's `to` (a module setup call) must have code there too;
// a setup that paid for its own deployment (paymentToken/payment) is refused; the fee-proxy addresses
// (payments.mjs FEE_PROXIES) are never a target; a predicted address that differs is refused; the gas is
// estimated (eth_estimateGas + eth_gasPrice) and shown before the wallet is asked. The browser recomputes
// the CREATE2 address once more right before sending (src/components/pay/SafeDeploy.tsx).
//
// New Safes (a merchant without one): version 1.4.1, SafeL2 singleton (Safe on Ethereum mainnet, as
// Safe{Wallet} does), CompatibilityFallbackHandler, owners and threshold of the merchant's choosing, and
// a deterministic salt nonce keccak256("gully-pay-safe:<scope>:<owners>:<threshold>:<salt>") that is
// recorded (DATA_DIR/safe-deploys.json) so the same Safe can be deployed at the same address on every chain
// later without any log scanning.
//
// Routes
//   merchant (developer.mjs gate; merchants.mjs forwards /api/developer/merchant/safe*):
//     GET  /api/developer/merchant/safe                 the store's recorded Safes and the chains
//     POST /api/developer/merchant/safe/plan            { chainId, address, deployTx?, from? }           reproduce
//                                                       { chainId, mode: 'new', owners, threshold, salt?, from? }
//     POST /api/developer/merchant/safe/status          { chainId, hash, address } -> sent/mined/verified
//   admin (admin.mjs forwards /api/admin/safe*; the address is always GULLY_TREASURY_ADDRESS):
//     GET  /api/admin/safe/treasury                     the treasury on every chain: Safe, wallet, not deployed
//     POST /api/admin/safe/plan                         { chainId, deployTx?, from? }
//     POST /api/admin/safe/status                       { chainId, hash }
//
// Env: GULLY_RPC_<chainId> (as payments.mjs), GULLY_TESTNET_CHAINS (testnets, never in production).

import fs from 'node:fs'
import path from 'node:path'
import { isFeeProxy } from './fee-proxy-guard.mjs'
import { DATA_DIR, json, readJson } from './http.mjs'
import { CHAIN_LIST, CHAINS, checksumAddress, FEE_PROXIES, rpc as payRpc } from './payments.mjs'
import { treasury } from './plans.mjs'
import { keccak_256 } from './vendor/noble.mjs'

/* ------------------------------------------------------- pinned Safe deployments --- */

// From safe-global/safe-deployments 1.37.64 (src/assets, read 2026-10-17). codeHash is keccak256 of the
// runtime code; checked against Base Sepolia on 2026-10-17 (scripts/fixtures/safe-v141.json). The "eip155"
// 1.3.0 variants were deployed with a replay-protected transaction and so live at other addresses with the
// same code. zkSync variants are left out (different creation code, not an EVM chain we offer).
export const SAFE_DEPLOYMENTS_VERSION = '1.37.64'
const PINNED = {
  factories: [
    { version: '1.4.1', variant: 'canonical', name: 'SafeProxyFactory', address: '0x4e1dcf7ad4e460cfd30791ccc4f9c8a4f820ec67', codeHash: '0x50c3cdc4074750a7a974204a716c999edd37482f907608d960b2b025ee0b3317' },
    { version: '1.5.0', variant: 'canonical', name: 'SafeProxyFactory', address: '0x14f2982d601c9458f93bd70b218933a6f8165e7b', codeHash: '0x967dae4cda22b0c9ef7f31b010bdc1ceb0af9904b0c3dc060b5302e4c18a4529' },
    { version: '1.3.0', variant: 'canonical', name: 'GnosisSafeProxyFactory', address: '0xa6b71e26c5e0845f74c812102ca7114b6a896ab2', codeHash: '0x337d7f54be11b6ed55fef7b667ea5488db53db8320a05d1146aa4bd169a39a9b' },
    { version: '1.3.0', variant: 'eip155', name: 'GnosisSafeProxyFactory', address: '0xc22834581ebc8527d974f8a1c97e1bea4ef910bc', codeHash: '0x337d7f54be11b6ed55fef7b667ea5488db53db8320a05d1146aa4bd169a39a9b' },
  ],
  singletons: [
    { version: '1.4.1', variant: 'canonical', name: 'SafeL2', l2: true, address: '0x29fcb43b46531bca003ddc8fcb67ffe91900c762', codeHash: '0xb1f926978a0f44a2c0ec8fe822418ae969bd8c3f18d61e5103100339894f81ff' },
    { version: '1.4.1', variant: 'canonical', name: 'Safe', l2: false, address: '0x41675c099f32341bf84bfc5382af534df5c7461a', codeHash: '0x1fe2df852ba3299d6534ef416eefa406e56ced995bca886ab7a553e6d0c5e1c4' },
    { version: '1.5.0', variant: 'canonical', name: 'SafeL2', l2: true, address: '0xedd160febbd92e350d4d398fb636302fccd67c7e', codeHash: '0x180193227186ccb85316c94db1f0d156ed932b14712cfaac78901899178572dc' },
    { version: '1.5.0', variant: 'canonical', name: 'Safe', l2: false, address: '0xff51a5898e281db6dfc7855790607438df2ca44b', codeHash: '0xdda019cbd7c867a533a2a86e5c53434fdc50b13122b5a5ddb4a8df61b31c20f2' },
    { version: '1.3.0', variant: 'canonical', name: 'GnosisSafeL2', l2: true, address: '0x3e5c63644e683549055b9be8653de26e0b4cd36e', codeHash: '0x21842597390c4c6e3c1239e434a682b054bd9548eee5e9b1d6a4482731023c0f' },
    { version: '1.3.0', variant: 'eip155', name: 'GnosisSafeL2', l2: true, address: '0xfb1bffc9d739b8d520daf37df666da4c687191ea', codeHash: '0x21842597390c4c6e3c1239e434a682b054bd9548eee5e9b1d6a4482731023c0f' },
    { version: '1.3.0', variant: 'canonical', name: 'GnosisSafe', l2: false, address: '0xd9db270c1b5e3bd161e8c8503c55ceabee709552', codeHash: '0xbba688fbdb21ad2bb58bc320638b43d94e7d100f6f3ebaab0a4e4de6304b1c2e' },
    { version: '1.3.0', variant: 'eip155', name: 'GnosisSafe', l2: false, address: '0x69f4d1788e39c87893c980c06edf4b7f686e2938', codeHash: '0xbba688fbdb21ad2bb58bc320638b43d94e7d100f6f3ebaab0a4e4de6304b1c2e' },
  ],
  fallbackHandlers: [
    { version: '1.4.1', variant: 'canonical', name: 'CompatibilityFallbackHandler', address: '0xfd0732dc9e303f09fcef3a7388ad10a83459ec99', codeHash: '0x7c6007a5d711cea8dfd5d91f5940ec29c7f200fe511eb1fc1397b367af3c42f9' },
    { version: '1.5.0', variant: 'canonical', name: 'CompatibilityFallbackHandler', address: '0x3efcbb83a4a7afcb4f68d501e2c2203a38be77f4', codeHash: '0x3c6a85bcf7b563daa624b884b4e9a1b9fa5371edde7be945d998071a48f28bbc' },
    { version: '1.3.0', variant: 'canonical', name: 'CompatibilityFallbackHandler', address: '0xf48f2b2d2a534e402487b3ee7c18c33aec0fe5e4', codeHash: '0x03e69f7ce809e81687c69b19a7d7cca45b6d551ffdec73d9bb87178476de1abf' },
    { version: '1.3.0', variant: 'eip155', name: 'CompatibilityFallbackHandler', address: '0x017062a1de2fe6b99be3d9d37841fed19f573804', codeHash: '0x03e69f7ce809e81687c69b19a7d7cca45b6d551ffdec73d9bb87178476de1abf' },
  ],
}
const byAddress = (list) => Object.fromEntries(list.map((x) => [x.address, x]))
export const FACTORIES = byAddress(PINNED.factories)
export const SINGLETONS = byAddress(PINNED.singletons)
export const FALLBACK_HANDLERS = byAddress(PINNED.fallbackHandlers)
/** What a new Safe is made of (Safe{Wallet}'s own choice: 1.4.1, SafeL2 everywhere but Ethereum mainnet). */
export const NEW_SAFE = { version: '1.4.1', factory: PINNED.factories[0], singletonL2: PINNED.singletons[0], singletonL1: PINNED.singletons[1], fallbackHandler: PINNED.fallbackHandlers[0] }

/* ------------------------------------------------------------------- chains --- */

/** Native coin per chain (for the gas estimate and wallet_addEthereumChain). */
const NATIVE = { 1: 'ETH', 8453: 'ETH', 42161: 'ETH', 56: 'BNB', 10: 'ETH', 137: 'POL', 43114: 'AVAX', 84532: 'ETH', 11155420: 'ETH', 421614: 'ETH' }
/**
 * Chains the treasury Safe can be deployed on before Gully Pay takes payments there (the admin panel). When
 * payments.mjs lists one of these (feat/pay-chains), its entry there wins and this one is ignored. Public
 * RPCs only; GULLY_RPC_<chainId> overrides them as everywhere else.
 */
const EXTRA_CHAINS = {
  10: { id: 10, key: 'optimism', name: 'OP Mainnet', explorer: 'https://optimistic.etherscan.io', explorerName: 'Etherscan (OP)', rpcs: ['https://optimism.drpc.org', 'https://mainnet.optimism.io', 'https://optimism-rpc.publicnode.com', 'https://1rpc.io/op'] },
  137: { id: 137, key: 'polygon', name: 'Polygon', explorer: 'https://polygonscan.com', explorerName: 'Polygonscan', rpcs: ['https://polygon.drpc.org', 'https://polygon-rpc.com', 'https://polygon-bor-rpc.publicnode.com', 'https://1rpc.io/matic'] },
  43114: { id: 43114, key: 'avalanche', name: 'Avalanche', explorer: 'https://snowtrace.io', explorerName: 'Snowtrace', rpcs: ['https://avalanche.drpc.org', 'https://api.avax.network/ext/bc/C/rpc', 'https://avalanche-c-chain-rpc.publicnode.com', 'https://1rpc.io/avax'] },
}
// TESTNET ONLY, like payments.mjs TESTNETS: offered only when GULLY_TESTNET_CHAINS names them, never in production.
const EXTRA_TESTNETS = {
  11155420: { id: 11155420, key: 'op-sepolia', name: 'OP Sepolia', testnet: true, explorer: 'https://sepolia-optimism.etherscan.io', explorerName: 'Etherscan (OP Sepolia)', rpcs: ['https://sepolia.optimism.io', 'https://optimism-sepolia-rpc.publicnode.com'] },
  421614: { id: 421614, key: 'arbitrum-sepolia', name: 'Arbitrum Sepolia', testnet: true, explorer: 'https://sepolia.arbiscan.io', explorerName: 'Arbiscan (Sepolia)', rpcs: ['https://sepolia-rollup.arbitrum.io/rpc', 'https://arbitrum-sepolia-rpc.publicnode.com'] },
}
const TESTNET_IDS = process.env.NODE_ENV === 'production' ? [] : String(process.env.GULLY_TESTNET_CHAINS ?? '').split(',').map((s) => Number(s.trim())).filter((id) => EXTRA_TESTNETS[id])

/** A chain by id: payments.mjs first, then the extra Safe chains. Null for Solana and unknown ids. */
export function chainOf(chainId) {
  const id = Number(chainId)
  const c = CHAINS[id]
  if (c && typeof c.explorer === 'string' && Array.isArray(c.rpcs)) return c
  return EXTRA_CHAINS[id] ?? (TESTNET_IDS.includes(id) ? EXTRA_TESTNETS[id] : null) ?? null
}
/** Every chain a Safe can be deployed on here, payment chains first. */
export function safeChains() {
  const extras = [...Object.keys(EXTRA_CHAINS).map(Number), ...TESTNET_IDS].filter((id) => !CHAINS[id]).map((id) => chainOf(id))
  return [...CHAIN_LIST, ...extras]
}
/** The chains a store can receive on (merchants.mjs: the payment chains). */
export const storeChains = () => CHAIN_LIST

/** Explorer links that also work for the extra chains (payments.mjs's helpers know only its own). */
const addressUrl = (chainId, a) => `${chainOf(chainId).explorer}/address/${a}`
const txUrl = (chainId, h) => `${chainOf(chainId).explorer}/tx/${h}`

const chainView = (c) => ({ id: c.id, hexId: '0x' + c.id.toString(16), key: c.key, name: c.name, explorer: c.explorer, explorerName: c.explorerName ?? null, testnet: !!c.testnet, native: { name: NATIVE[c.id] ?? 'ETH', symbol: NATIVE[c.id] ?? 'ETH', decimals: 18 }, rpcs: c.rpcs })

/* ------------------------------------------------------------- JSON-RPC --- */

const chainIdOk = new Map()
async function post(url, method, params) {
  let res
  try {
    res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: AbortSignal.timeout(8_000) })
  } catch (e) {
    throw new Error(`${new URL(url).host}: ${e?.name === 'TimeoutError' ? 'timed out' : 'unreachable'}`)
  }
  if (!res.ok) throw new Error(`${new URL(url).host}: HTTP ${res.status}`)
  const j = await res.json().catch(() => null)
  if (!j || typeof j !== 'object') throw new Error('not a JSON-RPC answer')
  if (j.error) throw Object.assign(new Error(String(j.error.message ?? 'RPC error')), { rpcError: j.error })
  return j.result
}
/** One JSON-RPC call: payments.mjs's client for its chains (health, cooldowns), a plain one for the extras. */
export async function rpc(chainId, method, params) {
  const id = Number(chainId)
  if (CHAINS[id]) return payRpc(id, method, params)
  const c = chainOf(id)
  if (!c) throw new Error(`chain ${chainId} is not offered`)
  const env = String(process.env[`GULLY_RPC_${id}`] ?? '').trim()
  const urls = env ? env.split(',').map((s) => s.trim()).filter(Boolean) : c.rpcs
  let last
  for (const url of urls) {
    try {
      if (!chainIdOk.get(url)) {
        const got = await post(url, 'eth_chainId', [])
        if (typeof got !== 'string' || Number(BigInt(got)) !== id) throw new Error(`node at ${new URL(url).host} is not on chain ${id}`)
        chainIdOk.set(url, true)
      }
      return await post(url, method, params)
    } catch (e) {
      last = e
      // A revert or a refused query is an answer from a healthy node, not a reason to try the next one.
      if (e?.rpcError && !/rate|limit|too many|quota|capacity|archive|token|range|unknown state|not supported/i.test(String(e.message))) throw e
    }
  }
  throw last ?? new Error('no RPC configured')
}

/* ----------------------------------------------------------- hex and ABI --- */

const strip = (h) => String(h).replace(/^0x/, '')
const hexOf = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
const bytesOf = (hex) => {
  const s = strip(hex)
  if (s.length % 2) throw new Error('odd-length hex')
  const out = new Uint8Array(s.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16)
  return out
}
/** keccak256 of hex bytes, as 0x-hex. */
export const keccakHex = (hex) => '0x' + hexOf(keccak_256(bytesOf(hex)))
const keccakText = (s) => '0x' + hexOf(keccak_256(new TextEncoder().encode(s)))
const w256 = (n) => BigInt.asUintN(256, BigInt(n)).toString(16).padStart(64, '0')
const wAddr = (a) => strip(a).toLowerCase().padStart(64, '0')
const wordAt = (hex, i) => strip(hex).slice(i * 64, i * 64 + 64)
const addrOfWord = (w) => '0x' + String(w).slice(-40)
const uintOfWord = (w) => BigInt('0x' + (String(w) || '0'))
const isAddr = (a) => typeof a === 'string' && /^0x[0-9a-fA-F]{40}$/.test(a)
const isHash = (h) => typeof h === 'string' && /^0x[0-9a-fA-F]{64}$/.test(h)
const isHex = (h) => typeof h === 'string' && /^0x([0-9a-fA-F]{2})*$/.test(h)
const ZERO = '0x' + '0'.repeat(40)
const lower = (a) => String(a).toLowerCase()
const sel = (sig) => keccakText(sig).slice(0, 10)

export const SEL = {
  setup: sel('setup(address[],uint256,address,bytes,address,address,uint256,address)'), // 0xb63e800d
  createProxyWithNonce: sel('createProxyWithNonce(address,bytes,uint256)'), // 0x1688f0b9
  createProxyWithCallback: sel('createProxyWithCallback(address,bytes,uint256,address)'),
  createProxy: sel('createProxy(address,bytes)'), // 1.3.0, CREATE: not reproducible
  proxyCreationCode: sel('proxyCreationCode()'), // 0x53e5d935
  getOwners: sel('getOwners()'),
  getThreshold: sel('getThreshold()'),
  VERSION: sel('VERSION()'),
  getModulesPaginated: sel('getModulesPaginated(address,uint256)'),
}
export const TOPICS = {
  proxyCreation: keccakText('ProxyCreation(address,address)'),
  safeSetup: keccakText('SafeSetup(address,address[],uint256,address,address)'),
}
/** Safe's storage slots (keccak256 of the names), the same in 1.3.0, 1.4.1 and 1.5.0. */
const SLOT = { singleton: '0x0', fallbackHandler: '0x6c9a6c4a39284e37ed1cf53d337577d14212a4870fb976a4366c693b939918d5', guard: '0x4a204f620c8c5ccdca3fd54d003badd85ba500436a431f0cbda4f558c93c34c8' }

const padBytes = (hex) => {
  const s = strip(hex)
  return s + '0'.repeat((64 - (s.length % 64)) % 64)
}
const encBytes = (hex) => w256(strip(hex).length / 2) + padBytes(hex)

/** ABI-encoded `setup(owners, threshold, to, data, fallbackHandler, paymentToken, payment, paymentReceiver)`. */
export function encodeSetup({ owners, threshold, to = ZERO, data = '0x', fallbackHandler = ZERO, paymentToken = ZERO, payment = 0, paymentReceiver = ZERO }) {
  const head = 8 * 32
  const ownersTail = w256(owners.length) + owners.map(wAddr).join('')
  const dataOffset = head + ownersTail.length / 2
  return SEL.setup + w256(head) + w256(threshold) + wAddr(to) + w256(dataOffset) + wAddr(fallbackHandler) + wAddr(paymentToken) + w256(payment) + wAddr(paymentReceiver) + ownersTail + encBytes(data)
}

/** Decodes an initializer. Returns null unless it is a well-formed `setup` call. */
export function decodeSetup(initializer) {
  if (!isHex(initializer) || !lower(initializer).startsWith(SEL.setup)) return null
  const body = strip(initializer).slice(8)
  try {
    const u = (i) => uintOfWord(wordAt(body, i))
    const ownersOff = Number(u(0))
    const dataOff = Number(u(3))
    if (ownersOff % 32 || dataOff % 32 || ownersOff * 2 + 64 > body.length || dataOff * 2 + 64 > body.length) return null
    const n = Number(uintOfWord(body.slice(ownersOff * 2, ownersOff * 2 + 64)))
    if (n < 1 || n > 100 || (ownersOff + 32 + n * 32) * 2 > body.length) return null
    const owners = Array.from({ length: n }, (_, i) => checksumAddress(addrOfWord(body.slice((ownersOff + 32 + i * 32) * 2, (ownersOff + 32 + i * 32) * 2 + 64))))
    const dataLen = Number(uintOfWord(body.slice(dataOff * 2, dataOff * 2 + 64)))
    if ((dataOff + 32 + dataLen) * 2 > body.length) return null
    const data = '0x' + body.slice((dataOff + 32) * 2, (dataOff + 32 + dataLen) * 2)
    return { owners, threshold: Number(u(1)), to: checksumAddress(addrOfWord(wordAt(body, 2))), data, fallbackHandler: checksumAddress(addrOfWord(wordAt(body, 4))), paymentToken: checksumAddress(addrOfWord(wordAt(body, 5))), payment: u(6).toString(), paymentReceiver: checksumAddress(addrOfWord(wordAt(body, 7))) }
  } catch {
    return null
  }
}

/** The factory call: `createProxyWithNonce(singleton, initializer, saltNonce)`. */
export function encodeCreateProxyWithNonce(singleton, initializer, saltNonce) {
  return SEL.createProxyWithNonce + wAddr(singleton) + w256(96) + w256(saltNonce) + encBytes(initializer)
}

/**
 * Every `createProxyWithNonce` or `createProxyWithCallback` call found in a transaction's input, as
 * { singleton, initializer, saltNonce, kind }. A call wrapped in another contract's call (MultiSend, a
 * relayer) is found too, because every occurrence of the selector at a word boundary is tried; whatever
 * decodes is later checked against the Safe's address, so a false hit is harmless. createProxyWithCallback
 * salts with keccak256(saltNonce ++ callback) internally, so the equivalent plain nonce is returned.
 */
export function decodeFactoryCalls(input) {
  if (!isHex(input)) return []
  const s = strip(input).toLowerCase()
  const out = []
  const tryAt = (pos, withCallback) => {
    const body = s.slice(pos + 8)
    try {
      const singleton = checksumAddress(addrOfWord(wordAt(body, 0)))
      const off = Number(uintOfWord(wordAt(body, 1)))
      const saltNonce = uintOfWord(wordAt(body, 2))
      if (off % 32 || off * 2 + 64 > body.length) return
      const len = Number(uintOfWord(body.slice(off * 2, off * 2 + 64)))
      if (len < 4 || (off + 32 + len) * 2 > body.length) return
      const initializer = '0x' + body.slice((off + 32) * 2, (off + 32 + len) * 2)
      if (!withCallback) return out.push({ kind: 'createProxyWithNonce', singleton, initializer, saltNonce: '0x' + saltNonce.toString(16) })
      const callback = addrOfWord(wordAt(body, 3))
      const derived = BigInt(keccakHex(w256(saltNonce) + strip(callback)))
      out.push({ kind: 'createProxyWithCallback', singleton, initializer, saltNonce: '0x' + derived.toString(16), callback: checksumAddress(callback), originalSaltNonce: '0x' + saltNonce.toString(16) })
    } catch {
      /* not a call here */
    }
  }
  for (const [selector, withCallback] of [
    [SEL.createProxyWithNonce.slice(2), false],
    [SEL.createProxyWithCallback.slice(2), true],
  ]) {
    let i = s.indexOf(selector)
    while (i !== -1) {
      if (i % 2 === 0) tryAt(i, withCallback)
      i = s.indexOf(selector, i + 2)
    }
  }
  return out
}

/** Whether a transaction's input is 1.3.0's createProxy (plain CREATE, address depends on the factory's nonce). */
export const isPlainCreateProxy = (input) => isHex(input) && lower(input).startsWith(SEL.createProxy)

/**
 * The CREATE2 address Safe's factory gives: keccak256(0xff ++ factory ++ salt ++ keccak256(creationCode ++
 * abi.encode(singleton)))[12:], with salt = keccak256(keccak256(initializer) ++ saltNonce). Pure arithmetic:
 * the same on every chain, which is the whole point.
 */
export function predictProxy({ factory, singleton, initializer, saltNonce, proxyCreationCode }) {
  const salt = keccakHex(strip(keccakHex(initializer)) + w256(saltNonce))
  const initCodeHash = keccakHex(strip(proxyCreationCode) + wAddr(singleton))
  return checksumAddress('0x' + strip(keccakHex('ff' + strip(factory).toLowerCase() + strip(salt) + strip(initCodeHash))).slice(-40))
}

/* ------------------------------------------------------------- chain reads --- */

const codeCache = new Map() // `${chainId}:${address}` -> { at, code }
/** eth_getCode at `latest` (cached 20 s) or at a block. '0x' when empty. */
export async function getCode(chainId, address, block = 'latest') {
  const key = `${chainId}:${lower(address)}`
  if (block === 'latest') {
    const hit = codeCache.get(key)
    if (hit && Date.now() - hit.at < 20_000) return hit.code
  }
  const code = await rpc(chainId, 'eth_getCode', [lower(address), block])
  if (typeof code !== 'string' || !/^0x[0-9a-fA-F]*$/.test(code)) throw new Error('unreadable eth_getCode answer')
  if (block === 'latest') codeCache.set(key, { at: Date.now(), code: code.toLowerCase() })
  return code.toLowerCase()
}
const hasCode = (code) => typeof code === 'string' && code.length > 2 && !/^0xef0100/i.test(code)
const call = (chainId, to, data) => rpc(chainId, 'eth_call', [{ to: lower(to), data }, 'latest'])

const decodeAddressArray = (hex) => {
  const s = strip(hex)
  if (s.length < 128) return []
  const off = Number(uintOfWord(wordAt(s, 0))) * 2
  const n = Number(uintOfWord(s.slice(off, off + 64)))
  return Array.from({ length: n }, (_, i) => checksumAddress(addrOfWord(s.slice(off + 64 + i * 64, off + 128 + i * 64))))
}
const decodeString = (hex) => {
  const s = strip(hex)
  if (s.length < 128) return ''
  const off = Number(uintOfWord(wordAt(s, 0))) * 2
  const n = Number(uintOfWord(s.slice(off, off + 64)))
  return new TextDecoder().decode(bytesOf(s.slice(off + 64, off + 64 + n * 2)))
}
const decodeBytes = (hex) => {
  const s = strip(hex)
  if (s.length < 128) return null
  const off = Number(uintOfWord(wordAt(s, 0))) * 2
  const n = Number(uintOfWord(s.slice(off, off + 64)))
  return '0x' + s.slice(off + 64, off + 64 + n * 2)
}

/**
 * Reads a Safe on a chain where it has code: its singleton (storage slot 0, must be a pinned one), version,
 * owners, threshold, fallback handler, guard and modules. { ok: false, error } when the address is not a
 * Safe we recognise.
 */
export async function readSafe(chainId, address) {
  const code = await getCode(chainId, address)
  if (!hasCode(code)) return { ok: false, code: 'no-code', error: `${chainOf(chainId)?.name ?? chainId}: no contract at ${address}.` }
  const slot0 = await rpc(chainId, 'eth_getStorageAt', [lower(address), SLOT.singleton, 'latest'])
  const singleton = lower(addrOfWord(strip(slot0 ?? '').padStart(64, '0')))
  const known = SINGLETONS[singleton]
  if (!known) return { ok: false, code: 'not-a-safe', error: `${chainOf(chainId)?.name ?? chainId}: the contract at ${address} is not a Safe proxy of a version we know (its master copy is ${singleton}). Only Safe 1.3.0, 1.4.1 and 1.5.0 can be reproduced here.`, singleton }
  const [owners, threshold, version, fh, guard, modules] = await Promise.all([
    call(chainId, address, SEL.getOwners).then(decodeAddressArray),
    call(chainId, address, SEL.getThreshold).then((h) => Number(uintOfWord(strip(h ?? '0')))),
    call(chainId, address, SEL.VERSION).then(decodeString, () => known.version),
    rpc(chainId, 'eth_getStorageAt', [lower(address), SLOT.fallbackHandler, 'latest']).then((h) => checksumAddress(addrOfWord(strip(h ?? '').padStart(64, '0')))),
    rpc(chainId, 'eth_getStorageAt', [lower(address), SLOT.guard, 'latest']).then((h) => checksumAddress(addrOfWord(strip(h ?? '').padStart(64, '0')))),
    call(chainId, address, SEL.getModulesPaginated + w256(1) + w256(20)).then(decodeAddressArray, () => []),
  ])
  if (!owners.length || threshold < 1) return { ok: false, code: 'not-set-up', error: `${chainOf(chainId)?.name ?? chainId}: the Safe at ${address} has no owners yet.` }
  return { ok: true, chainId: Number(chainId), address: checksumAddress(address), singleton: checksumAddress(singleton), singletonName: known.name, version: version || known.version, owners, threshold, fallbackHandler: fh, guard, modules, proxyCodeHash: keccakHex(code) }
}

/** Code at an address, compared with a pinned hash: { ok, present, matches, codeHash }. */
async function checkPinned(chainId, address, codeHash) {
  const code = await getCode(chainId, address)
  const present = hasCode(code)
  const got = present ? keccakHex(code) : null
  return { present, matches: present && got === codeHash, codeHash: got }
}

const pccCache = new Map()
/** The factory's `proxyCreationCode()` on a chain (part of the CREATE2 init code; cached). */
export async function proxyCreationCode(chainId, factory) {
  const key = `${chainId}:${lower(factory)}`
  if (pccCache.has(key)) return pccCache.get(key)
  const out = decodeBytes(await call(chainId, factory, SEL.proxyCreationCode))
  if (!out || out.length < 10) throw new Error(`the factory on ${chainOf(chainId)?.name ?? chainId} did not return its proxy creation code`)
  pccCache.set(key, out)
  return out
}

/* ------------------------------------------------- finding the creation tx --- */

/** The first block in which `address` had code (binary search over eth_getCode; needs archive state). */
export async function firstBlockWithCode(chainId, address, { maxCalls = 40 } = {}) {
  const head = Number(BigInt(await rpc(chainId, 'eth_blockNumber', [])))
  let lo = 0
  let hi = head
  let calls = 0
  // Guard: the node must serve old state at all, else stop before burning calls.
  const probe = await getCode(chainId, address, '0x' + Math.floor(head / 2).toString(16)).catch((e) => ({ error: e }))
  if (probe?.error) throw new Error(`no archive state (${probe.error.message})`)
  while (lo < hi && calls++ < maxCalls) {
    const mid = Math.floor((lo + hi) / 2)
    const code = await getCode(chainId, address, '0x' + mid.toString(16))
    if (hasCode(code)) hi = mid
    else lo = mid + 1
  }
  if (lo !== hi) throw new Error('binary search did not converge')
  return lo
}

/** The ProxyCreation log in a receipt that names `safe`: { factory, singleton } or null. */
function proxyCreationIn(logs, safe) {
  for (const l of logs ?? []) {
    if (lower(l.topics?.[0] ?? '') !== TOPICS.proxyCreation) continue
    // 1.4.1 indexes the proxy (topic 1); 1.3.0 puts proxy and singleton in the data.
    const proxy = l.topics.length > 1 ? addrOfWord(l.topics[1]) : addrOfWord(wordAt(l.data, 0))
    const singleton = l.topics.length > 1 ? addrOfWord(wordAt(l.data, 0)) : addrOfWord(wordAt(l.data, 1))
    if (lower(proxy) === lower(safe)) return { factory: checksumAddress(l.address), singleton: checksumAddress(singleton) }
  }
  return null
}

/**
 * Recovers the creation inputs of `safe` from one transaction and VERIFIES them: the receipt must hold the
 * factory's ProxyCreation log for this Safe, the input must decode to a factory call, and the CREATE2
 * address from those inputs (with the factory's creation code on the origin chain) must equal the Safe.
 */
export async function creationFromTx(chainId, safe, hash) {
  if (!isHash(hash)) return { ok: false, error: 'That is not a transaction hash.' }
  const [tx, receipt] = await Promise.all([rpc(chainId, 'eth_getTransactionByHash', [hash]), rpc(chainId, 'eth_getTransactionReceipt', [hash])])
  if (!tx || !receipt) return { ok: false, error: `Transaction ${hash.slice(0, 10)}… was not found on ${chainOf(chainId)?.name ?? chainId}.` }
  if (receipt.status !== '0x1') return { ok: false, error: 'That transaction failed on chain; it did not create the Safe.' }
  const created = proxyCreationIn(receipt.logs, safe)
  if (!created) return { ok: false, error: `Transaction ${hash.slice(0, 10)}… did not create the Safe ${safe} (no ProxyCreation log names it).` }
  if (!FACTORIES[lower(created.factory)]) return { ok: false, code: 'unknown-factory', error: `The Safe was created by ${created.factory}, which is not an official Safe factory we know (1.3.0, 1.4.1 or 1.5.0), so it cannot be reproduced at the same address here.` }
  if (isPlainCreateProxy(tx.input)) return { ok: false, code: 'not-deterministic', error: 'This Safe was created with createProxy (plain CREATE), whose address depends on the factory’s own transaction count. It cannot be reproduced at the same address on another chain. Create a new Safe for that chain instead.' }
  const pcc = await proxyCreationCode(chainId, created.factory)
  for (const c of decodeFactoryCalls(tx.input)) {
    if (lower(c.singleton) !== lower(created.singleton)) continue
    if (lower(predictProxy({ factory: created.factory, singleton: c.singleton, initializer: c.initializer, saltNonce: c.saltNonce, proxyCreationCode: pcc })) === lower(safe)) {
      return { ok: true, factory: created.factory, singleton: c.singleton, initializer: c.initializer, saltNonce: c.saltNonce, kind: c.kind, tx: hash, blockNumber: Number(BigInt(receipt.blockNumber)), from: checksumAddress(tx.from) }
    }
  }
  return { ok: false, code: 'undecodable', error: `The creating transaction ${hash.slice(0, 10)}… could not be decoded into a createProxyWithNonce call that reproduces ${safe}. If the Safe was created through another contract, its inputs may not be recoverable here.` }
}

/** Safe{Wallet}'s transaction service, a hint only: the transaction hash it names is read and verified on chain. */
const SAFE_SERVICE = { 1: 'mainnet', 8453: 'base', 42161: 'arbitrum', 56: 'bsc', 10: 'optimism', 137: 'polygon', 43114: 'avalanche', 84532: 'basesep' }
async function creationHintFromSafeService(chainId, safe) {
  const key = SAFE_SERVICE[Number(chainId)]
  if (!key) return null
  try {
    const r = await fetch(`https://api.safe.global/tx-service/${key}/api/v1/safes/${checksumAddress(safe)}/creation/`, { signal: AbortSignal.timeout(8_000), headers: { accept: 'application/json' } })
    if (!r.ok) return null
    const j = await r.json().catch(() => null)
    return isHash(j?.transactionHash) ? j.transactionHash : null
  } catch {
    return null
  }
}

/**
 * Finds and verifies how `safe` was created on `chainId`: our record, the given tx, the first block with
 * code (then that block's logs), or the Safe service hint. Returns creationFromTx's shape plus `source`.
 */
export async function findCreation(chainId, safe, { deployTx = null } = {}) {
  const tried = []
  const rec = recordOf(safe)
  if (rec) {
    // A Safe we built: the inputs are on file; still verified against the origin factory's creation code.
    const pcc = await proxyCreationCode(chainId, rec.factory).catch(() => null)
    if (pcc && lower(predictProxy({ factory: rec.factory, singleton: rec.singleton, initializer: rec.initializer, saltNonce: rec.saltNonce, proxyCreationCode: pcc })) === lower(safe)) return { ok: true, source: 'record', factory: rec.factory, singleton: rec.singleton, initializer: rec.initializer, saltNonce: rec.saltNonce, kind: 'createProxyWithNonce', tx: rec.deployments?.[chainId]?.tx ?? null, blockNumber: null, from: null }
    tried.push('record')
  }
  if (deployTx) {
    const r = await creationFromTx(chainId, safe, deployTx)
    if (r.ok) return { ...r, source: 'tx' }
    if (r.code === 'unknown-factory' || r.code === 'not-deterministic') return r
    tried.push(`the transaction you gave (${r.error})`)
  }
  let viaChain = null
  try {
    const block = await firstBlockWithCode(chainId, safe)
    const hex = '0x' + block.toString(16)
    const logs = await rpc(chainId, 'eth_getLogs', [{ fromBlock: hex, toBlock: hex, topics: [TOPICS.proxyCreation] }])
    const mine = (logs ?? []).find((l) => proxyCreationIn([l], safe))
    if (mine?.transactionHash) {
      const r = await creationFromTx(chainId, safe, mine.transactionHash)
      if (r.ok) return { ...r, source: 'chain' }
      if (r.code === 'unknown-factory' || r.code === 'not-deterministic') return r
      viaChain = r.error
    } else viaChain = `block ${block} has no ProxyCreation log for this Safe (it may have been created by a contract that is not Safe’s factory)`
  } catch (e) {
    viaChain = String(e?.message ?? e)
  }
  tried.push(`the chain’s history (${viaChain})`)
  const hint = await creationHintFromSafeService(chainId, safe)
  if (hint) {
    const r = await creationFromTx(chainId, safe, hint)
    if (r.ok) return { ...r, source: 'safe-service' }
    if (r.code === 'unknown-factory' || r.code === 'not-deterministic') return r
    tried.push(`Safe’s transaction service (${r.error})`)
  } else tried.push('Safe’s transaction service (no answer for this chain or Safe)')
  return { ok: false, code: 'creation-not-found', error: `The transaction that created this Safe could not be found from ${tried.join('; ')}. Paste its creation transaction hash (the explorer shows it as the contract creator) and try again.` }
}

/* -------------------------------------------------------------- records --- */

const FILE = path.join(DATA_DIR, 'safe-deploys.json')
let db
try {
  db = JSON.parse(fs.readFileSync(FILE, 'utf8'))
  if (!db || typeof db !== 'object' || !Array.isArray(db.safes)) db = { safes: [] }
} catch {
  db = { safes: [] }
}
function save() {
  fs.mkdirSync(DATA_DIR, { recursive: true })
  const tmp = `${FILE}.${process.pid}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(db, null, 1))
  fs.renameSync(tmp, FILE)
}
/** A recorded Safe (one we planned as new) by address, or null. */
export const recordOf = (address) => db.safes.find((s) => lower(s.address) === lower(address)) ?? null
const recordView = (s) => ({ address: s.address, scope: s.scope, owners: s.owners, threshold: s.threshold, version: s.version, saltNonce: s.saltNonce, createdAt: s.createdAt, deployments: Object.fromEntries(Object.entries(s.deployments ?? {}).map(([id, d]) => [id, { tx: d.tx, txUrl: chainOf(id) ? txUrl(Number(id), d.tx) : null, at: d.at, chain: chainOf(id)?.name ?? id }])) })
function recordNew(scope, plan) {
  let s = recordOf(plan.predicted)
  if (!s) {
    s = { address: plan.predicted, scope, owners: plan.setup.owners, threshold: plan.setup.threshold, version: plan.version, factory: plan.factory, singleton: plan.singleton, fallbackHandler: plan.setup.fallbackHandler, initializer: plan.initializer, saltNonce: plan.saltNonce, createdAt: new Date().toISOString(), deployments: {} }
    db.safes.push(s)
    save()
  }
  return s
}
function recordDeployment(address, chainId, hash) {
  const s = recordOf(address)
  if (!s || s.deployments?.[chainId]?.verifiedAt) return
  s.deployments ??= {}
  s.deployments[chainId] = { tx: hash, at: new Date().toISOString(), verifiedAt: new Date().toISOString() }
  save()
}
/** For tests: forget every record and every cached chain read. */
export const resetForTest = () => {
  db = { safes: [] }
  save()
  codeCache.clear()
  pccCache.clear()
  treasuryCache = null
}

/* ----------------------------------------------------------------- plans --- */

const bad = (error, code = 'bad-request', status = 400) => ({ ok: false, status, code, error })
/** Addresses that are never a deployment target: every fee proxy we know (fee-proxy-guard.mjs, payments.mjs) and the zero address. */
const forbiddenTarget = (a) => {
  const l = lower(a)
  return l === lower(ZERO) || isFeeProxy(l) || Object.values(FEE_PROXIES).some((p) => lower(p) === l)
}

async function gasFor(chainId, tx, from) {
  const c = chainOf(chainId)
  const symbol = NATIVE[c.id] ?? 'ETH'
  try {
    const params = { to: lower(tx.to), data: tx.data, value: '0x0', ...(isAddr(from) ? { from: lower(from) } : {}) }
    const [est, price] = await Promise.all([rpc(chainId, 'eth_estimateGas', [params]), rpc(chainId, 'eth_gasPrice', [])])
    const gas = BigInt(est)
    const gasPrice = BigInt(price)
    const cost = gas * gasPrice
    const costStr = (Number(cost) / 1e18).toLocaleString('en-US', { maximumFractionDigits: 8 })
    return { estimate: Number(gas), estimateHex: '0x' + gas.toString(16), gasPrice: gasPrice.toString(), gasPriceGwei: Number(gasPrice) / 1e9, costWei: cost.toString(), cost: `${costStr} ${symbol}`, symbol, from: isAddr(from) ? checksumAddress(from) : null, error: null }
  } catch (e) {
    const m = String(e?.message ?? e)
    return { estimate: null, estimateHex: null, gasPrice: null, gasPriceGwei: null, costWei: null, cost: null, symbol, from: isAddr(from) ? checksumAddress(from) : null, error: /revert/i.test(m) ? 'The node says this call would revert. The Safe may already be deployed, or the inputs no longer match.' : `Gas could not be estimated just now (${m}). Your wallet will estimate it.` }
  }
}

/** What is at `address` on `chainId`: 'safe' (with details), 'contract', 'eoa-7702', 'eoa' (no code) or 'unreadable'. */
export async function whatIsAt(chainId, address) {
  let code
  try {
    code = await getCode(chainId, address)
  } catch (e) {
    return { kind: 'unreadable', error: String(e?.message ?? e) }
  }
  if (code.length <= 2) return { kind: 'eoa' }
  if (/^0xef0100/i.test(code)) return { kind: 'eoa-7702' }
  const s = await readSafe(chainId, address).catch(() => null)
  return s?.ok ? { kind: 'safe', safe: s } : { kind: 'contract', singleton: s?.singleton ?? null }
}

/**
 * The plan to deploy an existing Safe at its own address on `targetChainId`. `originChainId` is found when
 * not given (the first of our chains where the address is a Safe). `deployTx` lets the user name the creation
 * transaction. `from` (the wallet that will send) only serves the gas estimate.
 */
export async function planReproduce({ address, targetChainId, originChainId = null, deployTx = null, from = null, forbid = [] }) {
  if (!isAddr(address)) return bad('That is not an EVM address.')
  const safe = checksumAddress(address)
  if (forbiddenTarget(safe)) return bad('That address can never be a Safe deployment target.', 'forbidden')
  if (forbid.some((a) => lower(a) === lower(safe))) return bad("That is Gully Labs' own treasury, not a store wallet.", 'forbidden')
  const target = chainOf(targetChainId)
  if (!target) return bad(`Choose a chain: ${safeChains().map((c) => `${c.id} (${c.name})`).join(', ')}.`)
  if (deployTx != null && deployTx !== '' && !isHash(deployTx)) return bad('deployTx must be a transaction hash (0x and 64 hex characters).')
  const checks = []
  const check = (id, label, ok, detail = null) => (checks.push({ id, label, ok, detail }), ok)

  // Already there?
  const here = await whatIsAt(target.id, safe)
  if (here.kind === 'unreadable') return bad(`${target.name} could not be read just now (${here.error}). Try again in a minute.`, 'rpc', 502)
  if (here.kind !== 'eoa') {
    const what = here.kind === 'safe' ? `a Safe ${here.safe.version} with ${here.safe.owners.length} owner${here.safe.owners.length === 1 ? '' : 's'}, threshold ${here.safe.threshold}` : here.kind === 'contract' ? 'a contract that is not a Safe we recognise' : 'an EIP-7702 delegated wallet'
    return { ok: true, mode: 'reproduce', alreadyDeployed: true, kind: here.kind, safe, chain: chainView(target), what, explorerUrl: addressUrl(target.id, safe), checks: [{ id: 'target-code', label: `Code on ${target.name}`, ok: true, detail: what }] }
  }

  // Origin: where the Safe exists.
  let origin = null
  const candidates = originChainId != null ? [chainOf(originChainId)].filter(Boolean) : safeChains().filter((c) => c.id !== target.id)
  const found = await Promise.all(candidates.map((c) => readSafe(c.id, safe).then((r) => (r.ok ? r : r.code === 'not-a-safe' ? { ...r, chainId: c.id } : null), () => null)))
  origin = found.find((r) => r?.ok) ?? null
  if (!origin) {
    const notSafe = found.find((r) => r && r.code === 'not-a-safe')
    if (notSafe) return bad(notSafe.error, 'not-a-safe', 422)
    return bad(originChainId != null ? `${chainOf(originChainId)?.name}: no Safe is deployed at ${safe}.` : `No Safe is deployed at ${safe} on any chain we read (${candidates.map((c) => c.name).join(', ')}). A Safe must exist on one chain before it can be reproduced on another; to make a brand-new one, use “Create a new Safe”.`, 'no-origin', 422)
  }
  const oc = chainOf(origin.chainId)
  check('origin-read', `Safe read on ${oc.name}`, true, `${origin.singletonName} ${origin.version}, ${origin.owners.length} owner${origin.owners.length === 1 ? '' : 's'}, threshold ${origin.threshold}`)

  // Creation inputs, verified on the origin chain.
  const creation = await findCreation(origin.chainId, safe, { deployTx: deployTx || null })
  if (!creation.ok) {
    check('creation-recovered', 'Creation transaction recovered', false, creation.error)
    return { ...bad(creation.error, creation.code ?? 'creation-not-found', 422), checks, origin: originView(origin, null) }
  }
  check('creation-recovered', 'Creation transaction recovered', true, creation.source === 'record' ? 'from our record of this Safe' : creation.source === 'tx' ? 'from the transaction you gave' : creation.source === 'chain' ? `from the chain’s history (block ${creation.blockNumber})` : 'from Safe’s transaction service, verified on chain')
  check('origin-prediction', `CREATE2 address recomputed on ${oc.name}`, true, 'equals the Safe’s address')
  const setup = decodeSetup(creation.initializer)
  if (!setup) return { ...bad('The Safe’s initializer is not a setup() call we can decode.', 'undecodable', 422), checks, origin: originView(origin, creation) }
  if (lower(setup.paymentToken) !== lower(ZERO) || BigInt(setup.payment) !== 0n) return { ...bad('This Safe paid for its own deployment in its setup (paymentToken/payment). Reproducing it would try to pay the same way, so it is refused.', 'setup-payment', 422), checks, origin: originView(origin, creation) }
  const warnings = []
  const sameOwners = setup.owners.length === origin.owners.length && setup.owners.every((o) => origin.owners.some((x) => lower(x) === lower(o)))
  if (!sameOwners || setup.threshold !== origin.threshold) warnings.push(`The owners or threshold of this Safe changed after it was created. The copy on ${target.name} starts with the ORIGINAL set-up (${setup.owners.length} owner${setup.owners.length === 1 ? '' : 's'}, threshold ${setup.threshold}), not the current one; change them there afterwards.`)
  if (lower(origin.guard) !== lower(ZERO)) warnings.push(`The Safe on ${oc.name} has a transaction guard (${origin.guard}); the copy starts without one.`)
  if (origin.modules.length) warnings.push(`The Safe on ${oc.name} has ${origin.modules.length} module${origin.modules.length === 1 ? '' : 's'} enabled; the copy starts with only what its setup call enables.`)

  // The target chain must hold the same factory, singleton, fallback handler and setup target.
  const factoryPin = FACTORIES[lower(creation.factory)]
  const singletonPin = SINGLETONS[lower(creation.singleton)]
  if (!factoryPin || !singletonPin) return { ...bad('The Safe’s factory or singleton is not an official Safe deployment we know.', 'unknown-factory', 422), checks, origin: originView(origin, creation) }
  const [f, s] = await Promise.all([checkPinned(target.id, creation.factory, factoryPin.codeHash), checkPinned(target.id, creation.singleton, singletonPin.codeHash)])
  const fOk = check('target-factory', `${factoryPin.name} ${factoryPin.version} on ${target.name}`, f.matches, f.present ? (f.matches ? `${creation.factory}, code hash matches` : `code at ${creation.factory} differs from the official factory`) : `no code at ${creation.factory}`)
  const sOk = check('target-singleton', `${singletonPin.name} ${singletonPin.version} on ${target.name}`, s.matches, s.present ? (s.matches ? `${creation.singleton}, code hash matches` : 'code differs from the official singleton') : `no code at ${creation.singleton}`)
  if (!fOk || !sOk) return { ...bad(`Safe ${factoryPin.version} is not deployed on ${target.name} at its official addresses${f.present && !f.matches ? ' (the code there differs)' : ''}, so this Safe cannot be reproduced there yet.`, 'no-factory', 422), checks, origin: originView(origin, creation), setup, warnings }
  if (lower(setup.fallbackHandler) !== lower(ZERO)) {
    const pin = FALLBACK_HANDLERS[lower(setup.fallbackHandler)]
    const fh = pin ? await checkPinned(target.id, setup.fallbackHandler, pin.codeHash) : { present: hasCode(await getCode(target.id, setup.fallbackHandler)), matches: null }
    const ok = pin ? fh.matches : fh.present
    if (!check('target-fallback', `Fallback handler on ${target.name}`, ok, ok ? `${setup.fallbackHandler}${pin ? ', code hash matches' : ''}` : `no${pin && fh.present ? ' matching' : ''} code at ${setup.fallbackHandler}`)) return { ...bad(`The Safe’s fallback handler (${setup.fallbackHandler}) is not deployed on ${target.name}, so the copy would be set up with a dead handler. Refused.`, 'no-fallback', 422), checks, origin: originView(origin, creation), setup, warnings }
  }
  if (lower(setup.to) !== lower(ZERO)) {
    const present = hasCode(await getCode(target.id, setup.to))
    if (!check('target-setup-to', `Setup call target on ${target.name}`, present, present ? setup.to : `no code at ${setup.to}`)) return { ...bad(`The Safe’s setup calls ${setup.to} (a module set-up contract) which has no code on ${target.name}. The copy’s setup would revert. Refused.`, 'no-setup-target', 422), checks, origin: originView(origin, creation), setup, warnings }
  }

  // The prediction on the target, with the target factory's own creation code.
  const pcc = await proxyCreationCode(target.id, creation.factory)
  const predicted = predictProxy({ factory: creation.factory, singleton: creation.singleton, initializer: creation.initializer, saltNonce: creation.saltNonce, proxyCreationCode: pcc })
  if (!check('target-prediction', `CREATE2 address on ${target.name}`, lower(predicted) === lower(safe), lower(predicted) === lower(safe) ? 'equals the Safe’s address' : `would be ${predicted}, not ${safe}`)) return { ...bad(`On ${target.name} this factory call would create ${predicted}, not ${safe}. Nothing is offered.`, 'mismatch', 422), checks, origin: originView(origin, creation), setup, warnings, predicted }
  const tx = { to: creation.factory, data: encodeCreateProxyWithNonce(creation.singleton, creation.initializer, creation.saltNonce), value: '0x0' }
  const gas = await gasFor(target.id, tx, from)
  return { ok: true, mode: 'reproduce', alreadyDeployed: false, safe, chain: chainView(target), origin: originView(origin, creation), setup, version: factoryPin.version, factory: creation.factory, singleton: creation.singleton, singletonName: singletonPin.name, initializer: creation.initializer, saltNonce: creation.saltNonce, proxyCreationCode: pcc, predicted, matches: true, tx, gas, warnings, checks, explorerUrl: addressUrl(target.id, safe) }
}
const originView = (o, creation) => ({ chainId: o.chainId, chain: chainOf(o.chainId)?.name ?? String(o.chainId), chainKey: chainOf(o.chainId)?.key ?? null, version: o.version, singletonName: o.singletonName, singleton: o.singleton, owners: o.owners, threshold: o.threshold, fallbackHandler: o.fallbackHandler, guard: o.guard, modules: o.modules, explorerUrl: chainOf(o.chainId) ? addressUrl(o.chainId, o.address) : null, deployTx: creation?.tx ?? null, deployTxUrl: creation?.tx && chainOf(o.chainId) ? txUrl(o.chainId, creation.tx) : null, source: creation?.source ?? null })

/** The deterministic salt nonce for a new Safe: the same scope, owners, threshold and salt give the same address everywhere. */
export const saltNonceFor = (scope, owners, threshold, salt = '') => BigInt(keccakText(`gully-pay-safe:${scope}:${owners.map(lower).sort().join(',')}:${threshold}:${salt}`))

/**
 * The plan for a brand-new Safe 1.4.1 on `chainId` with `owners` and `threshold`, recorded under `scope` (a
 * workspace id, or 'treasury') so it can be deployed at the same address elsewhere later.
 */
export async function planNew({ chainId, owners, threshold, salt = '', scope, from = null }) {
  const target = chainOf(chainId)
  if (!target) return bad(`Choose a chain: ${safeChains().map((c) => `${c.id} (${c.name})`).join(', ')}.`)
  if (!Array.isArray(owners) || owners.length < 1 || owners.length > 10) return bad('List 1 to 10 owner addresses.')
  if (owners.some((o) => !isAddr(o))) return bad('Every owner must be an EVM address (0x and 40 hex characters).')
  // Owners are stored in a canonical order, so the same set always gives the same initializer and address.
  const sum = owners.map((o) => checksumAddress(o)).sort((a, b) => (lower(a) < lower(b) ? -1 : 1))
  if (new Set(sum.map(lower)).size !== sum.length) return bad('Each owner can be listed once.')
  if (sum.some((o) => lower(o) === lower(ZERO) || forbiddenTarget(o))) return bad('The zero address and contract addresses of ours cannot be owners.')
  const th = Number(threshold)
  if (!Number.isInteger(th) || th < 1 || th > sum.length) return bad(`The threshold must be between 1 and ${sum.length} (the number of owners).`)
  if (typeof salt !== 'string' || salt.length > 64 || !/^[\w.:-]*$/.test(salt)) return bad('salt may hold up to 64 letters, digits, dots, colons, dashes and underscores.')
  const checks = []
  const check = (id, label, ok, detail = null) => (checks.push({ id, label, ok, detail }), ok)
  const singletonPin = target.id === 1 ? NEW_SAFE.singletonL1 : NEW_SAFE.singletonL2
  const [f, s, h] = await Promise.all([checkPinned(target.id, NEW_SAFE.factory.address, NEW_SAFE.factory.codeHash), checkPinned(target.id, singletonPin.address, singletonPin.codeHash), checkPinned(target.id, NEW_SAFE.fallbackHandler.address, NEW_SAFE.fallbackHandler.codeHash)]).catch((e) => {
    throw Object.assign(new Error(`${target.name} could not be read just now (${String(e?.message ?? e)}).`), { rpc: true })
  })
  const fOk = check('target-factory', `SafeProxyFactory 1.4.1 on ${target.name}`, f.matches, f.present ? (f.matches ? 'code hash matches' : 'code differs from the official factory') : 'no code at the official address')
  const sOk = check('target-singleton', `${singletonPin.name} 1.4.1 on ${target.name}`, s.matches, s.present ? (s.matches ? 'code hash matches' : 'code differs') : 'no code')
  const hOk = check('target-fallback', `CompatibilityFallbackHandler 1.4.1 on ${target.name}`, h.matches, h.present ? (h.matches ? 'code hash matches' : 'code differs') : 'no code')
  if (!fOk || !sOk || !hOk) return { ...bad(`Safe 1.4.1 is not deployed on ${target.name} at its official addresses, so no Safe can be created there from here.`, 'no-factory', 422), checks }
  const setup = { owners: sum, threshold: th, to: ZERO, data: '0x', fallbackHandler: checksumAddress(NEW_SAFE.fallbackHandler.address), paymentToken: ZERO, payment: '0', paymentReceiver: ZERO }
  const initializer = encodeSetup(setup)
  const saltNonce = '0x' + saltNonceFor(scope, sum, th, salt).toString(16)
  const factory = checksumAddress(NEW_SAFE.factory.address)
  const singleton = checksumAddress(singletonPin.address)
  const pcc = await proxyCreationCode(target.id, factory)
  const predicted = predictProxy({ factory, singleton, initializer, saltNonce, proxyCreationCode: pcc })
  check('target-prediction', `CREATE2 address on ${target.name}`, true, predicted)
  const existing = await whatIsAt(target.id, predicted)
  if (existing.kind === 'unreadable') return { ...bad(`${target.name} could not be read just now (${existing.error}). Try again in a minute.`, 'rpc', 502), checks }
  const tx = { to: factory, data: encodeCreateProxyWithNonce(singleton, initializer, saltNonce), value: '0x0' }
  const plan = { ok: true, mode: 'new', alreadyDeployed: existing.kind !== 'eoa', kind: existing.kind, safe: predicted, chain: chainView(target), origin: null, setup, version: '1.4.1', factory, singleton, singletonName: singletonPin.name, initializer, saltNonce, proxyCreationCode: pcc, predicted, matches: true, tx, gas: existing.kind === 'eoa' ? await gasFor(target.id, tx, from) : null, warnings: target.id === 1 ? ['On Ethereum mainnet the Safe (L1) singleton is used, as Safe{Wallet} does; copies on other chains use SafeL2. Both give this same address only if this Safe is reproduced with the exact same singleton, which the record keeps.'] : [], checks, explorerUrl: addressUrl(target.id, predicted) }
  if (existing.kind === 'eoa') recordNew(scope, plan)
  return plan
}

/**
 * Where a deployment stands: 'pending' (not mined), 'failed' (reverted), 'mined' (mined, no code read yet)
 * or 'verified' (code at the address and the Safe answers getOwners). Records a verified deployment of a
 * Safe we planned as new.
 */
export async function deploymentStatus({ chainId, hash, address }) {
  const c = chainOf(chainId)
  if (!c) return bad('Unknown chain.')
  if (!isHash(hash)) return bad('hash must be a transaction hash.')
  if (!isAddr(address)) return bad('address must be the Safe’s address.')
  let receipt
  try {
    receipt = await rpc(c.id, 'eth_getTransactionReceipt', [hash])
  } catch (e) {
    return bad(`${c.name} could not be read just now (${String(e?.message ?? e)}).`, 'rpc', 502)
  }
  const base = { ok: true, chainId: c.id, hash, txUrl: txUrl(c.id, hash), address: checksumAddress(address), explorerUrl: addressUrl(c.id, address) }
  if (!receipt) return { ...base, state: 'pending' }
  const mined = { blockNumber: Number(BigInt(receipt.blockNumber)), gasUsed: receipt.gasUsed ? Number(BigInt(receipt.gasUsed)) : null, status: receipt.status }
  if (receipt.status !== '0x1') return { ...base, state: 'failed', ...mined, error: 'The transaction reverted on chain. Nothing was deployed; only gas was spent.' }
  codeCache.delete(`${c.id}:${lower(address)}`)
  const created = proxyCreationIn(receipt.logs, address)
  const safe = await readSafe(c.id, address).catch(() => null)
  if (!safe?.ok) return { ...base, state: 'mined', ...mined, created: !!created, error: created ? 'Mined; the node has not served the new code yet. Checking again…' : 'Mined, but this transaction did not create a Safe at that address.' }
  recordDeployment(address, c.id, hash)
  return { ...base, state: 'verified', ...mined, created: !!created, owners: safe.owners, threshold: safe.threshold, version: safe.version, singletonName: safe.singletonName }
}

/** The treasury on every Safe chain (admin), cached 30 s. */
let treasuryCache = null
export async function treasuryStatus({ fresh = false } = {}) {
  const t = treasury()
  if (!t) return { set: false, treasury: null, chains: [], origin: null }
  if (!fresh && treasuryCache && treasuryCache.treasury === t && Date.now() - treasuryCache.at < 30_000) return treasuryCache.view
  const sum = checksumAddress(t)
  const rows = await Promise.all(
    safeChains().map(async (c) => {
      const w = await whatIsAt(c.id, sum)
      return { chainId: c.id, chain: c.name, chainKey: c.key, testnet: !!c.testnet, payments: !!CHAINS[c.id], kind: w.kind, error: w.error ?? null, safe: w.kind === 'safe' ? { version: w.safe.version, singletonName: w.safe.singletonName, owners: w.safe.owners, threshold: w.safe.threshold } : null, explorerUrl: addressUrl(c.id, sum) }
    }),
  )
  const origin = rows.find((r) => r.kind === 'safe') ?? null
  const view = { set: true, treasury: sum, chains: rows.map((r) => ({ ...r, canDeploy: r.kind === 'eoa' && !!origin })), origin: origin ? { chainId: origin.chainId, chain: origin.chain, ...origin.safe } : null, note: origin ? null : rows.some((r) => r.kind === 'eoa') && rows.every((r) => r.kind !== 'contract') ? 'The treasury is a normal wallet (no code on any chain): it receives everywhere as it is, nothing to deploy.' : null }
  treasuryCache = { at: Date.now(), treasury: t, view }
  return view
}

/* ---------------------------------------------------------------- routes --- */

const buckets = new Map()
function allow(key, max, ms) {
  const now = Date.now()
  const b = buckets.get(key) ?? { n: 0, reset: now + ms }
  if (now > b.reset) Object.assign(b, { n: 0, reset: now + ms })
  b.n++
  buckets.set(key, b)
  return b.n <= max
}
const send = (res, r) => (r.ok ? json(res, 200, r) : json(res, r.status ?? 400, { error: r.error, code: r.code ?? null, ...(r.checks ? { checks: r.checks } : {}), ...(r.origin ? { origin: r.origin } : {}), ...(r.setup ? { setup: r.setup } : {}), ...(r.warnings ? { warnings: r.warnings } : {}) }), true)
const rpcFault = (res, e) => (json(res, 502, { error: String(e?.message ?? e), code: 'rpc' }), true)

/** /api/developer/merchant/safe* (developer.mjs has checked the session, CSRF and role; ctx = { user, workspace, role }). */
export async function handleMerchantSafe(req, res, url, ctx) {
  const p = url.pathname
  const ws = ctx.workspace
  if (req.method !== 'POST') {
    if (p === '/api/developer/merchant/safe') return json(res, 200, { safes: db.safes.filter((s) => s.scope === ws).map(recordView), chains: storeChains().map(chainView), newSafe: { version: NEW_SAFE.version, factory: checksumAddress(NEW_SAFE.factory.address), fallbackHandler: checksumAddress(NEW_SAFE.fallbackHandler.address) } }), true
    return json(res, 404, { error: 'not found' }), true
  }
  const body = (await readJson(req, 20_000)) ?? {}
  const chainId = Number(body.chainId)
  if (p === '/api/developer/merchant/safe/plan') {
    if (!allow(`plan:${ws}`, 60, 3_600_000)) return json(res, 429, { error: 'Too many Safe plans in the last hour. Try again later.' }), true
    if (!storeChains().some((c) => c.id === chainId)) return json(res, 400, { error: `chainId must be one of the store chains: ${storeChains().map((c) => `${c.id} (${c.name})`).join(', ')}.` }), true
    try {
      if (body.mode === 'new') return send(res, await planNew({ chainId, owners: body.owners, threshold: body.threshold, salt: body.salt ?? '', scope: ws, from: body.from ?? null }))
      return send(res, await planReproduce({ address: body.address, targetChainId: chainId, originChainId: body.originChainId ?? null, deployTx: body.deployTx ?? null, from: body.from ?? null, forbid: [treasury()].filter(Boolean) }))
    } catch (e) {
      return rpcFault(res, e)
    }
  }
  if (p === '/api/developer/merchant/safe/status') {
    if (!allow(`status:${ws}`, 1_200, 3_600_000)) return json(res, 429, { error: 'Too many status checks in the last hour.' }), true
    if (!storeChains().some((c) => c.id === chainId)) return json(res, 400, { error: 'Unknown chain.' }), true
    return send(res, await deploymentStatus({ chainId, hash: body.hash, address: body.address }))
  }
  return json(res, 404, { error: 'not found' }), true
}

/** /api/admin/safe* (admin.mjs has checked the bearer token). The address is always the treasury. */
export async function handleAdminSafe(req, res, url) {
  const p = url.pathname
  if (p === '/api/admin/safe/treasury') {
    if (req.method !== 'GET') return json(res, 405, { error: 'GET only' }), true
    try {
      return json(res, 200, { ...(await treasuryStatus({ fresh: url.searchParams.get('fresh') === '1' })), chains_note: 'payments: true marks a Gully Pay chain; the others are offered for the treasury Safe ahead of payments there.' }), true
    } catch (e) {
      return rpcFault(res, e)
    }
  }
  if (req.method !== 'POST') return json(res, 405, { error: 'POST only' }), true
  const body = (await readJson(req, 20_000)) ?? {}
  const t = treasury()
  if (!t) return json(res, 409, { error: 'GULLY_TREASURY_ADDRESS is not set, so there is no treasury to deploy.' }), true
  const chainId = Number(body.chainId)
  if (!chainOf(chainId)) return json(res, 400, { error: `chainId must be one of: ${safeChains().map((c) => `${c.id} (${c.name})`).join(', ')}.` }), true
  if (p === '/api/admin/safe/plan') {
    if (!allow('plan:admin', 120, 3_600_000)) return json(res, 429, { error: 'Too many plans in the last hour.' }), true
    try {
      return send(res, await planReproduce({ address: t, targetChainId: chainId, originChainId: body.originChainId ?? null, deployTx: body.deployTx ?? null, from: body.from ?? null }))
    } catch (e) {
      return rpcFault(res, e)
    }
  }
  if (p === '/api/admin/safe/status') {
    const r = await deploymentStatus({ chainId, hash: body.hash, address: t })
    if (r.ok && r.state === 'verified') treasuryCache = null
    return send(res, r)
  }
  return json(res, 404, { error: 'not found' }), true
}
