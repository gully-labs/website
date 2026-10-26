import { Check, ExternalLink, ShieldCheck } from 'lucide-react'

/* The "Secured by Gully Pay" seal of every checkout page (invoices, pay links, stores, receipts).
   - full: under the Pay button and on the receipt: the shield, the Gully Pay mark and the three facts, the
     only place the page says in plain words where the money goes (the header and footer carry the badge).
   - small: the badge in the header beside the Non-custodial pill.
   Gully Labs' own checkouts link the treasury address on the chain's explorer (the address the server's
   checkout config / quote gives: nothing is hard-coded here) and call it a 2-of-3 Safe, which it is on
   every EVM chain we offer (src/content/contracts.ts); Solana's treasury is not claimed to be a Safe.
   A store's checkout says the funds go to the store's own wallet and shows no Gully treasury link.
   The mark is public/brand/gully-mark-96.png, the kit's mascot disc. */

export const GULLY_MARK_SRC = '/brand/gully-mark-96.png'

export interface SecuredByProps {
  variant?: 'full' | 'small'
  /** The store's name on a merchant checkout; null/undefined on Gully Labs' own. */
  merchant?: string | null
  /** The address that receives the payment on Gully Labs' own checkout (the config's / quote's treasury). */
  treasury?: string | null
  /** The explorer page of that address on the chain being paid. */
  treasuryHref?: string | null
  /** False where the treasury is not a Safe (Solana): the link then makes no Safe claim. */
  safe?: boolean
  /** On the white receipt page. */
  light?: boolean
  className?: string
}

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`

function Mark({ size }: { size: number }) {
  return <img src={GULLY_MARK_SRC} alt="" width={size} height={size} className="shrink-0 rounded-full" style={{ width: size, height: size }} decoding="async" />
}

export function SecuredBy({ variant = 'full', merchant = null, treasury = null, treasuryHref = null, safe = true, light = false, className = '' }: SecuredByProps) {
  if (variant === 'small') {
    return (
      <span className={`inline-flex shrink-0 items-center gap-[6px] rounded-full border border-line-strong px-3 py-[6px] text-[12px] font-medium text-ink-2 ${className}`} data-testid="secured-by-small" title="Secured by Gully Pay: your payment is read on chain and counted once it has enough confirmations.">
        <ShieldCheck size={14} className="text-gold" aria-hidden />
        <Mark size={16} />
        <span className="max-[419px]:sr-only">Secured by Gully Pay</span>
      </span>
    )
  }
  const link = !merchant && treasury ? treasuryHref : null
  const tone = light ? 'border-[#dde2e8] bg-[#f6f8fa] text-[#242140]' : 'border-line bg-bg text-ink-2'
  const faint = light ? 'text-[#6b7090]' : 'text-faint'
  return (
    <aside className={`flex flex-col gap-2 rounded-input border px-3 py-3 ${tone} ${className}`} aria-label="Secured by Gully Pay" data-testid="secured-by">
      <span className={`inline-flex items-center gap-2 font-mono text-[11px] tracking-[1px] ${light ? 'text-[#1f6b4f]' : 'text-green'}`}>
        <ShieldCheck size={15} aria-hidden />
        <Mark size={18} />
        SECURED BY GULLY PAY
      </span>
      <ul className="m-0 flex list-none flex-col gap-[6px] p-0 text-[12.5px] leading-[1.45]">
        <li className="flex items-start gap-2" data-testid="seal-noncustodial">
          <Check size={13} className="mt-[3px] shrink-0 text-green" aria-hidden />
          <span>
            <b className="font-semibold">Non-custodial:</b> goes straight to {merchant ? `${merchant}’s own wallet` : 'the Gully Labs treasury'}, nobody holds it in between.
          </span>
        </li>
        {!merchant && treasury && (
          <li className="flex items-start gap-2" data-testid="seal-treasury">
            <Check size={13} className="mt-[3px] shrink-0 text-green" aria-hidden />
            <span>
              <b className="font-semibold">Treasury:</b>{' '}
              {link ? (
                <a href={link} target="_blank" rel="noopener noreferrer" className="inline-flex flex-wrap items-center gap-x-1 underline underline-offset-4 hover:text-gold" data-testid="seal-treasury-link">
                  {safe ? 'verified 2-of-3 Safe' : 'address on the explorer'} <span className={`font-mono text-[11px] ${faint}`}>{short(treasury)}</span> <ExternalLink size={11} aria-hidden />
                  <span className="sr-only"> (opens in a new tab)</span>
                </a>
              ) : (
                <span>{safe ? 'verified 2-of-3 Safe' : 'address'} <span className={`font-mono text-[11px] ${faint}`}>{short(treasury)}</span></span>
              )}
            </span>
          </li>
        )}
        <li className="flex items-start gap-2" data-testid="seal-onchain">
          <Check size={13} className="mt-[3px] shrink-0 text-green" aria-hidden />
          <span>
            <b className="font-semibold">Confirmed on chain:</b> the server reads it from a public node and marks it paid after enough confirmations.
          </span>
        </li>
      </ul>
    </aside>
  )
}
