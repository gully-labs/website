import { ArrowUpRight, ChartNoAxesCombined, KeyRound, Plus } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { ChannelChips, SecretDialog, TelegramCard } from './Alerts'
import { EventsMeter } from './Analytics'
import { alertName, alertRule, alertState, defaultAsset, keyColors, priceText, siteMeta, useAlertActions, useAlertsView } from './helpers'
import { api, type Account, type AnalyticsUsage, type AnalyticsView, type BillingView, type PlanId, type Range, type Usage } from './api'
import { DoubleRing, Meter, RequestBars, Spark, type BarSeries } from './charts'
import { ErrorLine, Skeleton } from './parts'
import { ChainAssetChips } from './PayFlow'
import { BLUE, chip, LIMITED_COLOR, mono, panel, panelTitle, pillGold, pillGoldLine, pillLine, rise } from './styles'
import { bucketize, busiestKeyRate, columns, firings, group, RANGE_LABEL } from './usage'

/* The Overview tab of the console: four KPI cards, requests per key (stacked bars), plan limits (the
   double ring), alerts with the Telegram card, Gully Analytics sites and the "extend your plan" pay
   strip. Each card reads its own endpoint and shows its own loading, empty and unreadable states:
     /api/developer/usage?range=…   requests, 429s, busiest key
     /api/developer/alerts          alerts, Telegram, firings (from the delivery logs)
     /api/developer/analytics       Gully Analytics account, sites, events (+ /usage for views)
     /api/developer/billing         plans, chains and assets for the pay strip */

const fmt = (n: number) => n.toLocaleString('en-US')

type Load<T> = { state: 'loading' } | { state: 'error'; message: string } | { state: 'ok'; data: T }

function useGet<T>(path: string | null, every = 0): [Load<T>, () => void] {
  const [s, set] = useState<Load<T>>({ state: 'loading' })
  const alive = useRef(true)
  const load = useCallback(() => {
    if (!path) return
    api<T>(path).then((r) => alive.current && set((prev) => (r.ok ? { state: 'ok', data: r.data } : prev.state === 'ok' ? prev : { state: 'error', message: r.error })))
  }, [path])
  useEffect(() => {
    alive.current = true
    load()
    const id = every ? setInterval(load, every) : 0
    return () => {
      alive.current = false
      if (id) clearInterval(id)
    }
  }, [load, every])
  return [s, load]
}

/* ------------------------------------------------------------------ KPI card --- */

function Kpi({ label, value, note, spark, color, i, unreadable }: { label: string; value: ReactNode; note: ReactNode; spark?: number[]; color: string; i: number; unreadable?: string | null }) {
  return (
    <div className="flex min-w-0 flex-col gap-1 rounded-[14px] border border-line bg-surface px-4 py-[14px]" style={{ animation: `gl-rise .5s ${i * 0.05}s cubic-bezier(.2,.8,.2,1) both` }}>
      <span className="text-[12px] text-dim">{label}</span>
      <span className="flex items-end justify-between gap-2">
        {unreadable ? (
          <span className="font-display text-[34px] leading-none font-bold text-faint" title={unreadable}>
            —
          </span>
        ) : value === null ? (
          <Skeleton h={34} w="55%" />
        ) : (
          <span className="font-display text-[34px] leading-none font-bold">{value}</span>
        )}
        {spark && !unreadable && <Spark values={spark} color={color} />}
      </span>
      <span className={`truncate font-mono text-[11px] ${unreadable ? 'text-error' : 'text-muted'}`}>{unreadable ? 'unreadable right now' : note}</span>
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
        <button key={o} data-v={o} type="button" role="radio" aria-checked={value === o} tabIndex={value === o ? 0 : -1} onClick={() => onChange(o)} className={`${chip(value === o, true)} min-h-[30px] border-0 px-3 text-[11px] max-[600px]:min-h-11`}>
          {o}
        </button>
      ))}
    </div>
  )
}

/* -------------------------------------------------------------------- page --- */

