import { useMemo } from 'react'
import { sparklinePreset } from '../../../components/charts/chartPresets'
import { EChart } from '../../../components/charts/EChart'

const hhmm = (t: number) => new Date(t).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false })
const hhmmss = (t: number) => new Date(t).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })

/** A small animated line with hover tooltips ([ms timestamp, value] points), on the ECharts kit. */
export function LineChart({ points, color, fmt, label, height = 120, seconds = false }: { points: [number, number][]; color: string; fmt: (v: number) => string; label: string; height?: number; seconds?: boolean }) {
  const key = points.map((p) => p.join(':')).join(',')
  const option = useMemo(
    () => sparklinePreset({ data: points.map((p) => p[1]), labels: points.map((p) => (seconds ? hhmmss : hhmm)(p[0])), color, fmt }),
    // `key` is the series by value
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key, color, seconds],
  )
  return <EChart option={option} height={height} skeleton="line" label={label} />
}
