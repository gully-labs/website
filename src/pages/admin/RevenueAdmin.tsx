import type { CSSProperties } from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { LucideIcon } from 'lucide-react'
import {
  ArrowLeftRight,
  AtSign,
  ChevronDown,
  CircleDollarSign,
  CreditCard,
  FlaskConical,
  Fuel,
  Fingerprint,
  Globe,
  Heart,
  Landmark,
  Layers,
  ListChecks,
  Megaphone,
  RefreshCw,
  Repeat,
  Rocket,
  Route,
  Rows3,
  Server,
  ShieldCheck,
  Trophy,
  Waypoints,
} from 'lucide-react'
import { AnimatedNumber } from '../../components/charts/AnimatedNumber'
import { barsPreset, axisTooltip, tipHtml } from '../../components/charts/chartPresets'
import { EChart } from '../../components/charts/EChart'
import { MiniSpark } from '../../components/charts/MiniSpark'
import { NF } from '../../components/charts/number-formats'
import { useLiveSeries } from '../../components/charts/useLiveSeries'
import { toastError } from '../../components/ui/toast'
import { adminCall } from './payAdmin'
import { chip, ctl, pillCls } from './ui'

/* Revenue: what each Gully income line earns, side by side, from GET /api/admin/revenue (server/revenue.mjs). Mainnet
   and testnet stay in their own columns and totals; only mainnet is money. A line with no source says "not tracked
   yet" and what it needs, never a number. Refreshed every 60 seconds; charts glide to new values. Colours are the
   Gully Labs kit, set on this section's root so it reads on the kit before the rest of the admin moves over, and they
   are the same values the site tokens take then. The six series colours pass the dataviz validator on the navy surface
   (adjacent CVD ΔE 6.1, so the legend and direct labels carry identity as well). */

type Status = 'tracked' | 'partial' | 'not_tracked' | 'not_live' | 'not_billed' | 'error'
type Side = 'mainnet' | 'testnet'
type Range = '24h' | '7d' | '30d' | 'all'
type Group = 'trading' | 'launch' | 'creators' | 'bridge' | 'products' | 'chain'

interface Cell {
  status: Status
  usd: number | null
  count: number | null
  unpriced: number
  series: number[] | null
  source: string | null
  missing: string | null
  note: string | null
  parts: { name: string; usd: number; count: number }[] | null
}
interface Line {
  id: string
  name: string
  group: Group
  rate: string
  mainnet: Cell
  testnet: Cell
}
interface Holding {
  label: string
  chain: string
  address: string
  symbol: string
  native: number | null
  stableUsd: number | null
}
interface View {
  generatedAt: string
  range: Range
  buckets: number[]
  step: number
  totals: Record<Side, { usd: number; series: number[]; money: boolean; label: string; note?: string }>
  counts: Record<Side, Partial<Record<Status, number>>>
  lines: Line[]
  open: { id: string; name: string; status: Status; missing: string; sides: Side[] }[]
  treasuries: { mainnet: Holding[]; testnet: Holding[]; readAt: string | null }
}

const KIT = {
  '--color-bg': '#0b1730',
  '--color-surface': '#13233f',
  '--color-surface-hover': '#1a2c4d',
  '--color-line': '#22345a',
  '--color-line-strong': '#2f4470',
  '--color-line-hover': '#3f5789',
  '--color-ink': '#ffffff',
  '--color-ink-2': '#d6dce8',
  '--color-muted': '#c9d2e8',
  '--color-dim': '#aab6d0',
  '--color-faint': '#a9b5cf',
  '--color-gold': '#6f8ddf',
  '--color-gold-hover': '#9db4ee',
  '--color-gold-line': '#2f4470',
} as CSSProperties

