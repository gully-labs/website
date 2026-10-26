/* Lab-console toasts: real events only (a new Gully Chain block, a venue refresh), bottom-right stack of three,
   night surface, 22 px radius, Lucide icon, cyan progress bar. Rendered by <ConsoleToasts /> in Layout. */
export type ToastIcon = 'activity' | 'blocks' | 'zap' | 'check'
export interface ConsoleToast {
  id: number
  title: string
  text: string
  icon: ToastIcon
  ms: number
}
let items: ConsoleToast[] = []
let seq = 0
let last = 0
const subs = new Set<() => void>()
const emit = () => subs.forEach((f) => f())

export function consoleToast({ title, text, icon = 'zap', ms = 6000 }: { title: string; text: string; icon?: ToastIcon; ms?: number }) {
  // Never a stack of near-identical toasts.
  if (performance.now() - last < 2500) return
  last = performance.now()
  const t = { id: ++seq, title, text, icon, ms }
  items = [...items, t].slice(-3)
  emit()
  setTimeout(() => dismissToast(t.id), ms)
}
export function dismissToast(id: number) {
  items = items.filter((t) => t.id !== id)
  emit()
}
export const toastStore = {
  subscribe(f: () => void) {
    subs.add(f)
    return () => void subs.delete(f)
  },
  get: () => items,
}
