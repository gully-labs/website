import { AnimatePresence, motion } from 'motion/react'
import { X } from 'lucide-react'
import { useEffect, useId, useRef, useState, type ReactNode } from 'react'

/** A modal dialog: Escape closes, Tab stays inside, focus returns to where it was. */
export function Dialog({ open, onClose, title, children, dismissable = true }: { open: boolean; onClose: () => void; title: string; children: ReactNode; dismissable?: boolean }) {
  const panel = useRef<HTMLDivElement>(null)
  const id = useId()
  useEffect(() => {
    if (!open) return
    const previous = document.activeElement as HTMLElement | null
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && dismissable) return onClose()
      if (e.key !== 'Tab' || !panel.current) return
      const items = panel.current.querySelectorAll<HTMLElement>('button:not([disabled]), input, [href], [tabindex]:not([tabindex="-1"])')
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
    requestAnimationFrame(() => (panel.current?.querySelector<HTMLElement>('input, [data-autofocus]') ?? panel.current?.querySelector<HTMLElement>('button'))?.focus())
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = overflow
      previous?.focus()
    }
  }, [open, onClose, dismissable])

  return (
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-[100] flex items-center justify-center p-4" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}>
          <div className="absolute inset-0 bg-[rgba(5,7,10,.72)] backdrop-blur-[3px]" onClick={dismissable ? onClose : undefined} aria-hidden />
          <motion.div
            ref={panel}
            role="dialog"
            aria-modal="true"
            aria-labelledby={id}
            className="relative flex w-full max-w-[520px] flex-col gap-5 rounded-modal border border-line-strong bg-surface p-6 shadow-[0_24px_64px_rgba(0,0,0,.55)] max-[480px]:p-5"
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
                <button type="button" onClick={onClose} aria-label="Close" className="-mt-2 -mr-2 inline-flex size-10 items-center justify-center rounded-btn text-muted hover:bg-surface-hover hover:text-ink">
                  <X size={18} aria-hidden />
                </button>
              )}
            </div>
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

/** A copy-to-clipboard button. */
export function CopyButton({ text, label = 'Copy', className = '' }: { text: string; label?: string; className?: string }) {
  const [done, setDone] = useState(false)
  return (
    <button
      type="button"
      onClick={() =>
        navigator.clipboard?.writeText(text).then(
          () => {
            setDone(true)
            setTimeout(() => setDone(false), 1600)
          },
          () => undefined,
        )
      }
      className={`inline-flex min-h-10 shrink-0 items-center justify-center gap-2 rounded-btn border px-3 font-mono text-[12px] transition-colors ${done ? 'border-success-line text-green' : 'border-line-strong text-ink-2 hover:border-gold hover:text-ink'} ${className}`}
      aria-live="polite"
    >
      {done ? 'Copied' : label}
    </button>
  )
}
