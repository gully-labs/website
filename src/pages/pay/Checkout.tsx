import { ArrowUpRight, ChevronDown, Clock, Copy, CreditCard, Download, ExternalLink, FileText, Loader2, QrCode as QrIcon, RefreshCw, ShieldCheck, TriangleAlert } from 'lucide-react'
import { lazy, Suspense, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { Link } from 'react-router'
import { AssetPicker } from '../../components/pay/AssetPicker'
import { TokenLogo } from '../../components/logos/TokenLogo'
import { btnOutline } from '../../components/ui'
import { payApi, type Quote } from './api'
import { fmtTime, type Invoice } from './invoice'
import { QrCode } from './QrCode'
import { copyWithToast, toastError, toastInfo, toastSuccess } from '../../components/ui/toast'
import { feedExplorer, isSolanaChain, isSolanaSignature, priceSource } from '../../components/solana/constants'
import { SolanaReferenceWatch } from '../../components/solana/SolanaReferenceWatch'
import { accentOf, GULLY_BRAND, storeName, type Brand } from './brand'
import { MobilePayBar } from './CheckoutFrame'
import { track } from '../../lib/track'

/* The payment panel of one open invoice (/pay/<id>, /pay/m/<id>; also where a pay link lands), in the
   standalone checkout: 1) network and token, 2) the exact amount with copy buttons and the quote's
   countdown, 3) Pay with wallet (wagmi + RainbowKit, loaded only when asked for) or Scan QR (EIP-681 /
   Solana Pay, built by the server) with a pasted-hash fallback, 4) the live status: waiting, seen,
   confirmations, paid. The paid state shows the receipt with a download and a way back to the store.
   Every figure is the server's. The wallet components' transaction logic is theirs alone (PayWallet.tsx,
   SolanaPayWallet.tsx): this file only places them. */

const PayWallet = lazy(() => import('../../components/pay/PayWallet'))
const SolanaPayWallet = lazy(() => import('../../components/solana/SolanaPayWallet'))
// The live confirmations ring and the native-coin price chart (ECharts loads with them, on demand).
const ConfirmRing = lazy(() => import('./PayCharts').then((m) => ({ default: m.ConfirmRing })))
const PriceChart = lazy(() => import('./PayCharts').then((m) => ({ default: m.PriceChart })))
const chartWait = <span className="block h-[112px] animate-pulse rounded-input bg-surface-deep" />

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

export function CopyChip({ text, label, size = 'sm' }: { text: string; label: string; size?: 'sm' | 'md' }) {
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
      className={`inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-btn border px-3 font-mono transition-colors ${size === 'md' ? 'text-[13px]' : 'text-[12px]'} ${done ? 'border-success-line text-green' : 'border-line-strong text-ink-2 hover:border-gold hover:text-ink'}`}
      aria-label={done ? `${label} copied` : `Copy ${label}`}
    >
      <Copy size={13} aria-hidden /> {done ? 'Copied' : label}
    </button>
  )
}

function Row({ k, v, copy, copyLabel }: { k: string; v: string; copy?: string; copyLabel?: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="font-mono text-[11px] tracking-[1px] text-faint">{k}</span>
      <div className="flex min-w-0 items-center gap-2 rounded-input border border-line bg-bg py-1 pr-1 pl-3">
        <span className="min-w-0 flex-1 font-mono text-[13px] break-all text-ink">{v}</span>
        {copy !== undefined && <CopyChip text={copy} label={copyLabel ?? 'Copy'} />}
      </div>
    </div>
  )
}

/** A numbered step of the payment panel. */
function Step({ n, title, aside, children }: { n: number; title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3" aria-label={`${n}. ${title}`}>
      <header className="flex flex-wrap items-center justify-between gap-2">
        <span className="inline-flex items-center gap-2 text-[14px] font-semibold text-ink">
          <span aria-hidden className="grid size-6 place-items-center rounded-full border border-line-strong font-mono text-[11px] text-dim">
            {n}
          </span>
          {title}
        </span>
        {aside}
      </header>
      {children}
    </section>
  )
}

export type Phase = 'choose' | 'send' | 'confirming' | 'paid'

