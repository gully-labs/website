import { useEffect } from 'react'

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
export function Seo({ title, description, noindex = false }: { title: string; description: string; noindex?: boolean }) {
  // A page that is not one (the 404): keep it out of search results while it is shown.
  useEffect(() => {
    if (!noindex) return
    setMeta('name', 'robots', 'noindex')
    return () => document.head.querySelector('meta[name="robots"]')?.remove()
  }, [noindex])
  useEffect(() => {
    const full = `${title} · Gully Labs`
    document.title = full
    setMeta('name', 'description', description)
    setMeta('property', 'og:title', full)
    setMeta('property', 'og:description', description)
    setMeta('name', 'twitter:title', full)
    setMeta('name', 'twitter:description', description)
  }, [title, description])

  return null
}
