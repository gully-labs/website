import { ArrowUpRight, ChartNoAxesCombined, Loader2 } from 'lucide-react'
import { useState } from 'react'
import { api } from './api'
import { useWrite } from './portal'
import { pillGold } from './styles'

/* "Open Gully Analytics": one-click sign-in from the console. POST /api/developer/analytics/sso returns a
   short-lived code (or the whole URL); the dashboard opens at <origin>/sso?code=… in a new tab. When
   the route is not there (404, an older server) or refuses (a role without analytics writes), the
   tab opens the plain login page instead. The tab is opened synchronously on the click, so popup
   blockers let it through, then pointed at the URL once the code arrives. */

export function OpenAnalytics({ loginUrl, className = pillGold }: { loginUrl: string; className?: string }) {
  const [busy, setBusy] = useState(false)
  // The route is a write in the analytics group; a role without it goes straight to the login page.
  const sso = useWrite('analytics', 'sign in to Gully Analytics from here').ok
  const origin = (() => {
    try {
      return new URL(loginUrl).origin
    } catch {
      return 'https://analytics.gullylabs.xyz'
    }
  })()
  const open = async () => {
    const tab = window.open('about:blank', '_blank')
    if (tab) tab.opener = null
    if (!sso) {
      if (tab) tab.location.href = loginUrl
      else window.open(loginUrl, '_blank', 'noopener,noreferrer')
      return
    }
    setBusy(true)
    const r = await api<{ url?: string; code?: string }>('/api/developer/analytics/sso', { method: 'POST' })
    setBusy(false)
    let target = loginUrl
    if (r.ok) {
      const url = r.data.url ?? (r.data.code ? `${origin}/sso?code=${encodeURIComponent(r.data.code)}` : null)
      if (url && /^https:\/\//.test(url)) target = url
    }
    if (tab) tab.location.href = target
    else window.open(target, '_blank', 'noopener,noreferrer')
  }
  return (
    <button type="button" onClick={open} disabled={busy} className={className} data-testid="open-analytics">
      {busy ? <Loader2 size={16} className="animate-spin" aria-hidden /> : <ChartNoAxesCombined size={16} aria-hidden />} Open Gully Analytics <ArrowUpRight size={13} aria-hidden />
      <span className="sr-only"> (opens in a new tab)</span>
    </button>
  )
}
