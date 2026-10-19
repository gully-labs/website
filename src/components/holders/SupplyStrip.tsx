import { Box, Coins, Flame, Landmark, Lock, Rocket, Wallet, Waves } from 'lucide-react'
import { useReducedMotion } from '../charts/chart-utils'
import { useSeen } from '../charts/useMiniChart'
import { TokenLogo } from '../logos/TokenLogo'
import type { HolderMapOk, HolderNode } from '../../lib/holders'
import { isInfraNode, kindKeyOf, supplyOf } from './supply'
import { fmtPct } from './format'
import { bandOf, BAND_HUES, clusterHue, KIND_HUE, KIND_WORD, shade, WALLET_HUE, type KindKey } from './palette'

/* Under the map: where the supply sits (one animated stacked bar) and who the biggest holders are right now
   (a short list with their kind, colour and logo). Both follow the map's numbers (live polls and the replay
   slider), so they move with the bubbles. Every figure is a sum of the server's per-wallet shares; nothing
   here is computed from anything the map does not already show. */

const ICONS: Partial<Record<KindKey, typeof Waves>> = {
  pool: Waves,
  router: Waves,
  lock: Lock,
  burn: Flame,
  deployer: Rocket,
  token: Coins,
  exchange: Landmark,
  contract: Box,
  deepcore: Box,
  gully: Box,
}

/** A small lit sphere in CSS, the same look as the canvas bubbles. */
export function Sphere({ hue, size = 22, ring, children }: { hue: string; size?: number; ring?: string; children?: React.ReactNode }) {
  return (
    <span
      aria-hidden
      className="inline-flex flex-none items-center justify-center rounded-full"
      style={{
        width: size,
        height: size,
        background: `radial-gradient(circle at 32% 28%, ${shade(hue, 0.42)} 0%, ${hue} 52%, ${shade(hue, -0.5)} 100%)`,
        boxShadow: `inset 0 0 0 ${ring ? 2 : 1}px ${ring ?? shade(hue, 0.25)}`,
      }}
    >
      {children}
    </span>
  )
}

export function SupplyStrip({ m, pctAt, selected, onSelect, compact }: { m: HolderMapOk; pctAt: (n: HolderNode) => number | null; selected: string | null; onSelect: (id: string) => void; compact: boolean }) {
  const reduced = useReducedMotion()
  const [ref, seen] = useSeen<HTMLDivElement>()
  const d = supplyOf(m, pctAt)
  const total = d.segs.reduce((s, x) => s + x.pct, 0) || 1
  const ease = reduced ? 'width 0.2s linear' : 'width 0.9s cubic-bezier(.2,.8,.2,1)'
  const sym = m.token.symbol ?? 'this token'
  const rows = m.nodes
    .map((n) => ({ n, p: pctAt(n) ?? 0 }))
    .sort((a, b) => b.p - a.p)
    .slice(0, 12)
  const max = rows[0]?.p || 1
  return (
    <section ref={ref} aria-label={`Where the supply of ${sym} sits`} className="flex flex-col gap-3 rounded-[12px] border border-line p-3 min-[1000px]:flex-1" style={{ background: 'var(--color-surface-deep)' }} data-supply-strip>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 className="m-0 font-mono text-[11px] font-medium tracking-[1px] text-dim">WHERE THE SUPPLY SITS</h3>
        <span className="font-mono text-[12px] text-muted">
          top 10 wallets hold <b className="font-semibold text-gold-hover">{fmtPct(d.top10)}</b>
        </span>
      </div>
      <div className="flex h-4 w-full overflow-hidden rounded-full bg-surface" role="img" aria-label={d.segs.map((s) => `${s.label} ${fmtPct(s.pct)}`).join(', ')} data-supply-bar>
        {d.segs.map((s) => (
          <span
            key={s.key}
            data-supply-seg={s.key}
            className="h-full flex-none"
            style={{
              width: seen ? `${(s.pct / total) * 100}%` : '0%',
              transition: ease,
              background: `linear-gradient(180deg, ${shade(s.hue, 0.3)} 0%, ${s.hue} 55%, ${shade(s.hue, -0.3)} 100%)`,
              borderRight: '1px solid var(--color-surface-deep)',
            }}
          />
        ))}
      </div>
      <ul className="m-0 flex list-none flex-wrap gap-x-4 gap-y-1 p-0 font-mono text-[11px] text-muted">
        {d.segs
          .filter((s) => s.pct >= 0.05)
          .map((s) => (
            <li key={s.key} className="flex items-center gap-1.5">
              <Sphere hue={s.hue} size={10} />
              {s.label} <b className="font-semibold text-ink">{fmtPct(s.pct)}</b>
            </li>
          ))}
      </ul>
      {!compact && (
        <div className="flex flex-col gap-1.5 border-t border-line pt-2" data-holder-leaders>
          <h3 className="m-0 font-mono text-[11px] font-medium tracking-[1px] text-dim">BIGGEST HOLDERS NOW</h3>
          <ol className="m-0 grid list-none grid-cols-1 gap-1 p-0 min-[700px]:grid-cols-2">
            {rows.map(({ n, p }, i) => {
              const kind = kindKeyOf(n)
              const hue =
                kind && (isInfraNode(n) || n.label?.kind === 'deployer')
                  ? KIND_HUE[kind]
                  : n.cluster
                    ? clusterHue(
                        Math.max(
                          0,
                          m.clusters.findIndex((c) => c.id === n.cluster),
                        ),
                      )
                    : m.links.length === 0
                      ? BAND_HUES[bandOf(p)]
                      : WALLET_HUE
              const Icon = (kind && ICONS[kind]) || Wallet
              return (
                <li key={n.id} className={i >= 5 ? 'max-[699px]:hidden' : ''}>
                  <button
                    type="button"
                    onClick={() => onSelect(n.id)}
                    aria-pressed={selected === n.id}
                    className={`flex min-h-11 w-full items-center gap-2 rounded-[8px] border px-2 text-left font-mono text-[12px] transition-colors hover:border-gold ${selected === n.id ? 'border-gold' : 'border-line'}`}
                  >
                    {kind === 'token' && m.token.symbol ? (
                      <TokenLogo symbol={m.token.symbol} chain={m.chain.key} address={m.token.address} size={24} decorative />
                    ) : (
                      <Sphere hue={hue} size={24}>
                        <Icon size={12} strokeWidth={2.2} color="#0d141c" aria-hidden />
                      </Sphere>
                    )}
                    <span className="flex min-w-0 flex-1 flex-col leading-[1.2]">
                      <span className="truncate text-ink">{n.label?.name ?? n.short}</span>
                      <span className="flex items-center gap-2">
                        <span className="text-[10px] tracking-[0.5px] text-dim uppercase">{kind ? KIND_WORD[kind] : 'wallet'}</span>
                        <span className="h-[3px] min-w-0 flex-1 overflow-hidden rounded-full bg-surface">
                          <span
                            className="block h-full rounded-full"
                            style={{
                              width: seen ? `${Math.max(2, (p / max) * 100)}%` : '0%',
                              transition: ease,
                              background: hue,
                            }}
                          />
                        </span>
                      </span>
                    </span>
                    <span className="w-14 flex-none text-right font-semibold text-gold-hover">{fmtPct(p)}</span>
                  </button>
                </li>
              )
            })}
          </ol>
        </div>
      )}
    </section>
  )
}