/** Where the payment stands: waiting for it, seen on chain, confirming (with progress), paid. Animated: the live step pulses, the track fills. */
export function StatusTrack({ check, hasQuote, needed }: { check: Check; hasQuote: boolean; needed: number }) {
  const idx = check.s === 'done' ? 3 : check.s === 'pending' ? 2 : check.s === 'checking' ? 1 : 0
  const have = check.s === 'pending' ? check.confirmations : check.s === 'done' ? needed : 0
  const steps = ['Waiting', 'Seen on chain', check.s === 'pending' ? `Confirming ${have}/${check.needed}` : 'Confirming', 'Paid']
  const text = check.s === 'done' ? 'Paid.' : check.s === 'pending' ? `${check.message} Checking every few seconds.` : check.s === 'checking' ? 'Reading the transaction on chain…' : hasQuote ? 'Send the amount from your wallet; this page notices on its own.' : 'Pick a network and token to get the exact amount.'
  return (
    <div className="flex flex-col gap-2" role="status" aria-live="polite" data-testid="status-track" data-step={idx}>
      <ol className="m-0 grid list-none grid-cols-4 gap-[6px] p-0" aria-label="Payment status">
        {steps.map((l, i) => {
          const on = i <= idx && (hasQuote || i === 0)
          const live = i === idx && check.s !== 'done'
          return (
            <li key={i} className="flex min-w-0 flex-col gap-[6px]" aria-current={i === idx ? 'step' : undefined}>
              <span className={`relative h-1 overflow-hidden rounded-full ${i < idx || check.s === 'done' ? 'bg-green' : 'bg-grid'}`}>
                {live && hasQuote && <span className="absolute inset-y-0 left-0 rounded-full bg-gold transition-[width] duration-500" style={{ width: i === 2 && check.s === 'pending' ? `${Math.min(100, Math.round((have / Math.max(1, check.needed)) * 100))}%` : '50%' }} />}
              </span>
              <span className={`inline-flex min-w-0 items-center gap-1 text-[11.5px] leading-tight ${on ? 'text-ink' : 'text-faint'}`}>
                {live && hasQuote && <i aria-hidden className="size-[6px] shrink-0 animate-blink rounded-full bg-gold" />}
                <span className="truncate">{l}</span>
              </span>
            </li>
          )
        })}
      </ol>
      <span className="text-[12.5px] leading-[1.5] text-muted">{text}</span>
    </div>
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

/** A check mark that draws itself (a plain fade under reduced motion: gl-draw is redefined there). */
export function AnimatedCheck({ size = 56 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 56 56" fill="none" aria-hidden className="shrink-0">
      <circle cx="28" cy="28" r="25" stroke="#2f6b35" strokeWidth="2" pathLength={1} strokeDasharray={1} style={{ animation: 'gl-draw .6s ease both' }} />
      <circle cx="28" cy="28" r="25" fill="rgba(116,194,123,.10)" style={{ animation: 'gl-fade .4s ease both' }} />
      <path d="M17 29l7.5 7.5L39.5 21" stroke="#74c27b" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" pathLength={1} strokeDasharray={1} style={{ animation: 'gl-draw .5s .35s ease both' }} />
    </svg>
  )
}

/** The success panel of a paid invoice: the receipt (amount, tx, time, store), a download and the way back. */
export function PaidPanel({ invoice, brand = GULLY_BRAND, receiptPath = `/pay/${invoice.id}/receipt` }: { invoice: Invoice; brand?: Brand; receiptPath?: string }) {
  const p = invoice.payment
  const paidAsset = p ? invoice.assets.find((a) => a.id === p.asset) : undefined
  const who = brand.gully ? 'Gully Labs' : storeName(brand)
  const accent = accentOf(brand)
  return (
    <div className="flex flex-col gap-5" data-testid="state-paid">
      <div className="flex items-start gap-4">
        <AnimatedCheck />
        <div className="flex min-w-0 flex-col gap-1 pt-1">
          <span className="text-[22px] leading-none font-semibold text-ink">Payment received</span>
          <span className="text-[14px] leading-[1.5] text-muted">{p ? `${p.amount} ${p.symbol} on ${p.chain} to ${who}, confirmed ${fmtTime(invoice.paidAt)}.` : `Paid ${fmtTime(invoice.paidAt)}.`}</span>
        </div>
      </div>
      {p && (
        <dl className="m-0 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 rounded-input border border-line bg-bg px-4 py-3 font-mono text-[12px]" data-testid="receipt">
          <dt className="text-faint">AMOUNT</dt>
          <dd className="m-0 break-all text-ink">
            {paidAsset && <TokenLogo symbol={p.symbol} chain={paidAsset.chainKey} address={paidAsset.address} size={16} decorative className="mr-1.5 -mt-0.5 align-middle" />}
            {p.amount} {p.symbol}
            {p.usd ? <span className="text-faint"> · {p.usd} USD</span> : null}
          </dd>
          <dt className="text-faint">TO</dt>
          <dd className="m-0 break-all text-ink-2">
            {who}
            {p.to ? <span className="text-faint"> · {short(p.to)}</span> : null}
          </dd>
          <dt className="text-faint">FROM</dt>
          <dd className="m-0 break-all text-ink-2">{p.from}</dd>
          <dt className="text-faint">TX</dt>
          <dd className="m-0 break-all">
            {p.txUrl ? (
              <a href={p.txUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-ink-2 underline-offset-4 hover:text-gold hover:underline">
                {short(p.txHash)} <ArrowUpRight size={12} aria-hidden />
              <span className="sr-only"> (opens in a new tab)</span></a>
            ) : (
              short(p.txHash)
            )}
          </dd>
          <dt className="text-faint">TIME</dt>
          <dd className="m-0 text-ink-2">{fmtTime(invoice.paidAt)}</dd>
          <dt className="text-faint">BLOCK</dt>
          <dd className="m-0 text-ink-2">{p.blockNumber}</dd>
        </dl>
      )}
      {p && paidAsset && (
        <div className="grid grid-cols-1 gap-5 rounded-input border border-line bg-bg p-4">
          <Suspense fallback={chartWait}>
            <ConfirmRing n={paidAsset.confirmations} needed={paidAsset.confirmations} state="done" chain={p.chain} />
            {paidAsset.kind === 'native' && p.price && <PriceChart asset={paidAsset} quoted={{ answer: p.price.answer, updatedAt: p.price.updatedAt, label: 'paid at' }} />}
          </Suspense>
        </div>
      )}
      <div className="flex flex-wrap gap-3">
        <Link to={`${receiptPath}?print=1`} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center gap-2 rounded-btn px-5 text-[15px] font-semibold transition-colors hover:brightness-110" style={{ background: accent.fill, color: accent.onFill }} data-testid="download-receipt">
          <Download size={16} aria-hidden /> Download receipt
        <span aria-hidden> ↗</span><span className="sr-only"> (opens in a new tab)</span></Link>
        <Link to={receiptPath} className={`${btnOutline} inline-flex min-h-11 items-center gap-2 px-5 text-[15px]`}>
          <FileText size={16} aria-hidden /> View receipt
        </Link>
        {p?.txUrl && (
          <a href={p.txUrl} target="_blank" rel="noopener noreferrer" className={`${btnOutline} inline-flex min-h-11 items-center gap-2 px-5 text-[15px]`}>
            Explorer <ArrowUpRight size={15} aria-hidden />
          <span className="sr-only"> (opens in a new tab)</span></a>
        )}
        {brand.website && !brand.gully && (
          <a href={brand.website} rel="noopener noreferrer nofollow" className={`${btnOutline} inline-flex min-h-11 items-center gap-2 px-5 text-[15px]`} data-testid="return-to-store">
            Return to {storeName(brand)} <ExternalLink size={14} aria-hidden />
          </a>
        )}
      </div>
    </div>
  )
}

/** Base units as a decimal string, BigInt only (no float rounding). */
function units(raw: string, decimals: number): string {
  const v = BigInt(raw)
  const d = 10n ** BigInt(decimals)
  const frac = (v % d).toString().padStart(decimals, '0').replace(/0+$/, '')
  return frac ? `${v / d}.${frac}` : `${v / d}`
}

export interface CheckoutProps {
  invoice: Invoice
  initialAsset: string | null
  onPaid: (i: Invoice) => void
  onPhase?: (p: Phase) => void
  /** Merchant stores (src/pages/merchant-pay): their own API base and the store paid, instead of the Gully Labs treasury. */
  api?: string
  payee?: string
  brand?: Brand
}

/** The live part of an open invoice's checkout. */
export function Checkout({ invoice, initialAsset, onPaid, onPhase, api = `/api/pay/${invoice.id}`, payee, brand = GULLY_BRAND }: CheckoutProps) {
  const assets = invoice.assets
  const start = initialAsset && assets.some((a) => a.id === initialAsset) ? initialAsset : assets.length === 1 ? assets[0].id : null
  const [assetId, setAssetId] = useState<string | null>(start)
  const [quote, setQuote] = useState<Quote | null>(null)
  const [quoteErr, setQuoteErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(!!start)
  const [hash, setHash] = useState('')
  const [walletErr, setWalletErr] = useState('')
  const [showWallet, setShowWallet] = useState(false)
  const [showQr, setShowQr] = useState(() => typeof window !== 'undefined' && window.matchMedia('(min-width: 1024px)').matches)
  const [check, setCheck] = useState<Check>({ s: 'idle' })
  const now = useNow(!!quote)
  const run = useRef(0)
  const quoteRun = useRef(0)
  const walletSlot = useRef<HTMLDivElement>(null)
  const pickerSlot = useRef<HTMLDivElement>(null)
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
  const who = payee ?? (brand.gully ? 'the Gully Labs treasury' : storeName(brand))
  const accent = accentOf(brand)
  // Analytics kind: a merchant store's invoice, or one of ours (plans paid by invoice, scans, admin invoices, pay links).
  const kind = api.startsWith('/api/pay/m/') ? 'store' : 'invoice'

  const fetchQuote = (id: string, refresh = false) => {
    const me = ++quoteRun.current
    payApi<{ quote: Quote }>(`${api}/quote`, { method: 'POST', body: { asset: id } }).then((r) => {
      if (me !== quoteRun.current) return
      setLoading(false)
      if (r.ok) {
        setQuote(r.data.quote)
        if (!refresh) track('checkout-started', { kind, chain: r.data.quote.asset.chain, asset: r.data.quote.asset.symbol })
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
        track('checkout-paid', { kind, chain: q.asset.chain, asset: q.asset.symbol })
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
    if (/^0x[0-9a-fA-F]{64}$/.test(h) || (isSolanaChain(quote.chainId) && isSolanaSignature(h))) verify(quote, h)
    else setCheck({ s: 'error', message: isSolanaChain(quote.chainId) ? 'A Solana transaction signature is 87 or 88 base58 characters.' : 'A transaction hash is 0x followed by 64 hexadecimal characters.' })
  }

  const txLink = (h: string) => (asset ? `${asset.explorer}/tx/${h}` : null)

  /** The sticky bar's button: shows the wallet button (first time) or presses it, and brings it into view. */
  const payNow = () => {
    if (!quote) return pickerSlot.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    const btn = walletSlot.current?.querySelector('button')
    if (showWallet && btn && !btn.disabled) btn.click()
    else setShowWallet(true)
    walletSlot.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }

  const wallet = quote && (
    <div ref={walletSlot} className="flex flex-col gap-2">
      {showWallet ? (
        <Suspense fallback={<span className="block h-11 animate-pulse rounded-btn bg-surface-deep" />}>
          {isSolanaChain(quote.chainId) ? (
            <SolanaPayWallet
              quote={quote}
              disabled={expired || busy}
              onError={setWalletErr}
              onSent={(h) => {
                setHash(h)
                verify(quote, h)
              }}
            />
          ) : (
            <PayWallet
              quote={quote}
              disabled={expired || busy}
              onError={setWalletErr}
              onSent={(h) => {
                setHash(h)
                verify(quote, h)
              }}
            />
          )}
        </Suspense>
      ) : (
        <button type="button" disabled={expired || busy} onClick={() => setShowWallet(true)} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-btn px-5 text-[15px] font-semibold transition-[filter] hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50" style={{ background: accent.fill, color: accent.onFill }} data-testid="pay-with-wallet">
          <CreditCard size={16} aria-hidden /> Pay with wallet
        </button>
      )}
    </div>
  )

  return (
    <div className="flex flex-col gap-6">
      <StatusTrack check={check} hasQuote={!!quote} needed={quote?.confirmations ?? 0} />

      <Step n={1} title="Network and token">
        <div ref={pickerSlot}>
          <AssetPicker assets={assets} value={assetId} onChange={load} disabled={busy} />
        </div>
        {!assetId && !loading && <p className="m-0 text-[13px] text-muted">Choose a chain and an asset to get the exact amount to send.</p>}
      </Step>

      {loading && (
        <div className="flex flex-col gap-3" aria-busy>
          <span className="inline-flex items-center gap-2 font-mono text-[12px] text-muted" role="status">
            <Loader2 size={14} className="animate-spin" aria-hidden /> Getting a quote{asset?.kind === 'native' ? ` from the ${priceSource(asset.chainId)} ${asset.feed?.description} price on ${asset.chain}` : ''}…
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

      {quote && asset && (
        <>
          <Step
            n={2}
            title="Amount to send"
            aside={
              expired ? (
                <span className="inline-flex items-center gap-2 rounded-full border border-[#5a2a24] px-3 py-[5px] font-mono text-[12px] text-error">
                  <Clock size={13} aria-hidden /> quote ran out
                </span>
              ) : (
                <span className={`inline-flex items-center gap-2 rounded-full border px-3 py-[5px] font-mono text-[12px] ${left < 120_000 ? 'border-[#5a2a24] text-error' : 'border-line-strong text-muted'}`} role="timer" aria-label={`Quote valid for ${mmss(left)}`}>
                  <Clock size={13} aria-hidden /> valid {mmss(left)}
                </span>
              )
            }
          >
            <div className="flex flex-col gap-3 rounded-input border border-line bg-bg p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <span className="inline-flex min-w-0 items-center gap-2 text-[14px] text-ink-2">
                  <TokenLogo symbol={quote.asset.symbol} chain={asset.chainKey} address={quote.asset.address} size={20} decorative />
                  {quote.asset.symbol} on {quote.asset.chain}
                </span>
                {expired && (
                  <button type="button" onClick={() => load(asset.id)} disabled={busy} className="inline-flex min-h-11 items-center gap-2 rounded-btn bg-gold px-4 text-[14px] font-semibold text-bg hover:bg-gold-hover disabled:opacity-60">
                    <RefreshCw size={15} aria-hidden /> New quote
                  </button>
                )}
              </div>
              <div className="flex flex-wrap items-end justify-between gap-3">
                <span className={`font-display text-[clamp(28px,6vw,38px)] leading-none font-extrabold break-all ${expired ? 'text-faint line-through' : 'text-ink'}`} data-testid="quote-amount">
                  {quote.amount} <span className={expired ? '' : 'text-gold'}>{quote.asset.symbol}</span>
                </span>
                {!expired && <CopyChip text={quote.amount} label="Copy amount" size="md" />}
              </div>
              <span className="font-mono text-[12px] leading-[1.5] text-dim">
                = {quote.usd} USD · {quote.asset.kind === 'native' && quote.price ? `1 ${quote.asset.symbol} = ${Number(quote.price.answer).toLocaleString('en-US', { maximumFractionDigits: 2 })} USD (${priceSource(quote.chainId)}), rounded up` : 'stablecoin, 1:1, plus a tag in the last digits'}
              </span>
            </div>
          </Step>

          <Step n={3} title="Pay">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
              {wallet}
              <button type="button" onClick={() => setShowQr((v) => !v)} aria-expanded={showQr} aria-controls="pay-qr" className={`${btnOutline} inline-flex min-h-12 items-center justify-center gap-2 px-5 text-[15px]`} data-testid="scan-qr">
                <QrIcon size={16} aria-hidden /> {showQr ? 'Hide QR' : 'Scan QR'}
              </button>
            </div>
            <span className="text-[12px] leading-[1.5] text-faint">
              {quote.split
                ? `Sends exactly ${quote.amount} ${quote.asset.symbol} in one transaction through Request Network's fee contract: ${units(quote.split.merchantRaw, quote.asset.decimals)} to the merchant and ${units(quote.split.feeRaw, quote.asset.decimals)} Gully Pay fee. Your wallet first asks to allow exactly that amount if it has not already.`
                : `Sends exactly ${quote.amount} ${quote.asset.symbol} from the wallet you connect, after switching it to ${quote.asset.chain}.`}
            </span>
            {isSolanaChain(quote.chainId) && (
              <SolanaReferenceWatch
                quoteId={quote.id}
                reference={(quote as { reference?: string | null }).reference}
                active={!busy && check.s !== 'done'}
                onFound={(h) => {
                  setHash(h)
                  verify(quote, h)
                }}
              />
            )}
            {walletErr && (
              <p className="m-0 text-[13px] text-error" role="alert">
                {walletErr}
              </p>
            )}

            {showQr && (
              <div id="pay-qr" className="flex flex-col gap-4 rounded-input border border-line bg-bg p-4" style={{ animation: 'gl-fade .25s ease both' }}>
                <div className="flex flex-wrap items-start gap-5">
                  <div className="relative mx-auto shrink-0 sm:mx-0">
                    <div className={expired ? 'opacity-15 blur-[2px]' : ''} aria-hidden={expired}>
                      <QrCode value={quote.uri} size={176} label={`Wallet payment request: ${quote.amount} ${quote.asset.symbol} on ${quote.asset.chain} to ${who}`} />
                    </div>
                    {expired && (
                      <div className="absolute inset-0 flex items-center justify-center p-3">
                        <button type="button" onClick={() => load(asset.id)} disabled={busy} className="inline-flex min-h-11 items-center gap-2 rounded-btn bg-gold px-4 text-[14px] font-semibold text-bg hover:bg-gold-hover disabled:opacity-60">
                          <RefreshCw size={15} aria-hidden /> New quote
                        </button>
                      </div>
                    )}
                  </div>
                  <div className="flex min-w-0 flex-[1_1_220px] flex-col gap-3">
                    <span className="text-[13px] leading-[1.55] text-ink-2">Scan this with your wallet app, or copy the details in by hand.</span>
                    <Row k={`${brand.gully ? 'TREASURY' : 'WALLET'} ON ${quote.asset.chain.toUpperCase()}`} v={quote.treasury} copy={quote.treasury} copyLabel="Address" />
                    {quote.asset.kind === 'token' && quote.asset.address ? <Row k={`${quote.asset.symbol} CONTRACT · ${quote.asset.decimals} DECIMALS`} v={quote.asset.address} copy={quote.asset.address} copyLabel="Contract" /> : <Row k="ASSET" v={`${quote.asset.chain}’s own coin (a plain transfer, not a token)`} />}
                  </div>
                </div>
                <p className="m-0 flex items-start gap-2 text-[12.5px] leading-[1.55] text-muted">
                  <TriangleAlert size={14} className="mt-[2px] shrink-0 text-gold" aria-hidden />
                  <span>Check the amount, the network and the address in your wallet before sending. Not every wallet reads the QR’s amount; if yours does not, copy it in. Send exactly this amount: its last digits tie the payment to this invoice.</span>
                </p>
              </div>
            )}

            <details className="group rounded-input border border-line bg-bg">
              <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-4 text-[13px] text-ink-2 [&::-webkit-details-marker]:hidden">
                Paid from another wallet? Paste the transaction {isSolanaChain(quote.chainId) ? 'signature' : 'hash'}
                <ChevronDown size={15} className="shrink-0 transition-transform group-open:rotate-180" aria-hidden />
              </summary>
              <form className="flex flex-col gap-3 px-4 pb-4" onSubmit={submit}>
                <label className="flex flex-col gap-2">
                  <span className="sr-only">Transaction {isSolanaChain(quote.chainId) ? 'signature' : 'hash'}</span>
                  <input className="h-11 w-full rounded-input border border-line-strong bg-surface px-3 font-mono text-[13px] text-ink outline-none transition-colors focus:border-gold" value={hash} onChange={(e) => setHash(e.target.value)} placeholder={isSolanaChain(quote.chainId) ? '5h3…' : '0x…'} spellCheck={false} autoComplete="off" inputMode="text" />
                </label>
                <button type="submit" disabled={busy || !hash.trim()} className={`${btnOutline} inline-flex min-h-11 items-center justify-center gap-2 px-5 text-[14px] disabled:opacity-50`}>
                  {busy && <Loader2 size={15} className="animate-spin" aria-hidden />}
                  Check payment
                </button>
                {expired && <span className="text-[12px] text-faint">A payment you sent before the quote ran out can still be checked here.</span>}
              </form>
            </details>
          </Step>

          <Step n={4} title="Status">
            <div className={`grid grid-cols-1 gap-5 rounded-input border border-line bg-bg p-4 ${quote.asset.kind === 'native' ? 'md:grid-cols-[minmax(0,240px)_minmax(0,1fr)]' : ''}`}>
              <Suspense fallback={chartWait}>
                <ConfirmRing
                  n={check.s === 'pending' ? check.confirmations : 0}
                  needed={check.s === 'pending' ? check.needed : quote.confirmations}
                  state={check.s === 'done' ? 'done' : check.s === 'pending' ? 'pending' : check.s === 'checking' ? 'checking' : 'waiting'}
                  chain={quote.asset.chain}
                />
                {quote.asset.kind === 'native' && <PriceChart asset={quote.asset} quoted={quote.price ? { answer: quote.price.answer, updatedAt: quote.price.updatedAt } : null} />}
              </Suspense>
            </div>
            {check.s === 'pending' && <ConfirmBar n={check.confirmations} needed={check.needed} />}
            {(check.s === 'checking' || check.s === 'pending') && (
              <div className="flex flex-col gap-3 rounded-input border border-line bg-bg px-4 py-3" role="status" aria-live="polite">
                <span className="inline-flex flex-wrap items-center gap-2 font-mono text-[12px] text-muted">
                  <Loader2 size={14} className="animate-spin" aria-hidden />
                  {check.s === 'checking' ? `Reading the transaction on ${quote.asset.chain}…` : `${check.message} Checking every few seconds.`}
                  {txLink(check.hash) && (
                    <a href={txLink(check.hash)!} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-ink-2 underline-offset-4 hover:underline">
                      View on explorer <ArrowUpRight size={11} aria-hidden />
                    <span className="sr-only"> (opens in a new tab)</span></a>
                  )}
                </span>
              </div>
            )}
            {check.s === 'error' && (
              <p className="m-0 rounded-input border border-[#5a2a24] bg-[rgba(255,138,122,.06)] px-4 py-3 text-[14px] text-error" role="alert">
                {check.message}
              </p>
            )}
            <span className="font-mono text-[11px] leading-[1.6] text-faint">
              {isSolanaChain(quote.chainId) ? 'Solana mainnet · counts once finalized (about 15 s)' : `Chain id ${quote.chainId} · counts after ${quote.confirmations} confirmations`}
              {quote.price && (
                <>
                  {' '}
                  · price from the{' '}
                  <a href={`${feedExplorer(quote.chainId, asset.explorer)}/address/${quote.price.feed}`} target="_blank" rel="noopener noreferrer" className="text-dim underline-offset-4 hover:underline">
                    {priceSource(quote.chainId)} {quote.price.description} feed
                  <span aria-hidden> ↗</span><span className="sr-only"> (opens in a new tab)</span></a>
                  , round {quote.price.roundId.length > 12 ? `…${quote.price.roundId.slice(-8)}` : quote.price.roundId}
                </>
              )}
            </span>
          </Step>
        </>
      )}

      <p className="m-0 flex items-start gap-2 border-t border-line pt-4 text-[12.5px] leading-[1.6] text-faint">
        <ShieldCheck size={15} className="mt-[2px] shrink-0 text-gold" aria-hidden />
        Your transfer goes straight to {brand.gully ? 'the Gully Labs treasury wallet' : `${storeName(brand)}'s wallet`}; nobody holds it in between. The server reads it from a public node of its chain and marks this invoice paid once it has enough confirmations. Each transaction counts once.
      </p>

      {check.s !== 'done' && (
        <MobilePayBar total={quote ? `${quote.amount} ${quote.asset.symbol}` : `${invoice.usd} USD`}>
          <button type="button" onClick={payNow} disabled={!!quote && (expired || busy)} className="inline-flex min-h-12 shrink-0 items-center justify-center gap-2 rounded-btn px-5 text-[15px] font-semibold transition-[filter] hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50" style={{ background: accent.fill, color: accent.onFill }} data-testid="mobile-pay">
            <CreditCard size={16} aria-hidden /> {quote ? (expired ? 'Quote ran out' : 'Pay with wallet') : 'Choose a token'}
          </button>
        </MobilePayBar>
      )}
    </div>
  )
}
