import { Check, FolderKanban, Loader2, Send, Wrench } from 'lucide-react'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { toastError, toastSuccess } from '../../components/ui/toast'
import { BUDGETS, SERVICES } from '../../terminal/catalog'
import { ExtLink } from './ExtLink'
import { type Account } from './api'
import { usePortal } from './portal'
import { ServiceHeader } from './services/ServiceHeader'
import { input, mono, panel, panelTitle, pillGold, pillLine, pillSm, rise } from './styles'

/* Development services (app.gullylabs.xyz/#services): Gully Labs is "Web3 & DeFi Development". This page is where
   an account asks for a build or a quote and, later, follows its projects.
     Your projects    there is no project backend yet: an honest empty state that says what will show here (scope,
                      milestones, invoices through Gully Pay) and how a project starts. Not a waitlist.
     Request a build  the same intake the website's /services page uses (POST /api/contact: name, email, one
                      service type, budget, message; the operators' Telegram and the admin inbox get it), prefilled
                      from the profile, with a toast and a "sent" card. The honeypot field is never shown.
     What we build    the services catalogue (src/terminal/catalog.ts SERVICES), each row preselecting the form. */

const SITE_SERVICES = 'https://gullylabs.xyz/services'
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

type Sent = { type: string; budget: string; email: string }

function RequestForm({ account, type, setType }: { account: Account; type: string; setType: (t: string) => void }) {
  const { me } = usePortal()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [budget, setBudget] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState<Sent | null>(null)
  const filled = useRef(false)
  // Prefill once from the profile (the person can still change both).
  useEffect(() => {
    if (filled.current || !me) return
    filled.current = true
    setName(me.profile.displayName ?? me.profile.ens ?? '')
    setEmail(me.profile.email ?? '')
  }, [me])

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const hp = (e.currentTarget.elements.namedItem('website') as HTMLInputElement | null)?.value ?? ''
    if (!EMAIL_RE.test(email.trim())) return toastError('An email address is needed', { detail: 'We answer by email; nothing else is sent to it.' })
    if (!type) return toastError('Pick what the project is about')
    setBusy(true)
    try {
      const r = await fetch('/api/contact', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: name.trim(), email: email.trim(), types: [type], budget, message: `${message.trim()}\n\n[from the app · workspace ${account.address}]`.trim(), website: hp, source: 'app' }) })
      const body = (await r.json().catch(() => null)) as { ok?: boolean; error?: string } | null
      if (!r.ok || !body?.ok) return toastError('The request could not be sent', { detail: body?.error ?? `The server answered ${r.status}.` })
      setSent({ type, budget, email: email.trim() })
      toastSuccess('Request sent', { detail: 'We answer with questions or a first scope, by email.' })
    } catch {
      toastError('The request could not be sent', { detail: 'The server could not be reached. Check your connection and try again.' })
    } finally {
      setBusy(false)
    }
  }

  if (sent)
    return (
      <section className={`${panel} border-success-line gap-2`} style={rise(1)} aria-labelledby="req-sent" data-testid="request-sent">
        <div className="flex items-center gap-2">
          <span className="grid size-6 place-items-center rounded-full bg-green text-bg" aria-hidden>
            <Check size={14} />
          </span>
          <h2 id="req-sent" className={panelTitle}>
            Request sent
          </h2>
        </div>
        <p className="m-0 text-[14px] leading-[1.55] text-muted">
          {sent.type}
          {sent.budget ? ` · ${sent.budget}` : ''} · we write back to <span className="font-mono text-ink">{sent.email}</span> with questions or a first scope. The project appears under Your projects once it starts.
        </p>
        <button type="button" onClick={() => setSent(null)} className={`${pillLine} min-h-11 self-start`}>
          Send another
        </button>
      </section>
    )

  const field = 'flex flex-col gap-1 text-[13px] text-ink-2'
  return (
    <form onSubmit={submit} className={`${panel} gap-3`} style={rise(1)} aria-labelledby="req-title" data-testid="request-form">
      <div className="flex flex-col gap-[2px]">
        <h2 id="req-title" className={panelTitle}>
          Request a build or a quote
        </h2>
        <span className={mono}>a short brief is enough · we answer with questions or a first scope</span>
      </div>
      <div className="grid grid-cols-1 gap-3 min-[640px]:grid-cols-2">
        <label className={field}>
          Project
          <select name="type" required value={type} onChange={(e) => setType(e.target.value)} className={`${input} h-11`} data-testid="request-type">
            <option value="" disabled>
              What is it about?
            </option>
            {SERVICES.map((s) => (
              <option key={s.key} value={s.title}>
                {s.title}
              </option>
            ))}
            <option value="Other">Other</option>
          </select>
        </label>
        <label className={field}>
          Budget
          <select name="budget" value={budget} onChange={(e) => setBudget(e.target.value)} className={`${input} h-11`}>
            <option value="">Choose a range</option>
            {BUDGETS.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
        </label>
        <label className={field}>
          Name
          <input name="name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" maxLength={120} placeholder="Ada Lovelace" className={input} />
        </label>
        <label className={field}>
          Email
          <input name="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" maxLength={254} placeholder="you@team.xyz" className={input} data-testid="request-email" />
        </label>
      </div>
      <label className={field}>
        What are you building?
        <textarea name="message" value={message} onChange={(e) => setMessage(e.target.value)} maxLength={4000} rows={4} placeholder="The chain, product or integration, where it stands today, and when you need it." className={`${input} h-auto min-h-[110px] resize-y py-2`} data-testid="request-message" />
      </label>
      {/* Honeypot: a person never sees it; anything in it is a bot and the server drops it quietly. */}
      <input type="text" name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" className="absolute -left-[9999px] h-px w-px opacity-0" />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className={mono}>sent to the Gully Labs team · the email is used for the answer only</span>
        <button type="submit" disabled={busy} className={`${pillGold} min-h-11`} data-testid="request-send">
          {busy ? <Loader2 size={16} className="animate-spin" aria-hidden /> : <Send size={16} aria-hidden />} {busy ? 'Sending…' : 'Send the request'}
        </button>
      </div>
    </form>
  )
}

