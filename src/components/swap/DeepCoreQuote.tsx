import { useEffect, useState } from 'react'
import { ArrowUpRight, Loader2, Route } from 'lucide-react'
import type { TrackerRow } from '../../lib/tracker'
import { NATIVE_SYMBOL } from './swapConfig'
import { TokenLogo } from '../logos/TokenLogo'

/* "DeepCore route": what DeepCore's router would give for the same payment as the LI.FI swap on this card
   (the chain's native coin in, this stock token out), for comparison only. It is mounted only where the swap
   itself is shown: after the region check and the visitor's "I understand". The quote comes from this site's
   own GET /api/deepcore/quote (server/deepcore.mjs), which caches and rate-limits DeepCore's router API, so the
   browser never calls DeepCore directly. Nothing is executed here: "Swap on DeepCore" opens deepcore.fun. */

interface Quote {
  chain: string
  ticker: string
  pay: { symbol: string; amount: string }
  out: { symbol: string; amount: string | null; minimum: string | null }
  priceImpactPct: number | null
  slippagePct: number | null
  fee: { pct: number; amount: string | null; symbol: string; exempt: boolean } | null
  onDeepcorePool: boolean
  route: { venues: string[]; hops: { venue: string; from: string; to: string }[] }
  alternatives: { venue: string; out: string | null }[]
  quotedAt: string | null
  links: { swap: string; token: string }
}

type State = { k: 'idle' } | { k: 'loading' } | { k: 'ok'; q: Quote; cached: boolean } | { k: 'error'; msg: string; links?: { swap: string; token: string } }

const DEFAULT_AMOUNT: Record<string, string> = { robinhood: '0.1', bsc: '0.5' }
const AMOUNT_RE = /^\d{1,9}(\.\d{1,18})?$/

/** A decimal string shown with at most 6 significant digits, never via a lossy float for large values. */
function show(v: string | null): string {
  if (v === null) return 'unreadable'
  const n = Number(v)
  if (!Number.isFinite(n)) return v
  return n.toLocaleString('en-US', { maximumSignificantDigits: 6 })
}

const utc = (iso: string) => new Date(iso).toISOString().slice(11, 19) + ' UTC'