const RANGES: Range[] = ['24h', '7d', '30d', 'all']
const RANGE_LABEL: Record<Range, string> = { '24h': '24 h', '7d': '7 d', '30d': '30 d', all: 'All' }
const GROUPS: { id: Group; label: string; color: string }[] = [
  { id: 'trading', label: 'Trading', color: '#6F8DDF' },
  { id: 'launch', label: 'Launches, names', color: '#BE8428' },
  { id: 'creators', label: 'Creators', color: '#D2568F' },
  { id: 'bridge', label: 'Bridge', color: '#2FA0B5' },
  { id: 'products', label: 'Products', color: '#9A72E0' },
  { id: 'chain', label: 'Chain gas', color: '#3C9F6E' },
]
const COLOR = Object.fromEntries(GROUPS.map((g) => [g.id, g.color])) as Record<Group, string>
const ICONS: Record<string, LucideIcon> = {
  kre8_trade: ArrowLeftRight,
  core_builder: Layers,
  swap_router: Repeat,
  launch_fees: Rocket,
  names: AtSign,
  ads: Megaphone,
  tips_members: Heart,
  quests: Trophy,
  hyperlane: Waypoints,
  integrator: Route,
  gully_id: Fingerprint,
  gully_rpc: Server,
  gully_pay: CreditCard,
  site_plans: Globe,
  multisig: ShieldCheck,
  chain_gas: Fuel,
}
const STATUS: Record<Status, { text: string; tone: string }> = {
  tracked: { text: 'live', tone: 'border-success-line text-green' },
  partial: { text: 'partial', tone: 'border-gold-line text-gold-hover' },
  not_tracked: { text: 'not tracked yet', tone: 'border-line-strong text-faint' },
  not_live: { text: 'not live', tone: 'border-line-strong text-faint' },
  not_billed: { text: 'not billed', tone: 'border-line-strong text-faint' },
  error: { text: 'source down', tone: 'border-error/40 text-error' },
}

