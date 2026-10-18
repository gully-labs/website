// Live, animated charts for the docs pages (owner rule: every surface shows live data). Everything here
// is read from the public API in the browser, through apiOrigin(), and nothing is typed in: a probe that
// failed shows as unreachable, an unread value as "not tracked yet", never as 0. ECharts itself loads
// on demand inside EChart, so a docs page paints before any chart code arrives.

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { PlanLimits } from '../components/charts/PlanLimits'
import { ChartBox } from '../components/charts/ChartSkeleton'
import { AnimatedNumber } from '../components/charts/AnimatedNumber'
import { GhostChart } from '../components/charts/GhostChart'
import { EChart } from '../components/charts/EChart'
import { areaPreset, axisTooltip, barsPreset, C, CHART_H, itemTooltip, livePoint, PALETTE, sparklinePreset, tipHtml } from '../components/charts/chartPresets'
import { NF } from '../components/charts/number-formats'
import { ChainLogo } from '../components/logos/ChainLogo'
import { TokenLogo } from '../components/logos/TokenLogo'
import { apiOrigin } from './nav'

/* ------------------------------------------------------------- probes --- */

export interface Probe {
  at: number
  ok: boolean
  status: number | null
  ms: number | null
}

/** Times one GET from this browser. `no-store` so the figure is a real round trip, not the HTTP cache. */
/**
 * GET from the API host. Some public endpoints send no CORS header (/api/pay/gas, /api/stats), so a read from
 * docs.gullylabs.xyz to gullylabs.xyz fails in the browser; the same server answers on the docs host too, so a
 * failed cross-origin read is retried same-origin.
 */
async function apiFetch(path: string, init: RequestInit): Promise<Response> {
  const origin = apiOrigin()
  try {
    return await fetch(`${origin}${path}`, init)
  } catch (e) {
    if (!origin) throw e
    return fetch(path, init)
  }
}

async function probeOnce(path: string): Promise<{ probe: Probe; body: unknown }> {
  const t0 = performance.now()
  try {
    const r = await apiFetch(path, { cache: 'no-store', headers: { accept: 'application/json' } })
    const body = r.ok ? await r.json().catch(() => null) : null
    return { probe: { at: Date.now(), ok: r.ok && body !== null, status: r.status, ms: Math.round(performance.now() - t0) }, body }
  } catch {
    return { probe: { at: Date.now(), ok: false, status: null, ms: null }, body: null }
  }
}

/**
 * Probes `path` every `everyMs` while the tab is visible, keeping the last `keep` results, and hands
 * each good body to `onBody`.
 */
function useProbe(path: string, everyMs = 10_000, keep = 30, onBody?: (b: unknown) => void) {
  const [list, setList] = useState<Probe[]>([])
  const cb = useRef(onBody)
  useEffect(() => {
    cb.current = onBody
  })
  useEffect(() => {
    let alive = true
    let timer: ReturnType<typeof setTimeout> | undefined
    const tick = async () => {
      if (typeof document !== 'undefined' && document.hidden) {
        timer = setTimeout(tick, everyMs)
        return
      }
      const { probe, body } = await probeOnce(path)
      if (!alive) return
      setList((l) => [...l, probe].slice(-keep))
      if (probe.ok) cb.current?.(body)
      timer = setTimeout(tick, everyMs)
    }
    tick()
    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [path, everyMs, keep])
  return list
}

const hhmmss = (t: number) => new Date(t).toISOString().slice(11, 19) + ' UTC'

/* ---------------------------------------------------- latency sparkline --- */

function LatencyTile({ path, label, probes }: { path: string; label: string; probes: Probe[] }) {
  const last = probes[probes.length - 1]
  const state = !last ? 'checking' : last.ok ? 'up' : 'down'
  const good = useMemo(() => probes.filter((p) => p.ms !== null && p.ok), [probes])
  const data = useMemo(() => good.map((p) => p.ms as number), [good])
  const option = useMemo(() => sparklinePreset({ data, labels: good.map((p) => hhmmss(p.at)), color: state === 'down' ? C.error : C.gold, fmt: (v) => `${v} ms` }), [good, data, state])
  const median = data.length ? [...data].sort((a, b) => a - b)[Math.floor(data.length / 2)] : null
  return (
    <div className="flex min-w-0 flex-col gap-3 rounded-lg border border-line bg-surface px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <span className="font-mono text-[12px] text-ink">GET {path}</span>
        <span className="inline-flex items-center gap-2 font-mono text-[11px] text-ink-2">
          <span className={`size-[7px] rounded-full ${state === 'up' ? 'bg-green' : state === 'down' ? 'bg-error' : 'bg-faint'}`} style={state === 'up' ? { animation: 'gl-blink 1.6s ease-in-out infinite' } : undefined} />
          {state === 'up' ? `${last.status} OK` : state === 'down' ? (last.status ? `${last.status}` : 'unreachable') : 'checking'}
        </span>
      </div>
      <div className="flex items-end justify-between gap-4">
        <div className="flex flex-col">
          <span className="font-mono text-[11px] tracking-[1px] text-faint">{label}</span>
          <span className="font-display text-[30px] leading-none font-bold text-ink">
            {last?.ok && last.ms !== null ? <AnimatedNumber value={last.ms} format={NF.int} suffix=" ms" /> : <span className="text-[16px] font-normal text-muted">{state === 'checking' ? 'measuring…' : 'not tracked yet'}</span>}
          </span>
        </div>
        <span className="font-mono text-[11px] text-dim">median {median !== null ? `${median} ms` : 'not tracked yet'} · {good.length} of {probes.length} ok</span>
      </div>
      {data.length >= 2 ? (
        <EChart option={option} height={CHART_H.spark} label={`Response time of ${path} from this browser, last ${data.length} checks`} skeleton="line" steps={{ count: data.length }} />
      ) : (
        <div className="relative h-[44px] overflow-hidden rounded-sm bg-surface-deep">
          <span className="absolute inset-0 bg-[linear-gradient(90deg,transparent,rgba(217,181,99,.12),transparent)]" style={{ animation: 'gl-scan 1.6s linear infinite' }} />
          <span className="absolute inset-0 grid place-items-center font-mono text-[11px] text-faint">collecting a series…</span>
        </div>
      )}
    </div>
  )
}

/** One endpoint's response time, measured from this browser every `everyMs`. */
export function LatencySpark({ path, everyMs = 10_000, label = 'RESPONSE TIME, FROM YOUR BROWSER' }: { path: string; everyMs?: number; label?: string }) {
  const probes = useProbe(path, everyMs)
  return <LatencyTile path={path} label={label} probes={probes} />
}

/* ----------------------------------------------------- widest gaps bars --- */

interface Row {
  chain: string
  ticker: string
  status: string
  gapPct: number | null
  trusted?: boolean
}

/** The docs home strip: API status and latency for two endpoints, then the widest trusted gaps now. */
export function ApiStatusStrip() {
  const [rows, setRows] = useState<Row[] | null>(null)
  const [at, setAt] = useState<string | null>(null)
  const tracker = useProbe('/api/tracker', 15_000, 30, (b) => {
    const d = b as { rows?: Row[]; generatedAt?: string }
    if (Array.isArray(d?.rows)) {
      setRows(d.rows)
      setAt(d.generatedAt ?? null)
    }
  })
  const plans = useProbe('/api/plans', 15_000)
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,300px),1fr))] gap-3">
        <LatencyTile path="/api/tracker" label="RESPONSE TIME" probes={tracker} />
        <LatencyTile path="/api/plans" label="RESPONSE TIME" probes={plans} />
      </div>
      <WidestGaps rows={rows} at={at} failed={!rows && tracker.length > 0 && !tracker.some((p) => p.ok)} />
    </div>
  )
}

