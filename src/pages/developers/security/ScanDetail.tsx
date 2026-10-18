import { ArrowLeft, Ban, Copy, Globe, Lock, Printer, RefreshCw } from 'lucide-react'
import { useState } from 'react'
import { ChainLogo } from '../../../components/logos/ChainLogo'
import { QuotePay } from '../../../components/pay/QuotePay'
import { ReportBody } from '../../../components/security/ReportBody'
import { ScanProgress } from '../../../components/security/ScanProgress'
import { chainLogoKey, fmtWhen, isActive, KIND_LABEL, STATUS_LABEL, type ScanView } from '../../../components/security/types'
import { copyWithToast, toastError, toastSuccess } from '../../../components/ui/toast'
import { usePlans } from '../../../lib/plans'
import { SITE_URL, isLocalHost } from '../../../site-host'
import { api, type Quote } from '../api'
import { ErrorLine, Skeleton } from '../parts'
import { Can } from '../RoleGate'
import { mono, panel, pillLine, pillSm } from '../styles'
import { useScan } from './useSecurity'
import { ExtLink } from '../ExtLink'

/* One scan in the app: its live progress while it runs (Server-Sent Events), the Gully Pay step while it
   waits for payment, and the report once done (ReportBody: charts, tools, findings with the draft PoC).
   The header carries Export PDF (the browser's print dialog on a print-styled page), Cancel, and for owners
   and admins the Publish switch (a public, stable URL; indexing is a separate opt-in). */

const site = (path: string) => (isLocalHost() ? path : `${SITE_URL}${path}`)

export function StatusChip({ s }: { s: ScanView['status'] }) {
  const tone = s === 'done' ? 'border-success-line text-green' : s === 'failed' || s === 'unknown' ? 'border-error-line text-error' : s === 'cancelled' ? 'border-line-strong text-faint' : 'border-gold-line text-gold'
  return (
    <span className={`inline-flex min-h-[26px] items-center gap-[6px] rounded-full border px-[10px] font-mono text-[11px] whitespace-nowrap ${tone}`} data-status={s}>
      {isActive(s) && <span aria-hidden className="size-[6px] animate-[gl-blink_1.4s_ease-in-out_infinite] rounded-full bg-gold motion-reduce:animate-none" />}
      {STATUS_LABEL[s]}
    </span>
  )
}

export function TargetMark({ scan, size = 20 }: { scan: Pick<ScanView, 'input'>; size?: 16 | 20 | 24 }) {
  if (scan.input.kind === 'address' && scan.input.chain) return <ChainLogo chain={chainLogoKey(scan.input.chain)} size={size} />
  return null
}

/** Pays a scan's invoice inside the app (the same quotes and checks as /pay/<id>). */
export function PayStep({ scan, onPaid }: { scan: ScanView; onPaid: () => void }) {
  const [plans, retry] = usePlans()
  const p = scan.payment
  if (!p) return null
  if (p.status === 'expired' || p.status === 'cancelled')
    return <ErrorLine>This scan's invoice is {p.status}. Cancel the scan and start a new one to get a fresh invoice.</ErrorLine>
  if (plans.k === 'loading') return <Skeleton h={160} />
  if (plans.k === 'error') return <ErrorLine onRetry={retry}>The payment options could not be read: {plans.message}</ErrorLine>
  const quote = (asset: string) => api<{ quote: Quote }>(`/api/pay/${p.invoiceId}/quote`, { method: 'POST', body: { asset } })
  const verify = (q: Quote, txHash: string) => api(`/api/pay/${p.invoiceId}/verify`, { method: 'POST', body: { quoteId: q.id, txHash } })
  return (
    <div className="flex flex-col gap-3" data-testid="pay-step">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-[14px] text-ink-2">
          {scan.title}: <b className="text-ink">${p.usd}</b> by Gully Pay. The scan starts by itself once the payment is confirmed on chain.
        </span>
        <ExtLink href={site(p.payUrl)} className="inline-flex min-h-11 items-center gap-1 font-mono text-[12px] text-gold underline-offset-4 hover:underline">
          Open the invoice page
        </ExtLink>
      </div>
      <QuotePay assets={plans.offer.assets} label={`AI Security Scan: ${scan.title}`} match="exact" getQuote={quote} verify={verify} onPaid={() => onPaid()} />
    </div>
  )
}

