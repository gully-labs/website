// Gully Chain mainnet (chain 48559, parent Arbitrum One): OFF until it is configured, so nothing changes on testnet
// day. Gully Chain Testnet (485590) stays the default everywhere (server/gully-chain.mjs, holders.mjs, payments.mjs).
//
//   GULLY_RPC_48559              comma-separated mainnet RPC URLs. Unset = mainnet off: not in READ_CHAINS, not a
//                                Holder Map chain, never a payment chain. A URL that looks like a testnet RPC
//                                (testnet / sepolia) turns mainnet off too: a wrong-chain read is worse than none.
//   GULLY_MAINNET_EXPLORER       explorer origin (default https://explorer.gullychain.xyz)
//   GULLY_MAINNET_USDC           USDC on Gully Chain (0x...); with GULLY_MAINNET_ETH_USD_FEED it makes 48559 a payment
//   GULLY_MAINNET_ETH_USD_FEED   chain (USDC + ETH, priced by that AggregatorV3 feed). It is then still offered only
//                                where the treasury Safe is deployed (treasury-chains.mjs), like every other chain.
//
// No contract address of the mainnet is known yet, so none is written here: every address is null until the env
// names it. This module has no imports (payments.mjs and holders.mjs both read it).

export const GULLY_MAINNET_ID = 48559
export const GULLY_MAINNET_DEFAULT_EXPLORER = 'https://explorer.gullychain.xyz'

const isAddr = (a) => typeof a === 'string' && /^0x[0-9a-fA-F]{40}$/.test(a.trim())
const list = (v) => String(v ?? '').split(',').map((s) => s.trim()).filter(Boolean)
const looksTestnet = (u) => /testnet|sepolia/i.test(u)

/** The mainnet chain as the site sees it, or null while it is not configured. */
export function gullyMainnetConfig(env = process.env) {
  const rpcs = list(env[`GULLY_RPC_${GULLY_MAINNET_ID}`])
  if (!rpcs.length) return null
  if (rpcs.some(looksTestnet)) {
    console.warn(`[gully-mainnet] GULLY_RPC_${GULLY_MAINNET_ID} names a testnet RPC: Gully Chain mainnet stays off`)
    return null
  }
  const explorer = String(env.GULLY_MAINNET_EXPLORER ?? '').trim().replace(/\/+$/, '') || GULLY_MAINNET_DEFAULT_EXPLORER
  const usdc = isAddr(env.GULLY_MAINNET_USDC) ? env.GULLY_MAINNET_USDC.trim().toLowerCase() : null
  const ethUsdFeed = isAddr(env.GULLY_MAINNET_ETH_USD_FEED) ? env.GULLY_MAINNET_ETH_USD_FEED.trim().toLowerCase() : null
  return {
    id: GULLY_MAINNET_ID,
    key: 'gully-mainnet',
    name: 'Gully Chain',
    testnet: false,
    explorer,
    explorerName: 'Gully Chain Explorer',
    confirmations: 2,
    rpcs,
    usdc,
    ethUsdFeed,
    payments: !!(usdc && ethUsdFeed),
  }
}
