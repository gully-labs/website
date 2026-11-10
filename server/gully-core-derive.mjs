// Everything gullylabs.xyz says about Gully Core (which chains, what is live where, the fee, the Multisig chains) is
// derived here from the published Gully Core manifest (https://gullycore.xyz/manifest.json, built by gully-ops from
// the deployment records). Pure: no fs, no network. The server reads server/data/gully-core-manifest.json (a copy
// refreshed at runtime, server/gully-core.mjs); the client bundle reads the small generated file
// src/content/gullyCore.generated.ts; both come from this one function, and scripts/test-core-sync.mjs fails when
// the committed copy, the generated file or any typed sentence disagrees with the live manifest.

export const MANIFEST_URL = 'https://gullycore.xyz/manifest.json'

/** The chain marks this site serves itself (byte copies of each chain's own mark; see public/chains/SOURCES.json).
    A chain without one shows the mark the manifest publishes (gullycore.xyz/chains/<key>.*). */
const LOGO = {
  'gully-chain-testnet': '/chains/gully-chain.svg',
  anubis: '/chains/anubis.png',
  robinhood: '/chains/robinhood.png',
  base: '/chains/base.svg',
  bnb: '/chains/bnb-chain.svg',
  hyperevm: '/chains/hyperevm.png',
  elysium: '/chains/elysium.png',
}
/** Plain words for the features the chain picker lists, in display order (manifest feature ids). */
const SHOW = [
  ['launch', 'Launch tokens'],
  ['launchpad', 'Launchpads'],
  ['dex', 'DEXes'],
  ['stocks', 'Stock markets'],
  ['vaults', 'Vaults'],
  ['locks', 'Locks and vesting'],
  ['terminal', 'Orders and DCA'],
]
const STATE = { live: 'Live', testnet: 'Testnet live', coming: 'Coming', partial: 'Partly live', planned: 'Planned', 'not-deployed': 'Coming' }
const RANK = { live: 0, partial: 1, testnet: 2, coming: 3, 'not-deployed': 3, planned: 4 }

