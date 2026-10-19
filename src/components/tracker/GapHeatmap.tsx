import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { EChart } from '../charts/EChart'
import type { ChartEvent } from '../charts/chart-utils'
import { heatmapPreset, itemTooltip, tipHtml, C } from '../charts/chartPresets'
import { CHAIN_NAME, DOWN, fmtCompactUsd, fmtGap, fmtPrice, stockPath, UP, type TrackerRow } from '../../lib/tracker'

/* Gap heatmap: every trusted stock as a tile, sized by the liquidity of the pool its price comes from
   and coloured by its gap on a diverging scale centred on zero (vermilion below fair, teal above,
   slate near zero; the CVD-safe pair used everywhere on the tracker). Tiles grow in on load and
   resize and recolour in place on every refresh; click one for the stock's page. */

const NEUTRAL = C.lineHover
const SCALE = 3 // % at which a tile reaches full colour
const hex = (c: string) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16))
const mix = (a: string, b: string, t: number) => {
  const A = hex(a)
  const B = hex(b)
  return `#${A.map((v, i) => Math.round(v + (B[i] - v) * t).toString(16).padStart(2, '0')).join('')}`
}
const lum = (c: string) => {
  const [r, g, b] = hex(c).map((v) => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
/** The tile colour for a gap: neutral inside ±in-line/4, then towards UP or DOWN, full at ±SCALE%. */
const gapColour = (gap: number, inLinePct: number) => {
  const a = Math.abs(gap)
  if (a < inLinePct / 4) return NEUTRAL
  return mix(NEUTRAL, gap >= 0 ? UP : DOWN, Math.min(1, a / SCALE) ** 0.75)
}
const idOf = (r: TrackerRow) => `${r.chain}:${r.ticker}`
const HEIGHT = 320
const CHAIN_TAG: Record<string, string> = { robinhood: 'RH', bsc: 'BNB', solana: 'SOL' }

export function GapHeatmap({ rows, inLinePct }: { rows: TrackerRow[]; inLinePct: number }) {
  const navigate = useNavigate()
  // The box width decides which tiles can hold a label: a tile too small for its text shows none
  // (its tooltip still has everything) rather than a cut-off figure.
  const hasTiles = rows.some((r) => r.gapPct !== null && r.status !== 'thin' && r.pool && r.pool.liquidityUsd > 0)
  const box = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  useEffect(() => {
    const el = box.current
    if (!el) return
    const ro = new ResizeObserver(() => setWidth(Math.round(el.clientWidth / 40) * 40))
    ro.observe(el)
    return () => ro.disconnect()
  }, [hasTiles])
  const tiles = rows.filter((r) => r.gapPct !== null && r.status !== 'thin' && r.pool && r.pool.liquidityUsd > 0).sort((a, b) => b.pool!.liquidityUsd - a.pool!.liquidityUsd)
  const key = tiles.map((r) => `${idOf(r)}=${r.gapPct}:${r.pool!.liquidityUsd}`).join('|') + `|${inLinePct}|${width}`
  const total = tiles.reduce((a, r) => a + r.pool!.liquidityUsd, 0)
  const option = useMemo(
    () => ({
      tooltip: itemTooltip((p: ChartEvent) => {
        const r = tiles.find((t) => idOf(t) === p.data?.id)
        if (!r) return ''
        const c = (r.gapPct ?? 0) >= 0 ? UP : DOWN
        return tipHtml({
          title: `${r.ticker} · ${r.name} · ${CHAIN_NAME[r.chain] ?? r.chain}`,
          rows: [
            { name: 'gap', value: fmtGap(r.gapPct), color: c, valueColor: c },
            { name: 'onchain', value: fmtPrice(r.onchain) },
            { name: 'fair', value: fmtPrice(r.fair) },
            { name: 'pool liquidity', value: fmtCompactUsd(r.pool!.liquidityUsd) },
          ],
          note: 'click for its page',
        })
      }),
      series: [
        {
          id: 'heat',
          ...heatmapPreset(),
          left: 0,
          right: 0,
          top: 0,
          bottom: 0,
          squareRatio: 0.5 * (1 + Math.sqrt(5)),
          label: {
            show: true,
            overflow: 'truncate',
            ellipsis: '',
            minMargin: 2,
            formatter: (p: ChartEvent) => (p.data?.fit === 2 ? `{t|${p.data.ticker}} {c|${p.data.chainShort}}\n{g|${p.data.gapText}}` : p.data?.fit === 1 ? `{t|${p.data.ticker}}` : ''),
            rich: {
              t: { fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 15, lineHeight: 17 },
              g: { fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, lineHeight: 14 },
              c: { fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, lineHeight: 17, opacity: 0.75 },
            },
          },
          data: tiles.map((r) => {
            const fill = gapColour(r.gapPct!, inLinePct)
            const ink = lum(fill) > 0.18 ? C.bg : C.ink
            // Rough tile area from its share of the box (gaps and squarifying ignored).
            const area = total && width ? (r.pool!.liquidityUsd / total) * width * HEIGHT * 0.85 : 0
            return {
              fit: area > 6000 ? 2 : area > 2400 ? 1 : 0,
              chainShort: CHAIN_TAG[r.chain] ?? r.chain,
              id: idOf(r),
              name: `${r.ticker} ${CHAIN_NAME[r.chain] ?? r.chain}`,
              ticker: r.ticker,
              gapText: fmtGap(r.gapPct),
              value: r.pool!.liquidityUsd,
              itemStyle: { color: fill },
              label: { color: ink, rich: { t: { color: ink }, g: { color: ink }, c: { color: ink } } },
            }
          }),
        },
      ],
    }),
    // `key` holds every tile's id, gap and size
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key],
  )
  if (!tiles.length) return <p className="m-0 py-10 font-mono text-[12px] text-faint">No trusted pool to map yet: a tile needs both prices read and a pool over the liquidity floor.</p>
  const widest = [...tiles].sort((a, b) => Math.abs(b.gapPct!) - Math.abs(a.gapPct!)).slice(0, 3)
  return (
    <div ref={box} className="flex flex-col gap-2">
      <EChart
        option={option}
        height={HEIGHT}
        steps={{ count: tiles.length }}
        onEvents={{ click: (p: ChartEvent) => p.data?.id && navigate(stockPath({ chain: p.data.id.split(':')[0], ticker: p.data.id.split(':')[1] })) }}
        label={`Gap heatmap of ${tiles.length} trusted stocks, tile size by pool liquidity. Widest gaps: ${widest.map((r) => `${r.ticker} ${fmtGap(r.gapPct)}`).join(', ')}. Arrow keys step through tiles; the table below lists every stock.`}
      />
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[11px] text-faint" aria-hidden>
        <span>below fair</span>
        <span className="h-[6px] max-w-[260px] min-w-[80px] flex-1 rounded-full" style={{ background: `linear-gradient(90deg, ${DOWN}, ${NEUTRAL} 42%, ${NEUTRAL} 58%, ${UP})` }} />
        <span>above fair</span>
        <span className="ml-auto">−{SCALE}% · 0 · +{SCALE}% · tile = pool liquidity · RH = Robinhood Chain</span>
      </div>
    </div>
  )
}
