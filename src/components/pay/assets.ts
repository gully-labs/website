import type { PayAsset } from '../../pages/developers/api'

/** Assets grouped by chain, in the server's order. */
export function byChain(assets: PayAsset[]) {
  const groups: { chainId: number; chain: string; chainKey: string; assets: PayAsset[] }[] = []
  for (const a of assets) {
    let g = groups.find((x) => x.chainId === a.chainId)
    if (!g) groups.push((g = { chainId: a.chainId, chain: a.chain, chainKey: a.chainKey, assets: [] }))
    g.assets.push(a)
  }
  return groups
}
