// Gully AI "Explain this transaction" for Gully Chain testnet (485590). Flag AI_EXPLAIN_TX (default 0 = off).
//
// Pipeline, server side only:
//   1. buildFacts({chainId, txHash}): receipt + logs from Gully RPC (keyless, rpc.gullyrpc.xyz/gullychain/evm/485590),
//      method decoded from the Sourcify ABI when the contract's source is published there, token transfers priced in USD
//      by the indexer, fee in USD, success or the revert reason, and Account Abstraction attribution: a bundled
//      user operation is credited to its sender, not to the bundler EOA that signed the outer transaction (gully-ops #659).
//   2. explain(facts): the Gully AI gateway writes plain words from the facts. Facts are the ONLY source of figures:
//      every number in the answer must appear in the facts object; a wrong figure, a forbidden word or a model failure
//      falls back to a deterministic template built from the same facts. Empty facts never reach the model.
//   3. handleExplainTx: POST /api/ai/explain-tx, same allowance and daily cap as Gully AI (ask.takeAllowance) plus a
//      credits hook (setExplainCreditsHook) that the gcredits service plugs into later. Not built here.
//
// No dependencies beyond node, the vendored keccak and the gateway. Every network call is injectable for tests.

import { keccak_256 } from '../vendor/noble.mjs'
import { gateway as defaultGateway } from './gateway.mjs'

export const CHAIN_ID = 485590
export const TESTNET_LABEL = 'Testnet: no real value'
export const MAX_FACT_TRANSFERS = 25
const ENTRYPOINT = '0x0000000071727de22e5e9d8baf0edac6f37da032'
const WETH = '0x26acccb2e98ca9e067e58668aa3b101bef432754' // Gully Chain testnet WETH (server/gully-chain.mjs)
const THIN_USD = 500
const enc = new TextEncoder()
const hex = (u8) => Array.from(u8, (b) => b.toString(16).padStart(2, '0')).join('')
const k256 = (s) => hex(keccak_256(enc.encode(s)))
const topic = (sig) => '0x' + k256(sig)
const T_TRANSFER = topic('Transfer(address,address,uint256)')
const T_APPROVAL = topic('Approval(address,address,uint256)')
const T_USEROP = topic('UserOperationEvent(bytes32,address,address,uint256,bool,uint256,uint256)')
const low = (a) => String(a ?? '').toLowerCase()
const isHash = (h) => /^0x[0-9a-fA-F]{64}$/.test(String(h ?? ''))
const addrOfTopic = (t) => '0x' + String(t).slice(-40).toLowerCase()
const short = (a) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : null)
const big = (h) => (typeof h === 'string' && /^0x[0-9a-fA-F]*$/.test(h) && h.length > 2 ? BigInt(h) : 0n)

const known = (sig, name) => [('0x' + k256(sig).slice(0, 8)), { name: name ?? sig.slice(0, sig.indexOf('(')), signature: sig }]
export const KNOWN_SELECTORS = Object.fromEntries([
  known('transfer(address,uint256)'),
  known('approve(address,uint256)'),
  known('transferFrom(address,address,uint256)'),
  known('deposit()'),
  known('withdraw(uint256)'),
  known('handleOps((address,uint256,bytes,bytes,bytes32,uint256,bytes32,bytes,bytes)[],address)', 'handleOps'),
])

/* ------------------------------------------------------------ formatting --- */

/** 1234500000000000000n, 18 -> "1.2345" (trimmed, at most 6 decimals, "<0.000001" for dust). */
export function fmtUnits(raw, decimals = 18) {
  const v = BigInt(raw)
  const base = 10n ** BigInt(decimals)
  const whole = v / base
  const frac = (v % base).toString().padStart(decimals, '0').slice(0, 6).replace(/0+$/, '')
  if (v > 0n && whole === 0n && !frac) return '<0.000001'
  return frac ? `${whole}.${frac}` : `${whole}`
}
export const fmtUsd = (n) => (n === null || n === undefined || !Number.isFinite(n) ? null : n < 0.01 && n > 0 ? '<$0.01' : `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`)
function unitsToNum(raw, decimals) {
  const v = BigInt(raw)
  const base = 10n ** BigInt(decimals)
  return Number(`${v / base}.${(v % base).toString().padStart(decimals, '0')}`)
}

