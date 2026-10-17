import { ArrowUpRight, CheckCircle2, Clock, Copy, CreditCard, FileText, Loader2, Printer, RefreshCw, ShieldCheck, TriangleAlert } from 'lucide-react'
import { lazy, Suspense, useEffect, useRef, useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { AssetMark, AssetPicker } from '../../components/pay/AssetPicker'
import { btnOutline } from '../../components/ui'
import { payApi, type Quote } from './api'
import { fmtTime, type Invoice } from './invoice'
import { QrCode } from './QrCode'
import { copyWithToast, toastError, toastInfo, toastSuccess } from '../../components/ui/toast'

/* The hosted checkout of one invoice (/pay/<id>, also where a pay link lands): plan header and status,
   asset picker grouped by chain, the exact amount, a wallet QR (EIP-681, built by the server), copy
   buttons, the quote countdown, one-click pay from a wallet (wagmi + RainbowKit, loaded only when asked
   for), a pasted-hash fallback, live confirmations and the receipt. Every figure is the server's. */

const PayWallet = lazy(() => import('../../components/pay/PayWallet'))

type Check = { s: 'idle' } | { s: 'checking'; hash: string } | { s: 'pending'; hash: string; confirmations: number; needed: number; message: string } | { s: 'error'; message: string; hash?: string } | { s: 'done'; hash: string }

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`
const mmss = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

function useNow(on: boolean) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!on) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [on])
  return now
}

export function CopyChip({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false)
  return (
    <button
      type="button"
      onClick={() =>
        copyWithToast(text, label === 'Copy' ? 'Text' : label).then((ok) => {
          if (!ok) return
          setDone(true)
          setTimeout(() => setDone(false), 1600)
        })
      }
      className={`inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-btn border px-3 font-mono text-[12px] transition-colors ${done ? 'border-success-line text-green' : 'border-line-strong text-ink-2 hover:border-gold hover:text-ink'}`}
      aria-label={done ? `${label} copied` : `Copy ${label}`}
    >
      <Copy size={13} aria-hidden /> {done ? 'Copied' : label}
    </button>
  )
}

function Row({ k, v, copy, copyLabel }: { k: string; v: string; copy?: string; copyLabel?: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="font-mono text-[10.5px] tracking-[1px] text-faint">{k}</span>
      <div className="flex min-w-0 items-center gap-2 rounded-input border border-line bg-bg py-1 pr-1 pl-3">
        <span className="min-w-0 flex-1 font-mono text-[13px] break-all text-ink">{v}</span>
        {copy !== undefined && <CopyChip text={copy} label={copyLabel ?? 'Copy'} />}
      </div>
    </div>
  )
}

export type Phase = 'choose' | 'send' | 'confirming' | 'paid'
const STEPS = ['Quote', 'Send', 'Confirm', 'Paid']

function Steps({ phase }: { phase: Phase }) {
  const idx = { choose: 0, send: 1, confirming: 2, paid: 3 }[phase]
  return (
    <ol className="m-0 grid list-none grid-cols-4 gap-[6px] p-0" aria-label="Payment progress">
      {STEPS.map((l, i) => (
        <li key={l} className="flex flex-col gap-[6px]" aria-current={i === idx ? 'step' : undefined}>
          <span className={`h-1 rounded-full transition-colors duration-300 ${i <= idx ? 'bg-gold' : 'bg-grid'}`} />
          <span className={`text-[12px] ${i <= idx ? 'text-ink' : 'text-faint'}`}>{l}</span>
        </li>
      ))}
    </ol>
  )
}

export function ConfirmBar({ n, needed, done = false }: { n: number; needed: number; done?: boolean }) {
  const pct = needed ? Math.min(100, Math.round((n / needed) * 100)) : 0
  return (
    <div className="flex flex-col gap-2">
      <span className="flex justify-between font-mono text-[11px] text-dim">
        <span>Confirmations</span>
        <span>
          {n} / {needed}
        </span>
      </span>
      <span className="h-2 overflow-hidden rounded-full bg-grid" role="progressbar" aria-valuemin={0} aria-valuemax={needed} aria-valuenow={n} aria-label="Confirmations">
        <span className={`block h-full rounded-full transition-[width] duration-300 ${done ? 'bg-green' : 'bg-gold'}`} style={{ width: `${pct}%` }} />
      </span>
    </div>
  )
}

/** The success panel of a paid invoice: amount, chain, explorer link and the receipt. */
export function PaidPanel({ invoice }: { invoice: Invoice }) {
  const p = invoice.payment
  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-start gap-3">
        <CheckCircle2 size={26} className="mt-[2px] shrink-0 text-green" aria-hidden />
        <div className="flex min-w-0 flex-col gap-1">
          <span className="font-display text-[28px] leading-none font-bold uppercase">Payment received</span>
          <span className="text-[15px] text-muted">{p ? `${p.amount} ${p.symbol} on ${p.chain}, confirmed ${fmtTime(invoice.paidAt)}.` : `Paid ${fmtTime(invoice.paidAt)}.`}</span>
        </div>
      </div>
      {p && (
        <dl className="m-0 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 rounded-input border border-line bg-bg px-4 py-3 font-mono text-[12px]">
          <dt className="text-faint">AMOUNT</dt>
          <dd className="m-0 break-all text-ink">
            {p.amount} {p.symbol}
            {p.usd ? <span className="text-faint"> · {p.usd} USD</span> : null}
          </dd>
          <dt className="text-faint">FROM</dt>
          <dd className="m-0 break-all text-ink-2">{p.from}</dd>
          <dt className="text-faint">TX</dt>
          <dd className="m-0 break-all">
            {p.txUrl ? (
              <a href={p.txUrl} target="_blank" rel="noopener" className="inline-flex items-center gap-1 text-ink-2 underline-offset-4 hover:text-gold hover:underline">
                {short(p.txHash)} <ArrowUpRight size={12} aria-hidden />
              </a>
            ) : (
              short(p.txHash)
            )}
          </dd>
          <dt className="text-faint">BLOCK</dt>
          <dd className="m-0 text-ink-2">{p.blockNumber}</dd>
        </dl>
      )}
      <div className="flex flex-wrap gap-3">
        <Link to={`/pay/${invoice.id}/receipt`} className={`${btnOutline} inline-flex min-h-11 items-center gap-2 px-5 text-[15px]`}>
          <FileText size={16} aria-hidden /> View receipt
        </Link>
        <Link to={`/pay/${invoice.id}/receipt?print=1`} className={`${btnOutline} inline-flex min-h-11 items-center gap-2 px-5 text-[15px]`}>
          <Printer size={16} aria-hidden /> Print
        </Link>
        {p?.txUrl && (
          <a href={p.txUrl} target="_blank" rel="noopener" className={`${btnOutline} inline-flex min-h-11 items-center gap-2 px-5 text-[15px]`}>
            Explorer <ArrowUpRight size={15} aria-hidden />
          </a>
        )}
      </div>
    </div>
  )
}

export interface CheckoutProps {
  invoice: Invoice
  initialAsset: string | null
  onPaid: (i: Invoice) => void
  onPhase?: (p: Phase) => void
  /** Merchant stores (src/pages/merchant-pay): their own API base and the store paid, instead of the Gully Labs treasury. */
  api?: string
  payee?: string
}

/** The live part of an open invoice's checkout. */
export function Checkout({ invoice, initialAsset, onPaid, onPhase, api = `/api/pay/${invoice.id}`, payee }: CheckoutProps) {
  const assets = invoice.assets
  const start = initialAsset && assets.some((a) => a.id === initialAsset) ? initialAsset : assets.length === 1 ? assets[0].id : null
  const [assetId, setAssetId] = useState<string | null>(start)
  const [quote, setQuote] = useState<Quote | null>(null)
  const [quoteErr, setQuoteErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(!!start)
  const [hash, setHash] = useState('')
  const [walletErr, setWalletErr] = useState('')
  const [showWallet, setShowWallet] = useState(false)
  const [check, setCheck] = useState<Check>({ s: 'idle' })
  const now = useNow(!!quote)
  const run = useRef(0)
  const quoteRun = useRef(0)
  useEffect(() => {
    const r = run
    return () => void r.current++
  }, [])

  const asset = assets.find((a) => a.id === (quote?.asset.id ?? assetId)) ?? null
  const busy = check.s === 'checking' || check.s === 'pending'
  const left = quote ? Date.parse(quote.expiresAt) - now : 0
  const expired = !!quote && left <= 0
  const phase: Phase = check.s === 'done' ? 'paid' : busy ? 'confirming' : quote ? 'send' : 'choose'
  useEffect(() => onPhase?.(phase), [phase, onPhase])

  const fetchQuote = (id: string, refresh = false) => {
    const me = ++quoteRun.current
    payApi<{ quote: Quote }>(`${api}/quote`, { method: 'POST', body: { asset: id } }).then((r) => {
      if (me !== quoteRun.current) return
      setLoading(false)
      if (r.ok) {
        setQuote(r.data.quote)
        if (refresh) toastSuccess('New quote ready', { id: 'pay:quote', detail: `${r.data.quote.amount} ${r.data.quote.asset.symbol}, valid for 20 minutes.` })
      } else setQuoteErr(r.error)
    })
  }

  // Say once when a quote runs out (the timer turns into "get a new one").
  const expiredId = expired && check.s !== 'done' ? quote.id : null
  useEffect(() => {
    if (expiredId) toastInfo('Quote expired', { id: 'pay:quote', detail: 'Get a new quote to pay. A payment already sent in time can still be checked.' })
  }, [expiredId])
  // Transactions already announced as detected, so polling does not toast again.
  const seen = useRef(new Set<string>())

  const load = (id: string) => {
    // Asking again for the same asset (the quote ran out) is a refresh; a new asset is a first quote.
    const refresh = !!quote && quote.asset.id === id
    run.current++
    setAssetId(id)
    setQuote(null)
    setQuoteErr(null)
    setWalletErr('')
    setCheck({ s: 'idle' })
    setLoading(true)
    fetchQuote(id, refresh)
  }

  useEffect(() => {
    if (start) fetchQuote(start)
    // Only on mount (loading starts true for it): later choices go through the picker.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Checks the hash; while the chain answers "not confirmed yet" (202) it asks again every six seconds, for up to ten minutes.
  const verify = async (q: Quote, txHash: string) => {
    const me = ++run.current
    setCheck({ s: 'checking', hash: txHash })
    for (let tries = 0; ; tries++) {
      const r = await payApi<{ invoice?: Invoice; error?: string; confirmations?: number; needed?: number }>(`${api}/verify`, { method: 'POST', body: { quoteId: q.id, txHash } })
      if (me !== run.current) return
      // One toast per transaction, replaced as it moves on: detected, then confirmed (or not).
      const tid = `pay:tx:${txHash}`
      if (r.ok && r.status === 200 && r.data.invoice) {
        setCheck({ s: 'done', hash: txHash })
        toastSuccess('Payment confirmed', { id: tid, detail: `${q.amount} ${q.asset.symbol} on ${q.asset.chain}.`, duration: 8000 })
        onPaid(r.data.invoice)
        return
      }
      if (r.ok && r.status === 202 && tries < 100) {
        // The chain knows the transaction (in the mempool or mined, awaiting confirmations).
        if (!seen.current.has(txHash) && !/does not know/i.test(r.data.error ?? '')) {
          seen.current.add(txHash)
          toastInfo('Transaction detected', { id: tid, detail: r.data.error ?? 'Waiting for confirmations.' })
        }
        setCheck({ s: 'pending', hash: txHash, confirmations: r.data.confirmations ?? 0, needed: r.data.needed ?? q.confirmations, message: r.data.error ?? 'Waiting for confirmations.' })
        await new Promise((ok) => setTimeout(ok, 6_000))
        if (me !== run.current) return
        continue
      }
      const message = r.ok ? `${r.data.error ?? 'Not confirmed yet.'} Still not confirmed after ten minutes: check again later with the same hash.` : r.error
      setCheck({ s: 'error', hash: txHash, message })
      toastError('Payment not confirmed', { id: tid, detail: message })
      return
    }
  }

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (!quote) return
    const h = hash.trim()
    if (/^0x[0-9a-fA-F]{64}$/.test(h)) verify(quote, h)
    else setCheck({ s: 'error', message: 'A transaction hash is 0x followed by 64 hexadecimal characters.' })
  }

  const txLink = (h: string) => (asset ? `${asset.explorer}/tx/${h}` : null)

  return (
    <div className="flex flex-col gap-6">
      <Steps phase={phase} />

      <div className="flex flex-col gap-3">
        <span className="font-mono text-[11px] tracking-[1px] text-faint">PAY WITH</span>
        <AssetPicker assets={assets} value={assetId} onChange={load} disabled={busy} />
      </div>

      {loading && (
        <div className="flex flex-col gap-3" aria-busy>
          <span className="inline-flex items-center gap-2 font-mono text-[12px] text-muted" role="status">
            <Loader2 size={14} className="animate-spin" aria-hidden /> Getting a quote{asset?.kind === 'native' ? ` from the Chainlink ${asset.feed?.description} price on ${asset.chain}` : ''}…
          </span>
          <span className="block h-[200px] animate-pulse rounded-card bg-surface-deep" />
        </div>
      )}
      {quoteErr && assetId && (
        <div className="flex flex-wrap items-center gap-3 rounded-input border border-[#5a2a24] bg-[rgba(255,138,122,.06)] px-4 py-3 text-[14px] text-error" role="alert">
          <TriangleAlert size={16} aria-hidden /> <span className="min-w-0 flex-1">{quoteErr}</span>
          <button type="button" onClick={() => load(assetId)} className={`${btnOutline} min-h-11 px-4 text-[14px]`}>
            Try again
          </button>
        </div>
      )}
      {!assetId && !loading && <p className="m-0 text-[14px] text-muted">Choose a chain and an asset to get the exact amount to send.</p>}

      {quote && asset && (
        <div className="flex flex-col gap-5 border-t border-line pt-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="inline-flex min-w-0 items-center gap-2 text-[15px] text-ink">
              <AssetMark asset={asset} />
              {quote.asset.symbol} on {quote.asset.chain}
            </span>
            {expired ? (
              <span className="inline-flex items-center gap-2 rounded-full border border-[#5a2a24] px-3 py-[5px] font-mono text-[12px] text-error">
                <Clock size={13} aria-hidden /> quote ran out
              </span>
            ) : (
              <span className={`inline-flex items-center gap-2 rounded-full border px-3 py-[5px] font-mono text-[12px] ${left < 120_000 ? 'border-[#5a2a24] text-error' : 'border-line-strong text-muted'}`} role="timer" aria-label={`Quote valid for ${mmss(left)}`}>
                <Clock size={13} aria-hidden /> valid {mmss(left)}
              </span>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-6">
            <div className="relative mx-auto shrink-0 sm:mx-0">
              <div className={expired ? 'opacity-15 blur-[2px]' : ''} aria-hidden={expired}>
                <QrCode value={quote.uri} size={196} label={`Wallet payment request: ${quote.amount} ${quote.asset.symbol} on ${quote.asset.chain} to ${payee ?? 'the Gully Labs treasury'}`} />
              </div>
              {expired && (
                <div className="absolute inset-0 flex items-center justify-center p-3">
                  <button type="button" onClick={() => load(asset.id)} disabled={busy} className="inline-flex min-h-11 items-center gap-2 rounded-btn bg-gold px-4 text-[14px] font-semibold text-bg hover:bg-gold-hover disabled:opacity-60">
                    <RefreshCw size={15} aria-hidden /> New quote
                  </button>
                </div>
              )}
            </div>
            <div className="flex min-w-0 flex-[1_1_240px] flex-col gap-2">
              <span className="font-mono text-[11px] tracking-[1px] text-faint">SEND EXACTLY</span>
              <span className={`font-display text-[clamp(30px,8vw,46px)] leading-none font-extrabold break-all ${expired ? 'text-faint line-through' : 'text-ink'}`}>
                {quote.amount} <span className="text-gold">{quote.asset.symbol}</span>
              </span>
              <span className="font-mono text-[12px] text-dim">
                {quote.usd} USD · {quote.asset.kind === 'native' && quote.price ? `1 ${quote.asset.symbol} = ${Number(quote.price.answer).toLocaleString('en-US', { maximumFractionDigits: 2 })} USD (Chainlink), rounded up` : 'stablecoin, 1:1, plus a tag in the last digits'}
              </span>
              <div className="mt-1 flex flex-wrap gap-2">
                <CopyChip text={quote.amount} label="Amount" />
                <CopyChip text={quote.treasury} label="Address" />
                {quote.asset.kind === 'token' && quote.asset.address && <CopyChip text={quote.asset.address} label="Token contract" />}
              </div>
            </div>
          </div>

          <p className="m-0 flex items-start gap-2 rounded-input border border-gold-line bg-[rgba(232,192,96,.06)] px-3 py-2 text-[13px] leading-[1.55] text-ink-2">
            <TriangleAlert size={15} className="mt-[2px] shrink-0 text-gold" aria-hidden />
            <span>
              Check the amount, the network and the address in your wallet before sending. Not every wallet reads the QR’s amount; if yours does not, copy them in by hand. Send exactly this amount: its last digits tie the payment to this invoice.
            </span>
          </p>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Row k={`${payee ? 'WALLET' : 'TREASURY'} ON ${quote.asset.chain.toUpperCase()}`} v={quote.treasury} />
            {quote.asset.kind === 'token' && quote.asset.address ? <Row k={`${quote.asset.symbol} CONTRACT · ${quote.asset.decimals} DECIMALS`} v={quote.asset.address} /> : <Row k="ASSET" v={`${quote.asset.chain}’s own coin (a plain transfer, not a token)`} />}
          </div>
          <span className="font-mono text-[11px] leading-[1.6] text-faint">
            Chain id {quote.chainId} · counts after {quote.confirmations} confirmations
            {quote.price && (
              <>
                {' '}
                · price from the{' '}
                <a href={`${asset.explorer}/address/${quote.price.feed}`} target="_blank" rel="noopener" className="text-dim underline-offset-4 hover:underline">
                  Chainlink {quote.price.description} feed
                </a>
                , round {quote.price.roundId.length > 12 ? `…${quote.price.roundId.slice(-8)}` : quote.price.roundId}
              </>
            )}
          </span>

          <div className="grid grid-cols-1 gap-5 border-t border-line pt-5 md:grid-cols-2">
            <div className="flex flex-col gap-3">
              <span className="font-mono text-[11px] tracking-[1px] text-faint">ONE CLICK</span>
              {showWallet ? (
                <Suspense fallback={<span className="block h-11 animate-pulse rounded-btn bg-surface-deep" />}>
                  <PayWallet
                    quote={quote}
                    disabled={expired || busy}
                    onError={setWalletErr}
                    onSent={(h) => {
                      setHash(h)
                      verify(quote, h)
                    }}
                  />
                </Suspense>
              ) : (
                <button type="button" disabled={expired || busy} onClick={() => setShowWallet(true)} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-btn bg-gold px-5 text-[15px] font-semibold text-bg transition-colors hover:bg-gold-hover disabled:cursor-not-allowed disabled:opacity-50">
                  <CreditCard size={16} aria-hidden /> Pay with wallet
                </button>
              )}
              <span className="text-[12px] leading-[1.5] text-faint">Sends exactly {quote.amount} {quote.asset.symbol} from the wallet you connect, after switching it to {quote.asset.chain}.</span>
              {walletErr && (
                <p className="m-0 text-[13px] text-error" role="alert">
                  {walletErr}
                </p>
              )}
            </div>
            <form className="flex flex-col gap-3" onSubmit={submit}>
              <label className="flex flex-col gap-2">
                <span className="font-mono text-[11px] tracking-[1px] text-faint">OR PASTE THE TRANSACTION HASH</span>
                <input className="h-11 w-full rounded-input border border-line-strong bg-bg px-3 font-mono text-[13px] text-ink outline-none transition-colors focus:border-gold" value={hash} onChange={(e) => setHash(e.target.value)} placeholder="0x…" spellCheck={false} autoComplete="off" inputMode="text" />
              </label>
              <button type="submit" disabled={busy || !hash.trim()} className={`${btnOutline} inline-flex min-h-11 items-center justify-center gap-2 px-5 text-[15px] disabled:opacity-50`}>
                {busy && <Loader2 size={15} className="animate-spin" aria-hidden />}
                Check payment
              </button>
              {expired && <span className="text-[12px] text-faint">A payment you sent before the quote ran out can still be checked here.</span>}
            </form>
          </div>

          {(check.s === 'checking' || check.s === 'pending') && (
            <div className="flex flex-col gap-3 rounded-input border border-line bg-bg px-4 py-4" role="status" aria-live="polite">
              <span className="inline-flex flex-wrap items-center gap-2 font-mono text-[12px] text-muted">
                <Loader2 size={14} className="animate-spin" aria-hidden />
                {check.s === 'checking' ? `Reading the transaction on ${quote.asset.chain}…` : `${check.message} Checking every few seconds.`}
                {txLink(check.hash) && (
                  <a href={txLink(check.hash)!} target="_blank" rel="noopener" className="inline-flex items-center gap-1 text-ink-2 underline-offset-4 hover:underline">
                    View on explorer <ArrowUpRight size={11} aria-hidden />
                  </a>
                )}
              </span>
              <ConfirmBar n={check.s === 'pending' ? check.confirmations : 0} needed={check.s === 'pending' ? check.needed : quote.confirmations} />
            </div>
          )}
          {check.s === 'error' && (
            <p className="m-0 rounded-input border border-[#5a2a24] bg-[rgba(255,138,122,.06)] px-4 py-3 text-[14px] text-error" role="alert">
              {check.message}
            </p>
          )}
        </div>
      )}

      <p className="m-0 flex items-start gap-2 border-t border-line pt-4 text-[13px] leading-[1.6] text-faint">
        <ShieldCheck size={15} className="mt-[2px] shrink-0 text-gold" aria-hidden />
        Your transfer goes straight to {payee ? `${payee}'s wallet` : 'the Gully Labs treasury wallet'}; nobody holds it in between. The server reads it from a public node of its chain and marks this invoice paid once it has enough confirmations. Each transaction counts once.
      </p>
    </div>
  )
}
