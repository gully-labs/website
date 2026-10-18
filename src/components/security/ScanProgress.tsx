import { Check, Loader2, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { AnimatedNumber } from '../charts/AnimatedNumber'
import { STEPS, type JobStatus } from './types'

/* A running scan's live progress: the engine's steps (queued, fetching, analysing, triaging, reporting) as a track (done steps ticked, the current one
   pulsing, the bar filling to the engine's pct), the step's plain-words text and an estimate of the time
   left. The estimate is ours, from how fast pct has moved since the scan started, and is labelled as one;
   until pct moves there is none. Under reduced motion the pulse stops and the bar changes in 150 ms. */

function useEta(pct: number | null, startedAt: string | null): number | null {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1_000)
    return () => clearInterval(id)
  }, [])
  const took = startedAt ? now - Date.parse(startedAt) : 0
  if (pct == null || pct <= 0 || pct >= 100 || took <= 0) return null
  return Math.max(1, Math.round(((100 - pct) * took) / pct / 1000))
}

const etaText = (s: number) => (s < 60 ? `about ${s} s left` : `about ${Math.round(s / 60)} min left`)

export function ScanProgress({ status, pct, message, startedAt, failure }: { status: JobStatus; pct: number | null; message?: string | null; startedAt: string | null; failure?: string | null }) {
  const idx = STEPS.findIndex((s) => s.id === status)
  const cur = status === 'done' ? STEPS.length - 1 : idx
  const failed = status === 'failed' || status === 'cancelled'
  const shown = status === 'done' ? 100 : (pct ?? 0)
  const eta = useEta(status === 'done' || failed ? null : pct, startedAt)
  return (
    <div className="flex flex-col gap-4" data-testid="scan-progress" data-status={status}>
      <div className="flex items-end justify-between gap-3">
        <div className="flex flex-col">
          <span className="font-mono text-[11px] tracking-[1px] text-faint">{failed ? status.toUpperCase() : status === 'done' ? 'FINISHED' : 'RUNNING'}</span>
          <span className="text-[15px] font-semibold text-ink" aria-live="polite">
            {failed ? (status === 'cancelled' ? 'Scan cancelled' : 'The scan failed') : message || (STEPS[Math.max(0, cur)]?.text ?? 'Waiting for the engine')}
          </span>
        </div>
        <span className="flex flex-col items-end">
          <span className="font-display text-[34px] leading-none font-bold text-gold">
            <AnimatedNumber value={shown} suffix="%" />
          </span>
          <span className="font-mono text-[11px] text-faint" data-testid="eta">
            {status === 'done' ? 'report ready' : failed ? '—' : eta ? `${etaText(eta)} (estimate)` : 'estimating…'}
          </span>
        </span>
      </div>
      <div className="h-[6px] overflow-hidden rounded-full bg-line" role="progressbar" aria-label="Scan progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={shown}>
        <div className={`h-full rounded-full transition-[width] duration-700 ease-out motion-reduce:duration-150 ${failed ? 'bg-error' : 'bg-gold'}`} style={{ width: `${Math.max(2, shown)}%` }} />
      </div>
      <ol className="m-0 grid list-none grid-cols-6 gap-2 p-0 max-[900px]:grid-cols-3 max-[480px]:grid-cols-2">
        {STEPS.map((s, i) => {
          const done = !failed && (i < cur || status === 'done')
          const now = !failed && i === cur && status !== 'done'
          const stop = failed && i === Math.max(0, idx === -1 ? 0 : idx)
          return (
            <li key={s.id} className={`flex items-center gap-2 rounded-[10px] border px-3 py-2 text-[13px] transition-colors ${now ? 'border-gold-line bg-gold/[.06] text-ink' : done ? 'border-success-line text-ink-2' : stop ? 'border-error-line text-error' : 'border-line text-faint'}`} data-step={s.id} aria-current={now ? 'step' : undefined}>
              <span className="relative grid size-5 shrink-0 place-items-center">
                {now && <span aria-hidden className="absolute inset-0 rounded-full border border-gold motion-reduce:hidden" style={{ animation: 'gl-live-pulse 1.8s ease-out infinite' }} />}
                {done ? <Check size={14} className="text-green" aria-hidden /> : stop ? <X size={14} aria-hidden /> : now ? <Loader2 size={14} className="animate-spin text-gold motion-reduce:animate-none" aria-hidden /> : <span className="size-[6px] rounded-full bg-line-strong" aria-hidden />}
              </span>
              <span className="truncate">{s.label}</span>
            </li>
          )
        })}
      </ol>
      {status === 'failed' && failure && <p className="m-0 rounded-input border border-error-line px-3 py-2 text-[13px] text-error">{failure}</p>}
    </div>
  )
}
