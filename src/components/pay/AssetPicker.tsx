import type { PayAsset } from '../../pages/developers/api'
import { byChain } from './assets'
import { ChainLogo } from '../logos/ChainLogo'
import { TokenLogo } from '../logos/TokenLogo'
import { chainMark } from '../logos/registry'

/* Chain + asset picker for Gully Pay, with each chain's and asset's official mark (public/chains,
   public/tokens; sources in their SOURCES.json). */

export function ChainMark({ chainKey, name, size = 24 }: { chainKey: string; name: string; size?: 12 | 16 | 20 | 24 | 32 }) {
  return <ChainLogo chain={chainMark(chainKey) ? chainKey : name} size={size} decorative />
}

/** An asset's mark with its chain's mark in the corner (USDC on Base, ETH on Arbitrum…). */
export function AssetMark({ asset }: { asset: Pick<PayAsset, 'symbol' | 'chainKey' | 'chain'> }) {
  return (
    <span className="relative inline-flex size-6 flex-none" aria-hidden>
      <TokenLogo symbol={asset.symbol} size={24} decorative />
      <span className="absolute -right-[4px] -bottom-[4px] inline-flex rounded-full bg-bg p-px">
        <ChainMark chainKey={asset.chainKey} name={asset.chain} size={12} />
      </span>
    </span>
  )
}

/** `showFee` (merchant checkouts): says per chain whether the store's Gully Pay fee rides inside a stablecoin payment or is invoiced. */
export function AssetPicker({ assets, value, onChange, disabled = false, showFee = false }: { assets: PayAsset[]; value: string | null; onChange: (id: string) => void; disabled?: boolean; showFee?: boolean }) {
  return (
    <div role="radiogroup" aria-label="Pay with" className="flex flex-col gap-2">
      {byChain(assets).map((g) => (
        <div key={g.chainId} className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-input border border-line bg-surface-deep px-3 py-2">
          <span className="flex w-[132px] shrink-0 flex-col items-start gap-[2px] text-[14px] text-ink-2 max-[600px]:w-full">
            <span className="flex items-center gap-2">
              <ChainMark chainKey={g.chainKey} name={g.chain} size={24} />
              {g.chain}
            </span>
            {showFee && <span className="font-mono text-[11px] tracking-[.5px] text-faint">{g.assets.some((a) => a.feeSplit) ? 'FEE IN THE PAYMENT' : 'FEE INVOICED'}</span>}
          </span>
          <div className="flex flex-1 flex-wrap gap-2">
            {g.assets.map((a) => {
              const on = value === a.id
              return (
                <button
                  key={a.id}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  aria-label={`${a.symbol} on ${a.chain}`}
                  disabled={disabled}
                  onClick={() => onChange(a.id)}
                  className={`inline-flex min-h-11 min-w-[84px] items-center justify-center gap-2 rounded-btn border px-3 font-mono text-[13px] transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${on ? 'border-gold bg-[rgba(217,181,99,.08)] text-gold' : 'border-line-strong text-ink-2 hover:border-gold hover:text-ink'}`}
                >
                  <TokenLogo symbol={a.symbol} size={20} decorative />
                  {a.symbol}
                  <span className={`text-[11px] tracking-[.5px] ${on ? 'text-gold' : 'text-faint'}`}>{a.kind === 'native' ? 'COIN' : 'STABLE'}</span>
                </button>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}
