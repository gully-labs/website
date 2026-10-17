import { useCallback, useEffect, useMemo, useState } from 'react'
import { AnimatedNumber } from '../../components/charts/AnimatedNumber'
import { ChartBox } from '../../components/charts/ChartSkeleton'
import { EChart } from '../../components/charts/EChart'
import type { ChartEvent } from '../../components/charts/chart-utils'
import { alpha, axisTooltip, barsPreset, C, linePreset, PALETTE, tipHtml } from '../../components/charts/chartPresets'
import { NF } from '../../components/charts/number-formats'
import { adminCall } from './payAdmin'

/* The admin dashboard's live charts, from GET /api/admin/charts (server/admin-charts.mjs): revenue by
   asset or chain, new accounts, API calls, alerts fired, Gully AI questions, pay-link payments and
   webhook delivery success. Refreshed every 60 seconds; each refresh merges into the live charts, so
   bars and lines glide to their new values. A day the server did not record is drawn as a gap and
   reads "not tracked yet" in the tooltip, never 0; a series the server does not record at all says so
   in place of its chart. Loaded on demand (AdminPage lazy-loads this file and ECharts with it). */

type Num = number | null
type Series = Record<string, Num[]>

export interface AdminChartsData {
  generatedAt: string
  days: string[]
  revenue: { usd: number[]; payments: number[]; byAsset: Series; byChain: Series; byKind: Series; unpriced: number; note: string }
  accounts: { wallets: number[]; analytics: number[] }
  api: { anonymous: Num[]; keyed: Num[]; limited: Num[]; since: string | null; note: string }
  alerts: { gap: number[]; launch: number[]; telegram: number[]; webhook: number[]; note: string }
  ask: { byChannel: Series | null; unanswered: number[] | null; note: string }
  payLinks: { payments: number[]; usd: number[]; links: number }
  webhooks: { pay: { delivered: number[]; failed: number[]; pending: number[] }; alerts: { delivered: number[]; failed: number[] }; rate: Num[]; rateOverall: number | null; note: string }
}

const RANGES = [7, 30, 90] as const
const card = 'flex min-w-0 flex-col gap-3 rounded-card border border-line bg-surface p-5'
const h3 = 'm-0 font-display text-[19px] leading-none font-bold uppercase'
const small = 'font-mono text-[11px] text-faint'

const dayLabel = (d: string) => new Date(d + 'T00:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
const sum = (a: Num[] | null | undefined) => (a ? a.reduce<number>((x, y) => x + (y ?? 0), 0) : null)
const known = (a: Num[]) => a.some((v) => v !== null)
const fmtInt = (n: number) => n.toLocaleString('en-US')
const fmtUsd = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 })

interface Line {
  name: string
  data: Num[]
  color: string
  kind?: 'bar' | 'line'
  /** Line on a second (right) axis, e.g. a rate or dollars next to counts. */
  right?: boolean
}

