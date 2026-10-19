import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import { ArrowRight, CircleCheck, CircleSlash, Gauge, Loader2, ShieldCheck } from 'lucide-react'
import { deepConfirm, deepPagePath, deepQuote, PART_NAMES, PART_ORDER, rememberCheck, useDeepOffer, type Coverage, type DeepQuote, type PartKey } from '../../lib/holdersDeep'
import { APP_URL, isLocalHost } from '../../site-host'
import { btnGold, btnOutline } from '../ui'
import { StatusPill } from '../ui/StatusPill'

/* The Deep check offer on a Holder Map page: what it is, what can run on THIS chain (from GET /api/holders/deep),
   the price (free quota and credits first), and a two-step purchase: a quote, then a confirmation that sends the
   price the buyer saw (`expect`), so a changed price is never charged silently. Payment is Gully Pay's own invoice
   page; this card only links to it (through the check page). A chain where no part can run is not sold. */

const WHAT: Record<PartKey, string> = {
  trading: 'Wallets that bought in the first blocks, and the ones that bought together in one block.',
  funding: 'Where the biggest wallets got their first funds, hop by hop, up to an exchange or a known source.',
  clusters: 'Wallets that share a funder, with their combined share of the supply.',
  deployer: 'The deployer’s other tokens and what happened to them.',
}
const tone = (s: Coverage['funding']['state']) => (s === 'available' ? 'ok' : s === 'limited' ? 'warn' : 'off')
const SIGN_IN = `${isLocalHost() ? '/app' : APP_URL}/`

