import { BellRing, ChartNoAxesCombined, CreditCard, Gauge, History, KeyRound, Layers, Loader2, Send, UserRound, Users, type LucideIcon } from 'lucide-react'
import { useMemo, useState, type KeyboardEvent } from 'react'
import { usePoll } from './poll'
import { RefreshChip } from './ui'
import { ago, api, shortAddress, type ActivityEvent, type ActivityPage } from './api'
import { Mascot } from '../../components/brand'
import { Avatar } from './Avatar'
import { ErrorLine, Skeleton } from './parts'
import { GhostCurves } from './charts'
import { fmtDateTime, usePortal } from './portal'
import { chip, mono, panel, panelTitle, pillLine, rise } from './styles'
import { StackedDays, type DayStack } from './vcharts'

/* The Activity tab (portal v2): the workspace's log, newest first, from GET /api/developer/activity
   (50 events a page; "Load more" passes nextCursor back). Each event reads as one sentence: who
   (you, a short address, or Gully Labs for automatic notices), what in plain words, on what, and
   when (relative, the exact time on hover). Filters by kind work on the pages loaded so far. The newest
   page is polled every minute with backoff (a failed refresh keeps the list and shows a retry chip); from
   1024px the chart and filters sit beside the list, which scrolls inside its own box so the page stays
   one screen tall. */

type Kind = 'keys' | 'alerts' | 'billing' | 'team' | 'telegram' | 'analytics' | 'usage' | 'account'
const KINDS: { id: Kind | 'all'; label: string; icon: LucideIcon }[] = [
  { id: 'all', label: 'All', icon: Layers },
  { id: 'keys', label: 'Keys', icon: KeyRound },
  { id: 'alerts', label: 'Alerts', icon: BellRing },
  { id: 'billing', label: 'Billing', icon: CreditCard },
  { id: 'team', label: 'Team', icon: Users },
  { id: 'telegram', label: 'Telegram', icon: Send },
  { id: 'analytics', label: 'Analytics', icon: ChartNoAxesCombined },
  { id: 'usage', label: 'Usage', icon: Gauge },
  { id: 'account', label: 'Account', icon: UserRound },
]
const KIND_COLOR: Record<Kind, string> = { keys: '#d9b563', alerts: '#5aa9e6', billing: '#74c27b', team: '#c98bdb', telegram: '#5aa9e6', analytics: '#26ab94', usage: '#ff8a7a', account: '#949daa' }

function kindOf(action: string): Kind {
  const head = action.split('.')[0]
  if (head === 'key') return 'keys'
  if (head === 'alert') return 'alerts'
  if (head === 'billing' || head === 'company') return 'billing'
  if (head === 'team' || head === 'workspace') return 'team'
  if (head === 'telegram') return 'telegram'
  if (head === 'analytics') return 'analytics'
  if (head === 'usage') return 'usage'
  return 'account'
}

const s = (v: unknown) => (v === null || v === undefined ? '' : String(v))
const addr = (v: unknown) => (/^0x[0-9a-f]{40}$/i.test(s(v)) ? shortAddress(s(v)) : s(v))
const ALERT_CHANGE: Record<string, string> = { paused: 'paused', resumed: 'resumed', 'webhook-secret-rotated': 'rotated the webhook secret of', 'telegram-on': 'turned Telegram on for', 'telegram-off': 'turned Telegram off for' }

