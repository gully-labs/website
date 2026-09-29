import { useEffect, useRef, useState, type FormEvent } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { budgets, serviceTypes, type ServiceType } from '../content/services'
import type { ContactForm } from './contactForm'
import { btnGold, btnOutline } from './ui'

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/
const EMAIL_ERROR = 'Please enter a valid email so we can reply.'
const TYPES_ERROR = 'Pick at least one thing you need.'
const SEND_ERROR = 'Something went wrong sending your enquiry. Please try again.'

const fieldLabel = 'font-mono text-[11px] tracking-[1px] text-dim'
const input =
  'rounded-input border bg-bg px-4 py-[14px] text-[15px] text-ink outline-none transition-colors focus:border-gold focus-visible:outline-none'

interface Props {
  open: boolean
  onClose: () => void
  form: ContactForm
  setForm: (update: (f: ContactForm) => ContactForm) => void
  sent: boolean
  setSent: (sent: boolean) => void
}

export function ContactModal({ open, onClose, form, setForm, sent, setSent }: Props) {
  const [error, setError] = useState('')
  const [sending, setSending] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)

  // Escape to close, Tab trapped inside the panel, focus restored on close.
  useEffect(() => {
    if (!open) return
    const previous = document.activeElement as HTMLElement | null
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') return onClose()
      if (e.key !== 'Tab' || !panelRef.current) return
      const items = panelRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input, textarea, [href], [tabindex]:not([tabindex="-1"])',
      )
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
    requestAnimationFrame(() => panelRef.current?.querySelector<HTMLElement>('input, button')?.focus())
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = overflow
      previous?.focus()
    }
  }, [open, onClose])

  const setField = <K extends keyof ContactForm>(key: K, value: ContactForm[K]) => {
    setForm((f) => ({ ...f, [key]: value }))
    setError('')
  }

  const toggleType = (t: ServiceType) =>
    setField('types', form.types.includes(t) ? form.types.filter((x) => x !== t) : [...form.types, t])

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!EMAIL_RE.test(form.email)) return setError(EMAIL_ERROR)
    if (!form.types.length) return setError(TYPES_ERROR)
    setSending(true)
    try {
      const res = await fetch('/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      if (!res.ok) throw new Error(String(res.status))
      setSent(true)
      setError('')
    } catch {
      setError(SEND_ERROR)
    } finally {
      setSending(false)
    }
  }

  const firstName = form.name.trim().split(' ')[0]

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="contact"
          onClick={onClose}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          className="fixed inset-0 z-100 flex items-center justify-center bg-[rgba(5,7,10,.78)] p-5 backdrop-blur-[6px]"
        >
          <motion.div
            ref={panelRef}
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="contact-title"
            initial={{ opacity: 0, y: 12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98 }}
            transition={{ duration: 0.22, ease: [0.2, 0.8, 0.2, 1] }}
            className="flex max-h-[calc(100vh-40px)] w-full max-w-[640px] flex-col gap-6 overflow-auto rounded-modal border border-line-strong bg-surface p-[clamp(24px,4cqw,40px)]"
          >
            <div className="flex items-start justify-between gap-4">
              <div className="flex flex-col gap-2">
                <span className="font-mono text-[12px] tracking-[1.5px] text-gold">START A PROJECT</span>
                <h2 id="contact-title" className="m-0 font-display text-[40px] leading-none font-extrabold uppercase">
                  Tell us what you're building
                </h2>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="size-11 flex-none rounded-btn border border-line-strong bg-transparent text-[20px] text-ink transition-colors hover:border-gold"
              >
                ×
              </button>
            </div>

            {!sent ? (
              <form onSubmit={submit} noValidate className="flex flex-col gap-5">
                <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,220px),1fr))] gap-4">
                  <label className="flex flex-col gap-2">
                    <span className={fieldLabel}>NAME</span>
                    <input
                      name="name"
                      autoComplete="name"
                      value={form.name}
                      onChange={(e) => setField('name', e.target.value)}
                      placeholder="Your name"
                      className={`${input} border-line-strong`}
                    />
                  </label>
                  <label className="flex flex-col gap-2">
                    <span className={fieldLabel}>EMAIL</span>
                    <input
                      name="email"
                      type="email"
                      autoComplete="email"
                      value={form.email}
                      onChange={(e) => setField('email', e.target.value)}
                      placeholder="you@project.xyz"
                      aria-invalid={error === EMAIL_ERROR}
                      className={`${input} ${error === EMAIL_ERROR ? 'border-error' : 'border-line-strong'}`}
                    />
                  </label>
                </div>

                <fieldset className="m-0 flex flex-col gap-[10px] border-0 p-0">
                  <legend className={`${fieldLabel} mb-[10px] p-0`}>WHAT DO YOU NEED?</legend>
                  <div className="flex flex-wrap gap-2">
                    {serviceTypes.map((t) => {
                      const on = form.types.includes(t)
                      return (
                        <button
                          key={t}
                          type="button"
                          aria-pressed={on}
                          onClick={() => toggleType(t)}
                          className={`min-h-11 rounded-full border px-[14px] py-[10px] text-[14px] transition-colors ${
                            on ? 'border-gold bg-gold text-bg' : 'border-line-strong bg-transparent text-ink-2 hover:border-line-hover'
                          }`}
                        >
                          {t}
                        </button>
                      )
                    })}
                  </div>
                </fieldset>

                <fieldset className="m-0 flex flex-col gap-[10px] border-0 p-0">
                  <legend className={`${fieldLabel} mb-[10px] p-0`}>BUDGET</legend>
                  <div className="grid grid-cols-[repeat(auto-fit,minmax(110px,1fr))] gap-1 rounded-input border border-line-strong bg-bg p-1">
                    {budgets.map((b) => {
                      const on = form.budget === b
                      return (
                        <button
                          key={b}
                          type="button"
                          aria-pressed={on}
                          onClick={() => setField('budget', b)}
                          className={`min-h-10 rounded-btn px-2 py-[10px] text-[14px] transition-colors ${
                            on ? 'bg-gold text-bg' : 'bg-transparent text-ink-2 hover:text-ink'
                          }`}
                        >
                          {b}
                        </button>
                      )
                    })}
                  </div>
                </fieldset>

                <label className="flex flex-col gap-2">
                  <span className={fieldLabel}>DETAILS</span>
                  <textarea
                    name="message"
                    rows={4}
                    value={form.message}
                    onChange={(e) => setField('message', e.target.value)}
                    placeholder="Chain, timeline, what exists today…"
                    className={`${input} resize-y border-line-strong`}
                  />
                </label>

                {error && (
                  <div role="alert" className="text-[14px] text-error">
                    {error}
                  </div>
                )}

                <button type="submit" disabled={sending} className={`${btnGold} p-4 text-[16px] disabled:opacity-70`}>
                  {sending ? 'Sending…' : 'Send enquiry'}
                </button>
                <span className="text-center text-[13px] text-faint">We reply within two business days.</span>
              </form>
            ) : (
              <div role="status" className="flex flex-col items-start gap-5 py-3">
                <div
                  aria-hidden
                  className="flex size-14 items-center justify-center rounded-full border border-green bg-success-bg text-[26px] text-green"
                >
                  ✓
                </div>
                <span className="text-[18px] leading-[1.55] text-ink-2">
                  Thanks{firstName ? `, ${firstName}` : ''}. Your enquiry is in, and we'll reply to {form.email} within
                  two business days.
                </span>
                <button type="button" onClick={onClose} className={`${btnOutline} px-[22px] py-[14px] text-[15px]`}>
                  Close
                </button>
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
