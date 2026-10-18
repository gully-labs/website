// Sign-In with Ethereum (EIP-4361) for the developer dashboard, with no npm dependencies at runtime.
//
// Signatures are checked with @noble/curves secp256k1 and @noble/hashes keccak_256,
// vendored as one ES module in ./vendor/noble.mjs (see scripts/vendor-noble.mjs). When ecrecover does
// not give the message's address, a smart-contract wallet may still have signed: EIP-1271
// isValidSignature(bytes32,bytes) (or, for an undeployed wallet, the ERC-6492 validator) is called over
// a public RPC for the message's chain.
//
// Nonces are random, single-use, expire after ten minutes and live in memory only (a restart simply
// makes an open sign-in ask for a new one).

import crypto from 'node:crypto'
import { erc6492SignatureValidatorByteCode, keccak_256, secp256k1 } from './vendor/noble.mjs'

const NONCE_TTL_MS = 10 * 60_000
const MAX_NONCES = 20_000
const CLOCK_SKEW_MS = 5 * 60_000
const nonces = new Map() // nonce -> expiresAt (ms)

/** Public RPCs used for EIP-1271 checks, by chain id. */
export const RPCS = {
  1: 'https://ethereum-rpc.publicnode.com',
  8453: 'https://mainnet.base.org',
  56: 'https://bsc-dataseed.bnbchain.org',
  4663: 'https://rpc.mainnet.chain.robinhood.com',
}

function pruneNonces() {
  const now = Date.now()
  for (const [n, exp] of nonces) if (exp <= now) nonces.delete(n)
}

/** A fresh nonce (alphanumeric, as EIP-4361 requires), valid once for ten minutes. */
export function issueNonce() {
  if (nonces.size >= MAX_NONCES) pruneNonces()
  if (nonces.size >= MAX_NONCES) return null
  const nonce = crypto.randomBytes(16).toString('hex')
  const expiresAt = Date.now() + NONCE_TTL_MS
  nonces.set(nonce, expiresAt)
  return { nonce, expiresAt: new Date(expiresAt).toISOString() }
}

/** Removes the nonce and says whether it was live. Consumed before any slow check, so it can never be replayed. */
export function consumeNonce(nonce) {
  const exp = nonces.get(nonce)
  if (exp === undefined) return false
  nonces.delete(nonce)
  return exp > Date.now()
}

setInterval(pruneNonces, 60_000).unref?.()

/* ------------------------------------------------------------- parsing --- */

const MESSAGE_RE = new RegExp(
  '^(?<domain>[^\\s/]+) wants you to sign in with your Ethereum account:\\n' +
    '(?<address>0x[a-fA-F0-9]{40})\\n\\n' +
    '(?:(?<statement>[^\\n]+)\\n)?\\n?' +
    'URI: (?<uri>[^\\s]+)\\n' +
    'Version: (?<version>1)\\n' +
    'Chain ID: (?<chainId>[1-9][0-9]{0,15})\\n' +
    'Nonce: (?<nonce>[a-zA-Z0-9]{8,64})\\n' +
    'Issued At: (?<issuedAt>[0-9TZ:.+-]{20,40})' +
    '(?:\\nExpiration Time: (?<expirationTime>[0-9TZ:.+-]{20,40}))?' +
    '(?:\\nNot Before: (?<notBefore>[0-9TZ:.+-]{20,40}))?' +
    '(?:\\nRequest ID: (?<requestId>[^\\n]*))?' +
    '(?:\\nResources:(?<resources>(?:\\n- [^\\s]+)*))?$',
)

/** Parses an EIP-4361 message, or returns null when it is not one. */
export function parseSiwe(message) {
  if (typeof message !== 'string' || message.length > 4000) return null
  const m = MESSAGE_RE.exec(message)
  if (!m?.groups) return null
  const g = m.groups
  const t = (s) => (s === undefined ? null : Date.parse(s))
  const issuedAt = t(g.issuedAt)
  const expirationTime = t(g.expirationTime)
  const notBefore = t(g.notBefore)
  if (Number.isNaN(issuedAt) || Number.isNaN(expirationTime) || Number.isNaN(notBefore)) return null
  return { domain: g.domain, address: g.address, statement: g.statement ?? null, uri: g.uri, version: g.version, chainId: Number(g.chainId), nonce: g.nonce, issuedAt, expirationTime, notBefore }
}

/* ---------------------------------------------------------- signatures --- */

const enc = new TextEncoder()
const toHex = (b) => Buffer.from(b).toString('hex')
const fromHex = (h) => Uint8Array.from(Buffer.from(h.replace(/^0x/, ''), 'hex'))

/** EIP-191 personal_sign digest of a UTF-8 message. */
export function hashPersonalMessage(message) {
  const body = enc.encode(message)
  const prefix = enc.encode(`\x19Ethereum Signed Message:\n${body.length}`)
  const all = new Uint8Array(prefix.length + body.length)
  all.set(prefix)
  all.set(body, prefix.length)
  return keccak_256(all)
}

