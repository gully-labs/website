// Holder Map for ANY token: the checks that run before anything is built, and the budgets that keep the
// endpoint from being used to drain our RPC and holder-API quota.
//
//   probeToken(chainKey, address)   is this address a token on that chain? ERC-20: a contract that answers
//                                   decimals() and totalSupply(); Solana: an account that is a mint.
//                                   Results are cached (a token stays a token), so a re-ask is free.
//   detectChains(address, ctx)      the same probe on every supported chain at once, for a pasted address
//                                   that comes with no chain.
//   takeAnyBuild(ip) / takeProbe(ip) the budgets for non-listed tokens (see ANY below).
//
// Nothing here invents data: an unreadable chain is reported as unreadable, never as "not a token".

import { evmBatch, HOLDER_CHAINS } from './holders.mjs'
import { isSolanaAddress, solanaRpc, TOKEN_2022_PROGRAM, TOKEN_PROGRAM } from './solana.mjs'

/** The limits for tokens that are neither tracked stocks nor known launches ("non-listed"). */
export const ANY = {
  /** New (uncached) non-listed maps one IP may cause per minute (listed tokens: PER_IP_PER_MIN in holders.mjs). */
  buildsPerIpPerMin: 5,
  /** New non-listed maps across all IPs per minute. */
  buildsPerMin: 30,
  /** Non-listed maps being built at the same moment (MAX_BUILDS stays the overall ceiling). */
  maxConcurrent: 2,
  /** Address probes (search box) per IP per minute, and across all IPs. Cached answers are free. */
  probesPerIpPerMin: 8,
  probesPerMin: 60,
  /** Probe cache: a token, not a token, an unreadable chain. */
  tokenTtlMs: 3_600_000,
  notTokenTtlMs: 600_000,
  unreadableTtlMs: 20_000,
  cacheMax: 3_000,
}

/* ------------------------------------------------------------------ budgets --- */

/** A sliding one-minute window per key plus one for everyone. take(ip) -> true (and counted) / false. */
function makeBudget(perIp, global) {
  let ips = new Map()
  let all = []
  return {
    take(ip) {
      const now = Date.now()
      all = all.filter((t) => now - t < 60_000)
      if (all.length >= global) return false
      if (ip) {
        const list = (ips.get(ip) ?? []).filter((t) => now - t < 60_000)
        if (list.length >= perIp) return false
        list.push(now)
        ips.set(ip, list)
        if (ips.size > 5_000) for (const [k, v] of ips) if (!v.some((t) => now - t < 60_000)) ips.delete(k)
      }
      all.push(now)
      return true
    },
    reset() {
      ips = new Map()
      all = []
    },
  }
}
let buildBudget = makeBudget(ANY.buildsPerIpPerMin, ANY.buildsPerMin)
let probeBudget = makeBudget(ANY.probesPerIpPerMin, ANY.probesPerMin)
/** Count one new non-listed map against the IP's and the global per-minute budgets. */
export const takeAnyBuild = (ip) => buildBudget.take(ip)
/** Count one address probe (search) against the same kind of budgets. */
export const takeProbe = (ip) => probeBudget.take(ip)
let buildingAny = 0
/** Reserve one of the ANY.maxConcurrent slots; call the returned release when the build ends. null when full. */
export function reserveAnySlot() {
  if (buildingAny >= ANY.maxConcurrent) return null
  buildingAny++
  let done = false
  return () => {
    if (!done) {
      done = true
      buildingAny--
    }
  }
}

/* ------------------------------------------------------------------- decoding --- */

/** Token names come from the chain: printable text only, no markup characters, bounded. */
export function cleanText(v, max) {
  let s = ''
  for (const ch of String(v ?? '')) {
    const c = ch.codePointAt(0)
    const bad = c < 32 || (c >= 127 && c <= 159) || (c >= 0x200b && c <= 0x200f) || (c >= 0x2028 && c <= 0x202e) || (c >= 0x2066 && c <= 0x2069) || '<>&"`'.includes(ch)
    if (!bad) s += ch
  }
  s = s.replace(/\s+/g, ' ').trim()
  return s ? s.slice(0, max) : null
}

/** An ABI-encoded string() return, or a legacy bytes32 name. null when it is neither. */
export function decodeAbiString(hex) {
  if (typeof hex !== 'string' || !/^0x([0-9a-f]{2})*$/i.test(hex)) return null
  const body = hex.slice(2)
  try {
    if (body.length === 64) return cleanText(Buffer.from(body, 'hex').toString('utf8'), 64)
    if (body.length >= 128) {
      const off = Number(BigInt('0x' + body.slice(0, 64))) * 2
      const len = Number(BigInt('0x' + body.slice(off, off + 64))) * 2
      if (!Number.isSafeInteger(off) || !Number.isSafeInteger(len) || len > 512) return null
      return cleanText(Buffer.from(body.slice(off + 64, off + 64 + len), 'hex').toString('utf8'), 64)
    }
  } catch {
    return null
  }
  return null
}

const uint = (h) => (typeof h === 'string' && /^0x[0-9a-f]{1,64}$/i.test(h) ? BigInt(h) : null)

/* --------------------------------------------------------------------- probes --- */

const cache = new Map() // `${chain}:${address}` -> { at, ttl, res }
const inflight = new Map()
const keyOf = (chainKey, address) => `${chainKey}:${chainKey === 'solana' ? address : String(address).toLowerCase()}`
const cached = (k) => {
  const hit = cache.get(k)
  return hit && Date.now() - hit.at < hit.ttl ? hit.res : null
}
/** True when the probe for this address on this chain would be answered from the cache (so it costs no budget). */
export const probeCached = (chainKey, address) => !!cached(keyOf(chainKey, address))

