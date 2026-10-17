import type { PayAsset } from '../../pages/developers/api'
import { byChain } from './assets'

/* Chain + asset picker for Gully Pay. Only BNB Chain has a logo in public/chains (from its own listing);
   Base, Ethereum and Arbitrum get a neutral monogram rather than a drawn logo. */

const CHAIN_LOGO: Record<string, string> = { bnb: '/chains/bnb.png' }

export function ChainMark({ chainKey, name, size = 22 }: { chainKey: string; name: string; size?: number }) {
  const logo = CHAIN_LOGO[chainKey]
  if (logo) return <img src={logo} alt="" width={size} height={size} className="shrink-0 rounded-full" style={{ width: size, height: size }} />
  return (
    <span aria-hidden className="inline-flex shrink-0 items-center justify-center rounded-full border border-line-strong bg-surface-deep font-mono font-medium text-muted" style={{ width: size, height: size, fontSize: Math.round(size * 0.45) }}>
      {name.charAt(0).toUpperCase()}
    </span>
  )
}

export function AssetPicker({ assets, value, onChange, disabled = false }: { assets: PayAsset[]; value: string | null; onChange: (id: string) => void; disabled?: boolean }) {
  return (
    <div role="radiogroup" aria-label="Pay with" className="flex flex-col gap-2">
      {byChain(assets).map((g) => (
        <div key={g.chainId} className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-input border border-line bg-surface-deep px-3 py-2">
          <span className="flex w-[132px] shrink-0 items-center gap-2 text-[14px] text-ink-2">
            <ChainMark chainKey={g.chainKey} name={g.chain} />
            {g.chain}
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
                  className={`inline-flex min-h-11 min-w-[84px] items-center justify-center gap-2 rounded-btn border px-3 font-mono text-[13px] transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${on ? 'border-gold bg-[rgba(232,192,96,.08)] text-gold' : 'border-line-strong text-ink-2 hover:border-gold hover:text-ink'}`}
                >
                  {a.symbol}
                  <span className={`text-[10px] tracking-[.5px] ${on ? 'text-gold' : 'text-faint'}`}>{a.kind === 'native' ? 'COIN' : 'STABLE'}</span>
                </button>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}
