import { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowUpRight } from 'lucide-react'
import type { DaySeries } from '../../components/charts/DayBars'
import { LiveDayBars } from './DailyChart'
import { C } from '../../components/charts/chartPresets'
import { adminCall } from './payAdmin'

/* Admin views over data the app already keeps: every alert and security monitor across accounts with the
   webhook delivery log (GET /api/admin/alerts), workspaces with teams (GET /api/admin/workspaces), and Chain
   Kit requests with the Gully Chains Devnet waitlist (GET /api/admin/chain-kit). Read-only, polled every
   60 s. Webhooks show their host only; no secrets, no chat ids. */

const card = 'flex min-w-0 flex-col gap-4 rounded-card border border-line bg-surface p-6 max-[600px]:p-4'
const h2 = 'm-0 font-display text-[22px] font-bold uppercase'
const small = 'font-mono text-[12px] text-faint'
const th = 'py-2 pr-3 font-medium'
const short = (a: string | null) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : '—')
const when = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      })
    : '—'

function usePolled<T>(token: string, path: string) {
  const [data, setData] = useState<T | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const load = useCallback(() => {
    adminCall<T>(token, path).then((r) => (r.ok ? (setData(r.data), setErr(null)) : setErr(r.error)))
  }, [token, path])
  useEffect(() => {
    load()
    const id = setInterval(load, 60_000)
    return () => clearInterval(id)
  }, [load])
  return { data, err }
}

/** Daily counts for the last `n` days (UTC), from timestamps, split by `key`. */
function perDay<T>(rows: T[], at: (r: T) => string | null, key: (r: T) => string, keys: string[], n: number) {
  const days: ({ day: string } & Record<string, number | string>)[] = []
  const today = Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate())
  for (let i = n - 1; i >= 0; i--)
    days.push({
      day: new Date(today - i * 86_400_000).toISOString().slice(0, 10),
      ...Object.fromEntries(keys.map((k) => [k, 0])),
    })
  const idx = new Map(days.map((d, i) => [d.day, i]))
  for (const r of rows) {
    const t = at(r)
    const i = t ? idx.get(t.slice(0, 10)) : undefined
    if (i === undefined) continue
    const k = key(r)
    days[i][k] = Number(days[i][k] ?? 0) + 1
  }
  return days
}

/** Live daily bars, or a 90 px ghost when the range has fewer than 2 days of data. */
function Daily({ days, series, unit, empty }: { days: ({ day: string } & Record<string, number | string>)[]; series: DaySeries[]; unit: string; empty: string }) {
  return (
    <>
      <LiveDayBars days={days} series={series} height={130} unit={unit} empty={empty} />
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {series.map((s) => (
          <span key={s.key} className="inline-flex items-center gap-2 font-mono text-[11px] text-muted">
            <i className="inline-block size-[8px] rounded-[2px]" style={{ background: s.color }} /> {s.label}
          </span>
        ))}
      </div>
    </>
  )
}

/* ------------------------------------------------------------------ alerts --- */

interface AlertRow {
  owner: string
  id: string
  name: string | null
  kind: string
  chain: string | null
  ticker: string | null
  condition: string | null
  enabled: boolean
  mutedUntil: string | null
  coveredByPlan: boolean
  telegram: boolean
  webhookHost: string | null
  createdAt: string
  lastFiredAt: string | null
  deliveries: number
  lastDelivery: {
    at: string
    channel: string
    ok: boolean
    status: number | null
  } | null
}
interface MonitorRow {
  workspace: string
  id: string
  name: string | null
  chain: string
  address: string
  explorer: string | null
  enabled: boolean
  coveredByPlan: boolean
  telegram: boolean
  webhookHost: string | null
  lastCheckedAt: string | null
  lastError: string | null
  events: number
  lastEventAt: string | null
}
interface LogRow {
  at: string
  owner: string
  id: string
  host: string | null
  ok: boolean
  status: number | null
  error: string | null
  ms: number | null
  test: boolean
  source: 'alert' | 'monitor'
}
interface AlertsView {
  alerts: AlertRow[]
  monitors: MonitorRow[]
  webhookLog: LogRow[]
  stats: { total: number; enabled: number; owners: number }
}

