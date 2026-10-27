/* Gully Terminal building blocks (landing v3, 2026-10-26): kit logos, status dots, monospace KPI tiles with
   sparklines, ruled panels, live charts with honest empty/offline states, horizontal bar lists, the uptime grid and
   scroll reveals. Charts reuse the lab-console SVG kit (src/console/charts.ts); terminal.css flattens its styling. */
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { Link } from 'react-router'
import { lineChart, bars as drawBars, type LineChart, type Series } from '../console/charts'
import { Count, Spark } from '../console/ui'
import { hubState, type HubBody } from '../console/live'
import type { LogoDef, ProductDef } from './catalog'

/* ---------------------------------------------------------------- data ---- */
export interface HourRow {
  t: number
  [k: string]: number
}
export interface HubProducts {
  generatedAt: string
  chain: { head: number; read: number; hourly: HourRow[]; recent: { number: number; txs: number; gas: number; time: number }[] } | null
  activity: { hourly: HourRow[]; events: number; since: number | null } | null
  bridge: { fast: HourRow[] | null; fastAllIn: number | null; fastAllOut: number | null; canonical: HourRow[] | null; gethSupply: number | null; gethBacking: number | null; token: string; router: string; unit: string } | null
  holders: { daily: { day: string; maps: number }[]; today: number; tokens: number; top: { chain: string; symbol: string | null; token: string; scans: number; path: string }[]; byChain: { chain: string; maps: number }[] } | null
  security: { daily: { day: string; scans: number }[]; total: number; states: Record<string, number>; published: number } | null
}
type Loaded<T> = { data: T | null; state: 'loading' | 'ok' | 'error' }

/** One shared poller per URL (every page that mounts it shares the same read). */
function poller<T>(url: string, ms: number) {
  let v: Loaded<T> = { data: null, state: 'loading' }
  const subs = new Set<() => void>()
  let timer: ReturnType<typeof setInterval> | null = null
  const read = async () => {
    try {
      const r = await fetch(url, { cache: 'no-store' })
      if (!r.ok) throw new Error(String(r.status))
      v = { data: (await r.json()) as T, state: 'ok' }
    } catch {
      v = { data: v.data, state: v.data ? 'ok' : 'error' }
    }
    subs.forEach((f) => f())
  }
  return {
    get: () => v,
    subscribe(f: () => void) {
      subs.add(f)
      if (!timer) {
        void read()
        timer = setInterval(read, ms)
      }
      return () => {
        subs.delete(f)
        if (!subs.size && timer) {
          clearInterval(timer)
          timer = null
        }
      }
    },
  }
}
const productsPoll = poller<HubProducts>('/api/hub/products', 60_000)
export const useHubProducts = () => useSyncExternalStore(productsPoll.subscribe, productsPoll.get, productsPoll.get)

export interface Plans {
  periodDays?: number
  plans?: { id: string; name: string; priceUsdc: number; perMin?: number; historyDays?: number }[]
  security?: { scan?: { name: string; priceUsd: number; freePerMonth?: Record<string, number> }; review?: { name: string; quoted?: boolean } }
  holderDeep?: { priceUsd?: number; name?: string } & Record<string, unknown>
}
const plansPoll = poller<Plans>('/api/plans', 300_000)
export const usePlans = () => useSyncExternalStore(plansPoll.subscribe, plansPoll.get, plansPoll.get)

/* ---------------------------------------------------------------- formats ---- */
export const hourLabel = (t: number) => new Date(t * 1000).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
export const minLabel = (iso: string) => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
export const fmtEth = (v: number | null | undefined) => (v == null || !isFinite(v) ? '—' : `${v < 0.001 && v > 0 ? v.toExponential(1) : v.toFixed(v < 1 ? 4 : 2)} ETH`)
export const fmtMs = (v: number | null | undefined) => (v == null || !isFinite(v) ? '—' : `${Math.round(v)} ms`)
export const fmtCompact = (v: number | null | undefined) => (v == null || !isFinite(v) ? '—' : v >= 1e9 ? `${(v / 1e9).toFixed(2)}B` : v >= 1e6 ? `${(v / 1e6).toFixed(2)}M` : v >= 1e4 ? `${(v / 1e3).toFixed(1)}k` : Math.round(v).toLocaleString('en-US'))
export const sum = (xs: (number | null | undefined)[]) => xs.reduce<number>((a, b) => a + (b ?? 0), 0)
export const S = ['#20A0C4', '#1A5FE6', '#9578E8', '#9121B5'] as const
export const ACCENT = '#00D2FF'

