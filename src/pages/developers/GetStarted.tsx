import { AppWindow, ArrowUpRight, BookOpen, Check, ChevronDown, Code2, MessageCircleQuestion, Activity } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { DOCS_URL, isLocalHost, SITE_URL } from '../../site-host'
import type { Account, AlertsView, AnalyticsView } from './api'
import { ExtLink } from './ExtLink'
import { panel, panelTitle, pillSm, rise } from './styles'

/* The Overview's "Get started" checklist and "Tools" row. Every tick comes from account data the console
   already reads (the account's keys, /api/developer/alerts, /api/developer/analytics); a step the server
   cannot see (embedding the widget needs no account) says so instead of pretending. */

const site = (path: string) => (isLocalHost() ? path : `${SITE_URL}${path}`)

type StepState = 'done' | 'todo' | 'na' | 'untracked' | 'loading'
interface Step {
  id: string
  title: string
  note: string
  state: StepState
  action: ReactNode
}

const actionCls = 'inline-flex min-h-11 shrink-0 items-center gap-1 rounded-full px-3 text-[13px] text-gold hover:text-gold-hover hover:underline'

function Mark({ state, n }: { state: StepState; n: number }) {
  if (state === 'done')
    return (
      <span className="grid size-7 shrink-0 place-items-center rounded-full bg-gold text-bg" aria-hidden>
        <Check size={15} strokeWidth={3} />
      </span>
    )
  return (
    <span className={`grid size-7 shrink-0 place-items-center rounded-full border font-mono text-[12px] ${state === 'todo' ? 'border-gold-line text-gold' : 'border-line-strong text-faint'}`} aria-hidden>
      {n}
    </span>
  )
}

const STATE_TEXT: Record<StepState, string> = { done: 'Done', todo: 'To do', na: 'Not available', untracked: 'Not tracked', loading: 'Checking…' }

