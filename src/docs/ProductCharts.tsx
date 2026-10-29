// Live, animated charts for the product docs pages (Gully AI, Telegram, Chain Kit, Swaps, Solana).
// Same rules as LiveCharts.tsx: everything is read from our own public API in the browser, nothing is typed
// in, a probe that failed shows as unreachable and an unread value as "not tracked yet", never as 0. Empty
// states still animate. ECharts loads on demand inside EChart.
//
// Origins: /api/tracker, /api/status and /api/alerts/channels answer with Access-Control-Allow-Origin: *, so
// they are read through apiOrigin() like the other docs charts. /api/ask/status does not send CORS headers,
// so it is read from the host the docs are served on (docs.gullylabs.xyz is the same server).

import { useEffect, useMemo, useState } from 'react'
import { AnimatedNumber } from '../components/charts/AnimatedNumber'
import { GhostChart } from '../components/charts/GhostChart'
import { EChart } from '../components/charts/EChart'
import { areaPreset, axisTooltip, barsPreset, C, CHART_H, linePreset, livePoint, PALETTE, sparklinePreset, tipHtml } from '../components/charts/chartPresets'
import { NF } from '../components/charts/number-formats'
import { apiOrigin } from './nav'

/* ------------------------------------------------------------- probes --- */

interface Probe {
  at: number
  ok: boolean
  status: number | null
  ms: number | null
}

async function probeOnce(url: string): Promise<{ probe: Probe; body: unknown }> {
  const t0 = performance.now()
  try {
    const r = await fetch(url, { cache: 'no-store', headers: { accept: 'application/json' } })
    const body = r.ok ? await r.json().catch(() => null) : null
    return { probe: { at: Date.now(), ok: r.ok && body !== null, status: r.status, ms: Math.round(performance.now() - t0) }, body }
  } catch {
    return { probe: { at: Date.now(), ok: false, status: null, ms: null }, body: null }
  }
}

