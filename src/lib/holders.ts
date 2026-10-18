import { useEffect, useState } from 'react'
import type { Load } from './tracker'

/* The Holder Map's API (server/holders.mjs) as types, and the hook every surface reads it with
   (the site's map, the stock and launch pages, the Telegram Mini App and the embed). Nothing here
   computes a figure: every number is the server's. */

export type HolderLabelKind = 'deployer' | 'pool' | 'lock' | 'burn' | 'token' | 'deepcore' | 'router' | 'gully' | 'exchange' | 'known'
export type HolderFlag = 'deployer' | 'bundled' | 'funded-by-deployer'
export const INFRA_KINDS: HolderLabelKind[] = ['pool', 'lock', 'burn', 'token', 'deepcore', 'router', 'gully', 'exchange']

export interface HolderNode {
  id: string
  short: string
  rank: number
  /** Whole tokens (display only). */
  balance: number
  /** Share of total supply (or of the listed holders when the supply is unknown: holders.sharesOf). */
  pct: number | null
  label: { kind: HolderLabelKind; name: string } | null
  contract: boolean | null
  cluster: string | null
  flags: HolderFlag[]
  url: string
  /** Stock tokens only. */
  valueAtFairUsd?: number
  premiumUsd?: number | null
  boughtGapPct?: number | null
}
export interface HolderLink {
  source: string
  target: string
  transfers: number
  pct: number | null
  kind: 'transfer' | 'funding'
  /** Which way tokens moved, when the server says: source -> target, target -> source, or both. Funding links run source -> target. */
  direction?: 'forward' | 'backward' | 'both'
}
export interface HolderCluster {
  id: string
  wallets: string[]
  count: number
  pct: number | null
  hasDeployer: boolean
}
export interface HolderForensics {
  deployer: string | null
  launchBlock: number | null
  firstTradeBlock: number | null
  bundled: { wallets: number; pct: number | null; firstBlockBuyers: number }
  funded: { wallets: number; pct: number | null; coinChecked: boolean; coinNote: string | null }
  deployerPct: number | null
  liquidity: { locked: boolean | null; locker: string | null; since: string | null }
  buyers: number
  riskLine: string
}
export interface HolderFrame {
  block: number
  at: string | null
  /** Share per graph node, in the order of `nodes` (the first holders.graph of them). */
  pcts: number[]
  top10Pct: number | null
  holders: number | null
}
export interface HolderMapOk {
  state: 'ok'
  kind: 'deepcore-launch' | 'stock'
  chain: { key: string; id: number | string; name: string }
  token: { address: string; symbol: string | null; name: string | null; decimals: number; supply: number | null; url: string }
  asOf: string
  cached?: boolean
  stale?: boolean
  sources: { holders?: string; links?: string; note?: string }
  holders: { count: number | null; shown: number; graph: number; sharesOf: 'total supply' | 'listed holders'; partial: string | null }
  tier: 'free' | 'pro'
  locked: string[]
  features: { replay: boolean; csv: boolean; alerts: boolean; holders: number; gated: boolean }
  nodes: HolderNode[]
  links: HolderLink[]
  clusters: HolderCluster[]
  legend: { kind: HolderLabelKind; text: string }[]
  summary: { top10Pct: number | null; largestCluster: { pct: number | null; wallets: number } | null; line: string; plain: string[] }
  forensics: HolderForensics | null
  fair: { fair: number; onchain: number | null; gapPct: number | null; status: string; top10ValueAtFairUsd: number; top10PremiumUsd: number | null; buyersAvgGapPct: number | null; buyers: number } | null
  timeline: { basis: string; frames: HolderFrame[] } | null
}
export interface HolderMapUnavailable {
  state: 'unavailable' | 'not-found' | 'error' | 'busy'
  kind?: 'deepcore-launch' | 'stock'
  chain?: { key: string; id: number | string; name: string }
  token?: { address: string; symbol?: string | null }
  reason: string
  needs?: string | null
  asOf?: string
}
export type HolderMap = HolderMapOk | HolderMapUnavailable

/** Same-origin API path (the embed and the Mini App are served by the same site). */
export const holdersPath = (chain: string, token: string) => `/api/holders/${encodeURIComponent(chain)}/${encodeURIComponent(token)}`
export const holdersCardUrl = (chain: string, token: string) => `${holdersPath(chain, token)}/card.png`
export const holdersCsvUrl = (chain: string, token: string) => `${holdersPath(chain, token)}.csv`
/** The site's page for a map. */
export const holdersPagePath = (chain: string, token: string) => `/holders/${encodeURIComponent(chain)}/${encodeURIComponent(token)}`

const REFRESH_MS = 300_000

/** One token's map, re-read every five minutes (the server caches as long); a failed re-read keeps the last good map. */
export function useHolderMap(chain: string | null, token: string | null): Load<HolderMap> {
  const key = chain && token ? `${chain}:${token}` : null
  const [state, setState] = useState<{ key: string | null; load: Load<HolderMap> }>({ key: null, load: { k: 'loading' } })
  useEffect(() => {
    if (!key || !chain || !token) return
    let alive = true
    const tick = () =>
      fetch(holdersPath(chain, token), { headers: { accept: 'application/json' } })
        .then((r) => r.json().then((b: HolderMap) => (b && typeof b === 'object' && 'state' in b ? b : Promise.reject(new Error(String(r.status))))))
        .then(
          (data) => alive && setState((s) => (data.state !== 'ok' && s.key === key && s.load.k === 'ok' && s.load.data.state === 'ok' ? s : { key, load: { k: 'ok', data } })),
          () => alive && setState((s) => (s.key === key && s.load.k === 'ok' ? s : { key, load: { k: 'error' } })),
        )
    tick()
    const id = setInterval(tick, REFRESH_MS)
    return () => {
      alive = false
      clearInterval(id)
    }
  }, [key, chain, token])
  return state.key === key ? state.load : { k: 'loading' }
}
