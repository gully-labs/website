import { useNavigate } from 'react-router'
import { ChartBox } from '../charts/ChartSkeleton'
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
  if (!rows.length) return <p className="m-0 animate-[gl-skeleton_2s_ease-in-out_infinite] font-mono text-[12px] text-faint">Not tracked yet: no trusted pool has a gap right now.</p>
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
