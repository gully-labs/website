import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router'
import { DayBars } from '../../components/charts/DayBars'
import { Wordmark } from '../../components/Wordmark'

/* The private admin dashboard. Everything comes from /api/admin/* behind ADMIN_TOKEN; the token is
   kept in this tab's sessionStorage only. Refreshes every 30 seconds. Not linked from the site. */

interface Overview {
  generatedAt: string
  tracker: {
    cacheAgeSeconds: number | null
    lastSnapshot: string | null
    chains: { key: string; name: string; stocks: number; lastPoolRead: string | null; backoffUntil: string | null; sessionOpen: boolean }[]
    history: { series: number; points: number }
    statuses: Record<string, number> | null
  }
  api: { since: string; anonymousLimitPerMin: number; anonymous: { requests: number; limited: number }; keys: { id: string; requests: number; limited: number; lastUsed: string | null }[]; days: { day: string; anonymous: number; keyed: number; limited: number }[]; liveWindows: number }
  venues: { generatedAt?: string; unread?: string[]; list?: { key: string; state: string; error: string | null }[]; error?: string }
  developers: { pending: number; approved: number; liveKeys: number; accounts?: number; blocked?: number }
  enquiries: { total: number; open: number }
  launchList: number
  process: { uptimeSeconds: number; rssMb: number; heapMb: number; node: string; dataDirBytes: number | null }
}
interface Req {
  id: string
  email: string
  project: string
  url: string | null
  use: string
  status: string
  createdAt: string
  decidedAt: string | null
  claimedAt: string | null
}
interface Key {
  id: string
  prefix: string
  name: string | null
  owner: string | null
  project: string | null
  email: string
  limit: number
  createdAt: string
  revokedAt: string | null
}
interface DevAccount {
  address: string
  createdAt: string
  lastLoginAt: string | null
  blocked: boolean
  blockedAt: string | null
  keys: number
  liveKeys: number
}
interface Billing {
  subscriptions: { address: string; plan: string; since: string | null; expiresAt: string; source: string | null; active: boolean }[]
  payments: { txHash: string; address: string; plan: string; amount: string; from: string; at: string; expiresAt: string }[]
  offer: { plans: { id: string; name: string; priceUsdc: number }[]; checkout: { enabled: boolean; treasury: string | null; reason?: string } }
  alerts: { total: number; enabled: number; owners: number }
}
interface Enquiry {
  id: string
  receivedAt: string
  name: string
  email: string
  message: string
  types: string[]
  budget: string
  handled?: boolean
}

const TOKEN = 'gully-admin-token'
const card = 'flex min-w-0 flex-col gap-4 rounded-card border border-line bg-surface p-6'
const h2 = 'm-0 font-display text-[22px] font-bold uppercase'
const small = 'font-mono text-[12px] text-faint'
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }) : '—')
const ago = (iso: string | null) => {
  if (!iso) return 'never'
  const s = Math.round((Date.now() - Date.parse(iso)) / 1000)
  return s < 90 ? `${s}s ago` : s < 5400 ? `${Math.round(s / 60)}m ago` : `${Math.round(s / 3600)}h ago`
}

function getToken() {
  try {
    return sessionStorage.getItem(TOKEN)
  } catch {
    return null
  }
}
function setToken(t: string | null) {
  try {
    if (t) sessionStorage.setItem(TOKEN, t)
    else sessionStorage.removeItem(TOKEN)
  } catch {
    /* private mode */
  }
}

function useAdmin(token: string | null) {
  const [data, setData] = useState<{ overview: Overview; requests: Req[]; keys: Key[]; accounts: DevAccount[]; enquiries: Enquiry[]; launch: { email: string; slot: string; addedAt: string }[]; billing: Billing } | null>(null)
  const [err, setErr] = useState<{ status: number; message: string } | null>(null)
  const load = useCallback(async () => {
    if (!token) return
    const get = async (p: string) => {
      const r = await fetch(p, { headers: { authorization: `Bearer ${token}` } })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) throw { status: r.status, message: d.error ?? `HTTP ${r.status}` }
      return d
    }
    try {
      const [overview, dev, enq, launch, billing] = await Promise.all([get('/api/admin/overview'), get('/api/admin/developers'), get('/api/admin/enquiries'), get('/api/admin/launch-list'), get('/api/admin/billing')])
      setData({ overview, requests: dev.requests, keys: dev.keys, accounts: dev.accounts ?? [], enquiries: enq.enquiries, launch: launch.rows, billing })
      setErr(null)
    } catch (e) {
      const x = e as { status?: number; message?: string }
      setErr({ status: x.status ?? 0, message: x.message ?? 'The server could not be reached.' })
    }
  }, [token])
  useEffect(() => {
    if (!token) return
    let alive = true
    const tick = () => alive && load()
    tick()
    const id = setInterval(tick, 30_000)
    return () => {
      alive = false
      clearInterval(id)
    }
  }, [token, load])
  return { data, err, reload: load }
}

