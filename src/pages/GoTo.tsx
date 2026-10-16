import { useEffect } from 'react'

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
