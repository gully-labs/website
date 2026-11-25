import { CheckCircle2, CircleDashed, Copy, ExternalLink, KeyRound, Loader2, Send, ShieldCheck, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useState, type CSSProperties } from 'react'
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
  value?: string | null
  multiline?: boolean
  onServer?: boolean
}
interface Note {
  id: string
  title: string
  text: string
  links: { label: string; url: string }[]
}
interface Group {
  id: string
  title: string
  body: string
  fields: Field[]
  section?: string
  usedIn?: string
  guide?: { steps: string[]; links: { label: string; url: string }[]; note?: string }
  optionalGroup?: boolean
  guideOnly?: boolean
  canCheck?: boolean
  notes?: Note[]
  info?: { label: string; value: string | null; empty: string | null; url: boolean }[]
  actions?: { id: string; label: string; detail: string }[]
  status?: { state: string; label: string; search?: string; since?: string | null; lastCheck?: { at: string; result: string } | null }
}
interface Progress {
  tool: string
  ready: boolean | null
  missing: string[]
  optional?: boolean
  heldByOwner?: string
}
interface Data {
  groups: Group[]
  progress?: Progress[]
  stepUp: { via: 'gully_id' | 'token'; until: number | null }
}

const card = 'flex min-w-0 flex-col gap-4 rounded-card border border-line bg-surface p-6 max-[600px]:p-4'

async function call(token: string, path: string, method: 'GET' | 'PUT' | 'DELETE' | 'POST', body?: unknown) {
  const r = await fetch(path, { method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }).catch(() => null)
  const d = r ? await r.json().catch(() => null) : null
  return { ok: !!r?.ok, status: r?.status ?? 0, data: d, error: (d?.error as string | undefined) ?? 'The server could not be reached.' }
}

