// Chains a contract-address scan accepts. Etherscan V2 (one key, `chainid=` parameter) covers every one;
// Blockscout and Sourcify are the keyless fallbacks where they exist. Bytecode is read over the same
// public RPCs Gully Pay uses (server/payments.mjs, GULLY_RPC_<chainId> overrides) when that chain is there,
// else through Etherscan's eth_getCode proxy.

export const CHAINS = {
  1: { key: 'ethereum', name: 'Ethereum', explorer: 'https://etherscan.io', blockscout: 'https://eth.blockscout.com' },
  8453: { key: 'base', name: 'Base', explorer: 'https://basescan.org', blockscout: 'https://base.blockscout.com' },
  42161: { key: 'arbitrum', name: 'Arbitrum One', explorer: 'https://arbiscan.io', blockscout: 'https://arbitrum.blockscout.com' },
  10: { key: 'optimism', name: 'OP Mainnet', explorer: 'https://optimistic.etherscan.io', blockscout: 'https://optimism.blockscout.com' },
  56: { key: 'bnb', name: 'BNB Chain', explorer: 'https://bscscan.com', blockscout: null },
  137: { key: 'polygon', name: 'Polygon', explorer: 'https://polygonscan.com', blockscout: 'https://polygon.blockscout.com' },
  43114: { key: 'avalanche', name: 'Avalanche C-Chain', explorer: 'https://snowscan.xyz', blockscout: null },
  11155111: { key: 'sepolia', name: 'Sepolia', explorer: 'https://sepolia.etherscan.io', blockscout: 'https://eth-sepolia.blockscout.com' },
  84532: { key: 'base-sepolia', name: 'Base Sepolia', explorer: 'https://sepolia.basescan.org', blockscout: 'https://base-sepolia.blockscout.com' },
}

const BY_KEY = Object.fromEntries(Object.entries(CHAINS).map(([id, c]) => [c.key, Number(id)]))

/** A chain id from a number, numeric string or key ('base'); null when not supported. */
export function resolveChain(v) {
  if (typeof v === 'number' && CHAINS[v]) return v
  const s = String(v ?? '').trim().toLowerCase()
  if (/^\d+$/.test(s) && CHAINS[Number(s)]) return Number(s)
  return BY_KEY[s] ?? null
}
