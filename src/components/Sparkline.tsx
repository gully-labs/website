interface SparklineProps {
  /** At least two points; the caller shows an honest empty state otherwise. */
  data: number[]
  color: string
  /** Delay before the line draws in, in seconds. */
  delay?: number
  /** Large variant used for the project Activity chart. */
  large?: boolean
  label?: string
}

export function Sparkline({ data, color, delay = 0, large = false, label }: SparklineProps) {
  const hi = Math.max(...data)
  const lo = Math.min(...data)
  // A flat series still draws a line, not a division by zero.
  const max = hi === lo ? hi + 1 : hi * 1.1
  const min = hi === lo ? lo - 1 : lo * 0.9
  const pts = data
    .map((v, i) => `${(i / (data.length - 1)) * 100},${40 - ((v - min) / (max - min)) * 40}`)
    .join(' L')

  return (
    <svg
      viewBox="0 0 100 40"
      preserveAspectRatio="none"
      className="block size-full overflow-visible"
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <path d={`M0,40 L${pts} L100,40 Z`} fill={`${color}24`} style={{ animation: 'gl-fade 1s .4s ease both' }} />
      <path
        d={`M${pts}`}
        fill="none"
        stroke={color}
        strokeWidth={large ? 2.5 : 2}
        vectorEffect="non-scaling-stroke"
        pathLength={1}
        strokeDasharray={1}
        style={{ animation: `gl-draw 1.4s ${delay}s ease-out both` }}
      />
    </svg>
  )
}
