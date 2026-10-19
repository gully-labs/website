/* Fee proxy balances (server/fee-proxy-monitor.mjs, in /api/admin/overview as `feeProxy`). Request Network's fee
   proxies never hold funds, so any balance is a third-party mis-send we cannot recover: shown as a banner at the
   top of the admin panel, plus this small card with the last hourly read of every proxy on every chain. Recent
   pay-guard refusals (a payment instruction the server refused to emit) are raised in the banner too. */

import { useState } from 'react'
import { ChainLogo } from '../../components/logos/ChainLogo'
import { flash } from '../../components/ui/toast'

export interface FeeProxyStatus {
  running: boolean
  intervalMs: number
  checkedAt: string | null
  nextCheckAt: string | null
  chains: { chainId: number; chain: string; checkedAt: string | null; error: string | null; proxies: { address: string; kind: string; balances: { assetId: string; symbol: string; raw: string | null; amount: string | null; error: string | null }[] }[] }[]
  alerts: { key: string; chain: string; proxy: string; short: string; kind: string; symbol: string; amount: string; firstSeenAt: string; lastSeenAt: string; message: string; telegram: boolean }[]
  config: string[]
  refusals: { at: string; where: string; violations: string[] }[]
  misSend: string
}

const card = 'flex min-w-0 flex-col gap-3 rounded-card border border-line bg-surface p-6'
const small = 'font-mono text-[12px] text-faint'
const at = (iso: string | null) => (iso ? new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }) : 'not yet')
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`

export function FeeProxyBanner({ s }: { s: FeeProxyStatus | undefined }) {
  if (!s) return null
  const recent = s.refusals // the server sends the last 24 h only (pay-guard.mjs recentRefusals)
  if (!s.alerts.length && !s.config.length && !recent.length) return null
  return (
    <div role="alert" className="flex flex-col gap-2 rounded-card border border-error/50 bg-error/10 px-5 py-4 text-[14px] text-ink">
      {s.alerts.map((a) => (
        <p key={a.key} className="m-0">
          <b className="text-error">Fee proxy holds {a.amount} {a.symbol}</b> on {a.chain} ({a.kind} {a.short}), first seen {at(a.firstSeenAt)}. Third-party mis-send: Gully never sends there, and the contract has no owner, so it cannot be recovered.
          {a.telegram ? ' Sent to the admin Telegram chat.' : ''}
        </p>
      ))}
      {s.config.map((c) => (
        <p key={c} className="m-0">
          <b className="text-error">Configuration:</b> {c}
        </p>
      ))}
      {recent.length > 0 && (
        <p className="m-0">
          <b className="text-error">Payment guard refused {recent.length} instruction{recent.length === 1 ? '' : 's'} in the last 24 h.</b> Latest ({at(recent[0].at)}, {recent[0].where}): {recent[0].violations.join('; ')}
        </p>
      )}
    </div>
  )
}

export function FeeProxyCard({ s, act }: { s: FeeProxyStatus | undefined; act?: (path: string) => Promise<string | null> }) {
  const [busy, setBusy] = useState(false)
  if (!s) return null
  const checkNow = async () => {
    if (!act) return
    setBusy(true)
    const err = await act('/api/admin/fee-proxy/check')
    setBusy(false)
    flash(err ? { ok: false, text: err } : { ok: true, text: 'Fee proxy balances read.' })
  }
  return (
    <section className={card} aria-labelledby="fee-proxy-h">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="fee-proxy-h" className="m-0 font-display text-[22px] font-bold uppercase">
          Fee proxy balances
        </h2>
        <span className="flex items-center gap-3">
          <span className={small}>{s.running ? `hourly · last read ${at(s.checkedAt)}` : `monitor off · last read ${at(s.checkedAt)}`}</span>
          {act && (
            <button type="button" onClick={checkNow} disabled={busy} className="rounded-input border border-line inline-flex min-h-11 items-center px-3 font-mono text-[12px] text-ink hover:border-gold disabled:opacity-60" aria-label="Read the fee proxy balances now">
              {busy ? 'Reading…' : 'Check now'}
            </button>
          )}
        </span>
      </div>
      <p className="m-0 text-[13px] text-muted">Should always be zero: payments only pass through the proxy in one call. A balance is a third-party mis-send, unrecoverable (no owner).</p>
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {s.chains.map((c) => {
          const nonZero = c.proxies.flatMap((p) => p.balances.filter((b) => b.raw && b.raw !== '0').map((b) => `${b.amount} ${b.symbol} in ${short(p.address)}`))
          const failed = c.proxies.some((p) => p.balances.some((b) => b.error))
          return (
            <li key={c.chainId} className="flex flex-wrap items-center justify-between gap-2 rounded-input border border-line px-3 py-2 text-[14px]">
              <span className="flex items-center gap-2">
                <i className={`size-2 rounded-full ${nonZero.length ? 'bg-error' : !c.checkedAt || failed ? 'bg-gold' : 'bg-green'}`} />
                <ChainLogo chain={c.chain} size={20} decorative />
                {c.chain} <span className={small}>{c.proxies.length} contracts</span>
              </span>
              <span className={small}>{nonZero.length ? nonZero.join(' · ') : !c.checkedAt ? 'not read yet' : failed ? (c.error ?? 'some reads failed') : 'all zero'}</span>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
