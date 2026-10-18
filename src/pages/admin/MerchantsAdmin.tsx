import { useCallback, useEffect, useMemo, useState } from 'react'
import { AnimatedNumber } from '../../components/charts/AnimatedNumber'
import { ChartBox } from '../../components/charts/ChartSkeleton'
import { EChart } from '../../components/charts/EChart'
import { axisTooltip, barsPreset, C, linePreset, tipHtml } from '../../components/charts/chartPresets'
import { NF } from '../../components/charts/number-formats'
import { toastError, toastSuccess } from '../../components/ui/toast'
import { adminCall } from './payAdmin'

/* Admin: Gully Pay for merchants (GET /api/admin/merchants). Every store with its volume, fees accrued,
   paid, open and overdue, and whether its checkout is paused; daily volume and fees across all stores;
   and "Run statements now" (the Monday run, on demand). Read from server/merchants.mjs. */

interface Row {
  workspace: string
  name: string
  chains: string[]
  links: number
  invoices: number
  payments: number
  volumeUsd: number
  volume30dUsd: number
  feesAccruedUsd: number
  feesUnbilledUsd: number
  feesPaidUsd: number
  feesOpenUsd: number
  feesOverdueUsd: number
  paused: boolean
  lastPaymentAt: string | null
}
interface View {
  config: { feeBps: number; freeUsd: number; pauseAfterDays: number; minStatementUsd: number; lastStatementRun: string | null; nextStatementAt: string }
  totals: { merchants: number; paused: number; volumeUsd: number; volume30dUsd: number; feesAccruedUsd: number; feesPaidUsd: number; feesOverdueUsd: number; feesUnbilledUsd: number }
  series: { dates: string[]; volume: number[]; fees: number[] }
  merchants: Row[]
}