/* ------------------------------------------------------------- ABI bits --- */

function typeOf(p) {
  if (p.type.startsWith('tuple')) return `(${(p.components ?? []).map(typeOf).join(',')})${p.type.slice(5)}`
  return p.type
}
export const signatureOf = (fn) => `${fn.name}(${(fn.inputs ?? []).map(typeOf).join(',')})`
export function methodFromAbi(abi, selector) {
  for (const f of Array.isArray(abi) ? abi : []) {
    if (f?.type !== 'function') continue
    const sig = signatureOf(f)
    if ('0x' + k256(sig).slice(0, 8) === selector) return { name: f.name, signature: sig, source: 'sourcify' }
  }
  return null
}
function decodeString(h) {
  // ABI string return: offset, length, bytes. Also bytes32 symbols (older tokens).
  try {
    if (!h || h === '0x') return null
    const body = h.slice(2)
    if (body.length === 64) return Buffer.from(body, 'hex').toString('utf8').replace(/\0+$/, '') || null
    const len = Number(BigInt('0x' + body.slice(64, 128)))
    if (len > 200) return null
    return Buffer.from(body.slice(128, 128 + len * 2), 'hex').toString('utf8') || null
  } catch {
    return null
  }
}
/** Error(string) revert data -> the string, Panic(uint256) -> a code, else null. */
export function decodeRevert(data) {
  if (typeof data !== 'string') return null
  if (data.startsWith('0x08c379a0')) return decodeString('0x' + data.slice(10))
  if (data.startsWith('0x4e487b71')) return `panic code 0x${BigInt('0x' + data.slice(10, 74)).toString(16)}`
  return null
}

/* ----------------------------------------------------------- real deps --- */

export function realDeps(env = process.env) {
  const rpcUrl = env.EXPLAIN_RPC_URL || 'https://rpc.gullyrpc.xyz/gullychain/evm/485590'
  const indexer = (env.GULLY_INDEXER || 'https://indexer.gullychain.xyz').replace(/\/+$/, '')
  const sourcify = (env.EXPLAIN_SOURCIFY_URL || 'https://verify.gullychain.xyz').replace(/\/+$/, '')
  let id = 0
  const getJson = async (url) => {
    const r = await fetch(url, { signal: AbortSignal.timeout(6000), redirect: 'manual', headers: { accept: 'application/json' } })
    return r.ok ? r.json() : null
  }
  return {
    async rpc(method, params) {
      const r = await fetch(rpcUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }), signal: AbortSignal.timeout(8000), redirect: 'manual' })
      const j = await r.json().catch(() => null)
      if (j?.error) {
        const e = new Error(String(j.error.message ?? 'rpc error'))
        e.data = j.error.data
        throw e
      }
      if (!r.ok || !j) throw new Error(`rpc HTTP ${r.status}`)
      return j.result
    },
    // Sourcify v2, VERIFIED 2026-11-23: GET /v2/contract/<chainId>/<address>?fields=abi -> { abi: [...] }; an address with no match answers 200 { match: null } and no abi.
    async abi(address) {
      try {
        const j = await getJson(`${sourcify}/v2/contract/${CHAIN_ID}/${address}?fields=abi`)
        return Array.isArray(j?.abi) ? j.abi : null
      } catch {
        return null
      }
    },
    // Indexer token record, VERIFIED 2026-11-23: GET /tokens/<address> -> { head, token: { priceUsd, liquidityUsd, thin, ... } }; unknown token = 404 {"error":"unknown token"}.
    // ETH/USD: the indexer does not list the native coin or WETH as a token (404), so the rate is the ETH row of /stats/chain (usd / amount).
    async ethUsd() {
      try {
        const j = await getJson(`${indexer}/stats/chain`)
        const e = (j?.byAsset ?? []).find((a) => a.symbol === 'ETH' && a.priced && a.amount > 0)
        return e ? { usd: e.usd / e.amount, liquidityUsd: null, thin: null } : null
      } catch {
        return null
      }
    },
    async price(token) {
      try {
        const j = await getJson(`${indexer}/tokens/${token}`)
        const t = j?.token ?? j
        return typeof t?.priceUsd === 'number' && t.priceUsd > 0 ? { usd: t.priceUsd, liquidityUsd: typeof t.liquidityUsd === 'number' ? t.liquidityUsd : null, thin: typeof t.thin === 'boolean' ? t.thin : null } : null
      } catch {
        return null
      }
    },
  }
}

