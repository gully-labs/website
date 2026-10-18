import { Building2, ExternalLink, Laptop, LogOut, ShieldCheck, UserRound } from 'lucide-react'
import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { toastError, toastSuccess } from '../../components/ui/toast'
import { isLocalHost, SITE_URL } from '../../site-host'
import { ago, api, SESSION_ENDED, type Company, type Profile, type SessionInfo } from './api'
import { Avatar } from './Avatar'
import { ErrorLine, Skeleton } from './parts'
import { fmtDateTime, usePortal, useWrite } from './portal'
import { Can } from './RoleGate'
import { StackedDays } from './vcharts'
import { input, mono, panel, panelTitle, pillGold, pillSm, rise } from './styles'

/* The Settings tab (portal v2):
   - Profile (this wallet, every role): display name, contact email, the ENS / Basename found by the
     server's reverse lookup (read-only), and Telegram notification toggles. POST /profile.
   - Company (the ACTIVE workspace; owner, admin and billing may change it): name, address, tax ID,
     printed on receipts. POST /company.
   - Sessions (this wallet): device, created, last seen, which one is this browser; sign one out or
     every other one. GET /sessions, POST /sessions/revoke.
   - Privacy: a link to /legal/privacy and how to ask for an export or deletion. */

const field = 'flex flex-col gap-2 text-[14px] text-ink-2'

export function SettingsTab({ section }: { section: string | null }) {
  useEffect(() => {
    if (!section) return
    const id = requestAnimationFrame(() => document.getElementById(`settings-${section}`)?.scrollIntoView({ block: 'start', behavior: 'smooth' }))
    return () => cancelAnimationFrame(id)
  }, [section])
  return (
    <div className="flex flex-col gap-[14px]">
      <ProfileCard />
      <CompanyCard />
      <SessionsCard />
      <PrivacyCard />
    </div>
  )
}

const site = (path: string) => (isLocalHost() ? path : `${SITE_URL}${path}`)

/** Where the privacy policy is, and how to get your data out or deleted (there is no self-service delete yet). */
function PrivacyCard() {
  return (
    <section id="settings-privacy" className={`${panel} scroll-mt-4`} style={rise(3)} aria-labelledby="privacy-title">
      <div className="flex flex-wrap items-center gap-3">
        <ShieldCheck size={18} className="text-gold" aria-hidden />
        <div className="flex flex-col gap-[2px]">
          <h2 id="privacy-title" className={panelTitle}>
            Privacy
          </h2>
          <span className={mono}>what we keep and for how long</span>
        </div>
      </div>
      <p className="m-0 text-[14px] leading-[1.6] text-ink-2">
        The privacy policy lists what the app, Gully AI, Gully Analytics, the Telegram bot and Gully Pay collect, who else sees it and how long it is kept. To see, export or delete your data, email hello@gullylabs.xyz.
      </p>
      <a href={site('/legal/privacy')} target="_blank" rel="noopener" className={`${pillSm} self-start`}>
        Privacy policy <ExternalLink size={12} aria-hidden />
      </a>
    </section>
  )
}

