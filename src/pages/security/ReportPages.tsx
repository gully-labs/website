import { ArrowLeft, ArrowUpRight, FileSearch, FileText, Info, Printer, ScanSearch } from 'lucide-react'
import { Link, useParams } from 'react-router'
import { ChainLogo } from '../../components/logos/ChainLogo'
import { ScansChart } from './ScansChart'
import { ModeBadge, ReportBody } from '../../components/security/ReportBody'
import { SeverityCharts } from '../../components/security/SeverityCharts'
import { chainLogoKey, fmtWhen, KIND_LABEL, SEV_COLOR, SEV_LABEL, SEVERITIES, type PublicReport, type PublicReportListItem, type SampleReport } from '../../components/security/types'
import { Seo } from '../../components/Seo'
import { btnGold, eyebrow } from '../../components/ui'
import { SCAN_APP_URL, usePublic } from './shared'
import { securityHref } from '../../site-host'

/* The public report pages:
   /security/reports       every report its owner published, newest first (GET /api/security/reports)
   /security/reports/:id   one published report (GET /api/security/reports/:id), kit-branded and printable.
   A report is published by the workspace's owner or an admin from the app; it is noindex unless they opt
   in (the server sends the head tags; <Seo noindex> keeps the browser in step). Draft PoCs are never part
   of a public report. Every page says what a scan is: automated, and not an audit. */

const NOT_AUDIT = 'This is an automated AI Security Scan report, published by the owner of the code. It is not an audit and not an endorsement: no person at Gully Labs has reviewed this code, its findings are not verified by a human, and an automated scan can miss issues. Draft proofs of concept stay private.'

function Subject({ r }: { r: Pick<PublicReport, 'input' | 'title'> }) {
  return (
    <span className="flex min-w-0 items-center gap-2">
      {r.input.kind === 'address' && r.input.chain && <ChainLogo chain={chainLogoKey(r.input.chain)} size={20} />}
      <span className="truncate font-mono">{r.title}</span>
    </span>
  )
}

