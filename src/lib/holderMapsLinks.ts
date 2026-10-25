import { holderInternalPath, holderShortPath, isHolderMapsHost, SITE_URL } from '../site-host'

/* On holdermaps.xyz only the Holder Map's own pages live on this origin (server/hosts.mjs). The site header, footer and
   pages link the rest of Gully Labs by path (/pricing, /tracker, /legal/terms); a click on one of those goes straight
   to the same page on gullylabs.xyz instead of routing here first. (A link opened in a new tab reaches the server,
   which answers it with the same 301.) Runs in the capture phase, before React Router's own click handling. */
export function installHolderMapsLinks() {
  if (typeof document === 'undefined' || !isHolderMapsHost()) return
  document.addEventListener(
    'click',
    (e) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
      const a = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null
      if (!a || (a.target && a.target !== '_self') || a.hasAttribute('download')) return
      const url = new URL(a.href, window.location.href)
      if (url.origin !== window.location.origin) return
      if (holderInternalPath(url.pathname) || holderShortPath(url.pathname)) return
      e.preventDefault()
      window.location.assign(SITE_URL + url.pathname + url.search + url.hash)
    },
    true,
  )
}
