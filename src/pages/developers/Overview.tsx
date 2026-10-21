import { Activity, ArrowUpRight, Info, LayoutDashboard, BellRing, ChartNoAxesCombined, ChartPie, CreditCard, KeyRound, Plus } from 'lucide-react'
import { useEffect, useMemo, useState, type KeyboardEvent, type ReactNode } from 'react'
import { ChannelChips, SecretDialog, TelegramCard } from './Alerts'
import { EventsMeter } from './Analytics'
import { GetStarted, ToolsRow } from './GetStarted'
import { alertName, alertRule, alertState, defaultAsset, keyColors, priceText, siteMeta, useAlertActions, useAlertsView } from './helpers'
import { api, type Account, type AnalyticsUsage, type AnalyticsView, type BillingView, type PlanId, type Range, type UsageV2 } from './api'
import { DoubleRing, GhostCurves, GhostSpark, Meter, Spark } from './charts'
import { MarketBand } from './services/MarketBand'
import { ServiceHeader } from './services/ServiceHeader'
import { docsPage } from './services/links'
import { usePoll, type Poll } from './poll'
import { useSubTab } from './subtab'
import { InfoTip, RefreshChip, SubPanel, SubTabs, type SubTabItem } from './ui'
import { AnimatedNumber } from '../../components/charts/AnimatedNumber'
import { NF } from '../../components/charts/number-formats'
import { PendingInvites } from './Invite'
import { Can } from './RoleGate'
import { EndpointBars, RequestsChart, StatusDonut, type KeySeries } from './vcharts'
import { ErrorLine, Skeleton } from './parts'
import { ExtLink } from './ExtLink'
import { ChainAssetChips } from './PayFlow'
import { BLUE, chip, LIMITED_COLOR, mono, panel, panelTitle, pillGold, pillGoldLine, pillLine, rise } from './styles'
import { bucketize, busiestKeyRate, firings, group, RANGE_LABEL } from './usage'
import { StatusPill as KitPill } from '../../components/ui/StatusPill'

/* The Overview tab of the console: pending workspace invites, the "Get started" checklist and the Tools
   row (GetStarted.tsx), four KPI cards (animated, with the change against the previous period),
   requests per key (stacked areas with the previous period dashed, ECharts), answers by status (donut)
   and by endpoint (bars), plan limits (the double ring), alerts with the Telegram card, Gully Analytics sites and the "extend your plan" pay
   strip. Each card reads its own endpoint and shows its own loading, empty and unreadable states:
     /api/developer/usage?range=…   requests, 429s, busiest key, previous period, by status, by endpoint
     /api/developer/alerts          alerts, Telegram, firings (from the delivery logs)
     /api/developer/analytics       Gully Analytics account, sites, events (+ /usage for views)
     /api/developer/billing         plans, chains and assets for the pay strip */

const fmt = (n: number) => n.toLocaleString('en-US')

type Load<T> = { state: 'loading' } | { state: 'error'; message: string } | { state: 'ok'; data: T }

/** A usePoll result as a Load (an error only while nothing was ever read; a first read that hangs times out). */
function toLoad<T>(p: Poll<T>): Load<T> {
  if (p.data) return { state: 'ok', data: p.data }
  if (p.error) return { state: 'error', message: p.error }
  if (p.timedOut) return { state: 'error', message: 'no answer in time' }
  return { state: 'loading' }
}

type OvTab = 'requests' | 'answers' | 'alerts' | 'analytics' | 'plan'
const OV_TABS: readonly OvTab[] = ['requests', 'answers', 'alerts', 'analytics', 'plan']
const RANGE_MS: Record<Range, number> = { '24h': 86_400_000, '7d': 7 * 86_400_000, '30d': 30 * 86_400_000 }

/* ------------------------------------------------------------------ KPI card --- */

