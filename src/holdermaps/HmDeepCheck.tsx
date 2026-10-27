/* The $9 Deep check on a HolderMaps token page, as a stepper (owner rule): 01 what runs on this chain (GET
   /api/holders/deep coverage), 02 a quote (nothing charged), 03 confirm the price you saw (`expect`, so a changed
   price is never charged silently), 04 pay through the Gully Pay invoice on the report page and read the report.
   Same API and rules as the gullylabs.xyz card (src/components/holders/DeepCheck.tsx): free quota and credits first,
   a chain where no part can run is not sold, payment buys the work, never the result. A quote arriving is a real
   event, so it toasts. */
import { useState } from 'react'
import { useNavigate } from 'react-router'
import { ArrowRight, CircleCheck, CircleSlash, Gauge, Loader2, ShieldCheck } from 'lucide-react'
import { consoleToast } from '../console/toast'
import { deepConfirm, deepPagePath, deepQuote, PART_NAMES, PART_ORDER, rememberCheck, useDeepOffer, type DeepQuote, type PartKey } from '../lib/holdersDeep'
import { APP_URL, holderHref, isLocalHost } from '../site-host'
import { HmSteps, type HmStep } from './HmKit'

const WHAT: Record<PartKey, string> = {
  trading: 'Wallets that bought in the first blocks, and the ones that bought together in one block.',
  funding: 'Where the biggest wallets got their first funds, hop by hop, up to an exchange or a known source.',
  clusters: 'Wallets that share a funder, with their combined share of the supply.',
  deployer: 'The deployer’s other tokens and what happened to them.',
}
const STEPS: HmStep[] = [
  { t: 'Coverage', d: 'What runs on this chain' },
  { t: 'Quote', d: 'Nothing charged yet' },
  { t: 'Confirm', d: 'The price you saw' },
  { t: 'Pay · report', d: 'Gully Pay invoice' },
]
const SIGN_IN = `${isLocalHost() ? '/app' : APP_URL}/`

