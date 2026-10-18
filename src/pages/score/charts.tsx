import { useMemo } from 'react'
import { AnimatedNumber } from '../../components/charts/AnimatedNumber'
import { C, PALETTE, areaPreset, axisTooltip, barsPreset, itemTooltip, livePoint, ringPreset, tipHtml } from '../../components/charts/chartPresets'
import { EChart } from '../../components/charts/EChart'
import { bandColor, fmtDate, type ScoreComponent, type ScoreRow } from './api'

/* The Gully Score's charts. Every one draws only what the API returned: a component that could not be read has
   no bar (it is labelled "not available"), and a history of fewer than two points is not drawn as a line. */

/** The score as an animated ring with the number rolling up in its centre. */
export function ScoreRing({ score, grade, size = 220 }: { score: number | null; grade: string | null; size?: number }) {
  const option = useMemo(
    () => ({
      tooltip: itemTooltip((p: { name: string; value: number }) => tipHtml({ rows: [{ name: p.name, value: String(p.value) }] })),
      series: [
        {
          ...ringPreset({ radius: ['74%', '92%'], padAngle: 0 }),
          id: 'score',
          data:
            score === null
              ? [{ name: 'Not enough data', value: 100, itemStyle: { color: C.line } }]
              : [
                  { name: 'Score', value: score, itemStyle: { color: bandColor(score) } },
                  { name: 'To 100', value: 100 - score, itemStyle: { color: C.line }, emphasis: { disabled: true }, tooltip: { show: false } },
                ],
        },
      ],
    }),
    [score],
  )
  return (
    <EChart option={option} height={size} label={score === null ? 'Gully Score: not enough public data for a score' : `Gully Score ${score} out of 100, ${grade}`} skeleton="ring" className="max-w-[260px]">
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
        {score === null ? <span className="font-display text-[44px] leading-none font-extrabold text-muted">N/A</span> : <AnimatedNumber value={score} countUp className="font-display text-[64px] leading-none font-extrabold" style={{ color: bandColor(score) }} />}
        <span className="mt-1 font-mono text-[11px] tracking-[1px] text-faint">{score === null ? 'NOT ENOUGH DATA' : 'OUT OF 100'}</span>
        {score !== null && (
          <span className="font-mono text-[11px] tracking-[1px]" style={{ color: bandColor(score) }}>
            {grade?.toUpperCase()}
          </span>
        )}
      </div>
    </EChart>
  )
}

/** One horizontal bar per component; a component that is not available shows its label and no bar. */
export function ComponentBars({ parts }: { parts: ScoreComponent[] }) {
  const option = useMemo(() => {
    const rows = [...parts].reverse()
    return {
      grid: { left: 8, right: 44, top: 6, bottom: 6, containLabel: true },
      tooltip: axisTooltip((ps: { dataIndex: number }[]) => {
        const p = rows[ps[0]?.dataIndex ?? 0]
        return tipHtml({ title: `${p.label} · weight ${p.weight}`, rows: [{ name: 'Points', value: p.available ? `${p.score} / 100` : 'not available', valueColor: p.available ? bandColor(p.score) : C.faint }], note: p.reason })
      }, 'shadow'),
      xAxis: { type: 'value', min: 0, max: 100, splitNumber: 4 },
      yAxis: { type: 'category', data: rows.map((p) => `${p.label} (${p.weight})`), axisLabel: { color: C.muted, fontSize: 11 } },
      series: [
        {
          ...barsPreset({ horizontal: true, stagger: 50 }),
          id: 'points',
          barMaxWidth: 14,
          data: rows.map((p) => (p.available ? { value: p.score, itemStyle: { color: bandColor(p.score) } } : { value: null })),
          label: { show: true, position: 'right', color: C.faint, fontSize: 11, formatter: (x: { dataIndex: number }) => (rows[x.dataIndex].available ? String(rows[x.dataIndex].score) : 'n/a') },
        },
      ],
    }
  }, [parts])
  return <EChart option={option} height={Math.max(220, parts.length * 30 + 20)} label={`Points per component: ${parts.map((p) => `${p.label} ${p.available ? p.score : 'not available'}`).join(', ')}`} steps={{ count: parts.length }} skeleton="bars" />
}