export function DeepCheckCard({ chain, token, symbol }: { chain: string; token: string; symbol?: string | null }) {
  const offer = useDeepOffer()
  const nav = useNavigate()
  const [scan, setScan] = useState('')
  const [quote, setQuote] = useState<DeepQuote | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => {
    setQuote(null)
    setErr(null)
  }, [chain, token])

  if (offer.k === 'loading') return <div className="card card-pad gl-skeleton h-[148px]" aria-busy="true" aria-label="Loading the Deep check" />
  if (offer.k === 'error') return null
  const { offer: o, coverage, quota, credits, checkout, signedIn } = offer.data
  const cov = coverage[chain]
  const parts = cov ? PART_ORDER.filter((k) => cov[k].state !== 'unavailable') : []
  const missing = cov ? PART_ORDER.filter((k) => cov[k].state === 'unavailable') : []
  const sellable = parts.length > 0
  const free = credits > 0 || (quota?.left ?? 0) > 0
  const canBundle = chain === 'base' || chain === 'bsc'
  const price = free ? 'Free' : `$${o.priceUsd}`

  const ask = async () => {
    setBusy(true)
    setErr(null)
    const r = await deepQuote(chain, token, scan.trim() || undefined)
    setBusy(false)
    if (!r) return setErr('Could not reach the server. Try again.')
    if (r.status === 422) return setErr(r.data.error ?? 'A Deep check cannot run here yet. Nothing was charged.')
    if (!r.ok || !('quote' in r.data)) return setErr(r.data.error ?? 'Could not get a quote.')
    setQuote(r.data.quote)
  }
  const go = async () => {
    if (!quote) return
    setBusy(true)
    setErr(null)
    const r = await deepConfirm(chain, token, quote.priceUsd, quote.bundle.applied ? (quote.bundle.scanId ?? undefined) : undefined)
    setBusy(false)
    if (!r) return setErr('Could not reach the server. Nothing was charged.')
    if (r.status === 409 && r.data.quote) {
      setQuote(r.data.quote)
      return setErr(r.data.error ?? 'The price changed. Check it and confirm again.')
    }
    if (!r.ok || !r.data.check) return setErr(r.data.error ?? 'Could not start the check. Nothing was charged.')
    rememberCheck(r.data.check.id)
    nav(deepPagePath(r.data.check.id))
  }

  return (
    <section aria-labelledby="hm-deep" className="card card-pad flex flex-col gap-3" data-deep-offer>
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="flex min-w-0 flex-col gap-1">
          <span className="eyebrow flex items-center gap-2">
            <Gauge className="icon-sm" aria-hidden /> Deep check
          </span>
          <h2 id="hm-deep" className="heading-3">
            Deep check · ${o.priceUsd}
          </h2>
          <p className="m-0 max-w-[62ch] text-[13px] leading-[1.5] text-muted">
            A paid investigation of {symbol ? `$${symbol}` : 'this token'}: who funded the big wallets, which wallets share a funder, the deployer’s record, and who sniped or bundled the launch. Every finding shows its source and how sure we are. Payment buys the work, never the result.
          </p>
        </div>
        <div className="flex flex-col items-end gap-1" aria-live="polite">
          <span className="font-display text-[34px] leading-none font-extrabold text-gold" data-deep-price>
            {sellable ? price : '—'}
          </span>
          {sellable && credits > 0 && <StatusPill tone="ok">{credits} free re-run credit{credits === 1 ? '' : 's'}</StatusPill>}
          {sellable && credits === 0 && quota && quota.freePerMonth > 0 && (
            <StatusPill tone={quota.left > 0 ? 'ok' : 'neutral'} title={`Resets ${new Date(quota.resetsAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`}>
              {quota.left} of {quota.freePerMonth} free this month · {quota.plan.name}
            </StatusPill>
          )}
          {sellable && !free && <span className="font-mono text-[11px] text-dim">once, per token</span>}
        </div>
      </div>

      {cov ? (
        <ul className="m-0 grid list-none grid-cols-[repeat(auto-fit,minmax(min(100%,210px),1fr))] gap-2 p-0" aria-label={`What a Deep check covers on ${chain}`}>
          {parts.map((k, i) => (
            <li key={k} className="flex animate-[gl-fade_.3s_ease_both] flex-col gap-1 rounded-[8px] border border-line bg-surface-deep px-3 py-2" style={{ animationDelay: `${i * 70}ms` }} data-deep-part={k} data-state={cov[k].state}>
              <span className="flex items-center justify-between gap-2">
                <b className="text-[13px] font-semibold text-ink">{PART_NAMES[k]}</b>
                <StatusPill tone={tone(cov[k].state)}>{cov[k].state === 'available' ? 'Runs' : 'Limited'}</StatusPill>
              </span>
              <span className="text-[12px] leading-[1.45] text-muted">{WHAT[k]}</span>
              {cov[k].state === 'limited' && cov[k].reason && <span className="text-[12px] leading-[1.45] text-dim">Limited: {cov[k].reason}</span>}
            </li>
          ))}
        </ul>
      ) : null}
      {sellable && missing.length > 0 && (
        <p className="m-0 flex items-start gap-2 text-[12px] leading-[1.5] text-dim" data-deep-missing>
          <CircleSlash className="icon-sm mt-[2px] flex-none" aria-hidden />
          <span>
            Not part of a check on this chain: {missing.map((k) => `${PART_NAMES[k].toLowerCase()} (${cov[k].reason ?? 'no data source here'})`).join('; ')}. You are not charged more or less for it.
          </span>
        </p>
      )}
      {!sellable && (
        <p className="m-0 rounded-[8px] border border-line bg-surface-deep px-3 py-2 text-[13px] leading-[1.5] text-muted" data-deep-unavailable>
          A Deep check is not offered on this chain yet: none of its parts has a data source here. Nothing is for sale until one does.
        </p>
      )}

      {sellable && canBundle && !free && !quote && (
        <label className="flex max-w-[520px] flex-col gap-1 text-[12px] text-muted" data-deep-bundle>
          <span className="flex items-center gap-1">
            <ShieldCheck className="icon-sm text-gold" aria-hidden /> {o.bundleScanDiscountPct}% off with a Security scan: paste the id of a paid Gully Security scan of this contract
          </span>
          {signedIn ? (
            <input value={scan} onChange={(e) => setScan(e.target.value)} placeholder="sec_…" spellCheck={false} className="min-h-11 rounded-input border border-line-strong bg-surface-deep px-3 font-mono text-[13px] text-ink placeholder:text-faint focus:border-gold focus:outline-none" />
          ) : (
            <a href={SIGN_IN} className="font-mono text-gold hover:text-gold-hover">
              Sign in to the app to use a scan discount ↗
            </a>
          )}
        </label>
      )}

      {err && (
        <p role="alert" className="m-0 rounded-[8px] border border-error/40 bg-surface-deep px-3 py-2 text-[13px] text-error" data-deep-error>
          {err}
        </p>
      )}

      {sellable && quote && (
        <div className="flex animate-[gl-fade_.25s_ease_both] flex-col gap-2 rounded-[8px] border border-gold/50 bg-surface-deep px-3 py-3" data-deep-quote aria-live="polite">
          <span className="font-mono text-[11px] tracking-[1px] text-dim">YOUR QUOTE · NOTHING CHARGED YET</span>
          <span className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <b className="font-display text-[28px] leading-none font-extrabold text-gold">{quote.priceUsd === 0 ? 'Free' : `$${quote.priceUsd}`}</b>
            {quote.bundle.applied && quote.priceUsd > 0 && (
              <span className="font-mono text-[12px] text-muted">
                <s>${quote.listPriceUsd}</s> · {quote.bundle.discountPct}% off with your Security scan
              </span>
            )}
            {quote.credit.used && <span className="font-mono text-[12px] text-muted">a credit from an earlier failed check, used before any price</span>}
            {!quote.credit.used && quote.free && <span className="font-mono text-[12px] text-muted">from your plan’s free checks ({quote.quota?.left} left)</span>}
          </span>
          {quote.bundleNote && <span className="text-[12px] text-dim">{quote.bundleNote}</span>}
          {!quote.free && !quote.checkout.enabled && <span className="text-[12px] text-error">Checks cannot be bought yet: checkout is not switched on. Nothing was charged.</span>}
          <span className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={go} disabled={busy || (!quote.free && !quote.checkout.enabled)} className={`${btnGold} inline-flex min-h-11 items-center gap-2 px-5 text-[14px] disabled:opacity-50`} data-deep-confirm>
              {busy ? <Loader2 className="icon-md animate-spin" aria-hidden /> : <CircleCheck className="icon-md" aria-hidden />}
              {quote.priceUsd === 0 ? 'Start the free check' : `Confirm and pay $${quote.priceUsd}`}
            </button>
            <button type="button" onClick={() => setQuote(null)} className={`${btnOutline} inline-flex min-h-11 items-center px-4 text-[13px]`}>
              Change
            </button>
            {quote.priceUsd > 0 && <span className="font-mono text-[11px] text-dim">You pay on the next page, through a Gully Pay invoice.</span>}
          </span>
        </div>
      )}

      {sellable && !quote && (
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" onClick={ask} disabled={busy} className={`${btnGold} inline-flex min-h-11 items-center gap-2 px-5 text-[14px] disabled:opacity-50`} data-deep-start>
            {busy ? <Loader2 className="icon-md animate-spin" aria-hidden /> : <ArrowRight className="icon-md" aria-hidden />}
            Get a quote
          </button>
          {!signedIn && (
            <a href={SIGN_IN} className="font-mono text-[12px] text-muted hover:text-gold-hover">
              Pro and Business members get {o.freePerMonth.pro} free checks a month: sign in ↗
            </a>
          )}
          {!checkout.enabled && <span className="font-mono text-[11px] text-dim">Paid checks open soon.</span>}
        </div>
      )}
      <p className="m-0 font-mono text-[11px] leading-[1.5] text-dim">
        If a paid check fails you get a credit for a free re-run (not an on-chain refund); write to hello@gullylabs.xyz for a refund. Information only, not advice.
      </p>
    </section>
  )
}
