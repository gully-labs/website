import { useEffect, useState } from 'react'
import type { Load } from './tracker'

/* The Holder Map's API (server/holders.mjs) as types, and the hook every surface reads it with
   (the site's map, the stock and launch pages, the Telegram Mini App and the embed). Nothing here
   computes a figure: every number is the server's. */

export type HolderLabelKind = 'deployer' | 'pool' | 'lock' | 'burn' | 'token' | 'router' | 'gully' | 'exchange' | 'known'
export type HolderFlag = 'deployer' | 'bundled' | 'funded-by-deployer'
export const INFRA_KINDS: HolderLabelKind[] = ['pool', 'lock', 'burn', 'token', 'router', 'gully', 'exchange']

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
  /** 'via': a hidden link through an address that is not on the map (one end is that address, see `hidden`). */
  kind: 'transfer' | 'funding' | 'via'
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
  funded: {
    wallets: number
    pct: number | null
    coinChecked: boolean
    coinNote: string | null
  }
  deployerPct: number | null
  buyers: number
  riskLine: string
  /** Wallets that bought in the first blocks after the launch (bots and fast buyers). */
  snipers?: { wallets: number; pct: number | null; blocks: number }
}

/** Launch Health's parts (server/holders-intel.mjs HEALTH_WEIGHTS: 30, 30, 25 and 15 points). */
export type HealthPartId = 'bundle' | 'deployer' | 'top10' | 'snipers'
export interface HolderHealth {
  /** 0–100, or null when too little is known to score. */
  score: number | null
  level: 'good' | 'mixed' | 'poor' | null
  verdict: string
  /** How many parts were known and counted. */
  counted: number
  parts: {
    id: HealthPartId
    label: string
    weight: number
    points: number | null
    value: string
    reason: string
    wallets: string[]
  }[]
}
/** A hidden link: two mapped wallets joined through an address that is not on the map. */
export interface HiddenLink {
  via: string
  short: string
  url: string
  connects: [string, string]
  transfers: number
}
export interface HolderFrame {
  block: number
  at: string | null
  /** Share per graph node, in the order of `nodes` (the first holders.graph of them). */
  pcts: number[]
  top10Pct: number | null
  holders: number | null
}
/** launch: a launchpad's token (venue says which: the Gully Launchpad or a registered launchpad). stock: a tracked stock token. token: any other token. */
export type HolderKind = 'launch' | 'stock' | 'token'
export interface HolderMapOk {
  state: 'ok'
  kind: HolderKind
  /** Launches: the launchpad's name. */
  venue?: string | null
  /** full: every holder's exact balance. top: the biggest holders only, and why (shown on the map). */
  coverage?: { level: 'full' | 'top'; reason: string | null; shown: number | null }
  chain: { key: string; id: number | string; name: string }
  token: {
    address: string
    symbol: string | null
    name: string | null
    decimals: number
    supply: number | null
    url: string
  }
  asOf: string
  cached?: boolean
  stale?: boolean
  sources: { holders?: string; links?: string; note?: string }
  holders: {
    count: number | null
    shown: number
    graph: number
    sharesOf: 'total supply' | 'listed holders'
    partial: string | null
  }
  tier: 'free' | 'pro'
  locked: string[]
  /** liveMinutes: how long the live view runs (null = unlimited). */
  features: {
    replay: boolean
    csv: boolean
    alerts: boolean
    holders: number
    gated: boolean
    liveMinutes?: number | null
  }
  nodes: HolderNode[]
  links: HolderLink[]
  clusters: HolderCluster[]
  legend: { kind: HolderLabelKind; text: string }[]
  summary: {
    top10Pct: number | null
    largestCluster: { pct: number | null; wallets: number } | null
    line: string
    plain: string[]
  }
  forensics: HolderForensics | null
  fair: {
    fair: number
    onchain: number | null
    gapPct: number | null
    status: string
    top10ValueAtFairUsd: number
    top10PremiumUsd: number | null
    buyersAvgGapPct: number | null
    buyers: number
  } | null
  timeline: { basis: string; frames: HolderFrame[] } | null
  /** Launches only (else null): an explainable 0–100 score. Never gated. */
  health?: HolderHealth | null
  hidden?: HiddenLink[]
  live?: { supported: boolean; cursor: number | null }
}
export interface HolderMapUnavailable {
  state: 'unavailable' | 'not-found' | 'error' | 'busy'
  kind?: HolderKind
  chain?: { key: string; id: number | string; name: string }
  token?: { address: string; symbol?: string | null }
  reason: string
  /** 0..1 while the token's history is being read; the page asks again soon. */
  progress?: number
  /** The chain's holder source is not set up yet: the page says "coming soon" and points to live maps. */
  comingSoon?: boolean
  asOf?: string
}
export type HolderMap = HolderMapOk | HolderMapUnavailable

