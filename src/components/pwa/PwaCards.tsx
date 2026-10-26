import { Download, RefreshCw, Share, SquarePlus, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { applyUpdate, dismissInstall, promptInstall, useInstallMode, useUpdateReady } from '../../pwa/pwa'

/* The install card ("Install Gully Labs" on the site, "Install the app" in the app) and the update card
   ("New version available · Reload"). One card at a time, the update first. They sit just above the bottom-right
   dock (Back to top and the Gully AI button) so neither is ever covered, never over the app's bottom tab bar
   (`lift`), and the install card waits a few seconds so it never competes with first paint. The install card
   never shows once installed and stays away for 30 days after the X (src/pwa/pwa.ts, server/pwa.mjs). */

const SHOW_AFTER_MS = 3000

export function PwaCards({ kind, lift = false }: { kind: 'site' | 'app'; lift?: boolean }) {
  const mode = useInstallMode()
  const update = useUpdateReady()
  const [ready, setReady] = useState(false)
  // Never on load: the install toast waits for the delay AND the visitor's first real scroll, so it never covers
  // the first screen (owner, 2026-10-26: it sat over the product grid).
  useEffect(() => {
    if (!mode) return
    let timed = false
    let scrolled = window.scrollY > 240
    const go = () => timed && scrolled && setReady(true)
    const t = window.setTimeout(() => ((timed = true), go()), SHOW_AFTER_MS)
    const onScroll = () => {
      if (window.scrollY > 240) {
        scrolled = true
        go()
      }
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      window.clearTimeout(t)
      window.removeEventListener('scroll', onScroll)
    }
  }, [mode])

  // Above the dock: its button is 44 px tall at 20 px (16 on phones); in the app the dock sits above the tab bar.
  const place = `pointer-events-auto fixed right-5 z-40 w-[min(300px,calc(100vw-32px))] max-[600px]:right-4 print:hidden ${lift ? 'bottom-[calc(132px+env(safe-area-inset-bottom))]' : 'bottom-[76px]'}`
  const card = 'flex items-center gap-2 rounded-full border border-gold-line bg-surface-deep py-1.5 pr-1.5 pl-4 shadow-[0_10px_28px_rgba(0,0,0,.45)] animate-[gl-fade_.3s_ease_both]'
  const btn = 'inline-flex min-h-9 shrink-0 items-center justify-center gap-1.5 rounded-full bg-gold px-3 text-[13px] font-semibold text-[#06050d] transition-colors hover:bg-gold-hover'
  const close = 'inline-flex size-9 shrink-0 items-center justify-center rounded-full text-faint transition-colors hover:text-ink'

  if (update) {
    return (
      <div className={place} data-testid="pwa-update-card" role="status">
        <div className={card}>
          <RefreshCw size={18} className="shrink-0 text-gold" aria-hidden />
          <p className="m-0 min-w-0 flex-1 text-[14px] leading-tight text-ink">
            New version available <span className="text-faint">·</span>
          </p>
          <button type="button" onClick={applyUpdate} className={btn} data-testid="pwa-reload">
            Reload
          </button>
        </div>
      </div>
    )
  }
  if (!mode || !ready) return null
  const title = kind === 'app' ? 'Install the app' : 'Install Gully Labs'
  return (
    <div className={place} data-testid="pwa-install-card" data-mode={mode} role="region" aria-label={title}>
      <div className={card}>
        <Download size={18} className="shrink-0 text-gold" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="m-0 text-[13px] leading-tight font-semibold text-ink">{title}</p>
          {mode === 'ios' && (
            <p className="m-0 mt-1 flex flex-wrap items-center gap-x-1 text-[12px] leading-snug text-muted" data-testid="pwa-ios-steps">
              Tap <Share size={14} className="text-gold" aria-label="Share" /> Share <span aria-hidden>→</span> <SquarePlus size={14} className="text-gold" aria-hidden /> Add to Home Screen
            </p>
          )}
        </div>
        {mode === 'prompt' && (
          <button type="button" onClick={() => void promptInstall()} className={btn} data-testid="pwa-install">
            Install
          </button>
        )}
        <button type="button" onClick={dismissInstall} className={close} aria-label="Dismiss" data-testid="pwa-dismiss">
          <X size={16} aria-hidden />
        </button>
      </div>
    </div>
  )
}