const card = 'flex min-w-0 flex-col gap-4 rounded-card border border-line bg-surface p-6 max-[600px]:p-4'
const h2 = 'm-0 font-display text-[22px] font-bold uppercase'
const small = 'font-mono text-[12px] text-faint'
const usd = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD' })
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`
const day = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })

export function MerchantsAdmin({ token }: { token: string }) {
  const [data, setData] = useState<View | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const load = useCallback(() => {
    adminCall<View>(token, '/api/admin/merchants').then((r) => (r.ok ? (setData(r.data), setErr(null)) : setErr(r.error)))
  }, [token])
  useEffect(() => {
    load()
    const id = setInterval(load, 60_000)
    return () => clearInterval(id)
  }, [load])

  const option = useMemo(() => {
    if (!data) return null
    const s = data.series
    return {
      grid: { left: 8, right: 8, top: 26, bottom: 4, containLabel: true },
      legend: { top: 0, left: 0, textStyle: { color: C.muted, fontSize: 11 }, itemWidth: 10, itemHeight: 10 },
      tooltip: axisTooltip((ps: { dataIndex: number }[]) => {
        const i = ps[0]?.dataIndex ?? 0
        return tipHtml({ title: day(s.dates[i]), rows: [{ name: 'Store volume', value: usd(s.volume[i]), color: '#5aa9e6' }, { name: 'Fees accrued', value: usd(s.fees[i]), color: C.gold }] })
      }, 'shadow'),
      xAxis: { type: 'category', data: s.dates.map(day), axisTick: { show: false }, axisLabel: { color: C.faint, fontSize: 10, hideOverlap: true }, axisLine: { lineStyle: { color: C.line } } },
      yAxis: [
        { type: 'value', axisLabel: { color: C.faint, fontSize: 10, formatter: (v: number) => `$${v}` }, splitLine: { lineStyle: { color: C.grid } } },
        { type: 'value', axisLabel: { color: C.faint, fontSize: 10, formatter: (v: number) => `$${v}` }, splitLine: { show: false } },
      ],
      series: [
        { id: 'vol', name: 'Store volume', ...barsPreset({ stagger: 12 }), color: '#5aa9e6', barMaxWidth: 14, data: s.volume },
        { id: 'fee', name: 'Fees accrued', ...linePreset({ color: C.gold }), yAxisIndex: 1, data: s.fees },
      ],
    }
  }, [data])

  const run = async () => {
    setBusy(true)
    const r = await adminCall<{ issued: unknown[] }>(token, '/api/admin/merchants/statements/run', {})
    setBusy(false)
    if (!r.ok) return toastError('Statements not run', { detail: r.error })
    toastSuccess(`${r.data.issued.length} statement${r.data.issued.length === 1 ? '' : 's'} issued`)
    load()
  }

  const t = data?.totals
  return (
    <section className={card} aria-labelledby="admin-merchants">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="admin-merchants" className={h2}>
          Gully Pay merchants
        </h2>
        <span className={small}>{data ? `${data.config.feeBps / 100}% after $${data.config.freeUsd.toLocaleString('en-US')} free · pause after ${data.config.pauseAfterDays} days · next run ${new Date(data.config.nextStatementAt).toUTCString().slice(0, 16)}` : 'stores, volume and fees'}</span>
      </div>
      {err && <p className="m-0 font-mono text-[12px] text-error">{err}</p>}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        {(
          [
            ['Stores', t?.merchants ?? null, NF.int],
            ['Volume, 30 days', t?.volume30dUsd ?? null, NF.usd],
            ['Fees accrued', t?.feesAccruedUsd ?? null, NF.usd],
            ['Fees paid', t?.feesPaidUsd ?? null, NF.usd],
            ['Fees overdue', t?.feesOverdueUsd ?? null, NF.usd],
          ] as const
        ).map(([k, v, f]) => (
          <div key={k} className="flex flex-col gap-1 rounded-input border border-line bg-bg px-4 py-3">
            <span className="text-[12px] text-dim">{k}</span>
            <span className={`font-display text-[24px] leading-none font-extrabold ${k === 'Fees overdue' && (v ?? 0) > 0 ? 'text-error' : 'text-ink'}`}>
              <AnimatedNumber value={v} format={f} countUp />
            </span>
          </div>
        ))}
      </div>
      {option ? <EChart option={option} height={200} label="Daily store volume and fees accrued across all merchants, last 30 days" steps={{ count: 30 }} /> : <ChartBox height={200} state={err ? 'error' : 'loading'} onRetry={load} />}
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={run} disabled={busy} className="inline-flex min-h-11 items-center rounded-btn border border-line-strong px-4 text-[14px] text-ink-2 hover:border-gold hover:text-ink disabled:opacity-50">
          Run statements now
        </button>
        <span className={small}>Normally every Monday 00:00 UTC. Cancelling a statement's invoice above waives it.</span>
      </div>
      {data && !data.merchants.length && <p className="m-0 text-[14px] text-muted">No store yet. Workspaces open one from the Merchant tab of the app dashboard.</p>}
      {data && data.merchants.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] border-collapse text-[13px]">
            <thead>
              <tr className="border-b border-line text-left font-mono text-[11px] tracking-[1px] text-faint">
                <th className="py-2 pr-3 font-medium">STORE</th>
                <th className="py-2 pr-3 font-medium">CHAINS</th>
                <th className="py-2 pr-3 font-medium">PAYMENTS</th>
                <th className="py-2 pr-3 font-medium">VOLUME</th>
                <th className="py-2 pr-3 font-medium">ACCRUED</th>
                <th className="py-2 pr-3 font-medium">UNBILLED</th>
                <th className="py-2 pr-3 font-medium">PAID</th>
                <th className="py-2 pr-3 font-medium">OPEN</th>
                <th className="py-2 pr-3 font-medium">OVERDUE</th>
                <th className="py-2 font-medium">CHECKOUT</th>
              </tr>
            </thead>
            <tbody>
              {data.merchants.map((m) => (
                <tr key={m.workspace} className="border-b border-line last:border-0">
                  <td className="py-2 pr-3">
                    <span className="flex flex-col">
                      <b className="font-medium text-ink">{m.name}</b>
                      <span className="font-mono text-[11px] text-faint" title={m.workspace}>
                        {short(m.workspace)} · {m.links} links · {m.invoices} invoices
                      </span>
                    </span>
                  </td>
                  <td className="py-2 pr-3 text-muted">{m.chains.join(', ') || '—'}</td>
                  <td className="py-2 pr-3 font-mono text-ink-2">{m.payments}</td>
                  <td className="py-2 pr-3 font-mono text-ink-2">
                    {usd(m.volumeUsd)}
                    <span className="block text-[11px] text-faint">{usd(m.volume30dUsd)} / 30d</span>
                  </td>
                  <td className="py-2 pr-3 font-mono text-ink-2">{usd(m.feesAccruedUsd)}</td>
                  <td className="py-2 pr-3 font-mono text-muted">{usd(m.feesUnbilledUsd)}</td>
                  <td className="py-2 pr-3 font-mono text-green">{usd(m.feesPaidUsd)}</td>
                  <td className="py-2 pr-3 font-mono text-ink-2">{usd(m.feesOpenUsd)}</td>
                  <td className={`py-2 pr-3 font-mono ${m.feesOverdueUsd > 0 ? 'text-error' : 'text-muted'}`}>{usd(m.feesOverdueUsd)}</td>
                  <td className="py-2">
                    <span className={`inline-flex rounded-full border px-2 font-mono text-[11px] ${m.paused ? 'border-[#5a2a24] text-error' : 'border-success-line text-green'}`}>{m.paused ? 'paused' : 'live'}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
