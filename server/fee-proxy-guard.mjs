// Fee-proxy guards, shared by the server (pay-guard.mjs, payments.mjs, merchants.mjs) and the wallet path in the
// browser (src/components/pay/PayWallet.tsx). Pure: no Node or browser APIs, no dependencies.
//
// Owner rule: no funds can ever get stuck in the fee-split contract. Request Network's ERC20FeeProxy never holds
// tokens: one call does transferFrom(payer -> merchant) and transferFrom(payer -> fee address) and returns. The only
// way a balance can end up in it (or in its native twin, EthereumFeeProxy) is a transfer sent straight to the
// proxy's address. Neither contract has an owner or a sweep, so such a transfer is lost for good. Hence:
//   (a) a plain transfer, QR code, EIP-681 or Solana Pay link never names a fee proxy (on ANY chain) as recipient;
//   (b) a split's call data reaches the proxy only through transferFromWithReferenceAndFee, with value 0, an
//       allowed token, `to` = the expected merchant (never a proxy, never zero), `feeAddress` = the treasury
//       (never a proxy, never zero), 0 < fee < amount, and the approval names the proxy for exactly amount + fee;
//   (c) the token is USDC or USDT on its chain (no fee-on-transfer token, whose proxy legs would not add up).
// Every check returns a list of violations (empty = safe); callers refuse on any.
//
// Where the addresses come from: contracts/CHOICE.md (mainnets, eth_getCode-checked) and, for Base Sepolia, the
// proxies we deployed there from Request's own source (feat/feeproxy-testnet, contracts/TESTNET-RESULTS.md).

/** Every known Request fee proxy, by chain: ERC20FeeProxy (`erc20`) and EthereumFeeProxy (`native`), lowercase. */
export const FEE_PROXY_REGISTRY = {
  1: { erc20: ['0x370de27fdb7d1ff1e1baa7d11c5820a324cf623c', '0x0dfbee143b42b41efc5a6f87bfd1ffc78c2f0ac9'], native: ['0xfcfbcfc4f5a421089e3df45455f7f4985fe2d6a8'] },
  8453: { erc20: ['0x1892196e80c4c17ea5100da765ab48c1fe2fb814'], native: ['0xd9c3889eb8da6ce449bffe3cd194d08a436e96f2'] },
  56: { erc20: ['0x0dfbee143b42b41efc5a6f87bfd1ffc78c2f0ac9'], native: ['0xfcfbcfc4f5a421089e3df45455f7f4985fe2d6a8'] },
  42161: { erc20: ['0x0dfbee143b42b41efc5a6f87bfd1ffc78c2f0ac9'], native: ['0xfcfbcfc4f5a421089e3df45455f7f4985fe2d6a8'] },
  10: { erc20: ['0x399f5ee127ce7432e4921a61b8cf52b0af52cbfe'], native: ['0xe11bf2fda23bf0a98365e1a4c04a87c9339e8687'] },
  137: { erc20: ['0x0dfbee143b42b41efc5a6f87bfd1ffc78c2f0ac9'], native: ['0xfcfbcfc4f5a421089e3df45455f7f4985fe2d6a8'] },
  // Base Sepolia (testnet only): deployed by us from Request's source, byte-identical to Base mainnet's.
  84532: { erc20: ['0xae5508e1509cce6a73b38d8b19fedfdbd0080c18'], native: ['0xd302ce9e3048ad676c6e74be57042aca31e2957e'] },
}

/** The ERC20FeeProxy a split is paid through, by Gully Pay chain (payments.mjs FEE_PROXIES is this). */
export const SPLIT_PROXIES = {
  1: '0x370de27fdb7d1ff1e1baa7d11c5820a324cf623c', // Request "0.2.0" on Ethereum (the address its SDK uses)
  8453: '0x1892196e80c4c17ea5100da765ab48c1fe2fb814',
  56: '0x0dfbee143b42b41efc5a6f87bfd1ffc78c2f0ac9',
  42161: '0x0dfbee143b42b41efc5a6f87bfd1ffc78c2f0ac9',
}

/** Solana's ledger chain id (solana-pay.mjs SOLANA_CHAIN_ID). */
export const SOLANA_LEDGER_CHAIN_ID = 1151111081099710

/**
 * The only tokens a quote may name, by chain: USDC and USDT, none of which takes a fee on transfer. EVM addresses
 * lowercase; Solana mints in base58 (case matters). Must list exactly the token assets of payments.mjs ASSETS
 * (test:feeproxy checks both ways).
 */
