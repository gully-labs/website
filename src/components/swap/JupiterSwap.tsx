import { ArrowDown, ArrowUpRight, CheckCircle2, ChevronDown, Loader2, Settings2, TriangleAlert, X } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import type { TrackerRow } from '../../lib/tracker'
import { SOLSCAN } from '../solana/constants'
import { lamportsOf, signatureStatus, sendRaw, solRpc, tokenBalance } from '../solana/rpc'
import { WalletChooser } from '../solana/SolanaWallet'
import { useSolanaWallet } from '../solana/useSolanaWallet'
import { b58encode, fromBase64, toBase64 } from '../solana/tx'
import { signAndSend } from '../solana/walletStandard'
import { servable } from '../tracker/servable'
import { TokenLogo } from '../logos/TokenLogo'
import { jupiterFeeText } from './swapConfig'
import { track } from '../../lib/track'
import { AUTO_SLIPPAGE_BPS, impactLevel, parseSlippage, PCTS, pctAmount, SLIPPAGE_PRESETS, slippageWarning, SOL_RESERVE, swapCta, toInput, toRaw, type ImpactLevel } from './swapMath'

/* The swap card on a Solana stock page: Jupiter (the Solana swap aggregator). Buy the xStock with SOL or USDC, or
   sell it back, in the same Uniswap-style layout as the Gully swap kits: Buy / Sell tabs, You pay / You receive
   panels with a flip button, 25 / 50 / 75 % / Max of the wallet's balance (Max keeps 0.01 SOL for fees), the rate
   line, price impact (amber from 1 %, red from 5 %, blocked from 15 % unless expert mode), minimum received, route,
   fee, a settings popover (slippage Auto / 0.1 / 0.5 / 1 % / custom up to 5 %, expert mode) and a review step.
   The quote and the unsigned transaction come from this site's proxy (/api/solana/jupiter/*, server/jupiter.mjs:
   geo gate, caching, rate limits, the platform fee); the visitor's own wallet signs and sends it. Its own lazy
   chunk, loaded after the "I understand" tick. */

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
type Coin = 'SOL' | 'USDC'

const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
const COIN_DEC: Record<Coin, number> = { SOL: 9, USDC: 6 }
const SET_KEY = 'gully-swap-settings-v1'

const fmtAmt = (s: string | number) => {
  const n = Number(s)
  return Number.isFinite(n) ? n.toLocaleString('en-US', { maximumFractionDigits: n < 1 ? 6 : 4 }) : String(s)
}
const toneText: Record<ImpactLevel, string> = { unknown: '', low: '', warn: 'text-[#f5b942]', high: 'text-error', blocked: 'text-error' }

function readSettings(): { auto: boolean; bps: number; expert: boolean } {
  try {
    const j = JSON.parse(localStorage.getItem(SET_KEY) ?? 'null') as { auto?: boolean; bps?: number; expert?: boolean } | null
    if (j) return { auto: j.auto !== false, bps: parseSlippage(String((j.bps ?? AUTO_SLIPPAGE_BPS) / 100)) ?? AUTO_SLIPPAGE_BPS, expert: j.expert === true }
  } catch {
    /* defaults */
  }
  return { auto: true, bps: AUTO_SLIPPAGE_BPS, expert: false }
}