const LOG_SERIES: DaySeries[] = [
  { key: 'ok', label: 'Delivered', color: C.green },
  { key: 'failed', label: 'Failed', color: C.error },
]

export function AlertsAdmin({ token }: { token: string }) {
  const { data, err } = usePolled<AlertsView>(token, '/api/admin/alerts')
  const [showAll, setShowAll] = useState(false)
  const days = useMemo(
    () =>
      perDay(
        data?.webhookLog ?? [],
        (r) => r.at,
        (r) => (r.ok ? 'ok' : 'failed'),
        ['ok', 'failed'],
        14,
      ),
    [data],
  )
  const alerts = data ? (showAll ? data.alerts : data.alerts.slice(0, 25)) : []
  // The server sends mutedUntil only while the mute lasts (alerts.mjs view), and this list refreshes every minute.
  const muted = (a: AlertRow) => !!a.mutedUntil

  return (
    <>
      <section className={card} aria-labelledby="admin-alerts">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="admin-alerts" className={h2}>
            Alerts
          </h2>
          <span className={small}>{data ? `${data.stats.total} alerts · ${data.stats.enabled} on · ${data.stats.owners} accounts` : 'every account’s alerts'}</span>
        </div>
        {err && <p className="m-0 font-mono text-[12px] text-error">{err}</p>}
        {!data && !err && <span className={small}>Loading…</span>}
        {data && !data.alerts.length && <p className="m-0 text-[14px] text-muted">No alert has been set up yet.</p>}
        {data && data.alerts.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] border-collapse text-[13px]">
              <thead>
                <tr className="border-b border-line text-left font-mono text-[11px] tracking-[1px] text-faint">
                  <th className={th}>ACCOUNT</th>
                  <th className={th}>ALERT</th>
                  <th className={th}>DELIVERS TO</th>
                  <th className={th}>STATE</th>
                  <th className={th}>LAST FIRED</th>
                  <th className="py-2 font-medium">LAST DELIVERY</th>
                </tr>
              </thead>
              <tbody className="font-mono">
                {alerts.map((a) => (
                  <tr key={a.id} className="border-b border-line last:border-b-0">
                    <td className="py-2 pr-3 text-ink-2" title={a.owner}>
                      {short(a.owner)}
                    </td>
                    <td className="max-w-[260px] truncate py-2 pr-3 text-ink-2" title={a.condition ?? ''}>
                      {a.name ?? (a.ticker ? `${a.ticker}${a.chain ? ` · ${a.chain}` : ''}` : a.kind)} <span className="text-faint">· {a.condition ?? a.kind}</span>
                    </td>
                    <td className="py-2 pr-3 text-muted">{[a.telegram ? 'Telegram' : null, a.webhookHost].filter(Boolean).join(' + ') || '—'}</td>
                    <td className="py-2 pr-3 whitespace-nowrap">
                      {!a.enabled ? <span className="text-faint">paused</span> : muted(a) ? <span className="text-gold">muted to {when(a.mutedUntil)}</span> : <span className="text-green">on</span>}
                      {!a.coveredByPlan && <span className="text-gold"> · over plan</span>}
                    </td>
                    <td className="py-2 pr-3 whitespace-nowrap text-faint">{when(a.lastFiredAt)}</td>
                    <td className="py-2 whitespace-nowrap">
                      {a.lastDelivery ? (
                        <span className={a.lastDelivery.ok ? 'text-green' : 'text-error'}>
                          {a.lastDelivery.channel} {a.lastDelivery.ok ? 'sent' : `failed${a.lastDelivery.status ? ` (${a.lastDelivery.status})` : ''}`}{' '}
                          <span className="text-faint">· {when(a.lastDelivery.at)}</span>
                        </span>
                      ) : (
                        <span className="text-faint">none yet</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {data && data.alerts.length > 25 && (
          <button type="button" onClick={() => setShowAll((v) => !v)} className="min-h-11 self-start rounded-btn border border-line-strong px-4 font-mono text-[12px] text-ink-2 hover:border-gold">
            {showAll ? 'Show the newest 25' : `Show all ${data.alerts.length}`}
          </button>
        )}
      </section>

      <section className={card} aria-labelledby="admin-monitors">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="admin-monitors" className={h2}>
            Security monitors
          </h2>
          <span className={small}>{data ? `${data.monitors.length} contracts watched` : 'contracts watched for owner, admin and upgrade changes'}</span>
        </div>
        {data && !data.monitors.length && <p className="m-0 text-[14px] text-muted">No contract is being monitored yet.</p>}
        {data && data.monitors.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] border-collapse text-[13px]">
              <thead>
                <tr className="border-b border-line text-left font-mono text-[11px] tracking-[1px] text-faint">
                  <th className={th}>WORKSPACE</th>
                  <th className={th}>CONTRACT</th>
                  <th className={th}>DELIVERS TO</th>
                  <th className={th}>STATE</th>
                  <th className={th}>LAST CHECK</th>
                  <th className="py-2 font-medium">EVENTS</th>
                </tr>
              </thead>
              <tbody className="font-mono">
                {data.monitors.map((m) => (
                  <tr key={m.id} className="border-b border-line last:border-b-0">
                    <td className="py-2 pr-3 text-ink-2" title={m.workspace}>
                      {short(m.workspace)}
                    </td>
                    <td className="py-2 pr-3 whitespace-nowrap text-ink-2">
                      {m.explorer ? (
                        <a href={m.explorer} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center gap-1 hover:text-gold">
                          {m.name ?? short(m.address)} <span className="text-faint">· {m.chain}</span> <ArrowUpRight size={13} aria-hidden />
                          <span className="sr-only"> (opens in a new tab)</span>
                        </a>
                      ) : (
                        <>
                          {m.name ?? short(m.address)} <span className="text-faint">· {m.chain}</span>
                        </>
                      )}
                    </td>
                    <td className="py-2 pr-3 text-muted">{[m.telegram ? 'Telegram' : null, m.webhookHost].filter(Boolean).join(' + ') || '—'}</td>
                    <td className="py-2 pr-3 whitespace-nowrap">
                      {!m.enabled ? (
                        <span className="text-faint">paused</span>
                      ) : m.lastError ? (
                        <span className="text-error" title={m.lastError}>
                          error
                        </span>
                      ) : (
                        <span className="text-green">watching</span>
                      )}
                    </td>
                    <td className="py-2 pr-3 whitespace-nowrap text-faint">{when(m.lastCheckedAt)}</td>
                    <td className="py-2 whitespace-nowrap text-ink-2">
                      {m.events} <span className="text-faint">{m.lastEventAt ? `· last ${when(m.lastEventAt)}` : ''}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className={card} aria-labelledby="admin-webhook-log">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="admin-webhook-log" className={h2}>
            Alert webhook log
          </h2>
          <span className={small}>alert and monitor webhooks · last 14 days · host only</span>
        </div>
        <Daily days={days} series={LOG_SERIES} unit="webhook deliveries" empty="No webhook delivery in the last 14 days. New ones appear here as they are sent." />
        {data && data.webhookLog.length > 0 && (
          <div className="max-h-[360px] overflow-auto">
            <table className="w-full min-w-[640px] border-collapse text-[13px]">
              <thead>
                <tr className="border-b border-line text-left font-mono text-[11px] tracking-[1px] text-faint">
                  <th className={th}>WHEN</th>
                  <th className={th}>FROM</th>
                  <th className={th}>HOST</th>
                  <th className={th}>RESULT</th>
                  <th className="py-2 font-medium">TIME</th>
                </tr>
              </thead>
              <tbody className="font-mono">
                {data.webhookLog.slice(0, 100).map((r, i) => (
                  <tr key={`${r.id}-${r.at}-${i}`} className="border-b border-line last:border-b-0">
                    <td className="py-2 pr-3 whitespace-nowrap text-faint">{when(r.at)}</td>
                    <td className="py-2 pr-3 text-muted" title={r.owner}>
                      {r.source} · {short(r.owner)}
                    </td>
                    <td className="py-2 pr-3 text-ink-2">{r.host ?? '—'}</td>
                    <td className="max-w-[260px] truncate py-2 pr-3" title={r.error ?? ''}>
                      <span className={r.ok ? 'text-green' : 'text-error'}>{r.ok ? 'delivered' : 'failed'}</span>
                      {r.status ? <span className="text-faint"> · HTTP {r.status}</span> : null}
                      {r.test ? <span className="text-faint"> · test</span> : null}
                      {r.error ? <span className="text-faint"> · {r.error}</span> : null}
                    </td>
                    <td className="py-2 whitespace-nowrap text-faint">{r.ms == null ? '—' : `${r.ms} ms`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  )
}

/* -------------------------------------------------------------- workspaces --- */

interface WorkspacesView {
  workspaces: {
    id: string
    name: string
    members: number
    roles: Record<string, number>
    invites: number
    blocked: boolean
    lastSeenAt: string | null
  }[]
  accounts: number
}

export function WorkspacesAdmin({ token }: { token: string }) {
  const { data, err } = usePolled<WorkspacesView>(token, '/api/admin/workspaces')
  return (
    <section className={card} aria-labelledby="admin-workspaces">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="admin-workspaces" className={h2}>
          Workspaces
        </h2>
        <span className={small}>{data ? `${data.workspaces.length} teams of ${data.accounts} accounts · solo workspaces left out` : 'teams with members or invites'}</span>
      </div>
      {err && <p className="m-0 font-mono text-[12px] text-error">{err}</p>}
      {!data && !err && <span className={small}>Loading…</span>}
      {data && !data.workspaces.length && <p className="m-0 text-[14px] text-muted">Every workspace is still a one-wallet workspace: nobody has invited a teammate yet.</p>}
      {data && data.workspaces.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[620px] border-collapse text-[13px]">
            <thead>
              <tr className="border-b border-line text-left font-mono text-[11px] tracking-[1px] text-faint">
                <th className={th}>WORKSPACE</th>
                <th className={th}>OWNER</th>
                <th className={th}>MEMBERS</th>
                <th className={th}>OPEN INVITES</th>
                <th className="py-2 font-medium">LAST SEEN</th>
              </tr>
            </thead>
            <tbody className="font-mono">
              {data.workspaces.map((w) => (
                <tr key={w.id} className="border-b border-line last:border-b-0">
                  <td className="max-w-[220px] truncate py-2 pr-3 text-ink-2">
                    {w.name}
                    {w.blocked && <span className="text-error"> · owner blocked</span>}
                  </td>
                  <td className="py-2 pr-3 text-muted" title={w.id}>
                    {short(w.id)}
                  </td>
                  <td className="py-2 pr-3 text-ink-2">
                    {w.members}{' '}
                    <span className="text-faint">
                      (
                      {Object.entries(w.roles)
                        .map(([r, n]) => `${n} ${r}`)
                        .join(', ')}
                      )
                    </span>
                  </td>
                  <td className="py-2 pr-3 text-ink-2">{w.invites}</td>
                  <td className="py-2 whitespace-nowrap text-faint">{when(w.lastSeenAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

/* --------------------------------------------------------------- chain kit --- */

interface KitRow {
  at: string | null
  email: string | null
  chain: string | null
  workspace: string | null
  address: string | null
  status: string | null
  waitlist?: boolean
  via: 'app' | 'legacy'
}
interface KitView {
  stored: boolean
  requests: KitRow[]
  waitlist: KitRow[]
}

const KIT_SERIES: DaySeries[] = [
  { key: 'request', label: 'Chain Kit waitlist', color: C.gold },
  { key: 'waitlist', label: 'Devnet waitlist', color: '#5aa9e6' },
]

export function ChainKitAdmin({ token }: { token: string }) {
  const { data, err } = usePolled<KitView>(token, '/api/admin/chain-kit')
  const days = useMemo(() => {
    const rows = [...(data?.requests ?? []).map((r) => ({ at: r.at, k: 'request' })), ...(data?.waitlist ?? []).map((r) => ({ at: r.at, k: 'waitlist' }))]
    return perDay(
      rows,
      (r) => r.at,
      (r) => r.k,
      ['request', 'waitlist'],
      30,
    )
  }, [data])
  const list = (rows: KitRow[], kind: 'request' | 'waitlist') =>
    !rows.length ? (
      <p className="m-0 text-[14px] text-muted">{kind === 'request' ? 'Nobody is on the Chain Kit waitlist yet.' : 'Nobody is on the Devnet waitlist yet.'}</p>
    ) : (
      <ul className="m-0 flex max-h-[320px] list-none flex-col gap-2 overflow-y-auto p-0">
        {rows.map((r, i) => (
          <li key={`${r.email}-${r.at}-${i}`} className="flex flex-wrap items-center justify-between gap-2 rounded-input border border-line px-3 py-2 font-mono text-[12px]">
            <span className="flex min-w-0 flex-col">
              <a href={r.email ? `mailto:${r.email}` : undefined} className="inline-flex min-h-11 items-center truncate text-gold">
                {r.email ?? 'no email'}
              </a>
              {kind === 'request' && <span className="truncate text-muted">{r.chain ?? 'chain not given'}</span>}
            </span>
            <span className="text-faint">
              {r.workspace ? `${short(r.workspace)} · ` : r.address ? `${short(r.address)} · ` : ''}
              {r.via === 'legacy' ? (kind === 'request' ? 'contact form · ' : 'notify-me · ') : ''}
              {r.status ? `${r.status} · ` : ''}
              {when(r.at)}
            </span>
          </li>
        ))}
      </ul>
    )
  return (
    <section className={card} aria-labelledby="admin-chainkit">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="admin-chainkit" className={h2}>
          Chain Kit and Gully Chains
        </h2>
        <span className={small}>
          {data
            ? `${data.requests.length} on the Chain Kit waitlist · ${data.waitlist.length} on the Devnet waitlist${data.stored ? '' : ' · from the contact form and launch list'}`
            : 'the Chain Kit waitlist and the Devnet waitlist'}
        </span>
      </div>
      {err && <p className="m-0 font-mono text-[12px] text-error">{err}</p>}
      {!data && !err && <span className={small}>Loading…</span>}
      {data && (
        <>
          <Daily days={days} series={KIT_SERIES} unit="sign-ups" empty="No request or waitlist sign-up in the last 30 days." />
          <div className="grid grid-cols-2 gap-5 max-[900px]:grid-cols-1">
            <div className="flex min-w-0 flex-col gap-2">
              <h3 className="m-0 font-mono text-[12px] tracking-[1px] text-faint">CHAIN KIT WAITLIST</h3>
              {list(data.requests, 'request')}
            </div>
            <div className="flex min-w-0 flex-col gap-2">
              <h3 className="m-0 font-mono text-[12px] tracking-[1px] text-faint">DEVNET WAITLIST</h3>
              {list(data.waitlist, 'waitlist')}
            </div>
          </div>
        </>
      )}
    </section>
  )
}
