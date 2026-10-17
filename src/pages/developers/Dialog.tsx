import { AnimatePresence, motion } from 'motion/react'
import { X } from 'lucide-react'
import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { copyWithToast } from '../../components/ui/toast'
import { restoreFocus } from './portal'

/**
 * A modal dialog, rendered into document.body (a portal): a transformed ancestor such as the tab panel's
 * gl-rise animation would otherwise trap its fixed backdrop inside the panel. Escape closes, Tab stays
 * inside, and focus returns to the element that opened it (the trigger).
 */
export function Dialog({ open, onClose, title, children, dismissable = true }: { open: boolean; onClose: () => void; title: string; children: ReactNode; dismissable?: boolean }) {
  const panel = useRef<HTMLDivElement>(null)
  const id = useId()
  // The latest onClose, so a caller's inline function does not re-run the focus effect on every render.
  const close = useRef(onClose)
  useEffect(() => {
    close.current = onClose
  })
  useEffect(() => {
    if (!open) return
    const previous = document.activeElement as HTMLElement | null
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && dismissable) {
        e.stopPropagation()
        return close.current()
      }
      if (e.key !== 'Tab' || !panel.current) return
      const items = [...panel.current.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])')].filter((el) => el.offsetParent !== null)
      if (!items.length) return
      const first = items[0]
      const last = items[items.length - 1]
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const raf = requestAnimationFrame(() => (panel.current?.querySelector<HTMLElement>('[data-autofocus], input:not([disabled]), select, textarea') ?? panel.current?.querySelector<HTMLElement>('button'))?.focus())
    return () => {
      cancelAnimationFrame(raf)
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = overflow
      // Back to the trigger, if it is still on the page (a menu item may have gone with its menu).
      restoreFocus(previous)
    }
  }, [open, dismissable])

  if (typeof document === 'undefined') return null
  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-[100] flex items-center justify-center overflow-y-auto p-4" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }} data-portal-dialog>
          <div className="fixed inset-0 bg-[rgba(5,7,10,.72)] backdrop-blur-[3px]" onClick={dismissable ? () => close.current() : undefined} aria-hidden />
          <motion.div
            ref={panel}
            role="dialog"
            aria-modal="true"
            aria-labelledby={id}
            className="relative my-auto flex max-h-[calc(100dvh-32px)] w-full max-w-[520px] flex-col gap-5 overflow-y-auto rounded-modal border border-line-strong bg-surface p-6 shadow-[0_24px_64px_rgba(0,0,0,.55)] max-[480px]:p-5"
            initial={{ y: 16, scale: 0.98 }}
            animate={{ y: 0, scale: 1 }}
            exit={{ y: 8, scale: 0.98 }}
            transition={{ type: 'spring', stiffness: 420, damping: 32 }}
          >
            <div className="flex items-start justify-between gap-4">
              <h2 id={id} className="m-0 font-display text-[26px] leading-none font-bold uppercase">
                {title}
              </h2>
              {dismissable && (
                <button type="button" onClick={() => close.current()} aria-label="Close" className="-mt-2 -mr-2 inline-flex size-11 shrink-0 items-center justify-center rounded-btn text-muted hover:bg-surface-hover hover:text-ink">
                  <X size={18} aria-hidden />
                </button>
              )}
            </div>
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  )
}

/** A copy-to-clipboard button. `what` names the thing in the toast ("Key copied"). */
export function CopyButton({ text, label = 'Copy', what = 'Text', className = '' }: { text: string; label?: string; what?: string; className?: string }) {
  const [done, setDone] = useState(false)
  return (
    <button
      type="button"
      onClick={() =>
        copyWithToast(text, what).then((ok) => {
          if (!ok) return
          setDone(true)
          setTimeout(() => setDone(false), 1600)
        })
      }
      className={`inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-btn border px-3 font-mono text-[12px] transition-colors ${done ? 'border-success-line text-green' : 'border-line-strong text-ink-2 hover:border-gold hover:text-ink'} ${className}`}
      aria-label={done ? `${what} copied` : `Copy ${what.toLowerCase()}`}
    >
      {done ? 'Copied' : label}
    </button>
  )
}