/* --------------------------------------------------------------- facts --- */

/**
 * Facts for one transaction. Resolves to { ok:true, facts } or { ok:false, code } (bad_input | wrong_chain | not_found | pending | unavailable).
 * `deps` = { rpc(method, params), abi(address), price(tokenAddress) } (see realDeps).
 */
export async function buildFacts({ chainId, txHash }, deps = realDeps()) {
  if (Number(chainId) !== CHAIN_ID) return { ok: false, code: 'wrong_chain' }
  if (!isHash(txHash)) return { ok: false, code: 'bad_input' }
  let tx, rcpt
  try {
    ;[tx, rcpt] = await Promise.all([deps.rpc('eth_getTransactionByHash', [txHash]), deps.rpc('eth_getTransactionReceipt', [txHash])])
  } catch {
    return { ok: false, code: 'unavailable' }
  }
  if (!tx) return { ok: false, code: 'not_found' }
  if (!rcpt) return { ok: false, code: 'pending' }

  const notes = []
  const contractsSeen = new Map() // address -> { verified }
  const from = low(tx.from)
  const to = tx.to ? low(tx.to) : null
  const success = rcpt.status === '0x1'
  const selector = typeof tx.input === 'string' && tx.input.length >= 10 ? tx.input.slice(0, 10).toLowerCase() : null

  // method
  let method = selector && KNOWN_SELECTORS[selector] ? { ...KNOWN_SELECTORS[selector], source: 'known' } : null
  if (to && selector) {
    const abi = await Promise.resolve(deps.abi(to)).catch(() => null)
    contractsSeen.set(to, { verified: !!abi })
    const m = abi ? methodFromAbi(abi, selector) : null
    if (m) method = m
  }
  if (!to) method = { name: 'contract creation', signature: null, source: 'known' }
  else if (!selector) method = { name: 'plain transfer', signature: null, source: 'known' }

  // revert reason: replay the call one block earlier
  let revertReason = null
  if (!success && to) {
    try {
      await deps.rpc('eth_call', [{ from: tx.from, to: tx.to, data: tx.input, value: tx.value, gas: tx.gas }, '0x' + (big(rcpt.blockNumber) - 1n).toString(16)])
      // Real case 2026-11-23 (createLaunch): the call succeeds one block earlier, because earlier transactions in its own block changed the state it ran on. Without a trace the reason is unknown.
      notes.push('The reason could not be reproduced: the same call succeeds on the state one block earlier.')
      const limit = big(tx.gas)
      const pct = limit > 0n ? Number((big(rcpt.gasUsed) * 100n) / limit) : null
      if (pct !== null && pct >= 95) notes.push(`It used ${pct}% of its gas limit, so it may have run out of gas.`)
    } catch (e) {
      // data is the raw revert bytes on the gateway (verified live 2026-11-23); an eRPC wrapper object or a node without data still has the text in the message
      revertReason = decodeRevert(e?.data) ?? (/^execution reverted: (.{1,200})$/.exec(String(e?.message ?? ''))?.[1] ?? null)
      if (!revertReason) notes.push('The transaction reverted without a readable reason.')
    }
  }

  // account abstraction: the bundler EOA signed it, the user operation's sender is the person
  let aa = null
  const logs = Array.isArray(rcpt.logs) ? rcpt.logs : []
  if (to === ENTRYPOINT) {
    const ZERO = '0x' + '0'.repeat(40)
    const parsed = logs
      .filter((l) => low(l.address) === ENTRYPOINT && l.topics?.[0] === T_USEROP)
      .map((l) => ({ sender: addrOfTopic(l.topics[2]), paymaster: addrOfTopic(l.topics[3]), userOpSuccess: big('0x' + String(l.data ?? '0x').slice(2).slice(64, 128)) === 1n }))
    aa = { isUserOp: true, bundler: from, userOps: parsed.length, sender: parsed[0]?.sender ?? null, paymaster: parsed[0] && parsed[0].paymaster !== ZERO ? parsed[0].paymaster : null, sponsored: !!parsed[0] && parsed[0].paymaster !== ZERO, userOpSuccess: parsed[0]?.userOpSuccess ?? null }
    if (parsed.length > 1) notes.push(`This bundle carries ${parsed.length} user operations; the first sender is shown.`)
  }
  const actor = aa?.sender ?? from

  // transfers and approvals
  const tokens = new Map()
  const tokenMeta = (addr) => {
    if (!tokens.has(addr)) {
      tokens.set(
        addr,
        (async () => {
          const [s, d] = await Promise.all([deps.rpc('eth_call', [{ to: addr, data: '0x95d89b41' }, 'latest']).catch(() => null), deps.rpc('eth_call', [{ to: addr, data: '0x313ce567' }, 'latest']).catch(() => null)])
          const dec = d && d !== '0x' ? Number(BigInt(d)) : null
          const p = await Promise.resolve(deps.price(addr)).catch(() => null)
          return { symbol: decodeString(s), decimals: Number.isInteger(dec) && dec <= 36 ? dec : null, price: p }
        })(),
      )
    }
    return tokens.get(addr)
  }
  const transfers = []
  const approvals = []
  let skipped = 0
  const noDecimals = new Set()
  for (const l of logs) {
    const t0 = l.topics?.[0]
    if (t0 !== T_TRANSFER && t0 !== T_APPROVAL) continue
    const token = low(l.address)
    if (transfers.length + approvals.length >= MAX_FACT_TRANSFERS) {
      skipped++
      continue
    }
    if (t0 === T_TRANSFER && l.topics.length === 4) {
      transfers.push({ kind: 'nft', logIndex: Number(big(l.logIndex)), token, from: addrOfTopic(l.topics[1]), to: addrOfTopic(l.topics[2]), tokenId: String(BigInt(l.topics[3])), symbol: null, amount: null, usd: null })
      continue
    }
    if (l.topics.length !== 3) continue
    const meta = await tokenMeta(token)
    const raw = big(l.data)
    const dec = meta.decimals ?? 18
    if (meta.decimals === null) noDecimals.add(token)
    const usdVal = meta.price ? unitsToNum(raw, dec) * meta.price.usd : null
    const thin = meta.price && (meta.price.thin === true || (meta.price.thin == null && meta.price.liquidityUsd !== null && meta.price.liquidityUsd < THIN_USD))
    if (!contractsSeen.has(token)) contractsSeen.set(token, { verified: null })
    const row = { kind: 'erc20', logIndex: Number(big(l.logIndex)), token, symbol: meta.symbol, from: addrOfTopic(l.topics[1]), to: addrOfTopic(l.topics[2]), amount: fmtUnits(raw, dec), usd: fmtUsd(usdVal), ...(thin ? { thin: true } : {}) }
    if (t0 === T_TRANSFER) transfers.push(row)
    else approvals.push({ logIndex: row.logIndex, token, symbol: meta.symbol, owner: row.from, spender: row.to, amount: raw >= 2n ** 255n ? 'unlimited' : row.amount })
  }
  if (skipped) notes.push('Some further transfer or approval events are not listed.')
  if (noDecimals.size) notes.push('A token did not report its decimals; 18 is assumed.')

  // fee
  const feeWei = big(rcpt.gasUsed) * big(rcpt.effectiveGasPrice || tx.gasPrice)
  const ethPrice = await Promise.resolve(deps.ethUsd ? deps.ethUsd() : deps.price(WETH)).catch(() => null)
  const feeUsd = ethPrice ? unitsToNum(feeWei, 18) * ethPrice.usd : null
  const value = big(tx.value)
  const valueUsd = ethPrice && value > 0n ? unitsToNum(value, 18) * ethPrice.usd : null
  if (!ethPrice) notes.push('No USD price for ETH was available, so dollar figures are left out.')
  else notes.push('Dollar figures use current prices, not the price at the time of the transaction.')

  const facts = {
    schema: 1,
    chain: { id: CHAIN_ID, name: 'Gully Chain Testnet', testnet: true, label: TESTNET_LABEL },
    tx: { hash: txHash.toLowerCase(), status: success ? 'success' : 'reverted', block: Number(big(rcpt.blockNumber)), from, to, valueEth: value > 0n ? fmtUnits(value, 18) : null, valueUsd: fmtUsd(valueUsd), revertReason },
    method: method ? { name: method.name, signature: method.signature, source: method.source } : { name: null, signature: null, source: null },
    actor: { address: actor, short: short(actor) },
    aa,
    fee: { eth: fmtUnits(feeWei, 18), usd: fmtUsd(feeUsd), paidBy: aa?.sponsored ? 'sponsor (paymaster)' : aa ? 'the smart account or its paymaster' : 'sender' },
    transfers,
    approvals,
    contracts: [...contractsSeen].slice(0, 8).map(([address, v]) => ({ address, sourcePublished: v.verified })),
    counts: { transfers: transfers.length, approvals: approvals.length, logs: logs.length },
    notes,
  }
  facts.graph = buildGraph(facts, to === ENTRYPOINT)
  facts.allowedNumbers = [...numbersIn(JSON.stringify(facts))].sort()
  return { ok: true, facts }
}


