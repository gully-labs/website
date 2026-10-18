import { ArrowDownUp, ArrowUpRight, CheckCircle2, Loader2, Route, TriangleAlert } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { TrackerRow } from '../../lib/tracker'
import { SOLSCAN } from '../solana/constants'
import { signatureStatus, sendRaw } from '../solana/rpc'
import { WalletChooser } from '../solana/SolanaWallet'
import { useSolanaWallet } from '../solana/useSolanaWallet'
import { b58encode, fromBase64, toBase64 } from '../solana/tx'
import { signAndSend } from '../solana/walletStandard'
import { btnGold } from '../ui'
import { jupiterFeeText } from './swapConfig'

/* The swap card on a Solana stock page: Jupiter (the Solana swap aggregator) in place of LI.FI. Buy the
   xStock with SOL or USDC, or sell it back. The quote and the unsigned transaction come from this site's
   proxy (/api/solana/jupiter/*, server/jupiter.mjs: geo gate, caching, rate limits, the platform fee);
   the visitor's own wallet signs and sends it. Its own lazy chunk, loaded after the "I understand" tick. */

type Quote = {
  id: string
  side: 'buy' | 'sell'
  inSymbol: string
  outSymbol: string
  inAmount: string
  outAmount: string
  minOut: string
  priceImpactPct: number
  route: { label: string; percent: number }[]
  platformFee: { bps: number; amount: string; symbol: string } | null
  feeNote: string | null
  slippageBps: number
  expiresAt: string
}
type QState = { k: 'idle' } | { k: 'loading' } | { k: 'ok'; q: Quote } | { k: 'error'; message: string }
type Tx = { k: 'idle' } | { k: 'busy'; message: string } | { k: 'sent'; sig: string; status: string } | { k: 'done'; sig: string } | { k: 'error'; message: string; sig?: string }

const fmtAmt = (s: string) => {
  const n = Number(s)
  return Number.isFinite(n) ? n.toLocaleString('en-US', { maximumFractionDigits: n < 1 ? 6 : 4 }) : s
}

const field = 'h-11 w-full rounded-input border border-line-strong bg-bg px-3 font-mono text-[15px] text-ink outline-none transition-colors focus:border-gold'