/** Same-origin API path (the embed and the Mini App are served by the same site). */
export const holdersPath = (chain: string, token: string) => `/api/holders/${encodeURIComponent(chain)}/${encodeURIComponent(token)}`
export const holdersCardUrl = (chain: string, token: string) => `${holdersPath(chain, token)}/card.png`
export const holdersCsvUrl = (chain: string, token: string) => `${holdersPath(chain, token)}.csv`
/** The site's page for a map. */
/** The chains a Holder Map page exists for (server/holders.mjs HOLDER_CHAINS). */
export const HOLDER_CHAIN_KEYS = ['robinhood', 'bsc', 'base', 'hyperevm', 'solana', 'gully']

export const holdersPagePath = (chain: string, token: string) => `/holders/${encodeURIComponent(chain)}/${encodeURIComponent(token)}`

const REFRESH_MS = 300_000
/** The last map each token answered with in this tab: a second reader of the same map (HolderMaps' page and the map
    inside it) starts from it instead of a loading state, then re-reads as usual. */
const lastMap = new Map<string, HolderMap>()

/** One token's map, re-read every five minutes (the server caches as long); a failed re-read keeps the last good map. */
export function useHolderMap(chain: string | null, token: string | null): Load<HolderMap> {
  const key = chain && token ? `${chain}:${token}` : null
  const [state, setState] = useState<{
    key: string | null
    load: Load<HolderMap>
  }>(() => {
    const hit = key ? lastMap.get(key) : undefined
    return hit ? { key, load: { k: 'ok', data: hit } } : { key: null, load: { k: 'loading' } }
  })
  useEffect(() => {
    if (!key || !chain || !token) return
    let alive = true
    let retry: ReturnType<typeof setTimeout> | undefined
    const tick = () =>
      fetch(holdersPath(chain, token), {
        headers: { accept: 'application/json' },
      })
        .then((r) => r.json().then((b: HolderMap) => (b && typeof b === 'object' && 'state' in b ? b : Promise.reject(new Error(String(r.status))))))
        .then(
          (data) => {
            if (alive && data.state === 'unavailable' && typeof data.progress === 'number') {
              clearTimeout(retry)
              retry = setTimeout(tick, 8_000)
            }
            if (alive && data.state === 'ok') {
              lastMap.delete(key)
              lastMap.set(key, data)
              if (lastMap.size > 12) lastMap.delete(lastMap.keys().next().value as string)
            }
            if (alive) setState((s) => (data.state !== 'ok' && s.key === key && s.load.k === 'ok' && s.load.data.state === 'ok' ? s : { key, load: { k: 'ok', data } }))
          },
          () => alive && setState((s) => (s.key === key && s.load.k === 'ok' ? s : { key, load: { k: 'error' } })),
        )
    tick()
    const id = setInterval(tick, REFRESH_MS)
    return () => {
      alive = false
      clearTimeout(retry)
      clearInterval(id)
    }
  }, [key, chain, token])
  return state.key === key ? state.load : { k: 'loading' }
}

/* ---------- the other Holder Map endpoints ---------- */

/** GET /api/holders/resolve?q= */
export interface ResolveMatch {
  chain: string
  chainName: string
  token: string
  symbol: string | null
  name?: string | null
  kind: HolderKind
  path: string
  /** false: this chain's holder data is coming soon (the page says so). */
  available?: boolean
}
/** GET /api/holders/resolve?q= for an address: what was checked on each chain, in plain words. */
export interface ResolveChecked {
  chain: string
  chainName: string
  status: 'token' | 'not-token' | 'unreadable'
  reason: string | null
}
/** GET /api/holders/sources: which chains have maps today. */
export interface HolderSources {
  chains: { chain: string; name: string; stocks: boolean; launches: boolean; tokens: boolean; any: 'full' | 'top' | 'none' }[]
}
/** GET /api/holders/launches: the newest Gully Launchpad launches on Gully Chain, with their checks. */
export interface CheckedLaunch {
  chainKey: string
  chainName: string
  token: string
  symbol: string | null
  createdAt: string
  state: 'checked' | 'checking' | 'unavailable'
  health: {
    score: number | null
    level: 'good' | 'mixed' | 'poor' | null
    verdict: string
  } | null
  riskLine: string | null
  path: string
}
export interface CheckedLaunches {
  /** unreadable: the Gully Chain indexer could not be read just now (launches is empty). */
  state?: 'ok' | 'unreadable'
  asOf: string | null
  launches: CheckedLaunch[]
}
/** GET /api/holders/top?limit= */
export interface TopScanned {
  day: string
  items: {
    chain: string
    token: string
    symbol: string | null
    kind: HolderKind
    scans: number
    path: string
  }[]
}
/** GET /api/holders/:chain/:token/live?since= */
export interface LiveUpdate {
  state: 'ok' | 'unsupported' | 'error'
  cursor: number | null
  transfers: {
    from: string
    to: string
    pct: number | null
    block: number
    at: string | null
  }[]
  pcts: Record<string, number>
  asOf: string
}
/** A one-shot JSON GET: resolves to the body, or null when it failed. */
export async function getJson<T>(path: string): Promise<T | null> {
  try {
    const r = await fetch(path, { headers: { accept: 'application/json' } })
    if (!r.ok) return null
    return (await r.json()) as T
  } catch {
    return null
  }
}
