import { useId, useState } from 'react'
import { chartSeries, formatMoney, months, totals, type ChartMetric } from '../content/stats'
import { useCountUp } from '../hooks/useCountUp'
import { BlinkDot } from './ui'

const card = 'flex flex-1 flex-col gap-[10px] rounded-card border border-line bg-surface p-7'
const cardLabel = 'font-mono text-[12px] tracking-[1px]'
const bigValue = 'font-display text-[clamp(56px,6cqw,80px)] leading-none font-extrabold tracking-[-.5px]'

function Change({ value }: { value: string }) {
  return (
    <div className="flex flex-wrap gap-[10px] text-[14px] text-muted">
      <span className="text-green">{value}</span>
      <span>last 30 days · all projects</span>
    </div>
  )
}

/** Home page totals: two count-up stat cards and the TVL / volume chart. */
export function MetricsPanel() {
  const volume = useCountUp(totals.volume)
  const tvl = useCountUp(totals.tvl)

  return (
    <section aria-label="Totals across all projects" className="flex flex-wrap gap-5 px-page pb-24">
      <div className="flex min-w-0 flex-[1_1_320px] flex-col gap-5">
        <div className={card}>
          <div className={`flex justify-between ${cardLabel}`}>
            <span className="text-dim">TOTAL VOLUME</span>
            <span className="flex items-center gap-2 text-green">
              <BlinkDot color="green" />
              LIVE
            </span>
          </div>
          <div className={bigValue}>
            <span className="sr-only">{formatMoney(totals.volume)}</span>
            <span aria-hidden>{formatMoney(volume)}</span>
          </div>
          <Change value={totals.volumeChange} />
        </div>
        <div className={card}>
          <div className={`${cardLabel} text-dim`}>TOTAL VALUE LOCKED</div>
          <div className={`${bigValue} text-gold`}>
            <span className="sr-only">{formatMoney(totals.tvl)}</span>
            <span aria-hidden>{formatMoney(tvl)}</span>
          </div>
          <Change value={totals.tvlChange} />
        </div>
      </div>
      <TrendChart />
    </section>
  )
}

function TrendChart() {
  const [metric, setMetric] = useState<ChartMetric>('tvl')
  const s = chartSeries[metric]

  return (
    <div className="flex min-w-0 flex-[2_1_560px] flex-col gap-5 rounded-card border border-line bg-surface p-7">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h3 className="m-0 font-display text-[28px] font-bold uppercase">{s.title}</h3>
          <span className="font-mono text-[12px] text-faint">Last 12 months · sample data</span>
        </div>
        <div role="group" aria-label="Chart metric" className="flex gap-1 rounded-input border border-line bg-bg p-1">
          {(Object.keys(chartSeries) as ChartMetric[]).map((id) => (
            <button
              key={id}
              type="button"
              aria-pressed={metric === id}
              onClick={() => setMetric(id)}
              className={`rounded-btn px-[14px] py-2 font-mono text-[12px] transition-colors ${
                metric === id ? 'bg-gold text-bg' : 'bg-transparent text-muted hover:text-ink'
              }`}
            >
              {chartSeries[id].label}
            </button>
          ))}
        </div>
      </div>
      <div className="flex min-h-[260px] gap-3">
        <div
          aria-hidden
          className="flex w-11 flex-none flex-col justify-between pb-[22px] text-right font-mono text-[11px] text-axis"
        >
          {s.yLabels.map((y) => (
            <span key={y}>{y}</span>
          ))}
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <div
            className="relative flex-1"
            style={{
              background:
                'repeating-linear-gradient(180deg,transparent 0,transparent calc(33.33% - 1px),#1a2029 calc(33.33% - 1px),#1a2029 33.33%)',
            }}
          >
            {metric === 'tvl' ? (
              <AreaChart key="tvl" data={s.data} max={s.max} label={`${s.title}, last 12 months`} />
            ) : (
              <BarChart key="vol" data={s.data} max={s.max} label={`${s.title}, last 12 months`} />
            )}
          </div>
          <div aria-hidden className="flex justify-between font-mono text-[11px] text-axis">
            {months.map((m, i) => (
              <span key={i}>{m}</span>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

interface ChartProps {
  data: readonly number[]
  max: number
  label: string
}

function AreaChart({ data, max, label }: ChartProps) {
  const gradientId = useId()
  const line = data.map((v, i) => `${(i / (data.length - 1)) * 100},${100 - (v / max) * 100}`).join(' L')

  return (
    <svg
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      role="img"
      aria-label={label}
      className="absolute inset-0 size-full overflow-visible"
    >
      <defs>
        <linearGradient id={gradientId} x1={0} y1={0} x2={0} y2={1}>
          <stop offset="0%" stopColor="#e8c060" stopOpacity={0.35} />
          <stop offset="100%" stopColor="#e8c060" stopOpacity={0} />
        </linearGradient>
      </defs>
      <path d={`M0,100 L${line} L100,100 Z`} fill={`url(#${gradientId})`} style={{ animation: 'gl-fade 1.2s .6s ease both' }} />
      <path
        d={`M${line}`}
        fill="none"
        stroke="#e8c060"
        strokeWidth={2.5}
        vectorEffect="non-scaling-stroke"
        pathLength={1}
        strokeDasharray={1}
        style={{ animation: 'gl-draw 1.6s ease-out both' }}
      />
    </svg>
  )
}

function BarChart({ data, max, label }: ChartProps) {
  return (
    <svg
      viewBox="0 0 120 100"
      preserveAspectRatio="none"
      role="img"
      aria-label={label}
      className="absolute inset-0 size-full"
    >
      {data.map((v, i) => (
        <rect
          key={i}
          x={i * 10 + 2}
          width={6}
          y={100 - (v / max) * 100}
          height={(v / max) * 100}
          rx={0.6}
          fill={i === data.length - 1 ? '#e8c060' : '#3d4a36'}
          style={{
            transformBox: 'fill-box',
            transformOrigin: 'bottom',
            animation: `gl-grow .7s ${i * 0.05}s cubic-bezier(.2,.8,.2,1) both`,
          }}
        />
      ))}
    </svg>
  )
}
