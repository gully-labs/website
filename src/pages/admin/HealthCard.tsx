import { useCallback, useEffect, useMemo, useState } from 'react'
import type { LucideIcon } from 'lucide-react'
import { Bot, BrainCircuit, Network, Radar, Satellite, ScanSearch } from 'lucide-react'
import { EChart } from '../../components/charts/EChart'
import { C, CHART_H, sparklinePreset } from '../../components/charts/chartPresets'
import { ChartSkeleton } from '../../components/charts/ChartSkeleton'
import { adminCall } from './payAdmin'

/* Admin → Health (GET /api/admin/health): every background part the site depends on, so a dead data source
   shows here before users meet an empty page (the Holder Map ran keyless for weeks unseen). Each item has a
   status dot, plain figures, and a sparkline from the server's per-minute history (kept in memory, so it
   starts again after a restart). Unknown figures read "—", never 0. Polled every 30 s. */

type Tone = 'ok' | 'warn' | 'down' | 'off'
interface Health {
  at: string
  everySeconds: number
  holders: {
    chain: string
    name: string
    source: string | null
    env: string | null
    available: boolean
    launches: boolean
    reason: string | null
  }[]
  monitors: {
    monitors: number | null
    live: number | null
    requestsPerMin: number | null
    lastTickAt: string | null
    lastTickMs: number | null
    lagMs: number | null
    ticks: number | null
    errors: number | null
    lastError: string | null
    lastErrorAt: string | null
    detail: 'loop' | 'chains'
  }
  deepcore: {
    lastOkAt: string | null
    lagMs: number | null
    pollMs: number
    lastError: string | null
    baselineAt: string | null
    seen: number | null
    cached: number | null
  }
  bot: {
    enabled: boolean
    links: number
    lastUpdateAt: string | null
    sinceUpdateMs: number | null
    updates: number | null
    errors: number | null
    lastError: string | null
    lastErrorAt: string | null
    detail: 'webhook' | 'stats'
  }
  engine: {
    ok: boolean
    ai: boolean | null
    worker: {
      reachable: boolean
      tools: string[]
      reason: string | null
    } | null
    explorerKey: boolean | null
    queue: { running: number | null; queued: number | null } | null
    error: string | null
  }
  embeddings: {
    configured: boolean | null
    retrieval: 'bm25' | 'hybrid' | null
    indexSize: number | null
    indexUpdatedAt: string | null
    embeddings: {
      configured: boolean
      model: string | null
      ready: number | null
      total: number | null
      syncing: boolean
      lastSyncAt: string | null
      lastError: string | null
      needs: string | null
    } | null
  }
  /** The home ledger's data watchdog (server/stats-watchdog.mjs); absent on an older server. */
  stats?: { at: string | null; issues: { venue: string; kind: string; detail: string }[]; alerted: string[] }
  history: Record<string, number | string | null>[]
}

const card = 'flex min-w-0 flex-col gap-4 rounded-card border border-line bg-surface p-6 max-[600px]:p-4'
const h2 = 'm-0 font-display text-[22px] font-bold uppercase'
const small = 'font-mono text-[12px] text-faint'
const TONE: Record<Tone, { dot: string; text: string; word: string; color: string }> = {
  ok: { dot: 'bg-green', text: 'text-green', word: 'ok', color: C.green },
  warn: { dot: 'bg-gold', text: 'text-gold', word: 'degraded', color: C.gold },
  down: { dot: 'bg-error', text: 'text-error', word: 'down', color: C.error },
  off: { dot: 'bg-axis', text: 'text-faint', word: 'off', color: C.faint },
}
const dur = (ms: number | null) => (ms == null ? '—' : ms < 90_000 ? `${Math.round(ms / 1000)}s` : ms < 5_400_000 ? `${Math.round(ms / 60_000)}m` : `${Math.round(ms / 3_600_000)}h`)
const ago = (iso: string | null) => (iso ? `${dur(Date.now() - Date.parse(iso))} ago` : 'never')
const num = (n: number | null | undefined) => (n == null ? '—' : n.toLocaleString('en-US'))
const hhmm = (iso: string) =>
  new Date(iso).toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })

function Dot({ tone }: { tone: Tone }) {
  return <i aria-hidden className={`inline-block size-[9px] shrink-0 rounded-full ${TONE[tone].dot}`} style={tone === 'ok' ? { animation: 'gl-pulse-ring 2.4s ease-out infinite' } : undefined} />
}

/** A live sparkline of one history field; with fewer than two known points, an animated "collecting" state. */
function Spark({ history, field, tone, fmt, label }: { history: Health['history']; field: string; tone: Tone; fmt: (v: number) => string; label: string }) {
  const pts = useMemo(() => history.filter((h) => typeof h[field] === 'number').map((h) => ({ v: h[field] as number, t: hhmm(String(h.at)) })), [history, field])
  const option = useMemo(
    () =>
      sparklinePreset({
        data: pts.map((p) => p.v),
        labels: pts.map((p) => p.t),
        color: TONE[tone].color,
        fmt,
      }),
    [pts, tone, fmt],
  )
  if (pts.length < 2)
    return (
      <div className="relative w-full" style={{ height: CHART_H.spark }}>
        <ChartSkeleton variant="line" />
        <span className="absolute inset-0 grid place-items-center font-mono text-[11px] text-faint">collecting history…</span>
      </div>
    )
  return <EChart option={option} height={CHART_H.spark} label={label} skeleton="line" steps={{ count: pts.length }} />
}

