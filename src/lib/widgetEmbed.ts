import { EMBED_URL, isDocsHost } from '../site-host'

/** The public origin a snippet points at. Previews on this site point at this site's own origin, so a
    development server previews against its own API; the docs host borrows the main site's. */
export const WIDGET_ORIGIN = EMBED_URL

export type WidgetType = 'ticker' | 'badge' | 'table'
export type WidgetTheme = 'dark' | 'light'

export interface WidgetOptions {
  type: WidgetType
  chain: string
  ticker?: string
  theme: WidgetTheme
  limit?: number
}

/** Where previews on this page fetch the script and the API from. */
export function previewOrigin(): string {
  if (typeof window === 'undefined' || isDocsHost()) return WIDGET_ORIGIN
  return window.location.origin
}

/** Loads widget.js once per page. Widgets added later are picked up by the script's own observer. */
export function ensureWidgetScript(origin = previewOrigin()): void {
  if (typeof document === 'undefined') return
  const w = window as Window & { GullyWidget?: { scan: () => void } }
  if (w.GullyWidget) {
    w.GullyWidget.scan()
    return
  }
  if (document.querySelector('script[data-gully-widget-script]')) return
  const s = document.createElement('script')
  s.src = `${origin}/widget.js`
  s.async = true
  s.dataset.gullyWidgetScript = ''
  document.body.appendChild(s)
}

/** The data-* attributes for one widget, in the order the docs list them. Defaults are left out. */
export function widgetAttrs(o: WidgetOptions): [string, string][] {
  const a: [string, string][] = [['data-gully-widget', o.type]]
  if (o.chain !== 'all') a.push(['data-chain', o.chain])
  if (o.type === 'badge' && o.ticker) a.push(['data-ticker', o.ticker])
  if (o.theme !== 'dark') a.push(['data-theme', o.theme])
  if (o.type !== 'badge' && o.limit) a.push(['data-limit', String(o.limit)])
  return a
}

/** The copy-paste snippet for a host page. */
export function widgetSnippet(o: WidgetOptions): string {
  const attrs = widgetAttrs(o)
    .map(([k, v]) => `${k}="${v}"`)
    .join(' ')
  return `<div ${attrs}></div>\n<script src="${WIDGET_ORIGIN}/widget.js" async></script>`
}