export const ALLOWED_TOKENS = {
  8453: { '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913': 'USDC' },
  1: { '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48': 'USDC', '0xdac17f958d2ee523a2206206994597c13d831ec7': 'USDT' },
  56: { '0x55d398326f99059ff775485246999027b3197955': 'USDT', '0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d': 'USDC' },
  42161: { '0xaf88d065e77c8cc2239327c5edb3a432268e5831': 'USDC' },
  // Base Sepolia (testnet only, offered while GULLY_TESTNET_CHAINS names it): Circle's testnet USDC.
  84532: { '0x036cbd53842c5426634e7929541ec2318f3dcf7e': 'USDC' },
  [SOLANA_LEDGER_CHAIN_ID]: { EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: 'USDC', Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB: 'USDT' },
}
export const STABLE_SYMBOLS = ['USDC', 'USDT']

/** transferFromWithReferenceAndFee(address,address,uint256,bytes,uint256,address) and approve(address,uint256). */
export const SEL_PAY = 'c219a14d'
export const SEL_APPROVE = '095ea7b3'
export const ZERO_ADDRESS = '0x' + '0'.repeat(40)

const EVM_RE = /^0x[0-9a-fA-F]{40}$/
const low = (a) => (typeof a === 'string' ? a.toLowerCase() : '')

/** Addresses from GULLY_FEEPROXY_<chainId> (a testnet proxy we deployed), when running under Node. */
function envProxies() {
  const env = typeof process !== 'undefined' && process?.env ? process.env : null
  if (!env) return []
  return Object.keys(env)
    .filter((k) => /^GULLY_FEEPROXY_\d+$/.test(k))
    .map((k) => low(String(env[k]).trim()))
    .filter((a) => EVM_RE.test(a))
}

/** Every known fee-proxy address on every chain, lowercase (static list, the split proxies, any env-configured one). */
export function allFeeProxies() {
  const s = new Set()
  for (const c of Object.values(FEE_PROXY_REGISTRY)) for (const a of [...c.erc20, ...c.native]) s.add(a)
  for (const a of Object.values(SPLIT_PROXIES)) s.add(a)
  for (const a of envProxies()) s.add(a)
  return s
}

/** Whether an address is a fee proxy on any chain (a proxy on one chain is refused on all of them). */
export const isFeeProxy = (a) => typeof a === 'string' && EVM_RE.test(a.trim()) && allFeeProxies().has(a.trim().toLowerCase())

/**
 * The ERC20FeeProxy a split on `chainId` must call, lowercase, or null: the mainnet one (SPLIT_PROXIES), else the
 * testnet one we deployed (GULLY_FEEPROXY_<chainId> under Node, the registry's ERC20FeeProxy in the browser).
 * payments.mjs FEE_PROXIES is built the same way, so the server and the wallet path agree.
 */
export function splitProxyFor(chainId) {
  if (SPLIT_PROXIES[chainId]) return SPLIT_PROXIES[chainId]
  const env = typeof process !== 'undefined' && process?.env ? low(String(process.env[`GULLY_FEEPROXY_${chainId}`] ?? '').trim()) : ''
  if (EVM_RE.test(env)) return env
  return FEE_PROXY_REGISTRY[chainId]?.erc20?.[0] ?? null
}

const isZero = (a) => low(a) === ZERO_ADDRESS
const isEvm = (a) => typeof a === 'string' && EVM_RE.test(a)

/** Whether a token is an allowed stablecoin on its chain. Returns its symbol or null. */
export function allowedToken(chainId, token) {
  const m = ALLOWED_TOKENS[chainId]
  if (!m || typeof token !== 'string') return null
  return m[token] ?? m[token.toLowerCase()] ?? null
}

/** Rule (a): a plain-transfer recipient. Violations as strings. */
export function recipientViolations(recipient, { chainId = null, label = 'recipient' } = {}) {
  const out = []
  if (typeof recipient !== 'string' || !recipient) return [`${label} is missing`]
  if (chainId === SOLANA_LEDGER_CHAIN_ID) return out // base58: never an EVM proxy, nothing more to check here
  if (!isEvm(recipient)) return [`${label} is not an EVM address`]
  if (isZero(recipient)) out.push(`${label} is the zero address`)
  if (isFeeProxy(recipient)) out.push(`${label} ${low(recipient)} is a fee proxy contract (funds sent there are lost)`)
  return out
}

