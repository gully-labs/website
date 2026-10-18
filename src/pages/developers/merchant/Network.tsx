import { Fuel } from 'lucide-react'
import { useMemo } from 'react'
import { ChartBox } from '../../../components/charts/ChartSkeleton'
import { EChart } from '../../../components/charts/EChart'
import { axisTooltip, barsPreset, C, tipHtml } from '../../../components/charts/chartPresets'
import { ChainLogo } from '../../../components/logos/ChainLogo'
import type { GasView } from '../api'
import { usePoll } from '../poll'
import { RefreshChip } from '../ui'
import type { MerchantView } from './api'

/* The Payments tab's NETWORK · LIVE strip: what a Gully Pay payment costs in gas right now on each chain
   (GET /api/pay/gas, cached by the server for a few minutes and re-read here every 3 minutes) and the chains
   Gully Pay accepts on. This is network data, not the store's: no store figure is mixed in. A chain whose
   gas or coin price could not be read is listed as unreadable, never drawn as $0. Gully Pay has no public
   all-stores volume figure, so none is shown. */

const money = (v: number) => (v > 0 && v < 0.0001 ? '<$0.0001' : v < 0.01 ? `$${v.toFixed(4)}` : v < 1 ? `$${v.toFixed(3)}` : `$${v.toFixed(2)}`)

export function NetworkStrip({ view }: { view: MerchantView }) {
  const gas = usePoll<GasView>('/api/pay/gas', 180_000)
  const rows = useMemo(() => (gas.data?.chains ?? []).filter((c) => c.ok && c.payUsd != null).sort((a, b) => (b.payUsd ?? 0) - (a.payUsd ?? 0)), [gas.data])
  const unread = (gas.data?.chains ?? []).filter((c) => !c.ok || c.payUsd == null)

  const option = useMemo(() => {
    if (!rows.length) return null
    const list = [...rows].reverse()
    return {
      grid: { left: 4, right: 56, top: 4, bottom: 4, containLabel: true },
      tooltip: axisTooltip((ps: { dataIndex: number }[]) => {
        const c = list[ps[0]?.dataIndex ?? 0]
        return tipHtml({
          title: c.name,
          rows: [
            { name: 'Fee-proxy payment (106k gas)', value: money(c.payUsd!), color: C.gold },
            { name: 'Plain transfer (65k gas)', value: money(c.transferUsd!) },
            { name: 'Gas price', value: `${c.gasPriceGwei} gwei` },
            ...(c.l1FeeUsd != null ? [{ name: 'incl. L1 data fee', value: money(c.l1FeeUsd) }] : []),
          ],
          note: c.priceSource ? `${c.symbol} priced by ${c.priceSource}` : undefined,
        })
      }, 'shadow'),
      xAxis: { type: 'value', show: false },
      yAxis: { type: 'category', data: list.map((c) => c.name), axisTick: { show: false }, axisLine: { show: false }, axisLabel: { color: C.muted, fontSize: 11 } },
      series: [{ id: 'gas', ...barsPreset({ horizontal: true, stagger: 40 }), color: C.gold, barMaxWidth: 12, label: { show: true, position: 'right', color: C.muted, fontSize: 11, formatter: (p: { value: number }) => money(p.value) }, data: list.map((c) => c.payUsd) }],
    }
  }, [rows])

  return (
    <section aria-labelledby="m-net-h" className="flex min-w-0 flex-col gap-2 rounded-[14px] border border-line bg-surface p-4 max-[600px]:p-3" data-testid="merchant-network">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h3 id="m-net-h" className="m-0 flex items-center gap-2 text-[14px] font-semibold text-ink">
          <Fuel size={15} className="text-gold" aria-hidden /> Gas per payment, now
        </h3>
        <span className="inline-flex items-center gap-2 rounded-full border border-line-strong px-[10px] py-[2px] font-mono text-[11px] text-ink-2">
          <span className="relative grid size-2 place-items-center" aria-hidden>
            <span className="absolute size-2 rounded-full bg-green/50" style={{ animation: 'gl-live-pulse 2.4s ease-out infinite' }} />
            <span className="size-[6px] rounded-full bg-green" />
          </span>
          NETWORK · LIVE
        </span>
        <span className="font-mono text-[11px] text-faint">what your payer spends in gas, not your store&apos;s data</span>
        <RefreshChip error={gas.stale ? gas.error : null} onRetry={() => void gas.reload()} className="ml-auto" />
      </div>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="min-w-0">
          {option ? (
            <EChart option={option} height={Math.max(120, rows.length * 24 + 12)} label={`Gas cost of a Gully Pay payment per chain: ${rows.map((c) => `${c.name} ${money(c.payUsd!)}`).join(', ')}.`} />
          ) : (
            <ChartBox height={140} state={gas.data || gas.error || gas.timedOut ? 'error' : 'loading'} message={gas.data ? 'No chain answered with a price just now.' : 'Gas prices could not be read just now.'} onRetry={() => void gas.reload()} />
          )}
          {unread.length > 0 && <p className="m-0 mt-1 font-mono text-[11px] text-faint">{unread.map((c) => `${c.name}: unreadable right now`).join(' · ')}</p>}
        </div>
        <div className="flex min-w-0 flex-col gap-2">
          <span className="text-[12px] text-dim" data-testid="accepting-chains">
            Gully Pay accepts payments on {view.chains.length} chain{view.chains.length === 1 ? '' : 's'}
          </span>
          <ul className="m-0 flex list-none flex-wrap gap-[6px] p-0">
            {view.chains.map((c, i) => {
              const yours = view.wallets.some((w) => w.chainId === c.id && w.enabled && w.status === 'ok')
              return (
                <li key={c.id} className={`inline-flex min-h-8 items-center gap-[6px] rounded-full border px-[10px] text-[12px] ${yours ? 'border-success-line text-ink' : 'border-line-strong text-dim'}`} style={{ animation: `gl-fade .4s ${i * 0.05}s ease both` }} title={yours ? `${c.name}: your store receives here` : `${c.name}: add a wallet on this chain to receive here`}>
                  <ChainLogo chain={c.key} size={16} decorative /> {c.name}
                  {yours && <span className="size-[6px] rounded-full bg-green" aria-label="your store receives here" />}
                </li>
              )
            })}
          </ul>
          <span className="font-mono text-[11px] text-faint">green dot: your store receives there</span>
        </div>
      </div>
    </section>
  )
}
