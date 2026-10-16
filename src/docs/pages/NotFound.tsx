import { useEffect } from 'react'
import { DocLink } from '../DocPage'

export function NotFound() {
  useEffect(() => {
    document.title = 'Page not found · Gully Labs Docs'
  }, [])
  return (
    <div className="flex max-w-[640px] flex-col gap-4" style={{ animation: 'gl-rise .45s ease both' }}>
      <span className="font-mono text-[12px] tracking-[1.5px] text-gold">404</span>
      <h1 className="m-0 font-display text-[48px] leading-[.95] font-extrabold uppercase">No page here</h1>
      <p className="m-0 text-[17px] leading-[1.6] text-muted">
        This docs page does not exist. Try the <DocLink to="">overview</DocLink> or the <DocLink to="api">API reference</DocLink>.
      </p>
    </div>
  )
}