/** Rule (c): the asset of a quote. `asset` = { chainId, kind, symbol, address }. */
export function assetViolations(asset) {
  if (!asset || typeof asset !== 'object') return ['asset is not an allowed asset']
  if (asset.kind === 'native') return asset.address ? ['a native coin has no token address'] : []
  if (asset.kind !== 'token') return ['asset is not an allowed asset']
  const sym = allowedToken(asset.chainId, asset.address)
  if (!sym) return [`token ${asset.address} is not an allowed stablecoin on chain ${asset.chainId}`]
  if (!STABLE_SYMBOLS.includes(sym) || (asset.symbol && asset.symbol !== sym)) return [`token ${asset.address} is not USDC or USDT`]
  if (asset.chainId !== SOLANA_LEDGER_CHAIN_ID && isFeeProxy(asset.address)) return ['token address is a fee proxy']
  return []
}

const strip = (h) => (typeof h === 'string' ? h.replace(/^0x/i, '').toLowerCase() : '')
const wordAt = (hex, i) => hex.slice(i * 64, (i + 1) * 64)
const wordAddr = (w) => (w.length === 64 && /^0{24}/.test(w) ? '0x' + w.slice(24) : null)
const wordNum = (w) => (w.length === 64 && /^[0-9a-f]{64}$/.test(w) ? BigInt('0x' + w) : null)

/** Decodes transferFromWithReferenceAndFee call data, strictly (canonical encoding only), or null. */
export function decodePayCall(data) {
  const h = strip(data)
  if (!/^[0-9a-f]*$/.test(h) || h.slice(0, 8) !== SEL_PAY) return null
  const b = h.slice(8)
  if (b.length < 7 * 64 || b.length % 64) return null
  const token = wordAddr(wordAt(b, 0))
  const to = wordAddr(wordAt(b, 1))
  const amount = wordNum(wordAt(b, 2))
  const offset = wordNum(wordAt(b, 3))
  const fee = wordNum(wordAt(b, 4))
  const feeAddress = wordAddr(wordAt(b, 5))
  const len = wordNum(wordAt(b, 6))
  if (!token || !to || amount == null || offset !== 192n || fee == null || !feeAddress || len == null || len > 1024n) return null
  const words = Number((len + 31n) / 32n)
  if (b.length !== (7 + words) * 64) return null
  const refHex = b.slice(7 * 64, 7 * 64 + Number(len) * 2)
  if (b.slice(7 * 64 + Number(len) * 2).replace(/0/g, '')) return null // padding must be zeros
  return { token, to, amount, ref: '0x' + refHex, fee, feeAddress }
}

/** Decodes approve(spender, amount) call data, or null. */
export function decodeApprove(data) {
  const h = strip(data)
  if (h.length !== 8 + 128 || h.slice(0, 8) !== SEL_APPROVE) return null
  const spender = wordAddr(h.slice(8, 72))
  const amount = wordNum(h.slice(72, 136))
  return spender && amount != null ? { spender, amount } : null
}

const nonZeroValue = (v) => {
  if (v == null || v === '' || v === 0 || v === '0' || v === '0x0' || v === '0x' || v === 0n) return false
  try {
    return BigInt(v) !== 0n
  } catch {
    return true
  }
}

/**
 * Rule (b): a split as quoteSplit builds it ({ proxy, spender, ref, merchantRaw, feeRaw, feeTo, approve, approveReset, pay }).
 * ctx: { chainId, token, total (what the payer pays, base units), to (the expected merchant), feeTo (the expected
 * treasury; the browser passes the split's own, the server passes GULLY_TREASURY_ADDRESS) }.
 */
