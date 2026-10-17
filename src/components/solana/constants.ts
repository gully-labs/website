/* Solana constants shared by the pay and swap UI. Tiny and dependency-free, so pages may import it
   statically; everything heavier in this folder is loaded only where it is used. */

/** The ledger's number for Solana (LI.FI's id), as server/solana-pay.mjs uses it. */
export const SOLANA_CHAIN_ID = 1151111081099710

export const SOLSCAN = 'https://solscan.io'

/** A transaction signature: 64 bytes in base58 (87 or 88 characters, occasionally fewer). */
export const isSolanaSignature = (v: string) => /^[1-9A-HJ-NP-Za-km-z]{64,90}$/.test(v.trim())

export const isSolanaChain = (chainId: number | null | undefined) => chainId === SOLANA_CHAIN_ID

/** Who prices a coin quote on this chain: Pyth's SOL / USD account on Solana, Chainlink on the EVM chains. */
export const priceSource = (chainId: number | null | undefined) => (chainId === SOLANA_CHAIN_ID ? 'Pyth' : 'Chainlink')
