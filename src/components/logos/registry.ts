/* Every chain, token and venue mark the site serves from its own origin (public/chains, public/tokens,
   public/venues), and how it sits in its square. Sources and terms: the SOURCES.json beside each file.

   disc   a backing colour where the mark needs contrast or has no ground of its own; null when the file
          is already a full disc or tile, or a shape that keeps its own outline (Base's square)
   inset  the share of the square left empty on each side, so marks of different shapes read the same size */

/** The fixed sizes logos come in. 10 to 14 are only for the corner badge and inline table marks. */
export type LogoSize = 10 | 12 | 14 | 16 | 20 | 24 | 32 | 40 | 48 | 64

export type Mark = { src: string; name: string; disc: string | null; inset: number }

const CHAINS: Record<string, Mark> = {
  base: { src: '/chains/base.svg', name: 'Base', disc: null, inset: 0.04 },
  ethereum: { src: '/chains/ethereum.svg', name: 'Ethereum', disc: '#ffffff', inset: 0.16 },
  bsc: { src: '/chains/bnb-chain.svg', name: 'BNB Chain', disc: null, inset: 0.04 },
  arbitrum: { src: '/chains/arbitrum.svg', name: 'Arbitrum', disc: null, inset: 0 },
  hyperevm: { src: '/chains/hyperevm.png', name: 'HyperEVM', disc: '#042420', inset: 0.16 },
  solana: { src: '/chains/solana.svg', name: 'Solana', disc: '#000000', inset: 0.22 },
  arc: { src: '/chains/arc.svg', name: 'Arc', disc: null, inset: 0 },
  robinhood: { src: '/chains/robinhood.png', name: 'Robinhood Chain', disc: null, inset: 0 },
  // Gully Pay chains added 2026-10-18: each file is the chain's own published mark (SOURCES.json), already a tile or disc.
  optimism: { src: '/chains/optimism.svg', name: 'OP Mainnet', disc: null, inset: 0 },
  polygon: { src: '/chains/polygon.svg', name: 'Polygon', disc: null, inset: 0 },
  avalanche: { src: '/chains/avalanche.svg', name: 'Avalanche', disc: null, inset: 0 },
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
  op: 'optimism',
  'op mainnet': 'optimism',
  'optimism mainnet': 'optimism',
  matic: 'polygon',
  'polygon pos': 'polygon',
  avax: 'avalanche',
  'avalanche c-chain': 'avalanche',
  'base-sepolia': 'base',
  'base sepolia': 'base',
  'op-sepolia': 'optimism',
  'op sepolia': 'optimism',
  'arbitrum-sepolia': 'arbitrum',
  'arbitrum sepolia': 'arbitrum',
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
  // POL and AVAX, the chains' own coins, use their chains' marks the same way.
  POL: { src: '/chains/polygon.svg', name: 'Polygon Ecosystem Token', disc: null, inset: 0 },
  AVAX: { src: '/chains/avalanche.svg', name: 'Avalanche', disc: null, inset: 0 },
}

export function tokenMark(symbol: string | null | undefined): Mark | null {
  return symbol ? (TOKENS[symbol.trim().toUpperCase()] ?? null) : null
}

const VENUES: Record<string, Mark> = {
  gully: { src: '/brand/gully-mark-96.png', name: 'Gully Labs', disc: null, inset: 0 }, // the brand kit's icon master, cut down (scripts/brand-from-kit.mjs)
  deepcore: { src: '/venues/deepcore.png', name: 'DeepCore', disc: '#04060c', inset: 0.1 },
  peddleswap: { src: '/venues/peddleswap.png', name: 'PeddleSwap', disc: '#10131a', inset: 0 },
  peddles: { src: '/venues/peddles.svg', name: 'Peddles', disc: '#0f1318', inset: 0 },
  peddlequest: { src: '/venues/peddlequest.png', name: 'PeddleQuest', disc: '#05080f', inset: 0 },
}

export function venueMark(key: string | null | undefined): Mark | null {
  return key ? (VENUES[key] ?? null) : null
}

/* Third-party services the site integrates with (public/integrations; sources and terms in its SOURCES.json).
   Each file is the company's own mark: its GitHub organisation avatar, site icon or Simple Icons glyph.
   Full tiles (disc null) keep their own ground; line-art glyphs sit on a disc. */
const INTEGRATIONS: Record<string, Mark> = {
  chainlink: { src: '/integrations/chainlink.svg', name: 'Chainlink', disc: '#ffffff', inset: 0.2 },
  defillama: { src: '/integrations/defillama.jpg', name: 'DefiLlama', disc: null, inset: 0 },
  dexscreener: { src: '/integrations/dexscreener.png', name: 'DexScreener', disc: null, inset: 0 },
  geckoterminal: { src: '/integrations/geckoterminal.png', name: 'GeckoTerminal', disc: null, inset: 0 },
  coingecko: { src: '/integrations/coingecko.png', name: 'CoinGecko', disc: null, inset: 0 },
  blockscout: { src: '/integrations/blockscout.jpg', name: 'Blockscout', disc: null, inset: 0 },
  moralis: { src: '/integrations/moralis.png', name: 'Moralis', disc: null, inset: 0 },
  lifi: { src: '/integrations/lifi.png', name: 'LI.FI', disc: null, inset: 0 },
  jupiter: { src: '/integrations/jupiter.jpg', name: 'Jupiter', disc: null, inset: 0 },
  'request-network': { src: '/integrations/request-network.png', name: 'Request Network', disc: null, inset: 0 },
  safe: { src: '/integrations/safe.jpg', name: 'Safe', disc: null, inset: 0 },
  sourcify: { src: '/integrations/sourcify.jpg', name: 'Sourcify', disc: null, inset: 0 },
  etherscan: { src: '/integrations/etherscan.png', name: 'Etherscan', disc: '#21325b', inset: 0.04 },
  slither: { src: '/integrations/slither.png', name: 'Slither', disc: '#ffffff', inset: 0 },
  aderyn: { src: '/integrations/aderyn.jpg', name: 'Aderyn', disc: null, inset: 0 },
  semgrep: { src: '/integrations/semgrep.png', name: 'Semgrep', disc: null, inset: 0 },
  drpc: { src: '/integrations/drpc.png', name: 'dRPC', disc: null, inset: 0 },
  rainbowkit: { src: '/integrations/rainbowkit.svg', name: 'RainbowKit', disc: null, inset: 0 },
  walletconnect: { src: '/integrations/walletconnect.svg', name: 'WalletConnect', disc: '#ffffff', inset: 0.2 },
  // Hyperlane's GitHub avatar is black on a transparent ground; Offchain Labs (Arbitrum Orbit and Nitro) is a full tile.
  hyperlane: { src: '/integrations/hyperlane.png', name: 'Hyperlane', disc: '#ffffff', inset: 0.12 },
  'offchain-labs': { src: '/integrations/offchain-labs.jpg', name: 'Arbitrum Orbit (Offchain Labs)', disc: null, inset: 0 },
  umami: { src: '/integrations/umami.svg', name: 'Umami', disc: '#ffffff', inset: 0.2 },
}

export function integrationMark(id: string | null | undefined): Mark | null {
  return id ? (INTEGRATIONS[id] ?? null) : null
}

/** Pixels left empty on each side: whole and equal, so the mark stays centred and crisp at 1x. */
export const insetPx = (size: number, inset: number) => Math.round(size * inset)