/** "A, B and C" */
export const list = (xs) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`)
const stripTestnet = (name) => name.replace(/\s+Testnet$/i, '')

/** The best status a feature has on any mainnet (live beats partial beats coming), else on a testnet. */
function featureStatus(f, chains) {
  const of = (kind) => chains.filter((c) => c.kind === kind && ['live', 'testnet', 'partial'].includes(c.status)).map((c) => f.status?.[String(c.chainId)]).filter(Boolean)
  const main = of('mainnet')
  if (main.includes('live')) return 'live'
  if (main.includes('partial')) return 'partial'
  const test = of('testnet')
  if (test.includes('live') || test.includes('testnet')) return 'testnet'
  if (main.includes('testnet')) return 'testnet'
  if (main.includes('coming') || test.includes('coming')) return 'coming'
  return 'planned'
}

/**
 * The site's reading of the manifest. Throws on a manifest that is not one (so a bad fetch never replaces a good copy).
 * Chains come in display order: live mainnets as the manifest lists them, then testnets, then the rest.
 */
export function derive(m) {
  if (!m || !Array.isArray(m.chains) || !m.chains.length || !Array.isArray(m.features) || !m.links) throw new Error('not a Gully Core manifest')
  const links = m.links
  const by = (a, b) => (RANK[a.status] ?? 9) - (RANK[b.status] ?? 9)
  const chains = [...m.chains].sort((a, b) => by(a, b) || (a.kind === b.kind ? 0 : a.kind === 'mainnet' ? -1 : 1)).map((c) => {
    const id = String(c.chainId)
    const st = (f) => f.status?.[id]
    const feats = SHOW.map(([fid, label]) => [m.features.find((f) => f.id === fid), label]).filter(([f]) => f)
    const live = feats.filter(([f]) => ['live', 'testnet'].includes(st(f))).map(([, l]) => l)
    const planned = feats.filter(([f]) => ['coming', 'planned', 'not-deployed'].includes(st(f))).map(([, l]) => l).slice(0, 4)
    const multisig = !!c.surfaces?.multisig
    if (multisig) live.push('Gully Multisig')
    const open = c.status === 'live' || c.status === 'testnet' || c.status === 'partial'
    const app = c.app || (c.kind === 'testnet' ? links.testnetApp : links.app)
    const name = c.kind === 'testnet' ? stripTestnet(c.name) : c.name
    const note = c.note || (c.status === 'live' ? `Gully Core release ${c.deployment?.release ?? 3} is live for builders and traders.` : c.status === 'testnet' ? 'Our own chain. Test funds only; mainnet comes later.' : 'Gully Core for builders, coming.')
    return {
      chainId: c.chainId,
      key: c.key,
      name,
      kind: c.kind,
      status: c.status,
      state: STATE[c.status] ?? c.status,
      open,
      logo: LOGO[c.key] ?? c.icon ?? null,
      icon: c.icon ?? null,
      note,
      live,
      planned,
      cta: c.status === 'live' ? { label: 'Open the app', href: app } : c.status === 'testnet' ? { label: 'Try it on testnet', href: app } : null,
      multisig,
      app,
      explorer: c.explorer ?? null,
      rpc: c.rpc ?? null,
      native: c.native ?? null,
    }
  })
  const liveMainnets = chains.filter((c) => c.kind === 'mainnet' && c.status === 'live').map((c) => c.name)
  const testnets = chains.filter((c) => c.kind === 'testnet' && c.status === 'testnet').map((c) => c.name)
  const coming = chains.filter((c) => !c.open).map((c) => c.name)
  const whereLive = `On ${list(liveMainnets)} mainnet${liveMainnets.length === 1 ? '' : 's'}${testnets.length ? ` and on ${list(testnets)} testnet` : ''}.`
  const multisigChains = chains.filter((c) => c.multisig).map((c) => (c.kind === 'testnet' ? `${c.name} testnet` : c.name))
  const features = m.features.map((f) => ({ id: f.id, name: f.name, group: f.group, status: featureStatus(f, m.chains) }))
  const fees = m.fees ?? {}
  return {
    source: MANIFEST_URL,
    chains,
    liveMainnets,
    testnets,
    coming,
    whereLive,
    multisigChains,
    multisigUrl: links.multisig,
    links: { site: links.site, docs: links.docs, app: links.app, testnetApp: links.testnetApp, multisig: links.multisig, explorer: links.explorer, testnetExplorer: links.testnetExplorer, manifest: links.manifest ?? MANIFEST_URL },
    builderFeePct: fees.outsideBuilders?.builderFeePct ?? null,
    builderFeeCapPct: fees.outsideBuilders?.capPct ?? null,
    features,
  }
}

/** The part of a reading that the client bundle carries (src/content/gullyCore.generated.ts): small and typed. */
export function clientView(d) {
  return {
    source: d.source,
    chains: d.chains.map(({ chainId, key, name, kind, status, state, multisig, app, explorer, logo }) => ({ chainId, key, name, kind, status, state, multisig, app, explorer, logo })),
    liveMainnets: d.liveMainnets,
    testnets: d.testnets,
    coming: d.coming,
    whereLive: d.whereLive,
    multisigChains: d.multisigChains,
    multisigUrl: d.multisigUrl,
    links: d.links,
    builderFeePct: d.builderFeePct,
    builderFeeCapPct: d.builderFeeCapPct,
    features: d.features,
  }
}

export function generatedTs(d) {
  const v = clientView(d)
  return `// GENERATED by scripts/sync-gully-core.mjs from ${d.source}. Do not edit: run \`node scripts/sync-gully-core.mjs\`.
// What this site says about Gully Core (chains, where it is live, the fee, the Multisig chains); the server reads the
// full copy in server/data/gully-core-manifest.json through server/gully-core.mjs. scripts/test-core-sync.mjs fails when
// this file lags the live manifest.
export type GullyCoreChainStatus = 'live' | 'testnet' | 'coming' | 'partial' | 'planned' | 'not-deployed'
export interface GullyCoreChain {
  chainId: number
  key: string
  name: string
  kind: 'mainnet' | 'testnet'
  status: GullyCoreChainStatus
  state: string
  multisig: boolean
  app: string
  explorer: string | null
  logo: string | null
}
export interface GullyCoreFeature {
  id: string
  name: string
  group: string
  status: 'live' | 'partial' | 'testnet' | 'coming' | 'planned'
}
export interface GullyCoreView {
  source: string
  chains: GullyCoreChain[]
  liveMainnets: string[]
  testnets: string[]
  coming: string[]
  whereLive: string
  multisigChains: string[]
  multisigUrl: string
  links: { site: string; docs: string; app: string; testnetApp: string; multisig: string; explorer: string; testnetExplorer: string; manifest: string }
  builderFeePct: number | null
  builderFeeCapPct: number | null
  features: GullyCoreFeature[]
}
export const GULLY_CORE: GullyCoreView = ${JSON.stringify(v, null, 2)}
`
}