function ProfileCard() {
  const { me, reloadMe } = usePortal()
  const p = me?.profile ?? null
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [loaded, setLoaded] = useState<Profile | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  // Fill the form once the profile arrives (and again if it changes elsewhere).
  if (p && p !== loaded) {
    setLoaded(p)
    setName(p.displayName ?? '')
    setEmail(p.email ?? '')
  }

  const save = async (e: FormEvent) => {
    e.preventDefault()
    setBusy('save')
    setErr(null)
    const r = await api<{ profile: Profile }>('/api/developer/profile', { method: 'POST', body: { displayName: name.trim() || null, email: email.trim() || null } })
    setBusy(null)
    if (!r.ok) return setErr(r.error)
    toastSuccess('Profile saved')
    reloadMe()
  }
  const toggle = async (k: 'telegramUsage' | 'telegramBilling', on: boolean) => {
    setBusy(k)
    const r = await api<{ profile: Profile }>('/api/developer/profile', { method: 'POST', body: { notify: { [k]: on } } })
    setBusy(null)
    if (!r.ok) return toastError('Could not change the notification', { detail: r.error })
    toastSuccess(`${k === 'telegramUsage' ? 'Usage' : 'Billing'} notices ${on ? 'on' : 'off'}`)
    reloadMe()
  }

  return (
    <section id="settings-profile" className={`${panel} scroll-mt-4`} style={rise(0)} aria-labelledby="profile-title">
      <div className="flex flex-wrap items-center gap-3">
        <UserRound size={18} className="text-gold" aria-hidden />
        <div className="flex flex-col gap-[2px]">
          <h2 id="profile-title" className={panelTitle}>
            Profile
          </h2>
          <span className={mono}>This wallet, in every workspace</span>
        </div>
      </div>
      {!me || !p ? (
        <Skeleton h={220} />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3 rounded-[12px] border border-line bg-surface-deep px-3 py-3">
            <Avatar address={me.address} src={p.avatar} size={44} />
            <span className="flex min-w-0 flex-col">
              <span className="font-mono text-[12px] break-all text-ink-2">{me.address}</span>
              <span className="text-[13px] text-muted" data-testid="ens">
                ENS / Basename: {p.ens ? <b className="font-medium text-ink">{p.ens}</b> : <span className="text-faint">none found</span>}
                <span className="ml-2 text-[11px] text-faint">read-only · from the chain</span>
              </span>
            </span>
          </div>
          <form onSubmit={save} className="grid grid-cols-2 gap-3 max-[700px]:grid-cols-1">
            <label className={field}>
              Display name
              <input className={input} value={name} onChange={(e) => setName(e.target.value)} maxLength={40} placeholder="Shown to your team" name="displayName" />
            </label>
            <label className={field}>
              Contact email
              <input className={input} type="email" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={254} placeholder="you@example.com" name="email" />
            </label>
            <div className="col-span-full flex flex-wrap items-center justify-between gap-3">
              <span className="text-[12px] text-faint">Optional. Used only to reach you about your account; never shared.</span>
              <button type="submit" disabled={busy === 'save'} className={pillGold}>
                Save profile
              </button>
            </div>
          </form>
          {err && <ErrorLine>{err}</ErrorLine>}
          <fieldset className="m-0 flex flex-col gap-2 border-0 border-t border-line p-0 pt-3">
            <legend className="mb-2 text-[14px] text-ink-2">Telegram notices (to the chat linked in Alerts)</legend>
            <Toggle on={p.notify.telegramUsage} busy={busy === 'telegramUsage'} onChange={(v) => toggle('telegramUsage', v)} title="Usage limits" text="When a key passes 80% or 100% of its per-minute limit (at most once a day each)." />
            <Toggle on={p.notify.telegramBilling} busy={busy === 'telegramBilling'} onChange={(v) => toggle('telegramBilling', v)} title="Billing" text="Payments confirmed and plans about to end." />
          </fieldset>
        </>
      )}
    </section>
  )
}

function Toggle({ on, busy, onChange, title, text }: { on: boolean; busy: boolean; onChange: (v: boolean) => void; title: string; text: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} disabled={busy} onClick={() => onChange(!on)} className="flex min-h-12 items-center gap-3 rounded-[10px] border border-line px-3 py-2 text-left transition-colors hover:border-line-strong disabled:opacity-60">
      <span className={`relative h-6 w-10 shrink-0 rounded-full transition-colors ${on ? 'bg-gold' : 'bg-grid'}`} aria-hidden>
        <span className={`absolute top-[3px] size-[18px] rounded-full bg-ink transition-[left] ${on ? 'left-[19px] bg-bg' : 'left-[3px]'}`} />
      </span>
      <span className="flex flex-col">
        <b className="text-[14px] font-semibold">{title}</b>
        <span className="text-[12px] text-dim">{text}</span>
      </span>
    </button>
  )
}

function CompanyCard() {
  const { me, reloadMe } = usePortal()
  const w = useWrite('company', 'change the company details')
  const c = me?.company ?? null
  const [form, setForm] = useState<Company>({ name: '', address: '', taxId: '' })
  const [loaded, setLoaded] = useState<Company | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  if (c && c !== loaded) {
    setLoaded(c)
    setForm({ name: c.name ?? '', address: c.address ?? '', taxId: c.taxId ?? '' })
  }
  const save = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setErr(null)
    const r = await api<{ company: Company }>('/api/developer/company', { method: 'POST', body: { name: form.name?.trim() || null, address: form.address?.trim() || null, taxId: form.taxId?.trim() || null } })
    setBusy(false)
    if (!r.ok) return setErr(r.error)
    toastSuccess('Company details saved', { detail: 'Receipts print them from now on.' })
    reloadMe()
  }
  const set = (k: keyof Company) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }))

  return (
    <section id="settings-company" className={`${panel} scroll-mt-4`} style={rise(1)} aria-labelledby="company-title">
      <div className="flex flex-wrap items-center gap-3">
        <Building2 size={18} className="text-gold" aria-hidden />
        <div className="flex flex-col gap-[2px]">
          <h2 id="company-title" className={panelTitle}>
            Company
          </h2>
          <span className={mono}>{me ? `${me.active.name} · printed on receipts` : 'printed on receipts'}</span>
        </div>
      </div>
      {!me ? (
        <Skeleton h={200} />
      ) : (
        <form onSubmit={save} className="grid grid-cols-2 gap-3 max-[700px]:grid-cols-1">
          <fieldset disabled={!w.ok} className="contents">
            <label className={field}>
              Company name
              <input className={input} value={form.name ?? ''} onChange={set('name')} maxLength={80} name="companyName" />
            </label>
            <label className={field}>
              Tax ID (VAT, EIN…)
              <input className={input} value={form.taxId ?? ''} onChange={set('taxId')} maxLength={40} name="taxId" />
            </label>
            <label className={`${field} col-span-full`}>
              Address
              <textarea className={`${input} h-auto min-h-[88px] py-2`} value={form.address ?? ''} onChange={set('address')} maxLength={300} rows={3} name="companyAddress" />
            </label>
          </fieldset>
          <div className="col-span-full flex flex-wrap items-center justify-between gap-3">
            <span className="text-[12px] text-faint">{w.ok ? 'Optional. Leave a field empty to remove it.' : w.why}</span>
            <Can cat="company" what="change the company details">
              <button type="submit" disabled={busy} className={pillGold}>
                Save company
              </button>
            </Can>
          </div>
          {err && (
            <div className="col-span-full">
              <ErrorLine>{err}</ErrorLine>
            </div>
          )}
        </form>
      )}
    </section>
  )
}

