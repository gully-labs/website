import { KeyRound, Loader2, ShieldCheck, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { toastError, toastSuccess } from '../../components/ui/toast'
import { dateTimePT } from '../../lib/time'
import { field44, goldCtl, ctl, pillCls } from './ui'

/* Admin: Integrations (server/admin-integrations.mjs). Write-only settings the Chain Kit runner reads. The cards, names
   and hints all come from the admin API, so none of them are in this bundle. A value is typed, saved and never shown
   again: the page only says set or unset, and who changed it when. Saving or clearing needs a passkey confirmation
   through Gully ID in the last 5 minutes. Loaded on demand (AdminPage lazy-loads this file). */

interface Field {
  name: string
  label: string
  hint: string
  optional: boolean
  dflt: string | null
  set: boolean
  updatedAt: string | null
  updatedBy: string | null
}
interface Group {
  id: string
  title: string
  body: string
  fields: Field[]
}
interface Data {
  groups: Group[]
  stepUp: { via: 'gully_id' | 'token'; until: number | null }
}

const card = 'flex min-w-0 flex-col gap-4 rounded-card border border-line bg-surface p-6 max-[600px]:p-4'

async function call(token: string, path: string, method: 'GET' | 'PUT' | 'DELETE', body?: unknown) {
  const r = await fetch(path, { method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }).catch(() => null)
  const d = r ? await r.json().catch(() => null) : null
  return { ok: !!r?.ok, status: r?.status ?? 0, data: d, error: (d?.error as string | undefined) ?? 'The server could not be reached.' }
}

function FieldRow({ f, token, unlocked, onSaved }: { f: Field; token: string; unlocked: boolean; onSaved: () => void }) {
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const id = `int-${f.name}`
  const save = async (clear: boolean) => {
    if (clear && !window.confirm(`Remove ${f.label}? The Chain Kit runner stops using it on its next run.`)) return
    setBusy(true)
    const r = await call(token, `/api/admin/integrations/${f.name}`, clear ? 'DELETE' : 'PUT', clear ? undefined : { value })
    setBusy(false)
    if (!r.ok) return toastError(clear ? 'Could not remove it' : 'Could not save it', { detail: r.error })
    setValue('')
    toastSuccess(clear ? `${f.label} removed` : `${f.label} saved`)
    onSaved()
  }
  return (
    <li className="flex min-w-0 flex-col gap-2 rounded-input border border-line px-3 py-3" data-testid={id}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <label htmlFor={id} className="text-[14px] font-medium text-ink">
          {f.label} {f.optional && <span className="text-[12px] font-normal text-faint">optional{f.dflt ? `, default ${f.dflt}` : ''}</span>}
        </label>
        <span className={pillCls(f.set ? 'border-green/40 text-green' : 'border-line-strong text-faint')}>{f.set ? 'Set' : 'Not set'}</span>
      </div>
      <span className="font-mono text-[12px] break-all text-faint">
        {f.name}
        {f.updatedAt && ` · changed ${dateTimePT(f.updatedAt)}${f.updatedBy ? ` by ${f.updatedBy}` : ''}`}
      </span>
      <div className="flex flex-wrap gap-2">
        <input
          id={id}
          type="password"
          autoComplete="off"
          spellCheck={false}
          className={`${field44} min-w-0 flex-1 font-mono`}
          placeholder={f.set ? 'Type a new value to replace it' : f.hint}
          value={value}
          disabled={!unlocked || busy}
          onChange={(e) => setValue(e.target.value)}
        />
        <button type="button" className={goldCtl} disabled={!unlocked || busy || !value.trim()} onClick={() => void save(false)}>
          {busy ? <Loader2 size={16} className="animate-spin" aria-hidden /> : <KeyRound size={16} aria-hidden />}
          Save
        </button>
        {f.set && (
          <button type="button" className={ctl} disabled={!unlocked || busy} onClick={() => void save(true)} aria-label={`Remove ${f.label}`}>
            <Trash2 size={16} aria-hidden />
            Remove
          </button>
        )}
      </div>
    </li>
  )
}

export default function IntegrationsAdmin({ token }: { token: string }) {
  const [data, setData] = useState<Data | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const load = useCallback(() => {
    call(token, '/api/admin/integrations', 'GET').then((r) => (r.ok ? (setData(r.data as Data), setErr(null)) : setErr(r.error)))
  }, [token])
  useEffect(() => {
    load()
    const t = setInterval(() => setNow(Date.now()), 15_000)
    return () => clearInterval(t)
  }, [load])
  useEffect(() => {
    const q = new URLSearchParams(location.search).get('stepup')
    if (!q) return
    if (q === 'ok') toastSuccess('Passkey confirmed', { detail: 'You can change integrations for 5 minutes.' })
    else toastError('Passkey not confirmed', { detail: q === 'not_passkey' ? 'Use a passkey, not another sign-in method.' : q === 'stale' ? 'That sign-in was too old. Try again.' : q === 'other_account' ? 'Confirm with the same Gully ID you are signed in with.' : 'Try again.' })
    history.replaceState(null, '', `${location.pathname}${location.hash}`)
  }, [])
  const until = data?.stepUp.until ?? null
  const unlocked = !!until && until > now
  return (
    <section className={card} aria-labelledby="admin-integrations" data-testid="admin-integrations">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="admin-integrations" className="m-0 font-display text-[22px] font-bold uppercase">
          Integrations
        </h2>
        {data &&
          (data.stepUp.via !== 'gully_id' ? (
            <span className="text-[13px] text-muted">Sign in with Gully ID to change these. The admin token cannot.</span>
          ) : unlocked ? (
            <span className="inline-flex items-center gap-1 text-[13px] text-green">
              <ShieldCheck size={16} aria-hidden /> Unlocked until {dateTimePT(until)}
            </span>
          ) : (
            <a href="/auth/gully/stepup" className={goldCtl} data-testid="integrations-stepup">
              <ShieldCheck size={16} aria-hidden /> Confirm with your passkey
            </a>
          ))}
      </div>
      <p className="m-0 text-[14px] text-muted">Values are write-only. Once saved they are never shown again, here or anywhere else. Wallet private keys and seed phrases are refused.</p>
      {err && <p className="m-0 font-mono text-[12px] text-error">{err}</p>}
      {!data && !err && <span className="font-mono text-[12px] text-faint">Loading…</span>}
      {data?.groups.map((g) => (
        <div key={g.id} className="flex min-w-0 flex-col gap-3" data-testid={`integrations-${g.id}`}>
          <h3 className="m-0 text-[16px] font-semibold text-ink">{g.title}</h3>
          <p className="m-0 text-[13px] text-muted">{g.body}</p>
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {g.fields.map((f) => (
              <FieldRow key={f.name} f={f} token={token} unlocked={unlocked} onSaved={load} />
            ))}
          </ul>
        </div>
      ))}
    </section>
  )
}
