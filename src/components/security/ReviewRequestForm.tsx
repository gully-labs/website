import { CheckCircle2, Send, ShieldCheck, Users } from 'lucide-react'
import { useState, type FormEvent, type ReactNode } from 'react'
import type { ScanChain } from './types'

/* "Request a review": asks Gully Labs for a quote for a human Security Review. A full Audit is not offered
   yet, so it is not offered as a choice here until server/plans.mjs SECURITY.audit.available is true. Posts to
   POST /api/security/review-requests; the request is stored, lands in the admin inbox and pings the
   operators' Telegram chat when one is set. Nothing is booked or paid here: we reply with a quote. Used on
   /security and in the app's Security tab (`source="app"`). */

const input = 'h-11 w-full rounded-input border border-line-strong bg-bg px-3 text-[14px] text-ink outline-none transition-colors focus:border-gold'
const lbl = 'flex min-w-0 flex-col gap-1 text-[12px] text-dim'

function Field({ label, children, wide = false, hint }: { label: string; children: ReactNode; wide?: boolean; hint?: string }) {
  return (
    <label className={`${lbl} ${wide ? 'col-span-full' : ''}`}>
      <span>
        {label}
        {hint && <span className="ml-2 font-mono text-[11px] text-faint">{hint}</span>}
      </span>
      {children}
    </label>
  )
}

export function ReviewRequestForm({ source = 'site', chains, auditAvailable = false }: { source?: 'site' | 'app'; chains?: ScanChain[]; auditAvailable?: boolean }) {
  const [tier, setTier] = useState<'review' | 'audit'>('review')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    const body = Object.fromEntries([...fd.entries()].map(([k, v]) => [k, String(v)]))
    setBusy(true)
    setErr(null)
    try {
      const r = await fetch('/api/security/review-requests', { method: 'POST', headers: { 'content-type': 'application/json', 'x-requested-with': 'gully' }, body: JSON.stringify({ ...body, tier, source }) })
      const d = await r.json().catch(() => null)
      if (!r.ok) setErr(d?.error ?? `The server answered ${r.status}.`)
      else setDone(d?.request?.id ?? 'sent')
    } catch {
      setErr('The server could not be reached. Check your connection and try again.')
    } finally {
      setBusy(false)
    }
  }

  if (done)
    return (
      <div className="flex flex-col items-start gap-3 rounded-[14px] border border-success-line bg-success-bg px-5 py-5" role="status" data-testid="review-sent">
        <CheckCircle2 size={22} className="text-green" aria-hidden />
        <span className="text-[16px] font-semibold text-ink">Request received.</span>
        <span className="text-[14px] leading-[1.6] text-ink-2">We read every request and reply by email with questions or a quote. Reference: <code className="font-mono text-[12px]">{done}</code></span>
      </div>
    )

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" aria-label="Request a security review" data-testid="review-form">
      {!auditAvailable && (
        <p className="m-0 flex items-start gap-3 rounded-[12px] border border-gold bg-gold/[.07] px-3 py-[10px]">
          <Users size={16} aria-hidden className="mt-[2px] flex-none text-gold" />
          <span className="flex flex-col">
            <span className="text-[14px] font-semibold text-ink">Security Review, quoted on request</span>
            <span className="text-[12px] text-muted">People read your code and report. A full Audit is not offered yet.</span>
          </span>
        </p>
      )}
      <div role="radiogroup" aria-label="What you are asking for" className="flex flex-wrap gap-2" hidden={!auditAvailable}>
        {(
          [
            ['review', 'Security Review', 'People read your code and report; quoted per project', <Users key="u" size={16} aria-hidden />],
            ['audit', 'Audit', 'The premium tier, quoted per project', <ShieldCheck key="s" size={16} aria-hidden />],
          ] as const
        ).map(([id, name, text, icon]) => (
          <button key={id} type="button" role="radio" aria-checked={tier === id} onClick={() => setTier(id)} className={`flex min-h-11 flex-[1_1_220px] items-start gap-3 rounded-[12px] border px-3 py-[10px] text-left transition-colors ${tier === id ? 'border-gold bg-gold/[.07]' : 'border-line-strong hover:border-line-hover'}`}>
            <span className={tier === id ? 'text-gold' : 'text-faint'}>{icon}</span>
            <span className="flex flex-col">
              <span className="text-[14px] font-semibold text-ink">{name}</span>
              <span className="text-[12px] text-muted">{text}</span>
            </span>
          </button>
        ))}
      </div>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,220px),1fr))] gap-3">
        <Field label="Your name">
          <input name="name" required minLength={2} maxLength={120} autoComplete="name" className={input} />
        </Field>
        <Field label="Email">
          <input name="email" type="email" required maxLength={254} autoComplete="email" className={input} />
        </Field>
        <Field label="Project">
          <input name="project" required minLength={2} maxLength={120} className={input} />
        </Field>
        <Field label="Company" hint="optional">
          <input name="company" maxLength={120} autoComplete="organization" className={input} />
        </Field>
        <Field label="What should be reviewed" wide hint="contracts, lines of code, what changed">
          <textarea name="scope" required minLength={20} maxLength={4000} rows={3} className={`${input} h-auto min-h-[84px] py-2`} />
        </Field>
        <Field label="Repository" hint="optional">
          <input name="repo" maxLength={200} placeholder="owner/name or URL" className={input} />
        </Field>
        <Field label="Deployed contract" hint="optional">
          <input name="address" maxLength={42} placeholder="0x…" pattern="^0x[0-9a-fA-F]{40}$" className={`${input} font-mono`} />
        </Field>
        {chains && chains.length > 0 && (
          <Field label="Chain" hint="optional">
            <select name="chain" defaultValue="" className={input}>
              <option value="">—</option>
              {chains.map((c) => (
                <option key={c.key} value={c.key}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
        )}
        <Field label="Timeline" hint="optional">
          <input name="timeline" maxLength={80} placeholder="e.g. before mainnet in March" className={input} />
        </Field>
      </div>
      {/* A field people never see; bots fill it. */}
      <input name="website" tabIndex={-1} autoComplete="off" aria-hidden className="absolute -left-[9999px] h-px w-px opacity-0" />
      {err && (
        <p className="m-0 rounded-input border border-error-line px-3 py-2 text-[13px] text-error" role="alert">
          {err}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={busy} className="inline-flex min-h-11 items-center gap-2 rounded-full bg-gold px-5 text-[14px] font-semibold text-bg transition-colors hover:bg-gold-hover disabled:opacity-60">
          <Send size={15} aria-hidden /> {busy ? 'Sending…' : 'Ask for a quote'}
        </button>
        <span className="text-[12px] leading-[1.5] text-faint">No payment now. We reply by email; your details are used for this request only.</span>
      </div>
    </form>
  )
}
