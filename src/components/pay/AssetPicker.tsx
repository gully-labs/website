import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { PayAsset } from '../../pages/developers/api'
import { byChain } from './assets'
import { ChainLogo } from '../logos/ChainLogo'
import { TokenLogo } from '../logos/TokenLogo'
import { chainMark } from '../logos/registry'

/* Chain + asset picker for Gully Pay, with each chain's and asset's official mark (public/chains,
   public/tokens; sources in their SOURCES.json). Compact: one row of chain chips (it scrolls sideways with a
   soft fade at the edges when the chains do not fit), then the chosen chain's token chips only. Choosing a
   chain changes nothing but which tokens show; choosing a token is what calls onChange, as before. */

export function ChainMark({ chainKey, name, size = 24 }: { chainKey: string; name: string; size?: 12 | 16 | 20 | 24 | 32 }) {
  return <ChainLogo chain={chainMark(chainKey) ? chainKey : name} size={size} decorative />
}

/** An asset's mark with its chain's mark in the corner (USDC on Base, ETH on Arbitrum…). */
export function AssetMark({ asset }: { asset: Pick<PayAsset, 'symbol' | 'chainKey' | 'chain'> & Partial<Pick<PayAsset, 'address'>> }) {
  return (
    <span className="relative inline-flex size-6 flex-none" aria-hidden>
      <TokenLogo symbol={asset.symbol} chain={asset.chainKey} address={asset.address} size={24} decorative />
      <span className="absolute -right-[4px] -bottom-[4px] inline-flex rounded-full bg-bg p-px">
        <ChainMark chainKey={asset.chainKey} name={asset.chain} size={12} />
      </span>
    </span>
  )
}


const FADE = 28

/** A horizontally scrolling row whose edges fade out while there is more to scroll to. */
function ChipRow({ children, scrollToKey }: { children: ReactNode; scrollToKey: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const [edge, setEdge] = useState({ l: false, r: false })
  const measure = () => {
    const el = ref.current
    if (!el) return
    const l = el.scrollLeft > 2
    const r = el.scrollLeft + el.clientWidth < el.scrollWidth - 2
    setEdge((e) => (e.l === l && e.r === r ? e : { l, r }))
  }
  useEffect(() => {
    measure()
    const el = ref.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  // Bring the chosen chip into view inside the row (never scrolls the page).
  useEffect(() => {
    const el = ref.current
    const on = el?.querySelector<HTMLElement>('[aria-checked="true"]')
    if (el && on) el.scrollTo({ left: Math.max(0, on.offsetLeft - (el.clientWidth - on.offsetWidth) / 2), behavior: 'smooth' })
    measure()
  }, [scrollToKey])
  const mask = `linear-gradient(to right, ${edge.l ? 'transparent' : '#000'} 0, #000 ${FADE}px, #000 calc(100% - ${FADE}px), ${edge.r ? 'transparent' : '#000'} 100%)`
  return (
    <div ref={ref} onScroll={measure} className="flex gap-2 overflow-x-auto overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" style={{ maskImage: mask, WebkitMaskImage: mask }} data-edge-l={edge.l} data-edge-r={edge.r}>
      {children}
    </div>
  )
}

/** `showFee` (merchant checkouts): says for the chosen chain whether the store's Gully Pay fee rides inside a stablecoin payment or is invoiced. */
export function AssetPicker({ assets, value, onChange, disabled = false, showFee = false }: { assets: PayAsset[]; value: string | null; onChange: (id: string) => void; disabled?: boolean; showFee?: boolean }) {
  const groups = byChain(assets)
  const chosen = assets.find((a) => a.id === value)
  const [tap, setTap] = useState<{ chainId: number; at: string | null } | null>(null)
  // The chain just tapped (until a token is chosen); else the chosen token's chain; else the first one.
  const picked = tap && tap.at === value ? tap.chainId : null
  const chainId = groups.some((g) => g.chainId === picked) ? picked : (chosen?.chainId ?? groups[0]?.chainId ?? null)
  const group = groups.find((g) => g.chainId === chainId)
  if (!group) return null
  return (
    <div className="flex flex-col gap-2" data-testid="asset-picker">
      <ChipRow scrollToKey={String(group.chainId)}>
        <div role="radiogroup" aria-label="Network" className="flex gap-2">
          {groups.map((g) => {
            const on = g.chainId === group.chainId
            return (
              <button
                key={g.chainId}
                type="button"
                role="radio"
                aria-checked={on}
                aria-label={`${g.chain} network`}
                data-chain={g.chainKey}
                disabled={disabled}
                onClick={() => setTap({ chainId: g.chainId, at: value })}
                className={`inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-btn border px-3 text-[13px] whitespace-nowrap transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${on ? 'border-gold bg-[rgba(0,210,255,.08)] text-ink' : 'border-line-strong text-ink-2 hover:border-gold hover:text-ink'}`}
              >
                <ChainMark chainKey={g.chainKey} name={g.chain} size={20} />
                {g.chain}
              </button>
            )
          })}
        </div>
      </ChipRow>
      <div role="radiogroup" aria-label="Pay with" className="flex flex-wrap gap-2">
        {group.assets.map((a) => {
          const on = value === a.id
          return (
            <button
              key={a.id}
              type="button"
              role="radio"
              aria-checked={on}
              aria-label={`${a.symbol} on ${a.chain}`}
              data-asset={a.id}
              disabled={disabled}
              onClick={() => onChange(a.id)}
              className={`inline-flex min-h-11 items-center justify-center gap-[6px] rounded-btn border px-[10px] font-mono text-[13px] transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${on ? 'border-gold bg-[rgba(0,210,255,.08)] text-gold' : 'border-line-strong text-ink-2 hover:border-gold hover:text-ink'}`}
            >
              <TokenLogo symbol={a.symbol} chain={a.chainKey} address={a.address} size={20} decorative />
              {a.symbol}
              <span className={`text-[11px] ${on ? 'text-gold' : 'text-faint'}`}>{a.kind === 'native' ? 'coin' : 'stable'}</span>
            </button>
          )
        })}
      </div>
      {showFee && <span className="font-mono text-[11px] tracking-[.5px] text-faint">{group.assets.some((a) => a.feeSplit) ? `ON ${group.chain.toUpperCase()}: FEE IN THE PAYMENT` : `ON ${group.chain.toUpperCase()}: FEE INVOICED`}</span>}
    </div>
  )
}