async function probeEvm(chainKey, address) {
  const a = address.toLowerCase()
  const calls = [
    ['eth_getCode', [a, 'latest']],
    ['eth_call', [{ to: a, data: '0x313ce567' }, 'latest']], // decimals()
    ['eth_call', [{ to: a, data: '0x18160ddd' }, 'latest']], // totalSupply()
    ['eth_call', [{ to: a, data: '0x95d89b41' }, 'latest']], // symbol()
    ['eth_call', [{ to: a, data: '0x06fdde03' }, 'latest']], // name()
  ]
  const [code, dec, sup, sym, nm] = await evmBatch(chainKey, calls)
  if (code === null || code === undefined) return { status: 'unreadable', reason: `${HOLDER_CHAINS[chainKey].name} did not answer.` }
  if (code === '0x' || code === '0x0') return { status: 'not-token', reason: `There is no contract at this address on ${HOLDER_CHAINS[chainKey].name}.` }
  const decimals = uint(dec)
  const supply = uint(sup)
  if (decimals === null || decimals > 255n || supply === null) return { status: 'not-token', reason: `It is a contract on ${HOLDER_CHAINS[chainKey].name}, but it does not answer like an ERC-20 token (decimals and total supply).` }
  return { status: 'token', decimals: Number(decimals), supply, symbol: decodeAbiString(sym) ? cleanText(decodeAbiString(sym), 24) : null, name: decodeAbiString(nm) }
}

async function probeSolana(mint) {
  let info
  try {
    info = await solanaRpc('getAccountInfo', [mint, { encoding: 'jsonParsed' }])
  } catch {
    return { status: 'unreadable', reason: 'Solana did not answer.' }
  }
  const v = info?.value
  if (!v) return { status: 'not-token', reason: 'There is no account at this address on Solana.' }
  const p = v.data?.parsed
  if ((v.owner !== TOKEN_PROGRAM && v.owner !== TOKEN_2022_PROGRAM) || p?.type !== 'mint') return { status: 'not-token', reason: 'It is an account on Solana, but not a token mint.' }
  const ext = Array.isArray(p.info?.extensions) ? p.info.extensions.find((e) => e?.extension === 'tokenMetadata')?.state : null
  const supply = /^\d+$/.test(String(p.info?.supply ?? '')) ? BigInt(p.info.supply) : null
  return { status: 'token', decimals: Number.isInteger(p.info?.decimals) ? p.info.decimals : null, supply, symbol: cleanText(ext?.symbol, 24), name: cleanText(ext?.name, 64) }
}

/**
 * Is `address` a token on `chainKey`? { status: 'token', decimals, supply, symbol, name } | { status: 'not-token', reason }
 * | { status: 'unreadable', reason }. Cached; one upstream batch per uncached chain and address.
 */
export async function probeToken(chainKey, address) {
  if (!HOLDER_CHAINS[chainKey]) return { status: 'not-token', reason: 'Unknown chain.' }
  const solana = chainKey === 'solana'
  if (solana ? !isSolanaAddress(address) : !/^0x[0-9a-fA-F]{40}$/.test(address)) return { status: 'not-token', reason: 'That is not a valid address for this chain.' }
  const k = keyOf(chainKey, address)
  const hit = cached(k)
  if (hit) return hit
  if (inflight.has(k)) return inflight.get(k)
  const p = (solana ? probeSolana(address) : probeEvm(chainKey, address))
    .catch(() => ({ status: 'unreadable', reason: `${HOLDER_CHAINS[chainKey].name} did not answer.` }))
    .then((res) => {
      cache.set(k, { at: Date.now(), ttl: res.status === 'token' ? ANY.tokenTtlMs : res.status === 'not-token' ? ANY.notTokenTtlMs : ANY.unreadableTtlMs, res })
      if (cache.size > ANY.cacheMax) cache.delete(cache.keys().next().value)
      return res
    })
    .finally(() => inflight.delete(k))
  inflight.set(k, p)
  return p
}

/** The EVM chains a pasted 0x address is checked on, in display order. */
export const EVM_CHAINS = ['robinhood', 'bsc', 'base', 'hyperevm', 'gully']

/**
 * A pasted address with no chain: the probe on every supported chain at once.
 * { busy: true } when the probe budget is spent and the answer is not cached; else
 * { results: [{ chain, chainName, status, reason?, symbol?, name?, decimals? }] } (all chains, in order).
 */
export async function detectChains(address, { ip = null } = {}) {
  const solana = isSolanaAddress(address) && !/^0x/i.test(address)
  const chains = solana ? ['solana'] : EVM_CHAINS
  if (!chains.every((c) => probeCached(c, address)) && !takeProbe(ip)) return { busy: true, results: [] }
  const res = await Promise.all(chains.map((c) => probeToken(c, address)))
  return { results: chains.map((c, i) => ({ chain: c, chainName: HOLDER_CHAINS[c].name, ...res[i], supply: undefined })) }
}

/** Test hook. */
export function resetAnyForTest() {
  cache.clear()
  inflight.clear()
  buildBudget = makeBudget(ANY.buildsPerIpPerMin, ANY.buildsPerMin)
  probeBudget = makeBudget(ANY.probesPerIpPerMin, ANY.probesPerMin)
  buildingAny = 0
}