/* ---------------------------------------------------------------- graph --- */

const ZERO_ADDR = '0x' + '0'.repeat(40)
/**
 * Flow graph for the <gully-tx-map> component, derived ONLY from the receipt: the top-level call, the user-operation
 * attribution, Transfer / Approval logs (each edge cites its logIndex) and the fee. Calls made inside the transaction
 * (internal calls) need a trace and are NOT invented: `complete:false` says so. Node kinds: wallet | contract | token |
 * pool | bridge | bundler | paymaster | address (an address whose code was not read, so it is not classified).
 */
export function buildGraph(f, isUserOp) {
  const nodes = new Map()
  const edges = []
  const steps = []
  const verifiedOf = (a) => f.contracts.find((c) => c.address === a)?.sourcePublished ?? null
  const node = (addr, kind, label) => {
    if (!addr) return null
    if (!nodes.has(addr)) nodes.set(addr, { id: addr, kind, label: label ?? short(addr), addr, verified: verifiedOf(addr) })
    return addr
  }
  const edge = (e, text) => {
    const id = `e${edges.length + 1}`
    edges.push({ id, amountUsd: null, amountRaw: null, token: null, logIndex: null, trace: null, failed: false, ...e, step: steps.length + 1 })
    steps.push({ n: steps.length + 1, text, edgeIds: [id] })
  }
  const actor = f.actor.address
  node(actor, 'wallet', isUserOp ? 'Smart account' : 'Sender')
  if (isUserOp) {
    node(f.aa.bundler, 'bundler', 'Bundler')
    node(ENTRYPOINT, 'contract', 'EntryPoint')
    edge({ from: f.aa.bundler, to: ENTRYPOINT, kind: 'call', trace: 'tx.to' }, `The bundler ${short(f.aa.bundler)} submitted the bundle to the EntryPoint.`)
    edge({ from: ENTRYPOINT, to: actor, kind: 'call', trace: 'UserOperationEvent' }, `The EntryPoint ran the operation for the smart account ${short(actor)}${f.aa.userOpSuccess === false ? ', and it failed' : ''}.`)
    if (f.aa.paymaster) node(f.aa.paymaster, 'paymaster', 'Sponsor')
  } else if (f.tx.to) {
    node(f.tx.to, 'contract', f.method?.name && f.method.source ? f.method.name : undefined)
    edge({ from: actor, to: f.tx.to, kind: 'call', failed: f.tx.status === 'reverted', trace: 'tx.to' }, `${short(actor)} called ${f.method?.name ?? 'a function'} on ${short(f.tx.to)}${f.tx.valueEth ? ` with ${f.tx.valueEth} ETH` : ''}.`)
  } else edge({ from: actor, to: actor, kind: 'call', trace: 'tx.to' }, 'The sender created a contract.')
  const kindOf = (a) => (a === actor ? 'wallet' : a === f.tx.to ? 'contract' : 'address')
  for (const t of f.transfers) {
    const burn = t.to === ZERO_ADDR
    const mint = t.from === ZERO_ADDR
    node(t.token, 'token', t.symbol ?? undefined)
    if (!mint) node(t.from, kindOf(t.from))
    if (!burn) node(t.to, kindOf(t.to))
    const kind = mint ? 'mint' : burn ? 'burn' : 'transfer'
    const who = (a) => (a === actor ? 'the sender' : short(a))
    edge({ from: mint ? t.token : t.from, to: burn ? t.token : t.to, kind, amountUsd: t.usd, amountRaw: t.amount, token: t.token, logIndex: t.logIndex }, t.kind === 'nft' ? `NFT ${t.tokenId} moved from ${who(t.from)} to ${who(t.to)}.` : `${t.amount} ${t.symbol ?? 'tokens'}${t.usd ? ` (${t.usd})` : ''} ${mint ? `was minted to ${who(t.to)}` : burn ? `was burned by ${who(t.from)}` : `moved from ${who(t.from)} to ${who(t.to)}`}.`)
  }
  for (const a of f.approvals) {
    node(a.token, 'token', a.symbol ?? undefined)
    node(a.owner, kindOf(a.owner))
    node(a.spender, kindOf(a.spender))
    edge({ from: a.owner, to: a.spender, kind: 'approve', amountRaw: a.amount, token: a.token, logIndex: a.logIndex }, `${short(a.owner)} let ${short(a.spender)} spend ${a.amount} ${a.symbol ?? 'tokens'}.`)
  }
  const payer = f.aa?.paymaster ?? actor
  node('network', 'address', 'Network fee')
  edge({ from: payer, to: 'network', kind: 'fee', amountUsd: f.fee.usd, amountRaw: f.fee.eth, trace: 'receipt' }, `Network fee ${f.fee.eth} ETH${f.fee.usd ? ` (${f.fee.usd})` : ''}.`)
  if (f.tx.status === 'reverted') steps.push({ n: steps.length + 1, text: `It failed here${f.tx.revertReason ? `: ${f.tx.revertReason}` : ''}. Nothing else moved.`, edgeIds: edges.filter((e) => e.failed).map((e) => e.id) })
  return { complete: false, note: 'Built from the receipt and its logs. Calls made inside the transaction need a trace and are not drawn.', nodes: [...nodes.values()], edges, steps, revertPoint: f.tx.status === 'reverted' ? f.tx.to : null }
}

