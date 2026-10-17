import { ArrowLeft, ShieldCheck } from 'lucide-react'
import { useMemo, useState, type KeyboardEvent, type ReactNode } from 'react'
import { QuotePay } from '../../components/pay/QuotePay'
import type { Offer, PayAsset, Quote, Result } from './api'
import { defaultAsset, priceText } from './helpers'
import { chip, pillGold } from './styles'

/* Gully Pay in the console's language: chain chips, asset chips and the price, then the live quote
   (components/pay/QuotePay: exact amount, treasury, pay with the connected wallet or paste the hash,
   confirmations). Chains and assets come from GET /api/plans; a stablecoin costs the plan's USD
   price, a chain's own coin is priced from Chainlink when the quote opens. */

/** The chain and asset chips, as two radio groups. */
export function ChainAssetChips({ assets, value, onChange, disabled }: { assets: PayAsset[]; value: string | null; onChange: (id: string) => void; disabled?: boolean }) {
  const chains = useMemo(() => {
    const out: { id: number; name: string }[] = []
    for (const a of assets) if (!out.some((c) => c.id === a.chainId)) out.push({ id: a.chainId, name: a.chain })
    return out
  }, [assets])
  const cur = assets.find((a) => a.id === value) ?? null
  const chainId = cur?.chainId ?? chains[0]?.id
  const onChain = assets.filter((a) => a.chainId === chainId)
  const pickChain = (id: number) => {
    const same = assets.find((a) => a.chainId === id && a.symbol === cur?.symbol)
    const first = same ?? assets.find((a) => a.chainId === id)
    if (first) onChange(first.id)
  }
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <RadioRow label="Chain">
        {chains.map((c) => (
          <Radio key={c.id} on={c.id === chainId} disabled={disabled} onPick={() => pickChain(c.id)}>
            {c.name}
          </Radio>
        ))}
      </RadioRow>
      <RadioRow label="Asset">
        {onChain.map((a) => (
          <Radio key={a.id} on={a.id === value} disabled={disabled} onPick={() => onChange(a.id)} mono>
            {a.symbol}
          </Radio>
        ))}
      </RadioRow>
    </div>
  )
}

function RadioRow({ label, children }: { label: string; children: ReactNode }) {
  // Arrow keys move between the chips of one group, as in a native radio group.
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return
    const items = [...e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="radio"]:not([disabled])')]
    const i = items.indexOf(document.activeElement as HTMLButtonElement)
    if (i < 0) return
    e.preventDefault()
    const next = items[(i + (e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 1) + items.length) % items.length]
    next.focus()
    next.click()
  }
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-[6px]" onKeyDown={onKey}>
      {children}
    </div>
  )
}

function Radio({ on, onPick, children, mono, disabled }: { on: boolean; onPick: () => void; children: ReactNode; mono?: boolean; disabled?: boolean }) {
  return (
    <button type="button" role="radio" aria-checked={on} tabIndex={on ? 0 : -1} disabled={disabled} onClick={onPick} className={chip(on, mono)}>
      {children}
    </button>
  )
}

/**
 * The whole checkout for one plan: chips and price, then (after "Get the quote") QuotePay with that
 * asset. Going back to the chips drops the quote; a payment already sent can be checked again with its hash.
 */
export function PayFlow({
  offer,
  usd,
  label,
  initialAsset,
  autoQuote = false,
  getQuote,
  verify,
  onPaid,
}: {
  offer: Offer
  usd: number
  label: string
  initialAsset?: string | null
  autoQuote?: boolean
  getQuote: (assetId: string) => Promise<Result<{ quote: Quote }>>
  verify: (q: Quote, txHash: string) => Promise<Result<unknown>>
  onPaid: (data: unknown) => void
}) {
  const [asset, setAsset] = useState<string | null>(() => defaultAsset(offer.assets, initialAsset))
  const [quoting, setQuoting] = useState(autoQuote && !!asset)
  const cur = offer.assets.find((a) => a.id === asset) ?? null

  if (quoting && asset && cur)
    return (
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-[14px] text-muted">
            Paying with <b className="font-medium text-ink">{cur.symbol}</b> on <b className="font-medium text-ink">{cur.chain}</b>
          </span>
          <button type="button" onClick={() => setQuoting(false)} className="inline-flex min-h-11 items-center gap-2 rounded-full px-3 font-mono text-[12px] text-muted hover:text-ink">
            <ArrowLeft size={14} aria-hidden /> Change chain or asset
          </button>
        </div>
        <QuotePay key={asset} assets={offer.assets} label={label} match="wallet" initialAsset={asset} showPicker={false} getQuote={getQuote} verify={verify} onPaid={(d) => onPaid(d)} />
      </div>
    )

  return (
    <div className="flex flex-wrap items-center gap-5">
      <div className="min-w-0 flex-[2_1_380px]">
        <ChainAssetChips assets={offer.assets} value={asset} onChange={setAsset} />
      </div>
      <div className="flex flex-[1_1_220px] flex-col items-end gap-2 max-[600px]:items-stretch">
        <span className="font-display text-[32px] leading-none font-bold" aria-live="polite">
          {priceText(cur, usd)}
        </span>
        {cur?.kind === 'native' && <span className="text-right font-mono text-[11px] text-faint">priced from Chainlink when the quote opens</span>}
        <button type="button" disabled={!cur || !offer.checkout.enabled} onClick={() => setQuoting(true)} className={`${pillGold} px-5`}>
          {offer.checkout.enabled ? `Pay on ${cur?.chain ?? '…'}` : 'Not on sale yet'}
        </button>
      </div>
      <p className="m-0 flex w-full items-start gap-2 text-[12px] leading-[1.6] text-faint">
        <ShieldCheck size={14} className="mt-[2px] shrink-0 text-gold" aria-hidden />
        Straight from your wallet to the Gully Labs treasury; no custody, no card, nothing renews by itself. The server reads the transfer on its chain before the plan starts.
      </p>
    </div>
  )
}