function Item({
  icon: Icon,
  title,
  tone,
  status,
  rows,
  children,
  testId,
}: {
  icon: LucideIcon
  title: string
  tone: Tone
  status: string
  rows: [string, string][]
  children?: React.ReactNode
  testId: string
}) {
  return (
    <li className="flex min-w-0 flex-col gap-3 rounded-input border border-line bg-surface-deep p-4" data-testid={testId}>
      <div className="flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-2 text-[15px] font-medium">
          <Icon size={16} className="shrink-0 text-gold" aria-hidden />
          <span className="truncate">{title}</span>
        </span>
        <span className={`flex shrink-0 items-center gap-2 font-mono text-[12px] ${TONE[tone].text}`}>
          <Dot tone={tone} /> {status}
        </span>
      </div>
      {rows.length > 0 && (
        <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 font-mono text-[12px]">
          {rows.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-faint">{k}</dt>
              <dd className="m-0 min-w-0 truncate text-right text-ink-2" title={v}>
                {v}
              </dd>
            </div>
          ))}
        </dl>
      )}
      {children}
    </li>
  )
}

export function HealthCard({ token }: { token: string }) {
  const [h, setH] = useState<Health | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const load = useCallback(() => {
    adminCall<Health>(token, '/api/admin/health').then((r) => (r.ok ? (setH(r.data), setErr(null)) : setErr(r.error)))
  }, [token])
  useEffect(() => {
    load()
    const id = setInterval(load, 30_000)
    return () => clearInterval(id)
  }, [load])

  const secs = (v: number) => dur(v * 1000)
  const count = (v: number) => num(v)

  if (!h)
    return (
      <section className={card} aria-labelledby="admin-health">
        <h2 id="admin-health" className={h2}>
          Health
        </h2>
        {err ? <p className="m-0 font-mono text-[12px] text-error">{err}</p> : <span className={small}>Reading every background part…</span>}
      </section>
    )

  const holdersOn = h.holders.filter((c) => c.available).length
  const holdersTone: Tone = holdersOn === h.holders.length ? 'ok' : holdersOn === 0 ? 'down' : 'warn'

  const m = h.monitors
  const monLagLimit = 5 * 60_000
  const monTone: Tone = m.monitors === 0 ? 'off' : m.lagMs != null && m.lagMs > monLagLimit ? 'down' : m.errors ? 'warn' : m.detail === 'loop' && m.lastTickAt ? 'ok' : m.errors === 0 ? 'ok' : 'warn'

  const d = h.deepcore
  const dcTone: Tone = d.lagMs == null ? 'down' : d.lagMs > d.pollMs * 4 ? 'down' : d.lastError || d.lagMs > d.pollMs * 2 ? 'warn' : 'ok'

  const b = h.bot
  const botTone: Tone = !b.enabled ? 'off' : b.errors && b.lastErrorAt && (!b.lastUpdateAt || b.lastErrorAt > b.lastUpdateAt) ? 'warn' : b.detail === 'stats' ? 'warn' : 'ok'

  const e = h.engine
  const engTone: Tone = !e.ok ? 'down' : !e.ai ? 'down' : e.worker && !e.worker.reachable ? 'warn' : 'ok'

  const em = h.embeddings
  const embTone: Tone = em.configured === false ? 'down' : em.retrieval === 'hybrid' ? 'ok' : 'warn'

  const tones = [holdersTone, monTone, dcTone, botTone, engTone, embTone]
  const worst: Tone = tones.includes('down') ? 'down' : tones.includes('warn') ? 'warn' : 'ok'

  return (
    <section className={card} aria-labelledby="admin-health">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="admin-health" className={`${h2} flex items-center gap-3`}>
          Health <Dot tone={worst} />
        </h2>
        <span className={small}>
          read {ago(h.at)} · history every {h.everySeconds}s, {h.history.length} points since the last restart
        </span>
      </div>
      {err && <p className="m-0 font-mono text-[12px] text-error">Last refresh failed: {err}. Showing the previous read.</p>}

      <ul className="m-0 grid list-none grid-cols-[repeat(auto-fit,minmax(min(100%,300px),1fr))] gap-3 p-0">
        <Item icon={Network} title="Holder Map data" tone={holdersTone} status={`${holdersOn} of ${h.holders.length} chains`} rows={[]} testId="health-holders">
          <ul className="m-0 flex list-none flex-col gap-1 p-0 font-mono text-[12px]">
            {h.holders.map((c) => (
              <li key={c.chain} className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-2 text-ink-2">
                  <Dot tone={c.available ? 'ok' : 'down'} /> {c.name}
                </span>
                <span className={`truncate ${c.available ? 'text-faint' : 'text-error'}`} title={`Source: ${c.source ?? 'none'}${c.env ? ` (${c.env})` : ''}. DeepCore launches: ${c.launches ? 'mapped' : 'not on this chain'}.`}>
                  {c.available ? 'stocks available' : (c.reason ?? 'unavailable')}
                  {c.launches ? ' · launches' : ''}
                </span>
              </li>
            ))}
          </ul>
          <span className="font-mono text-[11px] text-faint">"launches": DeepCore launches map there without a key. Stock tokens need the source above.</span>
          <Spark history={h.history} field="holdersAvailable" tone={holdersTone} fmt={(v) => `${v} chains available`} label="Holder Map chains with data, per minute" />
        </Item>

        <Item
          icon={Radar}
          title="Security monitors"
          tone={monTone}
          status={m.monitors === 0 ? 'none set up' : TONE[monTone].word}
          rows={[
            ['monitors', `${num(m.live)} live of ${num(m.monitors)}`],
            ['last tick', m.detail === 'loop' ? ago(m.lastTickAt) : 'not reported by this build'],
            ['lag', dur(m.lagMs)],
            ['tick took', m.lastTickMs == null ? '—' : `${m.lastTickMs} ms`],
            ['errors', `${num(m.errors)}${m.lastError ? ` · ${m.lastError}` : ''}`],
            ['RPC load', m.requestsPerMin == null ? '—' : `${m.requestsPerMin}/min`],
          ]}
          testId="health-monitors"
        >
          <Spark history={h.history} field="monitorsLagS" tone={monTone} fmt={secs} label="Security monitor loop lag, per minute" />
        </Item>

        <Item
          icon={Satellite}
          title="DeepCore poller"
          tone={dcTone}
          status={TONE[dcTone].word}
          rows={[
            ['last good read', ago(d.lastOkAt)],
            ['polls every', dur(d.pollMs)],
            ['launches cached', num(d.cached)],
            ['launches seen', num(d.seen)],
            ['last error', d.lastError ?? 'none'],
            ['ledger feeds', !h.stats?.at ? 'not checked yet' : h.stats.issues.length ? `${h.stats.issues.length} problem${h.stats.issues.length === 1 ? '' : 's'}: ${h.stats.issues.map((i) => `${i.venue} ${i.kind}`).join(', ')}` : `all venues fine · checked ${ago(h.stats.at)}`],
          ]}
          testId="health-deepcore"
        >
          <Spark history={h.history} field="deepcoreLagS" tone={dcTone} fmt={secs} label="Time since DeepCore's last good read, per minute" />
        </Item>

        <Item
          icon={Bot}
          title="Telegram bot webhook"
          tone={botTone}
          status={b.enabled ? TONE[botTone].word : 'off (no token)'}
          rows={[
            ['last update', b.detail === 'webhook' ? ago(b.lastUpdateAt) : 'not reported by this build'],
            ['updates', num(b.updates)],
            ['errors', `${num(b.errors)}${b.lastError ? ` · ${b.lastError}` : ''}`],
            ['linked chats', num(b.links)],
          ]}
          testId="health-bot"
        >
          <Spark history={h.history} field="botUpdatesPerMin" tone={botTone} fmt={(v) => `${v} updates/min`} label="Telegram updates received per minute" />
        </Item>

        <Item
          icon={ScanSearch}
          title="Scan engine"
          tone={engTone}
          status={e.ok ? TONE[engTone].word : 'unreadable'}
          rows={
            e.ok
              ? [
                  ['AI pass', e.ai ? 'configured' : 'not configured'],
                  ['static-tools worker', e.worker?.reachable ? `reachable · ${e.worker.tools.join(', ') || 'no tools'}` : (e.worker?.reason ?? 'not reachable')],
                  ['explorer key', e.explorerKey ? 'set' : 'not configured'],
                  ['queue', `${num(e.queue?.running)} running · ${num(e.queue?.queued)} queued`],
                ]
              : [['error', e.error ?? 'unreadable']]
          }
          testId="health-engine"
        >
          <Spark history={h.history} field="scanQueued" tone={engTone} fmt={(v) => `${v} queued`} label="Scans waiting in the queue, per minute" />
        </Item>

        <Item
          icon={BrainCircuit}
          title="Gully AI retrieval"
          tone={embTone}
          status={em.retrieval ?? 'unreadable'}
          rows={[
            ['answers', em.configured == null ? '—' : em.configured ? 'configured' : 'not configured'],
            ['index', `${num(em.indexSize)} chunks`],
            [
              'embeddings',
              em.embeddings
                ? em.embeddings.configured
                  ? `${num(em.embeddings.ready)} of ${num(em.embeddings.total)} ready${em.embeddings.syncing ? ' · syncing' : ''}`
                  : `not configured: ${em.embeddings.needs ?? 'VOYAGE_API_KEY'}`
                : '—',
            ],
            ['last error', em.embeddings?.lastError ?? 'none'],
          ]}
          testId="health-embeddings"
        >
          <Spark history={h.history} field="embedReady" tone={embTone} fmt={count} label="Embedded index chunks ready, per minute" />
        </Item>
      </ul>
    </section>
  )
}