/* ------------------------------------------------- grounding validation --- */

/** Number tokens of a text with commas removed; hex strings and shortened addresses are ignored. */
export function numbersIn(text) {
  const out = new Set()
  for (const m of String(text).replace(/0x[0-9a-fA-F…]+/g, ' ').matchAll(/\d[\d,]*(?:\.\d+)?/g)) out.add(m[0].replace(/,/g, '').replace(/\.$/, ''))
  return out
}
export const FORBIDDEN = /\b(safe|safely|safety|secure|guarantee[sd]?|audited|trustworthy|legit|legitimate|no risk|risk-free|verified|scam|rug|will go up|moon|profit|buy now|financial advice)\b/i
/** { ok, problems[] }: figures not in the facts, forbidden wording, missing testnet label. */
export function checkGrounded(text, facts) {
  const problems = []
  const allowed = new Set(facts.allowedNumbers ?? [])
  for (const n of numbersIn(text)) if (!allowed.has(n) && !allowed.has(String(Number(n)))) problems.push(`figure ${n} is not in the facts`)
  const w = String(text).match(FORBIDDEN)
  if (w) problems.push(`forbidden word "${w[0]}"`)
  if (!/testnet/i.test(text)) problems.push('missing testnet label')
  return { ok: problems.length === 0, problems }
}