const card = 'flex min-w-0 flex-col gap-3 rounded-card border border-line bg-surface p-4'
const h3 = 'm-0 flex items-center gap-2 font-display text-[15px] font-bold'
const small = 'font-mono text-[11px] text-faint'
const usdText = (v: number | null) => (v == null ? '—' : v === 0 ? '$0.00' : v < 0.01 ? '<$0.01' : `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`)
const num = (v: number) => v.toLocaleString('en-US', { maximumFractionDigits: 5 })
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`
const bucketLabel = (t: number, step: number) => new Date(t * 1000).toLocaleString('en-US', { month: 'short', day: 'numeric', ...(step < 86_400 ? { hour: '2-digit', hour12: false } : {}), timeZone: 'UTC' })

function Amount({ c, muted }: { c: Cell; muted?: boolean }) {
  if (c.usd == null) return <span className={`${pillCls(STATUS[c.status].tone)} whitespace-nowrap`}>{STATUS[c.status].text}</span>
  return (
    <span className="flex flex-col items-end gap-0.5 max-[760px]:items-start">
      <span className={`font-mono text-[13px] tabular-nums ${muted ? 'text-muted' : 'text-ink'}`}>{usdText(c.usd)}</span>
      {c.status === 'partial' && <span className={small}>partial</span>}
    </span>
  )
}

function StreamChart({ view, side }: { view: View; side: Side }) {
  const option = useMemo(() => {
    const labels = view.buckets.map((t) => bucketLabel(t, view.step))
    const byGroup = GROUPS.map((g) => {
      const data = view.buckets.map(() => 0)
      for (const l of view.lines) if (l.group === g.id) l[side].series?.forEach((v, i) => (data[i] += v))
      return { g, data }
    }).filter((s) => s.data.some((v) => v > 0))
    return {
      grid: { left: 52, right: 8, top: 10, bottom: 24 },
      tooltip: axisTooltip(
        // ECharts' axis params are loosely typed.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (p: any[]) => tipHtml({ title: p[0]?.axisValue, rows: p.filter((x) => x.value > 0).map((x) => ({ name: x.seriesName, value: usdText(x.value), color: x.color })), note: side === 'testnet' ? 'Test coins, not money.' : undefined }),
        'shadow',
      ),
      xAxis: { type: 'category', data: labels, axisTick: { show: false }, axisLabel: { hideOverlap: true } },
      yAxis: { type: 'value', splitNumber: 3, axisLabel: { formatter: (v: number) => usdText(v) } },
      series: byGroup.map(({ g, data }) => ({ ...barsPreset({ focus: 'series', radius: 2 }), id: g.id, name: g.label, stack: 'all', data, barMaxWidth: 18, itemStyle: { color: g.color, borderColor: '#13233f', borderWidth: 1, borderRadius: 2 } })),
    }
  }, [view, side])
  return <EChart option={option} height={210} label={`${side === 'mainnet' ? 'Mainnet income' : 'Testnet activity'} per period by stream`} replaceMerge={['series']} emptyLabel={side === 'mainnet' ? 'No mainnet income in this range' : 'No testnet activity in this range'} renderer="svg" />
}

function ShareBars({ lines, side }: { lines: Line[]; side: Side }) {
  const ranked = lines.filter((l) => (l[side].usd ?? 0) > 0).sort((a, b) => (b[side].usd ?? 0) - (a[side].usd ?? 0))
  const total = ranked.reduce((s, l) => s + (l[side].usd ?? 0), 0)
  if (!ranked.length) return <p className={`m-0 ${small}`}>Nothing earned in this range.</p>
  return (
    <ul className="m-0 flex list-none flex-col gap-2 p-0">
      {ranked.slice(0, 7).map((l) => {
        const pct = ((l[side].usd ?? 0) / total) * 100
        return (
          <li key={l.id} className="flex flex-col gap-1">
            <span className="flex items-baseline justify-between gap-2 text-[12px] text-ink-2">
              <span className="truncate">{l.name}</span>
              <span className="font-mono tabular-nums text-faint">{pct < 0.1 ? '<0.1' : pct.toFixed(1)}%</span>
            </span>
            <span className="block h-[6px] overflow-hidden rounded-full bg-bg">
              <span className="block h-full rounded-full transition-[width] duration-700 ease-out" style={{ width: `${Math.max(pct, 1)}%`, background: COLOR[l.group] }} />
            </span>
          </li>
        )
      })}
    </ul>
  )
}

function LineRow({ l, side, total, view }: { l: Line; side: Side; total: number; view: View }) {
  const [open, setOpen] = useState(false)
  const Icon = ICONS[l.id] ?? CircleDollarSign
  const c = l[side]
  const labels = useMemo(() => view.buckets.map((t) => bucketLabel(t, view.step)), [view.buckets, view.step])
  const share = c.usd != null && total > 0 ? (c.usd / total) * 100 : null
  return (
    <li className="border-t border-line first:border-t-0">
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="grid min-h-12 w-full grid-cols-[minmax(0,1.6fr)_124px_124px_minmax(90px,1fr)_56px_20px] items-center gap-3 px-1 py-1 text-left hover:bg-surface-hover max-[760px]:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_20px] max-[760px]:gap-x-2 max-[760px]:gap-y-1">
        <span className="flex min-w-0 items-center gap-2 max-[760px]:col-span-3">
          <span className="grid size-7 shrink-0 place-items-center rounded-full" style={{ background: `${COLOR[l.group]}26`, color: COLOR[l.group] }}>
            <Icon size={14} aria-hidden />
          </span>
          <span className="flex min-w-0 flex-col">
            <span className="truncate text-[13px] text-ink">{l.name}</span>
            <span className="truncate font-mono text-[11px] text-faint">{l.rate}</span>
          </span>
        </span>
        <span className="flex justify-end max-[760px]:flex-col max-[760px]:items-start max-[760px]:justify-start">
          <span className="hidden font-mono text-[11px] text-faint max-[760px]:inline">Mainnet</span>
          <Amount c={l.mainnet} />
        </span>
        <span className="flex justify-end max-[760px]:flex-col max-[760px]:items-start max-[760px]:justify-start">
          <span className="hidden font-mono text-[11px] text-faint max-[760px]:inline">Testnet, not money</span>
          <Amount c={l.testnet} muted />
        </span>
        <span className="max-[760px]:hidden">{c.series ? <MiniSpark data={c.series} labels={labels} label={`${l.name}, ${side}`} fmt={usdText} color={COLOR[l.group]} height={30} interactive={false} /> : <span className={small}>—</span>}</span>
        <span className="text-right font-mono text-[12px] tabular-nums text-faint max-[760px]:hidden">{share == null ? '—' : `${share < 0.1 && share > 0 ? '<0.1' : share.toFixed(1)}%`}</span>
        <ChevronDown size={14} aria-hidden className={`text-faint transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="grid gap-3 px-1 pb-3 pt-1 md:grid-cols-2">
          {(['mainnet', 'testnet'] as Side[]).map((s) => {
            const x = l[s]
            return (
              <div key={s} className="flex flex-col gap-1 text-[12px] text-ink-2">
                <span className={small}>
                  {s === 'mainnet' ? 'Mainnet' : 'Testnet, not money'} · {STATUS[x.status].text}
                  {x.count != null ? ` · ${x.count.toLocaleString('en-US')} payments` : ''}
                </span>
                {x.source && <span>{x.source}</span>}
                {x.missing && <span className="text-muted">{x.missing}</span>}
                {x.note && <span className="text-faint">{x.note}</span>}
                {x.unpriced > 0 && <span className="text-faint">{x.unpriced.toLocaleString('en-US')} paid in coins with no price, not valued.</span>}
                {x.parts && <span className="font-mono text-[11px] text-faint">{x.parts.map((p) => `${p.name} ${usdText(p.usd)} (${p.count})`).join(' · ')}</span>}
              </div>
            )
          })}
        </div>
      )}
    </li>
  )
}