/** Daily stacked bars (and optional lines) sharing one tooltip, with "not tracked yet" for null days. */
function Daily({ days, lines, height = 200, fmt = fmtInt, fmtRight, label }: { days: string[]; lines: Line[]; height?: number; fmt?: (n: number) => string; fmtRight?: (n: number) => string; label: string }) {
  const hasRight = lines.some((l) => l.right)
  const key = JSON.stringify([days, lines.map((l) => [l.name, l.data, l.kind, l.right])])
  const option = useMemo(
    () => ({
      grid: { left: 4, right: hasRight ? 8 : 4, top: 14, bottom: 4, containLabel: true },
      legend: lines.length > 1 ? { show: false } : undefined,
      xAxis: { type: 'category', data: days.map(dayLabel), axisTick: { show: false }, axisLine: { lineStyle: { color: C.lineStrong } }, axisLabel: { color: C.axis, fontSize: 10, hideOverlap: true } },
      yAxis: [
        { type: 'value', minInterval: 1, splitLine: { lineStyle: { color: C.grid } }, axisLabel: { color: C.axis, fontSize: 10, formatter: (v: number) => (fmt === fmtUsd ? `$${v}` : String(v)) } },
        ...(hasRight ? [{ type: 'value', splitLine: { show: false }, axisLabel: { color: C.axis, fontSize: 10, formatter: (v: number) => (fmtRight ? fmtRight(v) : String(v)) } }] : []),
      ],
      tooltip: axisTooltip((ps: ChartEvent[]) => {
        const i = ps[0]?.dataIndex ?? -1
        if (i < 0) return ''
        return tipHtml({
          title: dayLabel(days[i]),
          rows: lines.map((l) => {
            const v = l.data[i]
            return { name: l.name, value: v === null || v === undefined ? 'not tracked yet' : l.right && fmtRight ? fmtRight(v) : fmt(v), color: l.color }
          }),
        })
      }, 'shadow'),
      series: lines.map((l, j) =>
        l.kind === 'line'
          ? { id: `s${j}`, name: l.name, ...linePreset({ color: l.color, width: 2 }), showSymbol: true, symbolSize: 5, connectNulls: false, yAxisIndex: l.right ? 1 : 0, data: l.data }
          : { id: `s${j}`, name: l.name, ...barsPreset({ stagger: 18, focus: 'series' }), stack: 'all', barMaxWidth: 22, itemStyle: { color: l.color, borderRadius: j === lines.filter((x) => x.kind !== 'line').length - 1 ? [3, 3, 0, 0] : 0 }, data: l.data },
      ),
    }),
    // `key` holds the days and every series' values
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key],
  )
  return (
    <>
      <EChart option={option} height={height} steps={{ count: days.length }} label={`${label}. Arrow keys step through the days.`} />
      {lines.length > 1 && (
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          {lines.map((l) => (
            <span key={l.name} className="inline-flex items-center gap-2 font-mono text-[11px] text-muted">
              <i className={`inline-block ${l.kind === 'line' ? 'h-[2px] w-3' : 'size-[9px] rounded-[2px]'}`} style={{ background: l.color }} />
              {l.name}
            </span>
          ))}
        </div>
      )}
    </>
  )
}

function Head({ title, figure, note }: { title: string; figure?: React.ReactNode; note?: string }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-2">
      <div className="flex min-w-0 flex-col gap-1">
        <h3 className={h3}>{title}</h3>
        {note && <span className={small}>{note}</span>}
      </div>
      {figure !== undefined && <span className="font-display text-[28px] leading-none font-extrabold text-ink">{figure}</span>}
    </div>
  )
}

function NotTracked({ text }: { text: string }) {
  return (
    <div className="relative flex h-[200px] items-center justify-center overflow-hidden rounded-input border border-dashed border-line-strong bg-bg px-6 text-center">
      <span aria-hidden className="absolute top-4 left-4 inline-flex items-center gap-2 font-mono text-[11px] text-faint">
        <i className="size-2 animate-pulse rounded-full bg-gold" /> waiting for data
      </span>
      <span className="max-w-[340px] text-[13px] leading-[1.6] text-muted">Not tracked yet. {text}</span>
    </div>
  )
}

