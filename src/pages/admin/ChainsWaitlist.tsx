import { useCallback, useEffect, useMemo, useState } from 'react'
import { C } from '../../components/charts/chartPresets'
import { ChartSkeleton } from '../../components/charts/ChartSkeleton'
import { DayBars } from '../../components/charts/DayBars'
import { adminCall } from './payAdmin'

/* Admin: the Gully Chains waitlist (GET /api/admin/chains/waitlist, server/chains-waitlist.mjs). Sign-ups per day for
   30 days and the newest rows with their answers. The server stores free text HTML-escaped; it is decoded here and
   printed as plain text. Polled every 60 s. */

interface Row {
  id: string
  at: string
  project: string
  contact: string
  useCase: string
  scale: string
  gasToken: string
  da: string
  wantsAa: string
  wantsDeepcore: string
  notes: string
}

const card = 'flex min-w-0 flex-col gap-4 rounded-card border border-line bg-surface p-6 max-[600px]:p-4'
const unescape = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')

export function ChainsWaitlist({ token }: { token: string }) {
  const [rows, setRows] = useState<Row[] | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const load = useCallback(() => {
    adminCall<{ rows: Row[] }>(token, '/api/admin/chains/waitlist').then((r) => (r.ok ? (setRows(r.data.rows), setErr(null)) : setErr(r.error)))
  }, [token])
  useEffect(() => {
    load()
    const id = setInterval(load, 60_000)
    return () => clearInterval(id)
  }, [load])
  const days = useMemo(() => {
    const today = Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate())
    const out = Array.from({ length: 30 }, (_, i) => ({ day: new Date(today - (29 - i) * 86_400_000).toISOString().slice(0, 10), signups: 0 }))
    for (const r of rows ?? []) {
      const d = out.find((x) => x.day === r.at.slice(0, 10))
      if (d) d.signups++
    }
    return out
  }, [rows])
  const any = days.some((d) => d.signups > 0)
  return (
    <section className={card} aria-labelledby="admin-chains-waitlist">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="admin-chains-waitlist" className="m-0 font-display text-[22px] font-bold uppercase">
          Gully Chains waitlist
        </h2>
        <span className="font-mono text-[12px] text-faint">{rows ? `${rows.length} on the list` : 'the /chains form'}</span>
      </div>
      {err && <p className="m-0 font-mono text-[12px] text-error">{err}</p>}
      {!rows && !err && <span className="font-mono text-[12px] text-faint">Loading…</span>}
      {rows &&
        (any ? (
          <DayBars days={days} series={[{ key: 'signups', label: 'Sign-ups', color: C.gold }]} height={120} unit="sign-ups" />
        ) : (
          <div className="relative h-[120px] w-full">
            <ChartSkeleton variant="bars" />
            <span className="absolute inset-0 grid place-items-center px-4 text-center font-mono text-[12px] text-faint">No sign-up in the last 30 days.</span>
          </div>
        ))}
      {rows && !!rows.length && (
        <ul className="m-0 flex max-h-[420px] list-none flex-col gap-2 overflow-y-auto p-0">
          {rows.slice(0, 100).map((r) => (
            <li key={r.id} className="flex flex-col gap-1 rounded-input border border-line px-3 py-2 font-mono text-[12px]">
              <span className="flex flex-wrap items-baseline justify-between gap-2">
                <b className="font-medium text-ink">{unescape(r.project)}</b>
                <span className="text-faint">{new Date(r.at).toISOString().slice(0, 16).replace('T', ' ')} UTC</span>
              </span>
              <span className="text-gold">{unescape(r.contact)}</span>
              <span className="text-muted">
                {r.useCase} · {r.scale} · gas {r.gasToken} · DA {r.da} · AA {r.wantsAa} · DeepCore {r.wantsDeepcore}
              </span>
              {r.notes && <span className="text-muted">{unescape(r.notes)}</span>}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
