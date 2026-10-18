import { Activity, ChartCandlestick, LayoutGrid, Rocket } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { AnimatedNumber } from '../../../components/charts/AnimatedNumber'
import { OVERALL_WORDS, STATE_WORDS, STATUS_GROUPS, type StatusComponent, type StatusGroup, type StatusState } from '../../../lib/status'
import { ago } from '../api'
import { Dialog } from '../Dialog'
import { ExtLink } from '../ExtLink'
import { pillSm } from '../styles'
import { Unknown } from '../ui'
import { LiveMarker } from '../vcharts'
import { STATUS_PAGE, useAppStatus } from './health'
import { LineChart } from './LineChart'

/* The app's Status view (the header's Status button). It reads the public status (GET /api/status on
   gullylabs.xyz, server/status.mjs: every part of the stack checked once a minute by the server, 24 h kept in
   30-minute buckets) every 15 s while open, and links to the full public page (https://gullylabs.xyz/status, a
   new tab). The API (uptime over 24 h, latency per bucket), tracker data per chain and the DeepCore launch
   poller come first; every other part follows in one compact list. Nothing is guessed: a part the server
   could not read says "Not checked yet", one not set up on the server "Not configured". */

const STATE_COLOR: Record<StatusState, string> = { up: '#74c27b', degraded: '#d9b563', down: '#ff8a7a', off: '#949daa', unknown: '#949daa' }
const STATE_TEXT: Record<StatusState, string> = { up: 'text-green', degraded: 'text-gold', down: 'text-error', off: 'text-faint', unknown: 'text-faint' }
const dot = (s: StatusState) => <span className="size-2 shrink-0 rounded-full" style={{ background: STATE_COLOR[s] }} aria-hidden />

/** A part's row. `name` overrides its name (a section titled the same as its only part shows the detail). */
function Row({ c, name }: { c: StatusComponent; name?: string }) {
  return (
    <li className="flex min-h-8 items-center gap-2 border-t border-line py-[6px] text-[13px] first:border-t-0" title={c.detail} data-status-component={c.id} data-state={c.state}>
      {dot(c.state)}
      <span className="min-w-0 flex-1 truncate text-ink">{name ?? c.name}</span>
      <span className="min-w-0 max-w-[55%] truncate font-mono text-[11px] text-faint">
        {STATE_WORDS[c.state]}
        {c.uptime24h !== null ? ` · ${c.uptime24h.toFixed(c.uptime24h >= 99.95 ? 0 : 1)}% 24h` : ''}
      </span>
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

/** A group's worst state, for its heading. */
function worst(list: StatusComponent[]): StatusState | null {
  for (const s of ['down', 'degraded', 'up', 'unknown', 'off'] as StatusState[]) if (list.some((c) => c.state === s)) return s
  return null
}

function GroupRows({ list, empty, title }: { list: StatusComponent[]; empty: string; title: string }) {
  return list.length ? (
    <ul className="m-0 list-none p-0">
      {list.map((c) => (
        <Row key={c.id} c={c} name={c.name === title ? c.detail : c.name.replace(/^Tracker: /, '')} />
      ))}
    </ul>
  ) : (
    <span className="text-[12px] text-faint">{empty}</span>
  )
}

function Body() {
  const s = useAppStatus(15_000)
  // Re-render every 15 s so the "… ago" ages move.
  const [, tick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 15_000)
    return () => clearInterval(id)
  }, [])
  const b = s.body
  const of = (g: StatusGroup) => (b ? b.components.filter((c) => c.group === g) : [])
  const api = b?.components.find((c) => c.id === 'api') ?? of('platform')[0] ?? null
  const latency = (api?.history ?? []).filter((h) => h.ms !== null).map((h) => [Date.parse(h.t), h.ms as number] as [number, number])
  const others = STATUS_GROUPS.filter((g) => !['platform', 'tracker', 'deepcore'].includes(g.id))
  const pending = s.error ? 'unreadable' : '…'
  const stateChip = (list: StatusComponent[]) => {
    const w = worst(list)
    return <span className={`font-mono text-[11px] ${w ? STATE_TEXT[w] : 'text-faint'}`}>{w ? STATE_WORDS[w] : pending}</span>
  }
  return (
    <div className="flex flex-col gap-2" data-testid="status-view">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className={`inline-flex items-center gap-2 text-[14px] font-semibold ${b ? (b.overall === 'operational' ? 'text-green' : b.overall === 'degraded' ? 'text-gold' : 'text-error') : 'text-faint'}`} data-testid="status-overall">
          {b ? OVERALL_WORDS[b.overall] : s.error ? 'The status could not be read just now' : 'Reading the status…'}
        </span>
        <ExtLink href={STATUS_PAGE} className={pillSm} data-testid="status-page-link">
          Full status page
        </ExtLink>
      </div>

      <Section icon={<Activity size={15} aria-hidden />} title="API" state={<span className={`font-mono text-[11px] ${api ? STATE_TEXT[api.state] : 'text-faint'}`}>{api ? (api.state === 'up' ? 'API online' : STATE_WORDS[api.state]) : pending}</span>}>
        <div className="grid grid-cols-2 gap-2">
          <span className="flex flex-col">
            <span className="text-[12px] text-dim">Uptime · last 24 h</span>
            <span className="font-display text-[22px] leading-none font-bold">{api?.uptime24h == null ? <Unknown /> : <AnimatedNumber value={api.uptime24h} format={{ maximumFractionDigits: 1 }} suffix="%" />}</span>
          </span>
          <span className="flex flex-col">
            <span className="text-[12px] text-dim">Latency · last check</span>
            <span className="font-display text-[22px] leading-none font-bold">{api?.latencyMs == null ? <Unknown /> : <AnimatedNumber value={api.latencyMs} suffix=" ms" />}</span>
          </span>
        </div>
        {latency.length >= 2 ? <LineChart points={latency} color={STATE_COLOR.up} fmt={(v) => `${Math.round(v)} ms`} label={`API latency per 30 minutes over the last ${latency.length} buckets.`} height={90} /> : <LiveMarker text={api?.detail ?? 'Collecting the API history…'} height={90} />}
      </Section>

      <Section icon={<ChartCandlestick size={15} aria-hidden />} title="Tracker data" state={stateChip(of('tracker'))}>
        <GroupRows title="Tracker data" list={of('tracker')} empty={s.error ? 'GET /api/status did not answer.' : 'Reading…'} />
      </Section>

      <Section icon={<Rocket size={15} aria-hidden />} title="DeepCore launch poller" state={stateChip(of('deepcore'))}>
        <GroupRows title="DeepCore launch poller" list={of('deepcore')} empty={s.error ? 'GET /api/status did not answer.' : 'Reading…'} />
      </Section>

      <Section icon={<LayoutGrid size={15} aria-hidden />} title="Everything else" state={stateChip(others.flatMap((g) => of(g.id)))}>
        <GroupRows title="Everything else" list={others.flatMap((g) => of(g.id))} empty={s.error ? 'GET /api/status did not answer.' : 'Reading…'} />
      </Section>

      <span className="font-mono text-[11px] text-faint">
        {s.reads} status checks this session, every 15 s{b ? ` · server checked ${ago(b.generatedAt)}` : ''}
        {s.error && b ? ' · the last read failed; showing the one before' : ''}
      </span>
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
