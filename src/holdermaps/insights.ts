import { INFRA_KINDS, type HolderMapOk, type HolderNode } from '../lib/holders'

/* What the HolderMaps charts show, read from one map (GET /api/holders/:chain/:token). Only arithmetic on the server's
   own shares: nothing is estimated or filled in. Every result says what it covers (the listed holders, or the whole
   supply), and a figure that cannot be read is null, which the charts show as "not readable", never as zero. */

/** The chains the Holder Map covers (server/holders.mjs HOLDER_CHAINS), Gully Chain (485590) first. */
export const CHAIN_NAMES: Record<string, string> = {
  gully: 'Gully Chain Testnet',
  robinhood: 'Robinhood Chain',
  bsc: 'BNB Chain',
  base: 'Base',
  hyperevm: 'HyperEVM',
  solana: 'Solana',
}

/** The chain picker's order: Gully Chain first, then the rest (server/holders.mjs HOLDER_CHAINS). */
export const PICK_CHAINS = ['gully', 'robinhood', 'base', 'bsc', 'hyperevm', 'solana'] as const
export const chainLabel = (c: string) => (c === 'gully' ? 'Gully Chain · 485590' : (CHAIN_NAMES[c] ?? c))

const INFRA = new Set<string>(INFRA_KINDS)
export const isInfraNode = (n: HolderNode) => !!n.label && INFRA.has(n.label.kind)

export interface Segment {
  id: string
  label: string
  value: number
  color: string
  note: string
}

/** Kit colours for data (hm.css): yellow for people who move together, pale for the other big wallets. */
export const HM_C = {
  yellow: '#FFD52E',
  hi: '#FFE03A',
  lo: '#FDB813',
  white: '#FFFFFF',
  grey: '#6B6B6B',
  slate: '#3A3A3A',
  ink: '#0A0A0A',
  carbon: '#161616',
  muted: '#B3B3B3',
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)
const shares = (m: HolderMapOk) => m.nodes.filter((n) => typeof n.pct === 'number' && Number.isFinite(n.pct)) as (HolderNode & { pct: number })[]

/** Who holds the supply: pools/locks/burns/exchanges, wallets in a linked cluster, the other listed wallets, and (when
    shares are of the total supply) everyone the map does not list. */
export function supplySplit(m: HolderMapOk): { segments: Segment[]; ofSupply: boolean; listed: number } | null {
  const xs = shares(m)
  if (!xs.length) return null
  const ofSupply = m.holders.sharesOf === 'total supply'
  const infra = sum(xs.filter(isInfraNode).map((n) => n.pct))
  const clustered = sum(xs.filter((n) => !isInfraNode(n) && n.cluster).map((n) => n.pct))
  const other = sum(xs.filter((n) => !isInfraNode(n) && !n.cluster).map((n) => n.pct))
  const rest = ofSupply ? Math.max(0, 100 - infra - clustered - other) : 0
  const segments: Segment[] = [
    { id: 'infra', label: 'Pools, locks, burns, exchanges', value: infra, color: HM_C.grey, note: 'Contracts and venues, not people' },
    { id: 'cluster', label: 'Linked wallets', value: clustered, color: HM_C.yellow, note: 'Wallets that sent the token to each other' },
    { id: 'other', label: 'Other top wallets', value: other, color: HM_C.white, note: `The rest of the ${xs.length.toLocaleString('en-US')} wallets on the map` },
    ...(ofSupply ? [{ id: 'rest', label: 'Everyone else', value: rest, color: HM_C.slate, note: 'Holders smaller than the ones on the map' }] : []),
  ].filter((s) => s.value > 0)
  return { segments, ofSupply, listed: xs.length }
}

/** Share held by rank band: #1, #2-10, #11-50, #51 and on (as far as the map lists). */
export function rankBands(m: HolderMapOk): { label: string; value: number }[] | null {
  const xs = shares(m)
    .map((n) => n.pct)
    .sort((a, b) => b - a)
  if (!xs.length) return null
  const band = (a: number, b: number) => sum(xs.slice(a, b))
  const out = [
    { label: 'Largest holder', value: band(0, 1) },
    { label: 'Holders 2 to 10', value: band(1, 10) },
    { label: 'Holders 11 to 50', value: band(10, 50) },
    { label: `Holders 51 to ${xs.length.toLocaleString('en-US')}`, value: band(50, xs.length) },
  ]
  return out.filter((_, i) => i === 0 || xs.length > [0, 1, 10, 50][i])
}

/** The Lorenz curve of the listed holders (smallest first) and their Gini coefficient (0 = equal, 1 = one holds all).
    Needs at least 3 holders with a share. */
export function lorenz(m: HolderMapOk): { points: [number, number][]; gini: number; n: number } | null {
  const xs = shares(m)
    .map((n) => n.pct)
    .filter((p) => p > 0)
    .sort((a, b) => a - b)
  const n = xs.length
  const total = sum(xs)
  if (n < 3 || total <= 0) return null
  const points: [number, number][] = [[0, 0]]
  let acc = 0
  // At most ~120 points on the curve: enough for a smooth line at any size.
  const step = Math.max(1, Math.floor(n / 120))
  for (let i = 0; i < n; i++) {
    acc += xs[i]
    if ((i + 1) % step === 0 || i === n - 1) points.push([(i + 1) / n, acc / total])
  }
  let g = 0
  for (let i = 0; i < n; i++) g += (2 * (i + 1) - n - 1) * xs[i]
  const gini = g / (n * total)
  return { points, gini: Math.max(0, Math.min(1, gini)), n }
}

/** The clusters, biggest first, with their share and wallet count. */
export function clusterRows(m: HolderMapOk) {
  return [...m.clusters]
    .filter((c) => c.count > 1)
    .sort((a, b) => (b.pct ?? -1) - (a.pct ?? -1))
    .slice(0, 8)
    .map((c, i) => ({ id: c.id, label: `Cluster ${i + 1}`, wallets: c.count, value: c.pct, deployer: c.hasDeployer }))
}

/** Holder count and top-10 share over the map's timeline frames (replay), oldest first; null when fewer than 2 points. */
export function timelineSeries(m: HolderMapOk) {
  const frames = m.timeline?.frames ?? []
  const holders = frames.map((f) => (typeof f.holders === 'number' ? f.holders : null))
  const top10 = frames.map((f) => (typeof f.top10Pct === 'number' ? f.top10Pct : null))
  const labels = frames.map((f) => (f.at ? new Date(f.at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : `Block ${f.block.toLocaleString('en-US')}`))
  const enough = (xs: (number | null)[]) => xs.filter((x) => x !== null).length >= 2
  return {
    holders: enough(holders) ? holders : null,
    top10: enough(top10) ? top10 : null,
    labels,
    basis: m.timeline?.basis ?? null,
  }
}

export const fmtPct = (v: number) => `${v < 0.1 && v > 0 ? '<0.1' : v >= 10 ? v.toFixed(1) : v.toFixed(2)}%`
export const fmtInt = (v: number) => Math.round(v).toLocaleString('en-US')