function FieldRow({ f, token, unlocked, onSaved }: { f: Field; token: string; unlocked: boolean; onSaved: () => void }) {
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const id = `int-${f.name}`
  const plain = f.value !== undefined
  const inputCls = `${field44} min-w-0 flex-1 font-mono`
  const save = async (clear: boolean) => {
    if (clear && !window.confirm(`Remove ${f.label}? Whatever reads it stops using it.`)) return
    setBusy(true)
    const r = await call(token, `/api/admin/integrations/${f.name}`, clear ? 'DELETE' : 'PUT', clear ? undefined : { value })
    setBusy(false)
    if (!r.ok) return toastError(clear ? 'Could not remove it' : 'Could not save it', { detail: r.error })
    setValue('')
    const chk = r.data?.check as { ok?: boolean; detail?: string } | undefined
    if (chk && !chk.ok) toastError(`${f.label} saved, but not accepted`, { detail: chk.detail })
    else toastSuccess(clear ? `${f.label} removed` : `${f.label} saved`, chk?.detail ? { detail: chk.detail } : undefined)
    onSaved()
  }
  return (
    <li className="flex min-w-0 flex-col gap-2 rounded-input border border-line px-3 py-3" data-testid={id}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <label htmlFor={id} className="text-[14px] font-medium text-ink">
          {f.label} {f.optional && <span className="text-[12px] font-normal text-faint">optional{f.dflt ? `, default ${f.dflt}` : ''}</span>}
        </label>
        <span className={pillCls(f.set || f.onServer ? 'border-green/40 text-green' : 'border-line-strong text-faint')}>{f.set ? 'Set' : f.onServer ? 'Set on the server' : 'Not set'}</span>
      </div>
      {plain && f.value && (
        <span className="font-mono text-[13px] break-all text-ink" data-testid={`${id}-value`}>
          Current: {f.value}
        </span>
      )}
      <span className="font-mono text-[12px] break-all text-faint">
        {f.name}
        {f.updatedAt && ` · changed ${dateTimePT(f.updatedAt)}${f.updatedBy ? ` by ${f.updatedBy}` : ''}`}
      </span>
      <div className="flex flex-wrap gap-2">
        {f.multiline ? (
          <textarea
            id={id}
            autoComplete="off"
            spellCheck={false}
            rows={4}
            className={`${inputCls} h-auto py-2`}
            style={{ WebkitTextSecurity: 'disc' } as CSSProperties}
            placeholder={f.set ? 'Paste a new key to replace it' : f.hint}
            value={value}
            disabled={!unlocked || busy}
            onChange={(e) => setValue(e.target.value)}
          />
        ) : (
          <input
            id={id}
            type={plain ? 'text' : 'password'}
            autoComplete="off"
            spellCheck={false}
            className={inputCls}
            placeholder={f.set ? 'Type a new value to replace it' : f.hint}
            value={value}
            disabled={!unlocked || busy}
            onChange={(e) => setValue(e.target.value)}
          />
        )}
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

function ProgressPanel({ rows }: { rows: Progress[] }) {
  return (
    <section className="flex flex-col gap-2 rounded-input border border-line px-3 py-3" aria-label="Setup progress" data-testid="devtools-progress">
      <h4 className="m-0 text-[14px] font-semibold text-ink">Setup progress</h4>
      <ul className="m-0 flex list-none flex-col gap-1 p-0">
        {rows.map((r) => (
          <li key={r.tool} className="flex flex-wrap items-baseline gap-2 text-[13px]" data-testid="devtools-progress-row">
            {r.ready ? <CheckCircle2 size={15} className="text-green" aria-hidden /> : <CircleDashed size={15} className="text-faint" aria-hidden />}
            <span className="text-ink">{r.tool}</span>
            <span className="text-muted">{r.heldByOwner ? r.heldByOwner : r.ready ? 'Ready to publish when you say so' : `${r.optional ? 'Optional. ' : ''}Waiting for: ${r.missing.join(', ')}`}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}

function InfoRows({ rows }: { rows: NonNullable<Group['info']> }) {
  const copy = (v: string) => {
    navigator.clipboard?.writeText(v).then(
      () => toastSuccess('Copied'),
      () => toastError('Could not copy', { detail: 'Select the text and copy it by hand.' }),
    )
  }
  return (
    <ul className="m-0 flex list-none flex-col gap-2 p-0">
      {rows.map((r) => (
        <li key={r.label} className="flex min-w-0 flex-col gap-1 rounded-input border border-line px-3 py-3" data-testid="integrations-info">
          <span className="text-[13px] font-medium text-ink">{r.label}</span>
          {r.value ? (
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              {r.url ? (
                <a href={r.value} target="_blank" rel="noopener noreferrer" className="min-w-0 font-mono text-[12px] break-all text-ink underline">
                  {r.value}
                </a>
              ) : (
                <code className="min-w-0 font-mono text-[12px] break-all text-ink">{r.value}</code>
              )}
              <button type="button" className={ctl} onClick={() => copy(r.value as string)} aria-label={`Copy ${r.label}`}>
                <Copy size={16} aria-hidden /> Copy
              </button>
            </div>
          ) : (
            <span className="text-[12px] text-faint">{r.empty}</span>
          )}
        </li>
      ))}
    </ul>
  )
}

function ActionButton({ a, token, unlocked }: { a: NonNullable<Group['actions']>[number]; token: string; unlocked: boolean }) {
  const [busy, setBusy] = useState(false)
  const [detail, setDetail] = useState<{ ok: boolean; text: string } | null>(null)
  const run = async () => {
    setBusy(true)
    const r = await call(token, `/api/admin/integrations/action/${a.id}`, 'POST')
    setBusy(false)
    const ok = r.ok && !!r.data?.ok
    const text = r.ok ? String(r.data?.detail ?? '') : r.error
    setDetail({ ok, text })
    ;(ok ? toastSuccess : toastError)(ok ? a.label : `${a.label}: not done`, { detail: text })
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" className={ctl} disabled={!unlocked || busy} onClick={() => void run()} data-testid={`action-${a.id}`}>
        {busy ? <Loader2 size={16} className="animate-spin" aria-hidden /> : <Send size={16} aria-hidden />}
        {a.label}
      </button>
      <span className={`text-[13px] ${detail ? (detail.ok ? 'text-green' : 'text-muted') : 'text-faint'}`} role="status">
        {detail ? detail.text : a.detail}
      </span>
    </div>
  )
}

function GroupCard({ g, token, unlocked, onSaved }: { g: Group; token: string; unlocked: boolean; onSaved: () => void }) {
  const [check, setCheck] = useState<{ busy: boolean; ok?: boolean; detail?: string }>({ busy: false })
  const run = async () => {
    setCheck({ busy: true })
    const r = await call(token, `/api/admin/integrations/check/${g.id}`, 'POST')
    setCheck(r.ok ? { busy: false, ok: !!r.data?.ok, detail: String(r.data?.detail ?? '') } : { busy: false, ok: false, detail: r.error })
    if (g.status) onSaved()
  }
  const st = g.status
  const stTone = st?.state === 'configured' ? 'border-green/40 text-green' : st?.state === 'not_configured' ? 'border-line-strong text-faint' : 'border-error/50 text-error'
  return (
    <div className="flex min-w-0 flex-col gap-3" data-testid={`integrations-${g.id}`}>
      <h3 className="m-0 text-[16px] font-semibold text-ink">
        {g.title} {g.optionalGroup && <span className="text-[12px] font-normal text-faint">optional</span>}
      </h3>
      <p className="m-0 text-[13px] text-muted">{g.body}</p>
      {g.usedIn && <p className="m-0 text-[12px] text-faint">Where this is used: {g.usedIn}</p>}
      {st && (
        <div className="flex min-w-0 flex-col gap-1 rounded-input border border-line px-3 py-3" role="status" data-testid={`status-${g.id}`} data-state={st.state}>
          <div className="flex flex-wrap items-center gap-2">
            <span className={pillCls(stTone)}>{st.state === 'configured' ? 'Configured' : st.state === 'not_configured' ? 'Not configured' : st.state === 'rejected' ? 'Rejected' : 'Account problem'}</span>
            <span className="min-w-0 text-[13px] text-ink">{st.label}</span>
          </div>
          <span className="text-[12px] text-faint">
            {st.lastCheck ? `Last check: ${st.lastCheck.result}, ${dateTimePT(st.lastCheck.at)}` : 'Not checked yet. Press Check after saving a key.'}
            {st.since ? ` · not answering since ${dateTimePT(st.since)}` : ''}
            {st.search ? ` · semantic search ${st.search}` : ''}
          </span>
        </div>
      )}
      {g.guide && (
        <details className="rounded-input border border-line px-3 py-2 text-[13px] text-muted" data-testid={`guide-${g.id}`}>
          <summary className="cursor-pointer text-ink">How to get these</summary>
          <ol className="mt-2 mb-2 flex list-decimal flex-col gap-1 pl-5">
            {g.guide.steps.map((st) => (
              <li key={st}>{st}</li>
            ))}
          </ol>
          <div className="flex flex-wrap gap-3">
            {g.guide.links.map((l) => (
              <a key={l.url} href={l.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-ink underline">
                {l.label} <ExternalLink size={13} aria-hidden />
              </a>
            ))}
          </div>
          {g.guide.note && <p className="mt-2 mb-0 text-[12px] text-faint">{g.guide.note}</p>}
        </details>
      )}
      {g.notes?.map((n) => (
        <div key={n.id} className="flex flex-col gap-1 rounded-input border border-line px-3 py-3" data-testid={`note-${n.id}`}>
          <span className="text-[14px] font-medium text-ink">{n.title}</span>
          <span className="text-[13px] text-muted">{n.text}</span>
          {n.links.map((l) => (
            <a key={l.url} href={l.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[13px] text-ink underline">
              {l.label} <ExternalLink size={13} aria-hidden />
            </a>
          ))}
        </div>
      ))}
      {g.info && g.info.length > 0 && <InfoRows rows={g.info} />}
      {g.fields.length > 0 && (
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {g.fields.map((f) => (
            <FieldRow key={f.name} f={f} token={token} unlocked={unlocked} onSaved={onSaved} />
          ))}
        </ul>
      )}
      {g.canCheck && (
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className={ctl} disabled={check.busy} onClick={() => void run()} data-testid={`check-${g.id}`}>
            {check.busy ? <Loader2 size={16} className="animate-spin" aria-hidden /> : <ShieldCheck size={16} aria-hidden />}
            Check
          </button>
          {check.detail && (
            <span className={`text-[13px] ${check.ok ? 'text-green' : 'text-muted'}`} role="status">
              {check.detail}
            </span>
          )}
        </div>
      )}
      {g.actions?.map((a) => (
        <ActionButton key={a.id} a={a} token={token} unlocked={unlocked} />
      ))}
    </div>
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
      {data?.groups.filter((g) => !g.section).map((g) => (
        <GroupCard key={g.id} g={g} token={token} unlocked={unlocked} onSaved={load} />
      ))}
      {data?.groups
        .filter((g) => g.section === 'ai')
        .map((g) => (
          <div key={g.id} className="flex min-w-0 flex-col gap-4 border-t border-line pt-5" data-testid="integrations-ai">
            <GroupCard g={g} token={token} unlocked={unlocked} onSaved={load} />
          </div>
        ))}
      {data?.groups.some((g) => g.section === 'bots') && (
        <div className="flex min-w-0 flex-col gap-4 border-t border-line pt-5" data-testid="integrations-bots">
          <h3 className="m-0 font-display text-[18px] font-bold uppercase">Bots and apps</h3>
          <p className="m-0 text-[13px] text-muted">
            The few bots and apps Gully Labs runs. Paste each token here before or right after you create the bot: never in chat. Each card has the steps, the URLs to paste into the platform and a Check that only reads.
          </p>
          {data.groups
            .filter((g) => g.section === 'bots')
            .map((g) => (
              <GroupCard key={g.id} g={g} token={token} unlocked={unlocked} onSaved={load} />
            ))}
        </div>
      )}
      {data?.groups.some((g) => g.section === 'devtools') && (
        <div className="flex min-w-0 flex-col gap-4 border-t border-line pt-5" data-testid="integrations-devtools">
          <h3 className="m-0 font-display text-[18px] font-bold uppercase">Developer tools</h3>
          <p className="m-0 text-[13px] text-muted">
            Publisher and App details for the Gully developer tools. Values are only stored here. Nothing is published automatically: the release lane reads them when you say publish.
          </p>
          {data.progress && <ProgressPanel rows={data.progress} />}
          {data.groups
            .filter((g) => g.section === 'devtools')
            .map((g) => (
              <GroupCard key={g.id} g={g} token={token} unlocked={unlocked} onSaved={load} />
            ))}
        </div>
      )}
    </section>
  )
}
