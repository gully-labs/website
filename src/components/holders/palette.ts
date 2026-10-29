import { C } from '../charts/chartTheme'
import type { HolderLabelKind } from '../../lib/holders'

/* The Holder Map's colour language (pure data, checked in Node by scripts/test-holders.mjs). Colour carries
   meaning: a cluster has its own hue (gold for the biggest, then hues that stay legible on the dark stage),
   people who belong to no cluster are slate, and infrastructure (pools, exchanges, burn, locks, contracts, the
   deployer) each has a family of its own. Red is kept for sells and bundled buys, so no cluster uses it. */

/** Cluster hues, largest cluster first. Every one has >= 3:1 against the stage and >= 4.5:1 text on its fill. */
export const CLUSTER_HUES = [C.gold, '#2fb59d', '#9578e8', '#a3cf4a', '#e58fb3', '#5fd0d6', '#8f9bf0'] as const
/** People in no cluster. */
export const WALLET_HUE = '#74849b'
/** Size bands for maps without links (Solana, top-holders-only): biggest to smallest. */
export const BAND_HUES = ['#248bff', '#2fb59d', '#8296b6', '#74849b'] as const
export const BAND_STEPS = [5, 1, 0.2] as const

export type KindKey = HolderLabelKind | 'contract'
export const KIND_HUE: Record<KindKey, string> = {
  pool: '#4f9fe0',
  exchange: '#8da3c4',
  burn: '#a54832',
  lock: '#a89a86',
  token: '#9a8442',
  gully: '#b09448',
  router: '#4f9fe0',
  deployer: '#6dbb74',
  known: '#7f8ba0',
  contract: '#7384b3',
}
export const KIND_WORD: Record<KindKey, string> = {
  pool: 'pool',
  exchange: 'exchange',
  burn: 'burn',
  lock: 'lock',
  token: 'token',
  gully: 'Gully',
  router: 'router',
  deployer: 'deployer',
  known: 'known',
  contract: 'contract',
}

/** Past the seventh cluster the hues repeat, a step lighter, so two clusters never share a look. */
export const clusterHue = (index: number) => (index < CLUSTER_HUES.length ? CLUSTER_HUES[index] : shade(CLUSTER_HUES[index % CLUSTER_HUES.length], 0.18))
export const bandOf = (pct: number | null) => {
  const p = pct ?? 0
  return p >= BAND_STEPS[0] ? 0 : p >= BAND_STEPS[1] ? 1 : p >= BAND_STEPS[2] ? 2 : 3
}

/* ---------- colour maths ---------- */

const rgb = (hex: string): [number, number, number] => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)]
const hex2 = (n: number) =>
  Math.max(0, Math.min(255, Math.round(n)))
    .toString(16)
    .padStart(2, '0')
/** Mix with white (amt > 0) or black (amt < 0). */
export function shade(hex: string, amt: number) {
  const t = amt < 0 ? 0 : 255
  const k = Math.abs(amt)
  const [r, g, b] = rgb(hex)
  return `#${hex2(r + (t - r) * k)}${hex2(g + (t - g) * k)}${hex2(b + (t - b) * k)}`
}
const lin = (v: number) => {
  const s = v / 255
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
}
export const luminance = (hex: string) => {
  const [r, g, b] = rgb(hex)
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}
export const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}
/** The text colour that reads best on a bubble of this hue (its mid tone). */
export const textOn = (hue: string) => (contrast(C.bg, hue) >= contrast(C.ink, hue) ? C.bg : C.ink)

/** Every hue the map can paint, for the contrast check. */
export const ALL_HUES = [...CLUSTER_HUES, WALLET_HUE, ...BAND_HUES, ...Object.values(KIND_HUE)] as const
