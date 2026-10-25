import { useEffect } from 'react'
import { SITE_URL } from '../content/site'
import { holderMapsPrimary, holderShortPath, HOLDERMAPS_URL, isHolderMapsHost, isSecurityHost, securityInternalPath, securityPrimary, securityShortPath, SECURITY_URL } from '../site-host'

/** A page's canonical address: holdermaps.xyz for the Holder Map's pages once it is their home, gullysecurity.xyz for
    Gully Security's likewise (its /terms names the legal page on gullylabs.xyz, as server/seo.mjs does), else this site. */
function canonicalFor(path: string) {
  if (isHolderMapsHost()) return `${HOLDERMAPS_URL}${path}`
  if (isSecurityHost()) return securityInternalPath(path) === '/legal/scan-terms' ? `${SITE_URL}/legal/scan-terms` : `${SECURITY_URL}${path}`
  const holder = holderMapsPrimary() ? holderShortPath(path) : null
  if (holder) return `${HOLDERMAPS_URL}${holder}`
  const security = securityPrimary() ? securityShortPath(path) : null
  return security ? `${SECURITY_URL}${security}` : `${SITE_URL}${path}`
}

/** The browser title on gullysecurity.xyz (server/seo.mjs SECURITY_HOME_TITLE for the home). */
const securityTitle = (title: string) => (title === 'Gully Security' ? 'AI Security Scan and Security Review · Gully Security' : `${title} · Gully Security`)

function setMeta(attr: 'name' | 'property', key: string, content: string) {
  let el = document.head.querySelector<HTMLMetaElement>(`meta[${attr}="${key}"]`)
  if (!el) {
    el = document.createElement('meta')
    el.setAttribute(attr, key)
    document.head.appendChild(el)
  }
  el.content = content
}

/** Updates the page title and description tags that index.html ships with. */
export function Seo({ title, description, noindex = false, bare = false }: { title: string; description: string; noindex?: boolean; bare?: boolean }) {
  // A page that is not one (the 404): keep it out of search results while it is shown.
  useEffect(() => {
    if (!noindex) return
    setMeta('name', 'robots', 'noindex')
    return () => document.head.querySelector('meta[name="robots"]')?.remove()
  }, [noindex])
  useEffect(() => {
    // `bare`: the title as given (the checkout is "Pay <store>", not a Gully Labs page). On holdermaps.xyz every
    // page is a HolderMaps page, and on gullysecurity.xyz a Gully Security page.
    const full = bare ? title : isHolderMapsHost() ? `${title.replace(/ · Holder Map$/, '')} · HolderMaps` : isSecurityHost() ? securityTitle(title) : `${title} · Gully Labs`
    document.title = full
    setMeta('name', 'description', description)
    setMeta('property', 'og:title', full)
    setMeta('property', 'og:description', description)
    setMeta('name', 'twitter:title', full)
    setMeta('name', 'twitter:description', description)
  }, [title, description, bare])
  // The canonical address and og:url follow the page (the server writes them for the first load; a client-side
  // navigation must not leave the previous page's). Pages that are not indexed (the 404, checkouts) have none.
  useEffect(() => {
    if (typeof location === 'undefined') return
    let link = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]')
    if (noindex || bare) {
      link?.remove()
      document.head.querySelector('meta[property="og:url"]')?.remove()
      return
    }
    const url = canonicalFor(location.pathname.replace(/\/+$/, '') || '/')
    if (!link) {
      link = document.createElement('link')
      link.rel = 'canonical'
      document.head.appendChild(link)
    }
    link.href = url
    setMeta('property', 'og:url', url)
  }, [noindex, bare, title])

  return null
}
