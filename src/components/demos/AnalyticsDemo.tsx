import { useEffect, useMemo, useState, type CSSProperties, type JSX, type KeyboardEvent } from 'react'
import { ArrowRight } from 'lucide-react'
import { useReducedMotion } from '../charts/chart-utils'
import { ANALYTICS_SIGNUP, usePlans } from '../../lib/plans'
import { track } from '../../lib/track'
import { ChainLogo } from '../logos/ChainLogo'
import { NewTabMark } from '../LayoutLinks'
import { newTab } from '../LayoutNav'

// The trial opens the app: another host in production (new tab), the local /app route in dev.
const SIGNUP_EXT = /^https?:/.test(ANALYTICS_SIGNUP)

/* Landing demo: a Gully Analytics dashboard (Umami with web3). Every figure on it is generated example
   data and is labelled so; there is no public stats endpoint. The trial length, plan names and limits
   come from GET /api/plans (field `analytics`), and the script tag is the real one. */

type Range = '24h' | '7d' | '30d'
const RANGES: Range[] = ['24h', '7d', '30d']
const CFG: Record<Range, { n: number; unit: string; base: number }> = {
  '24h': { n: 24, unit: 'h', base: 60 },
  '7d': { n: 28, unit: '×6h', base: 420 },
  '30d': { n: 30, unit: 'd', base: 1400 },
}
const W = 600
const H = 220
// The same example split as the /analytics page (charts/ProductExamples.tsx), so the two never disagree.
const CHAINS: [string, number, string][] = [
  ['Base', 41, '#5aa9e6'],
  ['Ethereum', 23, '#c98bdb'],
  ['BNB Chain', 17, '#d9b563'],
  ['Robinhood Chain', 12, '#74c27b'],
  ['Arc', 7, '#ff8a7a'],
]
const PAGES: [string, number][] = [
  ['/', 1],
  ['/swap', 0.62],
  ['/stake', 0.41],
  ['/docs', 0.22],
]
const EASE = 'cubic-bezier(.2,.8,.2,1)'

const hash = (s: string) => {
  let h = 7
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 2147483647
  return h || 1
}
function rng(seed: number) {
  let s = seed % 2147483647
  if (s <= 0) s += 2147483646
  return () => {
    s = (s * 16807) % 2147483647
    return (s - 1) / 2147483646
  }
}
const fmt = (n: number) => n.toLocaleString('en-US')
const compact = (n: number) => (n >= 1e6 ? `${n / 1e6}M` : n >= 1e3 ? `${n / 1e3}k` : String(n))

function series(range: Range) {
  const { n, base } = CFG[range]
  const r = rng(hash(range))
  const v: number[] = []
  const w: number[] = []
  for (let i = 0; i < n; i++) {
    const b = base * (0.6 + 0.4 * Math.sin((i / n) * Math.PI * 3) + r() * 0.35)
    v.push(Math.round(b))
    w.push(Math.round(b * (0.16 + r() * 0.12)))
  }
  return { v, w }
}