/** The score over time; fewer than two points is a waiting state with a live marker, not a flat line. */
export function ScoreHistory({ points }: { points: { at: string; score: number | null }[] }) {
  const pts = points.filter((p): p is { at: string; score: number } => p.score !== null)
  const option = useMemo(() => {
    const data = pts.map((p) => [Date.parse(p.at), p.score] as [number, number])
    const last = data[data.length - 1] ?? null
    return {
      grid: { left: 8, right: 16, top: 16, bottom: 8, containLabel: true },
      tooltip: axisTooltip((ps: { value: [number, number] }[]) => tipHtml({ title: fmtDate(new Date(ps[0].value[0]).toISOString()), rows: [{ name: 'Score', value: String(ps[0].value[1]), valueColor: bandColor(ps[0].value[1]) }] })),
      xAxis: { type: 'time' },
      yAxis: { type: 'value', min: 0, max: 100, splitNumber: 4 },
      series: [{ ...areaPreset({ color: C.gold }), id: 'score', step: 'end', data }, livePoint(last)],
    }
  }, [pts])
  if (pts.length < 2)
    return (
      <div className="relative flex h-[200px] flex-col items-center justify-center gap-3 rounded-[10px] border border-dashed border-line-strong text-center" data-empty>
        <span className="relative grid size-10 place-items-center">
          <span aria-hidden className="absolute inset-0 rounded-full border border-gold-line" style={{ animation: 'gl-live-pulse 2.6s ease-out infinite' }} />
          <span aria-hidden className="size-2 rounded-full bg-gold" />
        </span>
        <span className="max-w-[340px] text-[14px] text-muted">
          {pts.length === 1 ? `One reading so far (${pts[0].score} on ${fmtDate(pts[0].at)}). A line appears once the score has been read again.` : 'No score has been given yet, so there is no history to draw.'}
        </span>
      </div>
    )
  return <EChart option={option} height={220} label={`Score history: ${pts.map((p) => `${fmtDate(p.at)} ${p.score}`).join(', ')}`} steps={{ count: pts.length }} skeleton="line" />
}

/** The index's spread: how many listed contracts fall in each band. */
export function BandBars({ rows }: { rows: ScoreRow[] }) {
  const bands = [
    { name: 'Strong (80+)', test: (s: number) => s >= 80, color: bandColor(90) },
    { name: 'Fair (60–79)', test: (s: number) => s >= 60 && s < 80, color: bandColor(70) },
    { name: 'Weak (40–59)', test: (s: number) => s >= 40 && s < 60, color: bandColor(50) },
    { name: 'Poor (<40)', test: (s: number) => s < 40, color: bandColor(10) },
  ]
  const counts = bands.map((b) => rows.filter((r) => r.score !== null && b.test(r.score)).length)
  const unscored = rows.filter((r) => r.score === null).length
  // Rebuilt on each render (a minute apart at most); the chart merges it and glides between counts.
  const option = {
      grid: { left: 8, right: 8, top: 20, bottom: 8, containLabel: true },
      tooltip: axisTooltip((ps: { dataIndex: number; value: number }[]) => tipHtml({ rows: [{ name: [...bands.map((b) => b.name), 'Not enough data'][ps[0].dataIndex], value: `${ps[0].value} contract${ps[0].value === 1 ? '' : 's'}` }] }), 'shadow'),
      xAxis: { type: 'category', data: [...bands.map((b) => b.name), 'Not enough data'] },
      yAxis: { type: 'value', minInterval: 1 },
      series: [{ ...barsPreset({ stagger: 60 }), id: 'bands', barMaxWidth: 46, data: [...counts.map((v, i) => ({ value: v, itemStyle: { color: bands[i].color } })), { value: unscored, itemStyle: { color: C.lineHover } }], label: { show: true, position: 'top', color: C.muted, fontSize: 11 } }],
  }
  return <EChart option={option} height={200} label={`Listed contracts by band: ${bands.map((b, i) => `${b.name} ${counts[i]}`).join(', ')}, not enough data ${unscored}`} steps={{ count: 5 }} skeleton="bars" />
}

/**
 * The methodology's weights as a ring, read live from GET /api/score (methodology.components): what each part
 * of the Gully Score counts for. Hover or focus a slice for its source. Shown on /score even before anything
 * is listed, and on the docs Roadmap.
 */
export function WeightsRing({ parts, size = 200 }: { parts: { id: string; label: string; weight: number; source: string }[]; size?: number }) {
  const total = parts.reduce((a, p) => a + p.weight, 0)
  const option = useMemo(
    () => ({
      tooltip: itemTooltip((p: { dataIndex: number }) => {
        const c = parts[p.dataIndex]
        return c ? tipHtml({ title: c.label, rows: [{ name: 'Weight', value: `${c.weight} of ${total}` }], note: `Source: ${c.source}` }) : ''
      }),
      series: [
        {
          ...ringPreset({ radius: ['58%', '90%'] }),
          id: 'weights',
          data: parts.map((c, i) => ({ name: c.label, value: c.weight, itemStyle: { color: PALETTE[i % PALETTE.length] } })),
        },
      ],
    }),
    [parts, total],
  )
  if (!parts.length) return null
  return (
    <EChart option={option} height={size} label={`Gully Score weights: ${parts.map((c) => `${c.label} ${c.weight}`).join(', ')}`} skeleton="ring" className="max-w-[240px]" steps={{ count: parts.length }}>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
        <AnimatedNumber value={parts.length} countUp className="font-display text-[40px] leading-none font-extrabold text-gold" />
        <span className="mt-1 font-mono text-[11px] tracking-[1px] text-faint">PARTS</span>
      </div>
    </EChart>
  )
}