const signed = (v: number) => `${v > 0 ? '+' : ''}${v.toFixed(2)}%`

/** The widest trusted gaps right now, with its own read of /api/tracker (the widget table ranks the same way). */
export function WidestGapsLive() {
  const [rows, setRows] = useState<Row[] | null>(null)
  const [at, setAt] = useState<string | null>(null)
  const probes = useProbe('/api/tracker', 60_000, 5, (b) => {
    const d = b as { rows?: Row[]; generatedAt?: string }
    if (Array.isArray(d?.rows)) {
      setRows(d.rows)
      setAt(d.generatedAt ?? null)
    }
  })
  return <WidestGaps rows={rows} at={at} failed={!rows && probes.length > 0 && !probes.some((p) => p.ok)} />
}

function WidestGaps({ rows, at, failed }: { rows: Row[] | null; at: string | null; failed: boolean }) {
  const top = useMemo(
    () =>
      (rows ?? [])
        .filter((r) => (r.trusted ?? ['premium', 'discount', 'drifting', 'in-line'].includes(r.status)) && typeof r.gapPct === 'number')
        .sort((a, b) => Math.abs(b.gapPct as number) - Math.abs(a.gapPct as number))
        .slice(0, 8)
        .reverse(),
    [rows],
  )
  const option = useMemo(
    () => ({
      grid: { left: 8, right: 56, top: 8, bottom: 8, containLabel: true },
      xAxis: { type: 'value', axisLabel: { formatter: (v: number) => `${v}%` }, splitLine: { lineStyle: { color: C.grid } } },
      yAxis: { type: 'category', data: top.map((r) => `${r.ticker} · ${r.chain === 'bsc' ? 'BNB' : 'RH'}`), axisTick: { show: false } },
      tooltip: axisTooltip((ps: { dataIndex: number }[]) => {
        const r = top[ps[0]?.dataIndex ?? -1]
        return r ? tipHtml({ title: `${r.ticker} on ${r.chain === 'bsc' ? 'BNB Chain' : 'Robinhood Chain'}`, rows: [{ name: 'gap to fair', value: signed(r.gapPct as number), valueColor: (r.gapPct as number) >= 0 ? C.gold : '#5aa9e6' }, { name: 'status', value: r.status }] }) : ''
      }, 'shadow'),
      series: [
        {
          id: 'gaps',
          ...barsPreset({ horizontal: true }),
          data: top.map((r) => ({ value: Math.round((r.gapPct as number) * 100) / 100, itemStyle: { color: (r.gapPct as number) >= 0 ? C.gold : '#5aa9e6' } })),
          label: { show: true, position: 'right', color: C.ink2, fontFamily: 'IBM Plex Mono', fontSize: 11, formatter: (p: { value: number }) => signed(p.value) },
        },
      ],
    }),
    [top],
  )
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-line bg-surface px-4 py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-mono text-[11px] tracking-[1px] text-faint">WIDEST TRUSTED GAPS NOW · LIVE FROM /api/tracker</span>
        <span className="font-mono text-[11px] text-dim">{at ? `built ${hhmmss(Date.parse(at))}` : rows ? 'time not tracked yet' : ''}</span>
      </div>
      {rows && !top.length ? (
        <p className="m-0 py-6 font-mono text-[12px] text-muted">No trusted gap right now: every row is thin, unverified or unreadable. Nothing is shown as zero.</p>
      ) : (
        <EChart option={option} height={CHART_H.lg} label="The widest trusted gaps between onchain and fair price right now, by token" skeleton="bars" error={failed ? 'The tracker could not be read just now.' : undefined} steps={{ count: top.length }} />
      )}
    </div>
  )
}

/* ------------------------------------------------- Gully Pay coverage --- */

interface PayAsset {
  id: string
  chainId: number
  chain: string
  symbol: string
  kind: 'token' | 'native'
  confirmations: number
}
interface Offer {
  chains?: { id: number; name: string; confirmations: number; feeProxy?: boolean; feeSplit?: boolean }[]
  assets?: PayAsset[]
  checkout?: { enabled: boolean }
}

