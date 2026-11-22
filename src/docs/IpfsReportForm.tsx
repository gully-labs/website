import { useEffect, useState, type FormEvent } from 'react'

/* The Gully IPFS abuse report form (docs.gullylabs.xyz/ipfs#report, linked from the gateway landing page). POST
   /api/ipfs/report (server/ipfs-abuse.mjs): rate limited, stored, reviewed by a person; a report removes nothing by itself. */

interface Cat {
  id: string
  label: string
}
const FALLBACK: Cat[] = [
  { id: 'csam', label: 'Child sexual abuse material' },
  { id: 'illegal', label: 'Other illegal content (terrorism, trafficking, threats)' },
  { id: 'malware', label: 'Malware or phishing' },
  { id: 'copyright', label: 'Copyright or trademark' },
  { id: 'privacy', label: 'Private information or non-consensual imagery' },
  { id: 'other', label: 'Something else' },
]
const field = 'min-h-11 w-full rounded-[10px] border border-line bg-transparent px-3 text-[14px] text-ink'

export function IpfsReportForm() {
  const [cats, setCats] = useState<Cat[]>(FALLBACK)
  const [state, setState] = useState<'idle' | 'busy' | 'done'>('idle')
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => {
    fetch('/api/ipfs/report/categories')
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { categories?: Cat[] } | null) => d?.categories?.length && setCats(d.categories))
      .catch(() => {})
  }, [])
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const f = new FormData(e.currentTarget)
    setState('busy')
    setErr(null)
    try {
      const r = await fetch('/api/ipfs/report', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-requested-with': 'gully' },
        body: JSON.stringify({ cid: f.get('cid'), category: f.get('category'), details: f.get('details'), email: f.get('email'), website: f.get('website') }),
      })
      const d = (await r.json().catch(() => null)) as { error?: string } | null
      if (!r.ok) {
        setErr(d?.error ?? `The server answered ${r.status}.`)
        setState('idle')
        return
      }
      setState('done')
    } catch {
      setErr('The report did not reach the server. Try again.')
      setState('idle')
    }
  }
  if (state === 'done')
    return (
      <p className="m-0 rounded-card border border-line bg-card-token p-4 text-[14px] text-ink" role="status" data-testid="ipfs-report-done">
        Thank you. A person reads every report. Nothing is removed automatically; if the content breaks the policy it is taken down and the same file is refused if it is uploaded again.
      </p>
    )
  return (
    <form onSubmit={(e) => void submit(e)} className="flex max-w-[560px] flex-col gap-3" data-testid="ipfs-report-form">
      <label className="flex flex-col gap-1 text-[13px] text-ink-2">
        The CID or the gateway link
        <input name="cid" required maxLength={600} className={`${field} font-mono`} placeholder="bafy… or https://ipfs.gullylabs.xyz/ipfs/…" autoComplete="off" />
      </label>
      <label className="flex flex-col gap-1 text-[13px] text-ink-2">
        What is wrong with it
        <select name="category" required defaultValue="" className={field}>
          <option value="" disabled>
            Choose one
          </option>
          {cats.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-[13px] text-ink-2">
        Details (optional)
        <textarea name="details" maxLength={2000} rows={4} className={`${field} py-2`} />
      </label>
      <label className="flex flex-col gap-1 text-[13px] text-ink-2">
        Your email, only if you want an answer (optional)
        <input name="email" type="email" maxLength={254} className={field} autoComplete="email" />
      </label>
      {/* A trap for bots: people never see or fill it. */}
      <input name="website" tabIndex={-1} autoComplete="off" aria-hidden className="absolute left-[-9999px] h-0 w-0 opacity-0" />
      {err && (
        <p className="m-0 text-[13px] text-down" role="alert">
          {err}
        </p>
      )}
      <button type="submit" disabled={state === 'busy'} className="inline-flex min-h-11 items-center justify-center self-start rounded-full border border-line-strong px-5 text-[14px] text-ink hover:border-gold disabled:opacity-60">
        {state === 'busy' ? 'Sending…' : 'Send the report'}
      </button>
    </form>
  )
}
