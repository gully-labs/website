/* Landing v3 sections shared by the landing, /services and /products: the product logo wall, services, case
   studies, process and the contact intake form. */
import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { ArrowRight, ArrowUpRight, Check, Send } from 'lucide-react'
import { chainHead, useLive } from '../console/live'
import { BUDGETS, PRODUCTS, productBySlug, SERVICES, type ProductDef, type ServiceKey } from './catalog'
import { A, Dot, fmtCompact, Logo, productHref, stateOf, useHubProducts } from './kit'

const SERVICE_EVENT = 'gt:service'
/** "Start a project" on a service: preselect it in the form and scroll there. */
export function startProject(key: ServiceKey | 'other') {
  window.dispatchEvent(new CustomEvent(SERVICE_EVENT, { detail: key }))
  document.getElementById('contact')?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' })
}

/* ---------------------------------------------------------------- logo wall ---- */
export function LogoWall({ items = PRODUCTS }: { items?: ProductDef[] }) {
  const { hub } = useLive()
  return (
    <ul className="gt-wall" data-testid="logo-wall">
      {items.map((p, i) => {
        const s = stateOf(hub, p.hub)
        return (
          <li key={p.slug} className="rv" style={{ transitionDelay: `${(i % 4) * 50}ms` }}>
            <A href={productHref(p)} className="gt-cell" ariaLabel={`${p.name}: ${p.short}`}>
              <Logo def={p.logo} name={p.name} decorative />
              <span className="gt-line">{p.short}</span>
              <span className="gt-meta">
                <Dot s={s} />
                <span className="gt-grp">{p.group === 'chain' ? 'on Gully Chain' : 'Gully Labs'}</span>
                <ArrowRight className="gt-ic go" aria-hidden />
              </span>
            </A>
          </li>
        )
      })}
    </ul>
  )
}

