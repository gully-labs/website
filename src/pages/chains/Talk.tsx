import { useId, useState, type FormEvent } from 'react'
import { CheckCircle2, MessageSquare, Send, X } from 'lucide-react'
import { SocialIcon } from '../../components/SocialIcon'
import { newTab } from '../../components/LayoutNav'
import { btnGold, btnOutline } from '../../components/ui'
import { track } from '../../lib/track'

/* "Talk to us": two ways to reach a person about a chain. "Message us" opens a small inline form that posts to
   POST /api/contact with the topic "Gully Chains" (the server tells the owner on Telegram at once, intake-notify.mjs).
   "Chat on Telegram" opens the Gully Labs bot, where the owner answers from their admin chat. */

export const TELEGRAM_URL = 'https://t.me/GullyLabsBot?start=chains'
const TOPIC = 'Gully Chains'
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/
const TELEGRAM_RE = /^@?[A-Za-z][A-Za-z0-9_]{4,31}$/

const label = 'font-mono text-[11px] tracking-[1px] text-dim'
const field = 'min-h-11 rounded-input border border-line-strong bg-bg px-3 py-2 text-[14px] text-ink outline-none transition-colors focus:border-gold focus-visible:outline-none'

export function Talk({ where, variant = 'card' }: { where: string; variant?: 'card' | 'row' }) {
  const id = useId()
  const [open, setOpen] = useState(false)
  const [f, setF] = useState({ name: '', contact: '', message: '' })
  const [error, setError] = useState('')
  const [sending, setSending] = useState(false)
  const [done, setDone] = useState(false)
  const set = (k: keyof typeof f) => (v: string) => (setF((x) => ({ ...x, [k]: v })), setError(''))

  async function submit(e: FormEvent) {
    e.preventDefault()
    const contact = f.contact.trim()
    const email = EMAIL_RE.test(contact)
    if (!email && !TELEGRAM_RE.test(contact)) return setError('Please give an email or a Telegram handle (like @yourname).')
    if (f.message.trim().length < 3) return setError('Please write a short message.')
    setSending(true)
    try {
      const res = await fetch('/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: f.name.trim(), ...(email ? { email: contact } : { telegram: contact }), message: f.message.trim(), types: [TOPIC], topic: TOPIC, budget: '' }),
      })
      if (!res.ok) throw new Error(String(res.status))
      track('chains-message', { where })
      setDone(true)
    } catch {
      setError('The message could not be sent. Please try again, or use Telegram.')
    } finally {
      setSending(false)
    }
  }

  const buttons = (
    <div className="flex flex-wrap gap-2">
      <button type="button" aria-expanded={open} aria-controls={`${id}-form`} onClick={() => setOpen((o) => !o)} data-testid={`message-us-${where}`} className={`${btnGold} inline-flex min-h-11 items-center gap-2 px-5 text-[15px]`}>
        <MessageSquare aria-hidden size={16} /> Message us
      </button>
      <a href={TELEGRAM_URL} {...newTab} onClick={() => track('cta-click', { cta: 'chains-telegram', page: '/chains', where })} data-testid={`telegram-chat-${where}`} className={`${btnOutline} inline-flex min-h-11 items-center gap-2 px-5 text-[15px]`}>
        <SocialIcon name="Telegram" size={16} /> Chat on Telegram
      </a>
    </div>
  )

  return (
    <div className={`rounded-card border border-gold-line bg-surface p-5 max-[600px]:p-4 ${variant === 'row' ? '' : 'flex flex-col gap-3'}`} data-testid={`talk-${where}`}>
      <div className={variant === 'row' ? 'flex flex-wrap items-center justify-between gap-x-6 gap-y-3' : 'flex flex-col gap-3'}>
        <div className="flex min-w-0 flex-col gap-1">
          <span className="font-display text-[20px] leading-none font-bold uppercase">Talk to us</span>
          <span className="text-[14px] leading-[1.5] text-muted">A question about a chain for your project? A person reads every message.</span>
        </div>
        {buttons}
      </div>
      {open && !done && (
        <form id={`${id}-form`} onSubmit={submit} noValidate className="mt-3 grid grid-cols-2 gap-3 max-[600px]:grid-cols-1" data-testid={`message-form-${where}`}>
          <label className="flex flex-col gap-1">
            <span className={label}>NAME</span>
            <input name="name" autoComplete="name" maxLength={120} value={f.name} onChange={(e) => set('name')(e.target.value)} placeholder="Your name" className={field} />
          </label>
          <label className="flex flex-col gap-1">
            <span className={label}>EMAIL OR TELEGRAM</span>
            <input name="contact" autoComplete="email" maxLength={254} value={f.contact} onChange={(e) => set('contact')(e.target.value)} placeholder="you@project.xyz or @yourname" className={field} />
          </label>
          <label className="col-span-2 flex flex-col gap-1 max-[600px]:col-span-1">
            <span className={label}>MESSAGE</span>
            <textarea name="message" rows={3} maxLength={2000} value={f.message} onChange={(e) => set('message')(e.target.value)} placeholder="What are you building?" className={`${field} resize-y`} />
          </label>
          {error && (
            <p role="alert" className="col-span-2 m-0 text-[13px] text-error max-[600px]:col-span-1">
              {error}
            </p>
          )}
          <div className="col-span-2 flex flex-wrap items-center gap-3 max-[600px]:col-span-1">
            <button type="submit" disabled={sending} className={`${btnGold} inline-flex min-h-11 items-center gap-2 px-5 text-[15px] disabled:opacity-60`}>
              <Send aria-hidden size={15} /> {sending ? 'Sending…' : 'Send message'}
            </button>
            <button type="button" onClick={() => setOpen(false)} className="inline-flex min-h-11 items-center gap-1 text-[14px] text-muted hover:text-ink">
              <X aria-hidden size={14} /> Close
            </button>
          </div>
        </form>
      )}
      {done && (
        <p role="status" data-testid={`message-done-${where}`} className="m-0 mt-3 flex items-start gap-2 text-[14px] leading-[1.5] text-ink-2">
          <CheckCircle2 aria-hidden size={18} className="mt-[1px] flex-none text-green" />
          Message sent. We will write back to the contact you gave.
        </p>
      )}
    </div>
  )
}
