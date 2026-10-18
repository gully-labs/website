import { AlertTriangle, Check, ChevronDown, CircleSlash, Copy, FileCode2, FlaskConical, Info, ListFilter, Search, Wrench } from 'lucide-react'
import { useId, useMemo, useState, type ReactNode } from 'react'
import { copyWithToast } from '../ui/toast'
import { SeverityCharts } from './SeverityCharts'
import { countsOf, locationSnippet, locationText, scopeRows, SEV_COLOR, SEV_LABEL, SEVERITIES, type Finding, type Severity, type Tool } from './types'

/* The body of a scan report, shared by the app's report viewer and the public report page:
   summary and scope, findings by severity (animated donut + bars), the tools that ran and those that did
   not (with the reason), then the findings with filters (severity, status, text) where each one expands
   to its description, code location, recommendation and, in the app only, the draft PoC with a copy button.
   The engine's disclaimer closes it. Print styles (print:*) make it a clean PDF. */

const chipCls = (on: boolean) => `inline-flex min-h-9 items-center gap-[6px] rounded-full border px-3 text-[12px] transition-colors print:hidden ${on ? 'border-gold bg-gold text-bg' : 'border-line-strong text-ink-2 hover:border-gold hover:text-ink'}`

export function SevBadge({ s }: { s: Severity }) {
  return (
    <span className="inline-flex min-w-[64px] items-center justify-center gap-[6px] rounded-full border px-2 py-[2px] font-mono text-[11px] tracking-[.5px] uppercase" style={{ borderColor: `${SEV_COLOR[s]}66`, color: SEV_COLOR[s] }}>
      <i className="size-[6px] rounded-full" style={{ background: SEV_COLOR[s] }} aria-hidden />
      {SEV_LABEL[s]}
    </span>
  )
}

function Block({ title, icon, children, className = '' }: { title: string; icon: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`flex min-w-0 flex-col gap-3 rounded-[14px] border border-line bg-surface p-4 print:break-inside-avoid print:border-[#ccc] print:bg-[#fff] ${className}`}>
      <h3 className="m-0 flex items-center gap-2 text-[14px] font-semibold text-ink print:text-[#000]">
        <span className="text-gold" aria-hidden>
          {icon}
        </span>
        {title}
      </h3>
      {children}
    </section>
  )
}

export function ToolsTable({ tools }: { tools: Tool[] }) {
  if (!tools.length) return <p className="m-0 text-[13px] text-faint">The engine listed no tools for this scan.</p>
  return (
    <ul className="m-0 flex list-none flex-col gap-1 p-0" data-testid="tools">
      {tools.map((t, i) => (
        <li key={`${t.name}-${i}`} className="flex flex-wrap items-baseline gap-x-2 gap-y-[2px] border-b border-line py-[6px] text-[13px] last:border-b-0" style={{ animation: `gl-rise .4s ${i * 0.05}s ease both` }}>
          {t.ran ? <Check size={14} className="shrink-0 self-center text-green" aria-label="ran" /> : <CircleSlash size={14} className="shrink-0 self-center text-error" aria-label="did not run" />}
          <span className="font-mono text-ink">{t.name}</span>
          {t.version && <span className="font-mono text-[11px] text-faint">{t.version}</span>}
          <span className={`ml-auto font-mono text-[11px] ${t.ran ? 'text-green' : 'text-error'}`}>{t.ran ? 'ran' : 'not run'}</span>
          {!t.ran && t.reason && <span className="w-full pl-[22px] text-[12px] text-muted">{t.reason}</span>}
        </li>
      ))}
    </ul>
  )
}