/** The change against the previous period: "▲ 12%" / "▼ 4%" / "new", or "—" when the previous period is unknown. */
function Delta({ cur, prev, upIsBad = false }: { cur: number | null; prev: number | null | undefined; upIsBad?: boolean }) {
  if (cur === null || prev === null || prev === undefined)
    return (
      <span className="font-mono text-[11px] text-faint" title="The previous period is not fully counted yet">
        — vs previous
      </span>
    )
  if (prev === 0 && cur === 0) return <span className="font-mono text-[11px] text-faint">= vs previous</span>
  if (prev === 0) return <span className="font-mono text-[11px] text-gold">new vs previous</span>
  const pct = ((cur - prev) / prev) * 100
  const flat = Math.abs(pct) < 0.5
  const up = pct >= 0
  const color = flat ? 'text-faint' : up === upIsBad ? 'text-error' : 'text-green'
  return (
    <span className={`font-mono text-[11px] ${color}`} title={`Previous period: ${fmt(prev)}`}>
      {flat ? '=' : up ? '▲' : '▼'} {Math.abs(pct) >= 999 ? '999+' : Math.abs(pct).toFixed(Math.abs(pct) < 10 ? 1 : 0)}% vs previous
    </span>
  )
}

/** `none` is what a zero says in words ("none yet"): a workspace with nothing counted yet reads as that, never as a flat 0. */
function Kpi({ label, value, note, spark, color, i, unreadable, delta, none }: { label: string; value: number | null; note: ReactNode; spark?: number[]; color: string; i: number; unreadable?: string | null; delta?: ReactNode; none?: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-[2px] rounded-[12px] border border-line bg-surface px-3 py-[10px]" style={{ animation: `gl-rise .5s ${i * 0.05}s cubic-bezier(.2,.8,.2,1) both` }} data-kpi={label}>
      <span className="text-[12px] text-dim">{label}</span>
      <span className="flex min-h-[28px] items-end justify-between gap-2">
        {unreadable ? (
          <span className="font-display text-[28px] leading-none font-bold text-faint" title={unreadable}>
            —
          </span>
        ) : value === null ? (
          <Skeleton h={28} w="55%" />
        ) : value === 0 && none ? (
          <span className="flex h-[28px] items-end font-mono text-[13px] text-faint" data-none>
            {none}
          </span>
        ) : (
          <AnimatedNumber value={value} format={NF.int} countUp className="font-display text-[28px] leading-none font-bold" />
        )}
        {spark && !unreadable && (spark.some((v) => v > 0) ? <Spark values={spark} color={color} /> : <GhostSpark color={color} />)}
      </span>
      <span className={`font-mono text-[11px] [overflow-wrap:anywhere] ${unreadable ? 'text-error' : 'text-muted'}`}>{unreadable ? 'unreadable right now' : note}</span>
      {delta && !unreadable && <span>{delta}</span>}
    </div>
  )
}

/* ----------------------------------------------------------- period buttons --- */

function Periods({ value, onChange }: { value: Range; onChange: (r: Range) => void }) {
  const opts: Range[] = ['24h', '7d', '30d']
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
    e.preventDefault()
    const i = opts.indexOf(value)
    const next = opts[(i + (e.key === 'ArrowLeft' ? -1 : 1) + opts.length) % opts.length]
    onChange(next)
    ;(e.currentTarget.querySelector(`[data-v="${next}"]`) as HTMLElement | null)?.focus()
  }
  return (
    <div role="radiogroup" aria-label="Period" onKeyDown={onKey} className="ml-auto flex gap-[2px] rounded-full border border-line p-[3px]">
      {opts.map((o) => (
        <button key={o} data-v={o} type="button" role="radio" aria-checked={value === o} tabIndex={value === o ? 0 : -1} onClick={() => onChange(o)} className={`${chip(value === o, true)} min-h-[30px] relative after:absolute after:inset-x-0 after:-inset-y-[7px] border-0 px-3 text-[11px] max-[600px]:min-h-11`}>
          {o}
        </button>
      ))}
    </div>
  )
}

/* -------------------------------------------------------------------- page --- */

