import { Link } from 'react-router'
import { ScanSearch } from 'lucide-react'
import { holdersPagePath } from '../../lib/holders'

/* A small "Holders" chip that opens a token's Holder Map (/holders/<chain>/<token>, or /holders
   when no token is named, as on a launchpad's card). Wherever a token appears
   it is the same control: an icon and the word, 32 px high on a desk and a 44 px tap target on phones.
   `iconOnly` drops the word where space is tight (the label stays for screen readers). */
export function HoldersChip({ chain, token, symbol, iconOnly = false, className = '' }: { chain?: string; token?: string; symbol?: string | null; iconOnly?: boolean; className?: string }) {
  return (
    <Link
      to={chain && token ? holdersPagePath(chain, token) : '/holders'}
      data-holders-chip
      aria-label={`Holder Map of ${symbol ?? 'this token'}`}
      title="Who holds it? Open the Holder Map"
      className={`inline-flex h-8 flex-none items-center justify-center gap-1 rounded-btn border border-gold-line px-2 text-[12px] whitespace-nowrap text-gold transition-colors hover:border-gold hover:text-gold max-[599px]:min-h-11 max-[599px]:min-w-11 ${className}`}
    >
      <ScanSearch aria-hidden size={14} />
      {!iconOnly && <span>Holders</span>}
    </Link>
  )
}
