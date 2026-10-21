import { useNavigate } from 'react-router'
import { ChartBox } from '../charts/ChartSkeleton'
import { GhostChart } from '../charts/GhostChart'
import { stockPath, useTracker } from '../../lib/tracker'
import { GapBars } from './GapBars'

/** The widest live gaps as animated bars (live /api/tracker, refreshed every minute); a bar opens its
    stock's page. Holds its box with a pulsing skeleton while the tracker loads. */
export function LiveTopGaps({ count = 8 }: { count?: number }) {
  const st = useTracker()
  const navigate = useNavigate()
  if (st.k !== 'ok') return <ChartBox height={count * 24 + 30} state={st.k} message="The tracker could not be read just now. It retries every minute." />
  const rows = st.data.rows
    .filter((r) => r.gapPct !== null && r.status !== 'thin')
    .sort((a, b) => Math.abs(b.gapPct ?? 0) - Math.abs(a.gapPct ?? 0))
    .slice(0, count)
  if (!rows.length)
    return (
      <GhostChart variant="bars" height={count * 24 + 30} badge={false} label="The widest gaps will draw here" testId="top-gaps-empty">
        <span className="font-mono text-[12px] leading-[1.45] text-muted">Not tracked yet: no trusted pool has a gap right now.</span>
      </GhostChart>
    )
  return (
    <GapBars
      rows={rows}
      inLinePct={st.data.rules.inLinePct}
      selected={null}
      onSelect={(id) => {
        const [chain, ticker] = id.split(':')
        navigate(stockPath({ chain, ticker }))
      }}
    />
  )
}
