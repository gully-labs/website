// Gully Pay on Solana: the chain entry and assets payments.mjs lists, the SOL/USD price, Solana Pay
// transfer-request URLs, and how a payment transaction is read and checked. billing.mjs uses these
// through payments.mjs exactly as it uses the EVM chains: same quotes, same ledger, same reuse rule.
//
// Spec followed: Solana Pay transfer requests (https://docs.solanapay.com/spec):
//   solana:<recipient>?amount=<decimal>&spl-token=<mint>&reference=<pubkey>&label=&message=
// Each quote gets its own `reference` (32 random bytes as a public key). A wallet that follows the spec
// adds it as a read-only key to the transfer instruction, so the payment is found with
// getSignaturesForAddress(reference) and nobody has to paste a signature. A signature pasted by hand is
// checked the same way; the reference is then optional because the quote's exact amount already names it.
//
// A payment counts when (readSolanaPayment, then billing.mjs's shared rules):
//   - the transaction is FINALIZED (anything less answers 202, try again shortly) and did not fail;
//   - SOL: the treasury's own balance rose (post - pre lamports) by the amount;
//     USDC/USDT: the treasury's ASSOCIATED token account for that mint rose by the amount, in that mint
//     (classic SPL Token program); a transfer to any other account, in any other mint, does not count;
//   - the signature was never used before for any payment (the ledger is shared with the EVM chains).
//
// Every address below was checked on mainnet (getAccountInfo, jsonParsed) on 2026-10-17:
//   USDC EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v  mint, 6 decimals, SPL Token program
//   USDT Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB  mint, 6 decimals, SPL Token program
// SOL is priced like the EVM coins, by a Chainlink feed read with latestRoundData(): Chainlink's SOL / USD
// on Arbitrum, 0x24ceA4b8ce57cdA5058b924B9B9987992450590c (Chainlink's feed directory; checked on chain
// 2026-10-17: description "SOL / USD", 8 decimals, 0.1% deviation, 24 h heartbeat). payments.readFeed
// reads it through Arbitrum's RPCs (feed.chainId); answers older than two hours give no SOL quote.
//
// Env:
//   GULLY_SOLANA_TREASURY  the receiving wallet (a Squads vault is fine). Unset: Solana checkout is off,
//                          its assets are not offered and every page says so. No fallback, ever.
//   GULLY_RPC_SOLANA       RPC URLs (solana.mjs).

import { associatedTokenAddress, isSolanaAddress, isSolanaSignature, solanaRpc, TOKEN_PROGRAM } from './solana.mjs'

/** Solana has no EVM chain id; the ledger keys chains by number, so it uses LI.FI's id for Solana. */
export const SOLANA_CHAIN_ID = 1151111081099710

export const SOLANA_CHAIN = {
  id: SOLANA_CHAIN_ID,
  key: 'solana',
  name: 'Solana',
  kind: 'solana',
  explorer: 'https://solscan.io',
  explorerName: 'Solscan',
  // "1 confirmation" here means finalized (31+ confirmed blocks on top, roughly 13 s).
  confirmations: 1,
  rpcs: [],
  // Chainlink SOL / USD on Arbitrum (chainId 42161), read through Arbitrum's RPCs by payments.readFeed.
  feed: { address: '0x24cea4b8ce57cda5058b924b9b9987992450590c', chainId: 42161, decimals: 8, description: 'SOL / USD', maxAgeSec: 2 * 3600, explorer: 'https://arbiscan.io' },
}