export function Overview({ account, go, createKey, createAlert, checkout }: { account: Account; go: (tab: 'keys' | 'alerts' | 'analytics' | 'billing' | 'tracker') => void; createKey: () => void; createAlert: () => void; checkout: (plan: PlanId, asset: string | null) => void }) {
  const [range, setRange] = useState<Range>('24h')
  const up = usePoll<UsageV2>(`/api/developer/usage?range=${range}`, 60_000)
  const reloadUsage = up.reload
  const alerts = useAlertsView()
  const actions = useAlertActions(alerts.load)
  const gaS = toLoad(usePoll<AnalyticsView>('/api/developer/analytics', 5 * 60_000))
  const billS = toLoad(usePoll<BillingView>('/api/developer/billing', 0))
  const [sub, setSub] = useSubTab('overview', OV_TABS, 'requests', { hashOnOpen: false })
  // "Now" for the firings window, moved on every minute.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(id)
  }, [])

  const shown = up.data && up.data.range === range ? up.data : null
  const usage = shown
  const stale = false
  const grouped = useMemo(() => (shown ? group(shown) : []), [shown])
  const hasLimited = grouped.length > 0 && grouped.every((g) => g.limited !== undefined)

  const series: KeySeries[] = useMemo(() => {
    const names = Object.fromEntries((shown?.keys ?? account.keys).map((k) => [k.id, k.name]))
    const used = new Set(grouped.flatMap((g) => Object.keys(g.keys)))
    const colors = keyColors(account.keys)
    return [...account.keys].sort((a, b) => Number(!!a.revokedAt) - Number(!!b.revokedAt) || a.createdAt.localeCompare(b.createdAt)).filter((k) => !k.revokedAt || used.has(k.id)).map((k) => ({ id: k.id, name: (names[k.id] ?? k.name) + (k.revokedAt ? ' (revoked)' : ''), color: colors[k.id] }))
  }, [shown, grouped, account.keys])

  const live = account.keys.filter((k) => !k.revokedAt)
  const usedInRange = shown ? new Set(grouped.flatMap((g) => Object.entries(g.keys).filter(([, v]) => v > 0).map(([k]) => k))).size : 0
  // Firings come from the alerts' own delivery logs, over the chosen range, whether or not usage answered.
  const from = now - RANGE_MS[range]
  const fired = alerts.view ? firings(alerts.view, from) : null
  const usageErr = shown ? null : (up.error ?? (up.timedOut ? 'no answer in time' : null))

  const busiest = shown ? busiestKeyRate(shown) : null
  const limit = account.limits.keyPerMin
  const ringOuter = busiest ? (busiest.perMin / limit) * 100 : null
  const alertMax = alerts.view?.limits.max ?? account.plan.alerts
  const alertUsed = alerts.view?.limits.used ?? null
  const ringInner = alertUsed !== null && alertMax ? (alertUsed / alertMax) * 100 : null

  const alertCount = alerts.view?.alerts.length ?? null
  const siteCount = gaS.state === 'ok' ? (gaS.data.account?.sites.length ?? 0) : null
  const tabs: SubTabItem<OvTab>[] = [
    { id: 'requests', label: 'Requests', icon: <Activity size={15} aria-hidden /> },
    { id: 'answers', label: 'Answers', icon: <ChartPie size={15} aria-hidden /> },
    { id: 'alerts', label: 'Alerts', icon: <BellRing size={15} aria-hidden />, count: alertCount },
    { id: 'analytics', label: 'Analytics', icon: <ChartNoAxesCombined size={15} aria-hidden />, count: siteCount },
    { id: 'plan', label: 'Plan', icon: <CreditCard size={15} aria-hidden /> },
  ]

  return (
    <div className="flex flex-col gap-2">
      <div className="-mb-2">
      <ServiceHeader
        icon={LayoutDashboard}
        title="Overview"
        status={{ tone: live.length ? 'live' : 'idle', text: live.length ? `${live.length} live key${live.length === 1 ? '' : 's'}` : 'no key yet' }}
        docs={docsPage('api-keys')}
      >
        <span className="inline-flex items-center gap-2" data-testid="you-title">
          <KitPill tone="warn" className="!h-[18px] !min-h-0 !py-0">YOU</KitPill>
          <span className="font-mono text-[11px] text-faint">your keys, alerts and traffic only</span>
          <RefreshChip error={shown ? up.error : null} onRetry={reloadUsage} />
          <RefreshChip error={alerts.refreshErr} onRetry={alerts.load} />
        </span>
      </ServiceHeader>
      </div>
      <PendingInvites />
      <GetStarted account={account} alerts={alerts.view} analytics={gaS.state === 'ok' ? gaS.data : gaS.state === 'error' ? 'error' : null} go={go} createKey={createKey} createAlert={createAlert} />
      {/* Live network data first, so even a brand-new workspace opens on moving charts. */}
      <MarketBand onPick={() => go('tracker')} />
      <ToolsRow />

      {/* ---------------------------------------------------------------- KPIs */}
      {/* 1, 2 or 4 cards a row by the content width (never 3 + 1). */}
      <div className="@container">
      <section aria-label="Summary" className="grid grid-cols-1 gap-2 @min-[440px]:grid-cols-2 @min-[740px]:grid-cols-4">
        <Kpi
          i={0}
          label={`Requests · ${range}`}
          color="#d9b563"
          value={usage ? usage.rangeTotals.total : null}
          none={account.keys.length ? `none in ${range}` : 'none yet'}
          spark={usage ? grouped.map((g) => g.total) : undefined}
          unreadable={usageErr}
          note={usage ? `${fmt(usage.today.total)} today (UTC) · ${fmt(usage.last7d.total)} in 7 days` : 'reading usage…'}
          delta={usage ? <Delta cur={usage.rangeTotals.total} prev={usage.previous?.total ?? null} /> : null}
        />
        <Kpi
          i={1}
          label="Calls turned away"
          color={LIMITED_COLOR}
          value={usage ? usage.rangeTotals.limited : null}
          none="none"
          delta={usage ? <Delta cur={usage.rangeTotals.limited} prev={usage.previous?.limited ?? null} upIsBad /> : null}
          spark={usage && hasLimited ? grouped.map((g) => g.limited ?? 0) : undefined}
          unreadable={usageErr}
          note={usage ? (usage.rangeTotals.total ? `${((usage.rangeTotals.limited / usage.rangeTotals.total) * 100).toFixed(2)}% of calls` : 'no calls in this range') : '…'}
        />
        <Kpi
          i={2}
          label={`Alerts fired · ${range}`}
          color={BLUE}
          value={fired ? fired.length : alerts.view && !alerts.view.alerts.length ? 0 : null}
          none={alerts.view?.alerts.length ? 'none' : 'none yet'}
          spark={fired && grouped.length ? bucketize(fired.map((f) => f.at), grouped) : undefined}
          unreadable={alerts.err}
          note={alerts.view ? (alerts.view.alerts.length ? (fired ? `${fired.filter((f) => f.telegram).length} via Telegram · from the delivery logs` : 'from the delivery logs') : 'no alerts set up') : '…'}
        />
        <Kpi i={3} label="Active keys" color="#949daa" value={live.length} none="none yet" note={`of ${account.limits.maxKeys} allowed${shown ? ` · ${usedInRange} used in ${range}` : ''}`} />
      </section>
      </div>

      <SubTabs items={tabs} value={sub} onChange={setSub} label="Overview sections" idBase="ov" />
      <SubPanel idBase="ov" value={sub}>
      {sub === 'requests' && (
      <div className="flex flex-wrap items-stretch gap-2">
        {/* ---------------------------------------------------------- requests */}
        <section aria-labelledby="ov-req" className={`${panel} flex-[999_1_520px]`} style={rise(1)}>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <h2 id="ov-req" className={`${panelTitle} flex items-center gap-2`}>
              Requests
              <span tabIndex={0} role="note" aria-label="Counts requests made with your keys that reached our servers. Answers served from Cloudflare's edge cache never reach us and are not counted. Hours are in your time zone; days are UTC." title="Counts requests made with your keys that reached our servers. Answers served from Cloudflare's edge cache never reach us and are not counted. Hours are in your time zone; days are UTC." className="grid size-5 cursor-help place-items-center text-faint hover:text-gold">
                <Info size={14} aria-hidden />
              </span>
            </h2>
            {series.length > 0 && (
              <ul className="m-0 flex list-none flex-wrap gap-x-3 gap-y-1 p-0 text-[12px] text-muted">
                {series.map((s) => (
                  <li key={s.id} className="flex items-center gap-[6px]">
                    <span className="size-[10px] rounded-[3px]" style={{ background: s.color }} aria-hidden />
                    {s.name}
                  </li>
                ))}
                {hasLimited && (
                  <li className="flex items-center gap-[6px]">
                    <span className="h-[3px] w-[10px] rounded-[1px]" style={{ background: LIMITED_COLOR }} aria-hidden />
                    turned away
                  </li>
                )}
              </ul>
            )}
            <Periods value={range} onChange={setRange} />
          </div>
          {!account.keys.length ? (
            <GhostCurves height={170} title="Your traffic will draw here">
              <KeyRound size={22} className="text-gold" aria-hidden />
              <span className="max-w-[440px] text-[13px] text-muted">
                A key works the moment it is created: {fmt(account.limits.keyPerMin)} requests a minute instead of {fmt(account.limits.anonymousPerMin)}. Its traffic shows up here.
              </span>
              <Can cat="keys" what="create keys">
                <button type="button" onClick={createKey} className={pillGold}>
                  <Plus size={16} aria-hidden /> Create your first key
                </button>
              </Can>
            </GhostCurves>
          ) : usageErr && !shown ? (
            <ErrorLine onRetry={reloadUsage}>Usage could not be read: {usageErr}</ErrorLine>
          ) : !shown ? (
            <Skeleton h={170} />
          ) : !shown.rangeTotals.total && !shown.previous?.total ? (
            <GhostCurves height={170} title="Your traffic will draw here">
              <span className="max-w-[440px] text-[13px] text-muted">
                No calls with your keys in the last {RANGE_LABEL[shown.range]}. Send one with <code className="font-mono text-[12px] text-ink-2">Authorization: Bearer</code> and your key and it charts here, per key, within the hour.
              </span>
            </GhostCurves>
          ) : (
            <div className={`transition-opacity ${stale ? 'opacity-60' : ''}`} aria-busy={stale} data-testid="requests-chart">
              <RequestsChart usage={shown} series={series} />
              <div className="mt-2 flex flex-wrap justify-between gap-2 font-mono text-[11px] text-faint">
                <span>
                  {RANGE_LABEL[shown.range]} · per {shown.range === '7d' ? '6 hours' : shown.bucket}
                </span>
                <span>{shown.previous ? `previous ${RANGE_LABEL[shown.range]}: ${fmt(shown.previous.total)} requests (dashed: its average per bucket)` : 'previous period: not fully counted yet'}</span>
              </div>
            </div>
          )}
          {!!account.keys.length && !live.length && (
            <p className="m-0 flex flex-wrap items-center justify-between gap-2 rounded-[10px] border border-gold-line bg-[rgba(217,181,99,.06)] px-3 py-2 text-[13px] text-ink-2">
              Every key is revoked. Create a new one to keep calling at the keyed limit.
              <Can cat="keys" what="create keys">
                <button type="button" onClick={createKey} className={pillGoldLine}>
                  <Plus size={14} aria-hidden /> Create a key
                </button>
              </Can>
            </p>
          )}
        </section>

        {/* ------------------------------------------------------------ limits */}
        <section aria-labelledby="ov-limits" className={`${panel} flex-[1_1_360px] gap-2`} style={rise(2)}>
          <h2 id="ov-limits" className={panelTitle}>
            Limits · {account.plan.name}
          </h2>
          <div className="flex flex-wrap items-center gap-3">
            <DoubleRing size={104} outer={ringOuter} inner={ringInner} label={`Busiest key averaged ${busiest ? busiest.perMin.toFixed(1) : 'unknown'} calls a minute over one ${busiest?.over ?? 'bucket'}, against a limit of ${limit} per key; ${alertUsed ?? 'unknown'} of ${alertMax} alerts in use.`}>
              <span className="flex flex-col">
                <span className="font-display text-[22px] leading-none font-bold">{ringOuter === null ? '—' : ringOuter > 0 && ringOuter < 1 ? '<1%' : `${Math.round(ringOuter)}%`}</span>
                <span className="text-[11px] text-dim">of limit</span>
              </span>
            </DoubleRing>
            <dl className="m-0 flex min-w-0 flex-col gap-[10px] text-[13px]">
              <div>
                <dt className="text-[11px] text-dim">Busiest key, avg calls / min over one {busiest?.over ?? 'hour'}</dt>
                <dd className="m-0 font-mono">
                  <span className="text-gold">{busiest ? (busiest.perMin < 10 ? busiest.perMin.toFixed(1) : fmt(Math.round(busiest.perMin))) : usageErr ? 'unreadable' : '…'}</span> / {fmt(limit)}
                </dd>
              </div>
              <div>
                <dt className="text-[11px] text-dim">Alerts used</dt>
                <dd className="m-0 font-mono">
                  <span style={{ color: BLUE }}>{alertUsed ?? (alerts.err ? 'unreadable' : '…')}</span> / {alertMax}
                </dd>
              </div>
              <div>
                <dt className="text-[11px] text-dim">History · keys</dt>
                <dd className="m-0 font-mono">
                  {account.plan.historyDays} days · {live.length} / {account.limits.maxKeys}
                </dd>
              </div>
            </dl>
          </div>
          <InfoTip summary="Per key, per minute; the busiest hour's average.">The limit is per key, per minute. Usage is recorded hourly, so this is the busiest hour&apos;s average, not a one-minute peak.</InfoTip>
          <button type="button" onClick={() => go('billing')} className={pillGoldLine}>
            {account.plan.id === 'free' ? 'Upgrade' : 'Extend or upgrade'}
          </button>
        </section>
      </div>
      )}

      {/* ------------------------------------------------- status and endpoints */}
      {sub === 'answers' && !account.keys.length && (
        <GhostCurves height={170} title="Your answers will draw here">
          <span className="max-w-[440px] text-[13px] text-muted">Answers by status and by endpoint chart here once a key makes its first call.</span>
        </GhostCurves>
      )}
      {sub === 'answers' && !!account.keys.length && (
        <div className="flex flex-wrap items-stretch gap-2">
          <section aria-labelledby="ov-status" className={`${panel} min-h-[250px] flex-[1_1_380px]`} style={rise(2)} data-testid="status-donut">
            <h2 id="ov-status" className={panelTitle}>
              Answers by status · {range}
            </h2>
            {usageErr && !shown ? <ErrorLine onRetry={reloadUsage}>Usage could not be read: {usageErr}</ErrorLine> : !shown ? <Skeleton h={180} /> : <StatusDonut byStatus={shown.byStatus} />}
          </section>
          <section aria-labelledby="ov-ep" className={`${panel} min-h-[250px] flex-[1_1_380px]`} style={rise(3)} data-testid="endpoint-bars">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 id="ov-ep" className={panelTitle}>
                Requests by endpoint · {range}
              </h2>
              {shown?.endpointsSince && <span className={mono}>counted since {new Date(shown.endpointsSince).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>}
            </div>
            {usageErr && !shown ? <ErrorLine onRetry={reloadUsage}>Usage could not be read: {usageErr}</ErrorLine> : !shown ? <Skeleton h={120} /> : <EndpointBars byEndpoint={shown.byEndpoint} since={shown.endpointsSince} />}
          </section>
        </div>
      )}

      {sub === 'alerts' && (
        <section aria-labelledby="ov-alerts" className={panel} style={rise(1)}>
          <div className="flex items-center justify-between gap-3">
            <h2 id="ov-alerts" className={panelTitle}>
              <button type="button" onClick={() => go('alerts')} className="min-h-11 hover:text-gold">
                Alerts
              </button>
            </h2>
            <Can cat="alerts" what="create alerts">
              <button type="button" onClick={createAlert} disabled={!!alerts.view && alerts.view.limits.used >= alerts.view.limits.max} className={pillLine}>
                <Plus size={15} aria-hidden /> New alert
              </button>
            </Can>
          </div>
          {alerts.err && !alerts.view ? (
            <ErrorLine onRetry={alerts.load}>Alerts could not be read: {alerts.err}</ErrorLine>
          ) : !alerts.view ? (
            <>
              <Skeleton h={62} />
              <Skeleton h={48} />
            </>
          ) : (
            <>
              <TelegramCard info={alerts.view.telegram} reload={alerts.load} compact />
              {!alerts.view.alerts.length ? (
                <div className="flex flex-col items-start gap-2 border-t border-line pt-3">
                  <b className="font-semibold">No alerts yet</b>
                  <span className="text-[13px] text-muted">
                    Get a webhook{alerts.view.telegram.enabled ? ' or a Telegram message' : ''} when a stock&apos;s gap to its fair price crosses your line. {alerts.view.limits.max} on {alerts.view.limits.planName}.
                  </span>
                  <Can cat="alerts" what="create alerts">
                    <button type="button" onClick={createAlert} className={pillGold}>
                      <Plus size={15} aria-hidden /> Create your first alert
                    </button>
                  </Can>
                </div>
              ) : (
                <ul className="m-0 flex list-none flex-col gap-[10px] p-0">
                  {alerts.view.alerts.slice(0, 4).map((a) => {
                    const st = alertState(a)
                    return (
                      <li key={a.id} className="flex min-h-12 flex-wrap items-center gap-[10px] border-t border-line pt-[10px]">
                        <span className="flex min-w-0 flex-[1_1_160px] flex-col">
                          <b className="font-semibold">{alertName(a)}</b>
                          <span className="font-mono text-[11px] text-faint">{alertRule(a)}</span>
                        </span>
                        <ChannelChips a={a} telegram={alerts.view!.telegram} act={actions.act} busy={actions.busy} />
                        <span className="font-mono text-[11px]" style={{ color: st.c }}>
                          {st.t}
                        </span>
                      </li>
                    )
                  })}
                  {alerts.view.alerts.length > 4 && (
                    <li className="border-t border-line pt-[10px]">
                      <button type="button" onClick={() => go('alerts')} className="inline-flex min-h-11 items-center gap-1 text-[13px] text-gold hover:underline">
                        All {alerts.view.alerts.length} alerts <ArrowUpRight size={13} aria-hidden />
                      </button>
                    </li>
                  )}
                </ul>
              )}
            </>
          )}
          <SecretDialog secret={actions.secret} onClose={() => actions.setSecret(null)} />
        </section>
      )}

      {/* --------------------------------------------------------- analytics */}
      {sub === 'analytics' && <AnalyticsCard s={gaS} go={() => go('analytics')} />}

      {/* --------------------------------------------------------------- pay */}
      {sub === 'plan' && <PayStrip s={billS} account={account} checkout={checkout} />}
      </SubPanel>
    </div>
  )
}