export function GetStarted({ account, alerts, analytics, go, createKey, createAlert }: { account: Account; alerts: AlertsView | null; analytics: AnalyticsView | null | 'error'; go: (tab: 'keys' | 'alerts' | 'analytics' | 'billing') => void; createKey: () => void; createAlert: () => void }) {
  const ga = analytics === 'error' ? null : analytics
  const hasKey = account.keys.length > 0
  const called = account.keys.some((k) => !!k.lastUsed)
  const steps: Step[] = [
    {
      id: 'key',
      title: 'Create an API key',
      note: hasKey ? `${account.keys.filter((k) => !k.revokedAt).length} live of ${account.limits.maxKeys}` : `${account.limits.keyPerMin.toLocaleString('en-US')} calls a minute instead of ${account.limits.anonymousPerMin.toLocaleString('en-US')}`,
      state: hasKey ? 'done' : 'todo',
      action: !hasKey && (
        <button type="button" onClick={createKey} className={actionCls}>
          Create key
        </button>
      ),
    },
    {
      id: 'call',
      title: 'Call the API with it',
      note: called ? `last call ${new Date(account.keys.map((k) => k.lastUsed ?? '').sort().at(-1)!).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : 'send it as Authorization: Bearer',
      state: called ? 'done' : 'todo',
      action: !called && (
        <a href="#quickstart" className={actionCls}>
          Quickstart
        </a>
      ),
    },
    {
      id: 'alert',
      title: 'Set a gap alert',
      note: alerts ? (alerts.alerts.length ? `${alerts.alerts.length} of ${alerts.limits.max} on ${alerts.limits.planName}` : 'webhook or Telegram when a gap crosses your line') : 'reading alerts…',
      state: !alerts ? 'loading' : alerts.alerts.length ? 'done' : 'todo',
      action: alerts && !alerts.alerts.length && (
        <button type="button" onClick={createAlert} className={actionCls}>
          New alert
        </button>
      ),
    },
    {
      id: 'telegram',
      title: 'Connect Telegram',
      note: !alerts ? 'reading alerts…' : !alerts.telegram.enabled ? 'the bot is not switched on on this server' : alerts.telegram.linked ? `linked to ${alerts.telegram.linked.chatType === 'private' ? 'a private chat' : 'a group'}` : 'alerts as messages, with a Mute button',
      state: !alerts ? 'loading' : !alerts.telegram.enabled ? 'na' : alerts.telegram.linked ? 'done' : 'todo',
      action: alerts?.telegram.enabled && !alerts.telegram.linked && (
        <button type="button" onClick={() => go('alerts')} className={actionCls}>
          Connect
        </button>
      ),
    },
    {
      id: 'analytics',
      title: 'Add a Gully Analytics site',
      note: analytics === 'error' ? 'Gully Analytics could not be read' : !ga ? 'reading Gully Analytics…' : !ga.configured ? 'sign-up is not switched on on this server' : ga.account?.sites.length ? `${ga.account.sites.length} site${ga.account.sites.length === 1 ? '' : 's'} recording` : ga.trialAvailable ? `${ga.offer.analytics.trialDays}-day free trial, one script tag` : 'one script tag, wallet-aware',
      state: analytics === 'error' ? 'na' : !ga ? 'loading' : !ga.configured ? 'na' : ga.account?.sites.length ? 'done' : 'todo',
      action: ga?.configured && !ga.account?.sites.length && (
        <button type="button" onClick={() => go('analytics')} className={actionCls}>
          {ga.account ? 'Add site' : 'Start'}
        </button>
      ),
    },
    {
      id: 'widget',
      title: 'Embed the widget',
      note: 'no key needed, so we cannot see it from your account',
      state: 'untracked',
      action: (
        <a href={site('/widget')} className={actionCls}>
          Builder <ArrowUpRight size={12} aria-hidden />
        </a>
      ),
    },
  ]
  const tracked = steps.filter((s) => s.state !== 'na' && s.state !== 'untracked')
  const done = tracked.filter((s) => s.state === 'done').length
  const loading = steps.some((s) => s.state === 'loading')
  const complete = !loading && done === tracked.length
  const next = steps.find((s) => s.state === 'todo')
  // Compact by default: the ring, the next step and its one button. "All steps" opens the list.
  const [open, setOpen] = useState(false)

  return (
    <section aria-labelledby="ov-start" className={`${panel} gap-3`} style={rise(0)} data-testid="get-started">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <ProgressRing done={done} total={tracked.length} />
        <span className="flex min-w-0 flex-[1_1_200px] flex-col gap-[2px]">
          <h2 id="ov-start" className={panelTitle}>
            {complete ? 'All set' : 'Get started'}
          </h2>
          <span className="truncate text-[13px] text-muted" data-testid="next-step">
            {loading && !next ? 'Checking your setup…' : next ? <>Next: <b className="font-semibold text-ink">{next.title}</b> · {next.note}</> : 'Every tracked step is done.'}
          </span>
        </span>
        {next?.action && <span className="shrink-0 [&>*]:min-h-9 [&>*]:bg-gold [&>*]:px-4 [&>*]:font-semibold [&>*]:text-bg [&>*]:hover:bg-gold-hover [&>*]:hover:text-bg [&>*]:hover:no-underline">{next.action}</span>}
        <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} aria-controls="ov-start-list" className="inline-flex min-h-9 items-center gap-1 rounded-full px-2 text-[13px] text-muted hover:text-ink">
          {open ? 'Hide steps' : 'All steps'} <ChevronDown size={14} className={`transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden />
        </button>
      </div>
      {open && (
        <ol id="ov-start-list" className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(min(100%,340px),1fr))] gap-x-5 gap-y-0 p-0" style={{ animation: 'gl-fade .25s ease both' }}>
          {steps.map((s, i) => (
            <li key={s.id} className="flex min-h-[60px] items-center gap-3 border-t border-line py-2" data-state={s.state}>
              <Mark state={s.state} n={i + 1} />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className={`text-[14px] font-semibold ${s.state === 'done' ? 'text-muted line-through decoration-line-strong' : 'text-ink'}`}>
                  {s.title}
                  <span className="sr-only"> · {STATE_TEXT[s.state]}</span>
                </span>
                <span className="text-[12px] leading-[1.4] text-dim">
                  {s.state === 'na' || s.state === 'untracked' ? <span className="font-mono text-[11px] text-faint uppercase">{STATE_TEXT[s.state]} · </span> : null}
                  {s.note}
                </span>
              </span>
              {s.action || null}
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}

/** Setup progress as a ring that draws itself in (and moves on each tick); the count sits inside. */
function ProgressRing({ done, total }: { done: number; total: number }) {
  const r = 19
  const c = 2 * Math.PI * r
  const [shown, setShown] = useState(0)
  useEffect(() => {
    const id = requestAnimationFrame(() => setShown(total ? done / total : 0))
    return () => cancelAnimationFrame(id)
  }, [done, total])
  return (
    <span className="relative grid size-12 shrink-0 place-items-center" role="progressbar" aria-label="Setup progress" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done} aria-valuetext={`${done} of ${total} done`} data-testid="setup-ring">
      <svg viewBox="0 0 48 48" className="absolute inset-0 -rotate-90" aria-hidden>
        <circle cx="24" cy="24" r={r} fill="none" stroke="var(--color-line-strong)" strokeWidth="5" />
        <circle cx="24" cy="24" r={r} fill="none" stroke="#e8c060" strokeWidth="5" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - shown)} style={{ transition: 'stroke-dashoffset .9s cubic-bezier(.2,.8,.2,1)' }} />
      </svg>
      <span className="relative font-mono text-[12px] font-medium text-ink">
        {done}/{total}
      </span>
    </span>
  )
}

/* ------------------------------------------------------------------ tools --- */

type Health = { state: 'checking' } | { state: 'up'; at: Date } | { state: 'down'; at: Date }

/** A live check of the API (GET /healthz on this server). */
function useHealth(): Health {
  const [h, setH] = useState<Health>({ state: 'checking' })
  useEffect(() => {
    let alive = true
    const check = () =>
      fetch('/healthz', { cache: 'no-store' })
        .then((r) => alive && setH({ state: r.ok ? 'up' : 'down', at: new Date() }))
        .catch(() => alive && setH({ state: 'down', at: new Date() }))
    check()
    const id = setInterval(check, 60_000)
    return () => {
      alive = false
      clearInterval(id)
    }
  }, [])
  return h
}

export function ToolsRow() {
  const health = useHealth()
  const time = (d: Date) => d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })
  const tools: { href: string; icon: ReactNode; title: string; note: ReactNode; ext?: boolean }[] = [
    { href: site('/widget'), icon: <AppWindow size={16} aria-hidden />, title: 'Widget builder', note: 'live fair prices, no key' },
    { href: `${DOCS_URL}/sdk`, icon: <Code2 size={16} aria-hidden />, title: 'SDK', note: 'typed TypeScript client', ext: true },
    { href: `${DOCS_URL}/api`, icon: <BookOpen size={16} aria-hidden />, title: 'API docs', note: 'every endpoint and field', ext: true },
    { href: site('/ask'), icon: <MessageCircleQuestion size={16} aria-hidden />, title: 'Gully AI', note: 'questions about the data and docs' },
    {
      href: site('/tracker'),
      icon: <Activity size={16} aria-hidden />,
      title: 'Status',
      note:
        health.state === 'checking' ? (
          'checking the API…'
        ) : (
          <span className="inline-flex items-center gap-[6px]">
            <span className={`size-[7px] rounded-full ${health.state === 'up' ? 'bg-green' : 'bg-error'}`} aria-hidden />
            {health.state === 'up' ? 'API up' : 'API unreachable'} · {time(health.at)}
          </span>
        ),
    },
  ]
  return (
    <nav aria-label="Tools" className="flex flex-wrap items-center gap-2" style={rise(6)} data-testid="tools-row">
      {tools.map((t) => (
        <a key={t.title} href={t.href} {...(t.ext ? { target: '_blank', rel: 'noopener noreferrer' } : {})} className="group inline-flex min-h-9 min-w-0 items-center gap-2 rounded-full border border-line bg-surface px-3 text-[13px] transition-colors hover:border-gold-line max-[600px]:min-h-11">
          <span className="text-gold">{t.icon}</span>
          <span className="font-semibold text-ink">{t.title}</span>
          <span className="truncate text-[12px] text-dim max-[600px]:hidden">{t.note}</span>
          <ArrowUpRight size={12} className="shrink-0 text-faint group-hover:text-gold" aria-hidden />
          {t.ext && <span className="sr-only"> (opens in a new tab)</span>}
        </a>
      ))}
    </nav>
  )
}

/** For Billing: custom checkouts and pay links are set up by Gully Labs (no merchant self-serve yet). */
export function PayOnRequest() {
  return (
    <section className={`${panel} flex-row flex-wrap items-center gap-3`} style={rise(3)} aria-labelledby="pay-req">
      <span className="flex min-w-0 flex-[1_1_320px] flex-col gap-[2px]">
        <h2 id="pay-req" className={panelTitle}>
          Custom checkouts and pay links
        </h2>
        <span className="text-[13px] leading-[1.5] text-muted">Need to take crypto payments yourself: a reusable pay link, an invoice, a “Pay with crypto” button on your site, signed webhooks? Gully Pay does that today, set up for you on request.</span>
      </span>
      <a href={site('/services?contact=1')} className={pillSm}>
        Ask for Gully Pay <ArrowUpRight size={13} aria-hidden />
      </a>
      <ExtLink href={`${DOCS_URL}/gully-pay`} className={pillSm}>
        <BookOpen size={15} aria-hidden /> How it works
      </ExtLink>
    </section>
  )
}