/** The wallet's balance of SOL, USDC and the stock token (raw units), and the stock's decimals. */
function useBalances(owner: string | null, mint: string) {
  const [b, setB] = useState<{ SOL: bigint | null; USDC: bigint | null; stock: bigint | null }>({ SOL: null, USDC: null, stock: null })
  const [dec, setDec] = useState<number | null>(null)
  const [n, setN] = useState(0)
  useEffect(() => {
    let live = true
    void solRpc<{ value: { decimals: number } }>('getTokenSupply', [mint])
      .then((r) => live && setDec(r.value.decimals))
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [mint])
  useEffect(() => {
    let live = true
    if (!owner) {
      void Promise.resolve().then(() => live && setB({ SOL: null, USDC: null, stock: null }))
      return () => {
        live = false
      }
    }
    void Promise.all([lamportsOf(owner).catch(() => null), tokenBalance(owner, USDC_MINT).then((r) => r.raw).catch(() => null), tokenBalance(owner, mint).then((r) => r.raw).catch(() => null)]).then(([s, u, t]) => live && setB({ SOL: s, USDC: u, stock: t }))
    return () => {
      live = false
    }
  }, [owner, mint, n])
  return { ...b, dec, refresh: () => setN((x) => x + 1) }
}

function CoinToggle({ coin, onChange, disabled, label }: { coin: Coin; onChange: (c: Coin) => void; disabled?: boolean; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex shrink-0 rounded-full border border-line-strong bg-surface p-[3px]">
      {(['USDC', 'SOL'] as const).map((c) => (
        <button key={c} type="button" role="radio" aria-checked={coin === c} onClick={() => onChange(c)} disabled={disabled} className={`inline-flex min-h-9 items-center gap-1.5 rounded-full px-2.5 text-[14px] font-semibold ${coin === c ? 'bg-line-strong text-ink' : 'text-muted hover:text-ink'}`}>
          <TokenLogo symbol={c} size={20} decorative /> {c}
        </button>
      ))}
    </div>
  )
}

export default function JupiterSwap({ row }: { row: TrackerRow }) {
  const id = useId()
  const sym = row.symbol ?? row.ticker
  const [side, setSide] = useState<'buy' | 'sell'>('buy')
  const [coin, setCoin] = useState<Coin>('USDC')
  const [amount, setAmount] = useState('10')
  const [qs, setQs] = useState<QState>({ k: 'idle' })
  const [tx, setTx] = useState<Tx>({ k: 'idle' })
  const [set, setSet] = useState(readSettings)
  const [showSet, setShowSet] = useState(false)
  const [confirmExpert, setConfirmExpert] = useState(false)
  const [custom, setCustom] = useState('')
  const [inverted, setInverted] = useState(false)
  const [review, setReview] = useState(false)
  const w = useSolanaWallet()
  const owner = w.conn?.account.address ?? null
  const bal = useBalances(owner, row.token)
  const reqId = useRef(0)
  const quoted = useRef(false)
  const popRef = useRef<HTMLDivElement>(null)
  const gearRef = useRef<HTMLButtonElement>(null)
  const slip = set.auto ? AUTO_SLIPPAGE_BPS : set.bps
  const saveSet = (next: typeof set) => {
    setSet(next)
    try {
      localStorage.setItem(SET_KEY, JSON.stringify(next))
    } catch {
      /* this page only */
    }
  }

  useEffect(() => {
    if (!showSet) return
    const down = (e: PointerEvent) => {
      const t = e.target as Node
      if (popRef.current?.contains(t) || gearRef.current?.contains(t)) return
      setShowSet(false)
    }
    window.addEventListener('pointerdown', down)
    return () => window.removeEventListener('pointerdown', down)
  }, [showSet])

  // Debounced quote on every change; the answer of a superseded request is dropped.
  useEffect(() => {
    const amt = amount.trim()
    const me = ++reqId.current
    if (!/^\d+(\.\d+)?$/.test(amt) || Number(amt) <= 0) return
    const t = setTimeout(async () => {
      setQs({ k: 'loading' })
      try {
        const r = await fetch(`/api/solana/jupiter/quote?ticker=${encodeURIComponent(row.ticker)}&side=${side}&with=${coin}&amount=${encodeURIComponent(amt)}&slippageBps=${slip}`, { cache: 'no-store' })
        const j = (await r.json().catch(() => null)) as { quote?: Quote; error?: string } | null
        if (me !== reqId.current) return
        setQs(r.ok && j?.quote ? { k: 'ok', q: j.quote } : { k: 'error', message: j?.error ?? `The quote could not be read (${r.status}).` })
        // The first quote this card shows (not each re-quote as the amount is typed).
        if (r.ok && j?.quote && !quoted.current) {
          quoted.current = true
          track('swap-quoted', { venue: 'jupiter', chain: row.chain, ticker: row.ticker })
        }
      } catch {
        if (me === reqId.current) setQs({ k: 'error', message: 'The quote could not be read just now.' })
      }
    }, 500)
    return () => clearTimeout(t)
  }, [row.ticker, row.chain, side, coin, amount, slip])

  const amountOk = /^\d+(\.\d+)?$/.test(amount.trim()) && Number(amount) > 0
  const q = amountOk && qs.k === 'ok' ? qs.q : null
  const busy = tx.k === 'busy' || tx.k === 'sent'
  const inDec = side === 'buy' ? COIN_DEC[coin] : bal.dec
  const balIn = side === 'buy' ? bal[coin] : bal.stock
  const balOut = side === 'buy' ? bal.stock : bal[coin]
  const outDec = side === 'buy' ? bal.dec : COIN_DEC[coin]
  const reserve = side === 'buy' && coin === 'SOL' ? SOL_RESERVE : 0n
  const rawIn = inDec !== null ? toRaw(amount, inDec) : null
  const insufficient = rawIn !== null && balIn !== null && rawIn > balIn
  const impact = q ? q.priceImpactPct : null
  const lvl = impactLevel(impact)
  const cta = swapCta({ connected: !!w.conn, hasAmount: amountOk, insufficient, symbolIn: side === 'buy' ? coin : sym, quote: qs.k === 'ok' ? 'ok' : qs.k === 'error' ? 'error' : 'loading', impactPct: impact, expert: set.expert, busy, side })
  const rate = q && Number(q.inAmount) > 0 && Number(q.outAmount) > 0 ? (inverted ? Number(q.inAmount) / Number(q.outAmount) : Number(q.outAmount) / Number(q.inAmount)) : null

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
      track('swap-submitted', { venue: 'jupiter', chain: row.chain, ticker: row.ticker })
      setTx({ k: 'sent', sig, status: 'sent' })
      for (let i = 0; i < 40; i++) {
        await new Promise((ok) => setTimeout(ok, 2_000))
        const st = await signatureStatus(sig).catch(() => null)
        if (st?.err) return setTx({ k: 'error', sig, message: 'The swap failed on chain (often the price moved past the slippage limit). Nothing was swapped; only the network fee was spent.' })
        if (st?.confirmationStatus === 'confirmed' || st?.confirmationStatus === 'finalized') {
          bal.refresh()
          return setTx({ k: 'done', sig })
        }
        if (st?.confirmationStatus) setTx({ k: 'sent', sig, status: st.confirmationStatus })
      }
      setTx({ k: 'error', sig, message: 'Not confirmed after 80 seconds. Check the transaction on Solscan before trying again.' })
    } catch (e) {
      const m = String((e as Error)?.message ?? e)
      setTx({ k: 'error', message: /reject|denied|cancel|declined/i.test(m) ? 'The wallet request was declined. Nothing was sent.' : m.slice(0, 220) })
    }
  }

  const switchSide = (s: 'buy' | 'sell') => {
    if (s === side) return
    setSide(s)
    setAmount(q ? String(Number(q.outAmount)) : s === 'sell' ? '0.1' : '10')
    setTx({ k: 'idle' })
    setReview(false)
  }
  const stockLogo = <TokenLogo symbol={sym} chain={servable(row.chain, row.token) ? row.chain : null} address={servable(row.chain, row.token) ? row.token : null} size={24} decorative />
  const stockChip = (
    <span className="inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-full border border-line-strong bg-surface px-2.5 text-[15px] font-semibold text-ink">
      {stockLogo} {sym}
    </span>
  )
  const panel = 'flex flex-col gap-1.5 rounded-[16px] border border-line bg-surface-deep px-4 py-3 focus-within:border-line-strong'
  const amountCls = 'min-w-0 flex-1 border-0 bg-transparent p-0 font-display text-[32px] leading-tight font-semibold text-ink outline-none placeholder:text-faint'
  const rows: { k: string; v: string; tone?: string }[] = q
    ? [
        { k: 'Price impact', v: `${q.priceImpactPct < 0.01 ? '<0.01' : q.priceImpactPct.toFixed(2)}%`, tone: toneText[lvl] },
        { k: 'Minimum received', v: `${fmtAmt(q.minOut)} ${q.outSymbol}` },
        { k: 'Max slippage', v: `${set.auto ? 'Auto · ' : ''}${(q.slippageBps / 100).toFixed(2)}%` },
        { k: 'Gully Labs fee', v: q.platformFee ? `${(q.platformFee.bps / 100).toFixed(2)}% · ${fmtAmt(q.platformFee.amount)} ${q.platformFee.symbol}` : 'none' },
        { k: 'Route', v: q.route.map((r) => r.label).join(' → ') || 'direct' },
        { k: 'Network fee', v: 'paid in SOL, shown by your wallet' },
      ]
    : []
  const banner =
    q && (lvl === 'warn' || lvl === 'high' || lvl === 'blocked')
      ? lvl === 'blocked'
        ? set.expert
          ? `Price impact is ${q.priceImpactPct.toFixed(2)}%. Expert mode is on, so you can still send it, but you lose a large part of the trade.`
          : `Price impact is ${q.priceImpactPct.toFixed(2)}%, over the 15% limit. Trade a smaller amount, or turn on expert mode in settings.`
        : lvl === 'high'
          ? `High price impact (${q.priceImpactPct.toFixed(2)}%). You get noticeably less than the market rate.`
          : `Price impact is ${q.priceImpactPct.toFixed(2)}%.`
      : null
  const detailRows = (
    <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 font-mono text-[12px] text-muted">
      {rows.map((r) => (
        <div key={r.k} className="contents">
          <dt className="font-sans text-faint">{r.k}</dt>
          <dd className={`m-0 truncate text-right text-ink ${r.tone ?? ''}`}>{r.v}</dd>
        </div>
      ))}
    </dl>
  )

  return (
    <div className="relative flex flex-col gap-1">
      <div className="flex items-center justify-between gap-2 pb-2">
        <div role="tablist" aria-label={`Buy or sell ${sym}`} className="flex rounded-full bg-surface-deep p-[3px]">
          {(['buy', 'sell'] as const).map((s) => (
            <button key={s} type="button" role="tab" aria-selected={side === s} onClick={() => switchSide(s)} disabled={busy} className={`min-h-9 rounded-full px-4 text-[14px] font-semibold ${side === s ? (s === 'buy' ? 'bg-line-strong text-green' : 'bg-line-strong text-error') : 'text-muted hover:text-ink'}`}>
              {s === 'buy' ? 'Buy' : 'Sell'}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1.5">
          {!set.auto && <span className="rounded-full border border-line px-2 py-0.5 font-mono text-[11px] text-muted">{(set.bps / 100).toFixed(2)}% slippage</span>}
          {set.expert && <span className="rounded-full border border-error/40 px-2 py-0.5 font-mono text-[11px] text-error">Expert</span>}
          <button ref={gearRef} type="button" aria-label="Swap settings" aria-expanded={showSet} aria-controls={`${id}-set`} onClick={() => setShowSet((v) => !v)} className="grid size-9 place-items-center rounded-[10px] text-muted hover:bg-surface-deep hover:text-ink">
            <Settings2 size={18} aria-hidden />
          </button>
        </div>
      </div>

      {showSet && (
        <div
          ref={popRef}
          id={`${id}-set`}
          role="dialog"
          aria-label="Swap settings"
          onKeyDown={(e) => {
            if (e.key !== 'Escape') return
            setShowSet(false)
            gearRef.current?.focus()
          }}
          className="absolute top-12 right-0 z-20 flex w-[min(320px,100%)] flex-col gap-3 rounded-[16px] border border-line-strong bg-surface p-4 shadow-2xl"
        >
          <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
            <legend className="mb-2 text-[13px] font-semibold text-muted">Max slippage{set.auto ? ' (Auto: 0.5%)' : ''}</legend>
            <div className="flex gap-1 rounded-[12px] bg-surface-deep p-[3px]">
              {[{ l: 'Auto', auto: true, b: AUTO_SLIPPAGE_BPS }, ...SLIPPAGE_PRESETS.map((b) => ({ l: `${b / 100}%`, auto: false, b }))].map((o) => {
                const on = o.auto ? set.auto : !set.auto && set.bps === o.b && !custom
                return (
                  <label key={o.l} className={`flex-1 cursor-pointer rounded-[9px] px-2 py-1.5 text-center text-[13px] font-semibold has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-gold ${on ? 'bg-line-strong text-ink' : 'text-muted'}`}>
                    <input
                      type="radio"
                      name={`${id}-slip`}
                      className="sr-only"
                      checked={on}
                      onChange={() => {
                        setCustom('')
                        saveSet({ ...set, auto: o.auto, bps: o.b })
                      }}
                    />
                    {o.l}
                  </label>
                )
              })}
            </div>
            <label className={`flex min-h-10 items-center gap-2 rounded-[12px] border px-3 ${custom && parseSlippage(custom) === null ? 'border-error' : 'border-line-strong'} focus-within:border-gold`}>
              <span className="text-[13px] text-muted">Custom</span>
              <input
                inputMode="decimal"
                placeholder="0.50"
                value={custom}
                onChange={(e) => {
                  const v = e.target.value.replace(',', '.').replace(/[^\d.]/g, '')
                  setCustom(v)
                  const b = parseSlippage(v)
                  if (b !== null) saveSet({ ...set, auto: false, bps: b })
                }}
                className="min-w-0 flex-1 border-0 bg-transparent text-right font-mono text-[14px] text-ink outline-none"
              />
              <span className="text-[13px] text-muted">%</span>
            </label>
            <p className="m-0 text-[12px] text-faint" aria-live="polite">
              {custom && parseSlippage(custom) === null ? 'Enter a percentage between 0.01 and 5.' : slippageWarning(slip) === 'low' ? 'Very low slippage: the swap may fail if the price moves.' : slippageWarning(slip) === 'high' ? 'High slippage: you may get a much worse price.' : 'The swap fails on chain if the price moves against you by more than this.'}
            </p>
          </fieldset>
          <p className="m-0 text-[12px] text-faint">Deadline: a Solana transaction expires on its own about a minute after it is built; quotes last a minute.</p>
          <div className="flex items-center justify-between gap-3">
            <span id={`${id}-ex`}>
              <b className="block text-[14px] text-ink">Expert mode</b>
              <span className="text-[12px] text-faint">Skips the review step and allows trades with price impact over 15%.</span>
            </span>
            <button
              type="button"
              role="switch"
              aria-checked={set.expert}
              aria-labelledby={`${id}-ex`}
              onClick={() => (set.expert ? saveSet({ ...set, expert: false }) : setConfirmExpert(true))}
              className={`relative h-[26px] w-11 shrink-0 rounded-full after:absolute after:top-[3px] after:left-[3px] after:size-5 after:rounded-full after:bg-white after:transition-transform ${set.expert ? 'bg-error after:translate-x-[18px]' : 'bg-line-strong'}`}
            />
          </div>
          {confirmExpert && !set.expert && (
            <p className="m-0 rounded-[12px] border border-error/40 p-3 text-[12.5px] text-error" role="alert">
              Expert mode lets you send trades that can lose most of their value to price impact.{' '}
              <button
                type="button"
                className="font-semibold underline"
                onClick={() => {
                  saveSet({ ...set, expert: true })
                  setConfirmExpert(false)
                }}
              >
                Turn on expert mode
              </button>
            </p>
          )}
        </div>
      )}

      <div className={`${panel} ${insufficient ? '!border-error' : ''}`}>
        <label htmlFor={`${id}-in`} className="text-[14px] font-medium text-muted">
          {side === 'buy' ? 'You pay' : 'You sell'}
        </label>
        <div className="flex items-center gap-2">
          <input id={`${id}-in`} className={amountCls} value={amount} onChange={(e) => setAmount(e.target.value.replace(',', '.').replace(/[^\d.]/g, ''))} inputMode="decimal" placeholder="0" autoComplete="off" disabled={busy} aria-invalid={insufficient} />
          {side === 'buy' ? <CoinToggle coin={coin} onChange={setCoin} disabled={busy} label="Pay with" /> : stockChip}
        </div>
        <div className="flex min-h-7 flex-wrap items-center justify-end gap-1.5 font-mono text-[12px] text-muted">
          {balIn !== null && inDec !== null && (
            <>
              <span>
                Balance: <span className="text-ink">{fmtAmt(toInput(balIn, inDec) || '0')}</span>
              </span>
              {balIn > 0n &&
                PCTS.map((p) => {
                  const v = pctAmount(balIn, p, reserve)
                  return (
                    <button
                      key={p}
                      type="button"
                      disabled={busy}
                      aria-pressed={rawIn !== null && rawIn === v && v > 0n}
                      aria-label={p === 100 ? `Max: use your whole ${side === 'buy' ? coin : sym} balance${reserve ? ', minus 0.01 SOL kept for fees' : ''}` : `Use ${p}% of your ${side === 'buy' ? coin : sym} balance`}
                      onClick={() => setAmount(toInput(v, inDec))}
                      className="min-h-7 min-w-10 rounded-full border border-line-strong px-2 font-sans text-[12px] font-semibold hover:border-gold hover:text-gold aria-pressed:border-gold aria-pressed:bg-gold aria-pressed:text-bg"
                    >
                      {p === 100 ? 'Max' : `${p}%`}
                    </button>
                  )
                })}
            </>
          )}
        </div>
        {insufficient && (
          <p className="m-0 text-[13px] font-medium text-error" role="alert">
            Insufficient {side === 'buy' ? coin : sym} balance
          </p>
        )}
      </div>

      <div className="relative z-10 flex h-1 justify-center">
        <button type="button" onClick={() => switchSide(side === 'buy' ? 'sell' : 'buy')} disabled={busy} aria-label={side === 'buy' ? `Switch to selling ${sym}` : `Switch to buying ${sym}`} className="absolute top-1/2 grid size-10 -translate-y-1/2 place-items-center rounded-[12px] border-4 border-bg bg-surface text-ink hover:text-gold">
          <ArrowDown size={16} aria-hidden />
        </button>
      </div>

      <div className={panel} aria-live="polite">
        <span className="text-[14px] font-medium text-muted">You receive</span>
        <div className="flex items-center gap-2">
          <output className={`${amountCls} block truncate ${qs.k === 'loading' ? 'animate-pulse text-muted' : ''}`}>{q ? fmtAmt(q.outAmount) : <span className="text-faint">0</span>}</output>
          {side === 'buy' ? stockChip : <CoinToggle coin={coin} onChange={setCoin} disabled={busy} label="Receive" />}
        </div>
        <div className="flex min-h-6 items-center justify-between gap-2 font-mono text-[12px] text-muted">
          <span>{qs.k === 'loading' ? 'Asking Jupiter for the best route…' : ''}</span>
          {balOut !== null && outDec !== null && (
            <span>
              Balance: <span className="text-ink">{fmtAmt(toInput(balOut, outDec) || '0')}</span>
            </span>
          )}
        </div>
      </div>

      {qs.k === 'error' && amountOk && (
        <p className="m-0 mt-1 inline-flex items-start gap-2 rounded-[12px] border border-error/40 p-3 text-[13px] text-error" role="alert">
          <TriangleAlert size={14} className="mt-[2px] shrink-0" aria-hidden /> {qs.message}
        </p>
      )}
      {q && (
        <div className="mt-1 rounded-[16px] border border-line px-3 text-[13px]">
          <div className="flex min-h-10 flex-wrap items-center justify-between gap-x-2">
            <button type="button" onClick={() => setInverted((v) => !v)} className="min-w-0 truncate text-left font-mono text-[12.5px] text-ink" aria-label="Show the rate the other way round">
              {rate !== null ? `1 ${inverted ? q.outSymbol : q.inSymbol} = ${fmtAmt(rate)} ${inverted ? q.inSymbol : q.outSymbol}` : ''}
            </button>
            <DetailsToggle id={`${id}-dl`} impact={lvl === 'low' || lvl === 'unknown' ? null : `${q.priceImpactPct.toFixed(2)}% impact`} tone={toneText[lvl]}>
              <div className="border-t border-line py-2.5">{detailRows}</div>
            </DetailsToggle>
          </div>
        </div>
      )}
      {banner && (
        <p className={`m-0 mt-1 inline-flex items-start gap-2 rounded-[12px] border p-3 text-[13px] ${lvl === 'warn' ? 'border-[#f5b942]/40 text-[#f5b942]' : 'border-error/40 text-error'}`} role={lvl === 'warn' ? 'status' : 'alert'}>
          <TriangleAlert size={14} className="mt-[2px] shrink-0" aria-hidden /> {banner}
        </p>
      )}

      <div className="mt-2 flex flex-col gap-2">
        <WalletChooser state={w} compact />
      </div>
      {w.conn && (!review || set.expert) && (
        <button
          type="button"
          onClick={() => (cta.action === 'review' ? setReview(true) : cta.action === 'swap' ? void swap() : undefined)}
          disabled={cta.disabled}
          className={`mt-1 inline-flex min-h-14 items-center justify-center gap-2 rounded-[16px] px-5 text-[16px] font-semibold disabled:cursor-not-allowed ${cta.disabled ? (cta.tone === 'danger' ? 'bg-error/10 text-error' : 'bg-surface-deep text-muted') : cta.tone === 'danger' ? 'bg-error text-bg' : cta.tone === 'warn' ? 'bg-[#f5b942] text-bg' : 'bg-gold text-bg hover:bg-gold-hover'}`}
        >
          {busy && <Loader2 size={16} className="animate-spin" aria-hidden />}
          {tx.k === 'busy' ? tx.message : tx.k === 'sent' ? `Sent · ${tx.status}…` : cta.label}
        </button>
      )}
      {w.error && (
        <p className="m-0 text-[13px] text-error" role="alert">
          {w.error}
        </p>
      )}

      {review && q && !set.expert && (
        <section className="mt-2 flex flex-col gap-3 rounded-[16px] border border-gold-line bg-surface-deep p-4" aria-labelledby={`${id}-rv`}>
          <div className="flex items-center justify-between">
            <h3 id={`${id}-rv`} className="m-0 text-[15px] font-semibold text-ink">
              {tx.k === 'done' ? 'Swap confirmed' : `Review ${side}`}
            </h3>
            <button
              type="button"
              aria-label="Close the review"
              disabled={busy}
              onClick={() => {
                setReview(false)
                setTx({ k: 'idle' })
              }}
              className="grid size-8 place-items-center rounded-[8px] text-muted hover:text-ink"
            >
              <X size={16} aria-hidden />
            </button>
          </div>
          <p className="m-0 font-display text-[22px] font-semibold text-ink">
            {fmtAmt(q.inAmount)} {q.inSymbol} → ~{fmtAmt(q.outAmount)} {q.outSymbol}
          </p>
          {detailRows}
          <ol className="m-0 flex list-none gap-3 p-0 text-[12.5px]" aria-label="Progress">
            {['Build', 'Sign', 'Confirmed'].map((s, i) => {
              const at = tx.k === 'idle' || tx.k === 'error' ? -1 : tx.k === 'busy' ? (tx.message.startsWith('Confirm') ? 1 : 0) : tx.k === 'sent' ? 2 : 3
              const st = i < at ? 'done' : i === at ? 'active' : 'todo'
              return (
                <li key={s} aria-current={st === 'active' ? 'step' : undefined} className={`inline-flex items-center gap-1.5 ${st === 'done' ? 'text-green' : st === 'active' ? 'text-ink' : 'text-faint'}`}>
                  {st === 'done' ? <CheckCircle2 size={14} aria-hidden /> : st === 'active' ? <Loader2 size={14} className="animate-spin" aria-hidden /> : <span aria-hidden>{i + 1}.</span>}
                  {s}
                </li>
              )
            })}
          </ol>
          {tx.k !== 'done' && (
            <button type="button" onClick={() => void swap()} disabled={busy} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-[14px] bg-gold px-5 text-[15px] font-semibold text-bg hover:bg-gold-hover disabled:opacity-60">
              {busy && <Loader2 size={16} className="animate-spin" aria-hidden />}
              {tx.k === 'busy' ? tx.message : tx.k === 'sent' ? `Sent · ${tx.status}…` : `Confirm ${side}`}
            </button>
          )}
        </section>
      )}

      {(tx.k === 'sent' || tx.k === 'done' || (tx.k === 'error' && tx.sig)) && 'sig' in tx && tx.sig && (
        <a href={`${SOLSCAN}/tx/${tx.sig}`} target="_blank" rel="noopener noreferrer" className={`mt-1 inline-flex items-center gap-2 text-[13px] ${tx.k === 'done' ? 'text-green' : 'text-muted'} hover:text-gold`}>
          {tx.k === 'done' ? <CheckCircle2 size={14} aria-hidden /> : <ArrowUpRight size={14} aria-hidden />}
          {tx.k === 'done' ? 'Swap confirmed · view on Solscan' : 'View the transaction on Solscan'}
        </a>
      )}
      {tx.k === 'error' && (
        <p className="m-0 text-[13px] text-error" role="alert">
          {tx.message}
        </p>
      )}
      <p className="m-0 mt-2 text-[12px] leading-[1.5] text-faint">
        Routed by Jupiter across Solana exchanges. {jupiterFeeText()} Quotes are valid for a minute; your wallet shows the final transaction before you sign.
      </p>
    </div>
  )
}

/** The chevron that opens the trade details (rendered below the summary row through a portal-free sibling). */
function DetailsToggle({ id, impact, tone, children }: { id: string; impact: string | null; tone: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" aria-expanded={open} aria-controls={id} onClick={() => setOpen((v) => !v)} className="inline-flex shrink-0 items-center gap-1 text-muted hover:text-ink">
        {impact && <span className={tone}>{impact}</span>}
        <span className="sr-only">{open ? 'Hide' : 'Show'} trade details</span>
        <ChevronDown size={14} className={`transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden />
      </button>
      {open && (
        <div id={id} className="basis-full">
          {children}
        </div>
      )}
    </>
  )
}