export function Overview({ account, go, createKey, createAlert, checkout }: { account: Account; go: (tab: 'keys' | 'alerts' | 'analytics' | 'billing') => void; createKey: () => void; createAlert: () => void; checkout: (plan: PlanId, asset: string | null) => void }) {
  const [range, setRange] = useState<Range>('24h')
  const [usageS, reloadUsage] = useGet<Usage>(`/api/developer/usage?range=${range}`, 60_000)
  const alerts = useAlertsView()
  const actions = useAlertActions(alerts.load)
  const [gaS] = useGet<AnalyticsView>('/api/developer/analytics')
  const [billS] = useGet<BillingView>('/api/developer/billing')

  const usage = usageS.state === 'ok' && usageS.data.range === range ? usageS.data : null
  const stale = usageS.state === 'ok' && usageS.data.range !== range
  const shown = usageS.state === 'ok' ? usageS.data : null
  const grouped = useMemo(() => (shown ? group(shown) : []), [shown])
  const cols = useMemo(() => (shown ? columns(shown, grouped) : []), [shown, grouped])
  const hasLimited = grouped.length > 0 && grouped.every((g) => g.limited !== undefined)

  const series: BarSeries[] = useMemo(() => {
    const names = Object.fromEntries((shown?.keys ?? account.keys).map((k) => [k.id, k.name]))
    const used = new Set(grouped.flatMap((g) => Object.keys(g.keys)))
    const colors = keyColors(account.keys)
    return [...account.keys].sort((a, b) => Number(!!a.revokedAt) - Number(!!b.revokedAt) || a.createdAt.localeCompare(b.createdAt)).filter((k) => !k.revokedAt || used.has(k.id)).map((k) => ({ id: k.id, name: (names[k.id] ?? k.name) + (k.revokedAt ? ' (revoked)' : ''), color: colors[k.id] }))
  }, [shown, grouped, account.keys])

  const live = account.keys.filter((k) => !k.revokedAt)
  const usedInRange = shown ? new Set(grouped.flatMap((g) => Object.entries(g.keys).filter(([, v]) => v > 0).map(([k]) => k))).size : 0
  const from = grouped.length ? Date.parse(grouped[0].t) : 0
  const fired = alerts.view && grouped.length ? firings(alerts.view, from) : null
  const usageErr = usageS.state === 'error' ? usageS.message : null

  const busiest = shown ? busiestKeyRate(shown) : null
  const limit = account.limits.keyPerMin
  const ringOuter = busiest ? (busiest.perMin / limit) * 100 : null
  const alertMax = alerts.view?.limits.max ?? account.plan.alerts
  const alertUsed = alerts.view?.limits.used ?? null
  const ringInner = alertUsed !== null && alertMax ? (alertUsed / alertMax) * 100 : null

  return (
    <div className="flex flex-col gap-[14px]">
      {/* ---------------------------------------------------------------- KPIs */}
      <section aria-label="Summary" className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,220px),1fr))] gap-3">
        <Kpi i={0} label={`Requests · ${range}`} color="#e8c060" value={usage ? fmt(usage.rangeTotals.total) : null} spark={usage ? grouped.map((g) => g.total) : undefined} unreadable={usageErr} note={usage ? `${fmt(usage.today.total)} today (UTC) · ${fmt(usage.last7d.total)} in 7 days` : 'reading usage…'} />
        <Kpi
          i={1}
          label="Rate-limited (429)"
          color={LIMITED_COLOR}
          value={usage ? fmt(usage.rangeTotals.limited) : null}
          spark={usage && hasLimited ? grouped.map((g) => g.limited ?? 0) : undefined}
          unreadable={usageErr}
          note={usage ? (usage.rangeTotals.total ? `${((usage.rangeTotals.limited / usage.rangeTotals.total) * 100).toFixed(2)}% of calls` : 'no calls in this range') : '…'}
        />
        <Kpi
          i={2}
          label={`Alerts fired · ${range}`}
          color={BLUE}
          value={fired ? fmt(fired.length) : alerts.view && !alerts.view.alerts.length ? '0' : null}
          spark={fired ? bucketize(fired.map((f) => f.at), grouped) : undefined}
          unreadable={alerts.err}
          note={alerts.view ? (alerts.view.alerts.length ? `${fired ? fired.filter((f) => f.telegram).length : 0} via Telegram · from the delivery logs` : 'no alerts set up') : '…'}
        />
        <Kpi i={3} label="Active keys" color="#8a96a6" value={String(live.length)} note={`of ${account.limits.maxKeys} allowed${shown ? ` · ${usedInRange} used in ${range}` : ''}`} />
      </section>

      <div className="flex flex-wrap items-start gap-[14px]">
        {/* ---------------------------------------------------------- requests */}
        <section aria-labelledby="ov-req" className={`${panel} flex-[999_1_560px]`} style={rise(1)}>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <h2 id="ov-req" className={panelTitle}>
              Requests
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
                    429s (inside the bars)
                  </li>
                )}
              </ul>
            )}
            <Periods value={range} onChange={setRange} />
          </div>
          {!account.keys.length ? (
            <div className="flex min-h-[240px] flex-col items-center justify-center gap-3 rounded-[12px] border border-dashed border-line-strong px-6 py-8 text-center">
              <KeyRound size={26} className="text-gold" aria-hidden />
              <b className="text-[16px] font-semibold">No keys yet, so no requests to chart</b>
              <span className="max-w-[440px] text-[14px] text-muted">
                A key works the moment it is created: {fmt(account.limits.keyPerMin)} requests a minute instead of {fmt(account.limits.anonymousPerMin)}. Its traffic shows up here.
              </span>
              <button type="button" onClick={createKey} className={pillGold}>
                <Plus size={16} aria-hidden /> Create your first key
              </button>
            </div>
          ) : usageErr && !shown ? (
            <ErrorLine onRetry={reloadUsage}>Usage could not be read: {usageErr}</ErrorLine>
          ) : !shown ? (
            <Skeleton h={240} />
          ) : (
            <div className={`transition-opacity ${stale ? 'opacity-50' : ''}`} aria-busy={stale}>
              <RequestBars columns={cols} series={series} showLimited={hasLimited} animKey={`${shown.range}-${shown.points[0]?.t}`} />
              <div className="mt-2 flex justify-between gap-2 font-mono text-[10px] text-faint">
                <span>{cols[0]?.label}</span>
                <span>{RANGE_LABEL[shown.range]} · per {shown.range === '7d' ? '6 hours' : shown.bucket}</span>
                <span>now</span>
              </div>
            </div>
          )}
          {!!account.keys.length && !live.length && (
            <p className="m-0 flex flex-wrap items-center justify-between gap-2 rounded-[10px] border border-gold-line bg-[rgba(232,192,96,.06)] px-3 py-2 text-[13px] text-ink-2">
              Every key is revoked. Create a new one to keep calling at the keyed limit.
              <button type="button" onClick={createKey} className={pillGoldLine}>
                <Plus size={14} aria-hidden /> Create a key
              </button>
            </p>
          )}
          <p className="m-0 text-[12px] leading-[1.55] text-faint">
            Counts requests made with your keys that reached our servers. Answers served from Cloudflare&apos;s edge cache never reach us and are not counted. Hours are in your time zone; days are UTC.
          </p>
        </section>

        {/* ------------------------------------------------------------ limits */}
        <section aria-labelledby="ov-limits" className={`${panel} flex-[1_1_300px] gap-[14px]`} style={rise(2)}>
          <h2 id="ov-limits" className={panelTitle}>
            Limits · {account.plan.name}
          </h2>
          <div className="flex flex-wrap items-center gap-[18px]">
            <DoubleRing outer={ringOuter} inner={ringInner} label={`Busiest key averaged ${busiest ? busiest.perMin.toFixed(1) : 'unknown'} calls a minute over one ${busiest?.over ?? 'bucket'}, against a limit of ${limit} per key; ${alertUsed ?? 'unknown'} of ${alertMax} alerts in use.`}>
              <span className="flex flex-col">
                <span className="font-display text-[26px] leading-none font-bold">{ringOuter === null ? '—' : ringOuter > 0 && ringOuter < 1 ? '<1%' : `${Math.round(ringOuter)}%`}</span>
                <span className="text-[10px] text-dim">of limit</span>
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
          <span className="text-[11px] leading-[1.5] text-faint">The limit is per key, per minute. Usage is recorded hourly, so this is the busiest hour&apos;s average, not a one-minute peak.</span>
          <button type="button" onClick={() => go('billing')} className={pillGoldLine}>
            {account.plan.id === 'free' ? 'Upgrade' : 'Extend or upgrade'}
          </button>
        </section>
      </div>

      <div className="flex flex-wrap items-start gap-[14px]">
        {/* ------------------------------------------------------------ alerts */}
        <section aria-labelledby="ov-alerts" className={`${panel} flex-[1_1_420px]`} style={rise(3)}>
          <div className="flex items-center justify-between gap-3">
            <h2 id="ov-alerts" className={panelTitle}>
              <button type="button" onClick={() => go('alerts')} className="min-h-11 hover:text-gold">
                Alerts
              </button>
            </h2>
            <button type="button" onClick={createAlert} disabled={!!alerts.view && alerts.view.limits.used >= alerts.view.limits.max} className={pillLine}>
              <Plus size={15} aria-hidden /> New alert
            </button>
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
              {actions.actErr && <ErrorLine>{actions.actErr}</ErrorLine>}
              {!alerts.view.alerts.length ? (
                <div className="flex flex-col items-start gap-2 border-t border-line pt-3">
                  <b className="font-semibold">No alerts yet</b>
                  <span className="text-[13px] text-muted">
                    Get a webhook{alerts.view.telegram.enabled ? ' or a Telegram message' : ''} when a stock&apos;s gap to its fair price crosses your line. {alerts.view.limits.max} on {alerts.view.limits.planName}.
                  </span>
                  <button type="button" onClick={createAlert} className={pillGold}>
                    <Plus size={15} aria-hidden /> Create your first alert
                  </button>
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

        {/* --------------------------------------------------------- analytics */}
        <AnalyticsCard s={gaS} go={() => go('analytics')} />
      </div>

      {/* --------------------------------------------------------------- pay */}
      <PayStrip s={billS} account={account} checkout={checkout} />
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
    <section aria-labelledby="ov-ga" className={`${panel} flex-[1_1_420px]`} style={rise(4)}>
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
            <span className="text-[13px] text-faint">Self-serve sign-up is not switched on on this server yet.</span>
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
                <a href={site.dashboardUrl} target="_blank" rel="noopener" className="inline-flex min-h-11 shrink-0 items-center gap-1 px-1 text-[13px] text-gold hover:text-gold-hover">
                  Open <ArrowUpRight size={12} aria-hidden />
                </a>
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
    <section id="pay" aria-labelledby="ov-pay" className={`${panel} flex-row flex-wrap items-center gap-5`} style={rise(5)}>
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
        <button type="button" disabled={!o.checkout.enabled || !cur} onClick={() => checkout(target.id, assetId)} className={`${pillGold} px-5`}>
          {o.checkout.enabled ? `Pay on ${cur?.chain ?? '…'}` : 'Not on sale yet'}
        </button>
      </div>
    </section>
  )
}