export function splitViolations(split, ctx) {
  const out = []
  const v = (cond, msg) => (cond ? null : out.push(msg))
  if (!split || typeof split !== 'object') return ['split is missing']
  const proxy = splitProxyFor(ctx.chainId)
  if (!proxy) return [`no fee proxy is known on chain ${ctx.chainId}`]
  v(low(split.proxy) === proxy && low(split.spender) === proxy, 'split names a contract other than the known fee proxy')
  v(split.pay && low(split.pay.to) === proxy, 'the payment call does not target the fee proxy')
  v(!nonZeroValue(split.pay?.value) && !nonZeroValue(split.approve?.value) && !nonZeroValue(split.approveReset?.value), 'a split call carries native value')
  const symbol = allowedToken(ctx.chainId, ctx.token)
  v(!!symbol && STABLE_SYMBOLS.includes(symbol), `token ${ctx.token} is not an allowed stablecoin on chain ${ctx.chainId}`)
  const d = decodePayCall(split.pay?.data)
  if (!d) {
    out.push('the payment call is not transferFromWithReferenceAndFee')
    return out
  }
  const total = BigInt(ctx.total)
  v(d.token === low(ctx.token) && allowedToken(ctx.chainId, d.token), 'the payment call names another token')
  v(!isZero(d.to) && !isFeeProxy(d.to), '`to` is zero or a fee proxy')
  v(d.to === low(ctx.to), '`to` is not the expected recipient')
  v(!isZero(d.feeAddress) && !isFeeProxy(d.feeAddress), '`feeAddress` is zero or a fee proxy')
  v(isEvm(ctx.feeTo) && d.feeAddress === low(ctx.feeTo), '`feeAddress` is not the treasury')
  v(d.feeAddress !== d.to, '`feeAddress` equals `to`')
  v(d.fee > 0n && d.fee < d.amount, 'fee is not between 0 and the amount')
  v(d.amount + d.fee === total, 'amount + fee is not what the payer pays')
  v(low(split.ref) === d.ref, 'the payment reference does not match')
  v(String(split.merchantRaw) === d.amount.toString() && String(split.feeRaw) === d.fee.toString() && low(split.feeTo) === d.feeAddress, 'the split summary does not match its call data')
  const ap = decodeApprove(split.approve?.data)
  v(!!ap && low(split.approve?.to) === d.token && ap.spender === proxy && ap.amount === d.amount + d.fee, 'the approval is not for the fee proxy and exactly amount + fee')
  const rs = decodeApprove(split.approveReset?.data)
  v(!!rs && low(split.approveReset?.to) === d.token && rs.spender === proxy && rs.amount === 0n, 'the allowance reset is not approve(proxy, 0)')
  return out
}

/**
 * What a wallet may send, checked right before it is sent: never value to a proxy, never anything to a proxy but
 * transferFromWithReferenceAndFee, never a token transfer whose recipient is a proxy.
 * tx: { to, value?, data? }.
 */
export function txViolations(tx) {
  const out = []
  if (!tx || !isEvm(tx.to)) return ['the transaction has no valid recipient']
  const toProxy = isFeeProxy(tx.to)
  if (toProxy && nonZeroValue(tx.value)) out.push('native value sent to a fee proxy')
  if (toProxy && strip(tx.data).slice(0, 8) !== SEL_PAY) out.push('a call to a fee proxy that is not transferFromWithReferenceAndFee')
  const h = strip(tx.data)
  // transfer(address,uint256) a9059cbb / transferFrom(address,address,uint256) 23b872dd: the recipient word.
  if (h.slice(0, 8) === 'a9059cbb' && isFeeProxy(wordAddr(h.slice(8, 72)) ?? '')) out.push('a token transfer to a fee proxy')
  if (h.slice(0, 8) === '23b872dd' && isFeeProxy(wordAddr(h.slice(72, 136)) ?? '')) out.push('a token transfer to a fee proxy')
  return out
}

/**
 * The recipient, token, chain and amount an EIP-681 or Solana Pay URI asks for, or null when unreadable.
 *   ethereum:<to>@<chainId>?value=<wei>
 *   ethereum:<token>@<chainId>/transfer?address=<to>&uint256=<units>
 *   solana:<recipient>?amount=…&spl-token=<mint>&…
 */
export function parsePaymentUri(uri) {
  const s = String(uri ?? '')
  let m = s.match(/^ethereum:(0x[0-9a-fA-F]{40})@(\d+)\/transfer\?address=(0x[0-9a-fA-F]{40})&uint256=(\d+)$/)
  if (m) return { scheme: 'ethereum', token: m[1].toLowerCase(), chainId: Number(m[2]), to: m[3].toLowerCase(), amount: m[4] }
  m = s.match(/^ethereum:(0x[0-9a-fA-F]{40})@(\d+)\?value=(\d+)$/)
  if (m) return { scheme: 'ethereum', token: null, chainId: Number(m[2]), to: m[1].toLowerCase(), amount: m[3] }
  m = s.match(/^solana:([1-9A-HJ-NP-Za-km-z]{32,44})\?(.*)$/)
  if (m) {
    const q = new URLSearchParams(m[2])
    return { scheme: 'solana', token: q.get('spl-token'), chainId: SOLANA_LEDGER_CHAIN_ID, to: m[1], amount: q.get('amount') }
  }
  return null
}
