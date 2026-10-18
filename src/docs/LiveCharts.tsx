// Live, animated charts for the docs pages (owner rule: every surface shows live data). Everything here
// is read from the public API in the browser, through apiOrigin(), and nothing is typed in: a probe that
// failed shows as unreachable, an unread value as "not tracked yet", never as 0. ECharts itself loads
// on demand inside EChart, so a docs page paints before any chart code arrives.

import { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatedNumber } from '../components/charts/AnimatedNumber'
import { EChart } from '../components/charts/EChart'
import { axisTooltip, barsPreset, C, CHART_H, itemTooltip, PALETTE, sparklinePreset, tipHtml } from '../components/charts/chartPresets'
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
async function probeOnce(path: string): Promise<{ probe: Probe; body: unknown }> {
  const t0 = performance.now()
  try {
    const r = await fetch(`${apiOrigin()}${path}`, { cache: 'no-store', headers: { accept: 'application/json' } })
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
    <div className="flex min-w-0 flex-col gap-3 rounded-panel border border-line bg-surface px-4 py-3">
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
        <div className="relative h-[44px] overflow-hidden rounded-input bg-surface-deep">
          <span className="absolute inset-0 bg-[linear-gradient(90deg,transparent,rgba(232,192,96,.12),transparent)]" style={{ animation: 'gl-scan 1.6s linear infinite' }} />
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
    <div className="flex flex-col gap-2 rounded-panel border border-line bg-surface px-4 py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-mono text-[11px] tracking-[1px] text-faint">WIDEST TRUSTED GAPS NOW · LIVE FROM /api/tracker</span>
        <span className="font-mono text-[11px] text-dim">{at ? `built ${hhmmss(Date.parse(at))}` : rows ? 'time not tracked yet' : ''}</span>
      </div>
      {rows && !top.length ? (
        <p className="m-0 py-6 font-mono text-[12px] text-muted">No trusted gap right now: every row is thin, unverified or unreadable. Nothing is shown as zero.</p>
      ) : (
        <EChart option={option} height={CHART_H.lg} label="The widest trusted gaps between on-chain and fair price right now, by token" skeleton="bars" error={failed ? 'The tracker could not be read just now.' : undefined} steps={{ count: top.length }} />
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
  chains?: { id: number; name: string; confirmations: number }[]
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
      return tipHtml({ title: c.name, rows: [...list.map((a, j) => ({ name: a.symbol, value: a.kind === 'native' ? 'native coin' : 'token', color: PALETTE[j % PALETTE.length] })), { name: 'confirmations', value: String(c.confirmations) }] })
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
        { id: 'token', name: 'Stablecoins', stack: 'assets', ...barsPreset({ horizontal: true, focus: 'series' }), color: '#1f9e89', data: chains.map((c) => of(c.id, 'token').length) },
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
    <div className="flex flex-col gap-2 rounded-panel border border-line bg-surface px-4 py-3">
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
    <div className="flex min-w-0 items-center gap-4 rounded-panel border border-line bg-surface px-4 py-3">
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