function Toggle<T extends string>({ value, options, onChange, label }: { value: T; options: { id: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <span role="group" aria-label={label} className="flex flex-wrap gap-1 rounded-input border border-line bg-bg p-1">
      {options.map((o) => (
        <button key={o.id} type="button" aria-pressed={value === o.id} onClick={() => onChange(o.id)} className={`min-h-11 rounded-btn px-3 font-mono text-[12px] transition-colors ${value === o.id ? 'bg-gold text-bg' : 'bg-transparent text-muted hover:text-ink'}`}>
          {o.label}
        </button>
      ))}
    </span>
  )
}

const colored = (s: Series, offset = 0): Line[] =>
  Object.entries(s)
    .sort((a, b) => (sum(b[1]) ?? 0) - (sum(a[1]) ?? 0))
    .map(([name, data], i) => ({ name, data, color: PALETTE[(i + offset) % PALETTE.length] }))

export default function AdminCharts({ token }: { token: string }) {
  const [days, setDays] = useState<(typeof RANGES)[number]>(30)
  const [data, setData] = useState<AdminChartsData | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [split, setSplit] = useState<'asset' | 'chain' | 'kind'>('asset')

  const load = useCallback(async () => {
    const r = await adminCall<AdminChartsData>(token, `/api/admin/charts?days=${days}`)
    if (r.ok) {
      setData(r.data)
      setErr(null)
    } else setErr(r.error)
  }, [token, days])
  useEffect(() => {
    let alive = true
    const tick = () => alive && load()
    tick()
    const id = setInterval(tick, 60_000)
    return () => {
      alive = false
      clearInterval(id)
    }
  }, [load])

  return (
    <section className="flex flex-col gap-4" aria-label="Live charts">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="m-0 font-display text-[22px] font-bold uppercase">Live charts</h2>
          <span className={small}>
            <i className="mr-2 inline-block size-2 animate-pulse rounded-full bg-green align-middle" />
            {data ? `read ${new Date(data.generatedAt).toISOString().slice(11, 19)} UTC · refreshes every minute` : 'reading…'}
          </span>
        </div>
        <Toggle label="Range" value={String(days) as '7' | '30' | '90'} options={RANGES.map((r) => ({ id: String(r) as '7' | '30' | '90', label: `${r}D` }))} onChange={(v) => setDays(Number(v) as (typeof RANGES)[number])} />
      </div>
      {err && (
        <p className="m-0 flex flex-wrap items-center gap-3 rounded-input border border-error/40 px-4 py-3 font-mono text-[12px] text-error" role="alert">
          The charts could not be read: {err}
          <button type="button" onClick={() => load()} className="min-h-11 rounded-btn border border-line-strong px-3 text-ink-2 hover:border-gold">
            Try again
          </button>
        </p>
      )}
      {!data ? (
        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,420px),1fr))] gap-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className={card}>
              <span className="h-5 w-40 animate-pulse rounded bg-surface-deep" />
              <ChartBox height={200} state={err ? 'error' : 'loading'} message={err ? 'Not read yet.' : undefined} onRetry={() => load()} />
            </div>
          ))}
        </div>
      ) : (
        <Charts data={data} split={split} setSplit={setSplit} />
      )}
    </section>
  )
}

