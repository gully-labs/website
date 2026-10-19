import { useState, type FormEvent } from 'react'
import { CheckCircle2, ChevronDown, Send } from 'lucide-react'
import { track } from '../../lib/track'
import { btnGold } from '../../components/ui'
import type { ChainsConfig, Choice } from './useChains'

/* The Gully Chains waitlist (POST /api/chains/waitlist, server/chains-waitlist.mjs). Same shape as the contact
   form: validate here for a fast answer, the server validates again. The hidden `website` field is the honeypot. */

const fieldLabel = 'font-mono text-[11px] tracking-[1px] text-dim'
const input = 'min-h-11 rounded-input border border-line-strong bg-bg px-3 py-2 text-[14px] text-ink outline-none transition-colors focus:border-gold focus-visible:outline-none'

interface Form {
  project: string
  contact: string
  useCase: string
  scale: string
  gasToken: string
  da: string
  wantsAa: string
  wantsDeepcore: string
  notes: string
  website: string
}
const empty: Form = { project: '', contact: '', useCase: '', scale: '', gasToken: '', da: '', wantsAa: '', wantsDeepcore: '', notes: '', website: '' }
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/
const TELEGRAM_RE = /^@?[A-Za-z][A-Za-z0-9_]{4,31}$/

function Select({ label, name, value, onChange, options }: { label: string; name: string; value: string; onChange: (v: string) => void; options: Choice[] }) {
  return (
    <label className="flex flex-col gap-1">
      <span className={fieldLabel}>{label}</span>
      <select name={name} value={value} onChange={(e) => onChange(e.target.value)} className={input}>
        <option value="" disabled>
          Optional
        </option>
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
    </label>
  )
}

function Segmented({ label, name, value, onChange, options }: { label: string; name: string; value: string; onChange: (v: string) => void; options: Choice[] }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-col gap-2">
      <span className={fieldLabel}>{label}</span>
      <div className="flex flex-wrap gap-2">
        {options.map(([v, l]) => (
          <label key={v} className={`inline-flex min-h-11 cursor-pointer items-center rounded-full border px-4 text-[14px] transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-gold ${value === v ? 'border-gold bg-[rgba(217,181,99,.1)] text-gold' : 'border-line-strong text-ink-2 hover:border-line-hover'}`}>
            <input type="radio" name={name} value={v} checked={value === v} onChange={() => onChange(v)} className="sr-only" />
            {l}
          </label>
        ))}
      </div>
    </div>
  )
}

const YES_NO: Choice[] = [['yes', 'Yes'], ['no', 'No']]

