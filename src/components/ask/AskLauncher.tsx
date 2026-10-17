import { Sparkles, X } from 'lucide-react'
import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { askStatus } from './askApi'

// The panel (and its code) loads the first time it is opened.
const AskPanel = lazy(() => import('./AskPanel').then((m) => ({ default: m.AskPanel })))

/* "Gully AI" for the docs header: a button that opens Ask as a side panel on wide screens and a sheet on
   phones. Hidden entirely while the server says Ask is not configured. */
export function AskLauncher() {
  const [on, setOn] = useState(false)
  const [open, setOpen] = useState(false)
  const btn = useRef<HTMLButtonElement>(null)
  const dialog = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let alive = true
    askStatus().then((s) => alive && setOn(!!s?.configured))
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') return setOpen(false)
      // Keep Tab inside the dialog.
      if (e.key !== 'Tab' || !dialog.current) return
      const f = [...dialog.current.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), textarea, input, [tabindex]:not([tabindex="-1"])')]
      if (!f.length) return
      const first = f[0]
      const last = f[f.length - 1]
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const opener = btn.current
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
      opener?.focus()
    }
  }, [open])

  if (!on) return null
  return (
    <>
      <button
        ref={btn}
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="inline-flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-btn border border-gold-line bg-[rgba(232,192,96,.08)] px-3 text-[14px] text-gold transition-colors hover:border-gold hover:bg-[rgba(232,192,96,.14)]"
      >
        <Sparkles size={16} aria-hidden />
        <span className="max-[520px]:sr-only">Gully AI</span>
      </button>
      {/* Portalled to <body>: the docs header's backdrop-filter would otherwise contain a fixed element. */}
      {open &&
        createPortal(
        <div className="fixed inset-0 z-50" role="presentation">
          <div aria-hidden className="absolute inset-0 bg-[rgba(5,7,10,.62)]" style={{ animation: 'gl-fade .2s ease both' }} onClick={() => setOpen(false)} />
          <div
            ref={dialog}
            role="dialog"
            aria-modal="true"
            aria-labelledby="ask-gully-title"
            className="absolute flex flex-col gap-4 border-line bg-bg p-5 shadow-[0_0_60px_rgba(0,0,0,.5)] max-[699px]:inset-x-0 max-[699px]:bottom-0 max-[699px]:h-[88dvh] max-[699px]:rounded-t-[16px] max-[699px]:border-t min-[700px]:inset-y-0 min-[700px]:right-0 min-[700px]:w-[min(480px,100vw)] min-[700px]:border-l"
            style={{ animation: 'gl-rise .25s ease both' }}
          >
            <div className="flex items-center justify-between gap-3">
              <h2 id="ask-gully-title" className="m-0 flex items-center gap-2 font-display text-[24px] leading-none font-bold uppercase">
                <Sparkles size={20} aria-hidden className="text-gold" /> Gully AI
              </h2>
              <button type="button" onClick={() => setOpen(false)} aria-label="Close Gully AI" className="grid size-11 place-items-center rounded-btn border border-line text-ink-2 transition-colors hover:border-line-hover">
                <X size={18} aria-hidden />
              </button>
            </div>
            <div className="min-h-0 flex-1">
              <Suspense fallback={<p className="m-0 font-mono text-[13px] text-faint">Loading Ask…</p>}>
                <AskPanel variant="panel" autoFocus />
              </Suspense>
            </div>
          </div>
        </div>,
          document.body,
        )}
    </>
  )
}