function Tile({ k, v, note, tone }: { k: string; v: string; note?: string; tone?: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-1 bg-surface px-5 py-4" style={{ animation: 'gl-rise .45s ease both' }}>
      <span className="font-mono text-[10px] tracking-[1px] text-faint">{k}</span>
      <span className="font-display text-[30px] leading-none font-extrabold" style={{ color: tone }}>
        {v}
      </span>
      {note && <span className="truncate text-[12px] text-muted">{note}</span>}
    </div>
  )
}

function Login({ onToken, error }: { onToken: (t: string) => void; error: string | null }) {
  const [t, setT] = useState('')
  return (
    <main className="flex min-h-screen items-center justify-center bg-bg px-6">
      <form
        className="flex w-full max-w-[420px] flex-col gap-5 rounded-card border border-line bg-surface p-8"
        onSubmit={(e) => {
          e.preventDefault()
          if (t.trim()) onToken(t.trim())
        }}
      >
        <Wordmark size={26} />
        <div className="flex flex-col gap-1">
          <h1 className="m-0 font-display text-[30px] font-extrabold uppercase">Admin</h1>
          <span className="text-[14px] text-muted">Enter the admin token. It stays in this tab only.</span>
        </div>
        <label className="flex flex-col gap-2 text-[14px] text-ink-2">
          Admin token
          <input type="password" autoComplete="off" value={t} onChange={(e) => setT(e.target.value)} className="h-11 rounded-input border border-line-strong bg-bg px-3 font-mono text-[14px] text-ink outline-none focus:border-gold" />
        </label>
        {error && <p className="m-0 text-[14px] text-error">{error}</p>}
        <button type="submit" className="min-h-11 rounded-btn bg-gold px-5 text-[15px] font-semibold text-bg transition-colors hover:bg-gold-hover">
          Sign in
        </button>
      </form>
    </main>
  )
}