/* -------------------------------------------------- template + model text --- */

/** Deterministic plain-words explanation built only from facts. Used when the model fails or breaks a rule. */
export function templateExplanation(f) {
  const nm = (a) => (a === f.actor.address ? 'the sender' : short(a))
  const parts = []
  if (f.aa) parts.push(`A smart account (${f.actor.short}) sent this through a bundler${f.aa.sponsored ? ', and a sponsor paid the network fee' : ''}.`)
  else parts.push(`${f.actor.short} sent this transaction.`)
  const m = f.method?.name
  if (f.aa) parts.push('The inner action is not decoded here; the transfers below show what moved.')
  else if (m === 'contract creation') parts.push('It created a new contract.')
  else if (m === 'plain transfer') parts.push(`It sent ${f.tx.valueEth ?? '0'} ETH${f.tx.valueUsd ? ` (${f.tx.valueUsd})` : ''} to ${short(f.tx.to)}.`)
  else if (m && f.method.source) parts.push(`It called ${m} on ${short(f.tx.to)}${f.method.source === 'sourcify' ? ', whose source is published' : ''}.`)
  else parts.push(`It called a function on ${short(f.tx.to)} that is not decoded, because the contract's source is not published.`)
  for (const t of f.transfers.filter((x) => x.kind === 'erc20').slice(0, 4)) parts.push(`${t.amount} ${t.symbol ?? 'tokens'}${t.usd ? ` (${t.usd}${t.thin ? ', thin liquidity' : ''})` : ''} moved from ${nm(t.from)} to ${nm(t.to)}.`)
  for (const a of f.approvals.slice(0, 2)) parts.push(`It gave ${short(a.spender)} permission to spend ${a.amount} ${a.symbol ?? 'tokens'}.`)
  if (f.tx.status === 'reverted') parts.push(`The transaction failed${f.tx.revertReason ? `: ${f.tx.revertReason}` : ' and no reason was readable'}. Nothing moved, but the network fee was still charged.${f.notes.find((x) => /gas limit/.test(x)) ? ' ' + f.notes.find((x) => /gas limit/.test(x)) : ''}`)
  else parts.push('It succeeded.')
  parts.push(`Network fee: ${f.fee.eth} ETH${f.fee.usd ? ` (${f.fee.usd})` : ''}.`)
  parts.push(`${TESTNET_LABEL}.`)
  return parts.join(' ')
}