export default function AnalyticsDemo(): JSX.Element {
  const reduced = useReducedMotion()
  const [range, setRange] = useState<Range>('7d')
  const [hover, setHover] = useState<number | null>(null)
  const [chain, setChain] = useState<number | null>(null)
  const [tick, setTick] = useState(0)
  const [plans, retry] = usePlans()

  useEffect(() => {
    if (reduced) return
    const id = setInterval(() => setTick((t) => t + 1), 1800)
    return () => clearInterval(id)
  }, [reduced])

  const d = useMemo(() => {
    const { v, w } = series(range)
    const n = v.length
    const mx = Math.max(...v) * 1.1
    const X = (i: number) => (i / (n - 1)) * W
    const Y = (x: number) => H - (x / mx) * (H - 10)
    const line = (a: number[]) => a.map((x, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)} ${Y(x).toFixed(1)}`).join(' ')
    const area = (a: number[]) => `${line(a)} L${W} ${H} L0 ${H} Z`
    const tv = v.reduce((a, b) => a + b, 0)
    const tw = w.reduce((a, b) => a + b, 0)
    const signed = Math.round(tw * 0.62)
    const tx = Math.round(tw * 0.38)
    return { v, w, n, X, tv, tw, signed, tx, paths: { va: area(v), vl: line(v), wa: area(w), wl: line(w) } }
  }, [range])

  const pathStyle = (p: string): CSSProperties => ({ d: `path('${p}')`, transition: `d .7s ${EASE}` }) as CSSProperties
  const live = 23 + ((tick * 7) % 11)
  const unit = CFG[range].unit

  const onChartKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault()
      setHover((h) => {
        const cur = h ?? (e.key === 'ArrowRight' ? -1 : d.n)
        return Math.min(d.n - 1, Math.max(0, cur + (e.key === 'ArrowRight' ? 1 : -1)))
      })
    } else if (e.key === 'Escape') setHover(null)
  }

  const kpis = [
    { l: 'Visitors', v: fmt(d.tv), d: '▲ 14% vs previous', c: 'text-green' },
    { l: 'Wallets connected', v: fmt(d.tw), d: `${((d.tw / d.tv) * 100).toFixed(1)}% of visitors`, c: 'text-muted' },
    { l: 'Transactions', v: fmt(d.tx), d: 'from connected wallets', c: 'text-muted' },
    { l: 'Visit → tx', v: `${((d.tx / d.tv) * 100).toFixed(2)}%`, d: '▲ 0.4 pp vs previous', c: 'text-green' },
  ]
  const funnel: [string, number][] = [
    ['Visits', d.tv],
    ['Wallet connect', d.tw],
    ['Signed', d.signed],
    ['Transaction', d.tx],
  ]

  const ring = CHAINS.map(([l, p, c], i) => ({ l, p, c, i, off: -CHAINS.slice(0, i).reduce((a, x) => a + x[1], 0) }))

  const offer = plans.k === 'ok' ? plans.offer.analytics : null
  const paid = offer?.plans.filter((p) => p.priceUsdc > 0) ?? []

  return (
    <div className="flex w-full flex-col overflow-hidden rounded-card border border-line bg-card-token text-[13px] leading-[1.45] text-ink lg:h-[600px]">
      {/* Top bar */}
      <div className="flex flex-wrap items-center gap-2.5 border-b border-line px-4 py-2.5">
        <span className="flex items-center gap-2 rounded-full border border-line-strong px-3 py-1.5 font-mono text-[12px]">
          <span aria-hidden className="size-2 rounded-[2px] bg-gold" />
          app.yourproject.xyz
        </span>
        <span className="rounded-full border border-gold-line px-2.5 py-1 font-mono text-[11px] tracking-[1px] text-gold">EXAMPLE DATA</span>
        <span className="flex items-center gap-2 text-[12px] text-muted">
          <span aria-hidden className="size-2 rounded-full bg-green transition-[box-shadow] duration-[600ms]" style={{ boxShadow: `0 0 0 ${tick % 2 ? 6 : 0}px rgba(116,194,123,.25)` }} />
          <b className="font-mono font-medium text-ink">{live}</b> visitors right now
        </span>
        <div role="tablist" aria-label="Range" className="ml-auto flex gap-0.5 rounded-[6px] border border-line p-0.5">
          {RANGES.map((r) => (
            <button
              key={r}
              type="button"
              role="tab"
              aria-selected={r === range}
              onClick={() => {
                setRange(r)
                setHover(null)
              }}
              className={`min-h-11 min-w-11 rounded-[4px] px-2 font-mono text-[11px] transition-colors ${r === range ? 'bg-gold font-semibold text-bg' : 'text-muted hover:text-ink'}`}
            >
              {r}
            </button>
          ))}
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 border-b border-line md:grid-cols-4">
        {kpis.map((k, i) => (
          <div key={k.l} className={`flex flex-col gap-0.5 border-line px-4 py-3 ${i % 2 === 0 ? 'border-r' : 'md:border-r'} ${i < 2 ? 'max-md:border-b' : ''} ${i === 3 ? 'md:border-r-0' : ''}`}>
            <span className="text-[11px] text-dim">{k.l}</span>
            <b className="font-display text-[28px] leading-none font-bold">{k.v}</b>
            <span className={`font-mono text-[11px] ${k.c}`}>{k.d}</span>
          </div>
        ))}
      </div>

      {/* Chart + side */}
      <div className="flex min-h-0 flex-1 flex-wrap">
        <div className="min-w-0 flex-[999_1_460px] border-line px-2.5 pt-3 pb-2.5 max-lg:border-b lg:border-r">
          <div className="flex gap-3.5 px-1.5 pb-1.5 text-[11px] text-muted">
            <span className="flex items-center gap-1.5">
              <span aria-hidden className="size-2.5 rounded-[2px] bg-gold-line" />
              Visitors
            </span>
            <span className="flex items-center gap-1.5">
              <span aria-hidden className="size-2.5 rounded-[2px] bg-gold" />
              Wallets connected
            </span>
          </div>
          <div
            className="relative rounded-[6px]"
            tabIndex={0}
            role="group"
            aria-label={`Visitors and connected wallets, last ${range}. Use the arrow keys to read each point.`}
            onMouseLeave={() => setHover(null)}
            onBlur={() => setHover(null)}
            onKeyDown={onChartKey}
          >
            <svg aria-hidden viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="block h-[180px] w-full lg:h-[230px]">
              <g stroke="#1c2531">
                <line x1="0" y1="55" x2={W} y2="55" />
                <line x1="0" y1="110" x2={W} y2="110" />
                <line x1="0" y1="165" x2={W} y2="165" />
              </g>
              <path d={d.paths.va} style={pathStyle(d.paths.va)} fill="rgba(85,76,52,.55)" />
              <path d={d.paths.vl} style={pathStyle(d.paths.vl)} fill="none" stroke="#c9a24e" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
              <path d={d.paths.wa} style={pathStyle(d.paths.wa)} fill="rgba(217,181,99,.35)" />
              <path d={d.paths.wl} style={pathStyle(d.paths.wl)} fill="none" stroke="#d9b563" strokeWidth="2" vectorEffect="non-scaling-stroke" />
              {hover !== null && <line x1={d.X(hover)} y1="0" x2={d.X(hover)} y2={H} stroke="#3a4656" vectorEffect="non-scaling-stroke" />}
              {d.v.map((_, j) => (
                <rect key={j} x={d.X(j) - W / (d.n - 1) / 2} y="0" width={W / (d.n - 1)} height={H} fill="transparent" onMouseEnter={() => setHover(j)} />
              ))}
            </svg>
            {hover !== null && (
              <div
                role="status"
                className="pointer-events-none absolute top-2 grid grid-cols-[auto_auto] gap-x-3.5 gap-y-0.5 rounded-[6px] border border-line-strong bg-[rgba(17,25,35,.96)] px-2.5 py-2 font-mono text-[11px]"
                style={{ left: `${(hover / (d.n - 1)) * 100}%`, transform: `translateX(${hover > d.n * 0.6 ? '-105%' : '10px'})` }}
              >
                <span className="text-faint">{d.n - 1 - hover === 0 ? 'now' : `${d.n - 1 - hover} ${unit} ago`}</span>
                <span />
                <span className="text-[#c9a24e]">visitors</span>
                <span>{fmt(d.v[hover])}</span>
                <span className="text-gold">wallets</span>
                <span>{fmt(d.w[hover])}</span>
                <span className="text-muted">rate</span>
                <span>{((d.w[hover] / d.v[hover]) * 100).toFixed(1)}%</span>
              </div>
            )}
          </div>
        </div>

        <div className="flex min-w-0 flex-[1_1_320px] flex-col gap-3 px-4 py-3">
          <div className="flex flex-col gap-1.5">
            <span className="font-mono text-[11px] tracking-[1px] text-faint">FUNNEL · VISIT TO TRANSACTION</span>
            {funnel.map(([l, x], i) => {
              const p = `${((x / d.tv) * 100).toFixed(1)}%`
              return (
                <div key={l} className="grid grid-cols-[96px_minmax(0,1fr)_46px] items-center gap-2">
                  <span className="text-[12px] text-ink-2">{l}</span>
                  <span className="h-3.5 overflow-hidden rounded-[4px] bg-grid">
                    <span className="block h-full rounded-[4px]" style={{ width: p, background: i === 0 ? '#2a3542' : `rgba(217,181,99,${0.4 + i * 0.2})`, transition: `width .7s ${EASE}` }} />
                  </span>
                  <span className="text-right font-mono text-[11px]">{p}</span>
                </div>
              )
            })}
          </div>

          <div className="flex items-center gap-3.5" onMouseLeave={() => setChain(null)}>
            <svg role="img" aria-label="Wallet connections by chain" viewBox="0 0 100 100" className="size-20 flex-none -rotate-90">
              <circle cx="50" cy="50" r="38" fill="none" stroke="#1c2531" strokeWidth="12" />
              {ring.map((c) => (
                <circle
                  key={c.l}
                  cx="50"
                  cy="50"
                  r="38"
                  fill="none"
                  stroke={c.c}
                  strokeWidth={chain === c.i ? 16 : 12}
                  pathLength={100}
                  strokeDasharray={`${c.p - 1.5} ${101.5 - c.p}`}
                  strokeDashoffset={c.off}
                  onMouseEnter={() => setChain(c.i)}
                  style={{ transition: 'stroke-dasharray .7s, stroke-width .15s' }}
                />
              ))}
            </svg>
            <ul className="m-0 grid flex-1 list-none grid-cols-1 gap-0 p-0 text-[12px]">
              {ring.map((c) => (
                <li key={c.l}>
                  <button
                    type="button"
                    aria-pressed={chain === c.i}
                    onMouseEnter={() => setChain(c.i)}
                    onFocus={() => setChain(c.i)}
                    onBlur={() => setChain(null)}
                    onClick={() => setChain((x) => (x === c.i ? null : c.i))}
                    className={`grid min-h-[26px] w-full grid-cols-[8px_1fr_auto] items-center gap-2 rounded-[4px] px-1 text-left max-lg:min-h-11 ${chain === null || chain === c.i ? 'text-ink' : 'text-faint'}`}
                  >
                    <span aria-hidden className="size-2 rounded-[2px]" style={{ background: c.c }} />
                    <span className="inline-flex items-center gap-1.5">
                      <ChainLogo chain={c.l} size={16} decorative />
                      {c.l}
                    </span>
                    <span className="font-mono text-[11px]">{c.p}%</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>

          <div className="flex flex-col gap-1">
            <span className="font-mono text-[11px] tracking-[1px] text-faint">TOP PAGES</span>
            {PAGES.map(([path, share]) => (
              <div key={path} className="relative flex justify-between px-2 py-[3px] font-mono text-[12px]">
                <span aria-hidden className="absolute inset-y-0 left-0 rounded-[4px] bg-[rgba(217,181,99,.08)]" style={{ width: `${share * 100}%` }} />
                <span className="relative">{path}</span>
                <span className="relative text-muted">{fmt(Math.round(d.tv * 0.4 * share))}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Footer: the real product facts */}
      <div className="flex flex-wrap items-center justify-between gap-x-4 border-t border-line px-4 font-mono text-[11px] text-faint">
        <span>
          Cookie-free · built on Umami · one tag with <code className="text-ink-2">data-web3=&quot;true&quot;</code>
        </span>
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
          {plans.k === 'ok' && offer ? (
            <span>
              {offer.trialDays}-day free trial
              {paid.map((p) => ` · ${p.name} $${p.priceUsdc}: ${p.sites} sites, ${compact(p.eventsPerMonth)} events/mo`)}
              {` per ${offer.periodDays} days`}
            </span>
          ) : plans.k === 'error' ? (
            <button type="button" onClick={retry} className="min-h-11 text-ink-2 underline underline-offset-4">
              Plans could not be read. Retry
            </button>
          ) : (
            <span>Reading plans…</span>
          )}
          <a
            href={ANALYTICS_SIGNUP}
            {...(SIGNUP_EXT ? newTab : {})}
            onClick={() => {
              track('cta-click', { cta: 'analytics-trial', page: location.pathname })
              track('launch-app', { from: 'demo-analytics' })
            }}
            className="inline-flex min-h-11 items-center gap-1 text-gold hover:text-gold-hover"
          >
            Start free trial {SIGNUP_EXT ? <NewTabMark size={12} className="flex-none" /> : <ArrowRight size={12} aria-hidden />}
          </a>
        </span>
      </div>
    </div>
  )
}
