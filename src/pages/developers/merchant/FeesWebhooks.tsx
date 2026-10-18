import { ArrowUpRight, KeyRound, Loader2, RotateCcw, Send } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { AnimatedNumber } from '../../../components/charts/AnimatedNumber'
import { NF } from '../../../components/charts/number-formats'
import { copyWithToast, toastError, toastSuccess } from '../../../components/ui/toast'
import { api } from '../api'
import { input, label, mono, pillGold, pillLine, pillSm } from '../styles'
import { fmtDay, fmtWhen, payOrigin, usd, type MerchantView } from './api'
import { Field, Section, StatusPill } from './parts'

/* Fees (balance, free allowance, weekly statements with Pay now) and the store's webhook. */

export function FeesSection({ view }: { view: MerchantView }) {
  const f = view.fees
  const used = f.freeUsd ? Math.min(1, (f.freeUsd - f.freeLeftUsd) / f.freeUsd) : 1
  const due = f.statements.filter((s) => s.state === 'open' || s.state === 'overdue')
  return (
    <Section
      id="m-fees"
      title="Fees and statements"
      sub={
        <>
          A {f.ratePct}% transaction fee, nothing monthly. Your first {usd(f.freeUsd)} of lifetime volume is free. When a customer pays a stablecoin from a connected wallet, the fee is taken in the same transaction through Request Network’s open-source fee contract; everything else goes on a statement every Monday (00:00 UTC) once you owe {usd(f.minStatementUsd)} or more; unpaid {f.pauseAfterDays} days after issue, checkout pauses until paid.{' '}
          <a href={`${payOrigin()}${view.terms.path}#s5`} target="_blank" rel="noopener" className="text-gold underline underline-offset-4 hover:text-gold-hover">
            Fee terms
          </a>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className="flex flex-col gap-1 rounded-[12px] border border-line bg-bg px-4 py-3">
          <span className={label}>Fee balance due</span>
          <span className={`font-display text-[28px] leading-none font-extrabold ${f.paused ? 'text-error' : 'text-ink'}`}>
            <AnimatedNumber value={f.outstandingUsd} format={NF.usd} />
          </span>
          <span className={mono}>on {due.length} statement{due.length === 1 ? '' : 's'}</span>
        </div>
        <div className="flex flex-col gap-1 rounded-[12px] border border-line bg-bg px-4 py-3">
          <span className={label}>Accrued, not billed yet</span>
          <span className="font-display text-[28px] leading-none font-extrabold text-ink">
            <AnimatedNumber value={f.unbilledUsd} format={NF.usd} />
          </span>
          <span className={mono}>next statement {fmtDay(f.nextStatementAt)}</span>
        </div>
        <div className="flex flex-col gap-1 rounded-[12px] border border-line bg-bg px-4 py-3">
          <span className={label}>Fees paid</span>
          <span className="font-display text-[28px] leading-none font-extrabold text-ink">
            <AnimatedNumber value={f.paidUsd} format={NF.usd} />
          </span>
          <span className={mono}>{usd(f.accruedUsd)} accrued in all</span>
        </div>
        <div className="col-span-2 flex flex-col gap-2 rounded-[12px] border border-line bg-bg px-4 py-3 lg:col-span-4">
          <span className={label}>How your fees were taken</span>
          <div className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-3">
            <div className="flex min-w-0 flex-col gap-[2px]">
              <span className="font-display text-[20px] leading-none font-extrabold text-ink">
                <AnimatedNumber value={f.collectedUsd} format={NF.usd} />
              </span>
              <span className={mono}>
                collected on chain at payment time · {f.collectedPayments} payment{f.collectedPayments === 1 ? '' : 's'}
              </span>
            </div>
            <div className="flex min-w-0 flex-col gap-[2px]">
              <span className="font-display text-[20px] leading-none font-extrabold text-ink">
                <AnimatedNumber value={f.billedUsd} format={NF.usd} />
              </span>
              <span className={mono}>billed on statements</span>
            </div>
            <div className="flex min-w-0 flex-col gap-[2px]">
              <span className="font-display text-[20px] leading-none font-extrabold text-ink">
                <AnimatedNumber value={f.unbilledUsd} format={NF.usd} />
              </span>
              <span className={mono}>not billed yet</span>
            </div>
          </div>
        </div>
        <div className="flex flex-col gap-2 rounded-[12px] border border-line bg-bg px-4 py-3">
          <span className={label}>Free allowance left</span>
          <span className="font-display text-[28px] leading-none font-extrabold text-ink">
            <AnimatedNumber value={f.freeLeftUsd} format={NF.usd} />
          </span>
          <span className="h-[6px] overflow-hidden rounded-full bg-grid" role="meter" aria-valuemin={0} aria-valuemax={f.freeUsd} aria-valuenow={f.freeUsd - f.freeLeftUsd} aria-label="Free allowance used">
            <span className="block h-full rounded-full bg-gold transition-[width] duration-700" style={{ width: `${Math.round(used * 100)}%` }} />
          </span>
        </div>
      </div>
      {f.statements.length === 0 ? (
        <p className="m-0 text-[14px] text-muted">No statement yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[620px] border-collapse text-[13px]">
            <thead>
              <tr className="border-b border-line text-left font-mono text-[11px] tracking-[1px] text-faint">
                <th className="py-2 pr-3 font-medium">STATEMENT</th>
                <th className="py-2 pr-3 font-medium">ISSUED</th>
                <th className="py-2 pr-3 font-medium">DUE</th>
                <th className="py-2 pr-3 font-medium">VOLUME</th>
                <th className="py-2 pr-3 font-medium">FEE</th>
                <th className="py-2 pr-3 font-medium">STATE</th>
                <th className="py-2 font-medium" />
              </tr>
            </thead>
            <tbody>
              {f.statements.map((s) => (
                <tr key={s.id} className="border-b border-line last:border-0">
                  <td className="py-2 pr-3 font-mono text-[12px] text-ink-2">{s.number}</td>
                  <td className="py-2 pr-3 text-muted">{fmtDay(s.issuedAt)}</td>
                  <td className="py-2 pr-3 text-muted">{fmtDay(s.dueAt)}</td>
                  <td className="py-2 pr-3 font-mono text-ink-2">
                    {usd(s.volumeUsd)} · {s.payments}
                  </td>
                  <td className="py-2 pr-3 font-mono text-ink">${s.usd}</td>
                  <td className="py-2 pr-3">
                    <StatusPill state={s.state} />
                  </td>
                  <td className="py-2 text-right">
                    {(s.state === 'open' || s.state === 'overdue') && (
                      <a href={`${payOrigin()}${s.payPath}`} target="_blank" rel="noopener" className={`${s.state === 'overdue' ? pillGold : pillLine} !min-h-10 !px-3 !text-[13px]`}>
                        Pay now <ArrowUpRight size={13} aria-hidden />
                      </a>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  )
}

export function WebhooksSection({ view, reload }: { view: MerchantView; reload: () => void }) {
  const [url, setUrl] = useState(view.webhook?.url ?? '')
  const [secret, setSecret] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const can = view.can.webhooks

  const call = async (what: string, path: string, body?: unknown) => {
    setBusy(what)
    setErr(null)
    const r = await api<{ secret?: string | null; delivery?: { state: string } }>(path, { method: 'POST', body })
    setBusy(null)
    if (!r.ok) {
      setErr(r.error)
      return toastError('Webhook', { detail: r.error })
    }
    if (r.data.secret) setSecret(r.data.secret)
    if (what === 'test') toastSuccess('Test event sent', { detail: `Delivery ${r.data.delivery?.state ?? ''}.` })
    reload()
  }
  const save = (e: FormEvent) => {
    e.preventDefault()
    call('save', '/api/developer/merchant/webhook', { url: url.trim() || null })
  }

  return (
    <Section id="m-webhooks" title="Webhooks" sub="invoice.paid, invoice.expired and invoice.cancelled for this store, signed with your own secret (X-Gully-Signature: sha256 HMAC of “timestamp.body”). Retried for about an hour.">
      <form onSubmit={save} className="flex flex-wrap items-end gap-3">
        <div className="min-w-[240px] flex-1">
          <Field label="Endpoint (https)">
            <input className={input} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://yourstore.com/hooks/gully" disabled={!can} inputMode="url" />
          </Field>
        </div>
        {can && (
          <>
            <button type="submit" className={pillGold} disabled={!!busy}>
              {busy === 'save' && <Loader2 size={15} className="animate-spin" aria-hidden />} {view.webhook ? 'Update' : 'Set endpoint'}
            </button>
            {view.webhook && (
              <>
                <button type="button" className={pillLine} disabled={!!busy} onClick={() => call('test', '/api/developer/merchant/webhook/test', {})}>
                  <Send size={14} aria-hidden /> Send test
                </button>
                <button type="button" className={pillLine} disabled={!!busy} onClick={() => call('rotate', '/api/developer/merchant/webhook/rotate', {})}>
                  <KeyRound size={14} aria-hidden /> Rotate secret
                </button>
              </>
            )}
          </>
        )}
      </form>
      {secret && (
        <div className="flex flex-wrap items-center gap-3 rounded-input border border-gold-line bg-[rgba(232,192,96,.06)] px-4 py-3" role="status">
          <span className="text-[13px] text-ink-2">Signing secret, shown once:</span>
          <code className="min-w-0 flex-1 font-mono text-[12px] break-all text-ink">{secret}</code>
          <button type="button" className={pillSm} onClick={() => copyWithToast(secret, 'Secret')}>
            Copy
          </button>
        </div>
      )}
      {err && (
        <p className="m-0 text-[13px] text-error" role="alert">
          {err}
        </p>
      )}
      {view.deliveries.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[620px] border-collapse text-[13px]">
            <thead>
              <tr className="border-b border-line text-left font-mono text-[11px] tracking-[1px] text-faint">
                <th className="py-2 pr-3 font-medium">EVENT</th>
                <th className="py-2 pr-3 font-medium">STATE</th>
                <th className="py-2 pr-3 font-medium">ATTEMPTS</th>
                <th className="py-2 pr-3 font-medium">LAST ANSWER</th>
                <th className="py-2 pr-3 font-medium">WHEN</th>
                <th className="py-2 font-medium" />
              </tr>
            </thead>
            <tbody>
              {view.deliveries.map((d) => (
                <tr key={d.id} className="border-b border-line last:border-0">
                  <td className="py-2 pr-3 font-mono text-[12px] text-ink-2">
                    {d.type}
                    {d.redeliveryOf ? ' (redelivery)' : ''}
                  </td>
                  <td className="py-2 pr-3">
                    <span className={d.state === 'delivered' ? 'text-green' : d.state === 'failed' ? 'text-error' : 'text-gold'}>{d.state}</span>
                  </td>
                  <td className="py-2 pr-3 font-mono text-muted">
                    {d.attempts}/{d.maxAttempts}
                  </td>
                  <td className="py-2 pr-3 font-mono text-[12px] text-muted">{d.last ? (d.last.status ?? d.last.error ?? '—') : '—'}</td>
                  <td className="py-2 pr-3 text-muted">{fmtWhen(d.createdAt)}</td>
                  <td className="py-2 text-right">
                    {can && !d.test && d.state !== 'pending' && (
                      <button type="button" className={pillSm} disabled={!!busy} onClick={() => call(`r-${d.id}`, `/api/developer/merchant/webhook/deliveries/${d.id}/redeliver`, {})}>
                        <RotateCcw size={13} aria-hidden /> Redeliver
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="m-0 text-[13px] text-faint">No delivery yet.</p>
      )}
    </Section>
  )
}
