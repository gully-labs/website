import { useMemo } from 'react'
import { AnimatedNumber } from '../../components/charts/AnimatedNumber'
import { EChart } from '../../components/charts/EChart'
import { axisTooltip, barsPreset, C, tipHtml } from '../../components/charts/chartPresets'
import { GhostChart } from '../../components/charts/GhostChart'
import { useLiveSeries } from '../../components/charts/useLiveSeries'

/* Waitlist momentum: sign-ups per day, a public aggregate (GET /api/chains/waitlist/stats: counts only, never a name or
   a contact), polled every 60 s. Under 3 days of data it stays a ghost: a shape, not a trend. */

const EVERY_MS = 60_000
const MIN_DAYS = 3
interface Stats {
  days: { day: string; n: number }[]
  total: number
}

async function read(signal: AbortSignal): Promise<Stats> {
  const r = await fetch('/api/chains/waitlist/stats', { signal })
  const j = (await r.json().catch(() => null)) as Stats | null
  if (!r.ok || !j || !Array.isArray(j.days)) throw new Error(`HTTP ${r.status}`)
  return j
}

export function Momentum() {
  const { data } = useLiveSeries(read, EVERY_MS)
  const days = useMemo(() => data?.days ?? [], [data])
  const option = useMemo(
    () => ({
      grid: { left: 4, right: 8, top: 8, bottom: 4, containLabel: true },
      xAxis: { type: 'category', data: days.map((d) => d.day.slice(5)) },
      yAxis: { type: 'value', minInterval: 1 },
      tooltip: axisTooltip((ps: { dataIndex: number }[]) => {
        const d = days[ps[0]?.dataIndex ?? 0]
        return d ? tipHtml({ title: d.day, rows: [{ name: 'Sign-ups', value: String(d.n), color: C.gold }] }) : ''
      }),
      series: [{ id: 'signups', ...barsPreset(), color: C.gold, data: days.map((d) => d.n) }],
    }),
    [days],
  )
  const total = data?.total ?? 0
  return (
    <div className="flex min-w-0 flex-col gap-2 rounded-card border border-line bg-card-token p-4" data-testid="chains-momentum">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-display text-[17px] leading-none font-bold uppercase">Waitlist momentum</span>
        <span className="font-mono text-[11px] tracking-[1px] text-faint">
          {total > 0 ? (
            <>
              <AnimatedNumber value={total} format={{ maximumFractionDigits: 0 }} /> ON THE LIST · SIGN-UPS PER DAY
            </>
          ) : (
            'SIGN-UPS PER DAY · COUNTS ONLY'
          )}
        </span>
      </div>
      {days.length >= MIN_DAYS ? (
        <EChart option={option} height={96} label={`Bar chart: Gully Chains waitlist sign-ups per day, ${total} in all. Counts only.`} skeleton="bars" />
      ) : (
        <GhostChart height={96} variant="bars" label="Sign-ups per day will draw here" badge="NEEDS 3 DAYS OF SIGN-UPS" framed={false} />
      )}
    </div>
  )
}