/** The event as words: [what, on what]. */
function describe(e: ActivityEvent): [string, string | null] {
  const d = e.detail ?? {}
  const t = e.target
  switch (e.action) {
    case 'key.created':
      return ['created the key', t]
    case 'key.renamed':
      return [`renamed the key ${s(d.from) || ''} to`.replace('  ', ' '), s(d.to) || t]
    case 'key.rotated':
      return ['rotated the secret of the key', t]
    case 'key.revoked':
      return ['revoked the key', t]
    case 'key.linked':
      return ['linked the legacy key', t]
    case 'alert.created':
      return ['created the alert', t]
    case 'alert.updated':
      return [`${ALERT_CHANGE[s(d.change)] ?? 'changed'} the alert`, t]
    case 'alert.deleted':
      return ['deleted an alert', null]
    case 'alert.tested':
      return ['sent a test of the alert', t]
    case 'chain.launched':
      return [`launched the testnet chain${d.chainId ? ` (id ${s(d.chainId)})` : ''}`, t]
    case 'chain.removed':
      return ['removed a launched chain', t]
    case 'telegram.linked':
      return ['linked the Telegram chat', t]
    case 'telegram.unlinked':
      return ['unlinked Telegram', null]
    case 'analytics.trial':
      return ['started the Gully Analytics trial', null]
    case 'analytics.site_added':
      return ['added the website', t]
    case 'analytics.site_removed':
      return ['removed a website from Gully Analytics', null]
    case 'analytics.password_reset':
      return ['reset the Gully Analytics password', null]
    case 'analytics.quote':
      return [`opened a quote${d.usd ? ` (${s(d.usd)} USD)` : ''} for Gully Analytics`, s(d.plan) || t]
    case 'analytics.plan':
      return [`paid${d.usd ? ` ${s(d.usd)} USD` : ''} for Gully Analytics`, s(d.plan) || t]
    case 'billing.quote':
      return [`opened a quote${d.usd ? ` (${s(d.usd)} USD)` : ''} for the plan`, s(d.plan) || t]
    case 'billing.paid':
      return [`paid${d.usd ? ` ${s(d.usd)} USD` : ''}${d.chain ? ` on ${s(d.chain)}` : ''} for the plan`, s(d.plan) || t]
    case 'team.invited':
      return [`invited as ${s(d.role)}`, d.kind === 'link' ? 'a one-time link' : addr(t)]
    case 'team.invite_revoked':
      return [`revoked the ${s(d.role)} invite for`, t === 'link' ? 'a link' : addr(t)]
    case 'team.joined':
      return [`joined as ${s(d.role)}`, d.kind === 'link' ? 'by link' : 'by wallet invite']
    case 'team.role_changed':
      return [`changed the role (${s(d.from)} → ${s(d.to)}) of`, addr(t)]
    case 'team.removed':
      return [`removed (${s(d.role)})`, addr(t)]
    case 'team.left':
      return ['left the workspace', null]
    case 'workspace.renamed':
      return [`renamed the workspace${d.from ? ` from ${s(d.from)}` : ''} to`, t]
    case 'company.updated':
      return [`updated the company details (${Array.isArray(d.fields) ? d.fields.join(', ') : 'fields'})`, null]
    case 'profile.updated':
      return [`updated their profile (${Array.isArray(d.fields) ? d.fields.join(', ') : 'fields'})`, null]
    case 'sessions.revoked':
      return [`signed out ${s(d.count)} session${d.count === 1 ? '' : 's'}`, t === 'others' ? '(all others)' : null]
    case 'usage.threshold':
      return [`saw the key pass ${s(d.threshold)}% of its limit (${s(d.peakPerMin)} of ${s(d.limitPerMin)} a minute):`, t]
    default:
      return [String(e.action).replace(/[._]/g, ' '), t]
  }
}

function dayLabel(iso: string) {
  const d = new Date(iso)
  const today = new Date()
  const y = new Date(today)
  y.setDate(today.getDate() - 1)
  if (d.toDateString() === today.toDateString()) return 'Today'
  if (d.toDateString() === y.toDateString()) return 'Yesterday'
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
}