function AnalyticsCard({ s, go }: { s: Load<AnalyticsView>; go: () => void }) {
  const a = s.state === 'ok' ? s.data.account : null
  const siteKey = a?.sites.map((x) => x.id).join() ?? ''
  const [usage, setUsage] = useState<AnalyticsUsage | { error: string } | null>(null)
  useEffect(() => {
    if (!siteKey) return
    let alive = true
    api<AnalyticsUsage>('/api/developer/analytics/usage').then((r) => alive && setUsage(r.ok ? r.data : { error: r.error }))
    return () => {
      alive = false
    }
  }, [siteKey])
  const total = a ? a.sites.reduce((t, x) => t + x.eventsThisMonth, 0) : 0
  const slots = a?.plan ? a.plan.sites - a.sites.length : 0
  return (
    <section aria-labelledby="ov-ga" className={panel} style={rise(1)}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="ov-ga" className={panelTitle}>
          <button type="button" onClick={go} className="min-h-11 text-left hover:text-gold">
            Gully Analytics{a ? ` · ${a.state === 'lapsed' ? 'ended' : (a.plan?.name ?? '')}` : ''}
          </button>
        </h2>
        {a?.plan && (
          <span className={mono}>
            {a.sites.length} / {a.plan.sites} sites
          </span>
        )}
      </div>
      {s.state === 'loading' ? (
        <>
          <Skeleton h={8} />
          <Skeleton h={48} />
        </>
      ) : s.state === 'error' ? (
        <ErrorLine>Gully Analytics could not be read: {s.message}</ErrorLine>
      ) : !a ? (
        <div className="flex flex-col items-start gap-2">
          <span className="text-[13px] leading-[1.55] text-muted">Page views plus wallet connects, chains and transactions for your dapp. Cookie-free, one script tag with data-web3.</span>
          {s.data.configured ? (
            <button type="button" onClick={go} className={pillGold}>
              <ChartNoAxesCombined size={16} aria-hidden /> {s.data.trialAvailable ? `Start the ${s.data.offer.analytics.trialDays}-day free trial` : 'Set up Gully Analytics'}
            </button>
          ) : (
            <span className="text-[13px] text-faint">Analytics is not available on this server yet.</span>
          )}
        </div>
      ) : (
        <>
          <EventsMeter account={a} />
          {a.sites.map((site) => {
            const u = usage === null ? 'loading' : 'error' in usage ? ({ id: site.id, ok: false, error: usage.error } as const) : usage.sites.find((x) => x.id === site.id)
            return (
              <div key={site.id} className="flex min-h-12 items-center gap-3 border-t border-line pt-[10px]">
                <span className="flex min-w-0 flex-1 flex-col">
                  <b className="truncate font-semibold">{site.domain}</b>
                  <span className="truncate text-[12px] text-dim">{siteMeta(site, u)}</span>
                </span>
                <span className="w-[80px] shrink-0 max-[420px]:hidden">
                  <Meter value={total ? Math.round((site.eventsThisMonth / total) * 1000) : 0} max={1000} label={`${site.domain}: share of this month’s events`} />
                </span>
                <ExtLink href={site.dashboardUrl} className="inline-flex min-h-11 shrink-0 items-center gap-1 px-1 text-[13px] text-gold hover:text-gold-hover">
                  Open
                </ExtLink>
              </div>
            )
          })}
          {a.state !== 'lapsed' && slots > 0 && (
            <button type="button" onClick={go} className="flex min-h-12 items-center gap-3 border-t border-line pt-[10px] text-left">
              <span className="flex min-w-0 flex-1 flex-col">
                <b className="font-semibold text-gold">{a.sites.length ? 'Add a site' : 'Add your first site'}</b>
                <span className="text-[12px] text-dim">
                  {slots} of {a.plan!.sites} slot{a.plan!.sites === 1 ? '' : 's'} left · get the snippet
                </span>
              </span>
              <Plus size={16} className="text-gold" aria-hidden />
            </button>
          )}
          {a.state === 'lapsed' && (
            <button type="button" onClick={go} className={pillGoldLine}>
              Choose a plan to record again
            </button>
          )}
        </>
      )}
    </section>
  )
}