function Projects() {
  return (
    <section className={`${panel} flex-row flex-wrap items-center gap-4`} style={rise(0)} aria-labelledby="proj-title" data-testid="projects-empty">
      <img src="/brand/kit/owl/owl-laptop-400.webp" srcSet="/brand/kit/owl/owl-laptop-400.webp 1x, /brand/kit/owl/owl-laptop-800.webp 2x" alt="" width={52} height={120} decoding="async" className="block h-[120px] w-auto shrink-0" />
      <div className="flex min-w-0 flex-[1_1_260px] flex-col gap-1">
        <span className="flex items-center gap-2">
          <FolderKanban size={16} className="text-gold" aria-hidden />
          <h2 id="proj-title" className={panelTitle}>
            Your projects
          </h2>
        </span>
        <p className="m-0 text-[14px] leading-[1.55] text-muted">No projects yet. When a request becomes a project, its scope, milestones and invoices (paid through Gully Pay) show here. Until then your Gully Labs contact keeps you posted by email.</p>
      </div>
    </section>
  )
}

export function ServicesTab({ account }: { account: Account }) {
  const [type, setType] = useState('')
  const formRef = useRef<HTMLDivElement>(null)
  const pick = (title: string) => {
    setType(title)
    formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    formRef.current?.querySelector<HTMLSelectElement>('select[name="type"]')?.focus({ preventScroll: true })
  }
  return (
    <div className="flex flex-col gap-2" data-testid="services-page">
      <ServiceHeader icon={Wrench} title="Development services" eyebrow="Web3 & DeFi Development" desc="Chains, contracts, apps, payments, infrastructure, AI and games, built by the team that runs Gully Chain, Gully Pay, Gully RPC and Gully Security in production." status={{ tone: 'live', text: 'taking projects' }} page={{ href: SITE_SERVICES, label: 'Services page' }} />
      <Projects />
      <div ref={formRef} className="scroll-mt-20">
        <RequestForm account={account} type={type} setType={setType} />
      </div>
      <section aria-labelledby="what-title" className="flex flex-col gap-2" data-testid="services-catalog">
        <div className="flex flex-wrap items-baseline justify-between gap-2 px-1 pt-2">
          <h2 id="what-title" className={panelTitle}>
            What we build
          </h2>
          <span className={mono}>{SERVICES.length} practices · one team · each proved by a Gully product</span>
        </div>
        <ul className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(min(100%,280px),1fr))] gap-2 p-0">
          {SERVICES.map((s, i) => (
            <li key={s.key} className={`${panel} gap-2 p-3`} style={rise(i + 2)} data-service={s.key}>
              <b className="text-[14px] font-semibold text-ink">{s.title}</b>
              <span className="flex-1 text-[13px] leading-[1.45] text-muted">{s.desc}</span>
              <span className={mono}>{s.timeline}</span>
              <button type="button" onClick={() => pick(s.title)} className={`${pillSm} self-start`}>
                Request this
              </button>
            </li>
          ))}
        </ul>
        <p className={`${mono} px-1`}>
          Case studies and the process are on the{' '}
          <ExtLink href={SITE_SERVICES} className="inline-flex min-h-11 items-center text-gold underline-offset-4 hover:underline">
            services page
          </ExtLink>
          .
        </p>
      </section>
    </div>
  )
}
