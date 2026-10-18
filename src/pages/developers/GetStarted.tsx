import { AppWindow, ArrowUpRight, BellRing, BookOpen, ChartNoAxesCombined, Code2, KeyRound, MessageCircleQuestion, Send, Terminal } from 'lucide-react'
import { Stepper } from './ui'
import type { ReactNode } from 'react'
import { DOCS_URL, isLocalHost, SITE_URL } from '../../site-host'
import type { Account, AlertsView, AnalyticsView } from './api'
import { rise } from './styles'

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
        <a href={site('/widget')} target="_blank" rel="noopener noreferrer" className={actionCls}>
          Builder <ArrowUpRight size={12} aria-hidden />
        </a>
      ),
    },
  ]
  // The stepper shows the steps the account can see; the ones it cannot (the widget needs no key; a
  // product not switched on here) are listed under it in one line instead of counting as undone.
  const tracked = steps.filter((s) => s.state !== 'na' && s.state !== 'untracked')
  const others = steps.filter((s) => s.state === 'na' || s.state === 'untracked')
  const loading = steps.some((s) => s.state === 'loading')
  return (
    <div className="flex flex-col gap-1">
      <Stepper
        title="Get started"
        testId="get-started"
        steps={tracked.map((s) => ({ id: s.id, label: s.title, done: s.state === 'done', icon: STEP_ICON[s.id] }))}
      >
        {(id) => {
          const s = steps.find((x) => x.id === id)!
          return (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2" data-testid="next-step">
              <span className="flex min-w-0 flex-[1_1_240px] flex-col">
                <span className="text-[14px] font-semibold text-ink">{s.title}</span>
                <span className="text-[12px] text-dim">{s.state === 'loading' ? 'checking…' : s.note}</span>
              </span>
              {s.state === 'done' ? (
                <span className="font-mono text-[11px] text-green">done</span>
              ) : (
                s.action && <span className="shrink-0 [&>*]:min-h-9 [&>*]:bg-gold [&>*]:px-4 [&>*]:font-semibold [&>*]:text-bg [&>*]:hover:bg-gold-hover [&>*]:hover:text-bg [&>*]:hover:no-underline">{s.action}</span>
              )}
            </div>
          )
        }}
      </Stepper>
      {!loading && others.length > 0 && (
        <span className="px-1 font-mono text-[11px] text-faint">
          {others.map((s) => `${s.title}: ${STATE_TEXT[s.state].toLowerCase()} (${s.note})`).join(' · ')}
        </span>
      )}
    </div>
  )
}

const STEP_ICON: Record<string, ReactNode> = {
  key: <KeyRound size={13} aria-hidden />,
  call: <Terminal size={13} aria-hidden />,
  alert: <BellRing size={13} aria-hidden />,
  telegram: <Send size={13} aria-hidden />,
  analytics: <ChartNoAxesCombined size={13} aria-hidden />,
}

/* ------------------------------------------------------------------ tools --- */

export function ToolsRow() {
  const tools: { href: string; icon: ReactNode; title: string; note: ReactNode }[] = [
    { href: site('/widget'), icon: <AppWindow size={16} aria-hidden />, title: 'Widget builder', note: 'live fair prices, no key' },
    { href: `${DOCS_URL}/sdk`, icon: <Code2 size={16} aria-hidden />, title: 'SDK', note: 'typed TypeScript client' },
    { href: `${DOCS_URL}/api`, icon: <BookOpen size={16} aria-hidden />, title: 'API docs', note: 'every endpoint and field' },
    { href: site('/ask'), icon: <MessageCircleQuestion size={16} aria-hidden />, title: 'Gully AI', note: 'questions about the data and docs' },
  ]
  return (
    <nav aria-label="Tools" className="flex flex-wrap items-center gap-2" style={rise(6)} data-testid="tools-row">
      {tools.map((t) => (
        <a key={t.title} href={t.href} target="_blank" rel="noopener noreferrer" className="group inline-flex min-h-9 min-w-0 items-center gap-2 rounded-full border border-line bg-surface px-3 text-[13px] transition-colors hover:border-gold-line max-[600px]:min-h-11">
          <span className="text-gold">{t.icon}</span>
          <span className="font-semibold text-ink">{t.title}</span>
          <span className="truncate text-[12px] text-dim max-[1535px]:hidden">{t.note}</span>
          <ArrowUpRight size={12} className="shrink-0 text-faint group-hover:text-gold" aria-hidden />
          <span className="sr-only"> (opens in a new tab)</span>
        </a>
      ))}
    </nav>
  )
}