function PayStrip({ s, account, checkout }: { s: Load<BillingView>; account: Account; checkout: (plan: PlanId, asset: string | null) => void }) {
  const offer = s.state === 'ok' ? s.data.offer : null
  const [asset, setAsset] = useState<string | null>(null)
  const assetId = offer ? defaultAsset(offer.assets, asset) : null
  if (s.state === 'loading') return <Skeleton h={120} />
  if (s.state === 'error') return <ErrorLine>Plans could not be read: {s.message}</ErrorLine>
  const o = s.data.offer
  const paid = o.plans.filter((p) => p.priceUsdc > 0).sort((a, b) => a.priceUsdc - b.priceUsdc)
  const target = paid.find((p) => p.id === account.plan.id) ?? paid[0]
  if (!target) return null
  const extending = target.id === account.plan.id
  const cur = o.assets.find((a) => a.id === assetId) ?? null
  return (
    <section id="pay" aria-labelledby="ov-pay" className={`${panel} flex-row flex-wrap items-center gap-4`} style={rise(1)}>
      <div className="flex flex-[1_1_260px] flex-col gap-1">
        <h2 id="ov-pay" className={panelTitle}>
          {extending ? `Extend ${target.name} by ${o.periodDays} days` : `Upgrade to ${target.name} · ${o.periodDays} days`}
        </h2>
        <span className="text-[13px] leading-[1.5] text-muted">
          {extending ? '' : `${fmt(target.perMin)} calls a minute per key, ${target.alerts} alerts, ${target.historyDays} days of history. `}Pay from your wallet to ours. Confirmed on chain, no custody, nothing renews by itself.
        </span>
        {!o.checkout.enabled && (
          <span className="text-[12px] text-faint" role="status">
            {o.checkout.reason}
          </span>
        )}
      </div>
      <div className="min-w-0 flex-[2_1_420px]">
        <ChainAssetChips assets={o.assets} value={assetId} onChange={setAsset} />
      </div>
      <div className="flex flex-[1_1_220px] flex-col items-end gap-2 max-[600px]:items-stretch">
        <span className="font-display text-[32px] leading-none font-bold" aria-live="polite">
          {priceText(cur, target.priceUsdc)}
        </span>
        {cur?.kind === 'native' && <span className="font-mono text-[11px] text-faint">priced from Chainlink when the quote opens</span>}
        <Can cat="billing" what="pay for plans">
          <button type="button" disabled={!o.checkout.enabled || !cur} onClick={() => checkout(target.id, assetId)} className={`${pillGold} px-5`}>
            {o.checkout.enabled ? `Pay on ${cur?.chain ?? '…'}` : 'Not on sale yet'}
          </button>
        </Can>
      </div>
    </section>
  )
}