/* ---------------------------------------------------------------- logos ---- */
/** A product's logo: the kit file (WebP with a PNG fallback, or the kit SVG), or the kit mark plus its name. */
export function Logo({ def, name, scale = 1, decorative = false }: { def: LogoDef; name: string; scale?: number; decorative?: boolean }) {
  if (def.kind === 'mark') {
    const src = def.mark === 'chain' ? '/brand/web/logos/gullychain-mark' : null
    const h = Math.round(28 * scale)
    return (
      <span className="gt-logo gt-logo-mark" style={{ height: Math.round(40 * scale), fontSize: Math.round(19 * scale) }} role={decorative ? undefined : 'img'} aria-label={decorative ? undefined : name} aria-hidden={decorative || undefined}>
        {src ? (
          <picture>
            <source srcSet={`${src}.webp`} type="image/webp" />
            <img src={`${src}.png`} width={h} height={h} alt="" decoding="async" draggable={false} />
          </picture>
        ) : (
          <img src="/brand/icon/gully-labs-icon.png" width={Math.round((h * 343) / 372)} height={h} alt="" decoding="async" draggable={false} />
        )}
        <span aria-hidden>{def.label}</span>
      </span>
    )
  }
  const h = Math.round(def.display * scale)
  const w = Math.round((h * def.w) / def.h)
  const img = <img src={def.src} width={w} height={h} alt={decorative ? '' : name} decoding="async" draggable={false} style={{ width: w, maxWidth: '100%', height: 'auto' }} />
  return (
    <span className="gt-logo" style={{ height: Math.round(40 * scale) }}>
      {def.webp ? (
        <picture>
          <source srcSet={def.webp} type="image/webp" />
          {img}
        </picture>
      ) : (
        img
      )}
    </span>
  )
}

/* ---------------------------------------------------------------- status ---- */
export type St = 'up' | 'down' | 'coming' | 'reading'
const WORD: Record<St, string> = { up: 'live', down: 'down', coming: 'coming', reading: 'checking' }
export function stateOf(hub: HubBody | null, keys: string[]): St {
  if (!hub) return 'reading'
  const st = keys.map((k) => hubState(hub.services.find((s) => s.key === k)))
  if (st.includes('up')) return 'up'
  if (st.every((s) => s === 'coming')) return 'coming'
  if (st.every((s) => s === 'reading')) return 'reading'
  return st.includes('down') ? 'down' : 'coming'
}
export function Dot({ s, label }: { s: St; label?: string }) {
  return (
    <span className={`gt-dot ${s}`}>
      <i aria-hidden />
      {label ?? WORD[s]}
    </span>
  )
}

/* ---------------------------------------------------------------- tiles ---- */
export function Kpi({ label, value, fmt, sub, spark, color = ACCENT, text }: { label: string; value?: number | null; fmt?: (v: number) => string; sub?: ReactNode; spark?: (number | null)[]; color?: string; text?: ReactNode }) {
  const hasSpark = (spark ?? []).filter((v) => v != null).length > 1
  return (
    <div className="gt-kpi">
      <span className="gt-k">{label}</span>
      <span className="gt-v">{text ?? <Count value={value} fmt={fmt} className="num" />}</span>
      {spark && (hasSpark ? <Spark values={spark} color={color} h={28} /> : <span className="gt-wait" aria-hidden><i /></span>)}
      {sub != null && <span className="gt-s">{sub}</span>}
    </div>
  )
}

export function Panel({ label, right, children, className = '', id }: { label: ReactNode; right?: ReactNode; children: ReactNode; className?: string; id?: string }) {
  return (
    <section className={`gt-panel ${className}`} aria-labelledby={id}>
      <header>
        <span className="gt-k" id={id}>
          {label}
        </span>
        {right != null && <span className="gt-r">{right}</span>}
      </header>
      {children}
    </section>
  )
}

/* ---------------------------------------------------------------- charts ---- */
export interface ChartTab {
  id: string
  label: string
  title: string
  series: Series[]
  labels: string[]
  fmt?: (v: number | null) => string
  stacked?: boolean
  /** Why there is nothing to draw: the source could not be read, or it has no points yet. */
  state?: 'ok' | 'loading' | 'offline' | 'empty'
  empty?: string
  head?: ReactNode
  sub?: ReactNode
}

