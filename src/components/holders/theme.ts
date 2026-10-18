import { alpha, C } from '../charts/chartPresets'

/* The Holder Map's colours for canvas and SVG code, which cannot read CSS classes: a thin alias of the chart
   kit's colours (chartPresets C, the site's own tokens). DOM elements use the site's semantic classes
   (text-ink, text-muted, text-dim, text-gold, bg-surface…); these appear in the DOM only as inline fills. */
export const K = {
  /** Inside the card: the map stage and inner panels (surface-deep). */
  night: C.surfaceDeep,
  /** The card itself (surface). */
  midnight: C.surface,
  slate: C.lineStrong,
  bone: C.ink,
  gold: C.gold,
  pale: C.goldHover,
  /** The deployer: the site's green, toned down so it reads as a fill rather than a signal. */
  moss: alpha(C.green, 0.42),
  muted: C.muted,
  dim: C.dim,
  warn: C.error,
} as const
