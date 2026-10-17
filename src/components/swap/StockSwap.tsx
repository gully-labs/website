import { lazy, Suspense, useEffect, useState } from 'react'
import { ArrowUpRight, Globe, Loader2 } from 'lucide-react'
import type { TrackerRow } from '../../lib/tracker'
import { feeText, NATIVE_SYMBOL, SWAP_CHAIN_ID } from './swapConfig'

/* The swap card on a stock page. Three gates before the LI.FI widget's chunk is even fetched:
   1. the chain is one LI.FI serves (Robinhood Chain, BNB Chain);
   2. GET /api/geo says this region may see it (server/geo.mjs; fails closed when it cannot be read);
   3. the visitor ticks "I understand" under the notice (remembered in this browser only). */

const SwapWidget = lazy(() => import('./SwapWidget'))

const ACK_KEY = 'gully-swap-ack-v1'
const readAck = () => {
  try {
    return localStorage.getItem(ACK_KEY) === '1'
  } catch {
    return false
  }
}
const writeAck = (on: boolean) => {
  try {
    if (on) localStorage.setItem(ACK_KEY, '1')
    else localStorage.removeItem(ACK_KEY)
  } catch {
    /* private mode: the tick lasts for this page only */
  }
}

type Geo = { k: 'loading' } | { k: 'error' } | { k: 'ok'; country: string | null; allowed: boolean; reason: string }

function useGeo(): Geo {
  const [geo, setGeo] = useState<Geo>({ k: 'loading' })
  useEffect(() => {
    let live = true
    fetch('/api/geo', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((g: { country: string | null; allowed: boolean; reason: string }) => live && setGeo({ k: 'ok', country: g.country, allowed: g.allowed === true, reason: g.reason }))
      .catch(() => live && setGeo({ k: 'error' }))
    return () => {
      live = false
    }
  }, [])
  return geo
}

const note = 'flex items-start gap-3 rounded-input border border-line-strong bg-surface-deep p-4 text-[14px] leading-[1.55] text-ink-2'

function Unavailable({ children, row }: { children: React.ReactNode; row: TrackerRow }) {
  return (
    <div className="flex flex-col gap-3">
      <p className={`m-0 ${note}`} role="status">
        <Globe aria-hidden size={18} className="mt-[2px] shrink-0 text-gold" />
        <span>{children}</span>
      </p>
      {row.pool?.url && (
        <a href={row.pool.url} target="_blank" rel="noopener" className="inline-flex items-center gap-1 text-[14px] text-muted hover:text-gold">
          See the pool on DexScreener (information only) <ArrowUpRight aria-hidden size={14} />
        </a>
      )}
    </div>
  )
}

export function StockSwap({ row }: { row: TrackerRow }) {
  const geo = useGeo()
  const [ack, setAck] = useState(readAck)
  const chainId = SWAP_CHAIN_ID[row.chain]

  if (!chainId) return <Unavailable row={row}>Swapping isn't offered for tokens on this chain.</Unavailable>
  if (geo.k === 'loading')
    return (
      <p className="m-0 inline-flex items-center gap-2 text-[14px] text-faint" role="status">
        <Loader2 aria-hidden size={16} className="animate-spin" /> Checking whether swapping is available in your region…
      </p>
    )
  if (geo.k === 'error') return <Unavailable row={row}>Swapping is unavailable right now: we could not check your region. Try again later.</Unavailable>
  if (!geo.allowed)
    return (
      <Unavailable row={row}>
        {geo.reason === 'blocked' ? <>Swapping this token isn't available in your region.</> : <>Swapping this token isn't available because your region could not be determined.</>}
      </Unavailable>
    )

  return (
    <div className="flex flex-col gap-4">
      <ul className="m-0 flex list-none flex-col gap-2 p-0 text-[13px] leading-[1.55] text-muted">
        <li>Swaps are routed by LI.FI and executed by third-party exchanges. Your wallet signs every transaction; Gully Labs never holds your funds.</li>
        <li>{row.ticker} is a token issued by a third party that can pause, block or change it. It tracks {row.name} stock but is not the share itself, and it is not available to US persons.</li>
        <li>Information only, not investment advice. Prices move, and swaps carry fees and slippage. {feeText()}</li>
      </ul>
      <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-input border border-line-strong px-4 text-[14px] text-ink hover:border-gold">
        <input
          type="checkbox"
          checked={ack}
          onChange={(e) => {
            setAck(e.target.checked)
            writeAck(e.target.checked)
          }}
          className="size-4 accent-gold"
        />
        I understand
      </label>
      {ack && (
        <Suspense
          fallback={
            <p className="m-0 inline-flex items-center gap-2 text-[14px] text-faint" role="status">
              <Loader2 aria-hidden size={16} className="animate-spin" /> Loading the swap…
            </p>
          }
        >
          {/* Full card width: the widget's own 24px padding lines up with the card's. */}
          <div className="-mx-6 -mb-6 overflow-hidden rounded-b-card border-t border-line">
            <SwapWidget chainId={chainId} token={row.token} />
          </div>
        </Suspense>
      )}
      {!ack && <p className="m-0 text-[12px] text-faint">Tick the box to load the swap. Pay with {NATIVE_SYMBOL[row.chain]} or any token LI.FI routes on this chain, or sell {row.ticker} back.</p>}
    </div>
  )
}
