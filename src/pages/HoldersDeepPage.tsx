import { Link, useParams } from 'react-router'
import { Seo } from '../components/Seo'
import { DeepEnded, DeepReportView, DeepStatusPanel } from '../components/holders/DeepReport'
import { BadgeBlock } from '../components/holders/BadgeBlock'
import { holdersPagePath } from '../lib/holders'
import { isActive, useDeepCheck } from '../lib/holdersDeep'
import { useEffect } from 'react'
import { rememberCheck } from '../lib/holdersDeep'
import { StatusPill } from '../components/ui/StatusPill'
import { holderHref } from '../site-host'

/* /holders/deep/:id: one Deep check. While it waits for payment, is queued or runs it shows the live status (and
   links to its Gully Pay invoice); when it ends, the report. The id is unguessable and is the shareable link, so
   the page is never indexed. Everything on it is from GET /api/holders/deep/:id (server/holders-deep-routes.mjs). */

export function HoldersDeepPage() {
  const { id = '' } = useParams()
  const load = useDeepCheck(id)
  const check = load.k === 'ok' ? load.data : null
  useEffect(() => {
    if (check) rememberCheck(check.id)
  }, [check])
  const report = check?.report ?? null
  const symbol = report?.token.symbol ?? null
  const chainName = check?.chain.name ?? ''
  const mapHref = holderHref(check ? holdersPagePath(check.chain.key, check.token) : '/holders')
  return (
    <div className="flex flex-col gap-3 px-[clamp(8px,2cqw,32px)] pt-3 pb-24">
      <Seo title={`Deep check${symbol ? `: ${symbol}` : ''} · Holder Map`} description="A Holder Map Deep check report: funding trace, shared-funder clusters, deployer record, snipers and bundles." noindex />
      <nav aria-label="Breadcrumb" className="flex flex-wrap gap-x-4 font-mono text-[12px]">
        <Link to={mapHref} className="inline-flex min-h-11 items-center text-muted transition-colors hover:text-ink">
          ← {check ? 'HOLDER MAP' : 'HOLDER MAP'}
        </Link>
      </nav>
      {load.k === 'loading' && <div className="card card-pad gl-skeleton h-[220px]" aria-busy="true" aria-label="Loading the check" />}
      {load.k === 'error' && (
        <section className="card card-pad flex flex-col gap-2" role="alert" data-deep-notfound={load.notFound}>
          <h1 className="heading-3">{load.notFound ? 'No Deep check has that link' : 'Could not load this check'}</h1>
          <p className="m-0 text-[14px] leading-[1.55] text-muted">{load.notFound ? 'The link may be mistyped. A Deep check can be started from any token’s Holder Map.' : 'The server did not answer. Trying again shortly.'}</p>
          {!load.notFound && (
            <button type="button" onClick={load.reload} className="min-h-11 w-fit rounded-btn border border-line-strong px-4 text-[13px] text-ink hover:border-gold">
              Try again
            </button>
          )}
        </section>
      )}
      {check && (
        <>
          <header className="flex flex-wrap items-end justify-between gap-2">
            <div className="flex min-w-0 flex-col gap-1">
              <span className="eyebrow">Deep check</span>
              <h1 className="heading-2 break-words">{symbol ? `$${symbol}` : `${check.token.slice(0, 8)}…${check.token.slice(-4)}`} on {chainName}</h1>
            </div>
            <StatusPill tone={check.status === 'done' ? 'ok' : check.status === 'partial' ? 'warn' : check.status === 'failed' ? 'error' : check.status === 'cancelled' ? 'off' : 'live'}>
              {{ awaiting_payment: 'Awaiting payment', queued: 'Queued', running: 'Running', done: 'Done', partial: 'Partial', failed: 'Failed', cancelled: 'Cancelled' }[check.status]}
            </StatusPill>
          </header>
          {isActive(check.status) && <DeepStatusPanel check={check} onChange={load.reload} />}
          {(check.status === 'failed' || check.status === 'cancelled') && <DeepEnded check={check} mapHref={mapHref} />}
          {report && check.status !== 'cancelled' && (check.status !== 'failed' || report.findings.length > 0 || report.unavailable.length > 0) && <DeepReportView check={check} report={report} />}
          {report && <BadgeBlock chain={check.chain.key} token={check.token} />}
        </>
      )}
    </div>
  )
}
