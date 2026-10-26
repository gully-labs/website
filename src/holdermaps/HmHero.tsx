/* The HolderMaps landing's live stage: the kit mascot (HolderMaps/Mascot_03_Map.png, bobbing; still under reduced
   motion) beside three live figures, each with its animated line:
     launches checked   GET /api/holders/launches (every 30 s): the feed's launches per hour
     holder sources     GET /api/status, group "holders": the weakest source's 24 h uptime, 30-minute buckets
     most scanned       GET /api/holders/top: maps opened today, by token
   Nothing is typed in: a figure that cannot be read says so. */
import { Count, Spark } from '../console/ui'
import { fmtPct } from '../console/charts'
import { useLive } from '../console/live'
import type { CheckedLaunch } from '../lib/holders'

const HOUR = 3_600_000

export function HmStage({ launches, scans, now }: { launches: CheckedLaunch[] | null; scans: number[] | null; now: number }) {
  const { status } = useLive()
  const src = (status?.components ?? []).filter((c) => c.group === 'holders')
  const up = src.length ? Math.round(Math.min(...src.map((c) => c.uptime24h ?? 0)) * 1000) / 10 : null
  const upLine = (src[0]?.history ?? []).map((_, i) => (src.every((c) => c.history[i]?.up == null) ? null : Math.round(Math.min(...src.map((c) => c.history[i]?.up ?? 1)) * 1000) / 10))
  const end = Math.floor(now / HOUR) * HOUR
  const perHour = launches ? Array.from({ length: 12 }, (_, i) => end - (11 - i) * HOUR).map((h) => launches.filter((l) => { const t = Date.parse(l.createdAt); return t >= h && t < h + HOUR }).length) : []
  const checked = launches ? launches.filter((l) => l.state === 'checked').length : null
  return (
    <div className="hm-stage" aria-label="HolderMaps, live">
      <div className="hm-figs">
        <span className="hm-live">
          <i aria-hidden /> LIVE
        </span>
        <div className="hm-fig">
          <span className="k">Launches checked</span>
          <Count className="v num" value={checked} />
          <Spark values={perHour} color="#FFD52E" />
          <span className="s">{launches ? `${launches.length} in the feed · per hour, last 12 h` : 'reading the launch feed'}</span>
        </div>
        <div className="hm-fig">
          <span className="k">Holder sources · 24 h</span>
          <Count className="v num" value={up} fmt={fmtPct} />
          <Spark values={upLine} color="#FDB813" />
          <span className="s">{src.length ? `${src.length} chains read every minute` : 'reading status'}</span>
        </div>
        <div className="hm-fig">
          <span className="k">Maps opened today</span>
          <Count className="v num" value={scans ? scans.reduce((a, b) => a + b, 0) : null} />
          <Spark values={scans ?? []} color="#FFE03A" />
          <span className="s">{scans ? `across the ${scans.length} most scanned tokens` : 'reading today’s scans'}</span>
        </div>
      </div>
      <div className="hm-mascot-wrap">
        <img className="hm-mascot" src="/brand/holdermaps/mascot-map.png" width={340} height={470} alt="" decoding="async" />
      </div>
    </div>
  )
}