export function ActivityTab() {
  const { user, me } = usePortal()
  const first = usePoll<ActivityPage>('/api/developer/activity', 60_000)
  const [older, setOlder] = useState<{ events: ActivityEvent[]; cursor: string | null } | null>(null)
  const [moreErr, setMoreErr] = useState<string | null>(null)
  const [more, setMore] = useState(false)
  const [kind, setKind] = useState<Kind | 'all'>('all')
  const err = first.data ? null : (first.error ?? (first.timedOut ? 'no answer in time' : null))
  const events = useMemo(() => {
    if (!first.data) return null
    const seen = new Set<string>()
    return [...first.data.events, ...(older?.events ?? [])].filter((e) => (seen.has(e.id) ? false : (seen.add(e.id), true)))
  }, [first.data, older])
  const cursor = older ? older.cursor : (first.data?.nextCursor ?? null)
  const loadMore = async (from: string) => {
    setMore(true)
    const r = await api<ActivityPage>(`/api/developer/activity?cursor=${encodeURIComponent(from)}`)
    setMore(false)
    if (!r.ok) return setMoreErr(r.error)
    setMoreErr(null)
    setOlder((prev) => ({ events: [...(prev?.events ?? []), ...r.data.events], cursor: r.data.nextCursor }))
  }

  const shown = useMemo(() => (events ?? []).filter((e) => kind === 'all' || kindOf(e.action) === kind), [events, kind])
  // Events per day over the last 14 days (of the pages loaded), stacked by kind.
  const perDay = useMemo<DayStack[]>(() => {
    const days: DayStack[] = []
    const index = new Map<string, DayStack>()
    const today = new Date()
    for (let i = 13; i >= 0; i--) {
      const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i)
      const row = { label: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }), values: {} as Record<string, number> }
      index.set(d.toDateString(), row)
      days.push(row)
    }
    for (const e of shown) {
      const row = index.get(new Date(e.at).toDateString())
      if (row) row.values[kindOf(e.action)] = (row.values[kindOf(e.action)] ?? 0) + 1
    }
    return days
  }, [shown])
  const counts = useMemo(() => {
    const c: Partial<Record<Kind, number>> = {}
    for (const e of events ?? []) c[kindOf(e.action)] = (c[kindOf(e.action)] ?? 0) + 1
    return c
  }, [events])

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
    e.preventDefault()
    const i = KINDS.findIndex((k) => k.id === kind)
    const next = KINDS[(i + (e.key === 'ArrowLeft' ? -1 : 1) + KINDS.length) % KINDS.length].id
    setKind(next)
    ;(e.currentTarget.querySelector(`[data-k="${next}"]`) as HTMLElement | null)?.focus()
  }

  const actorName = (a: string) => (a === user ? 'You' : a === 'system' ? 'Gully Labs' : shortAddress(a))

  return (
    <section className={`${panel} gap-2 p-3`} style={rise(0)} aria-labelledby="act-title">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-col gap-[2px]">
          <h2 id="act-title" className={`${panelTitle} flex items-center gap-2`}>
            Activity
            <RefreshChip error={first.data ? first.error : null} onRetry={() => void first.reload()} />
          </h2>
          <span className={mono}>Who changed what in this workspace · kept 180 days</span>
        </div>
        <div role="radiogroup" aria-label="Show" onKeyDown={onKey} className="flex flex-wrap gap-[6px]">
          {KINDS.map((k) => (
            <button key={k.id} data-k={k.id} type="button" role="radio" aria-checked={kind === k.id} tabIndex={kind === k.id ? 0 : -1} onClick={() => setKind(k.id)} className={`${chip(kind === k.id)} min-h-11 gap-[6px] px-[10px] text-[12px] max-[600px]:min-h-11`}>
              <k.icon size={13} aria-hidden style={k.id === 'all' ? undefined : { color: kind === k.id ? undefined : KIND_COLOR[k.id] }} />
              {k.label}
              {k.id !== 'all' && counts[k.id] ? <span className="font-mono text-[11px] opacity-70">{counts[k.id]}</span> : null}
            </button>
          ))}
        </div>
      </div>

      {err && !events ? (
        <ErrorLine onRetry={() => void first.reload()}>The activity log could not be read: {err}</ErrorLine>
      ) : !events ? (
        <div className="flex flex-col gap-3" aria-busy>
          {[0, 1, 2, 3, 4].map((i) => (
            <Skeleton key={i} h={52} />
          ))}
        </div>
      ) : !events.length ? (
        <GhostCurves height={140} title="Your activity will draw here">
          <History size={22} className="text-gold" aria-hidden />
          <span className="max-w-[460px] text-[13px] text-muted">Key, alert, billing and team changes made from now on are listed here with who made them, and counted per day.</span>
        </GhostCurves>
      ) : (
        <div className="grid grid-cols-1 gap-3 min-[1024px]:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
          <div data-testid="activity-chart" className="min-w-0">
            {perDay.some((d) => Object.keys(d.values).length) ? (
              <StackedDays days={perDay} kinds={(Object.keys(KIND_COLOR) as Kind[]).map((k) => ({ id: k, name: k, color: KIND_COLOR[k] }))} label={`Events per day over the last 14 days: ${shown.length} events loaded.`} height={150} />
            ) : (
              <GhostCurves height={150} title={`No ${kind === 'all' ? '' : `${KINDS.find((k) => k.id === kind)?.label.toLowerCase() ?? ''} `}events in the last 14 days`}>
                <span className="text-[13px] text-muted">Older events are listed below; new ones count here by day.</span>
              </GhostCurves>
            )}
          </div>
          <div className="flex min-w-0 flex-col gap-2 min-[1024px]:max-h-[calc(100dvh-230px)] min-[1024px]:min-h-[240px] min-[1024px]:overflow-y-auto min-[1024px]:pr-1 min-[1024px]:[scrollbar-width:thin]">
          {!shown.length && <p className="m-0 py-6 text-center text-[14px] text-faint">No {KINDS.find((k) => k.id === kind)?.label.toLowerCase()} events{cursor ? ' in the events loaded so far' : ''}.</p>}
          <ol className="relative m-0 flex list-none flex-col p-0" data-testid="activity-list">
            {shown.map((e, i) => {
              const day = dayLabel(e.at)
              const head = i === 0 || dayLabel(shown[i - 1].at) !== day
              const k = kindOf(e.action)
              const [what, on] = describe(e)
              return (
                <li key={e.id} className="flex flex-col" style={{ animation: `gl-rise .35s ${Math.min(i, 12) * 0.03}s ease both` }}>
                  {head && <span className={`${i === 0 ? '' : 'pt-2'} pb-1 font-mono text-[11px] tracking-[1px] text-faint uppercase`}>{day}</span>}
                  <div className="flex items-start gap-2 border-l-2 py-[6px] pl-3" style={{ borderColor: KIND_COLOR[k] }}>
                    {e.actor === 'system' ? <Mascot size={24} label="Gully Labs" /> : <Avatar address={e.actor} src={e.actor === user ? me?.profile.avatar : null} size={24} />}
                    <span className="flex min-w-0 flex-1 flex-col gap-[2px]">
                      <span className="text-[13px] leading-[1.45] break-words">
                        <b className="font-semibold" title={e.actor}>
                          {e.actor === user && me?.profile.ens ? `You (${me.profile.ens})` : actorName(e.actor)}
                        </b>{' '}
                        <span className="text-ink-2">{what}</span>
                        {on && (
                          <>
                            {' '}
                            <span className="font-mono text-[13px] text-ink">{on}</span>
                          </>
                        )}
                      </span>
                      <span className="font-mono text-[11px] text-faint">
                        <time dateTime={e.at} title={fmtDateTime(e.at)}>
                          {ago(e.at)}
                        </time>{' '}
                        · {k}
                      </span>
                    </span>
                  </div>
                </li>
              )
            })}
          </ol>
          {cursor ? (
            <button type="button" disabled={more} onClick={() => void loadMore(cursor)} className={`${pillLine} min-h-11 self-center`}>
              {more && <Loader2 size={15} className="animate-spin" aria-hidden />} Load more
            </button>
          ) : (
            <span className="self-center font-mono text-[11px] text-faint">That is everything kept for this workspace.</span>
          )}
          {moreErr && cursor && <ErrorLine onRetry={() => void loadMore(cursor)}>{moreErr}</ErrorLine>}
          </div>
        </div>
      )}
    </section>
  )
}
