import { Sparkles, X } from 'lucide-react'
import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { askStatus } from './askApi'
import { ASK_OPEN_EVENT } from './openAsk'

// The panel (and its code) loads the first time it is opened.
const AskPanel = lazy(() => import('./AskPanel').then((m) => ({ default: m.AskPanel })))

const isMac = () => typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)

/* "Gully AI": opens Ask as a side panel on wide screens and a sheet on phones.
     variant "header"   a button in a header (the docs).
     variant "floating" a pill fixed at the bottom right (the main site, in its dock beside Back to top;
                        the app shell). It sits under the toasts (offset 76 px, 72 px on phones) and
                        fades in, no movement, so it reads the same under reduced motion.
   Every variant also opens on ⌘K / Ctrl+K (pressed again, or Escape, it closes) and on openAsk() (a
   window event, for links elsewhere on the page). `hideButton` keeps the shortcut but draws no button
   (a page that already is the chat). Hidden entirely while the server says Ask is not configured. */
export function AskLauncher({ variant = 'header', hideButton = false }: { variant?: 'header' | 'floating'; hideButton?: boolean }) {
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

  // ⌘K / Ctrl+K toggles the panel from anywhere on the page; openAsk() opens it.
  useEffect(() => {
    if (!on) return
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setOpen((o) => !o)
      }
    }
    const onOpen = () => setOpen(true)
    document.addEventListener('keydown', onKey)
    window.addEventListener(ASK_OPEN_EVENT, onOpen)
    return () => {
      document.removeEventListener('keydown', onKey)
      window.removeEventListener(ASK_OPEN_EVENT, onOpen)
    }
  }, [on])

  useEffect(() => {
    if (!open) return
    const opener = document.activeElement as HTMLElement | null
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
    const back = btn.current ?? opener
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
      back?.focus?.()
    }
  }, [open])

  if (!on) return null
  const shortcut = isMac() ? '⌘K' : 'Ctrl+K'
  return (
    <>
      {!hideButton &&
        (variant === 'floating' ? (
          <button
            ref={btn}
            type="button"
            onClick={() => setOpen(true)}
            aria-haspopup="dialog"
            aria-expanded={open}
            aria-keyshortcuts="Meta+K Control+K"
            aria-label={`Ask Gully AI (${shortcut})`}
            title={`Ask Gully AI · ${shortcut}`}
            data-testid="ask-fab"
            className="pointer-events-auto inline-flex h-11 animate-[gl-fade_.3s_.2s_ease_both] items-center gap-2 rounded-full border border-gold-line bg-surface-deep px-4 text-[14px] font-medium text-gold shadow-[0_10px_28px_rgba(0,0,0,.45)] transition-colors hover:border-gold max-[600px]:w-11 max-[600px]:justify-center max-[600px]:px-0 print:hidden"
          >
            <Sparkles size={17} aria-hidden />
            <span className="max-[600px]:hidden">Gully AI</span>
            <kbd className="rounded-[4px] border border-line-strong px-[5px] font-mono text-[11px] leading-[18px] text-faint max-[600px]:hidden">{shortcut}</kbd>
          </button>
        ) : (
          <button
            ref={btn}
            type="button"
            onClick={() => setOpen(true)}
            aria-haspopup="dialog"
            aria-expanded={open}
            aria-keyshortcuts="Meta+K Control+K"
            title={`Gully AI · ${shortcut}`}
            data-testid="ask-launcher"
            className="inline-flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-btn border border-gold-line bg-[rgba(217,181,99,.08)] px-3 text-[14px] text-gold transition-colors hover:border-gold hover:bg-[rgba(232,192,96,.14)]"
          >
            <Sparkles size={16} aria-hidden />
            <span className="max-[520px]:sr-only">Gully AI</span>
          </button>
        ))}
      {/* Portalled to <body>: a header's backdrop-filter would otherwise contain a fixed element. */}
      {open &&
        createPortal(
          <div className="fixed inset-0 z-[80]" role="presentation">
            <div aria-hidden className="absolute inset-0 bg-[rgba(5,7,10,.62)]" style={{ animation: 'gl-fade .2s ease both' }} onClick={() => setOpen(false)} />
            <div
              ref={dialog}
              role="dialog"
              aria-modal="true"
              aria-labelledby="ask-gully-title"
              data-testid="ask-dialog"
              className="absolute flex flex-col gap-4 border-line bg-bg p-5 shadow-[0_0_60px_rgba(0,0,0,.5)] max-[699px]:inset-x-0 max-[699px]:bottom-0 max-[699px]:h-[88dvh] max-[699px]:rounded-t-modal max-[699px]:border-t min-[700px]:inset-y-0 min-[700px]:right-0 min-[700px]:w-[min(480px,100vw)] min-[700px]:border-l"
              style={{ animation: 'gl-rise .25s ease both' }}
            >
              <div className="flex items-center justify-between gap-3">
                <h2 id="ask-gully-title" className="m-0 flex items-center gap-2 font-display text-[24px] leading-none font-bold uppercase">
                  <Sparkles size={20} aria-hidden className="text-gold" /> Gully AI
                  <kbd className="ml-1 rounded-[4px] border border-line-strong px-[5px] font-mono text-[11px] leading-[18px] font-normal text-faint normal-case max-[699px]:hidden">{shortcut}</kbd>
                </h2>
                <button type="button" onClick={() => setOpen(false)} aria-label="Close Gully AI" className="grid size-11 place-items-center rounded-btn border border-line text-ink-2 transition-colors hover:border-line-hover">
                  <X size={18} aria-hidden />
                </button>
              </div>
              <div className="min-h-0 flex-1">
                <Suspense fallback={<p className="m-0 font-mono text-[13px] text-faint">Loading Gully AI…</p>}>
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
