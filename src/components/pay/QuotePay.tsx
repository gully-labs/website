import { ArrowUpRight, Clock, CreditCard, Loader2, RefreshCw } from 'lucide-react'
import { lazy, Suspense, useEffect, useRef, useState, type FormEvent } from 'react'
import type { PayAsset, Quote, Result } from '../../pages/developers/api'
import { CopyButton } from '../../pages/developers/Dialog'
import { ErrorLine, Skeleton } from '../../pages/developers/parts'
import { input } from '../../pages/developers/styles'
import { btnOutline } from '../ui'
import { toastError, toastInfo, toastSuccess } from '../ui/toast'
import { AssetMark, AssetPicker } from './AssetPicker'
import { feedExplorer, isSolanaChain, isSolanaSignature, priceSource } from '../solana/constants'
import { SolanaReferenceWatch } from '../solana/SolanaReferenceWatch'

/* Gully Pay checkout, shared by the dashboard's Plan & billing tab and the public /pay/<invoice> page:
   pick a chain and asset, get a 20-minute quote (exact amount, treasury, price source), pay with one
   click from a wallet or send by hand and paste the hash, then watch it confirm. Every figure comes
   from the server's quote; nothing is priced here. */

const PayWallet = lazy(() => import('./PayWallet'))
const SolanaPayWallet = lazy(() => import('../solana/SolanaPayWallet'))

type Check = { state: 'idle' } | { state: 'checking'; hash: string } | { state: 'pending'; hash: string; message: string } | { state: 'done'; hash: string } | { state: 'error'; message: string; hash?: string }

