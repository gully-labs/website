/* The product cards of the app's Products page: one per Gully product, each opening the product's own app.

   Every mark is the product's official kit file, byte-identical (public/brand/products, public/brand/holdermaps,
   public/brand/gullyai; see src/components/ProductLogo.tsx and src/brand/products.ts for the kit notes), drawn in a
   fixed box with object-fit: contain, so nothing is ever stretched or cropped, with a 2x file where the kit has one.
   `w` x `h` is the intrinsic size of `src` (or the SVG viewBox). Gully IPFS has no kit of its own: its card uses the
   Gully Labs mark with its name (components/ProductLogo.tsx MarkLogo).
   `hub` names the /api/hub surfaces whose live state the card's status dot shows (console/Launcher.tsx stateOf). */

export type HubProductKey = 'chain' | 'pay' | 'rpc' | 'holders' | 'security' | 'ai' | 'studio' | 'ipfs'

export interface HubProduct {
  key: HubProductKey
  name: string
  /** One line: what it does. */
  line: string
  /** The product's app (where "Open" goes). */
  url: string
  /** Its own docs, when it has them. */
  docs?: string
  mark: { src: string; src2x?: string; w: number; h: number } | null
  hub: string[]
}

export const HUB_PRODUCTS: HubProduct[] = [
  { key: 'chain', name: 'Gully Chain', line: 'The L3 for launches and trading: kre8.fun, Gully Core, Quests, bridge and explorer.', url: 'https://kre8.fun', docs: 'https://docs.gullychain.xyz/', mark: { src: '/brand/products/gc-badge-dark.png', w: 960, h: 256 }, hub: ['chain-site', 'rpc-public'] },
  { key: 'pay', name: 'Gully Pay', line: 'x402 payments, hosted checkout and merchant stores, settled on chain in USDC.', url: 'https://gullypay.xyz', docs: 'https://gullypay.xyz/docs', mark: { src: '/brand/products/gullypay-logo-ondark.svg', w: 895.23, h: 230.4 }, hub: ['pay', 'x402'] },
  { key: 'rpc', name: 'Gully RPC', line: 'One key for every network, Gully Chain included: keys, usage and the gateway.', url: 'https://app.gullyrpc.xyz', docs: 'https://gullyrpc.xyz/docs/', mark: { src: '/brand/products/gullyrpc-logo-transparent.png', w: 860, h: 247 }, hub: ['rpc-site', 'rpc-gateway'] },
  { key: 'holders', name: 'HolderMaps', line: 'Who really holds a token: bubble maps, clusters and deep checks.', url: 'https://holdermaps.xyz', mark: { src: '/brand/holdermaps/holdermaps-logo-on-dark-sm.png', src2x: '/brand/holdermaps/holdermaps-logo-on-dark.png', w: 744, h: 154 }, hub: ['holders'] },
  { key: 'security', name: 'Gully Security', line: 'AI security scans, contract monitors and published reports.', url: 'https://gullysecurity.xyz', mark: { src: '/brand/products/gullysecurity-logo-primary.svg', w: 627, h: 104 }, hub: ['security'] },
  { key: 'ai', name: 'Gully AI', line: 'Answers from our docs and live data, with every source linked. Also the assistant button here.', url: 'https://gullyai.xyz', docs: 'https://gullyai.xyz/docs/', mark: { src: '/brand/gullyai/logo-360w.png', src2x: '/brand/gullyai/logo-720w.png', w: 360, h: 120 }, hub: ['gullyai'] },
  { key: 'studio', name: 'Gully Studio', line: 'Unity 3D games on Gully Chain, with the Gully Game SDK.', url: 'https://gullystudio.xyz', mark: { src: '/brand/products/gullystudio-logo-transparent.png', w: 2070, h: 593 }, hub: ['studio'] },
  { key: 'ipfs', name: 'Gully IPFS', line: 'Token art, metadata and .gully sites, pinned for good on our own node.', url: 'https://docs.gullylabs.xyz/ipfs', mark: null, hub: ['ipfs'] },
]