export function ScanDetail({ id, canPublish, onBack, backLabel = 'All scans' }: { id: string; canPublish: boolean; onBack?: () => void; backLabel?: string }) {
  const [s, replace, reload] = useScan(id)
  const [busy, setBusy] = useState<string | null>(null)
  if (s.k === 'loading')
    return (
      <div className="flex flex-col gap-3" aria-busy>
        <Skeleton h={64} />
        <Skeleton h={260} />
      </div>
    )
  if (s.k === 'error') return <ErrorLine onRetry={reload}>The scan could not be read: {s.message}</ErrorLine>
  const scan = s.data
  const act = async (what: string, path: string, body: unknown, ok: string) => {
    setBusy(what)
    const r = await api<{ scan: ScanView }>(path, { method: 'POST', body })
    setBusy(null)
    if (r.ok) {
      replace(r.data.scan)
      toastSuccess(ok)
    } else toastError(r.error)
  }
  const publicUrl = scan.publicUrl ? site(scan.publicUrl) : null
  const running = isActive(scan.status) || scan.status === 'awaiting_payment'
  const duplicateNote = scan.duplicate ? (
    <p className="m-0 rounded-input border border-gold-line px-3 py-2 text-[13px] text-ink-2" role="status" data-testid="duplicate">
      You are already scanning this; here it is. Nothing new was started or charged.
    </p>
  ) : null

  return (
    <div className="flex flex-col gap-4" data-testid="scan-detail" data-scan={scan.id}>
      <header className={`${panel} print:border-0 print:bg-[#fff] print:p-0`}>
        <div className="flex flex-wrap items-center gap-3">
          {onBack && (
            <button type="button" onClick={onBack} className={`${pillSm} print:hidden`}>
              <ArrowLeft size={14} aria-hidden /> {backLabel}
            </button>
          )}
          <TargetMark scan={scan} size={24} />
          <div className="flex min-w-0 flex-[1_1_240px] flex-col">
            <span className={mono}>
              {KIND_LABEL[scan.input.kind]} · {scan.id} · started {fmtWhen(scan.startedAt ?? scan.createdAt)}
            </span>
            <h2 className="m-0 truncate font-mono text-[18px] font-medium text-ink print:text-[#000]" title={scan.title}>
              {scan.title}
            </h2>
          </div>
          <StatusChip s={scan.status} />
          <div className="flex flex-wrap items-center gap-2 print:hidden">
            {scan.status === 'done' && (
              <ExtLink href={`/api/developer/security/scans/${scan.id}/report.html`} className={pillSm} data-testid="export-pdf" title="The print-ready report: print it or save it as PDF">
                <Printer size={14} aria-hidden /> Export PDF
              </ExtLink>
            )}
            {running && (
              <Can cat="security" what="cancel scans">
                <button type="button" disabled={busy === 'cancel'} onClick={() => window.confirm('Cancel this scan?') && act('cancel', `/api/developer/security/scans/${scan.id}/cancel`, {}, 'Scan cancelled')} className={pillSm}>
                  <Ban size={14} aria-hidden /> Cancel
                </button>
              </Can>
            )}
            {scan.status === 'unknown' && (
              <button type="button" onClick={reload} className={pillSm}>
                <RefreshCw size={14} aria-hidden /> Retry
              </button>
            )}
          </div>
        </div>
        {scan.status === 'done' && (
          <div className="flex flex-wrap items-center gap-3 border-t border-line pt-3 print:hidden" data-testid="publish">
            <span className="flex items-center gap-2 text-[13px] text-ink-2">
              {scan.published ? <Globe size={15} className="text-gold" aria-hidden /> : <Lock size={15} className="text-faint" aria-hidden />}
              {scan.published ? 'Published: anyone with the link can read it (draft PoCs stay private).' : 'Private to this workspace.'}
            </span>
            {canPublish ? (
              <>
                <label className="ml-auto inline-flex min-h-11 cursor-pointer items-center gap-2 text-[13px] text-ink">
                  <input type="checkbox" role="switch" checked={scan.published} disabled={busy === 'publish'} onChange={(e) => act('publish', `/api/developer/security/scans/${scan.id}/publish`, { published: e.target.checked, indexable: e.target.checked ? scan.indexable : false }, e.target.checked ? 'Report published' : 'Report unpublished')} className="size-4 accent-gold" />
                  Publish report
                </label>
                {scan.published && (
                  <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 text-[13px] text-ink-2" title="Off: the page asks search engines not to index it">
                    <input type="checkbox" checked={scan.indexable} disabled={busy === 'publish'} onChange={(e) => act('publish', `/api/developer/security/scans/${scan.id}/publish`, { published: true, indexable: e.target.checked }, e.target.checked ? 'Search engines may index it' : 'Hidden from search engines')} className="size-4 accent-gold" />
                    Let search engines index it
                  </label>
                )}
              </>
            ) : (
              <span className="ml-auto font-mono text-[11px] text-faint">Only the owner or an admin can publish.</span>
            )}
            {publicUrl && (
              <span className="flex w-full flex-wrap items-center gap-2">
                <ExtLink href={publicUrl} className="inline-flex min-h-11 items-center gap-1 font-mono text-[12px] break-all text-gold underline-offset-4 hover:underline" data-testid="public-link">
                  {publicUrl}
                </ExtLink>
                <button type="button" onClick={() => void copyWithToast(publicUrl, 'Link')} className={pillSm}>
                  <Copy size={13} aria-hidden /> Copy link
                </button>
              </span>
            )}
          </div>
        )}
      </header>

      {duplicateNote}
      {scan.status === 'awaiting_payment' && (
        <section className={panel} aria-label="Pay for this scan">
          {scan.startError && <ErrorLine>Paid, but the scan could not start yet: {scan.startError}. It is retried automatically.</ErrorLine>}
          <PayStep scan={scan} onPaid={reload} />
        </section>
      )}
      {scan.status !== 'awaiting_payment' && scan.status !== 'done' && (
        <section className={panel} aria-label="Progress">
          <ScanProgress status={scan.status} pct={scan.progress?.pct ?? null} message={scan.progress?.message} startedAt={scan.startedAt} failure={scan.failure} />
        </section>
      )}
      {scan.status === 'done' && (scan.report ? <ReportBody report={scan.report} /> : <ErrorLine onRetry={reload}>The scan is done but its report could not be read from the engine.</ErrorLine>)}
      {!running && scan.status !== 'done' && onBack && (
        <button type="button" onClick={onBack} className={`${pillLine} self-start`}>
          <ArrowLeft size={14} aria-hidden /> {backLabel}
        </button>
      )}
    </div>
  )
}
