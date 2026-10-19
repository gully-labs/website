import { useState, type FormEvent, type ReactNode } from 'react'
import { useNavigate } from 'react-router'
import { Check } from 'lucide-react'
import { Segmented } from '../../components/ui/Segmented'
import { btnGold } from '../../components/ui'
import { SCAN_APP_URL } from '../security/shared'
import type { Chain } from '../../content/ecosystem'

/* The two forms on /partners.
   A "List your launchpad" -> POST /api/ecosystem/submissions (server/ecosystem.mjs). It is stored for review:
     nothing is ever listed automatically. The client checks the same formats the server does, so most
     mistakes are caught before sending; the server's answer is still the one that counts.
   B "Get your token mapped or scanned" -> the Holder Map page, the Security scan in the app, or a contact
     request (POST /api/contact, the contact form's route). */

const EMAIL_RE = /^[^@\s<>"']{1,64}@[^@\s<>"']{1,190}\.[^@\s<>"']{2,24}$/
const TELEGRAM_RE = /^(@[A-Za-z][A-Za-z0-9_]{4,31}|https:\/\/t\.me\/[A-Za-z][A-Za-z0-9_]{4,31})$/
const NAME_RE = /^[\p{L}\p{N}][\p{L}\p{N} .&'_+!:-]{1,59}$/u
const EVM_RE = /^0x[0-9a-fA-F]{40}$/
const SOL_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/
const PARAM = '[A-Za-z0-9_\\[\\]]{1,40}(?: indexed)?(?: [A-Za-z_][A-Za-z0-9_]{0,31})?'
const EVENT_RE = new RegExp(`^[A-Za-z_][A-Za-z0-9_]{0,63}\\((?:${PARAM})?(?:, ?${PARAM}){0,15}\\)$`)
const TOPIC_RE = /^0x[0-9a-fA-F]{64}$/

function publicHttps(v: string) {
  try {
    const u = new URL(v.trim())
    const h = u.hostname.toLowerCase()
    return u.protocol === 'https:' && !u.username && !u.password && h.includes('.') && h !== 'localhost' && !/^\d+\.\d+\.\d+\.\d+$/.test(h) && !h.startsWith('[') && !/\s/.test(v.trim())
  } catch {
    return false
  }
}

const label = 'font-mono text-[11px] tracking-[1px] text-dim'
const input = 'min-h-11 w-full rounded-input border bg-bg px-3 py-2 text-[15px] text-ink outline-none transition-colors focus:border-gold'
const box = 'card card-pad flex min-w-0 scroll-mt-24 flex-col gap-4'

function Field({ name, title, error, hint, children }: { name: string; title: string; error?: string; hint?: string; children: ReactNode }) {
  return (
    <label className="flex min-w-0 flex-col gap-1.5" htmlFor={`f-${name}`}>
      <span className={label}>{title}</span>
      {children}
      {error ? (
        <span role="alert" className="text-[12px] text-error">
          {error}
        </span>
      ) : hint ? (
        <span className="text-[12px] text-faint">{hint}</span>
      ) : null}
    </label>
  )
}

const cls = (bad: boolean) => `${input} ${bad ? 'border-error' : 'border-line-strong'}`

/** Chain chips (one or more); `multi` false makes it a single choice. */
function ChainPicker({ chains, value, onChange, multi, label: aria }: { chains: Chain[]; value: string[]; onChange: (v: string[]) => void; multi: boolean; label: string }) {
  return (
    <div role="group" aria-label={aria} className="flex flex-wrap gap-2">
      {chains.map((c) => {
        const on = value.includes(c.key)
        return (
          <button
            key={c.key}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(multi ? (on ? value.filter((x) => x !== c.key) : [...value, c.key]) : [c.key])}
            className={`min-h-11 rounded-full border px-4 font-mono text-[12px] transition-colors ${on ? 'border-gold bg-gold text-bg' : 'border-line-strong bg-transparent text-muted hover:border-gold hover:text-ink'}`}
          >
            {c.name}
          </button>
        )
      })}
    </div>
  )
}

/* ------------------------------------------------------------------ Form A --- */

type Errors = Partial<Record<'name' | 'url' | 'contact' | 'chains' | 'factory' | 'eventSignature' | 'lookupUrl' | 'note', string>>

