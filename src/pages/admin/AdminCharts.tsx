import { useEffect, useState } from 'react'
import { AnimatedNumber } from '../../components/charts/AnimatedNumber'
import { ChartBox } from '../../components/charts/ChartSkeleton'
import { alpha, C, PALETTE } from '../../components/charts/chartPresets'
import { GhostChart } from '../../components/charts/GhostChart'
import { useLiveSeries } from '../../components/charts/useLiveSeries'
import { NF } from '../../components/charts/number-formats'
import { ChainLogo } from '../../components/logos/ChainLogo'
import { TokenLogo } from '../../components/logos/TokenLogo'
import { fmtUsd, GHOST_H, known, sum } from './chartFmt'
import { Daily, type Line } from './DailyChart'

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
  return <GhostChart label="Not tracked yet" height={GHOST_H} variant="line" testId="admin-ghost">
    <span className="max-w-[340px] text-[12px] leading-[1.5] text-muted">{text}</span>
  </GhostChart>
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
  const [split, setSplit] = useState<'asset' | 'chain' | 'kind'>('asset')

  /* Polls every 60 s (the page says so) and pauses while the tab is hidden; each reply merges into the
     charts, which glide to the new values. A new range refetches at once. */
  const { data: got, error, refresh } = useLiveSeries(async (signal) => {
    const r = await fetch(`/api/admin/charts?days=${days}`, { headers: { authorization: `Bearer ${token}` }, signal })
    const d = await r.json().catch(() => null)
    if (!r.ok) throw new Error(d?.error ?? 'The server could not be reached.')
    return { d: d as AdminChartsData }
  }, 60_000)
  useEffect(() => refresh(), [days, refresh])
  const data = got?.d ?? null
  const err = error ? (error instanceof Error ? error.message : 'The server could not be reached.') : null
  const load = () => refresh()

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
          <button type="button" onClick={load} className="min-h-11 rounded-btn border border-line-strong px-3 text-ink-2 hover:border-gold">
            Try again
          </button>
        </p>
      )}
      {!data ? (
        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,420px),1fr))] gap-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className={card}>
              <span className="h-5 w-40 animate-pulse rounded bg-surface-deep" />
              <ChartBox height={200} state={err ? 'error' : 'loading'} message={err ? 'Not read yet.' : undefined} onRetry={load} />
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

  return (
    <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,420px),1fr))] items-start gap-4">
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
          <Daily days={d} lines={revLines} fmt={fmtUsd} label={`Revenue per day by ${split}, ${fmtUsd(sum(data.revenue.usd) ?? 0)} in total`} empty="Revenue will draw here" />
        ) : (
          <Daily days={d} lines={[{ name: 'Revenue', data: data.revenue.usd, color: C.gold }]} fmt={fmtUsd} label="Revenue per day: no payments in this range" empty="Revenue will draw here" />
        )}
        {split !== 'kind' && revLines.length > 0 && (sum(data.revenue.usd) ?? 0) > 0 && (
          <ul className="m-0 flex list-none flex-wrap gap-2 p-0" aria-label={split === 'asset' ? 'Assets paid in' : 'Chains paid on'}>
            {revLines.map((l) => (
              <li key={l.name} className="flex items-center gap-1.5 rounded-full border border-line px-2.5 py-1 font-mono text-[12px] text-ink">
                {split === 'asset' ? <TokenLogo symbol={l.name} size={16} decorative /> : <ChainLogo chain={l.name} size={16} decorative />}
                {l.name}
              </li>
            ))}
          </ul>
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
          empty="New accounts will draw here"
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
            empty="API calls will draw here"
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
          empty="Alerts fired will draw here"
        />
      </section>

      <section className={card}>
        <Head title="Gully AI questions" figure={<AnimatedNumber value={ask ? sum(Object.values(ask).flat()) : null} fallback="not tracked yet" />} note={data.ask.note} />
        {ask ? (
          <Daily days={d} lines={[...colored(ask), ...(data.ask.unanswered ? [{ name: 'Not answered', data: data.ask.unanswered, color: C.error, kind: 'line' as const }] : [])]} label="Gully AI questions per day by channel" empty="Gully AI questions will draw here" />
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
          empty="Pay-link payments will draw here"
        />
      </section>

      <section className={card}>
        <Head title="Webhook delivery" figure={<AnimatedNumber value={wh.rateOverall} suffix={wh.rateOverall === null ? undefined : '%'} format={{ maximumFractionDigits: 1 }} fallback="not tracked yet" />} note={wh.note} />
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
          empty="Webhook deliveries will draw here"
        />
      </section>
    </div>
  )
}