export function Field({ label, value, copy, what }: { label: string; value: string; copy?: string; what?: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="font-mono text-[10.5px] tracking-[1px] text-faint">{label}</span>
      <div className="flex items-center gap-2 rounded-input border border-line bg-bg py-1 pr-1 pl-3">
        <span className="min-w-0 flex-1 font-mono text-[13px] break-all text-ink">{value}</span>
        {copy !== undefined && <CopyButton text={copy} what={what} />}
      </div>
    </div>
  )
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

const mmss = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}
const minutesAgo = (iso: string, now: number) => {
  const m = Math.max(0, Math.round((now - Date.parse(iso)) / 60_000))
  return m < 1 ? 'under a minute ago' : m === 1 ? '1 minute ago' : `${m} minutes ago`
}
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`

export interface QuotePayProps {
  assets: PayAsset[]
  /** What is being paid for, e.g. "Pro for 30 days" or an invoice title. */
  label: string
  getQuote: (assetId: string) => Promise<Result<{ quote: Quote }>>
  verify: (quote: Quote, txHash: string) => Promise<Result<unknown>>
  onPaid: (data: unknown, quote: Quote, txHash: string) => void
  /** 'wallet': a signed-in wallet may pay any amount of at least the price; 'exact': only the exact amount matches. */
  match: 'wallet' | 'exact'
  initialAsset?: string | null
  /** false: the caller picked the asset already (initialAsset) and shows its own picker. */
  showPicker?: boolean
}

export function QuotePay({ assets, label, getQuote, verify, onPaid, match, initialAsset = null, showPicker = true }: QuotePayProps) {
  const [assetId, setAssetId] = useState<string | null>(initialAsset)
  const [quote, setQuote] = useState<Quote | null>(null)
  const [quoteErr, setQuoteErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(!!initialAsset)
  const [hash, setHash] = useState('')
  const [walletErr, setWalletErr] = useState('')
  const [showWallet, setShowWallet] = useState(false)
  const [check, setCheck] = useState<Check>({ state: 'idle' })
  const now = useNow(!!quote)
  // Bumped on unmount, on a new quote and on every new check, so a superseded wait stops.
  const run = useRef(0)
  const quoteRun = useRef(0)
  // Transactions already announced as detected, so polling does not toast again.
  const seen = useRef(new Set<string>())
  useEffect(() => {
    const r = run
    return () => void r.current++
  }, [])

  const asset = assets.find((a) => a.id === (quote?.asset.id ?? assetId)) ?? null
  const txLink = (h: string) => (asset ? `${asset.explorer}/tx/${h}` : null)

  const fetchQuote = (id: string, refresh = false) => {
    const me = ++quoteRun.current
    getQuote(id).then((r) => {
      if (me !== quoteRun.current) return
      setLoading(false)
      if (r.ok) {
        setQuote(r.data.quote)
        if (refresh) toastSuccess('New quote ready', { id: 'pay:quote', detail: `${r.data.quote.amount} ${r.data.quote.asset.symbol}, valid for 20 minutes.` })
      } else setQuoteErr(r.error)
    })
  }

  const load = (id: string) => {
    // Asking again for the same asset (the quote ran out) is a refresh; a new asset is a first quote.
    const refresh = !!quote && quote.asset.id === id
    run.current++
    setAssetId(id)
    setQuote(null)
    setQuoteErr(null)
    setWalletErr('')
    setCheck({ state: 'idle' })
    setLoading(true)
    fetchQuote(id, refresh)
  }

  useEffect(() => {
    if (initialAsset) fetchQuote(initialAsset)
    // Only on mount (loading starts true for it): later choices go through the picker.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Checks the hash; while the chain answers "not confirmed yet" (202) it asks again every six seconds, for up to ten minutes.
  const doVerify = async (q: Quote, txHash: string) => {
    const me = ++run.current
    setCheck({ state: 'checking', hash: txHash })
    for (let tries = 0; ; tries++) {
      const r = await verify(q, txHash)
      if (me !== run.current) return
      // 202 "not confirmed yet" is a 2xx, so api() answers it as ok: it is not a payment yet.
      // One toast per transaction, replaced as it moves on: found, then confirmed (or not).
      const tid = `pay:tx:${txHash}`
      if (r.ok && r.status !== 202) {
        setCheck({ state: 'done', hash: txHash })
        toastSuccess('Payment confirmed', { id: tid, detail: `${q.amount} ${q.asset.symbol} on ${q.asset.chain}.`, duration: 8000 })
        onPaid(r.data, q, txHash)
        return
      }
      const message = r.ok ? ((r.data as { error?: string } | null)?.error ?? 'Waiting for confirmations.') : r.error
      if (r.status !== 202 || tries >= 100) {
        const final = r.status === 202 ? `${message} Still not confirmed after ten minutes: check again later with the same hash.` : message
        setCheck({ state: 'error', hash: txHash, message: final })
        toastError('Payment not confirmed', { id: tid, detail: final })
        return
      }
      // The chain knows the transaction (in the mempool or mined, awaiting confirmations).
      if (!seen.current.has(txHash) && !/does not know/i.test(message)) {
        seen.current.add(txHash)
        toastInfo('Transaction detected', { id: tid, detail: message })
      }
      setCheck({ state: 'pending', hash: txHash, message })
      await new Promise((ok) => setTimeout(ok, 6_000))
      if (me !== run.current) return
    }
  }

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (!quote) return
    if (/^0x[0-9a-fA-F]{64}$/.test(hash.trim()) || (isSolanaChain(quote.chainId) && isSolanaSignature(hash))) doVerify(quote, hash.trim())
    else setCheck({ state: 'error', message: isSolanaChain(quote.chainId) ? 'A Solana transaction signature is 87 or 88 base58 characters.' : 'A transaction hash is 0x followed by 64 hexadecimal characters.' })
  }

  const busy = check.state === 'checking' || check.state === 'pending'
  const left = quote ? Date.parse(quote.expiresAt) - now : 0
  const expired = !!quote && left <= 0

  // Say once when a quote runs out (the timer chip turns into the "get a new one" button).
  const expiredId = expired && check.state !== 'done' ? quote.id : null
  useEffect(() => {
    if (expiredId) toastInfo('Quote expired', { id: 'pay:quote', detail: 'Get a new quote to pay. A payment already sent in time can still be checked.' })
  }, [expiredId])

  return (
    <div className="flex flex-col gap-5">
      {showPicker && (
        <div className="flex flex-col gap-3">
          <span className="font-mono text-[11px] tracking-[1px] text-faint">PAY WITH</span>
          <AssetPicker assets={assets} value={assetId} onChange={load} disabled={busy} />
        </div>
      )}

      {loading && (
        <div className="flex flex-col gap-3" aria-busy>
          <span className="inline-flex items-center gap-2 font-mono text-[12px] text-muted" role="status">
            <Loader2 size={14} className="animate-spin" aria-hidden /> Getting a quote{asset?.kind === 'native' ? ` from the ${priceSource(asset.chainId)} ${asset.feed?.description} price on ${asset.chain}` : ''}…
          </span>
          <Skeleton h={58} />
        </div>
      )}
      {quoteErr && assetId && <ErrorLine onRetry={() => load(assetId)}>{quoteErr}</ErrorLine>}
      {!assetId && !loading && <p className="m-0 text-[14px] text-muted">Choose a chain and an asset to get the exact amount to send.</p>}

      {quote && asset && (
        <div className={`flex flex-col gap-4 ${showPicker ? 'border-t border-line pt-5' : ''}`}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="inline-flex items-center gap-2 text-[15px] text-ink">
              <AssetMark asset={asset} />
              {quote.asset.symbol} on {quote.asset.chain}
              <span className="font-mono text-[12px] text-faint">
                · {label} · {quote.usd} USD
              </span>
            </span>
            {expired ? (
              <button type="button" onClick={() => load(asset.id)} disabled={busy} className="inline-flex min-h-10 items-center gap-2 rounded-btn border border-gold-line px-3 font-mono text-[12px] text-gold hover:border-gold disabled:opacity-50">
                <RefreshCw size={13} aria-hidden /> Quote ran out · get a new one
              </button>
            ) : (
              <span className={`inline-flex items-center gap-2 rounded-full border px-3 py-[5px] font-mono text-[12px] ${left < 120_000 ? 'border-[#5a2a24] text-error' : 'border-line-strong text-muted'}`} role="timer" aria-label={`Quote valid for ${mmss(left)}`}>
                <Clock size={13} aria-hidden /> valid {mmss(left)}
              </span>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4 max-[760px]:grid-cols-1">
            <Field label="SEND EXACTLY" value={`${quote.amount} ${quote.asset.symbol}`} copy={quote.amount} what="Amount" />
            <Field label={`TO THE TREASURY ON ${quote.asset.chain.toUpperCase()}`} value={quote.treasury} copy={quote.treasury} what="Address" />
          </div>

          <ul className="m-0 flex list-none flex-col gap-1 p-0 text-[13px] leading-[1.6] text-faint">
            <li>
              Network: {quote.asset.chain}{isSolanaChain(quote.chainId) ? '' : ` (chain id ${quote.chainId})`}.{' '}
              {quote.asset.kind === 'token' ? (
                <>
                  Token:{' '}
                  <a href={`${asset.explorer}/token/${quote.asset.address}`} target="_blank" rel="noopener" className="font-mono text-ink-2 underline-offset-4 hover:underline">
                    {quote.asset.symbol} {short(quote.asset.address ?? '')}
                  </a>{' '}
                  ({quote.asset.decimals} decimals).
                </>
              ) : (
                <>A plain transfer of the chain’s own coin, not a token.</>
              )}{' '}
              {isSolanaChain(quote.chainId) ? 'Counts once finalized (about 15 s).' : `Counts after ${quote.confirmations} confirmations.`}
            </li>
            {quote.price && (
              <li>
                Priced at 1 {quote.asset.symbol} = {Number(quote.price.answer).toLocaleString('en-US', { maximumFractionDigits: 2 })} USD by the{' '}
                <a href={`${feedExplorer(quote.chainId, asset.explorer)}/address/${quote.price.feed}`} target="_blank" rel="noopener" className="text-ink-2 underline-offset-4 hover:underline">
                  {priceSource(quote.chainId)} {quote.price.description} feed
                </a>{' '}
                (round {quote.price.roundId.length > 12 ? `…${quote.price.roundId.slice(-8)}` : quote.price.roundId}, updated {minutesAgo(quote.price.updatedAt, now)}), rounded up.
              </li>
            )}
            <li>
              {match === 'wallet'
                ? quote.asset.kind === 'native'
                  ? `The last digits tag this quote as yours. From the wallet you signed in with, at least ${quote.amount} ${quote.asset.symbol} counts; from any other wallet or an exchange, send exactly this amount.`
                  : `The last digits tag this quote as yours, so you can pay from any wallet or exchange. From the wallet you signed in with, any amount of at least ${quote.minAmount} ${quote.asset.symbol} also counts.`
                : 'Send exactly this amount: its last digits tie the payment to this invoice, from any wallet or exchange. A different amount cannot be matched.'}
            </li>
          </ul>

          <div className="grid grid-cols-2 gap-5 border-t border-line pt-5 max-[760px]:grid-cols-1">
            <div className="flex flex-col gap-3">
              <span className="font-mono text-[11px] tracking-[1px] text-faint">ONE CLICK</span>
              {showWallet ? (
                <Suspense fallback={<Skeleton h={44} />}>
                  {isSolanaChain(quote.chainId) ? (
                    <SolanaPayWallet
                      quote={quote}
                      disabled={expired || busy}
                      onError={setWalletErr}
                      onSent={(h) => {
                        setHash(h)
                        doVerify(quote, h)
                      }}
                    />
                  ) : (
                    <PayWallet
                      quote={quote}
                      disabled={expired || busy}
                      onError={setWalletErr}
                      onSent={(h) => {
                        setHash(h)
                        doVerify(quote, h)
                      }}
                    />
                  )}
                </Suspense>
              ) : (
                <button type="button" disabled={expired} onClick={() => setShowWallet(true)} className={`${btnOutline} inline-flex min-h-11 items-center justify-center gap-2 border-gold-line px-5 text-[15px] text-gold hover:border-gold disabled:cursor-not-allowed disabled:opacity-50`}>
                  <CreditCard size={16} aria-hidden /> Pay with a wallet
                </button>
              )}
              {expired && <span className="text-[13px] text-faint">Get a new quote to pay from a wallet. A payment you already sent in time can still be checked on the right.</span>}
              {walletErr && <ErrorLine>{walletErr}</ErrorLine>}
              {isSolanaChain(quote.chainId) && (
                <SolanaReferenceWatch
                  quoteId={quote.id}
                  reference={(quote as { reference?: string | null }).reference}
                  active={!busy && check.state !== 'done'}
                  onFound={(h) => {
                    setHash(h)
                    doVerify(quote, h)
                  }}
                />
              )}
            </div>
            <form className="flex flex-col gap-3" onSubmit={submit}>
              <label className="flex flex-col gap-2">
                <span className="font-mono text-[11px] tracking-[1px] text-faint">OR PASTE THE TRANSACTION {isSolanaChain(quote.chainId) ? 'SIGNATURE' : 'HASH'}</span>
                <input className={`${input} font-mono text-[13px]`} value={hash} onChange={(e) => setHash(e.target.value)} placeholder={isSolanaChain(quote.chainId) ? '5h3…' : '0x…'} spellCheck={false} autoComplete="off" />
              </label>
              <button type="submit" disabled={busy || !hash.trim()} className={`${btnOutline} inline-flex min-h-11 items-center justify-center gap-2 px-5 text-[15px] disabled:opacity-50`}>
                {busy && <Loader2 size={15} className="animate-spin" aria-hidden />}
                Check payment
              </button>
            </form>
          </div>

          {check.state === 'checking' && (
            <p className="m-0 inline-flex items-center gap-2 font-mono text-[12px] text-muted" role="status">
              <Loader2 size={14} className="animate-spin" aria-hidden /> Reading the transaction on {quote.asset.chain}…
            </p>
          )}
          {check.state === 'pending' && (
            <p className="m-0 inline-flex flex-wrap items-center gap-2 font-mono text-[12px] text-muted" role="status">
              <Loader2 size={14} className="animate-spin" aria-hidden /> Pending: {check.message} Checking every few seconds.{' '}
              {txLink(check.hash) && (
                <a href={txLink(check.hash)!} target="_blank" rel="noopener" className="inline-flex items-center gap-1 text-ink-2 underline-offset-4 hover:underline">
                  View on explorer <ArrowUpRight size={11} aria-hidden />
                </a>
              )}
            </p>
          )}
          {check.state === 'done' && (
            <p className="m-0 font-mono text-[12px] text-green" role="status">
              Confirmed.
            </p>
          )}
          {check.state === 'error' && <ErrorLine>{check.message}</ErrorLine>}
        </div>
      )}
    </div>
  )
}
