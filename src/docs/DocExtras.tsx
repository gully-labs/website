// Small live parts for docs pages that had no chart: a badge the server draws as you look (Badges), and the
// stage timeline of the Gully L3 plan (Roadmap: Gully L3). Both use the chart kit's live CSS, so they pause off-screen.

import { useEffect, useRef, useState } from 'react'
import { AnimatedNumber } from '../components/charts/AnimatedNumber'
import { GhostChart } from '../components/charts/GhostChart'
import { useLiveSeries } from '../components/charts/useLiveSeries'
import { useInView } from '../components/charts/useMiniChart'
import { NF } from '../components/charts/number-formats'
import { ChainLogo } from '../components/logos/ChainLogo'
import { apiOrigin } from './nav'

/* ------------------------------------------------------------- live badge --- */

interface Render {
  url: string
  ms: number
  bytes: number
}

/**
 * One badge, drawn by the server on every read: this card fetches /badges/example/score.svg every 30 seconds, shows the
 * fresh image and how long the render took. It is a real round trip from this browser, not a stored picture.
 */
export function LiveBadge({ theme }: { theme: 'dark' | 'light' }) {
  const ref = useRef<HTMLDivElement>(null)
  const inView = useInView(ref)
  const prev = useRef<string | null>(null)
  const { data, error, updatedAt } = useLiveSeries<Render>(async (signal) => {
    const t0 = performance.now()
    const r = await fetch(`${apiOrigin()}/badges/example/score.svg?size=L&theme=${theme}&t=${Date.now()}`, { signal, cache: 'no-store' })
    if (!r.ok) throw new Error(String(r.status))
    const blob = await r.blob()
    return { url: URL.createObjectURL(blob), ms: Math.round(performance.now() - t0), bytes: blob.size }
  }, 30_000)
  useEffect(() => {
    if (!data) return
    const old = prev.current
    prev.current = data.url
    if (old) setTimeout(() => URL.revokeObjectURL(old), 1000)
  }, [data])
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])
  const ago = updatedAt ? Math.max(0, Math.round((now - updatedAt) / 1000)) : null
  return (
    <div ref={ref} data-live={inView ? 'on' : 'paused'} data-testid="live-badge" className="flex min-w-0 flex-col gap-3 rounded-card border border-line bg-card-token px-4 py-3">
      <div className={`relative flex min-h-[64px] items-center justify-center rounded-card border px-5 ${theme === 'dark' ? 'border-line bg-bg-footer' : 'border-paper-line bg-paper-3'}`}>
        {data ? <img key={data.url} src={data.url} alt="Gully Score badge, rendered by the server just now (example)" height={36} style={{ animation: 'gl-fade .5s ease both' }} /> : error ? <span className="font-mono text-[11px] text-error">unreachable</span> : <GhostChart label="Rendering…" height={56} badge={false} framed={false} />}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="inline-flex items-center gap-2 font-mono text-[11px] tracking-[1px] text-faint">
          <span className="relative inline-flex size-[8px]">
            <span className="gl-live-ring absolute inset-0 rounded-full bg-green" />
            <span className="relative size-[8px] rounded-full bg-green" />
          </span>
          RENDERED LIVE · EVERY 30 S
        </span>
        <span className="font-mono text-[12px] text-ink-2">
          {data ? (
            <>
              <AnimatedNumber value={data.ms} format={NF.int} suffix=" ms" /> · {data.bytes.toLocaleString('en-US')} bytes{ago !== null ? ` · ${ago} s ago` : ''}
            </>
          ) : (
            'reading…'
          )}
        </span>
      </div>
    </div>
  )
}

/* ----------------------------------------------------------- L3 timeline --- */

type Stage = { id: string; name: string; chain: string | null; state: 'prepared' | 'planned'; note: string }

const STAGES: Stage[] = [
  { id: 'S0', name: 'Light devnet', chain: null, state: 'prepared', note: 'Prepared, not started' },
  { id: 'S1', name: 'Gully Devnet', chain: 'Arbitrum Sepolia', state: 'planned', note: 'Planned' },
  { id: 'S2', name: 'Gully L3', chain: 'Arbitrum One', state: 'planned', note: 'Planned' },
]

/** The three stages on one line. The line fills to the stage we are at (S0, prepared) and its marker pulses; later stages stay open. */
export function L3Timeline() {
  const ref = useRef<HTMLDivElement>(null)
  const inView = useInView(ref)
  return (
    <div ref={ref} data-live={inView ? 'on' : 'paused'} data-testid="l3-timeline" className="rounded-card border border-line bg-card-token px-4 py-4">
      <span className="font-mono text-[11px] tracking-[1px] text-faint">GULLY L3 · STAGES, 17 OCTOBER 2026</span>
      <ol className="relative m-0 mt-4 grid list-none grid-cols-3 gap-2 p-0 max-[640px]:grid-cols-1 max-[640px]:gap-4">
        <span aria-hidden className="absolute top-[11px] right-[16%] left-[16%] h-[2px] rounded-full bg-line-strong max-[640px]:hidden">
          <span className="gl-live-breathe absolute inset-y-0 left-0 w-[8%] origin-left rounded-full bg-gold" style={{ animation: 'gl-grow-x 1.2s cubic-bezier(.2,.8,.2,1) both, gl-area-breathe 5s ease-in-out 1.2s infinite' }} />
        </span>
        {STAGES.map((s) => {
          const now = s.state === 'prepared'
          return (
            <li key={s.id} className="relative flex min-w-0 flex-col items-center gap-1 text-center max-[640px]:flex-row max-[640px]:gap-3 max-[640px]:text-left">
              <span className="relative inline-flex size-[22px] flex-none items-center justify-center">
                {now && <span className="gl-live-ring absolute inset-0 rounded-full bg-gold" />}
                <span className={`relative size-[12px] rounded-full border-2 ${now ? 'border-gold bg-gold' : 'border-line-strong bg-bg'}`} />
              </span>
              <span className="flex min-w-0 flex-col items-center gap-1 max-[640px]:items-start">
                <span className="font-mono text-[12px] text-ink">
                  {s.id} · {s.name}
                </span>
                {s.chain && (
                  <span className="inline-flex items-center gap-[6px] text-[13px] text-muted">
                    <ChainLogo chain={s.chain} size={16} decorative />
                    {s.chain}
                  </span>
                )}
                <span className={`font-mono text-[11px] tracking-[.5px] ${now ? 'text-gold' : 'text-dim'}`}>{s.note}</span>
              </span>
            </li>
          )
        })}
      </ol>
    </div>
  )
}