function Charts({ data, split, setSplit }: { data: AdminChartsData; split: 'asset' | 'chain' | 'kind'; setSplit: (s: 'asset' | 'chain' | 'kind') => void }) {
  const d = data.days
  const rev = split === 'asset' ? data.revenue.byAsset : split === 'chain' ? data.revenue.byChain : data.revenue.byKind
  const revLines = colored(rev)
  const apiKnown = known(data.api.anonymous)
  const ask = data.ask.byChannel
  const wh = data.webhooks
  const whFinished = (sum(wh.pay.delivered) ?? 0) + (sum(wh.pay.failed) ?? 0) + (sum(wh.alerts.delivered) ?? 0) + (sum(wh.alerts.failed) ?? 0)

  return (
    <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,420px),1fr))] gap-4">
      <section className={card}>
        <Head title="Revenue" figure={<AnimatedNumber value={sum(data.revenue.usd)} format={NF.usd} />} note={`${sum(data.revenue.payments)} payments in ${d.length} days${data.revenue.unpriced ? ` · ${data.revenue.unpriced} without a USD price` : ''}`} />
        <Toggle
          label="Split revenue by"
          value={split}
          options={[
            { id: 'asset', label: 'By asset' },
            { id: 'chain', label: 'By chain' },
            { id: 'kind', label: 'By product' },
          ]}
          onChange={setSplit}
        />
        {revLines.length ? (
          <Daily days={d} lines={revLines} fmt={fmtUsd} label={`Revenue per day by ${split}, ${fmtUsd(sum(data.revenue.usd) ?? 0)} in total`} />
        ) : (
          <Daily days={d} lines={[{ name: 'Revenue', data: data.revenue.usd, color: C.gold }]} fmt={fmtUsd} label="Revenue per day: no payments in this range" />
        )}
        <span className={small}>{data.revenue.note}</span>
      </section>

      <section className={card}>
        <Head title="New accounts" figure={<AnimatedNumber value={(sum(data.accounts.wallets) ?? 0) + (sum(data.accounts.analytics) ?? 0)} />} note="wallets signing in for the first time, and Gully Analytics trials started" />
        <Daily
          days={d}
          lines={[
            { name: 'Wallet accounts', data: data.accounts.wallets, color: C.gold },
            { name: 'Analytics accounts', data: data.accounts.analytics, color: PALETTE[1] },
          ]}
          label="New accounts per day"
        />
      </section>

      <section className={card}>
        <Head title="API calls" figure={<AnimatedNumber value={apiKnown ? (sum(data.api.anonymous) ?? 0) + (sum(data.api.keyed) ?? 0) : null} fallback="not tracked yet" />} note={data.api.note} />
        {apiKnown ? (
          <Daily
            days={d}
            lines={[
              { name: 'Anonymous', data: data.api.anonymous, color: C.muted },
              { name: 'With a key', data: data.api.keyed, color: C.gold },
              { name: 'Rate-limited', data: data.api.limited, color: PALETTE[4] },
            ]}
            label="API requests per day"
          />
        ) : (
          <NotTracked text="No request has reached the origin since usage counting began." />
        )}
      </section>

      <section className={card}>
        <Head title="Alerts fired" figure={<AnimatedNumber value={(sum(data.alerts.gap) ?? 0) + (sum(data.alerts.launch) ?? 0)} />} note={data.alerts.note} />
        <Daily
          days={d}
          lines={[
            { name: 'Gap alerts', data: data.alerts.gap, color: C.gold },
            { name: 'DeepCore launch alerts', data: data.alerts.launch, color: PALETTE[2] },
            { name: 'Telegram sends', data: data.alerts.telegram, color: PALETTE[1], kind: 'line' },
          ]}
          label="Alerts fired per day"
        />
      </section>

      <section className={card}>
        <Head title="Gully AI questions" figure={<AnimatedNumber value={ask ? sum(Object.values(ask).flat()) : null} fallback="not tracked yet" />} note={data.ask.note} />
        {ask ? (
          <Daily days={d} lines={[...colored(ask), ...(data.ask.unanswered ? [{ name: 'Not answered', data: data.ask.unanswered, color: C.error, kind: 'line' as const }] : [])]} label="Gully AI questions per day by channel" />
        ) : (
          <NotTracked text={data.ask.note} />
        )}
      </section>

      <section className={card}>
        <Head title="Pay-link payments" figure={<AnimatedNumber value={sum(data.payLinks.usd)} format={NF.usd} />} note={`${sum(data.payLinks.payments)} paid invoices from ${data.payLinks.links} pay link${data.payLinks.links === 1 ? '' : 's'}`} />
        <Daily
          days={d}
          lines={[
            { name: 'Payments', data: data.payLinks.payments, color: C.gold },
            { name: 'USD', data: data.payLinks.usd, color: PALETTE[2], kind: 'line', right: true },
          ]}
          fmtRight={fmtUsd}
          label="Pay-link payments per day, count and USD"
        />
      </section>

      <section className={card}>
        <Head title="Webhook delivery" figure={<AnimatedNumber value={wh.rateOverall} suffix={wh.rateOverall === null ? undefined : '%'} format={{ maximumFractionDigits: 1 }} fallback="not tracked yet" />} note={wh.note} />
        {whFinished ? (
          <Daily
            days={d}
            lines={[
              { name: 'Pay delivered', data: wh.pay.delivered, color: alpha(PALETTE[2], 0.9) },
              { name: 'Alert webhooks delivered', data: wh.alerts.delivered, color: PALETTE[1] },
              { name: 'Failed', data: wh.pay.failed.map((v, i) => v + wh.alerts.failed[i]), color: C.error },
              { name: 'Success rate', data: wh.rate, color: C.gold, kind: 'line', right: true },
            ]}
            fmtRight={(v) => `${v}%`}
            label={`Webhook deliveries per day and success rate, ${wh.rateOverall ?? 'no'} percent overall`}
          />
        ) : (
          <NotTracked text="No merchant or alert webhook has finished a delivery in this range." />
        )}
      </section>
    </div>
  )
}
