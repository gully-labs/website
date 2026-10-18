import { Activity, ChartCandlestick, Rocket } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { AnimatedNumber } from '../../../components/charts/AnimatedNumber'
import { useTracker } from '../../../lib/tracker'
import { ago } from '../api'
import { Dialog } from '../Dialog'
import { LiveMarker } from '../vcharts'
import { Unknown } from '../ui'
import { healthOf, useHealthPings } from './health'
import { LineChart } from './LineChart'
import { useLaunches } from './useDeepcore'

/* The app's Status view (the header's Status button): this server's API from this browser (GET /healthz
   every 5 s while open: up or down, uptime over the checks this session, round-trip sparkline), the
   tracker's data freshness per chain (GET /api/tracker: when it was built, each chain's pool read and
   its source), and the DeepCore launch poller (GET /api/deepcore/launches: state, last poll, each chain).
   Everything is read live; what cannot be read says so. */

const dot = (c: string) => <span className="size-2 shrink-0 rounded-full" style={{ background: c }} aria-hidden />
const GREEN = '#6fcf6a'
const RED = '#ff8a7a'
const AMBER = '#e8c060'

function Row({ ok, name, note }: { ok: boolean | null; name: string; note: ReactNode }) {
  return (
    <li className="flex min-h-8 items-center gap-2 border-t border-line py-[6px] text-[13px] first:border-t-0">
      {dot(ok === null ? AMBER : ok ? GREEN : RED)}
      <span className="min-w-0 flex-1 truncate text-ink">{name}</span>
      <span className="shrink-0 font-mono text-[11px] text-faint">{note}</span>
    </li>
  )
}

function Section({ icon, title, state, children }: { icon: ReactNode; title: string; state: ReactNode; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2 rounded-[12px] border border-line bg-surface p-3" aria-label={title}>
      <div className="flex items-center gap-2">
        <span className="text-gold">{icon}</span>
        <h3 className="m-0 flex-1 text-[14px] font-semibold text-ink">{title}</h3>
        {state}
      </div>
      {children}
    </section>
  )
}

function Body() {
  const pings = useHealthPings(5_000)
  const tr = useTracker(30_000)
  const dc = useLaunches(30_000)
  // Re-render every 15 s so the "… ago" ages move.
  const [, tick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 15_000)
    return () => clearInterval(id)
  }, [])
  const h = healthOf(pings)
  const ok = pings.filter((p) => p.ms !== null) as { t: number; ms: number }[]
  const uptime = pings.length ? (ok.length / pings.length) * 100 : null
  const last = ok.at(-1)?.ms ?? null
  return (
    <div className="flex flex-col gap-2" data-testid="status-view">
      <Section
        icon={<Activity size={15} aria-hidden />}
        title="API"
        state={<span className={`font-mono text-[11px] ${h === 'up' ? 'text-green' : h === 'down' ? 'text-error' : 'text-faint'}`}>{h === 'up' ? 'online' : h === 'down' ? 'unreachable' : 'checking…'}</span>}
      >
        <div className="grid grid-cols-2 gap-2">
          <span className="flex flex-col">
            <span className="text-[12px] text-dim">Uptime · {pings.length} checks this session</span>
            <span className="font-display text-[22px] leading-none font-bold">{uptime === null ? <Unknown /> : <AnimatedNumber value={uptime} format={{ maximumFractionDigits: 1 }} suffix="%" />}</span>
          </span>
          <span className="flex flex-col">
            <span className="text-[12px] text-dim">Round trip now</span>
            <span className="font-display text-[22px] leading-none font-bold">{last === null ? <Unknown /> : <AnimatedNumber value={last} suffix=" ms" />}</span>
          </span>
        </div>
        {ok.length >= 2 ? <LineChart points={ok.map((p) => [p.t, p.ms])} color={GREEN} fmt={(v) => `${Math.round(v)} ms`} label={`API round trip from this browser over the last ${ok.length} checks, now ${last} ms.`} height={90} seconds /> : <LiveMarker text="Measuring the round trip…" height={90} />}
      </Section>

      <Section icon={<ChartCandlestick size={15} aria-hidden />} title="Tracker data" state={<span className="font-mono text-[11px] text-faint">{tr.k === 'ok' ? `built ${ago(tr.data.generatedAt)}` : tr.k === 'error' ? 'unreadable' : '…'}</span>}>
        {tr.k === 'ok' ? (
          <ul className="m-0 list-none p-0">
            {tr.data.chains.map((c) => (
              <Row key={c.key} ok={c.poolsAsOf ? !c.poolsStale : null} name={c.name} note={c.poolsAsOf ? `pools ${ago(c.poolsAsOf)}${c.poolSource ? ` · ${c.poolSource}` : ''}${c.poolsStale ? ' · stale' : ''}` : 'pools not read yet'} />
            ))}
          </ul>
        ) : (
          <span className="text-[12px] text-faint">{tr.k === 'error' ? 'GET /api/tracker did not answer.' : 'Reading…'}</span>
        )}
      </Section>

      <Section icon={<Rocket size={15} aria-hidden />} title="DeepCore launch poller" state={<span className="font-mono text-[11px] text-faint">{dc.k === 'ok' ? `${dc.data.state}${dc.data.asOf ? ` · polled ${ago(dc.data.asOf)}` : ''}` : dc.k === 'error' ? 'unreadable' : '…'}</span>}>
        {dc.k === 'ok' ? (
          <ul className="m-0 list-none p-0">
            {dc.data.chains.map((c) => (
              <Row key={c.chainId} ok={c.status === 'ok'} name={c.name} note={c.status === 'ok' ? (c.total === null ? 'answering' : `${c.total.toLocaleString('en-US')} launches indexed`) : 'unreadable'} />
            ))}
          </ul>
        ) : (
          <span className="text-[12px] text-faint">{dc.k === 'error' ? 'GET /api/deepcore/launches did not answer.' : 'Reading…'}</span>
        )}
      </Section>
    </div>
  )
}

export function StatusDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Dialog open={open} onClose={onClose} title="Status">
      {open && <Body />}
    </Dialog>
  )
}