function SessionsCard() {
  const [list, setList] = useState<SessionInfo[] | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const load = useCallback(
    () =>
      api<{ sessions: SessionInfo[] }>('/api/developer/sessions').then((r) => {
        if (r.ok) {
          setList([...r.data.sessions].sort((a, b) => Number(b.current) - Number(a.current) || b.lastSeenAt.localeCompare(a.lastSeenAt)))
          setErr(null)
        } else setErr(r.error)
      }),
    [],
  )
  useEffect(() => {
    load()
  }, [load])

  const revoke = async (id: string) => {
    const s = list?.find((x) => x.id === id)
    if (s?.current && !window.confirm('Sign out this browser?')) return
    setBusy(id)
    const r = await api<{ revoked: number; signedOut: boolean }>('/api/developer/sessions/revoke', { method: 'POST', body: { id } })
    setBusy(null)
    if (!r.ok) return toastError('Could not sign the session out', { detail: r.error })
    if (r.data.signedOut) {
      window.dispatchEvent(new Event(SESSION_ENDED))
      return
    }
    toastSuccess(id === 'others' ? `Signed out ${r.data.revoked} other session${r.data.revoked === 1 ? '' : 's'}` : 'Session signed out')
    load()
  }
  const others = (list ?? []).filter((s) => !s.current).length

  return (
    <section id="settings-sessions" className={`${panel} scroll-mt-4`} style={rise(2)} aria-labelledby="sessions-title">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <ShieldCheck size={18} className="text-gold" aria-hidden />
          <div className="flex flex-col gap-[2px]">
            <h2 id="sessions-title" className={panelTitle}>
              Sessions
            </h2>
            <span className={mono}>Where this wallet is signed in · each lasts 30 days</span>
          </div>
        </div>
        <button type="button" disabled={!others || busy === 'others'} onClick={() => revoke('others')} className={pillSm}>
          <LogOut size={14} aria-hidden /> Sign out all others
        </button>
      </div>
      {err && !list ? (
        <ErrorLine onRetry={load}>Sessions could not be read: {err}</ErrorLine>
      ) : !list ? (
        <Skeleton h={120} />
      ) : (
        <>
        {list.length > 1 && (
          <div data-testid="sessions-chart">
            <StackedDays
              height={130}
              label={`Sign-ins per day over the last 30 days: ${list.length} live sessions.`}
              kinds={[
                { id: 'in', name: 'signed in', color: '#e8c060' },
                { id: 'seen', name: 'last seen', color: '#6aa6ff' },
              ]}
              days={Array.from({ length: 30 }, (_, i) => {
                const d = new Date()
                d.setDate(d.getDate() - (29 - i))
                const key = d.toDateString()
                return {
                  label: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
                  values: { in: list.filter((s) => new Date(s.createdAt).toDateString() === key).length, seen: list.filter((s) => new Date(s.lastSeenAt).toDateString() === key && new Date(s.createdAt).toDateString() !== key).length },
                }
              })}
            />
          </div>
        )}
        <ul className="m-0 flex list-none flex-col p-0" data-testid="session-list">
          {list.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center gap-3 border-t border-line py-3 first:border-t-0">
              <Laptop size={18} className={s.current ? 'text-gold' : 'text-faint'} aria-hidden />
              <span className="flex min-w-0 flex-[1_1_220px] flex-col">
                <span className="flex items-center gap-2">
                  <b className="font-semibold">{s.device}</b>
                  {s.current && <span className="rounded-full bg-gold px-2 py-[1px] font-mono text-[11px] font-semibold text-bg">THIS BROWSER</span>}
                </span>
                <span className="font-mono text-[11px] text-dim">
                  signed in {fmtDateTime(s.createdAt)} · last seen {ago(s.lastSeenAt)} · ends {fmtDateTime(s.expiresAt)}
                </span>
              </span>
              <button type="button" disabled={busy === s.id} onClick={() => revoke(s.id)} className={`${pillSm} hover:!border-error hover:!text-error`}>
                {s.current ? 'Sign out' : 'Revoke'}
              </button>
            </li>
          ))}
        </ul>
        </>
      )}
    </section>
  )
}
