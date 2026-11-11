import { useCallback, useEffect, useState } from 'react'
import { dateTimePT } from '../../lib/time'
import { adminCall } from './payAdmin'

/* Admin: Gully IPFS review queue (GET /api/admin/ipfs/reviews, server/ipfs-pins.mjs). Images and video customers pin
   or upload wait here, highest scanner score first (images the scanner scored low never get here; video, SVG and
   images it could not score always do): look at each one through the gateway, then Keep it, or Take it down (unpinned on every node,
   blocks purged, the gateway refuses the CID, re-pinning it is refused). A takedown by CID works for any CID. */

interface Review {
  id: string
  cid: string
  owner: string
  mime: string
  at: string
  score?: number
}

const card = 'flex min-w-0 flex-col gap-4 rounded-card border border-line bg-surface p-6 max-[600px]:p-4'
const btn = 'inline-flex min-h-11 items-center rounded-full border border-line px-4 text-[13px] text-ink hover:border-line-strong disabled:opacity-50'

export function IpfsReviewAdmin({ token }: { token: string }) {
  const [rows, setRows] = useState<Review[] | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [cid, setCid] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const load = useCallback(() => {
    adminCall<{ reviews: Review[] }>(token, '/api/admin/ipfs/reviews').then((r) => (r.ok ? (setRows(r.data.reviews), setErr(null)) : setErr(r.error)))
  }, [token])
  useEffect(() => {
    load()
    const id = setInterval(load, 60_000)
    return () => clearInterval(id)
  }, [load])
  const keep = async (r: Review) => {
    setBusy(r.id)
    const x = await adminCall(token, `/api/admin/ipfs/reviews/${r.id}/ok`, {})
    setBusy(null)
    if (!x.ok) setErr(x.error)
    load()
  }
  const takedown = async (c: string) => {
    if (!window.confirm(`Take down ${c}? It is unpinned everywhere and the gateway refuses it.`)) return
    setBusy(c)
    const x = await adminCall(token, '/api/admin/ipfs/takedown', { cid: c, reason: 'content policy' })
    setBusy(null)
    if (!x.ok) setErr(x.error)
    else setCid('')
    load()
  }
  return (
    <div className={card} data-testid="admin-ipfs-review">
      <h3 className="m-0 font-display text-[18px] font-bold text-ink">Gully IPFS review queue</h3>
      {err && <p className="m-0 text-[13px] text-down">{err}</p>}
      {!rows ? (
        <p className="m-0 text-[14px] text-muted">Reading…</p>
      ) : !rows.length ? (
        <p className="m-0 text-[14px] text-muted">Nothing waiting for review.</p>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {rows.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 rounded-[10px] border border-line px-3 py-2">
              <span className="flex min-w-0 flex-col gap-1 font-mono text-[12px] text-muted">
                <a href={`https://ipfs.gullylabs.xyz/ipfs/${r.cid}`} target="_blank" rel="noopener noreferrer" className="truncate text-ink underline decoration-dotted">
                  {r.cid}
                </a>
                <span>
                  {r.mime} · {r.score != null ? `scanner ${Math.round(r.score * 100)} %` : 'not scanned'} · {r.owner} · {dateTimePT(r.at)}
                </span>
              </span>
              <span className="flex gap-2">
                <button type="button" className={btn} disabled={busy === r.id} onClick={() => void keep(r)}>
                  Keep
                </button>
                <button type="button" className={btn} disabled={busy === r.cid} onClick={() => void takedown(r.cid)}>
                  Take down
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          if (cid.trim()) void takedown(cid.trim())
        }}
      >
        <input className="min-h-11 min-w-[280px] flex-1 rounded-[10px] border border-line bg-transparent px-3 font-mono text-[13px]" placeholder="Take down a CID (report or notice)" value={cid} onChange={(e) => setCid(e.target.value)} />
        <button type="submit" className={btn} disabled={!cid.trim()}>
          Take down
        </button>
      </form>
    </div>
  )
}
