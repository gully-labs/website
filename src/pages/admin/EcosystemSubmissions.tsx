import { useCallback, useEffect, useState } from 'react'
import { ChainLogo } from '../../components/logos/ChainLogo'
import { Segmented } from '../../components/ui/Segmented'
import { copyWithToast, toastError, toastSuccess } from '../../components/ui/toast'
import { DownloadCsv } from './DownloadCsv'
import { adminCall } from './payAdmin'
import { pillCls } from './ui'

/* Admin: "List your launchpad" submissions (GET/POST /api/admin/ecosystem/submissions, server/ecosystem.mjs).
   Approving only marks a submission and shows the registry entry text to paste by hand; it changes nothing
   else. Every text field arrives HTML-escaped from the server and is drawn as plain text here. */

interface Submission {
  id: string
  name: string
  url: string
  contact: string
  chains: string[]
  factory: string | null
  eventSignature: string | null
  lookupUrl: string | null
  note: string
  status: 'pending' | 'approved' | 'rejected'
  createdAt: string
  decidedAt: string | null
}
interface View {
  submissions: Submission[]
  counts: { pending: number; approved: number; rejected: number }
}

const card = 'flex min-w-0 flex-col gap-4 rounded-card border border-line bg-surface p-6 max-[600px]:p-4'
const h2 = 'm-0 font-display text-[22px] font-bold uppercase'
const unesc = (s: string) => s.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&amp;/g, '&')
const btn = 'min-h-11 rounded-btn border px-4 font-mono text-[12px] transition-colors disabled:opacity-50'

export function EcosystemSubmissions({ token }: { token: string }) {
  const [data, setData] = useState<View | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [show, setShow] = useState<'pending' | 'approved' | 'rejected'>('pending')
  const [busy, setBusy] = useState<string | null>(null)
  const [entries, setEntries] = useState<Record<string, string>>({})
  const load = useCallback(() => {
    adminCall<View>(token, '/api/admin/ecosystem/submissions').then((r) => (r.ok ? (setData(r.data), setErr(null)) : setErr(r.error)))
  }, [token])
  useEffect(() => {
    load()
    const id = setInterval(load, 60_000)
    return () => clearInterval(id)
  }, [load])

  async function decide(s: Submission, action: 'approve' | 'reject') {
    setBusy(s.id)
    const r = await adminCall<{ submission: Submission; registryEntry?: string }>(token, '/api/admin/ecosystem/submissions', { id: s.id, action })
    setBusy(null)
    if (!r.ok) return toastError(r.error)
    if (r.data.registryEntry) setEntries((e) => ({ ...e, [s.id]: r.data.registryEntry! }))
    toastSuccess(action === 'approve' ? 'Approved. Paste the entry into the registry by hand.' : 'Rejected.')
    load()
  }

  const rows = (data?.submissions ?? []).filter((s) => s.status === show)
  return (
    <section className={card}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className={h2}>Launchpad submissions</h2>
        <Segmented<'pending' | 'approved' | 'rejected'>
          label="Show"
          value={show}
          onChange={setShow}
          options={(['pending', 'approved', 'rejected'] as const).map((k) => ({ id: k, label: `${k.toUpperCase()} ${data?.counts[k] ?? 0}` }))}
        />
      </div>
      {!!data?.submissions.length && (
        <div>
          <DownloadCsv token={token} path="/api/admin/ecosystem/submissions?format=csv" filename="ecosystem-submissions.csv" />
        </div>
      )}
      <p className="m-0 text-[13px] text-muted">Approving marks the submission and shows the registry entry to paste by hand. It changes nothing automatically.</p>
      {err && <p className="m-0 text-[14px] text-error">{err}</p>}
      {!data && !err && <p className="m-0 text-[14px] text-muted">Loading…</p>}
      {data && !rows.length && <p className="m-0 text-[14px] text-muted">None {show}.</p>}
      <ul className="m-0 flex max-h-[640px] list-none flex-col gap-3 overflow-y-auto p-0">
        {rows.map((s) => (
          <li key={s.id} className="flex min-w-0 flex-col gap-2 rounded-input border border-line px-4 py-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <b className="text-[15px]">{unesc(s.name)}</b>
              <span className={pillCls(s.status === 'approved' ? 'border-success-line text-green' : s.status === 'rejected' ? 'border-error text-error' : 'border-gold-line text-gold')}>{s.status}</span>
            </div>
            <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 font-mono text-[12px] break-all text-muted">
              <dt className="text-faint">site</dt>
              <dd className="m-0">
                <a href={s.url} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center text-gold underline">
                  {s.url}
                </a>
              </dd>
              <dt className="text-faint">contact</dt>
              <dd className="m-0">{unesc(s.contact)}</dd>
              <dt className="text-faint">chains</dt>
              <dd className="m-0 flex flex-wrap items-center gap-2">
                {s.chains.map((c) => (
                  <span key={c} className="inline-flex items-center gap-1">
                    <ChainLogo chain={c} size={16} decorative />
                    {c}
                  </span>
                ))}
              </dd>
              {s.factory && (
                <>
                  <dt className="text-faint">factory</dt>
                  <dd className="m-0">{s.factory}</dd>
                  <dt className="text-faint">event</dt>
                  <dd className="m-0">{unesc(s.eventSignature ?? '')}</dd>
                </>
              )}
              {s.lookupUrl && (
                <>
                  <dt className="text-faint">lookup</dt>
                  <dd className="m-0">{s.lookupUrl}</dd>
                </>
              )}
              {s.note && (
                <>
                  <dt className="text-faint">note</dt>
                  <dd className="m-0 font-sans whitespace-pre-wrap">{unesc(s.note)}</dd>
                </>
              )}
              <dt className="text-faint">sent</dt>
              <dd className="m-0">{new Date(s.createdAt).toLocaleString()}</dd>
            </dl>
            {s.status === 'pending' && (
              <div className="flex flex-wrap gap-2">
                <button type="button" disabled={busy === s.id} onClick={() => decide(s, 'approve')} className={`${btn} border-gold bg-gold text-bg`}>
                  Approve
                </button>
                <button type="button" disabled={busy === s.id} onClick={() => decide(s, 'reject')} className={`${btn} border-line-strong text-ink hover:border-error`}>
                  Reject
                </button>
              </div>
            )}
            {entries[s.id] && (
              <div className="flex flex-col gap-2">
                <pre className="m-0 overflow-x-auto rounded-input border border-line bg-surface-deep p-3 font-mono text-[12px]">{entries[s.id]}</pre>
                <div>
                  <button type="button" onClick={() => copyWithToast(entries[s.id], 'Registry entry')} className={`${btn} border-line-strong text-ink hover:border-gold`}>
                    Copy registry entry
                  </button>
                </div>
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}