export function ReportsIndex() {
  const [s, retry] = usePublic<{ reports: PublicReportListItem[] }>('/api/security/reports', 60_000)
  return (
    <>
      <Seo title="Published security scan reports" description="AI Security Scan reports their owners chose to publish: the findings, the tools that ran and the limits of an automated scan." />
      <section className="px-page pt-[56px] pb-16 max-[600px]:pt-10">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div className="flex flex-col gap-3">
            <Link to={securityHref('/security')} className="inline-flex min-h-11 w-fit items-center gap-2 font-mono text-[12px] text-muted hover:text-ink">
              <ArrowLeft size={14} aria-hidden /> Gully Security
            </Link>
            <span className={eyebrow}>PUBLISHED REPORTS</span>
            <h1 className="m-0 font-display text-h2 font-extrabold uppercase">
              Scan reports, <span className="text-gold">in the open</span>
            </h1>
            <p className="m-0 max-w-[680px] text-[15px] leading-[1.6] text-muted">Reports listed here were published by the owners of the code. Each is an automated scan, not an audit; for now scans are an AI review only, and each report’s label says so.</p>
          </div>
          <a href={SCAN_APP_URL} target="_blank" rel="noopener noreferrer" className={`${btnGold} inline-flex items-center gap-2 px-5 py-3 text-[15px]`}>
            <ScanSearch size={16} aria-hidden /> Scan your code <ArrowUpRight size={15} aria-hidden />
            <span className="sr-only"> (opens in a new tab)</span>
          </a>
        </div>
        <div className="mb-6 max-w-[620px]">
          <ScansChart />
        </div>
        {s.k === 'loading' && <div className="h-[160px] animate-[gl-skeleton_1.4s_ease-in-out_infinite] rounded-card bg-surface" />}
        {s.k === 'error' && (
          <p className="m-0 text-[14px] text-error">
            The list could not be read: {s.message}{' '}
            <button type="button" onClick={retry} className="underline underline-offset-4">
              Retry
            </button>
          </p>
        )}
        {s.k === 'ok' && !s.data.reports.length && (
          <div className="flex flex-col items-center gap-3 rounded-card border border-dashed border-line-strong px-6 py-12 text-center" data-testid="no-reports">
            <span className="relative grid size-14 place-items-center">
              <span aria-hidden className="absolute inset-0 rounded-full border border-gold-line" style={{ animation: 'gl-live-pulse 2.6s ease-out infinite' }} />
              <FileSearch size={22} className="text-gold" aria-hidden />
            </span>
            <span className="heading-4">No published reports yet</span>
            <span className="max-w-[460px] text-[14px] text-muted">When an owner publishes a scan report from the app, it appears here.</span>
            <Link to={securityHref('/security/sample')} className="inline-flex min-h-11 items-center gap-2 font-mono text-[13px] text-gold underline-offset-4 hover:underline" data-testid="sample-link">
              <FileText size={15} aria-hidden /> See a sample report
            </Link>
          </div>
        )}
        {s.k === 'ok' && s.data.reports.length > 0 && (
          <ul className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(min(100%,340px),1fr))] gap-3 p-0" data-testid="report-index">
            {s.data.reports.map((r, i) => {
              const counts = r.counts ?? { critical: 0, high: 0, medium: 0, low: 0, info: 0 }
              const total = SEVERITIES.reduce((a, k) => a + (counts[k] ?? 0), 0)
              return (
                <li key={r.id} style={{ animation: `gl-rise .45s ${Math.min(i, 8) * 0.05}s ease both` }}>
                  <Link to={securityHref(r.url)} className="flex h-full flex-col gap-3 rounded-card border border-line bg-surface p-5 transition-colors hover:border-gold">
                    <span className="font-mono text-[11px] tracking-[1px] text-faint">
                      {KIND_LABEL[r.input.kind].toUpperCase()} · {fmtWhen(r.publishedAt)}
                    </span>
                    <span className="text-[15px] text-ink">
                      <Subject r={r} />
                    </span>
                    <span className="flex h-[8px] overflow-hidden rounded-full bg-line" aria-label={SEVERITIES.map((k) => `${counts[k]} ${SEV_LABEL[k].toLowerCase()}`).join(', ')}>
                      {total ? SEVERITIES.map((k, j) => (counts[k] ? <span key={k} style={{ width: `${(counts[k] / total) * 100}%`, background: SEV_COLOR[k], transformOrigin: 'left', animation: `gl-grow-x .6s ${j * 0.06}s cubic-bezier(.2,.8,.2,1) both` }} /> : null)) : <span className="w-full bg-green/30" />}
                    </span>
                    <span className="font-mono text-[11px] text-muted">{total ? SEVERITIES.filter((k) => counts[k]).map((k) => `${counts[k]} ${SEV_LABEL[k].toLowerCase()}`).join(' · ') : 'no findings reported'}</span>
                    {r.label && <span className="text-[12px] text-gold">{r.label}</span>}
                  </Link>
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </>
  )
}

export function PublicReportPage() {
  const { id = '' } = useParams()
  const [s, retry] = usePublic<{ report: PublicReport }>(`/api/security/reports/${encodeURIComponent(id)}`)
  if (s.k === 'loading') return <div role="status" aria-label="Loading the report" className="min-h-[70svh] px-page pt-16"><div className="h-[300px] animate-[gl-skeleton_1.4s_ease-in-out_infinite] rounded-card bg-surface" /></div>
  if (s.k === 'error')
    return (
      <section className="flex min-h-[60svh] flex-col items-start gap-4 px-page pt-16">
        <Seo title="Report not found" description="This security scan report is not published." noindex />
        <span className={eyebrow}>SECURITY REPORT</span>
        <h1 className="m-0 font-display text-h2 font-extrabold uppercase">{s.status === 404 ? 'Not published' : 'Could not load'}</h1>
        <p className="m-0 max-w-[560px] text-[15px] text-muted">{s.message}</p>
        <div className="flex gap-3">
          {s.status !== 404 && (
            <button type="button" onClick={retry} className={`${btnGold} px-5 py-3`}>
              Retry
            </button>
          )}
          <Link to={securityHref('/security/reports')} className="inline-flex min-h-11 items-center gap-2 font-mono text-[13px] text-muted hover:text-ink">
            <FileText size={15} aria-hidden /> Published reports
          </Link>
        </div>
      </section>
    )
  const r = s.data.report
  return (
    <>
      <Seo title={`Security scan report: ${r.title}`} description="An AI Security Scan report published by its owner: findings by severity, the tools that ran and the limits of an automated scan. Not an audit." noindex={!r.indexable} />
      <article className="flex flex-col gap-4 px-page pt-10 pb-16 print:p-0" data-testid="public-report">
        <div className="hidden items-center justify-between border-b border-[#ccc] pb-3 print:flex">
          <img src="/brand/products/gullysecurity-logo-on-light.svg" width={169} height={28} alt="Gully Security" className="block shrink-0" style={{ width: 169, height: 28 }} />
          <span className="font-mono text-[11px] text-[#333]">gullylabs.xyz{r.url}</span>
        </div>
        <div className="flex flex-wrap items-center gap-3 print:hidden">
          <Link to={securityHref('/security/reports')} className="inline-flex min-h-11 items-center gap-2 font-mono text-[12px] text-muted hover:text-ink">
            <ArrowLeft size={14} aria-hidden /> Published reports
          </Link>
          <a href={`/api/security/reports/${r.id}/report.html`} target="_blank" rel="noopener noreferrer" className="ml-auto inline-flex min-h-11 items-center gap-2 rounded-full border border-line-strong px-4 text-[13px] text-ink-2 hover:border-gold hover:text-ink" data-testid="print">
            <Printer size={15} aria-hidden /> Printable report (PDF) <ArrowUpRight size={14} aria-hidden />
            <span className="sr-only"> (opens in a new tab)</span>
          </a>
        </div>
        <header className="card card-pad grid grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] items-center gap-6 max-[860px]:grid-cols-1 print:border-[#ccc] print:bg-[#fff]">
          <div className="flex min-w-0 flex-col gap-3">
            <span className={`${eyebrow} print:text-[#000]`}>AI SECURITY SCAN REPORT</span>
            <ModeBadge label={r.label} mode={r.mode} />
            <h1 className="m-0 font-display text-h3 font-extrabold break-words text-ink print:text-[#000]">
              <Subject r={r} />
            </h1>
            <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 font-mono text-[12px]">
              <dt className="text-faint">Input</dt>
              <dd className="m-0 text-ink-2 print:text-[#000]">{KIND_LABEL[r.input.kind]}{r.input.commit ? ` @ ${r.input.commit}` : ''}</dd>
              <dt className="text-faint">Finished</dt>
              <dd className="m-0 text-ink-2 print:text-[#000]">{fmtWhen(r.completedAt)}</dd>
              <dt className="text-faint">Published</dt>
              <dd className="m-0 text-ink-2 print:text-[#000]">{fmtWhen(r.publishedAt)}</dd>
              <dt className="text-faint">Report</dt>
              <dd className="m-0 text-ink-2 print:text-[#000]">{r.id}</dd>
            </dl>
          </div>
          <SeverityCharts counts={r.summary?.counts ?? r.counts} />
        </header>
        <p className="m-0 flex items-start gap-2 rounded-tile border border-gold-line bg-gold/[.05] px-4 py-3 text-[13px] leading-[1.6] text-ink-2 print:border-[#ccc] print:bg-[#fff] print:text-[#000]" data-testid="not-audit">
          <Info size={15} className="mt-[3px] shrink-0 text-gold" aria-hidden />
          {NOT_AUDIT}
        </p>
        <ReportBody report={r} />
      </article>
    </>
  )
}

const SAMPLE_NOTE = 'Sample report. SampleVault.sol is a fictional contract written for this page: it is not deployed anywhere and is no one’s code. The report was built by the scan engine’s own report builder, in the mode scans run in today (AI review only, static tools listed as not run), so it shows exactly what a scan delivers, no more.'

/** /security/sample: what a scan report looks like, on a fictional contract (GET /api/security/sample). */
export function SampleReportPage() {
  const [s, retry] = usePublic<{ report: SampleReport }>('/api/security/sample')
  return (
    <>
      <Seo title="Sample AI Security Scan report" description="What an AI Security Scan report looks like, on a fictional contract: findings by severity with file and line, a draft proof of concept, the tools that ran and the limits. A sample, not a scan of real code." />
      <article className="flex flex-col gap-4 px-page pt-10 pb-16 print:p-0" data-testid="sample-report">
        <div className="flex flex-wrap items-center gap-3 print:hidden">
          <Link to={securityHref('/security')} className="inline-flex min-h-11 items-center gap-2 font-mono text-[12px] text-muted hover:text-ink">
            <ArrowLeft size={14} aria-hidden /> Gully Security
          </Link>
          <a href="/api/security/sample/report.html" target="_blank" rel="noopener noreferrer" className="ml-auto inline-flex min-h-11 items-center gap-2 rounded-full border border-line-strong px-4 text-[13px] text-ink-2 hover:border-gold hover:text-ink" data-testid="sample-print">
            <Printer size={15} aria-hidden /> Printable sample (PDF) <ArrowUpRight size={14} aria-hidden />
            <span className="sr-only"> (opens in a new tab)</span>
          </a>
        </div>
        {s.k === 'loading' && <div role="status" aria-label="Loading the sample report" className="h-[300px] animate-[gl-skeleton_1.4s_ease-in-out_infinite] rounded-card bg-surface" />}
        {s.k === 'error' && (
          <p className="m-0 text-[14px] text-error">
            The sample could not be read: {s.message}{' '}
            <button type="button" onClick={retry} className="inline-flex min-h-11 items-center underline underline-offset-4">
              Retry
            </button>
          </p>
        )}
        {s.k === 'ok' && (
          <>
            <header className="card card-pad grid grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] items-center gap-6 max-[860px]:grid-cols-1">
              <div className="flex min-w-0 flex-col gap-3">
                <span className="flex flex-wrap items-center gap-2">
                  <span className={eyebrow}>AI SECURITY SCAN REPORT</span>
                  <span className="rounded-full border border-gold px-[10px] py-[2px] font-mono text-[11px] tracking-[1px] text-gold" data-testid="sample-badge">
                    SAMPLE
                  </span>
                </span>
                <ModeBadge label={s.data.report.label} mode={s.data.report.mode} />
                <h1 className="m-0 font-display text-h3 font-extrabold break-words text-ink">
                  <span className="font-mono">SampleVault.sol</span> <span className="text-gold">· sample</span>
                </h1>
                <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 font-mono text-[12px]">
                  <dt className="text-faint">Input</dt>
                  <dd className="m-0 text-ink-2">{KIND_LABEL.upload} (fictional)</dd>
                  <dt className="text-faint">Scanned</dt>
                  <dd className="m-0 text-ink-2">{fmtWhen(s.data.report.completedAt)}</dd>
                  <dt className="text-faint">Report</dt>
                  <dd className="m-0 text-ink-2">{s.data.report.id}</dd>
                </dl>
                <span className="flex flex-wrap gap-3 print:hidden">
                  <a href={SCAN_APP_URL} target="_blank" rel="noopener noreferrer" className={`${btnGold} inline-flex items-center gap-2 px-5 py-3 text-[15px]`}>
                    <ScanSearch size={16} aria-hidden /> Scan your code <ArrowUpRight size={15} aria-hidden />
                    <span className="sr-only"> (opens in a new tab)</span>
                  </a>
                  <Link to={securityHref('/legal/scan-terms')} className="inline-flex min-h-11 items-center gap-2 font-mono text-[13px] text-muted hover:text-ink">
                    <FileText size={15} aria-hidden /> Scan terms
                  </Link>
                </span>
              </div>
              <SeverityCharts counts={s.data.report.summary.counts} />
            </header>
            <p className="m-0 flex items-start gap-2 rounded-tile border border-gold-line bg-gold/[.05] px-4 py-3 text-[13px] leading-[1.6] text-ink-2" data-testid="sample-note">
              <Info size={15} className="mt-[3px] shrink-0 text-gold" aria-hidden />
              {SAMPLE_NOTE}
            </p>
            <ReportBody report={s.data.report} />
          </>
        )}
      </article>
    </>
  )
}
