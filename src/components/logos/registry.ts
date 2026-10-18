/* Every chain, token and venue mark the site serves from its own origin (public/chains, public/tokens,
   public/venues), and how it sits in its square. Sources and terms: the SOURCES.json beside each file.

   disc   a backing colour where the mark needs contrast or has no ground of its own; null when the file
          is already a full disc or tile, or a shape that keeps its own outline (Base's square)
   inset  the share of the square left empty on each side, so marks of different shapes read the same size */

/** The fixed sizes logos come in. 10 to 14 are only for the corner badge and inline table marks. */
export type LogoSize = 10 | 12 | 14 | 16 | 20 | 24 | 32 | 40

export type Mark = { src: string; name: string; disc: string | null; inset: number }

const CHAINS: Record<string, Mark> = {
  base: { src: '/chains/base.svg', name: 'Base', disc: null, inset: 0.1 },
  ethereum: { src: '/chains/ethereum.svg', name: 'Ethereum', disc: '#ffffff', inset: 0.16 },
  bsc: { src: '/chains/bnb-chain.svg', name: 'BNB Chain', disc: null, inset: 0.04 },
  arbitrum: { src: '/chains/arbitrum.svg', name: 'Arbitrum', disc: null, inset: 0 },
  hyperevm: { src: '/chains/hyperevm.png', name: 'HyperEVM', disc: '#042420', inset: 0.16 },
  solana: { src: '/chains/solana.svg', name: 'Solana', disc: '#000000', inset: 0.22 },
  arc: { src: '/chains/arc.svg', name: 'Arc', disc: null, inset: 0 },
  robinhood: { src: '/chains/robinhood.png', name: 'Robinhood Chain', disc: null, inset: 0 },
}

/** Other keys and display names the site and the API use for the same chain. */
const CHAIN_ALIAS: Record<string, string> = {
  bnb: 'bsc',
  'bnb chain': 'bsc',
  'bnb smart chain': 'bsc',
  eth: 'ethereum',
  mainnet: 'ethereum',
  'arbitrum one': 'arbitrum',
  hyperliquid: 'hyperevm',
  'robinhood chain': 'robinhood',
  'arc testnet': 'arc',
}

export function chainMark(key: string | null | undefined): Mark | null {
  if (!key) return null
  const k = key.trim().toLowerCase()
  return CHAINS[k] ?? CHAINS[CHAIN_ALIAS[k] ?? ''] ?? null
}

const TOKENS: Record<string, Mark> = {
  ETH: { src: '/tokens/eth.svg', name: 'Ether', disc: '#ffffff', inset: 0.16 },
  BNB: { src: '/tokens/bnb.png', name: 'BNB', disc: null, inset: 0 },
  USDC: { src: '/tokens/usdc.svg', name: 'USD Coin', disc: null, inset: 0 },
  USDT: { src: '/tokens/usdt.svg', name: 'Tether USD', disc: null, inset: 0 },
  // SOL the coin uses Solana's own mark (public/chains/solana.svg, from solana.com's brand assets).
  SOL: { src: '/chains/solana.svg', name: 'Solana', disc: '#000000', inset: 0.22 },
}

export function tokenMark(symbol: string | null | undefined): Mark | null {
  return symbol ? (TOKENS[symbol.trim().toUpperCase()] ?? null) : null
}

const VENUES: Record<string, Mark> = {
  gully: { src: '/brand/gully-mark-96.png', name: 'Gully Labs', disc: '#101822', inset: 0 },
  'cartel-family': { src: '/venues/cartel-family.png', name: 'Cartel Family', disc: '#0f264f', inset: 0 },
  deepcore: { src: '/venues/deepcore.png', name: 'DeepCore', disc: '#04060c', inset: 0.1 },
  peddleswap: { src: '/venues/peddleswap.png', name: 'PeddleSwap', disc: '#10131a', inset: 0 },
  peddles: { src: '/venues/peddles.svg', name: 'Peddles', disc: '#0f1318', inset: 0 },
  peddlequest: { src: '/venues/peddlequest.png', name: 'PeddleQuest', disc: '#05080f', inset: 0 },
}

export function venueMark(key: string | null | undefined): Mark | null {
  return key ? (VENUES[key] ?? null) : null
}

/** Pixels left empty on each side: whole and equal, so the mark stays centred and crisp at 1x. */
export const insetPx = (size: number, inset: number) => Math.round(size * inset)