function Holdings({ rows, side }: { rows: Holding[]; side: Side }) {
  if (!rows.length) return <p className={`m-0 ${small}`}>{side === 'mainnet' ? 'GULLY_TREASURY_ADDRESS is not set on this server.' : 'No receiver address read yet.'}</p>
  return (
    <ul className="m-0 flex list-none flex-col gap-1 p-0">
      {rows.map((h) => (
        <li key={`${h.chain}-${h.label}`} className="flex min-h-8 items-center justify-between gap-3 text-[12px]">
          <span className="flex min-w-0 flex-col">
            <span className="truncate text-ink-2">{h.label}</span>
            <span className="truncate font-mono text-[11px] text-faint">
              {h.chain} · {short(h.address)}
            </span>
          </span>
          <span className="flex shrink-0 flex-col items-end font-mono text-[12px] tabular-nums text-ink-2">
            <span>{h.native == null ? 'unread' : `${num(h.native)} ${h.symbol}`}</span>
            {h.stableUsd != null && h.stableUsd > 0 && <span className="text-faint">{usdText(h.stableUsd)} stables</span>}
          </span>
        </li>
      ))}
    </ul>
  )
}

function Tile({ icon: Icon, label, value, note, spark, color }: { icon: LucideIcon; label: string; value: number; note: string; spark: number[]; color: string }) {
  return (
    <div className={card}>
      <span className={`flex items-center gap-2 ${small}`}>
        <Icon size={14} aria-hidden />
        {label}
      </span>
      <span className="font-display text-[28px] leading-none font-extrabold text-ink">
        <AnimatedNumber value={value} format={NF.usd} />
      </span>
      <MiniSpark data={spark} label={label} fmt={usdText} color={color} height={34} interactive={false} />
      <span className={small}>{note}</span>
    </div>
  )
}