/** tagStep: a SOL quote's unique tail is in lamports (1e-9 SOL), not on the 1e9-wei grid EVM coins use. */
export const SOLANA_ASSETS = [
  { id: 'solana-usdc', chainId: SOLANA_CHAIN_ID, symbol: 'USDC', name: 'USD Coin', kind: 'token', address: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', decimals: 6, tokenProgram: TOKEN_PROGRAM },
  { id: 'solana-usdt', chainId: SOLANA_CHAIN_ID, symbol: 'USDT', name: 'Tether USD', kind: 'token', address: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', decimals: 6, tokenProgram: TOKEN_PROGRAM },
  { id: 'solana-sol', chainId: SOLANA_CHAIN_ID, symbol: 'SOL', name: 'Solana', kind: 'native', address: null, decimals: 9, tagStep: '1' },
]

export const isSolanaAsset = (a) => a?.chainId === SOLANA_CHAIN_ID

/** The Solana treasury from GULLY_SOLANA_TREASURY, or null when unset or not an address. Case kept (base58). */
export function solanaTreasury() {
  const t = String(process.env.GULLY_SOLANA_TREASURY ?? '').trim()
  return isSolanaAddress(t) && t !== '11111111111111111111111111111111' ? t : null
}

export const solanaPayOn = () => solanaTreasury() !== null

/* -------------------------------------------------------- Solana Pay URL --- */

/** Raw units as a plain decimal (no exponent, no trailing zeros), as the spec's `amount` requires. */
export function unitsToDecimal(raw, decimals) {
  const r = BigInt(raw)
  if (r <= 0n) throw new Error('amount must be positive')
  const base = 10n ** BigInt(decimals)
  const frac = (r % base).toString().padStart(decimals, '0').replace(/0+$/, '')
  return `${r / base}${frac ? '.' + frac : ''}`
}

/**
 * The Solana Pay transfer request for an exact amount:
 *   SOL   solana:<treasury>?amount=<SOL>&reference=<ref>&label=…&message=…
 *   token solana:<treasury>?amount=<tokens>&spl-token=<mint>&reference=<ref>&label=…&message=…
 * Built from base units with BigInt only, so the QR asks for exactly the quoted amount.
 */
export function solanaPayUrl({ asset, recipient, amountRaw, reference, label = 'Gully Labs', message = '' }) {
  if (!isSolanaAddress(recipient)) throw new Error('recipient must be a Solana address')
  const q = [`amount=${unitsToDecimal(amountRaw, asset.decimals)}`]
  if (asset.kind === 'token') q.push(`spl-token=${asset.address}`)
  if (reference) {
    if (!isSolanaAddress(reference)) throw new Error('reference must be a Solana address')
    q.push(`reference=${reference}`)
  }
  if (label) q.push(`label=${encodeURIComponent(label)}`)
  if (message) q.push(`message=${encodeURIComponent(message)}`)
  return `solana:${recipient}?${q.join('&')}`
}

/* ------------------------------------------------- reading a payment --- */

const keyOf = (k) => (typeof k === 'string' ? k : k?.pubkey)

/**
 * Reads a Solana transaction and lists what it paid the treasury in the asset, in payments.readPayment's
 * shape so billing.mjs's checks apply unchanged:
 *   { ok: true, credits: [{ from, value }], blockNumber (slot), blockHex, minedAt, confirmations, needed, referenceFound }
 *   { ok: false, status, error, pending?, confirmations?, needed? }
 */
export async function readSolanaPayment(asset, signature, treasury, { reference = null } = {}) {
  const needed = 1
  if (!isSolanaSignature(signature)) return { ok: false, status: 400, error: 'That is not a Solana transaction signature (base58, 87 or 88 characters).' }
  const opts = (commitment) => [signature, { commitment, encoding: 'jsonParsed', maxSupportedTransactionVersion: 0 }]
  let tx
  try {
    tx = await solanaRpc('getTransaction', opts('finalized'))
  } catch (e) {
    return { ok: false, status: 502, error: `Solana could not be read just now (${String(e?.message ?? e)}). Try again in a minute.` }
  }
  if (!tx) {
    let seen = null
    try {
      const st = await solanaRpc('getSignatureStatuses', [[signature], { searchTransactionHistory: true }])
      seen = st?.value?.[0] ?? null
    } catch {
      /* treated as not seen */
    }
    if (seen?.err) return { ok: false, status: 422, error: 'This transaction failed on Solana, so nothing was paid.' }
    if (seen) return { ok: false, status: 202, pending: true, confirmations: 0, needed, error: `The transaction is ${seen.confirmationStatus ?? 'processed'} but not finalized yet. Solana finalizes in about 15 seconds; check again shortly.` }
    return { ok: false, status: 202, pending: true, confirmations: 0, needed, error: 'Solana does not know this transaction yet. If you just sent it, wait a few seconds and check again.' }
  }
  if (tx.meta?.err) return { ok: false, status: 422, error: 'This transaction failed on Solana, so nothing was paid.' }
  const keys = (tx.transaction?.message?.accountKeys ?? []).map(keyOf)
  const sigs = tx.transaction?.signatures ?? []
  if (!keys.length || !tx.meta || sigs[0] !== signature) return { ok: false, status: 502, error: 'The Solana node gave an incomplete answer for this transaction. Try again in a minute.' }
  const feePayer = keys[0]
  const slot = Number(tx.slot)
  const base = { ok: true, blockNumber: slot, blockHex: '0x' + slot.toString(16), minedAt: tx.blockTime ? tx.blockTime * 1000 : null, confirmations: 1, needed, referenceFound: reference ? keys.includes(reference) : null }

  const lamportsDelta = (i) => (i >= 0 ? BigInt(tx.meta.postBalances?.[i] ?? 0) - BigInt(tx.meta.preBalances?.[i] ?? 0) : 0n)
  const ti = keys.indexOf(treasury)

  if (asset.kind === 'native') {
    if (ti < 0) return { ok: false, status: 422, error: 'This transaction sent SOL to another address, not to the Gully Labs treasury.' }
    // If the treasury paid the fee itself, its delta is net of the fee; the payment is then not a deposit.
    const value = lamportsDelta(ti)
    if (value <= 0n) return { ok: false, status: 422, error: 'This transaction sent no SOL to the treasury. Paying in SOL is a plain transfer of the coin, not a token.' }
    return { ...base, credits: [{ from: feePayer, value }] }
  }

  const ata = associatedTokenAddress(treasury, asset.address, asset.tokenProgram ?? TOKEN_PROGRAM)
  const amountOf = (list, i, mint) => {
    const e = (list ?? []).find((b) => b.accountIndex === i && b.mint === mint)
    return e ? BigInt(e.uiTokenAmount?.amount ?? '0') : 0n
  }
  const touched = [...new Set([...(tx.meta.preTokenBalances ?? []), ...(tx.meta.postTokenBalances ?? [])].map((b) => `${b.accountIndex}|${b.mint}|${b.owner ?? ''}`))].map((s) => {
    const [i, mint, owner] = s.split('|')
    const idx = Number(i)
    return { idx, account: keys[idx], mint, owner, delta: amountOf(tx.meta.postTokenBalances, idx, mint) - amountOf(tx.meta.preTokenBalances, idx, mint) }
  })
  const credit = touched.filter((x) => x.account === ata && x.mint === asset.address && x.delta > 0n)
  if (!credit.length) {
    if (touched.some((x) => x.owner === treasury && x.delta > 0n && x.mint !== asset.address)) return { ok: false, status: 422, error: `This transaction sent a token other than ${asset.symbol} to the treasury. Only ${asset.symbol} (${asset.address.slice(0, 4)}…${asset.address.slice(-4)}) counts.` }
    if (touched.some((x) => x.owner === treasury && x.delta > 0n && x.mint === asset.address)) return { ok: false, status: 422, error: `This transaction sent ${asset.symbol} to a token account of the treasury that is not its associated account (${ata}). Write to team@gullylabs.xyz with the signature.` }
    if (touched.some((x) => x.mint === asset.address && x.delta > 0n)) return { ok: false, status: 422, error: `This transaction sent ${asset.symbol}, but not to the Gully Labs treasury.` }
    if (lamportsDelta(ti) > 0n) return { ok: false, status: 422, error: `This transaction sent SOL, not ${asset.symbol}. Choose SOL as the asset to pay with it.` }
    return { ok: false, status: 422, error: `This transaction has no ${asset.symbol} transfer to the Gully Labs treasury.` }
  }
  // The payer: the owner of the account in that mint whose balance fell most, else the fee payer.
  const debit = touched.filter((x) => x.mint === asset.address && x.delta < 0n).sort((a, b) => (a.delta < b.delta ? -1 : 1))[0]
  const from = debit?.owner || feePayer
  return { ...base, credits: credit.map((c) => ({ from, value: c.delta })) }
}

/** Signatures that touched a quote's reference key, newest first, failed ones left out. */
export async function findByReference(reference, { limit = 10 } = {}) {
  if (!isSolanaAddress(reference)) throw new Error('not a reference')
  const list = await solanaRpc('getSignaturesForAddress', [reference, { limit, commitment: 'confirmed' }])
  if (!Array.isArray(list)) throw new Error('getSignaturesForAddress: unexpected answer')
  return list.filter((s) => !s.err && isSolanaSignature(s.signature)).map((s) => ({ signature: s.signature, slot: s.slot, confirmationStatus: s.confirmationStatus ?? null, blockTime: s.blockTime ?? null }))
}