export function ListLaunchpadForm({ chains }: { chains: Chain[] }) {
  const [v, setV] = useState({ name: '', url: '', contact: '', factory: '', eventSignature: '', lookupUrl: '', note: '', company: '' })
  const [picked, setPicked] = useState<string[]>([])
  const [how, setHow] = useState<'factory' | 'lookup'>('factory')
  const [errors, setErrors] = useState<Errors>({})
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')
  const [serverError, setServerError] = useState('')
  const set = (k: keyof typeof v, val: string) => {
    setV((p) => ({ ...p, [k]: val }))
    setErrors((p) => ({ ...p, [k]: undefined }))
    if (state === 'error') setState('idle')
  }

  function check(): Errors {
    const e: Errors = {}
    if (!NAME_RE.test(v.name.trim())) e.name = "2 to 60 letters, numbers, spaces and . & ' _ + ! : - only."
    if (!publicHttps(v.url)) e.url = 'A public https:// address.'
    const c = v.contact.trim()
    if (!(EMAIL_RE.test(c) || TELEGRAM_RE.test(c))) e.contact = 'An email, or a Telegram @handle or t.me link.'
    if (!picked.length) e.chains = 'Pick at least one chain.'
    if (picked.includes('solana') && picked.length > 1) e.chains = 'Submit a Solana launchpad separately from EVM chains.'
    if (how === 'factory') {
      const onlySol = picked.length > 0 && picked.every((x) => x === 'solana')
      if (!(onlySol ? SOL_RE : EVM_RE).test(v.factory.trim())) e.factory = onlySol ? 'A Solana program address (base58).' : 'A 0x address with 40 hex characters.'
      const ev = v.eventSignature.trim()
      if (!(EVENT_RE.test(ev) || TOPIC_RE.test(ev))) e.eventSignature = 'A signature such as TokenCreated(address,address,string), or its 0x topic hash.'
    } else if (!publicHttps(v.lookupUrl)) e.lookupUrl = 'A public https:// address.'
    if (v.note.length > 500) e.note = 'At most 500 characters.'
    return e
  }

  async function submit(ev: FormEvent) {
    ev.preventDefault()
    const e = check()
    setErrors(e)
    if (Object.keys(e).length) return
    setState('sending')
    setServerError('')
    try {
      const body = { name: v.name.trim(), url: v.url.trim(), contact: v.contact.trim(), chains: picked, note: v.note.trim(), company: v.company, ...(how === 'factory' ? { factory: v.factory.trim(), eventSignature: v.eventSignature.trim() } : { lookupUrl: v.lookupUrl.trim() }) }
      const r = await fetch('/api/ecosystem/submissions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const d = await r.json().catch(() => null)
      if (r.ok) return setState('sent')
      if (d?.field) setErrors({ [d.field]: d.error })
      setServerError(r.status === 429 ? 'Too many submissions from this address. Try again later.' : (d?.error ?? 'Something went wrong. Please try again.'))
      setState('error')
    } catch {
      setServerError('The server could not be reached. Please try again.')
      setState('error')
    }
  }

  if (state === 'sent')
    return (
      <section id="list-your-launchpad" aria-labelledby="fa-t" className={box}>
        <h3 id="fa-t" className="heading-3">
          List your launchpad
        </h3>
        <p role="status" className="m-0 flex items-start gap-2 rounded-input border border-success-line bg-success-bg px-4 py-3 text-[14px] text-ink-2">
          <Check size={18} aria-hidden className="mt-0.5 flex-none text-green" />
          Received. We read every submission by hand and write to the contact you gave. Nothing is listed until we have checked it.
        </p>
      </section>
    )

  return (
    <section id="list-your-launchpad" aria-labelledby="fa-t" className={box}>
      <div className="flex flex-col gap-1">
        <h3 id="fa-t" className="heading-3">
          List your launchpad
        </h3>
        <p className="m-0 text-[14px] text-muted">So the Holder Map can find your new tokens. A person reviews it; there is no automatic listing.</p>
      </div>
      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,220px),1fr))] gap-4">
          <Field name="name" title="NAME" error={errors.name}>
            <input id="f-name" name="name" autoComplete="organization" value={v.name} onChange={(e) => set('name', e.target.value)} aria-invalid={!!errors.name} maxLength={60} className={cls(!!errors.name)} />
          </Field>
          <Field name="url" title="WEBSITE" error={errors.url}>
            <input id="f-url" name="url" inputMode="url" value={v.url} onChange={(e) => set('url', e.target.value)} placeholder="https://" aria-invalid={!!errors.url} maxLength={300} className={cls(!!errors.url)} />
          </Field>
          <Field name="contact" title="CONTACT" error={errors.contact} hint="Email or Telegram">
            <input id="f-contact" name="contact" value={v.contact} onChange={(e) => set('contact', e.target.value)} placeholder="you@pad.xyz or @handle" aria-invalid={!!errors.contact} maxLength={120} className={cls(!!errors.contact)} />
          </Field>
        </div>
        <div className="flex flex-col gap-1.5">
          <span className={label}>CHAINS</span>
          <ChainPicker chains={chains} value={picked} onChange={(c) => { setPicked(c); setErrors((p) => ({ ...p, chains: undefined })) }} multi label="Chains your launchpad is on" />
          {errors.chains && (
            <span role="alert" className="text-[12px] text-error">
              {errors.chains}
            </span>
          )}
        </div>
        <div className="flex flex-col gap-3">
          <Segmented<'factory' | 'lookup'> label="How can we find your tokens?" value={how} onChange={(h) => { setHow(h); setErrors({}) }} options={[{ id: 'factory', label: 'FACTORY + EVENT' }, { id: 'lookup', label: 'TOKEN-LOOKUP API' }]} />
          {how === 'factory' ? (
            <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,260px),1fr))] gap-4">
              <Field name="factory" title="FACTORY OR HOOK ADDRESS" error={errors.factory}>
                <input id="f-factory" name="factory" value={v.factory} onChange={(e) => set('factory', e.target.value)} placeholder="0x…" spellCheck={false} aria-invalid={!!errors.factory} maxLength={64} className={`${cls(!!errors.factory)} font-mono`} />
              </Field>
              <Field name="eventSignature" title="CREATION EVENT" error={errors.eventSignature} hint="Its signature or topic hash">
                <input id="f-eventSignature" name="eventSignature" value={v.eventSignature} onChange={(e) => set('eventSignature', e.target.value)} placeholder="TokenCreated(address,address)" spellCheck={false} aria-invalid={!!errors.eventSignature} maxLength={200} className={`${cls(!!errors.eventSignature)} font-mono`} />
              </Field>
            </div>
          ) : (
            <Field name="lookupUrl" title="TOKEN-LOOKUP API URL" error={errors.lookupUrl} hint="An https:// endpoint that answers for a token address">
              <input id="f-lookupUrl" name="lookupUrl" inputMode="url" value={v.lookupUrl} onChange={(e) => set('lookupUrl', e.target.value)} placeholder="https://api.yourpad.xyz/token/{address}" spellCheck={false} aria-invalid={!!errors.lookupUrl} maxLength={300} className={`${cls(!!errors.lookupUrl)} font-mono`} />
            </Field>
          )}
        </div>
        <Field name="note" title="ANYTHING ELSE (OPTIONAL)" error={errors.note}>
          <textarea id="f-note" name="note" rows={2} value={v.note} onChange={(e) => set('note', e.target.value)} maxLength={500} className={`${cls(!!errors.note)} resize-y`} />
        </Field>
        {/* Honeypot: invisible to people and to assistive tech; a bot that fills it is silently dropped. */}
        <div aria-hidden className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
          <label>
            Company
            <input name="company" tabIndex={-1} autoComplete="off" value={v.company} onChange={(e) => set('company', e.target.value)} />
          </label>
        </div>
        {state === 'error' && (
          <p role="alert" className="m-0 text-[13px] text-error">
            {serverError}
          </p>
        )}
        <div>
          <button type="submit" disabled={state === 'sending'} className={`${btnGold} min-h-11 px-6 text-[14px] disabled:opacity-60`}>
            {state === 'sending' ? 'Sending…' : 'Submit for review'}
          </button>
        </div>
      </form>
    </section>
  )
}