export function DeepCoreQuote({ row }: { row: TrackerRow }) {
  const native = NATIVE_SYMBOL[row.chain] ?? 'native coin'
  const [amount, setAmount] = useState(DEFAULT_AMOUNT[row.chain] ?? '0.1')
  const [st, setSt] = useState<State>({ k: 'idle' })
  const valid = AMOUNT_RE.test(amount.trim()) && Number(amount) > 0 && Number(amount) <= 1000

  useEffect(() => {
    if (!valid) return
    let live = true
    const t = setTimeout(() => {
      setSt({ k: 'loading' })
      const q = new URLSearchParams({ chain: row.chain, token: row.token, amount: amount.trim() })
      fetch(`/api/deepcore/quote?${q}`)
        .then(async (r) => ({ r, j: await r.json().catch(() => null) }))
        .then(({ r, j }) => {
          if (!live) return
          if (r.ok && j?.quote) setSt({ k: 'ok', q: j.quote as Quote, cached: !!j.cached })
          else setSt({ k: 'error', msg: typeof j?.error === 'string' ? j.error : `The quote could not be read (HTTP ${r.status}).`, links: j?.links })
        })
        .catch(() => live && setSt({ k: 'error', msg: 'The quote could not be read just now.' }))
    }, 600)
    return () => {
      live = false
      clearTimeout(t)
    }
  }, [amount, valid, row.chain, row.token])

  const q = st.k === 'ok' ? st.q : null
  const links = q?.links ?? (st.k === 'error' ? st.links : undefined)

  return (
    <section aria-labelledby="dc-route-title" className="flex flex-col gap-3 rounded-input border border-line-strong bg-surface-deep p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id="dc-route-title" className="m-0 inline-flex items-center gap-2 text-[15px] font-semibold text-ink">
          <Route aria-hidden size={16} className="text-gold" /> DeepCore route
        </h3>
        <span className="rounded-full border border-line-strong px-2 py-[2px] font-mono text-[11px] uppercase tracking-wide text-muted">Comparison only</span>
      </div>
      <p className="m-0 text-[13px] leading-[1.55] text-muted">
        What DeepCore’s router quotes for the same payment, {native} for {row.ticker} on this chain. Type the amount you pay in the swap to compare its output.
      </p>
      <label className="flex items-center gap-2 text-[14px] text-ink-2">
        <span className="shrink-0">You pay</span>
        <input
          inputMode="decimal"
          aria-label={`Amount of ${native} to pay`}
          aria-invalid={!valid}
          value={amount}
          onChange={(e) => setAmount(e.target.value.replace(',', '.').slice(0, 24))}
          className="min-h-11 w-full min-w-0 rounded-input border border-line-strong bg-surface px-3 font-mono text-[14px] text-ink outline-none focus:border-gold"
        />
        <span className="shrink-0 font-mono text-[13px] text-muted">{native}</span>
      </label>
      {!valid && <p className="m-0 text-[12px] text-error">Enter an amount above 0 and at most 1000.</p>}

      <div aria-live="polite" className="min-h-[24px]">
        {valid && st.k === 'loading' && (
          <p className="m-0 inline-flex items-center gap-2 text-[13px] text-faint" role="status">
            <Loader2 aria-hidden size={14} className="animate-spin" /> Asking DeepCore’s router…
          </p>
        )}
        {valid && st.k === 'error' && <p className="m-0 text-[13px] text-ink-2">{st.msg}</p>}
        {valid && q && (
          <dl className="m-0 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-[13px]">
            <dt className="text-muted">You get</dt>
            <dd className="m-0 font-mono text-ink">
              <span className="inline-flex items-center gap-1.5">
                <TokenLogo symbol={q.out.symbol} chain={row.chain} address={row.token} size={16} decorative /> ≈ {show(q.out.amount)} {q.out.symbol}
              </span>
              {q.out.minimum !== null && q.slippagePct !== null && (
                <span className="block text-[12px] text-faint">
                  at least {show(q.out.minimum)} at {q.slippagePct}% slippage
                </span>
              )}
            </dd>
            <dt className="text-muted">Route</dt>
            <dd className="m-0 text-ink-2">
              {q.route.venues.join(' + ') || 'not stated'}
              {q.route.hops.length > 0 && <span className="block font-mono text-[12px] text-faint">{[q.route.hops[0].from, ...q.route.hops.map((h) => h.to)].join(' → ')}</span>}
            </dd>
            <dt className="text-muted">Fee</dt>
            <dd className="m-0 text-ink-2">
              {q.fee === null
                ? 'not stated'
                : q.onDeepcorePool || q.fee.exempt
                  ? 'No DeepCore routing fee (DeepCore pool)'
                  : `${q.fee.pct}% DeepCore routing fee at an external venue${q.fee.amount ? ` (${show(q.fee.amount)} ${q.fee.symbol})` : ''}`}
              <span className="block text-[12px] text-faint">Pool fees are inside the quoted output.</span>
            </dd>
            {q.priceImpactPct !== null && (
              <>
                <dt className="text-muted">Price impact</dt>
                <dd className="m-0 font-mono text-ink-2">{q.priceImpactPct.toFixed(2)}%</dd>
              </>
            )}
          </dl>
        )}
      </div>

      {valid && q?.quotedAt && (
        <p className="m-0 text-[12px] text-faint">
          Quoted {utc(q.quotedAt)} by api.deepcore.fun{st.k === 'ok' && st.cached ? ' (shared for up to 20 s)' : ''}. Quotes move with the market; compare with the LI.FI quote below at the same moment.
        </p>
      )}
      {links && (
        <a href={links.swap} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center gap-1 self-start text-[14px] text-gold hover:underline">
          Swap on DeepCore <ArrowUpRight aria-hidden size={14} />
        <span className="sr-only"> (opens in a new tab)</span></a>
      )}
      <p className="m-0 text-[12px] leading-[1.5] text-faint">Comparison only. Gully Labs does not route or execute swaps through DeepCore; the link opens deepcore.fun, where your wallet signs on DeepCore’s own page.</p>
    </section>
  )
}