/* ---------------------------------------------------------------- services ---- */
export function ServicesList({ compact = false }: { compact?: boolean }) {
  return (
    <ol className={`gt-services ${compact ? 'compact' : ''}`}>
      {SERVICES.map((s, i) => {
        const proof = productBySlug(s.proof)
        return (
          <li key={s.key} className="rv" id={`service-${s.key}`}>
            <span className="gt-n num">{String(i + 1).padStart(2, '0')}</span>
            <div className="gt-sv">
              <h3>{s.title}</h3>
              <p>{s.desc}</p>
              {!compact && (
                <ul className="gt-dl" aria-label="Deliverables">
                  {s.deliverables.map((d) => (
                    <li key={d}>
                      <Check className="gt-ic" aria-hidden />
                      {d}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <dl className="gt-svm">
              <div>
                <dt>Typical timeline</dt>
                <dd>{s.timeline}</dd>
              </div>
              {proof && (
                <div>
                  <dt>Proof</dt>
                  <dd>
                    <A href={productHref(proof)}>{proof.name}</A>
                  </dd>
                </div>
              )}
            </dl>
            <button type="button" className="gt-btn sec sm" onClick={() => startProject(s.key)}>
              Start a project
              <ArrowRight className="gt-ic" aria-hidden />
            </button>
          </li>
        )
      })}
    </ol>
  )
}

/* ---------------------------------------------------------------- case studies ---- */
export function CaseStudies() {
  const live = useLive()
  const hp = useHubProducts().data
  const { hub } = live
  const cases: { slug: string; title: string; built: string; services: string; metric: ReactNode; metricLabel: string }[] = [
    { slug: 'chain', title: 'Launching an L3', built: 'Orbit chain, explorer, faucet, indexer, two bridges and RPC, run end to end.', services: 'Chain launch · Infra · Contracts', metric: fmtCompact(chainHead(live)), metricLabel: 'Gully Chain testnet block' },
    { slug: 'pay', title: 'A payment gateway', built: 'x402 facilitator, hosted checkout and merchant webhooks, used by every Gully product.', services: 'Payments · Contracts · Apps', metric: hub?.x402 ? String(hub.x402.networks.length) : '—', metricLabel: 'x402 networks live' },
    { slug: 'quests', title: 'On-chain growth', built: 'A quest registry with verifiers and ETH reward pools, wired into Gully Street.', services: 'Launch & growth · Contracts', metric: hub?.quests ? String(hub.quests.completions ?? '—') : '—', metricLabel: 'quest completions' },
    { slug: 'holders', title: 'Data products', built: 'Holder bubble maps, clustering and deep checks across six chains.', services: 'Apps · Infra · AI', metric: hp?.holders ? fmtCompact(hp.holders.today) : '—', metricLabel: 'maps opened today' },
    { slug: 'gully-core', title: 'A launchpad and DEX core', built: 'Gully Core: bonding-curve launches graduating to Gully Swap pools, built into Gully Chain.', services: 'Launch & growth · Contracts', metric: hp?.activity ? fmtCompact(hp.activity.hourly.reduce((n, x) => n + (x.launches ?? 0), 0)) : '—', metricLabel: 'Gully Core launches, 24 h' },
    { slug: 'security', title: 'Security as a product', built: 'AI scans, monitors and a public score, offered to every team.', services: 'Security', metric: hub ? (stateOf(hub, ['security']) === 'up' ? 'live' : '—') : '—', metricLabel: 'scan engine status' },
  ]
  return (
    <ul className="gt-cases">
      {cases.map((c, i) => {
        const p = productBySlug(c.slug)!
        return (
          <li key={c.slug} className="rv" style={{ transitionDelay: `${(i % 3) * 60}ms` }}>
            <A href={productHref(p)} className="gt-case">
              <span className="gt-k">
                Case {String(i + 1).padStart(2, '0')} · {p.name}
              </span>
              <h3>{c.title}</h3>
              <p>{c.built}</p>
              <span className="gt-metric">
                <b className="num">{c.metric}</b>
                <span>{c.metricLabel} · live</span>
              </span>
              <span className="gt-tags">{c.services}</span>
            </A>
          </li>
        )
      })}
    </ul>
  )
}

/* ---------------------------------------------------------------- process ---- */
const STEPS = [
  ['Discover', 'A call and a written scope: goals, chains, risks, budget and a timeline you can hold us to.'],
  ['Build', 'Weekly demos on testnet, tests and gas reports in the repo, security review before launch.'],
  ['Launch', 'Mainnet deployment, verification, monitoring and a status page from day one.'],
  ['Grow', 'Quests, holder analytics, payments and infra that scale with you, run by the team that built it.'],
]
export function Process() {
  return (
    <ol className="gt-process">
      {STEPS.map(([t, d], i) => (
        <li key={t} className="rv" style={{ transitionDelay: `${i * 70}ms` }}>
          <span className="gt-n num">{String(i + 1).padStart(2, '0')}</span>
          <h3>{t}</h3>
          <p>{d}</p>
          <i className="gt-prog" aria-hidden />
        </li>
      ))}
    </ol>
  )
}

/* ---------------------------------------------------------------- contact ---- */
type Sent = 'idle' | 'sending' | 'sent' | 'error'
export function ContactForm() {
  // A link like /services?service=chain#contact preselects the project type.
  const [type, setType] = useState<string>(() => {
    const q = typeof location === 'undefined' ? null : new URLSearchParams(location.search).get('service')
    return (q && SERVICES.find((s) => s.key === q)?.title) || ''
  })
  const [state, setState] = useState<Sent>('idle')
  const [err, setErr] = useState('')
  useEffect(() => {
    const f = (e: Event) => {
      const k = (e as CustomEvent<string>).detail
      setType(SERVICES.find((s) => s.key === k)?.title ?? 'Other')
    }
    window.addEventListener(SERVICE_EVENT, f)
    return () => window.removeEventListener(SERVICE_EVENT, f)
  }, [])
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    const v = (k: string) => String(fd.get(k) ?? '').trim()
    if (!v('email') || !v('type') || !v('message')) {
      setState('error')
      setErr('Email, project type and a short message are needed.')
      return
    }
    setState('sending')
    try {
      const r = await fetch('/api/contact', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: v('name'), email: v('email'), types: [v('type')], budget: v('budget'), message: v('message'), website: v('website'), source: 'landing' }) })
      const j = (await r.json().catch(() => ({}))) as { ok?: boolean; error?: string }
      if (!r.ok || !j.ok) throw new Error(j.error || (r.status === 400 ? 'Check the email address and try again.' : 'The message could not be sent. Try again, or write to us on Telegram.'))
      setState('sent')
    } catch (x) {
      setState('error')
      setErr(x instanceof Error ? x.message : 'The message could not be sent.')
    }
  }
  if (state === 'sent')
    return (
      <div className="gt-form gt-sent" role="status">
        <span className="gt-k">
          <Check className="gt-ic" aria-hidden /> Message received
        </span>
        <h3>Thanks. We read every message.</h3>
        <p>We reply by email with questions or a first scope. For a quicker chat, message us on Telegram.</p>
        <A href="https://t.me/GullyLabsBot?start=contact" className="gt-btn sec sm">
          <Send className="gt-ic" aria-hidden />
          Telegram
          <ArrowUpRight className="gt-ic" aria-hidden />
        </A>
      </div>
    )
  return (
    <form className="gt-form" onSubmit={submit} noValidate aria-describedby="contact-note">
      <div className="gt-fields">
        <label>
          <span>Name</span>
          <input name="name" autoComplete="name" maxLength={120} placeholder="Ada Lovelace" />
        </label>
        <label>
          <span>Email *</span>
          <input name="email" type="email" required autoComplete="email" maxLength={254} placeholder="you@team.xyz" />
        </label>
        <label>
          <span>Project type *</span>
          <select name="type" required value={type} onChange={(e) => setType(e.target.value)}>
            <option value="" disabled>
              Choose one
            </option>
            {SERVICES.map((s) => (
              <option key={s.key}>{s.title}</option>
            ))}
            <option>Other</option>
          </select>
        </label>
        <label>
          <span>Budget (USD)</span>
          <select name="budget" defaultValue="">
            <option value="">Choose a range</option>
            {BUDGETS.map((b) => (
              <option key={b}>{b}</option>
            ))}
          </select>
        </label>
        <label className="full">
          <span>Message *</span>
          <textarea name="message" required rows={5} maxLength={5000} placeholder="What are you building, on which chain, and by when?" />
        </label>
        {/* Honeypot: hidden from people and from assistive tech; bots fill it. */}
        <label className="gt-hp" aria-hidden="true">
          <span>Website</span>
          <input name="website" tabIndex={-1} autoComplete="off" />
        </label>
      </div>
      <div className="gt-formfoot">
        <button type="submit" className="gt-btn pri" disabled={state === 'sending'}>
          {state === 'sending' ? 'Sending…' : 'Send project brief'}
          <ArrowRight className="gt-ic" aria-hidden />
        </button>
        <span id="contact-note" className="gt-note">
          Goes straight to the team. No mailing list, no waitlist.
        </span>
      </div>
      {state === 'error' && (
        <p className="gt-err" role="alert">
          {err}
        </p>
      )}
    </form>
  )
}