/* ------------------------------------------------------------------ Form B --- */

type Route = 'map' | 'scan' | 'contact'

export function MapTokenForm({ chains }: { chains: Chain[] }) {
  const nav = useNavigate()
  const [chain, setChain] = useState<string[]>([])
  const [token, setToken] = useState('')
  const [route, setRoute] = useState<Route>('map')
  const [email, setEmail] = useState('')
  const [err, setErr] = useState('')
  const [state, setState] = useState<'idle' | 'sending' | 'sent'>('idle')

  async function go(ev: FormEvent) {
    ev.preventDefault()
    const t = token.trim()
    const solana = chain[0] === 'solana'
    if (!chain.length) return setErr('Pick a chain.')
    if (!(solana ? SOL_RE : EVM_RE).test(t)) return setErr(solana ? 'A Solana token address (base58).' : 'A token address: 0x and 40 hex characters.')
    if (route === 'map') return nav(`/holders/${chain[0]}/${t}`)
    if (route === 'scan') {
      window.open(SCAN_APP_URL, '_blank', 'noopener,noreferrer')
      return setErr('')
    }
    if (!EMAIL_RE.test(email.trim())) return setErr('An email so we can reply.')
    setState('sending')
    try {
      const name = chains.find((c) => c.key === chain[0])?.name ?? chain[0]
      const r = await fetch('/api/contact', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: '', email: email.trim(), types: ['Other'], budget: '', message: `Token mapping request. Chain: ${name}. Token: ${t}.` }) })
      if (!r.ok) throw new Error(String(r.status))
      setErr('')
      setState('sent')
    } catch {
      setState('idle')
      setErr('Something went wrong sending your request. Please try again.')
    }
  }

  return (
    <section id="map-your-token" aria-labelledby="fb-t" className={box}>
      <div className="flex flex-col gap-1">
        <h3 id="fb-t" className="heading-3">
          Get your token mapped or scanned
        </h3>
        <p className="m-0 text-[14px] text-muted">Pick a chain and paste the token. The map opens straight away; a scan runs in the app.</p>
      </div>
      {state === 'sent' ? (
        <p role="status" className="m-0 flex items-start gap-2 rounded-input border border-success-line bg-success-bg px-4 py-3 text-[14px] text-ink-2">
          <Check size={18} aria-hidden className="mt-0.5 flex-none text-green" />
          Request received. We will write to {email.trim()}.
        </p>
      ) : (
        <form onSubmit={go} noValidate className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <span className={label}>CHAIN</span>
            <ChainPicker chains={chains} value={chain} onChange={(c) => { setChain(c); setErr('') }} multi={false} label="Chain of the token" />
          </div>
          <Field name="token" title="TOKEN ADDRESS">
            <input id="f-token" name="token" value={token} onChange={(e) => { setToken(e.target.value); setErr('') }} placeholder={chain[0] === 'solana' ? 'Mint address' : '0x…'} spellCheck={false} maxLength={64} className={`${cls(!!err && !token.trim())} font-mono`} />
          </Field>
          <div className="flex flex-col gap-1.5">
            <span className={label}>WHAT DO YOU NEED?</span>
            <Segmented<Route> label="What you need" value={route} onChange={(r) => { setRoute(r); setErr('') }} options={[{ id: 'map', label: 'HOLDER MAP' }, { id: 'scan', label: 'SECURITY SCAN' }, { id: 'contact', label: 'ASK US' }]} className="max-w-full overflow-x-auto" />
          </div>
          {route === 'contact' && (
            <Field name="email" title="EMAIL">
              <input id="f-email" name="email" type="email" autoComplete="email" value={email} onChange={(e) => { setEmail(e.target.value); setErr('') }} className={cls(false)} />
            </Field>
          )}
          {err && (
            <p role="alert" className="m-0 text-[13px] text-error">
              {err}
            </p>
          )}
          <div>
            <button type="submit" disabled={state === 'sending'} className={`${btnGold} min-h-11 px-6 text-[14px] disabled:opacity-60`}>
              {route === 'map' ? 'Open the Holder Map' : route === 'scan' ? 'Open the scan in the app' : state === 'sending' ? 'Sending…' : 'Send request'}
            </button>
          </div>
        </form>
      )}
    </section>
  )
}
