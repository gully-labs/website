import { INFRA_KINDS, type HolderLabelKind, type HolderMapOk, type HolderNode } from '../../lib/holders'
import type { MapPreview } from './MiniMap'
import { norm } from './format'
import { K } from './theme'

/* Shared pieces of the Holder Map's motion: the flow shape (a transfer the map animates), how a flow reads
   in the ticker, which colour a side takes, and the canvas glyphs for pools, locks, burn and the deployer.
   Every flow is a real transfer the server read (recentFlows on the map, transfers on /live); nothing here
   makes one up. */

export type FlowSide = 'buy' | 'sell' | 'transfer' | 'mint' | 'burn'
/** One transfer as the server states it (server/holders.mjs recentFlowsOf, holders-intel.mjs readLive). */
export interface RecentFlow {
  from: string
  to: string
  side?: FlowSide
  pct: number | null
  units?: number | null
  block: number
  at: string | null
  tx?: string | null
}
/** The map as this branch's server sends it: the shared type plus the latest transfers. */
export type MotionMap = HolderMapOk & { recentFlows?: RecentFlow[] }

/** A flow on its way to the canvas and the ticker. */
export interface FlowEvent {
  key: string
  from: string
  to: string
  side: FlowSide
  units: number | null
  pct: number | null
  at: string | null
  /** 'live' from the 15 s poll, 'replay' from the map's own latest transfers. */
  origin: 'live' | 'replay'
}

const POOLISH = new Set<HolderLabelKind>(['pool', 'router'])
const INFRA = new Set<HolderLabelKind>(['pool', 'lock', 'burn', 'token', 'router', 'gully', 'exchange'])

/** The side of a transfer, from the server when it says, else from the map's own labels (older servers). */
export function sideOf(f: { from: string; to: string; side?: FlowSide }, byId: Map<string, HolderNode>): FlowSide {
  if (f.side) return f.side
  const k = (a: string) => byId.get(norm(a))?.label?.kind ?? null
  const from = norm(f.from)
  if (/^0x0{40}$/.test(from)) return 'mint'
  if (k(f.to) === 'burn') return 'burn'
  const venue = (a: string) => POOLISH.has(k(a) as HolderLabelKind)
  const infra = (a: string) => INFRA.has(k(a) as HolderLabelKind)
  if (venue(f.from) && !infra(f.to)) return 'buy'
  if (venue(f.to) && !infra(f.from)) return 'sell'
  return 'transfer'
}

export const toFlow = (f: RecentFlow, byId: Map<string, HolderNode>, origin: FlowEvent['origin'], key: string): FlowEvent => ({
  key,
  from: norm(f.from),
  to: norm(f.to),
  side: sideOf(f, byId),
  units: typeof f.units === 'number' && Number.isFinite(f.units) ? f.units : null,
  pct: f.pct,
  at: f.at,
  origin,
})

/** Gold for buys, red for sells, pale gold for everything else (kit tokens). */
export const sideColour = (s: FlowSide) => (s === 'buy' ? K.gold : s === 'sell' ? K.warn : s === 'burn' ? K.muted : K.pale)

export const shortAddr = (a: string) => (a.startsWith('0x') ? `${a.slice(0, 4)}…${a.slice(-2)}` : `${a.slice(0, 4)}…${a.slice(-2)}`)
export const fmtAmount = (n: number) => (n >= 1e9 ? `${(n / 1e9).toFixed(1)}B` : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : n >= 1 ? n.toFixed(n >= 100 ? 0 : 1) : n >= 0.0001 ? n.toPrecision(2) : n > 0 ? '<0.0001' : '0')

/** "0x12…ab bought 1.2k DTC": the ticker line for a flow (the age is added beside it). */
export function flowText(f: FlowEvent, symbol: string | null, byId: Map<string, HolderNode>) {
  const who = (a: string) => byId.get(a)?.label?.name ?? shortAddr(a)
  const sym = symbol ?? 'tokens'
  const amt = f.units !== null ? `${fmtAmount(f.units)} ${sym}` : f.pct !== null ? `${f.pct < 0.01 ? '<0.01' : f.pct.toFixed(2)}% of ${sym}` : sym
  switch (f.side) {
    case 'buy':
      return `${who(f.to)} bought ${amt}`
    case 'sell':
      return `${who(f.from)} sold ${amt}`
    case 'mint':
      return `${amt} minted to ${who(f.to)}`
    case 'burn':
      return `${who(f.from)} burned ${amt}`
    default:
      return `${who(f.from)} sent ${amt} to ${who(f.to)}`
  }
}