/** Which assets Gully Pay accepts on which chain, and the confirmations each chain needs, from GET /api/plans. */
export function PayCoverage() {
  const [offer, setOffer] = useState<Offer | null>(null)
  const probes = useProbe('/api/plans', 60_000, 10, (b) => setOffer(b as Offer))
  const failed = !offer && probes.length > 0 && !probes.some((p) => p.ok)
  const chains = useMemo(() => offer?.chains ?? [], [offer])
  const assets = useMemo(() => offer?.assets ?? [], [offer])
  const option = useMemo(() => {
    const names = chains.map((c) => c.name)
    const of = (cid: number, kind: 'native' | 'token') => assets.filter((a) => a.chainId === cid && a.kind === kind)
    const tip = (i: number) => {
      const c = chains[i]
      if (!c) return ''
      const list = assets.filter((a) => a.chainId === c.id)
      return tipHtml({ title: c.name, rows: [...list.map((a, j) => ({ name: a.symbol, value: a.kind === 'native' ? 'native coin' : 'token', color: PALETTE[j % PALETTE.length] })), { name: 'confirmations', value: String(c.confirmations) }, { name: 'merchant fee', value: c.feeSplit ? 'in the payment (fee proxy)' : c.feeProxy ? 'invoiced (proxy verified, treasury not deployed yet)' : 'invoiced' }] })
    }
    return {
      grid: { left: 8, right: 40, top: 28, bottom: 8, containLabel: true },
      legend: { top: 0, left: 0, textStyle: { color: C.muted }, data: ['Native coin', 'Stablecoins', 'Confirmations'] },
      xAxis: [
        { type: 'value', minInterval: 1, name: '', splitLine: { lineStyle: { color: C.grid } } },
      ],
      yAxis: { type: 'category', data: names, axisTick: { show: false } },
      tooltip: axisTooltip((ps: { dataIndex: number }[]) => tip(ps[0]?.dataIndex ?? -1), 'shadow'),
      series: [
        { id: 'native', name: 'Native coin', stack: 'assets', ...barsPreset({ horizontal: true, radius: 0, focus: 'series' }), color: C.gold, data: chains.map((c) => of(c.id, 'native').length) },
        { id: 'token', name: 'Stablecoins', stack: 'assets', ...barsPreset({ horizontal: true, focus: 'series' }), color: '#26ab94', data: chains.map((c) => of(c.id, 'token').length) },
        {
          id: 'conf',
          name: 'Confirmations',
          type: 'scatter',
          symbolSize: 0,
          data: chains.map((c) => [of(c.id, 'native').length + of(c.id, 'token').length, c.name]),
          label: { show: true, position: 'right', color: C.dim, fontFamily: 'IBM Plex Mono', fontSize: 11, formatter: (p: { dataIndex: number }) => `${chains[p.dataIndex]?.confirmations ?? '?'} conf.` },
          tooltip: { show: false },
          animationDelay: 700,
        },
      ],
    }
  }, [chains, assets])
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-line bg-surface px-4 py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-mono text-[11px] tracking-[1px] text-faint">ACCEPTED NOW · LIVE FROM /api/plans</span>
        <span className="inline-flex items-center gap-2 font-mono text-[11px] text-ink-2">
          {offer?.checkout ? (
            <>
              <span className={`size-[7px] rounded-full ${offer.checkout.enabled ? 'bg-green' : 'bg-faint'}`} style={offer.checkout.enabled ? { animation: 'gl-blink 1.6s ease-in-out infinite' } : undefined} />
              {offer.checkout.enabled ? 'checkout open' : 'checkout not open yet'}
            </>
          ) : failed ? (
            'unreadable'
          ) : (
            'checking…'
          )}
        </span>
      </div>
      <div className="flex flex-wrap gap-6 font-mono text-[12px] text-muted">
        <span>
          chains <b className="font-display text-[22px] text-ink">{offer ? <AnimatedNumber value={chains.length} format={NF.int} countUp /> : '—'}</b>
        </span>
        <span>
          assets <b className="font-display text-[22px] text-ink">{offer ? <AnimatedNumber value={assets.length} format={NF.int} countUp /> : '—'}</b>
        </span>
      </div>
      {offer && !chains.length ? (
        <p className="m-0 py-6 font-mono text-[12px] text-muted">The server lists no payment chains: not tracked yet.</p>
      ) : (
        <EChart option={option} height={Math.max(180, chains.length * 46 + 40)} label="Assets Gully Pay accepts per chain, native coin and stablecoins, with the confirmations each chain needs" skeleton="bars" error={failed ? 'GET /api/plans could not be read just now.' : undefined} steps={{ count: chains.length }} />
      )}
      {chains.length > 0 && (
        <ul className="m-0 mt-3 flex list-none flex-wrap gap-2 p-0" aria-label="Chains and assets">
          {chains.map((c) => (
            <li key={c.id} className="flex items-center gap-1.5 rounded-full border border-line px-2.5 py-1 font-mono text-[12px] text-muted">
              <ChainLogo chain={c.name} size={16} decorative />
              <span className="text-ink">{c.name}</span>
              {assets
                .filter((a) => a.chainId === c.id)
                .map((a) => (
                  <TokenLogo key={a.symbol} symbol={a.symbol} size={16} />
                ))}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** A one-row ring of the tracker's statuses right now (used by the API reference beside the latency). */
export function StatusRing() {
  const [rows, setRows] = useState<Row[] | null>(null)
  const probes = useProbe('/api/tracker', 60_000, 5, (b) => {
    const d = b as { rows?: Row[] }
    if (Array.isArray(d?.rows)) setRows(d.rows)
  })
  const counts = useMemo(() => {
    const m = new Map<string, number>()
    for (const r of rows ?? []) m.set(r.status, (m.get(r.status) ?? 0) + 1)
    return [...m.entries()].sort((a, b) => b[1] - a[1])
  }, [rows])
  const option = useMemo(
    () => ({
      tooltip: itemTooltip((p: { name: string; value: number; percent: number; color: string }) => tipHtml({ title: 'status', rows: [{ name: p.name, value: `${p.value} rows (${p.percent}%)`, color: p.color }] })),
      series: [{ id: 'status', type: 'pie', radius: ['58%', '90%'], startAngle: 90, animationType: 'expansion', animationTypeUpdate: 'transition', animationDuration: 1000, animationDurationUpdate: 600, label: { show: false }, padAngle: 1, itemStyle: { borderRadius: 2 }, emphasis: { scale: true, scaleSize: 4 }, data: counts.map(([name, value], i) => ({ name, value, itemStyle: { color: PALETTE[i % PALETTE.length] } })) }],
    }),
    [counts],
  )
  const failed = !rows && probes.length > 0 && !probes.some((p) => p.ok)
  return (
    <div className="flex min-w-0 items-center gap-4 rounded-lg border border-line bg-surface px-4 py-3">
      <div className="w-[120px] shrink-0">
        <EChart option={option} height={120} label="Tracker rows by status right now" skeleton="ring" error={failed ? 'unreadable' : undefined} />
      </div>
      <ul className="m-0 flex min-w-0 list-none flex-wrap gap-x-4 gap-y-1 p-0 font-mono text-[12px] text-ink-2">
        <li className="w-full text-[11px] tracking-[1px] text-faint">ROWS BY STATUS · LIVE</li>
        {counts.length ? (
          counts.map(([s, n], i) => (
            <li key={s} className="inline-flex items-center gap-2">
              <span className="size-2 rounded-full" style={{ background: PALETTE[i % PALETTE.length] }} />
              {s} <b className="font-medium text-ink">{n}</b>
            </li>
          ))
        ) : (
          <li className="text-muted">{failed ? 'unreadable' : 'reading…'}</li>
        )}
      </ul>
    </div>
  )
}

/* ------------------------------------------------------ shared reader --- */

/** The last good body of `path`, re-read every `everyMs`; `failed` once every read so far has failed. */
function useLive<T>(path: string, everyMs = 60_000, accept: (b: unknown) => boolean = () => true) {
  const [data, setData] = useState<T | null>(null)
  const probes = useProbe(path, everyMs, 5, (b) => {
    if (accept(b)) setData(b as T)
  })
  const failed = !data && probes.length > 0 && !probes.some((p) => p.ok)
  return { data, failed }
}

/** The frame every docs chart below sits in: a mono caption, a right-hand note, the chart and a footnote. */
function Frame({ caption, note, children, foot }: { caption: string; note?: ReactNode; children: ReactNode; foot?: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-2 rounded-lg border border-line bg-surface px-4 py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-mono text-[11px] tracking-[1px] text-faint">{caption}</span>
        {note !== undefined && <span className="font-mono text-[11px] text-dim">{note}</span>}
      </div>
      {children}
      {foot && <p className="m-0 font-mono text-[11px] leading-[1.6] text-faint">{foot}</p>}
    </div>
  )
}

/** A pulsing dot plus text, for a chart header (green once read, grey while reading). */
function LiveDot({ on, children }: { on: boolean; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-2">
      <span className={`size-[7px] rounded-full ${on ? 'bg-green' : 'bg-faint'}`} style={{ animation: 'gl-blink 1.6s ease-in-out infinite' }} />
      {children}
    </span>
  )
}

/** The animated stand-in while a series is too short to draw (empty states still move). */
function Scanning({ text, height = 120 }: { text: string; height?: number }) {
  return <GhostChart label={text} height={height} />
}

const readNote = (data: unknown, failed: boolean, live: ReactNode) => (data ? live : failed ? 'unreadable' : <LiveDot on={false}>reading…</LiveDot>)

/* ------------------------------------------- Gully Pay gas per chain --- */

interface GasRow {
  chainId: number
  name: string
  key: string
  symbol?: string
  feeSplit?: boolean
  ok: boolean
  error?: string
  gasPriceGwei?: number
  coinUsd?: number | null
  priceSource?: string | null
  l1FeeUsd?: number | null
  l1?: string | null
  payUsd?: number | null
  transferUsd?: number | null
  approveUsd?: number | null
  note?: string | null
}
interface GasDoc {
  at: string
  cacheSeconds: number
  gas: { approve: number; pay: number; transfer: number }
  chains: GasRow[]
}

/** A dollar figure that may be a fraction of a cent: two significant digits past the leading zeros. */
const usdSmall = (v: number) => {
  if (v === 0) return '$0'
  if (v >= 1) return `$${v.toFixed(2)}`
  const d = Math.min(8, 1 - Math.floor(Math.log10(v)))
  return `$${v.toFixed(d)}`
}
const intText = (v: number | undefined) => (typeof v === 'number' ? v.toLocaleString('en-US') : '?')

/**
 * What one Gully Pay payment costs in gas right now on each chain, from GET /api/pay/gas: a fee-proxy payment
 * (the merchant checkout with the fee split) and a plain token transfer, L1 data fee included. Log scale, since
 * Ethereum costs hundreds of times what an L2 does. A chain the server could not read is listed, never drawn as 0.
 */
export function GasCostChart() {
  const { data, failed } = useLive<GasDoc>('/api/pay/gas', 60_000, (b) => Array.isArray((b as GasDoc)?.chains))
  const priced = useMemo(() => (data?.chains ?? []).filter((c) => c.ok && typeof c.payUsd === 'number' && c.payUsd > 0 && typeof c.transferUsd === 'number' && c.transferUsd > 0).sort((a, b) => (b.payUsd as number) - (a.payUsd as number)), [data])
  const unpriced = useMemo(() => (data?.chains ?? []).filter((c) => !priced.includes(c)), [data, priced])
  const cheapest = priced.length ? priced[priced.length - 1] : null
  const option = useMemo(
    () => ({
      grid: { left: 8, right: 70, top: 28, bottom: 8, containLabel: true },
      legend: { top: 0, left: 0, textStyle: { color: C.muted }, data: ['Fee-proxy payment', 'Token transfer'] },
      xAxis: { type: 'log', logBase: 10, axisLabel: { formatter: (v: number) => usdSmall(v) }, splitLine: { lineStyle: { color: C.grid } } },
      yAxis: { type: 'category', data: priced.map((c) => c.name), axisTick: { show: false } },
      tooltip: axisTooltip((ps: { dataIndex: number }[]) => {
        const c = priced[ps[0]?.dataIndex ?? -1]
        if (!c) return ''
        return tipHtml({
          title: c.name,
          rows: [
            { name: `payment (${intText(data?.gas.pay)} gas)`, value: usdSmall(c.payUsd as number), color: C.gold },
            { name: `transfer (${intText(data?.gas.transfer)} gas)`, value: usdSmall(c.transferUsd as number), color: '#5aa9e6' },
            ...(typeof c.approveUsd === 'number' ? [{ name: `approve (${intText(data?.gas.approve)} gas)`, value: usdSmall(c.approveUsd) }] : []),
            { name: 'gas price', value: typeof c.gasPriceGwei === 'number' ? `${c.gasPriceGwei} gwei` : 'unreadable' },
            { name: `${c.symbol ?? 'coin'} price`, value: typeof c.coinUsd === 'number' ? `$${c.coinUsd.toLocaleString('en-US')}` : 'unreadable' },
            { name: 'L1 data fee', value: typeof c.l1FeeUsd === 'number' ? usdSmall(c.l1FeeUsd) : (c.l1 ?? 'none on this chain') },
          ],
          note: c.note ?? c.priceSource ?? undefined,
        })
      }, 'shadow'),
      series: [
        { id: 'pay', name: 'Fee-proxy payment', ...barsPreset({ horizontal: true, focus: 'series' }), color: C.gold, data: priced.map((c) => c.payUsd), label: { show: true, position: 'right', color: C.ink2, fontFamily: 'IBM Plex Mono', fontSize: 11, formatter: (p: { value: number }) => usdSmall(p.value) } },
        { id: 'transfer', name: 'Token transfer', ...barsPreset({ horizontal: true, focus: 'series' }), color: '#5aa9e6', data: priced.map((c) => c.transferUsd) },
      ],
    }),
    [priced, data],
  )
  return (
    <Frame
      caption="GAS FOR ONE PAYMENT, IN USD · LIVE FROM /api/pay/gas"
      note={readNote(data, failed, data && <LiveDot on>read {hhmmss(Date.parse(data.at))} · server cache {data.cacheSeconds} s</LiveDot>)}
      foot={
        data ? (
          <>
            Gas price from each chain (eth_gasPrice), coin price from the chain’s own Chainlink feed, L1 data fee from the OP Stack oracle or Arbitrum’s NodeInterface. The payer’s wallet pays it; Gully Pay adds nothing.
            {unpriced.map((c) => (
              <span key={c.chainId} className="block">
                {c.name}: {c.ok ? (c.note ?? 'no USD cost: not tracked yet') : 'unreadable'}
              </span>
            ))}
          </>
        ) : undefined
      }
    >
      {cheapest && (
        <div className="flex flex-wrap gap-6 font-mono text-[12px] text-muted">
          <span>
            cheapest now <b className="font-display text-[22px] text-ink">{cheapest.name}</b>{' '}
            <b className="font-display text-[22px] text-gold">
              <AnimatedNumber value={cheapest.payUsd as number} format={{ style: 'currency', currency: 'USD', maximumSignificantDigits: 2 }} />
            </b>
          </span>
          <span>
            chains priced <b className="font-display text-[22px] text-ink">{<AnimatedNumber value={priced.length} format={NF.int} countUp />}</b> of {data?.chains.length ?? 0}
          </span>
        </div>
      )}
      {!data ? (
        <ChartBox height={240} state={failed ? 'error' : 'loading'} variant="bars" message="GET /api/pay/gas could not be read just now." />
      ) : !priced.length ? (
        <Scanning text="No chain could be priced in USD just now: not tracked yet. Nothing is shown as zero." />
      ) : (
        <EChart option={option} height={Math.max(200, priced.length * 52 + 40)} label="What one Gully Pay payment and one token transfer cost in gas right now, per chain, in US dollars" skeleton="bars" steps={{ count: priced.length }} />
      )}
    </Frame>
  )
}

/* ------------------------------------------------ methodology: gap ladder --- */

interface TrackerDoc {
  generatedAt?: string
  rules?: { inLinePct?: number; flagPct?: number; minLiquidityUsd?: number }
  rows?: Row[]
}

const STATUS_COLOR: Record<string, string> = { premium: C.gold, discount: '#5aa9e6', drifting: '#c98bdb', 'in-line': C.green }
const chainShort = (c: string) => (c === 'bsc' ? 'BNB' : c === 'solana' ? 'SOL' : c === 'robinhood' ? 'RH' : c.toUpperCase())

/**
 * Every trusted row's gap right now, sorted, with the in-line band and the flag lines drawn from the rules the
 * same response carries: the methodology's table, applied live. Untrusted rows are counted by status below.
 */
export function GapLadder() {
  const { data, failed } = useLive<TrackerDoc>('/api/tracker', 60_000, (b) => Array.isArray((b as TrackerDoc)?.rows))
  const inLine = data?.rules?.inLinePct ?? null
  const flag = data?.rules?.flagPct ?? null
  const rows = useMemo(() => (data?.rows ?? []).filter((r) => (r.trusted ?? ['premium', 'discount', 'drifting', 'in-line'].includes(r.status)) && typeof r.gapPct === 'number').sort((a, b) => (a.gapPct as number) - (b.gapPct as number)), [data])
  const left = useMemo(() => {
    const m = new Map<string, number>()
    for (const r of data?.rows ?? []) if (!rows.includes(r)) m.set(r.status, (m.get(r.status) ?? 0) + 1)
    return [...m.entries()].sort((a, b) => b[1] - a[1])
  }, [data, rows])
  const option = useMemo(() => {
    const lines = flag !== null ? [{ yAxis: flag }, { yAxis: -flag }] : []
    return {
      grid: { left: 8, right: 16, top: 16, bottom: 8, containLabel: true },
      xAxis: { type: 'category', data: rows.map((r) => `${r.ticker}·${chainShort(r.chain)}`), axisTick: { show: false }, axisLabel: { show: rows.length <= 24, rotate: 60, fontSize: 11 } },
      yAxis: { type: 'value', axisLabel: { formatter: (v: number) => `${v}%` }, splitLine: { lineStyle: { color: C.grid } } },
      tooltip: axisTooltip((ps: { dataIndex: number }[]) => {
        const r = rows[ps[0]?.dataIndex ?? -1]
        return r ? tipHtml({ title: `${r.ticker} on ${r.chain}`, rows: [{ name: 'gap to fair', value: signed(r.gapPct as number), color: STATUS_COLOR[r.status] ?? C.muted }, { name: 'status', value: r.status }] }) : ''
      }, 'shadow'),
      series: [
        {
          id: 'gap',
          ...barsPreset({ stagger: 15 }),
          data: rows.map((r) => ({ value: Math.round((r.gapPct as number) * 100) / 100, itemStyle: { color: STATUS_COLOR[r.status] ?? C.muted, borderRadius: (r.gapPct as number) >= 0 ? [3, 3, 0, 0] : [0, 0, 3, 3] } })),
          ...(inLine !== null && { markArea: { silent: true, itemStyle: { color: 'rgba(116,194,123,.08)' }, label: { show: true, position: 'insideTopLeft', color: C.faint, fontSize: 11, formatter: `in line ±${inLine}%` }, data: [[{ yAxis: -inLine }, { yAxis: inLine }]] } }),
          ...(lines.length > 0 && { markLine: { silent: true, symbol: 'none', lineStyle: { color: C.lineHover, type: 'dashed' }, label: { color: C.faint, fontSize: 11, formatter: (p: { value: number }) => `flag ${p.value > 0 ? '+' : ''}${p.value}%` }, data: lines } }),
        },
      ],
    }
  }, [rows, inLine, flag])
  return (
    <Frame
      caption="EVERY TRUSTED GAP NOW, WITH THE RULES IN FORCE · LIVE FROM /api/tracker"
      note={readNote(data, failed, <LiveDot on>{data?.generatedAt ? `built ${hhmmss(Date.parse(data.generatedAt))}` : 'time not tracked yet'}</LiveDot>)}
      foot={
        data ? (
          <>
            {rows.length} trusted rows drawn{inLine !== null && flag !== null ? `; in line under ${inLine}%, flagged at ${flag}% (both read from rules)` : '; rules not tracked yet'}.
            {left.length > 0 && ` Not drawn: ${left.map(([s, n]) => `${s} ${n}`).join(', ')}.`}
          </>
        ) : undefined
      }
    >
      {!data ? (
        <ChartBox height={CHART_H.lg} state={failed ? 'error' : 'loading'} variant="bars" message="The tracker could not be read just now." />
      ) : !rows.length ? (
        <Scanning text="No trusted gap right now: every row is thin, unverified or unreadable. Nothing is shown as zero." />
      ) : (
        <EChart option={option} height={CHART_H.lg} label="Every trusted token's gap to fair right now, sorted, with the in-line band and the flag thresholds" skeleton="bars" steps={{ count: rows.length }} />
      )}
    </Frame>
  )
}

/* --------------------------------------------------- one token's history --- */

type HistPoint = [number, number, number | null, number | null]

/** One token's gap over the public seven days, from GET /api/tracker/history (what the SDK's getHistory returns). */
export function GapHistoryChart({ chain = 'robinhood', ticker = 'NVDA' }: { chain?: string; ticker?: string }) {
  const path = `/api/tracker/history?chain=${encodeURIComponent(chain)}&ticker=${encodeURIComponent(ticker)}`
  const { data, failed } = useLive<{ points: HistPoint[] }>(path, 300_000, (b) => Array.isArray((b as { points?: unknown })?.points))
  const pts = useMemo(() => (data?.points ?? []).filter((p) => typeof p[1] === 'number'), [data])
  const labels = useMemo(() => pts.map((p) => new Date(p[0] * 1000).toISOString().slice(5, 16).replace('T', ' ')), [pts])
  const option = useMemo(() => {
    const last = pts.length - 1
    const r3 = (v: number) => Math.round(v * 1000) / 1000
    return {
      grid: { left: 8, right: 16, top: 12, bottom: 8, containLabel: true },
      xAxis: { type: 'category', boundaryGap: false, data: labels, axisLabel: { interval: Math.max(0, Math.floor(pts.length / 6) - 1), fontSize: 11 } },
      yAxis: { type: 'value', scale: true, axisLabel: { formatter: (v: number) => `${v}%` }, splitLine: { lineStyle: { color: C.grid } } },
      tooltip: axisTooltip((ps: { dataIndex: number }[]) => {
        const i = ps[0]?.dataIndex ?? -1
        const p = pts[i]
        return p ? tipHtml({ title: `${labels[i]} UTC`, rows: [{ name: 'gap', value: signed(p[1]), color: C.gold }, { name: 'onchain', value: typeof p[2] === 'number' ? `$${p[2].toFixed(2)}` : 'unreadable' }, { name: 'fair', value: typeof p[3] === 'number' ? `$${p[3].toFixed(2)}` : 'unreadable' }] }) : ''
      }),
      series: [
        { id: 'gap', ...areaPreset({ color: C.gold, width: 1.75, fill: 0.2 }), data: pts.map((p) => r3(p[1])), markLine: { silent: true, symbol: 'none', lineStyle: { color: C.lineHover, type: 'dashed' }, label: { color: C.faint, fontSize: 11, formatter: 'fair' }, data: [{ yAxis: 0 }] } },
        livePoint(last >= 0 ? [labels[last], r3(pts[last][1])] : null),
      ],
    }
  }, [pts, labels])
  const last = pts[pts.length - 1]
  return (
    <Frame
      caption={`${ticker} ON ${chain.toUpperCase()} · GAP TO FAIR, 7 DAYS · LIVE FROM /api/tracker/history`}
      note={readNote(data, failed, <LiveDot on>{last ? `now ${signed(last[1])}` : 'no point yet'}</LiveDot>)}
      foot={data ? `${pts.length} five-minute snapshots. A row without a trusted gap is never recorded, so a hole in the line is a hole in the record.` : undefined}
    >
      {!data ? (
        <ChartBox height={CHART_H.md} state={failed ? 'error' : 'loading'} variant="line" message="The history could not be read just now." />
      ) : pts.length < 2 ? (
        <Scanning text="Not enough for a series yet." />
      ) : (
        <EChart option={option} height={CHART_H.md} label={`${ticker}'s gap to fair on ${chain} over the last seven days`} skeleton="line" steps={{ count: pts.length }} />
      )}
    </Frame>
  )
}

/* ------------------------------------------------- gap index (24 h) --- */

interface GapIndexDoc {
  top: number
  tokens: string[]
  bucketMinutes: number
  points: [number, number][]
  generatedAt: string
}

/** The 24-hour gap index: the average absolute gap of the widest series, in 30-minute buckets. */
export function GapIndexChart() {
  const { data, failed } = useLive<GapIndexDoc>('/api/tracker/gap-index', 120_000, (b) => Array.isArray((b as GapIndexDoc)?.points))
  const pts = useMemo(() => data?.points ?? [], [data])
  const option = useMemo(() => sparklinePreset({ data: pts.map((p) => p[1]), labels: pts.map((p) => hhmmss(p[0])), fmt: (v) => `${v.toFixed(3)}% avg |gap|` }), [pts])
  const last = pts[pts.length - 1]
  return (
    <Frame
      caption="GAP INDEX, LAST 24 H · LIVE FROM /api/tracker/gap-index"
      note={readNote(data, failed, <LiveDot on>{last ? `now ${last[1].toFixed(3)}%` : 'no point yet'}</LiveDot>)}
      foot={data ? `Average absolute gap of ${data.tokens.length ? data.tokens.join(', ') : 'no series yet'}, in ${data.bucketMinutes}-minute buckets.` : undefined}
    >
      {!data ? (
        <ChartBox height={80} state={failed ? 'error' : 'loading'} variant="line" message="The gap index could not be read just now." />
      ) : pts.length < 2 ? (
        <Scanning text="Not enough for a series yet." height={80} />
      ) : (
        <EChart option={option} height={80} label="Average absolute gap of the widest series over the last 24 hours" skeleton="line" steps={{ count: pts.length }} />
      )}
    </Frame>
  )
}

/* ---------------------------------------------------------- plans --- */

interface OfferLite {
  anonymous?: { perMin: number; historyDays: number }
  plans?: { id: string; name: string; priceUsdc: number; perMin: number; alerts: number; historyDays: number; maxKeys: number; monitors?: number }[]
  analytics?: { plans: { id: string; name: string; priceUsdc: number; sites: number; eventsPerMonth: number }[]; trialDays: number; periodDays: number }
}

const useOfferLive = () => useLive<OfferLite>('/api/plans', 120_000, (b) => Array.isArray((b as OfferLite)?.plans))

/** The tracker API limits per tier (no key, Free, Pro, Business) from GET /api/plans, with its own read. */
export function PlanLimitsLive() {
  const { data, failed } = useOfferLive()
  if (!data?.plans || !data.anonymous)
    return (
      <Frame caption="LIMITS PER PLAN · LIVE FROM /api/plans" note={failed ? 'unreadable' : <LiveDot on={false}>reading…</LiveDot>}>
        <ChartBox height={200} state={failed ? 'error' : 'loading'} variant="bars" message="GET /api/plans could not be read just now." />
      </Frame>
    )
  return <PlanLimits tiers={[{ name: 'No key', perMin: data.anonymous.perMin, historyDays: data.anonymous.historyDays, alerts: null, maxKeys: null }, ...data.plans.map((p) => ({ name: p.name, perMin: p.perMin, historyDays: p.historyDays, alerts: p.alerts, maxKeys: p.maxKeys }))]} />
}

/**
 * Per plan: the per-minute limit each workspace key gets, the 80% mark the usage.threshold activity event
 * fires at, and how many keys the workspace may hold. From GET /api/plans.
 */
export function WorkspaceLimitsChart() {
  const { data, failed } = useOfferLive()
  const plans = useMemo(() => data?.plans ?? [], [data])
  const option = useMemo(
    () => ({
      grid: { left: 8, right: 64, top: 28, bottom: 8, containLabel: true },
      legend: { top: 0, left: 0, textStyle: { color: C.muted }, data: ['80% warning', 'Limit'] },
      xAxis: { type: 'log', logBase: 10, axisLabel: { formatter: (v: number) => v.toLocaleString('en-US') }, splitLine: { lineStyle: { color: C.grid } } },
      yAxis: { type: 'category', data: plans.map((p) => p.name), axisTick: { show: false } },
      tooltip: axisTooltip((ps: { dataIndex: number }[]) => {
        const p = plans[ps[0]?.dataIndex ?? -1]
        return p ? tipHtml({ title: `${p.name} plan`, rows: [{ name: 'limit per key', value: `${p.perMin.toLocaleString('en-US')} / min`, color: C.gold }, { name: 'usage.threshold at 80%', value: `${Math.round(p.perMin * 0.8).toLocaleString('en-US')} / min`, color: '#5aa9e6' }, { name: 'keys per workspace', value: String(p.maxKeys) }] }) : ''
      }, 'shadow'),
      series: [
        { id: 'warn', name: '80% warning', ...barsPreset({ horizontal: true, focus: 'series' }), color: '#5aa9e6', data: plans.map((p) => Math.round(p.perMin * 0.8)) },
        { id: 'limit', name: 'Limit', ...barsPreset({ horizontal: true, focus: 'series' }), color: C.gold, data: plans.map((p) => p.perMin), label: { show: true, position: 'right', color: C.ink2, fontFamily: 'IBM Plex Mono', fontSize: 11, formatter: (q: { dataIndex: number }) => `${plans[q.dataIndex]?.maxKeys ?? '?'} keys` } },
      ],
    }),
    [plans],
  )
  return (
    <Frame caption="REQUESTS A MINUTE PER KEY, THE 80% WARNING AND KEYS PER WORKSPACE · LIVE FROM /api/plans" note={readNote(data, failed, <LiveDot on>{plans.length} plans</LiveDot>)}>
      {!data ? (
        <ChartBox height={200} state={failed ? 'error' : 'loading'} variant="bars" message="GET /api/plans could not be read just now." />
      ) : (
        <EChart option={option} height={Math.max(180, plans.length * 56 + 40)} label="Per plan: requests a minute per key, the 80% usage warning, and keys per workspace" skeleton="bars" steps={{ count: plans.length }} />
      )}
    </Frame>
  )
}

/** Gully Analytics plans: events a month and websites per plan, from GET /api/plans (field analytics). */
export function AnalyticsPlansChart() {
  const { data, failed } = useOfferLive()
  const plans = useMemo(() => data?.analytics?.plans ?? [], [data])
  const option = useMemo(
    () => ({
      grid: { left: 8, right: 90, top: 8, bottom: 8, containLabel: true },
      xAxis: { type: 'log', logBase: 10, axisLabel: { formatter: (v: number) => v.toLocaleString('en-US', { notation: 'compact' }) }, splitLine: { lineStyle: { color: C.grid } } },
      yAxis: { type: 'category', data: plans.map((p) => p.name), axisTick: { show: false } },
      tooltip: axisTooltip((ps: { dataIndex: number }[]) => {
        const p = plans[ps[0]?.dataIndex ?? -1]
        return p ? tipHtml({ title: p.name, rows: [{ name: 'events a month', value: p.eventsPerMonth.toLocaleString('en-US'), color: C.gold }, { name: 'websites', value: String(p.sites) }, { name: 'price', value: p.priceUsdc ? `${p.priceUsdc} USD / ${data?.analytics?.periodDays ?? 30} days` : `free for ${data?.analytics?.trialDays ?? '?'} days` }] }) : ''
      }, 'shadow'),
      series: [
        {
          id: 'events',
          ...barsPreset({ horizontal: true, stagger: 80 }),
          data: plans.map((p, i) => ({ value: p.eventsPerMonth, itemStyle: { color: PALETTE[i % PALETTE.length] } })),
          label: { show: true, position: 'right', color: C.ink2, fontFamily: 'IBM Plex Mono', fontSize: 11, formatter: (q: { dataIndex: number }) => `${plans[q.dataIndex]?.sites ?? '?'} site${plans[q.dataIndex]?.sites === 1 ? '' : 's'}` },
        },
      ],
    }),
    [plans, data],
  )
  return (
    <Frame caption="EVENTS A MONTH PER PLAN · LIVE FROM /api/plans" note={readNote(data, failed, <LiveDot on>{plans.length} plans</LiveDot>)}>
      {!data ? (
        <ChartBox height={180} state={failed ? 'error' : 'loading'} variant="bars" message="GET /api/plans could not be read just now." />
      ) : !plans.length ? (
        <Scanning text="The server lists no analytics plans: not tracked yet." />
      ) : (
        <EChart option={option} height={Math.max(160, plans.length * 50 + 30)} label="Gully Analytics plans: events a month and websites included" skeleton="bars" steps={{ count: plans.length }} />
      )}
    </Frame>
  )
}

/* ------------------------------------------------ Holder Map launches --- */

interface LaunchRow {
  chainKey: string
  chainName: string
  token: string
  symbol: string | null
  createdAt: string
  state: 'checked' | 'unavailable' | 'checking'
  health: { score: number | null; level: 'good' | 'mixed' | 'poor' | null; verdict: string } | null
  riskLine: string | null
}

const LEVEL_COLOR: Record<string, string> = { good: C.green, mixed: C.gold, poor: C.error }

/**
 * The newest DeepCore launches and their launch health score, from GET /api/holders/launches. A launch whose map
 * is still being built, or cannot be built, is listed with that state, never scored 0.
 */
export function LaunchHealthChart() {
  const { data, failed } = useLive<{ state: string; asOf: string | null; launches: LaunchRow[] }>('/api/holders/launches', 60_000, (b) => Array.isArray((b as { launches?: unknown })?.launches))
  const scored = useMemo(() => (data?.launches ?? []).filter((l) => typeof l.health?.score === 'number'), [data])
  const rest = useMemo(() => (data?.launches ?? []).filter((l) => !scored.includes(l)), [data, scored])
  const option = useMemo(
    () => ({
      grid: { left: 8, right: 40, top: 8, bottom: 8, containLabel: true },
      xAxis: { type: 'value', min: 0, max: 100, splitLine: { lineStyle: { color: C.grid } } },
      yAxis: { type: 'category', inverse: true, data: scored.map((l) => `${l.symbol ?? l.token.slice(0, 8)} · ${l.chainName ?? 'chain n/a'}`), axisTick: { show: false } },
      tooltip: axisTooltip((ps: { dataIndex: number }[]) => {
        const l = scored[ps[0]?.dataIndex ?? -1]
        return l ? tipHtml({ title: `${l.symbol ?? 'launch'} on ${l.chainName ?? 'an unnamed chain'}`, rows: [{ name: 'health', value: `${l.health?.score} / 100`, color: LEVEL_COLOR[l.health?.level ?? ''] ?? C.muted }, { name: 'level', value: l.health?.level ?? 'not tracked yet' }, { name: 'launched', value: `${l.createdAt ? `${l.createdAt.slice(0, 16).replace('T', ' ')} UTC` : 'not tracked yet'}` }], note: l.riskLine ?? l.health?.verdict }) : ''
      }, 'shadow'),
      series: [
        {
          id: 'health',
          ...barsPreset({ horizontal: true, stagger: 40 }),
          data: scored.map((l) => ({ value: l.health?.score, itemStyle: { color: LEVEL_COLOR[l.health?.level ?? ''] ?? C.muted } })),
          label: { show: true, position: 'right', color: C.ink2, fontFamily: 'IBM Plex Mono', fontSize: 11 },
        },
      ],
    }),
    [scored],
  )
  return (
    <Frame
      caption="NEWEST DEEPCORE LAUNCHES, HEALTH SCORE · LIVE FROM /api/holders/launches"
      note={readNote(data, failed, data && <LiveDot on={data.state === 'ok'}>{data.state === 'ok' ? 'DeepCore read' : `DeepCore ${data.state}`}{data.asOf ? ` ${hhmmss(Date.parse(data.asOf))}` : ''}</LiveDot>)}
      foot={rest.length ? `Not scored yet: ${rest.map((l) => `${l.symbol ?? l.token.slice(0, 8)} (${l.state === 'checking' ? 'map being built' : l.state === 'unavailable' ? 'holder data unavailable' : 'no score'})`).join(', ')}.` : undefined}
    >
      {!data ? (
        <ChartBox height={CHART_H.md} state={failed ? 'error' : 'loading'} variant="bars" message="GET /api/holders/launches could not be read just now." />
      ) : !scored.length ? (
        <Scanning text={data.launches.length ? 'The maps are still being built: no score yet.' : 'No launch read yet: not tracked yet.'} />
      ) : (
        <EChart option={option} height={Math.max(160, scored.length * 30 + 20)} label="Launch health score, 0 to 100, for the newest DeepCore launches" skeleton="bars" steps={{ count: scored.length }} />
      )}
    </Frame>
  )
}
