import { C } from '../charts/chartPresets'

/* Kit colours for chart and SVG code, which cannot read CSS variables: read from the kit palette tokens in
   src/index.css (--color-kit-*) when the page has them, else the chart kit's own token values (chartPresets C).
   No colour is typed here. */
const token = (name: string, fallback: string) => {
  try {
    const v = typeof document === 'undefined' ? '' : getComputedStyle(document.documentElement).getPropertyValue(name).trim()
    return /^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : fallback
  } catch {
    return fallback
  }
}
export const K = {
  get night() {
    return token('--color-kit-lab-night', C.surfaceDeep)
  },
  get midnight() {
    return token('--color-kit-midnight', C.surface)
  },
  get slate() {
    return token('--color-kit-slate', C.lineStrong)
  },
  get bone() {
    return token('--color-kit-bone', C.ink)
  },
  get gold() {
    return token('--color-kit-lab-gold', C.gold)
  },
  get pale() {
    return token('--color-kit-pale-gold', C.goldHover)
  },
  get moss() {
    return token('--color-kit-moss', C.lineHover)
  },
  get muted() {
    return token('--color-kit-text-muted', C.muted)
  },
  get dim() {
    return token('--color-kit-text-dim', C.faint)
  },
  get warn() {
    return token('--color-error', C.error)
  },
}