/** "3s ago", "4m ago", "2d ago"; "just now" for a live transfer without a time. */
export function agoText(at: string | null, now: number) {
  if (!at) return 'just now'
  const s = Math.max(0, Math.round((now - Date.parse(at)) / 1000))
  if (!Number.isFinite(s)) return 'just now'
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.round(s / 60)}m ago`
  if (s < 86_400) return `${Math.round(s / 3600)}h ago`
  return `${Math.round(s / 86_400)}d ago`
}

/* Canvas glyphs: Lucide icon paths (ISC licence, lucide-react v1.49), drawn on a 24-unit grid. */
export type Glyph = 'pool' | 'lock' | 'burn' | 'deployer' | 'token' | 'exchange' | 'contract'
const GLYPHS: Record<Glyph, string[]> = {
  // waves-horizontal
  pool: ['M2 12q2.5 2 5 0t5 0 5 0 5 0', 'M2 19q2.5 2 5 0t5 0 5 0 5 0', 'M2 5q2.5 2 5 0t5 0 5 0 5 0'],
  // lock
  lock: ['M5 11h14a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2z', 'M7 11V7a5 5 0 0 1 10 0v4'],
  // flame
  burn: ['M12 3q1 4 4 6.5t3 5.5a1 1 0 0 1-14 0 5 5 0 0 1 1-3 1 1 0 0 0 5 0c0-2-1.5-3-1.5-5q0-2 2.5-4'],
  // rocket
  deployer: ['M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5', 'M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09', 'M9 12a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.4 22.4 0 0 1-4 2z', 'M9 12H4s.55-3.03 2-4c1.62-1.08 5 .05 5 .05'],
  // coins
  token: ['M13.744 17.736a6 6 0 1 1-7.48-7.48', 'M15 6h1v4', 'm6.134 14.768.866-.5 2 3.464', 'M22 8a6 6 0 1 1-12 0 6 6 0 0 1 12 0'],
  // landmark
  exchange: ['M10 18v-7', 'M11.119 2.205a2 2 0 0 1 1.762 0l7.84 3.846A.5.5 0 0 1 20.5 7h-17a.5.5 0 0 1-.22-.949z', 'M14 18v-7', 'M18 18v-7', 'M3 22h18', 'M6 18v-7'],
  // box
  contract: ['M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z', 'm3.3 7 8.7 5 8.7-5', 'M12 22V12'],
}
let paths: Record<Glyph, Path2D[]> | null = null
export function glyphPaths(g: Glyph): Path2D[] {
  if (typeof Path2D === 'undefined') return []
  paths ??= Object.fromEntries(Object.entries(GLYPHS).map(([k, ds]) => [k, ds.map((d) => new Path2D(d))])) as Record<Glyph, Path2D[]>
  return paths[g]
}
export function glyphOf(n: HolderNode): Glyph | null {
  const k = n.label?.kind
  if (!k) return n.contract ? 'contract' : null
  if (k === 'pool' || k === 'router') return 'pool'
  if (k === 'lock') return 'lock'
  if (k === 'burn') return 'burn'
  if (k === 'deployer') return 'deployer'
  if (k === 'token') return 'token'
  if (k === 'exchange') return 'exchange'
  if (k === 'gully') return 'contract'
  return null
}
/** The short caption under an infrastructure bubble. */
export function captionOf(n: HolderNode): string | null {
  const k = n.label?.kind
  if (!k) return null
  return (
    (
      {
        pool: 'POOL',
        router: 'ROUTER',
        lock: 'LOCK',
        burn: 'BURN',
        deployer: 'DEPLOYER',
        token: 'TOKEN',
        exchange: 'EXCHANGE',
        gully: 'GULLY',
      } as Partial<Record<HolderLabelKind, string>>
    )[k] ?? null
  )
}

const PREVIEW_NODES = 14
const PREVIEW_INFRA = new Set<HolderLabelKind>(INFRA_KINDS)
/** The map's preview, built the same way the server builds the launch feed's (holders-intel.mjs mapPreview). */
export function previewOf(m: MotionMap): MapPreview {
  const nodes = m.nodes.slice(0, PREVIEW_NODES)
  const idx = new Map(nodes.map((n, i) => [n.id, i]))
  return {
    nodes: nodes.map((n) => ({
      p: n.pct ?? 0,
      k: n.label?.kind === 'deployer' ? 'deployer' : n.label && PREVIEW_INFRA.has(n.label.kind) ? (n.label.kind === 'pool' || n.label.kind === 'lock' || n.label.kind === 'burn' ? n.label.kind : 'infra') : n.cluster ? 'cluster' : 'wallet',
    })),
    flows: (m.recentFlows ?? []).slice(-8).map((f) => ({
      f: idx.get(norm(f.from)) ?? -1,
      t: idx.get(norm(f.to)) ?? -1,
      s: f.side ?? 'transfer',
    })),
  }
}