/** Lower-case address that produced a 65-byte (r, s, v) signature over a digest, or null. */
export function recoverAddress(digest, signatureHex) {
  if (!/^0x[0-9a-fA-F]{130}$/.test(signatureHex)) return null
  const bytes = fromHex(signatureHex)
  let v = bytes[64]
  if (v >= 27) v -= 27
  if (v !== 0 && v !== 1) return null
  try {
    const sig = secp256k1.Signature.fromCompact(bytes.slice(0, 64)).addRecoveryBit(v)
    // Malleable high-s signatures are refused, as Ethereum has done since Homestead.
    if (sig.hasHighS()) return null
    const pub = sig.recoverPublicKey(digest).toRawBytes(false)
    return '0x' + toHex(keccak_256(pub.slice(1)).slice(12))
  } catch {
    return null
  }
}

const word = (n) => n.toString(16).padStart(64, '0')
const ERC6492_SUFFIX = '6492649264926492649264926492649264926492649264926492649264926492'

async function ethCall(chainId, call) {
  const rpc = RPCS[chainId]
  if (!rpc) return null
  try {
    const r = await fetch(rpc, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [call, 'latest'] }),
      signal: AbortSignal.timeout(6000),
    })
    const j = await r.json()
    return typeof j?.result === 'string' ? j.result.toLowerCase() : null
  } catch {
    return null
  }
}

/**
 * Smart-contract wallets. A deployed wallet answers EIP-1271 isValidSignature(bytes32,bytes) with the
 * magic value 0x1626ba7e. A counterfactual (not yet deployed) wallet signs with an ERC-6492 wrapper; that
 * is checked with the reference UniversalSigValidator run as a deployless eth_call, which answers 0x01.
 * False on any failure or for a chain without a configured RPC.
 */
export function contractCheckCall(address, digest, signatureHex) {
  const sig = signatureHex.slice(2).toLowerCase()
  if (sig.length % 2 || sig.length > 16_384) return null
  const bytesArg = word(sig.length / 2) + sig.padEnd(Math.ceil(sig.length / 64) * 64, '0')
  if (sig.endsWith(ERC6492_SUFFIX)) return { kind: '6492', call: { data: erc6492SignatureValidatorByteCode + '0'.repeat(24) + address.slice(2) + toHex(digest) + word(96) + bytesArg } }
  return { kind: '1271', call: { to: address, data: '0x1626ba7e' + toHex(digest) + word(64) + bytesArg } }
}

async function isValidContractSignature(chainId, address, digest, signatureHex) {
  const c = contractCheckCall(address, digest, signatureHex)
  if (!c) return false
  const out = await ethCall(chainId, c.call)
  return c.kind === '6492' ? out === '0x01' : !!out && out.startsWith('0x1626ba7e')
}

/**
 * Verifies a signed SIWE message for the given expected host. Resolves to
 * { ok: true, address, chainId, expiresAt } or { ok: false, error }.
 */
export async function verifySiwe({ message, signature, host, secureOrigin }) {
  const msg = parseSiwe(message)
  if (!msg) return { ok: false, error: 'That is not a Sign-In with Ethereum message.' }
  if (typeof signature !== 'string' || !/^0x[0-9a-fA-F]{2,16384}$/.test(signature)) return { ok: false, error: 'Missing or malformed signature.' }
  if (msg.domain.toLowerCase() !== host.toLowerCase()) return { ok: false, error: 'The message was signed for another site.' }
  let uri
  try {
    uri = new URL(msg.uri)
  } catch {
    return { ok: false, error: 'The message URI is not a URL.' }
  }
  if (uri.host.toLowerCase() !== host.toLowerCase() || (secureOrigin && uri.protocol !== 'https:')) return { ok: false, error: 'The message URI does not match this site.' }
  if (!Number.isSafeInteger(msg.chainId) || msg.chainId < 1) return { ok: false, error: 'Bad chain id.' }
  const now = Date.now()
  if (msg.issuedAt > now + CLOCK_SKEW_MS || msg.issuedAt < now - NONCE_TTL_MS - CLOCK_SKEW_MS) return { ok: false, error: 'The message is too old or from the future. Sign again.' }
  if (msg.expirationTime !== null && msg.expirationTime <= now) return { ok: false, error: 'The message has expired. Sign again.' }
  if (msg.notBefore !== null && msg.notBefore > now + CLOCK_SKEW_MS) return { ok: false, error: 'The message is not valid yet.' }
  // Single use: consumed whether or not the signature turns out to be good.
  if (!consumeNonce(msg.nonce)) return { ok: false, error: 'This sign-in request has expired or was already used. Sign again.' }

  const address = msg.address.toLowerCase()
  const digest = hashPersonalMessage(message)
  const recovered = recoverAddress(digest, signature)
  if (recovered === address) return { ok: true, address, chainId: msg.chainId }
  if (await isValidContractSignature(msg.chainId, address, digest, signature)) return { ok: true, address, chainId: msg.chainId, contract: true }
  return { ok: false, error: 'The signature does not match the address.' }
}