export const SYSTEM_PROMPT = `You explain one blockchain transaction on Gully Chain Testnet in plain words for a developer or a new user.
You get a FACTS object. Rules:
- Use ONLY facts in the object. Every number you write (amounts, dollars, fees, counts, block) must be copied exactly from it. Never compute, round, convert or invent a figure.
- Name addresses in the short form given. Never guess what an unknown contract does; if the source is not published say the action is not decoded.
- If a user operation was bundled, credit the smart account (actor), not the bundler.
- If status is reverted, say it failed, give the revert reason only if present, and say the fee was still charged.
- Do not give advice, opinions on price, or judgements such as safe, trustworthy, secure, audited or verified.
- Write 2 to 5 short sentences, no lists, no markdown. End with: Testnet: no real value.`

/** Plain-words explanation. Returns { text, source:'model'|'template', problems[] }. Never called with empty facts (explainTx guards). */
export async function explain(facts, { gw = defaultGateway, logger = null } = {}) {
  // eslint-disable-next-line no-unused-vars
  const { allowedNumbers, graph, ...shown } = facts
  try {
    const out = await gw.run('summarize', { system: SYSTEM_PROMPT, messages: [{ role: 'user', content: JSON.stringify(shown) }], maxTokens: 350, temperature: 0 })
    const text = String(out.text ?? '').trim()
    const chk = checkGrounded(text, facts)
    if (text && chk.ok) return { text, source: 'model', model: out.model, provider: out.provider, usage: out.usage, problems: [] }
    logger?.('explain-tx: model answer rejected', chk.problems)
    return { text: templateExplanation(facts), source: 'template', problems: chk.problems.length ? chk.problems : ['empty answer'] }
  } catch (e) {
    logger?.('explain-tx: model unavailable', String(e?.message ?? e))
    return { text: templateExplanation(facts), source: 'template', problems: ['model unavailable'] }
  }
}

