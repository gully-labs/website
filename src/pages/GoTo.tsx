import { useEffect } from 'react'
import { SITE_URL } from '../site-host'

/** Leaves for another host (the admin dashboard lives on admin.gullylabs.xyz). */
export function GoTo({ url }: { url: string }) {
  useEffect(() => {
    window.location.replace(url)
  }, [url])
  return (
    <p className="px-page py-24 font-mono text-[13px] text-faint">
      Moved to <a href={url}>{url.replace('https://', '')}</a>…
    </p>
  )
}

/** Leaves for the same path on the main site (used on hosts that serve one page only). */
export function ToSite() {
  return <GoTo url={SITE_URL + window.location.pathname + window.location.search} />
}