export default function JupiterSwap({ row }: { row: TrackerRow }) {
  const sym = row.symbol ?? row.ticker
  const [side, setSide] = useState<'buy' | 'sell'>('buy')
  const [coin, setCoin] = useState<'SOL' | 'USDC'>('USDC')
  const [amount, setAmount] = useState('10')
  const [qs, setQs] = useState<QState>({ k: 'idle' })
  const [tx, setTx] = useState<Tx>({ k: 'idle' })
  const w = useSolanaWallet()
  const reqId = useRef(0)

  // Debounced quote on every change; the answer of a superseded request is dropped.
  useEffect(() => {
    const amt = amount.trim()
    const me = ++reqId.current
    if (!/^\d+(\.\d+)?$/.test(amt) || Number(amt) <= 0) return
    const t = setTimeout(async () => {
      setQs({ k: 'loading' })
      try {
        const r = await fetch(`/api/solana/jupiter/quote?ticker=${encodeURIComponent(row.ticker)}&side=${side}&with=${coin}&amount=${encodeURIComponent(amt)}`, { cache: 'no-store' })
        const j = (await r.json().catch(() => null)) as { quote?: Quote; error?: string } | null
        if (me !== reqId.current) return
        setQs(r.ok && j?.quote ? { k: 'ok', q: j.quote } : { k: 'error', message: j?.error ?? `The quote could not be read (${r.status}).` })
      } catch {
        if (me === reqId.current) setQs({ k: 'error', message: 'The quote could not be read just now.' })
      }
    }, 500)
    return () => clearTimeout(t)
  }, [row.ticker, side, coin, amount])

  const amountOk = /^\d+(\.\d+)?$/.test(amount.trim()) && Number(amount) > 0
  const q = amountOk && qs.k === 'ok' ? qs.q : null
  const busy = tx.k === 'busy' || tx.k === 'sent'

  const swap = async () => {
    if (!q || !w.conn) return
    setTx({ k: 'busy', message: 'Building the swap…' })
    try {
      const r = await fetch('/api/solana/jupiter/swap', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ quoteId: q.id, userPublicKey: w.conn.account.address }) })
      const j = (await r.json().catch(() => null)) as { swapTransaction?: string; error?: string } | null
      if (!r.ok || !j?.swapTransaction) throw new Error(j?.error ?? `The swap could not be built (${r.status}).`)
      setTx({ k: 'busy', message: 'Confirm in your wallet…' })
      const out = await signAndSend(w.conn.wallet, w.conn.account, fromBase64(j.swapTransaction), (signed) => sendRaw(toBase64(signed)))
      const sig = typeof out === 'string' ? out : b58encode(out)
      setTx({ k: 'sent', sig, status: 'sent' })
      for (let i = 0; i < 40; i++) {
        await new Promise((ok) => setTimeout(ok, 2_000))
        const st = await signatureStatus(sig).catch(() => null)
        if (st?.err) return setTx({ k: 'error', sig, message: 'The swap failed on chain (often the price moved past the slippage limit). Nothing was swapped; only the network fee was spent.' })
        if (st?.confirmationStatus === 'confirmed' || st?.confirmationStatus === 'finalized') return setTx({ k: 'done', sig })
        if (st?.confirmationStatus) setTx({ k: 'sent', sig, status: st.confirmationStatus })
      }
      setTx({ k: 'error', sig, message: 'Not confirmed after 80 seconds. Check the transaction on Solscan before trying again.' })
    } catch (e) {
      const m = String((e as Error)?.message ?? e)
      setTx({ k: 'error', message: /reject|denied|cancel|declined/i.test(m) ? 'The wallet request was declined. Nothing was sent.' : m.slice(0, 220) })
    }
  }

  const payLabel = side === 'buy' ? coin : sym
  const getLabel = side === 'buy' ? sym : coin

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-[1fr_auto] items-end gap-2">
        <label className="flex flex-col gap-1">
          <span className="font-mono text-[11px] tracking-[1px] text-faint">YOU PAY · {payLabel}</span>
          <input className={field} value={amount} onChange={(e) => setAmount(e.target.value.replace(',', '.'))} inputMode="decimal" aria-label={`Amount of ${payLabel} to pay`} disabled={busy} />
        </label>
        {side === 'buy' ? (
          <div role="radiogroup" aria-label="Pay with" className="flex h-11 overflow-hidden rounded-input border border-line-strong">
            {(['USDC', 'SOL'] as const).map((c) => (
              <button key={c} type="button" role="radio" aria-checked={coin === c} onClick={() => setCoin(c)} disabled={busy} className={`min-w-[58px] px-3 font-mono text-[12px] ${coin === c ? 'bg-gold text-bg' : 'text-muted hover:text-ink'}`}>
                {c}
              </button>
            ))}
          </div>
        ) : (
          <span className="flex h-11 items-center px-2 font-mono text-[12px] text-muted">{sym}</span>
        )}
      </div>
      <button
        type="button"
        onClick={() => {
          setSide((s) => (s === 'buy' ? 'sell' : 'buy'))
          setAmount(side === 'buy' ? '0.1' : '10')
        }}
        disabled={busy}
        className="inline-flex min-h-10 items-center justify-center gap-2 self-center rounded-btn border border-line-strong px-3 font-mono text-[12px] text-muted hover:border-gold hover:text-gold"
      >
        <ArrowDownUp size={13} aria-hidden /> {side === 'buy' ? `Sell ${sym} instead` : `Buy ${sym} instead`}
      </button>
      {side === 'sell' && (
        <div role="radiogroup" aria-label="Receive" className="flex h-10 self-start overflow-hidden rounded-input border border-line-strong">
          {(['USDC', 'SOL'] as const).map((c) => (
            <button key={c} type="button" role="radio" aria-checked={coin === c} onClick={() => setCoin(c)} disabled={busy} className={`px-3 font-mono text-[12px] ${coin === c ? 'bg-gold text-bg' : 'text-muted hover:text-ink'}`}>
              for {c}
            </button>
          ))}
        </div>
      )}

      <div className="flex flex-col gap-2 rounded-input border border-line bg-surface-deep px-4 py-3" aria-live="polite">
        <span className="font-mono text-[11px] tracking-[1px] text-faint">YOU GET · {getLabel}</span>
        {!amountOk ? (
          <span className="text-[13px] text-faint">Enter an amount to get a quote.</span>
        ) : qs.k === 'loading' || qs.k === 'idle' ? (
          <span className="inline-flex items-center gap-2 text-[13px] text-muted" role="status">
            <Loader2 size={14} className="animate-spin" aria-hidden /> Asking Jupiter for the best route…
          </span>
        ) : qs.k === 'error' ? (
          <span className="inline-flex items-start gap-2 text-[13px] text-error" role="alert">
            <TriangleAlert size={14} className="mt-[2px] shrink-0" aria-hidden /> {qs.message}
          </span>
        ) : q ? (
          <>
            <span className="font-display text-[30px] leading-none font-bold text-ink">
              ~{fmtAmt(q.outAmount)} <span className="text-gold">{q.outSymbol}</span>
            </span>
            <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 font-mono text-[11.5px] text-muted">
              <dt className="text-faint">min received</dt>
              <dd className="m-0 text-right">
                {fmtAmt(q.minOut)} {q.outSymbol} · {(q.slippageBps / 100).toFixed(2)}% slippage
              </dd>
              <dt className="text-faint">price impact</dt>
              <dd className="m-0 text-right" style={{ color: q.priceImpactPct > 1 ? '#f2704a' : undefined }}>
                {q.priceImpactPct < 0.01 ? '<0.01' : q.priceImpactPct.toFixed(2)}%
              </dd>
              <dt className="text-faint">Gully Labs fee</dt>
              <dd className="m-0 text-right">{q.platformFee ? `${(q.platformFee.bps / 100).toFixed(2)}% · ${fmtAmt(q.platformFee.amount)} ${q.platformFee.symbol}` : 'none'}</dd>
              <dt className="inline-flex items-center gap-1 text-faint">
                <Route size={11} aria-hidden /> route
              </dt>
              <dd className="m-0 truncate text-right" title={q.route.map((r) => `${r.label} ${r.percent}%`).join(' → ')}>
                {q.route.map((r) => r.label).join(' → ') || 'direct'}
              </dd>
            </dl>
          </>
        ) : null}
      </div>

      <WalletChooser state={w} compact />
      {w.error && (
        <p className="m-0 text-[13px] text-error" role="alert">
          {w.error}
        </p>
      )}
      {w.conn && (
        <button type="button" onClick={swap} disabled={!q || busy} className={`${btnGold} inline-flex min-h-11 items-center justify-center gap-2 px-5 text-[15px] disabled:cursor-not-allowed disabled:opacity-60`}>
          {busy && <Loader2 size={16} className="animate-spin" aria-hidden />}
          {tx.k === 'busy' ? tx.message : tx.k === 'sent' ? `Sent · ${tx.status}…` : q ? `Swap ${fmtAmt(q.inAmount)} ${q.inSymbol} for ${q.outSymbol}` : 'Swap'}
        </button>
      )}
      {(tx.k === 'sent' || tx.k === 'done' || (tx.k === 'error' && tx.sig)) && 'sig' in tx && tx.sig && (
        <a href={`${SOLSCAN}/tx/${tx.sig}`} target="_blank" rel="noopener" className={`inline-flex items-center gap-2 text-[13px] ${tx.k === 'done' ? 'text-green' : 'text-muted'} hover:text-gold`}>
          {tx.k === 'done' ? <CheckCircle2 size={14} aria-hidden /> : <ArrowUpRight size={14} aria-hidden />}
          {tx.k === 'done' ? 'Swap confirmed · view on Solscan' : 'View the transaction on Solscan'}
        </a>
      )}
      {tx.k === 'error' && (
        <p className="m-0 text-[13px] text-error" role="alert">
          {tx.message}
        </p>
      )}
      <p className="m-0 text-[12px] leading-[1.5] text-faint">
        Routed by Jupiter across Solana exchanges. {jupiterFeeText()} Quotes are valid for a minute; your wallet shows the final transaction before you sign.
      </p>
    </div>
  )
}
