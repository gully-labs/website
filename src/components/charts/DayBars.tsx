import { useState } from 'react'

export interface DaySeries {
  key: string
  label: string
  color: string
}

/* Daily bars, stacked by series, growing from the baseline. Hover or focus a day for exact values;
   the table twin is the accessible view (aria-label lists every day). An all-zero range says so. */
export function DayBars({ days, series, height = 180, unit = 'requests' }: { days: ({ day: string } & Record<string, number | string>)[]; series: DaySeries[]; height?: number; unit?: string }) {
  const [hover, setHover] = useState(-1)
  const total = (d: (typeof days)[number]) => series.reduce((a, s) => a + Number(d[s.key] ?? 0), 0)
  const max = Math.max(1, ...days.map(total))
  const any = days.some((d) => total(d) > 0)
  const label = (d: string) => new Date(d + 'T00:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
  const cur = hover >= 0 ? days[hover] : null

  return (
    <div className="flex flex-col gap-2">
      <div
        className="relative flex items-end gap-[3px] border-b border-line-strong"
        style={{ height }}
        role="img"
        aria-label={`${unit} per day: ${days.map((d) => `${label(d.day)} ${total(d)}`).join(', ')}`}
      >
        {!any && <span className="absolute inset-0 flex items-center justify-center font-mono text-[12px] text-faint">No {unit} in this range yet.</span>}
        {days.map((d, i) => (
          <div
            key={d.day}
            tabIndex={0}
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(-1)}
            onFocus={() => setHover(i)}
            onBlur={() => setHover(-1)}
            className={`flex h-full min-w-0 flex-1 flex-col-reverse rounded-t-[2px] outline-offset-1 ${hover === i ? 'bg-surface-hover' : ''}`}
          >
            {series.map((s, j) => {
              const v = Number(d[s.key] ?? 0)
              return v > 0 ? <div key={s.key} style={{ height: `${(v / max) * 100}%`, background: s.color, transformOrigin: 'bottom', animation: `gl-grow .6s ${i * 0.015 + j * 0.05}s cubic-bezier(.2,.8,.2,1) both` }} /> : null
            })}
          </div>
        ))}
        {cur && (
          <div
            className="pointer-events-none absolute top-1 z-10 -translate-x-1/2 rounded-input border border-line-strong bg-surface-deep px-[10px] py-2 font-mono text-[12px] whitespace-nowrap text-ink"
            style={{ left: `${Math.min(88, Math.max(12, ((hover + 0.5) / days.length) * 100))}%` }}
          >
            <div className="text-faint">{label(cur.day)}</div>
            {series.map((s) => (
              <div key={s.key}>
                <span style={{ color: s.color }}>●</span> {s.label} <b className="font-medium">{Number(cur[s.key] ?? 0).toLocaleString('en-US')}</b>
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="flex justify-between font-mono text-[11px] text-axis" aria-hidden>
        <span>{days.length ? label(days[0].day) : ''}</span>
        <span>{days.length ? label(days[days.length - 1].day) : ''}</span>
      </div>
      {series.length > 1 && (
        <div className="flex flex-wrap gap-4 font-mono text-[11px] text-faint">
          {series.map((s) => (
            <span key={s.key} className="inline-flex items-center gap-2">
              <i className="inline-block size-[9px] rounded-[2px]" style={{ background: s.color }} />
              {s.label}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
