/* Solana constants shared by the pay and swap UI. Tiny and dependency-free, so pages may import it
   statically; everything heavier in this folder is loaded only where it is used. */

/** The ledger's number for Solana (LI.FI's id), as server/solana-pay.mjs uses it. */
export const SOLANA_CHAIN_ID = 1151111081099710

export const SOLSCAN = 'https://solscan.io'

/** A transaction signature: 64 bytes in base58 (87 or 88 characters, occasionally fewer). */
export const isSolanaSignature = (v: string) => /^[1-9A-HJ-NP-Za-km-z]{64,90}$/.test(v.trim())

export const isSolanaChain = (chainId: number | null | undefined) => chainId === SOLANA_CHAIN_ID

/** Who prices a coin quote: Chainlink everywhere; SOL is priced by Chainlink's SOL / USD feed on Arbitrum. */
export const priceSource = (chainId: number | null | undefined) => (chainId === SOLANA_CHAIN_ID ? 'Chainlink (Arbitrum)' : 'Chainlink')
/** Where a quote's price feed lives: Arbiscan for Solana's SOL / USD feed, else the asset's own explorer. */
export const feedExplorer = (chainId: number | null | undefined, explorer: string) => (chainId === SOLANA_CHAIN_ID ? 'https://arbiscan.io' : explorer)