/** Paid plans: who has one, every payment, and a manual grant / revoke. */
function Subscriptions({ billing, accounts, act }: { billing: Billing; accounts: DevAccount[]; act: (path: string, body?: unknown) => Promise<string | null> }) {
  const [address, setAddress] = useState('')
  const [plan, setPlan] = useState('pro')
  const [days, setDays] = useState('30')
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const field = 'h-10 rounded-input border border-line-strong bg-bg px-3 font-mono text-[13px] text-ink outline-none focus:border-gold'
  const grant = async (addr: string, p: string, d?: number) => {
    setMsg(null)
    const err = await act(`/api/admin/accounts/${addr}/plan`, { plan: p, days: d })
    setMsg(err ? { ok: false, text: err } : { ok: true, text: p === 'free' ? `${addr} is back on Free.` : `${addr} has ${p} for ${d} days.` })
  }
  const c = billing.offer.checkout
  return (
    <section className={card}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className={h2}>Subscriptions</h2>
        <span className={small}>
          checkout {c.enabled ? `open · treasury ${c.treasury}` : 'off: GULLY_TREASURY_ADDRESS is not set'} · {billing.alerts.enabled} live alerts of {billing.alerts.total} ({billing.alerts.owners} wallets)
        </span>
      </div>
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          grant(address.trim().toLowerCase(), plan, Number(days))
        }}
      >
        <label className="flex min-w-[min(100%,360px)] flex-1 flex-col gap-1 text-[12px] text-faint">
          Wallet
          <input list="admin-wallets" className={field} value={address} onChange={(e) => setAddress(e.target.value)} placeholder="0x…" required pattern="0x[0-9a-fA-F]{40}" />
          <datalist id="admin-wallets">
            {accounts.map((a) => (
              <option key={a.address} value={a.address} />
            ))}
          </datalist>
        </label>
        <label className="flex flex-col gap-1 text-[12px] text-faint">
          Plan
          <select className={field} value={plan} onChange={(e) => setPlan(e.target.value)}>
            {billing.offer.plans.map((p) => (
              <option key={p.id} value={p.id}>
                {p.id === 'free' ? 'free (revoke)' : p.name}
              </option>
            ))}
          </select>
        </label>
        {plan !== 'free' && (
          <label className="flex w-[90px] flex-col gap-1 text-[12px] text-faint">
            Days
            <input className={field} type="number" min={1} max={3660} value={days} onChange={(e) => setDays(e.target.value)} required />
          </label>
        )}
        <button type="submit" className="h-10 rounded-btn bg-gold px-4 text-[14px] font-semibold text-bg hover:bg-gold-hover">
          {plan === 'free' ? 'Revoke plan' : 'Grant plan'}
        </button>
      </form>
      {msg && <p className={`m-0 font-mono text-[12px] ${msg.ok ? 'text-green' : 'text-error'}`}>{msg.text}</p>}
      {!billing.subscriptions.length ? (
        <p className="m-0 text-[14px] text-muted">No wallet has a paid or granted plan yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[14px]">
            <thead>
              <tr className="border-b border-line text-left font-mono text-[11px] tracking-[1px] text-faint">
                <th className="py-2 pr-3 font-medium">WALLET</th>
                <th className="py-2 pr-3 font-medium">PLAN</th>
                <th className="py-2 pr-3 font-medium">SOURCE</th>
                <th className="py-2 pr-3 font-medium">SINCE</th>
                <th className="py-2 pr-3 font-medium">UNTIL</th>
                <th className="py-2" />
              </tr>
            </thead>
            <tbody>
              {billing.subscriptions.map((s) => (
                <tr key={s.address} className="border-b border-line last:border-b-0">
                  <td className="py-3 pr-3 font-mono text-[12px] text-ink-2">{s.address}</td>
                  <td className="py-3 pr-3 font-mono text-[12px] uppercase">{s.plan}</td>
                  <td className="py-3 pr-3 font-mono text-[12px] text-faint">{s.source ?? '—'}</td>
                  <td className="py-3 pr-3 font-mono text-[12px] text-faint">{when(s.since)}</td>
                  <td className="py-3 pr-3 font-mono text-[12px]">{s.active ? <span className="text-green">{when(s.expiresAt)}</span> : <span className="text-faint">lapsed {when(s.expiresAt)}</span>}</td>
                  <td className="py-3 text-right whitespace-nowrap">
                    {s.active && (
                      <button type="button" onClick={() => window.confirm(`Revoke ${s.plan} from ${s.address}? It returns to Free now.`) && grant(s.address, 'free')} className="rounded-btn border border-line-strong px-3 py-[6px] text-[13px] text-ink-2 hover:border-error hover:text-error">
                        Revoke
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <h3 className="m-0 font-mono text-[12px] tracking-[1px] text-faint">PAYMENTS ({billing.payments.length})</h3>
      {!billing.payments.length ? (
        <p className="m-0 text-[14px] text-muted">No payments yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr className="border-b border-line text-left font-mono text-[11px] tracking-[1px] text-faint">
                <th className="py-2 pr-3 font-medium">WHEN</th>
                <th className="py-2 pr-3 font-medium">WALLET</th>
                <th className="py-2 pr-3 font-medium">PLAN</th>
                <th className="py-2 pr-3 font-medium">AMOUNT</th>
                <th className="py-2 pr-3 font-medium">TRANSACTION</th>
              </tr>
            </thead>
            <tbody className="font-mono">
              {billing.payments.map((p) => (
                <tr key={p.txHash} className="border-b border-line last:border-b-0">
                  <td className="py-2 pr-3 text-faint">{when(p.at)}</td>
                  <td className="py-2 pr-3 text-ink-2">{p.address}</td>
                  <td className="py-2 pr-3 uppercase">{p.plan}</td>
                  <td className="py-2 pr-3">{p.amount} USDC</td>
                  <td className="py-2 pr-3">
                    <a href={`https://basescan.org/tx/${p.txHash}`} target="_blank" rel="noopener" className="text-ink-2 hover:text-gold">
                      {p.txHash.slice(0, 10)}…
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

export function AdminPage() {
  const [token, setTok] = useState<string | null>(getToken)
  const { data, err, reload } = useAdmin(token)
  const signOut = () => {
    setToken(null)
    setTok(null)
  }
  useEffect(() => {
    document.title = 'Admin · Gully Labs'
    let m = document.head.querySelector<HTMLMetaElement>('meta[name="robots"]')
    if (!m) {
      m = document.createElement('meta')
      m.name = 'robots'
      document.head.appendChild(m)
    }
    m.content = 'noindex, nofollow'
  }, [])

  if (!token || (err && (err.status === 401 || err.status === 503 || err.status === 429) && !data))
    return (
      <Login
        error={err?.message ?? null}
        onToken={(t) => {
          setToken(t)
          setTok(t)
        }}
      />
    )

  const act = async (path: string, body?: unknown): Promise<string | null> => {
    const r = await fetch(path, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) }).catch(() => null)
    const d = r ? await r.json().catch(() => null) : null
    reload()
    return r?.ok ? null : (d?.error ?? 'The server could not be reached.')
  }

  const o = data?.overview
  const statusRows = o?.tracker.statuses ? Object.entries(o.tracker.statuses).sort((a, b) => b[1] - a[1]) : []
  const statusTotal = statusRows.reduce((a, [, n]) => a + n, 0)
  const statusColor: Record<string, string> = { 'in-line': '#a6b0bd', premium: '#1f9e89', discount: '#e4572e', drifting: '#e8c060', thin: '#5c6878', 'no-pool': '#3a4452', 'pool-unreadable': '#ff8a7a', 'feed-unreadable': '#ff8a7a' }

  return (
    <div className="min-h-screen bg-bg text-ink">
      <header className="sticky top-0 z-40 flex items-center justify-between gap-4 border-b border-line bg-[rgba(11,14,19,.9)] px-page py-4 backdrop-blur">
        <div className="flex items-center gap-4">
          <Link to="/" aria-label="Gully Labs home" className="text-ink">
            <Wordmark size={24} />
          </Link>
          <span className="rounded-full border border-gold-line px-3 py-[3px] font-mono text-[11px] text-gold">ADMIN</span>
        </div>
        <div className="flex items-center gap-3">
          <span className={small}>{o ? `updated ${ago(o.generatedAt)}` : 'loading…'}</span>
          <button type="button" onClick={() => reload()} className="rounded-btn border border-line-strong px-3 py-2 font-mono text-[12px] text-ink-2 hover:border-gold">
            Refresh
          </button>
          <button type="button" onClick={signOut} className="rounded-btn border border-line-strong px-3 py-2 font-mono text-[12px] text-ink-2 hover:border-gold">
            Sign out
          </button>
        </div>
      </header>

      <main className="flex flex-col gap-5 px-page py-8">
        {err && data && <p className="m-0 rounded-input border border-error/40 px-4 py-3 font-mono text-[12px] text-error">Last refresh failed: {err.message}. Showing the previous read.</p>}
        {!o ? (
          <p className="m-0 font-mono text-[13px] text-faint">Reading the server…</p>
        ) : (
          <>
            <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,170px),1fr))] gap-px overflow-hidden rounded-card border border-line bg-line">
              <Tile k="API REQUESTS TODAY" v={((o.api.days.at(-1)?.anonymous ?? 0) + (o.api.days.at(-1)?.keyed ?? 0)).toLocaleString('en-US')} note={`${o.api.days.at(-1)?.limited ?? 0} rate-limited`} />
              <Tile k="DEVELOPERS" v={String(o.developers.accounts ?? 0)} note={`wallets · ${o.developers.liveKeys} live keys${o.developers.pending ? ` · ${o.developers.pending} legacy pending` : ''}`} tone={o.developers.pending ? '#e8c060' : undefined} />
              <Tile k="ENQUIRIES" v={String(o.enquiries.open)} note={`open of ${o.enquiries.total}`} tone={o.enquiries.open ? '#e8c060' : undefined} />
              <Tile k="LAUNCH LIST" v={String(o.launchList)} note="notify-me sign-ups" />
              <Tile k="TRACKER CACHE" v={o.tracker.cacheAgeSeconds === null ? '—' : `${o.tracker.cacheAgeSeconds}s`} note={`last snapshot ${ago(o.tracker.lastSnapshot)}`} />
              <Tile k="HISTORY" v={o.tracker.history.points.toLocaleString('en-US')} note={`points across ${o.tracker.history.series} series`} />
              <Tile k="PROCESS" v={`${o.process.rssMb} MB`} note={`up ${Math.round(o.process.uptimeSeconds / 3600)}h · ${o.process.node}`} />
            </div>

            <div className="grid grid-cols-[1.4fr_1fr] gap-5 max-[1099px]:grid-cols-1">
              <section className={card}>
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h2 className={h2}>API traffic</h2>
                  <span className={small}>origin requests per day · anonymous limit {o.api.anonymousLimitPerMin}/min</span>
                </div>
                <DayBars
                  days={o.api.days}
                  series={[
                    { key: 'anonymous', label: 'Anonymous', color: '#a6b0bd' },
                    { key: 'keyed', label: 'With key', color: '#e8c060' },
                    { key: 'limited', label: 'Rate-limited', color: '#e4572e' },
                  ]}
                />
              </section>

              <section className={card}>
                <h2 className={h2}>Tracker health</h2>
                <ul className="m-0 flex list-none flex-col gap-2 p-0">
                  {o.tracker.chains.map((c) => (
                    <li key={c.key} className="flex flex-wrap items-center justify-between gap-2 rounded-input border border-line px-3 py-2 text-[14px]">
                      <span className="flex items-center gap-2">
                        <i className={`size-2 rounded-full ${c.backoffUntil ? 'bg-error' : 'bg-green'}`} />
                        {c.name} <span className={small}>{c.stocks} stocks · {c.sessionOpen ? 'market open' : 'closed'}</span>
                      </span>
                      <span className={small}>{c.backoffUntil ? `backing off until ${when(c.backoffUntil)}` : `pools read ${ago(c.lastPoolRead)}`}</span>
                    </li>
                  ))}
                </ul>
                {statusTotal > 0 && (
                  <div className="flex flex-col gap-2">
                    <div className="flex h-3 overflow-hidden rounded-full bg-line">
                      {statusRows.map(([s, n], i) => (
                        <div key={s} title={`${s}: ${n}`} style={{ width: `${(n / statusTotal) * 100}%`, background: statusColor[s] ?? '#6c7888', transformOrigin: 'left', animation: `gl-grow-x .7s ${i * 0.08}s cubic-bezier(.2,.8,.2,1) both` }} />
                      ))}
                    </div>
                    <div className="flex flex-wrap gap-x-4 gap-y-1">
                      {statusRows.map(([s, n]) => (
                        <span key={s} className="inline-flex items-center gap-2 font-mono text-[11px] text-muted">
                          <i className="inline-block size-[8px] rounded-[2px]" style={{ background: statusColor[s] ?? '#6c7888' }} />
                          {s} {n}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                <h2 className={`${h2} mt-2`}>Venues</h2>
                {o.venues.error ? (
                  <p className="m-0 text-[14px] text-error">{o.venues.error}</p>
                ) : (
                  <ul className="m-0 flex list-none flex-col gap-1 p-0">
                    {o.venues.list?.map((v) => (
                      <li key={v.key} className="flex items-center justify-between gap-2 text-[14px]">
                        <span className="flex items-center gap-2">
                          <i className={`size-2 rounded-full ${v.state === 'ok' ? 'bg-green' : 'bg-error'}`} />
                          {v.key}
                        </span>
                        <span className={`truncate font-mono text-[11px] ${v.state === 'ok' ? 'text-faint' : 'text-error'}`}>{v.state === 'ok' ? 'reading' : v.error}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </div>

            <section className={card}>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className={h2}>Developer wallets</h2>
                <span className={small}>keys are self-serve; blocking a wallet stops all its keys and signs it out</span>
              </div>
              {!data.accounts.length ? (
                <p className="m-0 text-[14px] text-muted">No wallet has signed in yet.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-[14px]">
                    <thead>
                      <tr className="border-b border-line text-left font-mono text-[11px] tracking-[1px] text-faint">
                        <th className="py-2 pr-3 font-medium">WALLET</th>
                        <th className="py-2 pr-3 font-medium">KEYS</th>
                        <th className="py-2 pr-3 font-medium">FIRST SIGN-IN</th>
                        <th className="py-2 pr-3 font-medium">LAST SIGN-IN</th>
                        <th className="py-2 pr-3 font-medium">STATUS</th>
                        <th className="py-2" />
                      </tr>
                    </thead>
                    <tbody>
                      {data.accounts.map((a) => (
                        <tr key={a.address} className="border-b border-line last:border-b-0">
                          <td className="py-3 pr-3 font-mono text-[12px] text-ink-2">{a.address}</td>
                          <td className="py-3 pr-3 font-mono text-[12px]">
                            {a.liveKeys} live <span className="text-faint">/ {a.keys}</span>
                          </td>
                          <td className="py-3 pr-3 font-mono text-[12px] text-faint">{when(a.createdAt)}</td>
                          <td className="py-3 pr-3 font-mono text-[12px] text-faint">{ago(a.lastLoginAt)}</td>
                          <td className="py-3 pr-3 font-mono text-[12px]">{a.blocked ? <span className="text-error">blocked {when(a.blockedAt)}</span> : <span className="text-green">active</span>}</td>
                          <td className="py-3 text-right whitespace-nowrap">
                            {a.blocked ? (
                              <button type="button" onClick={() => act(`/api/admin/accounts/${a.address}/unblock`)} className="rounded-btn border border-line-strong px-3 py-[6px] text-[13px] text-ink-2 hover:border-gold hover:text-ink">
                                Unblock
                              </button>
                            ) : (
                              <button
                                type="button"
                                onClick={() => window.confirm(`Block ${a.address}? Its ${a.liveKeys} live keys stop working and it is signed out.`) && act(`/api/admin/accounts/${a.address}/block`)}
                                className="rounded-btn border border-line-strong px-3 py-[6px] text-[13px] text-ink-2 hover:border-error hover:text-error"
                              >
                                Block
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            <Subscriptions billing={data.billing} accounts={data.accounts} act={act} />

            {data.requests.length > 0 && (
            <section className={card}>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className={h2}>Legacy key requests</h2>
                <span className={small}>the old manual flow, kept for requests already made; new keys are self-serve</span>
              </div>
              {!data.requests.length ? (
                <p className="m-0 text-[14px] text-muted">No requests yet.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-[14px]">
                    <thead>
                      <tr className="border-b border-line text-left font-mono text-[11px] tracking-[1px] text-faint">
                        <th className="py-2 pr-3 font-medium">PROJECT</th>
                        <th className="py-2 pr-3 font-medium">CONTACT</th>
                        <th className="py-2 pr-3 font-medium">USE</th>
                        <th className="py-2 pr-3 font-medium">RECEIVED</th>
                        <th className="py-2 pr-3 font-medium">STATUS</th>
                        <th className="py-2" />
                      </tr>
                    </thead>
                    <tbody>
                      {data.requests.map((r) => (
                        <tr key={r.id} className="border-b border-line align-top last:border-b-0">
                          <td className="py-3 pr-3">
                            <div className="font-medium">{r.project}</div>
                            {r.url && (
                              <a href={r.url} target="_blank" rel="noopener noreferrer" className="font-mono text-[11px] text-gold">
                                {r.url.replace(/^https?:\/\//, '')}
                              </a>
                            )}
                          </td>
                          <td className="py-3 pr-3 font-mono text-[12px] text-ink-2">{r.email}</td>
                          <td className="max-w-[360px] py-3 pr-3 text-[13px] text-muted">{r.use}</td>
                          <td className="py-3 pr-3 font-mono text-[12px] text-faint">{when(r.createdAt)}</td>
                          <td className="py-3 pr-3 font-mono text-[12px]">
                            <span className={r.status === 'pending' ? 'text-gold' : r.status === 'rejected' ? 'text-error' : 'text-green'}>{r.status}</span>
                            {r.claimedAt && <div className="text-faint">claimed {when(r.claimedAt)}</div>}
                          </td>
                          <td className="py-3 text-right whitespace-nowrap">
                            {r.status === 'pending' && (
                              <span className="flex justify-end gap-2">
                                <button type="button" onClick={() => act(`/api/admin/requests/${r.id}/approve`)} className="rounded-btn bg-gold px-3 py-[6px] text-[13px] font-semibold text-bg hover:bg-gold-hover">
                                  Approve
                                </button>
                                <button type="button" onClick={() => act(`/api/admin/requests/${r.id}/reject`)} className="rounded-btn border border-line-strong px-3 py-[6px] text-[13px] text-ink-2 hover:border-error hover:text-error">
                                  Reject
                                </button>
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
            )}

            <div className="grid grid-cols-[1fr_1fr] gap-5 max-[1099px]:grid-cols-1">
              <section className={card}>
                <h2 className={h2}>API keys</h2>
                {!data.keys.length ? (
                  <p className="m-0 text-[14px] text-muted">No keys issued yet.</p>
                ) : (
                  <ul className="m-0 flex list-none flex-col gap-2 p-0">
                    {data.keys.map((k) => {
                      const u = o.api.keys.find((x) => x.id === k.id)
                      return (
                        <li key={k.id} className={`flex flex-wrap items-center justify-between gap-3 rounded-input border border-line px-3 py-2 ${k.revokedAt ? 'opacity-50' : ''}`}>
                          <span className="flex flex-col">
                            <span className="text-[14px]">{k.name ?? k.project}</span>
                            <span className={small}>
                              {k.prefix}… · {k.owner ? `${k.owner.slice(0, 6)}…${k.owner.slice(-4)}` : k.email} · {(u?.requests ?? 0).toLocaleString('en-US')} requests · last {ago(u?.lastUsed ?? null)}
                            </span>
                          </span>
                          {k.revokedAt ? (
                            <span className="font-mono text-[12px] text-faint">revoked {when(k.revokedAt)}</span>
                          ) : (
                            <button
                              type="button"
                              onClick={() => window.confirm(`Revoke ${k.name ?? k.project ?? 'this'} key? It stops working immediately.`) && act(`/api/admin/keys/${k.id}/revoke`)}
                              className="rounded-btn border border-line-strong px-3 py-[6px] text-[13px] text-ink-2 hover:border-error hover:text-error"
                            >
                              Revoke
                            </button>
                          )}
                        </li>
                      )
                    })}
                  </ul>
                )}
              </section>

              <section className={card}>
                <h2 className={h2}>Enquiries</h2>
                {!data.enquiries.length ? (
                  <p className="m-0 text-[14px] text-muted">No enquiries yet.</p>
                ) : (
                  <ul className="m-0 flex max-h-[520px] list-none flex-col gap-2 overflow-y-auto p-0">
                    {data.enquiries.map((e) => (
                      <li key={e.id} className={`flex flex-col gap-2 rounded-input border border-line px-3 py-3 ${e.handled ? 'opacity-50' : ''}`}>
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="text-[14px]">
                            {e.name || 'No name'}{' '}
                            <a href={`mailto:${e.email}`} className="font-mono text-[12px] text-gold">
                              {e.email}
                            </a>
                          </span>
                          <span className={small}>{when(e.receivedAt)}</span>
                        </div>
                        <span className="font-mono text-[11px] text-faint">
                          {e.types.join(', ')}
                          {e.budget && ` · ${e.budget}`}
                        </span>
                        {e.message && <p className="m-0 text-[13px] leading-[1.5] whitespace-pre-wrap text-ink-2">{e.message}</p>}
                        <button type="button" onClick={() => act(`/api/admin/enquiries/${e.id}/handled`, { handled: !e.handled })} className="self-start bg-transparent p-0 font-mono text-[12px] text-faint hover:text-ink">
                          {e.handled ? 'Mark open' : 'Mark handled'}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </div>

            <section className={card}>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className={h2}>Launch list</h2>
                <button
                  type="button"
                  onClick={async () => {
                    const r = await fetch('/api/admin/launch-list?format=csv', { headers: { authorization: `Bearer ${token}` } })
                    if (!r.ok) return
                    const url = URL.createObjectURL(await r.blob())
                    const a = document.createElement('a')
                    a.href = url
                    a.download = 'launch-list.csv'
                    a.click()
                    URL.revokeObjectURL(url)
                  }}
                  className="rounded-btn border border-line-strong px-3 py-[6px] font-mono text-[12px] text-ink-2 hover:border-gold"
                >
                  Export CSV
                </button>
              </div>
              {!data.launch.length ? (
                <p className="m-0 text-[14px] text-muted">Nobody has signed up yet.</p>
              ) : (
                <ul className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-2 p-0">
                  {data.launch.map((r) => (
                    <li key={r.email + r.slot} className="flex items-center justify-between gap-2 rounded-input border border-line px-3 py-2">
                      <span className="truncate font-mono text-[12px] text-ink-2">{r.email}</span>
                      <span className={small}>
                        {r.slot} · {when(r.addedAt)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        )}
      </main>
    </div>
  )
}
