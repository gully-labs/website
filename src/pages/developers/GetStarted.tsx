import { TZ } from '../../lib/time'
import { ChartNoAxesCombined, KeyRound, Terminal } from 'lucide-react'
import { Stepper } from './ui'
import type { ReactNode } from 'react'
import type { Account, AnalyticsView } from './api'

/* The Overview's "Get started" checklist: the three steps of a Gully Labs account (a key, a first call, a Gully
   Analytics site). Every tick comes from account data the console already reads (the account's keys,
   /api/developer/analytics); a product not switched on on this server is left out instead of counting as undone. */

type StepState = 'done' | 'todo' | 'na' | 'loading'
interface Step {
  id: string
  title: string
  note: string
  state: StepState
  action: ReactNode
}

const actionCls = 'inline-flex min-h-11 shrink-0 items-center gap-1 rounded-full px-3 text-[13px] text-gold hover:text-gold-hover hover:underline'

export function GetStarted({ account, analytics, go, createKey }: { account: Account; analytics: AnalyticsView | null | 'error'; go: (tab: 'keys' | 'analytics' | 'billing') => void; createKey: () => void }) {
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
      note: called ? `last call ${new Date(account.keys.map((k) => k.lastUsed ?? '').sort().at(-1)!).toLocaleDateString('en-US', { timeZone: TZ, month: 'short', day: 'numeric' })}` : 'send it as Authorization: Bearer',
      state: called ? 'done' : 'todo',
      action: !called && (
        <a href="#quickstart" className={actionCls}>
          Quickstart
        </a>
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
  ]
  // The stepper shows the steps the account can see; a product not switched on here is left out instead of counting as undone.
  const tracked = steps.filter((s) => s.state !== 'na')
  return (
    <div className="flex flex-col gap-1">
      <Stepper
        startFolded
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
                s.action && <span className="shrink-0 [&>*]:min-h-11 [&>*]:bg-gold [&>*]:px-4 [&>*]:font-semibold [&>*]:text-bg [&>*]:hover:bg-gold-hover [&>*]:hover:text-bg [&>*]:hover:no-underline">{s.action}</span>
              )}
            </div>
          )
        }}
      </Stepper>
    </div>
  )
}

const STEP_ICON: Record<string, ReactNode> = {
  key: <KeyRound size={13} aria-hidden />,
  call: <Terminal size={13} aria-hidden />,
  analytics: <ChartNoAxesCombined size={13} aria-hidden />,
}