function FindingItem({ f, open, onToggle, showPoc }: { f: Finding; open: boolean; onToggle: () => void; showPoc: boolean }) {
  const id = useId()
  const snippet = locationSnippet(f.location)
  return (
    <li className="rounded-[10px] border border-line bg-surface-deep print:break-inside-avoid print:border-[#ccc] print:bg-[#fff]" data-finding={f.id} data-severity={f.severity}>
      <button type="button" aria-expanded={open} aria-controls={id} onClick={onToggle} className="flex min-h-11 w-full items-center gap-3 px-3 py-2 text-left">
        <SevBadge s={f.severity} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[14px] font-medium text-ink print:whitespace-normal print:text-[#000]">{f.title}</span>
          <span className="block truncate font-mono text-[11px] text-faint">
            {f.id} · {locationText(f.location)} · {f.status}
          </span>
        </span>
        <ChevronDown size={16} className={`shrink-0 text-faint transition-transform print:hidden ${open ? 'rotate-180' : ''}`} aria-hidden />
      </button>
      <div id={id} hidden={!open} className="flex flex-col gap-3 border-t border-line px-3 py-3 text-[13px] leading-[1.6] text-ink-2 print:!block print:text-[#000]">
        <p className="m-0 whitespace-pre-wrap">{f.description}</p>
        <div className="flex flex-col gap-1">
          <span className="flex items-center gap-2 font-mono text-[11px] tracking-[.5px] text-faint">
            <FileCode2 size={13} aria-hidden /> LOCATION
          </span>
          <code className="font-mono text-[12px] break-all text-ink">{locationText(f.location)}</code>
          {snippet && <pre className="m-0 overflow-x-auto rounded-input border border-line bg-bg p-3 font-mono text-[12px] leading-[1.55] text-ink-2 print:whitespace-pre-wrap">{snippet}</pre>}
        </div>
        {f.recommendation && (
          <div className="flex flex-col gap-1">
            <span className="flex items-center gap-2 font-mono text-[11px] tracking-[.5px] text-faint">
              <Wrench size={13} aria-hidden /> RECOMMENDATION
            </span>
            <p className="m-0 whitespace-pre-wrap">{f.recommendation}</p>
          </div>
        )}
        {showPoc && f.poc ? (
          <div className="flex flex-col gap-1 print:hidden">
            <span className="flex flex-wrap items-center gap-2 font-mono text-[11px] tracking-[.5px] text-faint">
              <FlaskConical size={13} aria-hidden /> DRAFT PROOF OF CONCEPT · {f.pocExecuted ? 'executed by the engine' : 'not executed: verify it yourself'}
              <button type="button" onClick={() => void copyWithToast(f.poc ?? '', 'PoC')} className="ml-auto inline-flex min-h-9 items-center gap-[6px] rounded-full border border-line-strong px-3 text-[12px] text-ink-2 hover:border-gold hover:text-ink">
                <Copy size={13} aria-hidden /> Copy
              </button>
            </span>
            <pre className="m-0 max-h-[260px] overflow-auto rounded-input border border-line bg-bg p-3 font-mono text-[12px] leading-[1.55] text-ink-2" data-testid="poc">
              {f.poc}
            </pre>
            <span className="text-[11px] text-faint">Drafts are for your team only and are never published with the report.</span>
          </div>
        ) : (
          (f.hasPoc || f.poc) && <span className="font-mono text-[11px] text-faint">A draft proof of concept exists and is kept private to the owner.</span>
        )}
      </div>
    </li>
  )
}

export function FindingsList({ findings, showPoc, sev, setSev }: { findings: Finding[]; showPoc: boolean; sev: Severity | 'all'; setSev: (s: Severity | 'all') => void }) {
  const [status, setStatus] = useState<string>('all')
  const [q, setQ] = useState('')
  const [open, setOpen] = useState<Record<string, boolean>>({})
  const statuses = useMemo(() => [...new Set(findings.map((f) => f.status))], [findings])
  const counts = countsOf(findings)
  const shown = findings
    .filter((f) => (sev === 'all' || f.severity === sev) && (status === 'all' || f.status === status) && (!q || `${f.title} ${f.description} ${locationText(f.location)}`.toLowerCase().includes(q.toLowerCase())))
    .sort((a, b) => SEVERITIES.indexOf(a.severity) - SEVERITIES.indexOf(b.severity))
  const allOpen = shown.length > 0 && shown.every((f) => open[f.id])
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2 print:hidden" role="group" aria-label="Filter findings by severity">
        <ListFilter size={15} className="text-faint" aria-hidden />
        <button type="button" aria-pressed={sev === 'all'} onClick={() => setSev('all')} className={chipCls(sev === 'all')}>
          All <span className="font-mono">{findings.length}</span>
        </button>
        {SEVERITIES.filter((s) => counts[s] > 0).map((s) => (
          <button key={s} type="button" aria-pressed={sev === s} onClick={() => setSev(s)} className={chipCls(sev === s)}>
            <i className="size-[7px] rounded-full" style={{ background: SEV_COLOR[s] }} aria-hidden />
            {SEV_LABEL[s]} <span className="font-mono">{counts[s]}</span>
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2 print:hidden">
        <label className="relative min-w-[180px] flex-[1_1_200px]">
          <span className="sr-only">Search findings</span>
          <Search size={14} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-faint" aria-hidden />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search title, text or file" className="h-10 w-full rounded-input border border-line-strong bg-bg pr-3 pl-8 text-[13px] text-ink outline-none focus:border-gold" />
        </label>
        {statuses.length > 1 && (
          <label className="flex items-center gap-2 text-[12px] text-dim">
            Status
            <select value={status} onChange={(e) => setStatus(e.target.value)} className="h-10 rounded-input border border-line-strong bg-bg px-2 text-[13px] text-ink outline-none focus:border-gold">
              <option value="all">all</option>
              {statuses.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
        )}
        <button type="button" onClick={() => setOpen(allOpen ? {} : Object.fromEntries(shown.map((f) => [f.id, true])))} className="inline-flex min-h-10 items-center rounded-full px-3 font-mono text-[12px] text-muted hover:text-ink">
          {allOpen ? 'Collapse all' : 'Expand all'}
        </button>
      </div>
      {shown.length ? (
        <ul className="m-0 flex list-none flex-col gap-2 p-0" aria-label="Findings" data-testid="findings">
          {shown.map((f) => (
            <FindingItem key={f.id} f={f} showPoc={showPoc} open={!!open[f.id]} onToggle={() => setOpen((o) => ({ ...o, [f.id]: !o[f.id] }))} />
          ))}
        </ul>
      ) : (
        <p className="m-0 rounded-input border border-dashed border-line-strong px-4 py-6 text-center text-[13px] text-faint">{findings.length ? 'No finding matches these filters.' : 'This scan reported no findings.'}</p>
      )}
    </div>
  )
}

/** The whole report. `showPoc` only in the app (members of the workspace). */
export function ReportBody({ report, showPoc }: { report: { scope: unknown; tools: Tool[]; findings: Finding[]; summary: string; disclaimer: string }; showPoc: boolean }) {
  const [sev, setSev] = useState<Severity | 'all'>('all')
  const counts = countsOf(report.findings)
  const scope = scopeRows(report.scope)
  return (
    <div className="grid grid-cols-[minmax(0,5fr)_minmax(0,7fr)] items-start gap-4 max-[1023px]:grid-cols-1 print:grid-cols-1" data-testid="report-body">
      <div className="flex min-w-0 flex-col gap-4">
        <Block title="Findings by severity" icon={<AlertTriangle size={15} />}>
          <SeverityCharts counts={counts} onPick={setSev} compact />
          {report.summary && <p className="m-0 text-[13px] leading-[1.6] whitespace-pre-wrap text-ink-2 print:text-[#000]">{report.summary}</p>}
        </Block>
        <Block title="Tools" icon={<Wrench size={15} />}>
          <ToolsTable tools={report.tools} />
        </Block>
        {scope.length > 0 && (
          <Block title="Scope" icon={<FileCode2 size={15} />}>
            <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[13px]">
              {scope.map(([k, v]) => (
                <div key={k} className="contents">
                  <dt className="text-dim">{k}</dt>
                  <dd className="m-0 font-mono text-[12px] break-all text-ink-2 print:text-[#000]">{v}</dd>
                </div>
              ))}
            </dl>
          </Block>
        )}
      </div>
      <div className="flex min-w-0 flex-col gap-4">
        <Block title={`Findings (${report.findings.length})`} icon={<ListFilter size={15} />}>
          <FindingsList findings={report.findings} showPoc={showPoc} sev={sev} setSev={setSev} />
        </Block>
        <p className="m-0 flex items-start gap-2 rounded-[10px] border border-line px-3 py-2 text-[12px] leading-[1.6] text-faint print:text-[#333]" data-testid="disclaimer">
          <Info size={14} className="mt-[2px] shrink-0" aria-hidden />
          <span>{report.disclaimer || 'Automated scan: it can miss issues and report false positives. It is not an audit.'}</span>
        </p>
      </div>
    </div>
  )
}