export function HmDeepCheck({ chain, token, symbol }: { chain: string; token: string; symbol?: string | null }) {
  const offer = useDeepOffer()
  const nav = useNavigate()
  const [scan, setScan] = useState('')
  const [quote, setQuote] = useState<DeepQuote | null>(null)
  const [busy, setBusy] = useState<'quote' | 'confirm' | null>(null)
  const [err, setErr] = useState<string | null>(null)

  if (offer.k === 'loading') return <div className="hmt-skel" style={{ height: 180 }} aria-busy="true" aria-label="Loading the Deep check" />
  if (offer.k === 'error') return <p className="hm-note">The Deep check offer could not be read just now; it retries on the next visit.</p>
  const { offer: o, coverage, quota, credits, checkout, signedIn } = offer.data
  const cov = coverage[chain]
  const parts = cov ? PART_ORDER.filter((k) => cov[k].state !== 'unavailable') : []
  const missing = cov ? PART_ORDER.filter((k) => cov[k].state === 'unavailable') : []
  const sellable = parts.length > 0
  const free = credits > 0 || (quota?.left ?? 0) > 0
  const canBundle = chain === 'base' || chain === 'bsc'
  const at = busy === 'confirm' ? 3 : quote ? 2 : busy === 'quote' ? 1 : 0

  const ask = async () => {
    setBusy('quote')
    setErr(null)
    const r = await deepQuote(chain, token, scan.trim() || undefined)
    setBusy(null)
    if (!r) return setErr('Could not reach the server. Try again.')
    if (r.status === 422) return setErr(r.data.error ?? 'A Deep check cannot run here yet. Nothing was charged.')
    if (!r.ok || !('quote' in r.data)) return setErr(r.data.error ?? 'Could not get a quote.')
    setQuote(r.data.quote)
    consoleToast({ title: 'Quote ready', text: `${r.data.quote.priceUsd === 0 ? 'Free' : `$${r.data.quote.priceUsd}`} for ${symbol ? `$${symbol}` : 'this token'}. Nothing is charged until you confirm.`, icon: 'check' })
  }
  const go = async () => {
    if (!quote) return
    setBusy('confirm')
    setErr(null)
    const r = await deepConfirm(chain, token, quote.priceUsd, quote.bundle.applied ? (quote.bundle.scanId ?? undefined) : undefined)
    if (!r) {
      setBusy(null)
      return setErr('Could not reach the server. Nothing was charged.')
    }
    if (r.status === 409 && r.data.quote) {
      setBusy(null)
      setQuote(r.data.quote)
      return setErr(r.data.error ?? 'The price changed. Check it and confirm again.')
    }
    if (!r.ok || !r.data.check) {
      setBusy(null)
      return setErr(r.data.error ?? 'Could not start the check. Nothing was charged.')
    }
    rememberCheck(r.data.check.id)
    const to = holderHref(deepPagePath(r.data.check.id))
    if (/^https?:/.test(to)) window.location.assign(to)
    else nav(to)
  }

  return (
    <section aria-labelledby="hm-deep" className="hmt-deep" data-deep-offer>
      <div className="hmt-deep-head">
        <div>
          <span className="hmt-lbl">
            <Gauge className="hm-ic sm" aria-hidden /> Deep check
          </span>
          <h2 id="hm-deep" style={{ fontSize: 22, fontWeight: 600, marginTop: 6 }}>
            Investigate {symbol ? `$${symbol}` : 'this token'} · ${o.priceUsd}
          </h2>
          <p>Who funded the big wallets, which wallets share a funder, the deployer’s record, and who sniped or bundled the launch. Every finding shows its source and how sure we are. Payment buys the work, never the result.</p>
        </div>
        <div className="hmt-price" aria-live="polite">
          <b data-deep-price>{sellable ? (free ? 'Free' : `$${o.priceUsd}`) : '—'}</b>
          {sellable && credits > 0 && <span className="hmt-pill ok">{credits} free re-run credit{credits === 1 ? '' : 's'}</span>}
          {sellable && credits === 0 && quota && quota.freePerMonth > 0 && (
            <span className={`hmt-pill ${quota.left > 0 ? 'ok' : ''}`}>
              {quota.left} of {quota.freePerMonth} free this month · {quota.plan.name}
            </span>
          )}
          {sellable && !free && <span>once, per token · billed by Gully Pay</span>}
        </div>
      </div>

      <div className="hmt-stepbody">
        <HmSteps steps={STEPS} at={sellable ? at : -1} label="Buying a Deep check" />
        {cov && sellable && (
          <ul className="hmt-parts" aria-label={`What a Deep check covers on ${chain}`}>
            {parts.map((k, i) => (
              <li key={k} style={{ ['--d' as string]: `${i * 70}ms` }} data-deep-part={k} data-state={cov[k].state}>
                <span>
                  <b>{PART_NAMES[k]}</b>
                  <span className={`hmt-pill ${cov[k].state === 'available' ? 'ok' : 'warn'}`}>{cov[k].state === 'available' ? 'Runs' : 'Limited'}</span>
                </span>
                <span>{WHAT[k]}</span>
                {cov[k].state === 'limited' && cov[k].reason && <span>Limited: {cov[k].reason}</span>}
              </li>
            ))}
          </ul>
        )}
        {sellable && missing.length > 0 && (
          <p className="hm-note" data-deep-missing style={{ display: 'flex', gap: 8 }}>
            <CircleSlash className="hm-ic sm" aria-hidden style={{ marginTop: 3 }} />
            <span>
              Not part of a check on this chain: {missing.map((k) => `${PART_NAMES[k].toLowerCase()} (${cov[k].reason ?? 'no data source here'})`).join('; ')}. You are not charged more or less for it.
            </span>
          </p>
        )}
        {!sellable && (
          <p className="hm-note" data-deep-unavailable>
            A Deep check is not offered on this chain yet: none of its parts has a data source here. Nothing is for sale until one does.
          </p>
        )}

        {sellable && canBundle && !free && !quote && (
          <label className="hm-note" style={{ display: 'flex', flexDirection: 'column', gap: 6, maxWidth: 520 }} data-deep-bundle>
            <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <ShieldCheck className="hm-ic sm" aria-hidden style={{ color: 'var(--hm-yellow)' }} /> {o.bundleScanDiscountPct}% off with a paid Gully Security scan of this contract: paste its id
            </span>
            {signedIn ? (
              <input className="hmt-input" value={scan} onChange={(e) => setScan(e.target.value)} placeholder="sec_…" spellCheck={false} />
            ) : (
              <a className="hmt-link" href={SIGN_IN} target="_blank" rel="noopener noreferrer">
                Sign in to the app to use a scan discount ↗
              </a>
            )}
          </label>
        )}

        {err && (
          <p role="alert" className="hmt-err" data-deep-error>
            {err}
          </p>
        )}

        {sellable && quote && (
          <div className="hmt-quote" data-deep-quote aria-live="polite">
            <span className="gt-k">Your quote · nothing charged yet</span>
            <span className="q">
              <b>{quote.priceUsd === 0 ? 'Free' : `$${quote.priceUsd}`}</b>
              {quote.bundle.applied && quote.priceUsd > 0 && (
                <span>
                  <s>${quote.listPriceUsd}</s> · {quote.bundle.discountPct}% off with your Security scan
                </span>
              )}
              {quote.credit.used && <span>a credit from an earlier failed check, used before any price</span>}
              {!quote.credit.used && quote.free && <span>from your plan’s free checks ({quote.quota?.left} left)</span>}
            </span>
            {quote.bundleNote && <span className="hm-note">{quote.bundleNote}</span>}
            {!quote.free && !quote.checkout.enabled && <span className="hm-note err">Checks cannot be bought yet: checkout is not switched on. Nothing was charged.</span>}
            <span className="hmt-acts">
              <button type="button" onClick={go} disabled={!!busy || (!quote.free && !quote.checkout.enabled)} className="hm-btn" data-deep-confirm>
                {busy === 'confirm' ? <Loader2 className="hm-ic hm-spin" aria-hidden /> : <CircleCheck className="hm-ic" aria-hidden />}
                {quote.priceUsd === 0 ? 'Start the free check' : `Confirm and pay $${quote.priceUsd}`}
              </button>
              <button type="button" onClick={() => setQuote(null)} className="hm-btn ghost">
                Change
              </button>
              {quote.priceUsd > 0 && <span className="hmt-fine">You pay on the next page, through a Gully Pay invoice.</span>}
            </span>
          </div>
        )}

        {sellable && !quote && (
          <div className="hmt-acts">
            <button type="button" onClick={ask} disabled={!!busy} className="hm-btn" data-deep-start>
              {busy === 'quote' ? <Loader2 className="hm-ic hm-spin" aria-hidden /> : <ArrowRight className="hm-ic" aria-hidden />}
              Get a quote
            </button>
            {!signedIn && (
              <a className="hmt-link" href={SIGN_IN} target="_blank" rel="noopener noreferrer" style={{ fontSize: 13 }}>
                Pro and Business members get {o.freePerMonth.pro} free checks a month: sign in ↗
              </a>
            )}
            {!checkout.enabled && <span className="hmt-fine">Paid checks open soon.</span>}
          </div>
        )}
        <p className="hmt-fine">If a paid check fails you get a credit for a free re-run (not an on-chain refund); write to team@gullylabs.xyz for a refund. Information only, not advice.</p>
      </div>
    </section>
  )
}