export function Waitlist({ cfg }: { cfg: ChainsConfig }) {
  const [f, setF] = useState<Form>(empty)
  const [error, setError] = useState('')
  const [sending, setSending] = useState(false)
  const [done, setDone] = useState<null | { already: boolean }>(null)
  const set = (k: keyof Form) => (v: string) => (setF((x) => ({ ...x, [k]: v })), setError(''))

  async function submit(e: FormEvent) {
    e.preventDefault()
    const contact = f.contact.trim()
    if (!f.project.trim()) return setError('Please tell us the project name.')
    if (!EMAIL_RE.test(contact) && !TELEGRAM_RE.test(contact)) return setError('Please give an email or a Telegram handle (like @yourname).')
    setSending(true)
    try {
      const res = await fetch('/api/chains/waitlist', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'gully' }, body: JSON.stringify(f) })
      const d = (await res.json().catch(() => null)) as { error?: string; alreadyOnList?: boolean } | null
      if (!res.ok) throw new Error(d?.error ?? 'Something went wrong. Please try again.')
      // Choices only, never the name, contact or notes.
      track('chains-waitlist', { useCase: f.useCase, scale: f.scale, gasToken: f.gasToken, da: f.da, aa: f.wantsAa, deepcore: f.wantsDeepcore })
      setDone({ already: !!d?.alreadyOnList })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.')
    } finally {
      setSending(false)
    }
  }

  if (done)
    return (
      <div role="status" data-testid="chains-waitlist-done" className="flex flex-col items-start gap-3 rounded-card border border-gold-line bg-surface p-7">
        <CheckCircle2 aria-hidden size={28} className="text-green" />
        <h3 className="m-0 font-display text-h4 font-bold uppercase">{done.already ? 'You are already on the list' : 'You are on the waitlist'}</h3>
        <p className="m-0 max-w-[560px] text-[15px] leading-[1.6] text-muted">Nothing is running yet. When the testnet opens we will write to you first, using the contact you gave.</p>
      </div>
    )

  return (
    <form onSubmit={submit} noValidate data-testid="chains-waitlist-form" className="relative flex flex-col gap-4 overflow-hidden rounded-card border border-line bg-card-token p-5 max-[600px]:p-4">
      <div className="grid grid-cols-2 gap-3 max-[600px]:grid-cols-1">
        <label className="flex flex-col gap-1">
          <span className={fieldLabel}>PROJECT NAME</span>
          <input name="project" autoComplete="organization" maxLength={80} value={f.project} onChange={(e) => set('project')(e.target.value)} placeholder="Your project" className={input} />
        </label>
        <label className="flex flex-col gap-1">
          <span className={fieldLabel}>EMAIL OR TELEGRAM</span>
          <input name="contact" autoComplete="email" maxLength={254} value={f.contact} onChange={(e) => set('contact')(e.target.value)} placeholder="you@project.xyz or @yourname" className={input} />
        </label>
        <Select label="USE CASE" name="useCase" value={f.useCase} onChange={set('useCase')} options={cfg.choices.useCase} />
        <Select label="EXPECTED TPS OR USERS" name="scale" value={f.scale} onChange={set('scale')} options={cfg.choices.scale} />
      </div>
      <details className="group rounded-btn border border-line" data-testid="chains-more-details">
        <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-4 text-[14px] font-medium [&::-webkit-details-marker]:hidden">
          <span>
            More details <span className="font-mono text-[11px] text-faint">OPTIONAL</span>
          </span>
          <ChevronDown aria-hidden size={16} className="text-gold transition-transform duration-200 group-open:rotate-180" />
        </summary>
        <div className="flex flex-col gap-4 border-t border-line p-4">
          <div className="grid grid-cols-2 gap-4 max-[600px]:grid-cols-1">
            <Segmented label="GAS TOKEN" name="gasToken" value={f.gasToken} onChange={set('gasToken')} options={cfg.choices.gasToken} />
            <Segmented label="DATA AVAILABILITY" name="da" value={f.da} onChange={set('da')} options={cfg.choices.da} />
            <Segmented label="ACCOUNT ABSTRACTION AND PAYMASTER?" name="wantsAa" value={f.wantsAa} onChange={set('wantsAa')} options={YES_NO} />
            <Segmented label="DEEPCORE LAUNCHPAD?" name="wantsDeepcore" value={f.wantsDeepcore} onChange={set('wantsDeepcore')} options={YES_NO} />
          </div>
          <label className="flex flex-col gap-1">
            <span className={fieldLabel}>NOTES</span>
            <textarea name="notes" rows={2} maxLength={2000} value={f.notes} onChange={(e) => set('notes')(e.target.value)} placeholder="Anything we should know: timing, tokens, partners." className={`${input} resize-y`} />
          </label>
        </div>
      </details>
      {/* Honeypot: people never see or fill this. */}
      <div aria-hidden className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
        <label>
          Website
          <input name="website" tabIndex={-1} autoComplete="off" value={f.website} onChange={(e) => set('website')(e.target.value)} />
        </label>
      </div>
      {error && (
        <p role="alert" className="m-0 text-[14px] text-error">
          {error}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <button type="submit" disabled={sending} className={`${btnGold} inline-flex min-h-12 items-center gap-2 px-7 text-[16px] disabled:opacity-60`}>
          <Send aria-hidden size={17} />
          {sending ? 'Sending…' : 'Join the waitlist'}
        </button>
        <span className="font-mono text-[12px] text-faint">No chain is running yet. {cfg.note}</span>
      </div>
    </form>
  )
}