export default function RevenueAdmin({ token }: { token: string }) {
  const [range, setRange] = useState<Range>('7d')
  const [side, setSide] = useState<Side | null>(null)
  const [tab, setTab] = useState<'lines' | 'open' | 'held'>('lines')
  const fresh = useRef(false)
  const first = useRef(true)
  const live = useLiveSeries<View>(async () => {
    const r = await adminCall<View>(token, `/api/admin/revenue?range=${range}${fresh.current ? '&fresh=1' : ''}`)
    fresh.current = false
    if (!r.ok) throw new Error(r.error)
    return r.data
  }, 60_000)
  const { data: view, error, refresh, updatedAt } = live

  useEffect(() => {
    if (first.current) first.current = false
    else refresh()
  }, [range, refresh])

  useEffect(() => {
    if (error) toastError('Revenue did not refresh', { id: 'revenue-load', detail: error instanceof Error ? error.message : undefined })
  }, [error])

  const down = view?.lines.filter((l) => l.mainnet.status === 'error' || l.testnet.status === 'error').map((l) => l.name).join(', ')
  useEffect(() => {
    if (down) toastError('A revenue source did not answer', { id: `revenue-source-${down}`, detail: down })
  }, [down])

  if (!view) return <div style={KIT} className={`${card} ${small}`}>{error ? 'Revenue could not be read. Try Refresh.' : 'Reading the revenue sources…'}</div>

  const shown: Side = side ?? (view.totals.mainnet.usd > 0 ? 'mainnet' : 'testnet')
  const total = view.totals[shown].usd
  const counts = view.counts
  const withData = view.lines.filter((l) => l.mainnet.usd != null || l.testnet.usd != null).length
  const noSource = view.lines.length - withData
  const needs = view.open.filter((o) => o.status !== 'not_live')
  const waiting = view.open.filter((o) => o.status === 'not_live')

  return (
    <div style={KIT} className="flex min-w-0 flex-col gap-3 rounded-card bg-bg text-ink">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-col">
          <h2 className="m-0 font-display text-[22px] font-bold">Revenue</h2>
          <span className={small}>Updated {updatedAt ? new Date(updatedAt).toLocaleTimeString('en-GB', { timeZone: 'UTC' }) : '—'} UTC, every 60 s</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {RANGES.map((r) => (
            <button key={r} type="button" aria-pressed={r === range} onClick={() => setRange(r)} className={chip(r === range)}>
              {RANGE_LABEL[r]}
            </button>
          ))}
          <button
            type="button"
            className={ctl}
            onClick={() => {
              fresh.current = true
              refresh()
            }}
          >
            <RefreshCw size={15} aria-hidden />
            Refresh
          </button>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <Tile icon={Landmark} label="Mainnet income, real money" value={view.totals.mainnet.usd} spark={view.totals.mainnet.series} color={GROUPS[0].color} note={`${counts.mainnet.tracked ?? 0} live, ${counts.mainnet.partial ?? 0} partial`} />
        <Tile icon={FlaskConical} label="Testnet activity, not money" value={view.totals.testnet.usd} spark={view.totals.testnet.series} color={GROUPS[3].color} note={view.totals.testnet.note ?? ''} />
        <div className={card}>
          <span className={`flex items-center gap-2 ${small}`}>
            <ListChecks size={14} aria-hidden />
            Coverage
          </span>
          <span className="font-display text-[28px] leading-none font-extrabold text-ink">
            {withData} of {view.lines.length}
          </span>
          <span className="text-[12px] text-ink-2">lines read a real source.</span>
          <span className={small}>{noSource ? `${noSource} have no number yet. See Not tracked.` : 'Every line has a source.'}</span>
        </div>
      </div>

      <div role="group" aria-label="Network shown in the charts" className="flex flex-wrap gap-2">
        {(['mainnet', 'testnet'] as Side[]).map((s) => {
          const Icon = s === 'mainnet' ? Landmark : FlaskConical
          return (
            <button key={s} type="button" aria-pressed={s === shown} onClick={() => setSide(s)} className={chip(s === shown)}>
              <Icon size={15} aria-hidden />
              {s === 'mainnet' ? 'Mainnet' : 'Testnet, not money'}
            </button>
          )
        })}
      </div>

      <div className="grid gap-3 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <section className={card} aria-label="Income by stream">
          <h3 className={h3}>
            <CircleDollarSign size={16} aria-hidden />
            By stream
          </h3>
          <StreamChart view={view} side={shown} />
          <ul className="m-0 flex list-none flex-wrap gap-x-4 gap-y-1 p-0">
            {GROUPS.map((g) => (
              <li key={g.id} className="flex items-center gap-1.5 text-[12px] text-ink-2">
                <i className="size-2.5 rounded-full" style={{ background: g.color }} aria-hidden />
                {g.label}
              </li>
            ))}
          </ul>
        </section>
        <section className={card} aria-label="Share by line">
          <h3 className={h3}>
            <ListChecks size={16} aria-hidden />
            Share by line
          </h3>
          <ShareBars lines={view.lines} side={shown} />
        </section>
      </div>

      <div role="group" aria-label="Detail shown below" className="flex flex-wrap gap-2">
        {(
          [
            ['lines', Rows3, `Lines (${view.lines.length})`],
            ['open', ListChecks, `Not tracked (${needs.length})`],
            ['held', Landmark, 'Held now'],
          ] as const
        ).map(([id, Icon, label]) => (
          <button key={id} type="button" aria-pressed={tab === id} onClick={() => setTab(id)} className={chip(tab === id)}>
            <Icon size={15} aria-hidden />
            {label}
          </button>
        ))}
      </div>

      {tab === 'lines' && (
        <section className={card} aria-label="Income lines">
          <div className="grid grid-cols-[minmax(0,1.6fr)_124px_124px_minmax(90px,1fr)_56px_20px] gap-3 px-1 font-mono text-[11px] text-faint max-[760px]:hidden">
            <span>Line</span>
            <span className="text-right">Mainnet</span>
            <span className="whitespace-nowrap text-right">Testnet, not money</span>
            <span>Trend</span>
            <span className="text-right">Share</span>
            <span />
          </div>
          <ul className="m-0 list-none p-0">
            {view.lines.map((l) => (
              <LineRow key={l.id} l={l} side={shown} total={total} view={view} />
            ))}
          </ul>
        </section>
      )}

      {tab === 'open' && (
        <section className={card} aria-label="Not tracked yet">
          <ul className="m-0 grid list-none gap-x-5 gap-y-2 p-0 md:grid-cols-2">
            {needs.map((o) => {
              const Icon = ICONS[o.id] ?? CircleDollarSign
              return (
                <li key={`${o.id}-${o.missing}`} className="flex gap-2 text-[12px] text-ink-2">
                  <Icon size={14} aria-hidden className="mt-0.5 shrink-0 text-faint" />
                  <span className="min-w-0">
                    <b className="font-medium text-ink">{o.name}</b> <span className={small}>{o.sides.length === 2 ? 'both sides' : o.sides[0]}</span>
                    <br />
                    {o.missing}
                  </span>
                </li>
              )
            })}
          </ul>
          {waiting.length > 0 && (
            <p className="m-0 border-t border-line pt-2 text-[12px] text-faint">
              Not live on mainnet yet, so nothing to read: {waiting.map((o) => o.name).join(', ')}. Open a line for its reason.
            </p>
          )}
        </section>
      )}

      {tab === 'held' && (
        <section className={card} aria-label="Balances held now">
          <h3 className={h3}>
            <Landmark size={16} aria-hidden />
            Held now
          </h3>
          <span className={small}>Balances at the fee receivers. Not income, and not in any total.</span>
          <Holdings rows={view.treasuries[shown]} side={shown} />
        </section>
      )}
    </div>
  )
}