/** A live line/area chart with tabs, a data table toggle and honest empty and offline states. */
export function TChart({ label, tabs, height = 180, right }: { label: ReactNode; tabs: ChartTab[]; height?: number; right?: ReactNode }) {
  const [cur, setCur] = useState(0)
  const [table, setTable] = useState(false)
  const plot = useRef<HTMLDivElement>(null)
  const legend = useRef<HTMLDivElement>(null)
  const tbl = useRef<HTMLDivElement>(null)
  const chart = useRef<LineChart | null>(null)
  const tab = tabs[Math.min(cur, tabs.length - 1)]
  const enough = tab.series.some((s) => s.values.filter((v) => v != null).length >= 2)
  const state = tab.state && tab.state !== 'ok' ? tab.state : enough ? 'ok' : 'empty'
  const key = JSON.stringify([tab.id, tab.series, tab.labels, state])
  useEffect(() => {
    if (!plot.current) return
    if (state !== 'ok') {
      chart.current?.destroy()
      chart.current = null
      plot.current.innerHTML = ''
      if (legend.current) legend.current.innerHTML = ''
      if (tbl.current) tbl.current.innerHTML = ''
      return
    }
    if (!chart.current) chart.current = lineChart(plot.current, { series: tab.series, labels: tab.labels, title: tab.title, fmt: tab.fmt, stacked: tab.stacked, height, legendEl: legend.current, tableEl: tbl.current })
    else chart.current.update(tab.series, tab.labels, tab.title)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  useEffect(
    () => () => {
      chart.current?.destroy()
      chart.current = null
    },
    [],
  )
  return (
    <section className="gt-panel gt-chart">
      <header>
        <span className="gt-k">{label}</span>
        <span className="gt-r">
          {right}
          {tabs.length > 1 &&
            tabs.map((t, i) => (
              <button key={t.id} type="button" className="gt-tab" aria-pressed={i === cur} onClick={() => setCur(i)}>
                {t.label}
              </button>
            ))}
          <button type="button" className="gt-tab" aria-pressed={table} onClick={() => setTable(!table)} disabled={state !== 'ok'}>
            Table
          </button>
        </span>
      </header>
      {(tab.head != null || tab.sub != null) && (
        <div className="gt-head">
          {tab.head != null && <b className="num">{tab.head}</b>}
          {tab.sub != null && <span>{tab.sub}</span>}
        </div>
      )}
      {state !== 'ok' && <Empty state={state} text={tab.empty} height={height} />}
      <div className="plot" ref={plot} hidden={table || state !== 'ok'} />
      <div className="legend" ref={legend} hidden={table || state !== 'ok'} />
      <div className="dtwrap" ref={tbl} hidden={!table || state !== 'ok'} />
    </section>
  )
}

export function Empty({ state, text, height = 120 }: { state: 'loading' | 'offline' | 'empty'; text?: string; height?: number }) {
  const msg = state === 'loading' ? 'reading the source…' : state === 'offline' ? (text ?? 'source unreadable right now · retrying every minute') : (text ?? 'no data points yet')
  return (
    <div className={`gt-empty ${state}`} style={{ minHeight: Math.round(height * 0.75) }} role="status">
      <span className="gt-scan" aria-hidden />
      <span>
        <i aria-hidden />
        {msg}
      </span>
    </div>
  )
}

/** The txs-per-block strip: slides as blocks arrive, the newest flashes. */
export function BlockStrip({ blocks, h = 56 }: { blocks: { number: number; txs: number }[]; h?: number }) {
  const ref = useRef<HTMLDivElement>(null)
  const key = JSON.stringify(blocks.map((b) => [b.number, b.txs]))
  useEffect(() => {
    if (!blocks.length) return
    drawBars(ref.current, blocks.map((b) => b.txs), { keys: blocks.map((b) => b.number), labels: blocks.map((b) => `block ${b.number}`), title: 'Transactions per block', h, color: S[1], last: ACCENT })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  return <div className="gt-strip" ref={ref} />
}

/** Horizontal bars, animated to their width (a ranked list: most scanned, maps by chain, networks). */
export function HBars({ rows, fmt = fmtCompact, empty }: { rows: { label: ReactNode; value: number; note?: ReactNode; href?: string }[]; fmt?: (v: number) => string; empty?: string }) {
  const [on, setOn] = useState(false)
  useEffect(() => {
    const t = requestAnimationFrame(() => setOn(true))
    return () => cancelAnimationFrame(t)
  }, [])
  if (!rows.length) return <Empty state="empty" text={empty} height={80} />
  const max = Math.max(...rows.map((r) => r.value), 1)
  return (
    <ul className="gt-hbars">
      {rows.map((r, i) => (
        <li key={i}>
          <span className="l">{r.href ? <a href={r.href}>{r.label}</a> : r.label}</span>
          <span className="b" aria-hidden>
            <i style={{ width: on ? `${Math.max(2, (r.value / max) * 100)}%` : 0, transitionDelay: `${i * 60}ms` }} />
          </span>
          <span className="v num">{fmt(r.value)}</span>
          {r.note != null && <span className="n">{r.note}</span>}
        </li>
      ))}
    </ul>
  )
}

/** Every surface's last hour, one cell a minute: answered (shaded by speed), down, or still coming. */
export function UptimeGrid({ hub, keys, compact = false }: { hub: HubBody | null; keys?: string[]; compact?: boolean }) {
  if (!hub) return <Empty state="loading" height={160} />
  const svc = keys ? hub.services.filter((s) => keys.includes(s.key)) : hub.services
  const n = Math.max(1, ...svc.map((s) => s.history.length))
  return (
    <div className={`gt-uptime ${compact ? 'compact' : ''}`} role="table" aria-label="Surface checks, one a minute, last hour">
      {svc.map((s) => {
        const st = hubState(s)
        const cells = Array.from({ length: n }, (_, i) => s.history[s.history.length - n + i])
        return (
          <div className="row" role="row" key={s.key}>
            <span className="nm" role="rowheader">
              <Dot s={st === 'reading' ? 'reading' : st} label="" />
              {s.url ? (
                <a href={s.url} target="_blank" rel="noopener noreferrer">
                  {s.name}
                </a>
              ) : (
                s.name
              )}
            </span>
            <span className="cells" role="cell" aria-label={`${s.name}: ${st}${s.ms != null ? `, ${s.ms} ms` : ''}`}>
              {cells.map((c, i) => (
                <i key={i} className={!c ? 'na' : c.ms == null ? (st === 'coming' ? 'co' : 'dn') : c.ms > 1500 ? 'sl' : 'ok'} title={c ? `${minLabel(c.t)} · ${c.ms == null ? (st === 'coming' ? 'coming' : 'no answer') : `${c.ms} ms`}` : ''} style={{ animationDelay: `${i * 12}ms` }} />
              ))}
            </span>
            <span className="ms num">{s.ms != null ? `${s.ms} ms` : st === 'coming' ? 'coming' : '—'}</span>
          </div>
        )
      })}
    </div>
  )
}

/** Mean latency per minute over some surfaces (null where none answered). */
export function latencySeries(hub: HubBody | null, keys: string[]) {
  const svc = (hub?.services ?? []).filter((s) => keys.includes(s.key))
  const n = Math.max(0, ...svc.map((s) => s.history.length))
  const first = svc.find((s) => s.history.length === n)
  return {
    labels: (first?.history ?? []).map((h) => minLabel(h.t)),
    series: svc.map((s, i) => ({ key: s.key, name: s.name, color: S[i % 4], values: Array.from({ length: n }, (_, j) => s.history[s.history.length - n + j]?.ms ?? null) })),
  }
}

/* ---------------------------------------------------------------- motion ---- */
/** Adds `in` when the element scrolls into view (CSS does the fade; reduced motion keeps the fade only). */
export function useReveal<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (typeof IntersectionObserver === 'undefined') {
      el.classList.add('in')
      return
    }
    const io = new IntersectionObserver(
      (es) =>
        es.forEach((e) => {
          if (e.isIntersecting) {
            e.target.classList.add('in')
            io.unobserve(e.target)
          }
        }),
      { rootMargin: '0px 0px -8% 0px' },
    )
    el.querySelectorAll('.rv').forEach((x) => io.observe(x))
    return () => io.disconnect()
  }, [])
  return ref
}

/* ---------------------------------------------------------------- misc ---- */
export function SecHead({ n, label, title, children, id }: { n: string; label: string; title: string; children?: ReactNode; id?: string }) {
  return (
    <div className="gt-sh rv">
      <span className="gt-k">
        <b>{n}</b> / {label}
      </span>
      <h2 id={id}>{title}</h2>
      {children && <p>{children}</p>}
    </div>
  )
}

/** A link that opens outside in a new tab, or inside with the router. */
export function A({ href, className, children, ariaLabel }: { href: string; className?: string; children: ReactNode; ariaLabel?: string }) {
  if (/^https?:/.test(href))
    return (
      <a className={className} href={href} target="_blank" rel="noopener noreferrer" aria-label={ariaLabel}>
        {children}
      </a>
    )
  if (href.startsWith('#'))
    return (
      <a className={className} href={href} aria-label={ariaLabel}>
        {children}
      </a>
    )
  return (
    <Link className={className} to={href} aria-label={ariaLabel}>
      {children}
    </Link>
  )
}

export const productHref = (p: ProductDef) => `/products/${p.slug}`
