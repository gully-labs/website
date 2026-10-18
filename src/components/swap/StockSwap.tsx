import { lazy, Suspense, useEffect, useState } from 'react'
import { BellRing, CircleHelp, Globe, ChartLine, Loader2 } from 'lucide-react'
import { NewTabMark } from '../LayoutLinks'
import { newTab } from '../LayoutNav'
import type { TrackerRow } from '../../lib/tracker'
import { feeText, jupiterFeeText, NATIVE_SYMBOL, SWAP_CHAIN_ID } from './swapConfig'
import { DeepCoreQuote } from './DeepCoreQuote'

/* The swap card on a stock page. Three gates before the LI.FI widget's chunk is even fetched:
   1. the chain is one LI.FI serves (Robinhood Chain, BNB Chain);
   2. GET /api/geo says this region may see it (server/geo.mjs; fails closed when it cannot be read);
   3. the visitor ticks "I understand" under the notice (remembered in this browser only). */

const SwapWidget = lazy(() => import('./SwapWidget'))
// Solana stock pages swap through Jupiter instead of LI.FI, behind the same three gates.
const JupiterSwap = lazy(() => import('./JupiterSwap'))

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

const note = 'flex items-start gap-3 rounded-input border border-line-strong bg-surface-deep px-4 py-3 text-[14px] leading-[1.55] text-ink-2'
const action = 'inline-flex min-h-11 items-center gap-2 rounded-btn border border-line-strong px-4 text-[14px] text-ink transition-colors hover:border-gold hover:text-ink'

/** No swap here: one line with the reason, then what the visitor can do instead (never a dead end). */
function Unavailable({ children, row, alerts }: { children: React.ReactNode; row: TrackerRow; alerts?: string }) {
  return (
    <div className="flex flex-col gap-3">
      <p className={`m-0 ${note}`} role="status">
        <Globe aria-hidden size={18} className="mt-[2px] shrink-0 text-gold" />
        <span>{children}</span>
      </p>
      <div className="flex flex-col gap-2">
        {alerts && (
          <a href={alerts} {...(/^https?:/.test(alerts) ? newTab : {})} className={`${action} border-gold-line`}>
            <BellRing aria-hidden size={16} className="flex-none text-gold" /> Get a gap alert for {row.ticker}
            {/^https?:/.test(alerts) && <NewTabMark size={14} />}
          </a>
        )}
        {row.pool?.url && (
          <a href={row.pool.url} {...newTab} className={action}>
            <ChartLine aria-hidden size={16} className="flex-none text-gold" /> View the pool on DexScreener
            <NewTabMark size={14} />
          </a>
        )}
        <a href="#how-swaps-work" className={action}>
          <CircleHelp aria-hidden size={16} className="flex-none text-gold" /> How swaps work
        </a>
      </div>
    </div>
  )
}

export function StockSwap({ row, alerts }: { row: TrackerRow; alerts?: string }) {
  const geo = useGeo()
  const [ack, setAck] = useState(readAck)
  const chainId = SWAP_CHAIN_ID[row.chain]
  const solana = row.chain === 'solana'

  if (!chainId && !solana) return <Unavailable row={row} alerts={alerts}>Swapping isn't offered for tokens on this chain.</Unavailable>
  if (geo.k === 'loading')
    return (
      <div role="status" aria-label="Checking whether swapping is available in your region" className="flex flex-col gap-2">
        <span aria-hidden className="h-[46px] animate-[gl-skeleton_1.4s_ease-in-out_infinite] rounded-input bg-surface-deep" />
        <span aria-hidden className="h-11 w-[70%] animate-[gl-skeleton_1.4s_.15s_ease-in-out_infinite] rounded-btn bg-surface-deep" />
      </div>
    )
  if (geo.k === 'error') return <Unavailable row={row} alerts={alerts}>Swapping is unavailable right now: we could not check your region. Try again later.</Unavailable>
  if (!geo.allowed)
    return (
      <Unavailable row={row} alerts={alerts}>
        {geo.reason === 'blocked' ? (
          <>
            Swapping {row.ticker} isn't offered in your region{geo.country ? ` (${geo.country})` : ''}: stock tokens are not available to US persons or in sanctioned regions. You can still follow its gap.
          </>
        ) : (
          <>Swapping {row.ticker} isn't offered because your region could not be determined. You can still follow its gap.</>
        )}
      </Unavailable>
    )

  return (
    <div className="flex flex-col gap-4">
      <ul className="m-0 flex list-none flex-col gap-2 p-0 text-[13px] leading-[1.55] text-muted">
        <li>Swaps are routed by {solana ? 'Jupiter' : 'LI.FI'} and executed by third-party exchanges. Your wallet signs every transaction; Gully Labs never holds your funds.</li>
        <li>{row.ticker} is a token issued by a third party that can pause, block or change it. It tracks {row.name} stock but is not the share itself, and it is not available to US persons.</li>
        <li>Information only, not investment advice. Prices move, and swaps carry fees and slippage. {solana ? jupiterFeeText() : feeText()}</li>
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
      {ack && !solana && <DeepCoreQuote row={row} />}
      {ack && (
        <Suspense
          fallback={
            <p className="m-0 inline-flex items-center gap-2 text-[14px] text-faint" role="status">
              <Loader2 aria-hidden size={16} className="animate-spin" /> Loading the swap…
            </p>
          }
        >
          {/* Full card width: the widget's own 24px padding lines up with the card's. */}
          {solana ? (
            <JupiterSwap row={row} />
          ) : (
            <div className="-mx-6 -mb-6 overflow-hidden rounded-b-card border-t border-line">
              <SwapWidget chainId={chainId} token={row.token} chain={row.chain} ticker={row.ticker} />
            </div>
          )}
        </Suspense>
      )}
      {!ack && <p className="m-0 text-[12px] text-faint">Tick the box to load the swap. {solana ? `Pay with USDC or SOL through Jupiter, or sell ${row.ticker} back.` : `Pay with ${NATIVE_SYMBOL[row.chain]} or any token LI.FI routes on this chain, or sell ${row.ticker} back.`}</p>}
    </div>
  )
}
