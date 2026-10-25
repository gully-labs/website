import { useMemo } from 'react'
import { Link } from 'react-router'
import { MiniSpark } from '../charts/MiniSpark'
import { holdersPagePath, useHolderMap } from '../../lib/holders'
import { MiniMap } from './MiniMap'
import { ScoreRing } from './parts'
import { fmtPct } from './format'
import { K } from './theme'
import { previewOf, type MotionMap } from './motion'
import { holderAbsUrl, holderHref } from '../../site-host'

/* A compact Holder Map for other views (the app's Holder Map page, side columns): the animated mini map
   (biggest bubbles, the latest real transfers streaming between them), the launch-health ring, and a
   sparkline of how much the top 10 wallets held at each replay frame. Everything is read from
   GET /api/holders/:chain/:token; a figure that is not there says so instead of drawing a flat line. */


export function HolderMapMini({ chain, token, external = false }: { chain: string; token: string; external?: boolean }) {
  const load = useHolderMap(chain, token)
  const m = load.k === 'ok' && load.data.state === 'ok' ? (load.data as MotionMap) : null
  const preview = useMemo(() => (m ? previewOf(m) : null), [m])
  const frames = m?.timeline?.frames ?? []
  const series = frames.map((f) => f.top10Pct ?? 0)
  const labels = frames.map((f) => (f.at ? new Date(f.at).toISOString().slice(0, 16).replace('T', ' ') : `block ${f.block.toLocaleString('en-US')}`))
  if (load.k === 'loading') return <div role="status" aria-label="Reading the Holder Map" className="h-[132px] animate-[gl-skeleton_1.4s_ease-in-out_infinite] card" />
  if (!m || !preview)
    return (
      <p className="card card-pad m-0 text-[13px] text-muted" data-holder-mini="empty">
        {load.k === 'ok' && 'reason' in load.data ? load.data.reason : 'The Holder Map could not be read just now.'}
      </p>
    )
  const path = holdersPagePath(m.chain.key, m.token.address)
  const open = external ? (
    <a href={holderAbsUrl(path)} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center font-mono text-[12px] text-gold hover:underline">
      Open the full map ↗
    </a>
  ) : (
    <Link to={holderHref(path)} className="inline-flex min-h-11 items-center font-mono text-[12px] text-gold hover:underline">
      Open the full map →
    </Link>
  )
  return (
    <section aria-label={`Holder Map of ${m.token.symbol ?? 'this token'}`} className="card card-pad flex flex-col gap-3" data-holder-mini>
      <div className="flex flex-wrap items-center gap-3">
        <MiniMap preview={preview} width={168} height={112} label={`Holder Map of ${m.token.symbol ?? 'this token'} in miniature: ${m.summary.line}`} />
        {m.health && <ScoreRing score={m.health.score} level={m.health.level} size={72} />}
        <div className="flex min-w-[160px] flex-1 flex-col gap-1">
          <span className="font-mono text-[11px] tracking-[1px] text-dim">TOP 10 SHARE SINCE LAUNCH</span>
          <MiniSpark data={series} labels={labels} fmt={(v) => fmtPct(v)} height={44} color={K.gold} label={`Share held by the top 10 wallets of ${m.token.symbol ?? 'this token'} since launch`} />
          <span className="text-[13px] leading-[1.45] text-muted">{m.summary.line}</span>
        </div>
      </div>
      {open}
    </section>
  )
}

export default HolderMapMini