/** Facts then explanation. Returns the API body or { ok:false, status, error, code }. */
export async function explainTx(input, { deps = realDeps(), gw = defaultGateway, beforeModel = null, logger = null } = {}) {
  const r = await buildFacts(input, deps)
  if (!r.ok) {
    const map = { bad_input: [400, 'Send a 0x transaction hash (66 characters).'], wrong_chain: [400, 'Only Gully Chain Testnet (485590) is supported for now.'], not_found: [404, 'No transaction with that hash was found on Gully Chain Testnet.'], pending: [202, 'That transaction has not been included in a block yet.'], unavailable: [503, 'The chain could not be read just now. Try again shortly.'] }
    const [status, error] = map[r.code]
    return { ok: false, status, error, code: r.code }
  }
  if (beforeModel) {
    const g = await beforeModel({ facts: r.facts })
    if (!g?.ok) return { ok: false, status: g?.status ?? 402, error: g?.error ?? 'Not enough credits.', code: g?.code ?? 'credits' }
  }
  const e = await explain(r.facts, { gw, logger })
  // eslint-disable-next-line no-unused-vars
  const { allowedNumbers, ...facts } = r.facts
  return { ok: true, explanation: e.text, source: e.source, label: TESTNET_LABEL, facts, ...(e.problems.length ? { fellBackBecause: e.problems.slice(0, 3) } : {}), ...(e.usage ? { usage: e.usage } : {}) }
}

/* ---------------------------------------------------------------- route --- */

let creditsHook = null
/** The gcredits service plugs in here: async ({ who, facts }) => ({ ok, status?, error?, code? }). Nothing is charged today. */
export const setExplainCreditsHook = (fn) => (creditsHook = typeof fn === 'function' ? fn : null)
export const explainEnabled = () => String(process.env.AI_EXPLAIN_TX ?? '0') === '1'

/**
 * POST /api/ai/explain-tx  { chainId?: 485590, txHash }   -> 200 { explanation, source, facts, label }
 * Returns false when the path is not ours. Flag off = 404 (the route does not exist).
 */
export async function handleExplainTx(req, res, url, injected = {}) {
  if (url.pathname !== '/api/ai/explain-tx') return false
  const { json, readJson, clientIp } = injected.http ?? (await import('../http.mjs'))
  if (!explainEnabled()) return json(res, 404, { error: 'not found' }), true
  if (req.method !== 'POST') return json(res, 405, { error: 'POST only' }, { Allow: 'POST' }), true
  if (req.headers['x-requested-with'] !== 'gully') return json(res, 403, { error: 'Cross-site request refused.' }), true
  const body = await readJson(req, 2_048)
  if (!body || typeof body !== 'object') return json(res, 400, { error: 'Send JSON: { txHash }.' }), true
  const takeAllowance = injected.takeAllowance ?? (await import('../ask.mjs')).takeAllowance
  const key = 'explain:' + clientIp(req)
  const a = takeAllowance(key, { perMin: Number(process.env.EXPLAIN_IP_PER_MIN) || 4, perDay: Number(process.env.EXPLAIN_IP_PER_DAY) || 40 })
  if (!a.ok) return json(res, a.status, { error: a.error }, a.retryAfter ? { 'Retry-After': String(a.retryAfter) } : {}), true
  const r = await explainTx({ chainId: body.chainId ?? CHAIN_ID, txHash: body.txHash }, { deps: injected.deps ?? realDeps(), gw: injected.gw ?? defaultGateway, beforeModel: creditsHook ? ({ facts }) => creditsHook({ who: key, facts }) : null, logger: (...x) => console.error(...x) })
  if (!r.ok) return json(res, r.status, { error: r.error, code: r.code }), true
  return json(res, 200, r), true
}