/** Reads `path` every `everyMs` while the tab is visible: the last good body and the last `keep` probes. */
function useJson<T>(path: string, { everyMs = 30_000, keep = 30, sameHost = false }: { everyMs?: number; keep?: number; sameHost?: boolean } = {}) {
  const [probes, setProbes] = useState<Probe[]>([])
  const [data, setData] = useState<T | null>(null)
  useEffect(() => {
    const url = `${sameHost ? '' : apiOrigin()}${path}`
    let alive = true
    let timer: ReturnType<typeof setTimeout> | undefined
    const tick = async () => {
      if (typeof document !== 'undefined' && document.hidden) {
        timer = setTimeout(tick, everyMs)
        return
      }
      const { probe, body } = await probeOnce(url)
      if (!alive) return
      setProbes((l) => [...l, probe].slice(-keep))
      if (probe.ok) setData(body as T)
      timer = setTimeout(tick, everyMs)
    }
    tick()
    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [path, everyMs, keep, sameHost])
  const failed = !data && probes.length > 0 && !probes.some((p) => p.ok)
  return { data, probes, failed }
}

const hhmm = (t: number) => new Date(t).toISOString().slice(11, 16) + ' UTC'
const hhmmss = (t: number) => new Date(t).toISOString().slice(11, 19) + ' UTC'
const usd0 = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`
const compactUsd = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 1 }).format(n)
const signed = (v: number) => `${v > 0 ? '+' : ''}${v.toFixed(2)}%`
const CHAIN_LABEL: Record<string, string> = { robinhood: 'Robinhood Chain', bsc: 'BNB Chain', solana: 'Solana' }
const CHAIN_SHORT: Record<string, string> = { robinhood: 'RH', bsc: 'BNB', solana: 'SOL' }
const CHAIN_COLOR: Record<string, string> = { robinhood: PALETTE[0], bsc: PALETTE[1], solana: PALETTE[3] }

/* --------------------------------------------------------- small parts --- */

function Dot({ tone }: { tone: 'up' | 'warn' | 'down' | 'off' }) {
  const cls = tone === 'up' ? 'bg-green' : tone === 'warn' ? 'bg-gold' : tone === 'down' ? 'bg-error' : 'bg-faint'
  return <span className={`size-[7px] flex-none rounded-full ${cls}`} style={tone === 'up' || tone === 'warn' ? { animation: 'gl-blink 1.6s ease-in-out infinite' } : undefined} />
}

function Panel({ title, aside, children }: { title: string; aside?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-3 rounded-card border border-line bg-card-token px-4 py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-mono text-[11px] tracking-[1px] text-faint">{title}</span>
        {aside && <span className="inline-flex items-center gap-2 font-mono text-[11px] text-ink-2">{aside}</span>}
      </div>
      {children}
    </div>
  )
}

/** The empty state: the kit's GhostChart (a ghosted, animated series), with a plain sentence. */
export function EmptyPulse({ text, h = 120 }: { text: string; h?: number }) {
  return <GhostChart label={text} height={h} />
}

function Stat({ label, children, note }: { label: string; children: React.ReactNode; note?: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="font-mono text-[11px] tracking-[1px] text-faint">{label}</span>
      <span className="font-display text-[26px] leading-none font-bold break-words text-ink">{children}</span>
      {note && <span className="font-mono text-[11px] text-dim">{note}</span>}
    </div>
  )
}

const Unknown = ({ children = 'not tracked yet' }: { children?: React.ReactNode }) => <span className="font-sans text-[15px] font-normal text-muted">{children}</span>

/* ----------------------------------------------------- latency (local) --- */

function LatencyLine({ path, probes }: { path: string; probes: Probe[] }) {
  const last = probes[probes.length - 1]
  const state = !last ? 'checking' : last.ok ? 'up' : 'down'
  const good = useMemo(() => probes.filter((p) => p.ok && p.ms !== null), [probes])
  const data = useMemo(() => good.map((p) => p.ms as number), [good])
  const option = useMemo(() => sparklinePreset({ data, labels: good.map((p) => hhmmss(p.at)), color: state === 'down' ? C.error : C.gold, fmt: (v) => `${v} ms` }), [good, data, state])
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2 font-mono text-[11px] text-dim">
        <span>
          GET {path} · from your browser{' '}
          {last?.ok && last.ms !== null ? (
            <b className="font-medium text-ink">
              <AnimatedNumber value={last.ms} format={NF.int} suffix=" ms" />
            </b>
          ) : state === 'down' ? (
            'unreachable'
          ) : (
            'measuring…'
          )}
        </span>
        <span>
          {good.length} of {probes.length} ok
        </span>
      </div>
      {data.length >= 2 ? (
        <EChart option={option} height={CHART_H.spark} label={`Response time of ${path} from this browser, last ${data.length} checks`} skeleton="line" steps={{ count: data.length }} />
      ) : (
        <EmptyPulse h={CHART_H.spark} text="collecting a series…" />
      )}
    </div>
  )
}

/* ------------------------------------------------------------ Gully AI --- */

interface AskStatus {
  configured: boolean
  model: string | null
  indexSize: number | null
  updatedAt: string | null
  retrieval: 'hybrid' | 'bm25'
}

/** GET /api/ask/status: whether Gully AI answers here, its model, index size and retrieval, plus latency. */
export function AskStatusPanel() {
  const { data, probes, failed } = useJson<AskStatus>('/api/ask/status', { everyMs: 15_000, sameHost: true })
  const chip = data ? (data.configured ? ['up', 'answering on this server'] : ['off', 'not configured on this server']) : failed ? ['down', 'unreadable'] : ['off', 'checking…']
  return (
    <Panel
      title="GULLY AI NOW · LIVE FROM /api/ask/status"
      aside={
        <>
          <Dot tone={chip[0] as 'up' | 'off' | 'down'} /> {chip[1]}
        </>
      }
    >
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,150px),1fr))] gap-4">
        <Stat label="INDEXED PASSAGES" note="docs, site, legal, roadmap, blog">
          {typeof data?.indexSize === 'number' ? <AnimatedNumber value={data.indexSize} format={NF.int} countUp /> : <Unknown>{failed ? 'unreadable' : 'not tracked yet'}</Unknown>}
        </Stat>
        <Stat label="RETRIEVAL" note={data ? (data.retrieval === 'hybrid' ? 'keyword + semantic' : 'keyword + synonyms') : undefined}>
          {data ? data.retrieval === 'hybrid' ? 'Hybrid' : 'BM25' : <Unknown>{failed ? 'unreadable' : 'reading…'}</Unknown>}
        </Stat>
        <Stat label="MODEL">{data?.model ? <span className="font-mono text-[14px] font-normal">{data.model}</span> : <Unknown />}</Stat>
        <Stat label="INDEX UPDATED">{data?.updatedAt ? <span className="font-mono text-[14px] font-normal">{new Date(data.updatedAt).toISOString().slice(0, 16).replace('T', ' ')} UTC</span> : <Unknown />}</Stat>
      </div>
      <LatencyLine path="/api/ask/status" probes={probes} />
    </Panel>
  )
}

/* -------------------------------------------------------------- status --- */

type StatusState = 'up' | 'degraded' | 'down' | 'off' | 'unknown'
type StatusGroup = 'platform' | 'tracker' | 'telegram' | 'payments' | 'ai' | 'security' | 'holders'
interface StatusBucket {
  t: string
  up: number | null
  ms: number | null
}
interface StatusComponent {
  id: string
  group: StatusGroup
  name: string
  state: StatusState
  detail: string
  checkedAt: string | null
  latencyMs: number | null
  uptime24h: number | null
  history: StatusBucket[]
}
interface StatusBody {
  generatedAt: string
  overall: 'operational' | 'degraded' | 'major'
  intervalSeconds: number
  since: string | null
  components: StatusComponent[]
}

const STATE_TONE: Record<StatusState, 'up' | 'warn' | 'down' | 'off'> = { up: 'up', degraded: 'warn', down: 'down', off: 'off', unknown: 'off' }
const STATE_WORD: Record<StatusState, string> = { up: 'up', degraded: 'degraded', down: 'down', off: 'not configured here', unknown: 'unknown' }

function useStatusBody() {
  return useJson<StatusBody>('/api/status', { everyMs: 60_000, keep: 5 })
}

/**
 * The last 24 hours of the status checks for some components, from GET /api/status: one line per component
 * (share of checks up per 30-minute bucket), with each one's state now and its 24 h uptime.
 */
export function StatusHistory({ groups, ids, title }: { groups?: StatusGroup[]; ids?: string[]; title: string }) {
  const { data, failed } = useStatusBody()
  const list = useMemo(() => (data?.components ?? []).filter((c) => (ids ? ids.includes(c.id) : true) && (groups ? groups.includes(c.group) : true)), [data, groups, ids])
  const charted = useMemo(() => list.filter((c) => c.history.some((b) => b.up !== null)), [list])
  const times = useMemo(() => {
    const longest = charted.reduce<StatusBucket[]>((a, c) => (c.history.length > a.length ? c.history : a), [])
    return longest.map((b) => b.t)
  }, [charted])
  const option = useMemo(() => {
    const labels = times.map((t) => hhmm(Date.parse(t)))
    return {
      grid: { left: 8, right: 12, top: 28, bottom: 8, containLabel: true },
      legend: charted.length > 1 ? { top: 0, left: 0, textStyle: { color: C.muted }, data: charted.map((c) => c.name) } : undefined,
      xAxis: { type: 'category', boundaryGap: false, data: labels, axisLabel: { color: C.dim, hideOverlap: true } },
      yAxis: { type: 'value', min: 0, max: 100, axisLabel: { formatter: (v: number) => `${v}%` }, splitLine: { lineStyle: { color: C.grid } } },
      tooltip: axisTooltip((ps: { dataIndex: number }[]) => {
        const i = ps[0]?.dataIndex ?? -1
        return tipHtml({
          title: `30 min from ${labels[i] ?? ''}`,
          rows: charted.map((c, j) => {
            const b = c.history.find((x) => x.t === times[i])
            return { name: c.name, value: b && b.up !== null ? `${Math.round(b.up * 1000) / 10}% up${b.ms !== null ? ` · ${b.ms} ms` : ''}` : 'no checks counted', color: PALETTE[j % PALETTE.length] }
          }),
        })
      }),
      series: charted.flatMap((c, j) => {
        const color = PALETTE[j % PALETTE.length]
        const data = times.map((t) => {
          const b = c.history.find((x) => x.t === t)
          return b && b.up !== null ? Math.round(b.up * 1000) / 10 : null
        })
        const lastI = data.reduce<number>((a, v, i) => (v !== null ? i : a), -1)
        const base = charted.length === 1 ? areaPreset({ color, fill: 0.2 }) : linePreset({ color })
        return [{ id: c.id, name: c.name, ...base, connectNulls: false, data }, livePoint(lastI >= 0 ? [labels[lastI], data[lastI] as number] : null, color, `${c.id}-live`)]
      }),
    }
  }, [charted, times])
  return (
    <Panel title={`${title} · LIVE FROM /api/status`} aside={data ? `checked ${data.components[0]?.checkedAt ? hhmmss(Date.parse(data.components[0].checkedAt)) : 'not yet'}` : failed ? 'unreadable' : 'reading…'}>
      {list.length > 0 && (
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {list.map((c) => (
            <li key={c.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-[13px] text-ink-2">
              <span className="inline-flex items-center gap-2 font-mono text-[12px] text-ink">
                <Dot tone={STATE_TONE[c.state]} /> {c.name}
              </span>
              <span className="font-mono text-[11px] text-dim">
                {STATE_WORD[c.state]} · 24 h uptime {c.uptime24h !== null ? `${Math.round(c.uptime24h * 10000) / 100}%` : 'not tracked yet'}
              </span>
              <span className="w-full text-[13px] leading-[1.5] text-muted">{c.detail}</span>
            </li>
          ))}
        </ul>
      )}
      {charted.length > 0 && times.length >= 2 ? (
        <EChart option={option} height={CHART_H.md} label={`Share of status checks that were up per 30 minutes over the last 24 hours: ${charted.map((c) => c.name).join(', ')}`} skeleton="line" steps={{ count: times.length }} />
      ) : (
        <EmptyPulse text={failed ? 'GET /api/status could not be read just now.' : data ? (list.length ? 'Not enough checks counted yet for a 24 h line (a component that is off or unknown is left out of uptime).' : 'This check is not reported by the server yet.') : 'Reading the status checks…'} />
      )}
    </Panel>
  )
}

/** One status component as a live chip (state, detail, 24 h uptime). */
export function StatusChip({ id, label }: { id: string; label: string }) {
  const { data, failed } = useStatusBody()
  const c = data?.components.find((x) => x.id === id) ?? null
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 rounded-card border border-line bg-card-token px-4 py-3 font-mono text-[12px] text-ink-2">
      <span className="text-[11px] tracking-[1px] text-faint">{label}</span>
      {c ? (
        <>
          <span className="inline-flex items-center gap-2 text-ink">
            <Dot tone={STATE_TONE[c.state]} /> {c.name}: {STATE_WORD[c.state]}
          </span>
          <span className="text-dim">24 h uptime {c.uptime24h !== null ? `${Math.round(c.uptime24h * 10000) / 100}%` : 'not tracked yet'}</span>
          <span className="w-full font-sans text-[13px] text-muted">{c.detail}</span>
        </>
      ) : (
        <span className="inline-flex items-center gap-2 text-muted">
          <Dot tone={failed ? 'down' : 'off'} /> {failed ? 'GET /api/status could not be read just now' : data ? 'not reported yet' : 'checking…'}
        </span>
      )}
    </div>
  )
}

/* ------------------------------------------------------ alert channels --- */

interface Channels {
  webhook?: { enabled: boolean }
  telegram?: { enabled: boolean; bot: string | null; reason?: string }
}

/** GET /api/alerts/channels: which alert delivery channels this server offers right now. */
export function AlertChannelsPanel() {
  const { data, failed } = useJson<Channels>('/api/alerts/channels', { everyMs: 60_000, keep: 5 })
  const tg = data?.telegram
  return (
    <Panel title="ALERT DELIVERY · LIVE FROM /api/alerts/channels" aside={data ? 'read now' : failed ? 'unreadable' : 'reading…'}>
      <div className="flex flex-wrap gap-2 font-mono text-[12px]">
        <span className="inline-flex min-h-9 items-center gap-2 rounded-full border border-line px-3 text-ink-2">
          <Dot tone={tg ? (tg.enabled ? 'up' : 'off') : failed ? 'down' : 'off'} />
          Telegram {tg ? (tg.enabled ? `on${tg.bot ? ` · @${tg.bot}` : ''}` : 'off on this server') : failed ? 'unreadable' : '…'}
        </span>
        <span className="inline-flex min-h-9 items-center gap-2 rounded-full border border-line px-3 text-ink-2">
          <Dot tone={data?.webhook ? (data.webhook.enabled ? 'up' : 'off') : failed ? 'down' : 'off'} />
          Webhooks {data?.webhook ? (data.webhook.enabled ? 'on' : 'off') : failed ? 'unreadable' : '…'}
        </span>
      </div>
      {tg && !tg.enabled && tg.reason && <p className="m-0 text-[13px] text-muted">{tg.reason}</p>}
    </Panel>
  )
}

/* -------------------------------------------------------------- tracker --- */

interface Row {
  chain: string
  ticker: string
  symbol?: string
  status: string
  gapPct: number | null
  fair: number | null
  onchain: number | null
  fairSource?: string
  sessionOpen?: boolean
  pool: { dex: string; against: string; liquidityUsd: number; volume24hUsd: number; pools: number; totalLiquidityUsd: number } | null
}
interface TrackerDoc {
  generatedAt: string
  rows: Row[]
}

function useTrackerDoc() {
  return useJson<TrackerDoc>('/api/tracker', { everyMs: 60_000, keep: 5 })
}

/**
 * Pool depth of the tracked tokens right now, from GET /api/tracker: the liquidity of each token's deepest
 * pool (the one the onchain price is read from), deepest first. A row without a readable pool is counted,
 * never drawn as zero.
 */
export function PoolDepth({ chain, top = 12 }: { chain?: string; top?: number }) {
  const { data, failed } = useTrackerDoc()
  const rows = useMemo(() => (data?.rows ?? []).filter((r) => !chain || r.chain === chain), [data, chain])
  const deep = useMemo(
    () =>
      rows
        .filter((r) => r.pool && typeof r.pool.liquidityUsd === 'number' && r.pool.liquidityUsd > 0)
        .sort((a, b) => (b.pool as NonNullable<Row['pool']>).liquidityUsd - (a.pool as NonNullable<Row['pool']>).liquidityUsd)
        .slice(0, top)
        .reverse(),
    [rows, top],
  )
  const unread = rows.length - rows.filter((r) => r.pool && r.pool.liquidityUsd > 0).length
  const total = useMemo(() => rows.reduce((a, r) => a + (r.pool && r.pool.liquidityUsd > 0 ? r.pool.liquidityUsd : 0), 0), [rows])
  const option = useMemo(
    () => ({
      grid: { left: 8, right: 64, top: 8, bottom: 8, containLabel: true },
      xAxis: { type: 'value', axisLabel: { formatter: (v: number) => compactUsd(v) }, splitLine: { lineStyle: { color: C.grid } } },
      yAxis: { type: 'category', data: deep.map((r) => `${r.symbol ?? r.ticker} · ${CHAIN_SHORT[r.chain] ?? r.chain}`), axisTick: { show: false } },
      tooltip: axisTooltip((ps: { dataIndex: number }[]) => {
        const r = deep[ps[0]?.dataIndex ?? -1]
        const p = r?.pool
        return r && p
          ? tipHtml({
              title: `${r.ticker} on ${CHAIN_LABEL[r.chain] ?? r.chain}`,
              rows: [
                { name: 'deepest pool', value: usd0(p.liquidityUsd), color: CHAIN_COLOR[r.chain] ?? C.gold },
                { name: 'all pools', value: typeof p.totalLiquidityUsd === 'number' ? `${usd0(p.totalLiquidityUsd)} in ${p.pools}` : 'not tracked yet' },
                { name: 'volume 24h', value: typeof p.volume24hUsd === 'number' ? usd0(p.volume24hUsd) : 'not tracked yet' },
                { name: 'venue', value: `${p.dex} · against ${p.against}` },
              ],
            })
          : ''
      }, 'shadow'),
      series: [
        {
          id: 'depth',
          ...barsPreset({ horizontal: true }),
          data: deep.map((r) => ({ value: Math.round((r.pool as NonNullable<Row['pool']>).liquidityUsd), itemStyle: { color: CHAIN_COLOR[r.chain] ?? C.gold } })),
          label: { show: true, position: 'right', color: C.ink2, fontFamily: 'IBM Plex Mono', fontSize: 11, formatter: (p: { value: number }) => compactUsd(p.value) },
        },
      ],
    }),
    [deep],
  )
  return (
    <Panel title={`POOL DEPTH${chain ? ` · ${(CHAIN_LABEL[chain] ?? chain).toUpperCase()}` : ''} · LIVE FROM /api/tracker`} aside={data ? `built ${hhmmss(Date.parse(data.generatedAt))}` : failed ? 'unreadable' : 'reading…'}>
      <div className="flex flex-wrap gap-6 font-mono text-[12px] text-muted">
        <span>
          deepest pools, summed <b className="font-display text-[22px] text-ink">{data ? <AnimatedNumber value={total} format={NF.compactUsd} countUp /> : '—'}</b>
        </span>
        <span>
          tokens <b className="font-display text-[22px] text-ink">{data ? <AnimatedNumber value={rows.length} format={NF.int} countUp /> : '—'}</b>
        </span>
        {data && unread > 0 && <span className="self-end">{unread} without a readable pool (not counted, not shown as zero)</span>}
      </div>
      {data && !deep.length ? (
        <EmptyPulse text="No pool depth could be read for these tokens right now." />
      ) : (
        <EChart option={option} height={Math.max(CHART_H.md, deep.length * 26 + 30)} label="Liquidity of each tracked token's deepest pool right now, deepest first" skeleton="bars" error={failed ? 'The tracker could not be read just now.' : undefined} steps={{ count: deep.length }} />
      )}
      {!chain && (
        <ul className="m-0 flex list-none flex-wrap gap-4 p-0 font-mono text-[11px] text-dim" aria-label="Chain colours">
          {Object.entries(CHAIN_LABEL).map(([k, n]) => (
            <li key={k} className="inline-flex items-center gap-2">
              <span className="size-2 rounded-full" style={{ background: CHAIN_COLOR[k] }} /> {n}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  )
}

const FAIR_CHAIN: Record<string, string> = { '56': 'BNB Chain', '4663': 'Robinhood Chain', '1': 'Ethereum' }
/** "chainlink:56" -> "Chainlink feed on BNB Chain"; "backed" -> "issuer quote (xStocks API)". */
function fairSourceLabel(s: string | undefined): string {
  if (!s) return 'not tracked yet'
  if (s === 'backed') return 'issuer quote (xStocks API)'
  const m = /^chainlink:(\d+)$/.exec(s)
  if (m) return `Chainlink feed on ${FAIR_CHAIN[m[1]] ?? `chain ${m[1]}`}`
  return s
}

/** The Solana rows of GET /api/tracker: each xStock's gap to fair now, coloured by who priced fair. */
export function SolanaGaps() {
  const { data, failed } = useTrackerDoc()
  const sol = useMemo(() => (data?.rows ?? []).filter((r) => r.chain === 'solana'), [data])
  const withGap = useMemo(() => sol.filter((r) => typeof r.gapPct === 'number').sort((a, b) => (a.gapPct as number) - (b.gapPct as number)), [sol])
  const without = sol.filter((r) => typeof r.gapPct !== 'number')
  const sources = useMemo(() => {
    const m = new Map<string, number>()
    for (const r of sol) {
      const k = fairSourceLabel(r.fairSource)
      m.set(k, (m.get(k) ?? 0) + 1)
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1])
  }, [sol])
  const srcColor = (s: string | undefined) => (s === 'backed' ? PALETTE[3] : C.gold)
  const option = useMemo(
    () => ({
      grid: { left: 8, right: 56, top: 8, bottom: 8, containLabel: true },
      xAxis: { type: 'value', axisLabel: { formatter: (v: number) => `${v}%` }, splitLine: { lineStyle: { color: C.grid } } },
      yAxis: { type: 'category', data: withGap.map((r) => r.symbol ?? r.ticker), axisTick: { show: false } },
      tooltip: axisTooltip((ps: { dataIndex: number }[]) => {
        const r = withGap[ps[0]?.dataIndex ?? -1]
        return r
          ? tipHtml({
              title: `${r.symbol ?? r.ticker} on Solana`,
              rows: [
                { name: 'gap to fair', value: signed(r.gapPct as number), valueColor: (r.gapPct as number) >= 0 ? C.gold : PALETTE[1] },
                { name: 'status', value: r.status },
                { name: 'fair priced by', value: fairSourceLabel(r.fairSource), color: srcColor(r.fairSource) },
                { name: 'feed session', value: r.sessionOpen === undefined ? 'not tracked yet' : r.sessionOpen ? 'open' : 'closed (last session)' },
              ],
            })
          : ''
      }, 'shadow'),
      series: [
        {
          id: 'sol-gaps',
          ...barsPreset({ horizontal: true }),
          data: withGap.map((r) => ({ value: Math.round((r.gapPct as number) * 100) / 100, itemStyle: { color: srcColor(r.fairSource) } })),
          label: { show: true, position: 'right', color: C.ink2, fontFamily: 'IBM Plex Mono', fontSize: 11, formatter: (p: { value: number }) => signed(p.value) },
        },
      ],
    }),
    [withGap],
  )
  return (
    <Panel title="SOLANA XSTOCKS · GAP TO FAIR · LIVE FROM /api/tracker" aside={data ? `built ${hhmmss(Date.parse(data.generatedAt))}` : failed ? 'unreadable' : 'reading…'}>
      <div className="flex flex-wrap gap-6 font-mono text-[12px] text-muted">
        <span>
          tracked <b className="font-display text-[22px] text-ink">{data ? <AnimatedNumber value={sol.length} format={NF.int} countUp /> : '—'}</b>
        </span>
        <span>
          with a gap now <b className="font-display text-[22px] text-ink">{data ? <AnimatedNumber value={withGap.length} format={NF.int} countUp /> : '—'}</b>
        </span>
      </div>
      {data && !withGap.length ? (
        <EmptyPulse text={sol.length ? 'No Solana row has a readable gap right now; each one says why below.' : 'The tracker answered without Solana rows just now.'} />
      ) : (
        <EChart option={option} height={Math.max(CHART_H.md, withGap.length * 24 + 30)} label="Gap between each Solana xStock's onchain price and its fair price right now" skeleton="bars" error={failed ? 'The tracker could not be read just now.' : undefined} steps={{ count: withGap.length }} />
      )}
      {sources.length > 0 && (
        <ul className="m-0 flex list-none flex-wrap gap-x-4 gap-y-1 p-0 font-mono text-[11px] text-dim" aria-label="Who priced fair">
          <li className="w-full tracking-[1px] text-faint">FAIR PRICE SOURCE</li>
          {sources.map(([s, n]) => (
            <li key={s} className="inline-flex items-center gap-2">
              <span className="size-2 rounded-full" style={{ background: s.startsWith('issuer') ? PALETTE[3] : C.gold }} /> {s} <b className="font-medium text-ink">{n}</b>
            </li>
          ))}
        </ul>
      )}
      {without.length > 0 && (
        <p className="m-0 font-mono text-[11px] leading-[1.6] text-dim">
          No gap shown (never as zero): {without.map((r) => `${r.symbol ?? r.ticker} (${r.status})`).join(', ')}
        </p>
      )}
    </Panel>
  )
}
