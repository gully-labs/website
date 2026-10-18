import { AlertTriangle, Ban, Check, ChevronDown, CircleSlash, Copy, FileCode2, FlaskConical, Info, ListFilter, Search, ShieldAlert, UserX, Wrench, X } from 'lucide-react'
import { useId, useMemo, useState, type ReactNode } from 'react'
import { copyWithToast } from '../ui/toast'
import { SeverityCharts } from './SeverityCharts'
import { countsOf, locationText, POC_LABEL, SEV_COLOR, SEV_LABEL, SEVERITIES, targetRows, type Finding, type Report, type Severity, type Tool } from './types'

/* The body of a scan report (the engine's ScanReport), shared by the app's report viewer and the public
   report page: the engine's mode label verbatim, summary and target, findings by severity (animated donut
   + bars), the tools that ran and those that did not (with the reason), then the findings with filters
   (severity, category, text) where each one expands to what could happen, the details, its locations, the
   recommendation and the draft PoC (its code in the app only; a public report keeps it private). Then the
   checklist (web2), dismissed tool findings, limitations and the engine's disclaimer, verbatim. */

const chipCls = (on: boolean) => `inline-flex min-h-9 items-center gap-[6px] rounded-full border px-3 text-[12px] transition-colors print:hidden ${on ? 'border-gold bg-gold text-bg' : 'border-line-strong text-ink-2 hover:border-gold hover:text-ink'}`
const TOOL_TONE: Record<Tool['status'], string> = { ran: 'text-green', failed: 'text-error', 'not-run': 'text-error', skipped: 'text-faint' }

export function SevBadge({ s }: { s: Severity }) {
  return (
    <span className="inline-flex min-w-[64px] items-center justify-center gap-[6px] rounded-full border px-2 py-[2px] font-mono text-[11px] tracking-[.5px] uppercase" style={{ borderColor: `${SEV_COLOR[s]}66`, color: SEV_COLOR[s] }}>
      <i className="size-[6px] rounded-full" style={{ background: SEV_COLOR[s] }} aria-hidden />
      {SEV_LABEL[s]}
    </span>
  )
}

/** The engine's mode label, verbatim ("AI review only — static tools unavailable", …). */
export function ModeBadge({ label, mode }: { label: string | null; mode: string | null }) {
  if (!label) return null
  const partial = mode && mode !== 'static+ai'
  return (
    <span className={`inline-flex min-h-[26px] items-center gap-2 rounded-full border px-[10px] text-[12px] ${partial ? 'border-gold-line text-gold' : 'border-success-line text-green'}`} data-testid="mode-label" data-mode={mode ?? ''}>
      {partial ? <ShieldAlert size={13} aria-hidden /> : <Check size={13} aria-hidden />}
      {label}
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
        <li key={`${t.name}-${i}`} className="flex flex-wrap items-baseline gap-x-2 gap-y-[2px] border-b border-line py-[6px] text-[13px] last:border-b-0" style={{ animation: `gl-rise .4s ${i * 0.05}s ease both` }} data-tool-status={t.status}>
          {t.status === 'ran' ? <Check size={14} className="shrink-0 self-center text-green" aria-hidden /> : t.status === 'skipped' ? <CircleSlash size={14} className="shrink-0 self-center text-faint" aria-hidden /> : <X size={14} className="shrink-0 self-center text-error" aria-hidden />}
          <span className="font-mono text-ink">{t.name}</span>
          {t.version && <span className="font-mono text-[11px] text-faint">{t.version}</span>}
          <span className={`ml-auto font-mono text-[11px] ${TOOL_TONE[t.status]}`}>
            {t.status === 'ran' ? `ran · ${t.findings} finding${t.findings === 1 ? '' : 's'}` : t.status.replace('-', ' ')}
          </span>
          {t.status !== 'ran' && t.reason && <span className="w-full pl-[22px] text-[12px] text-muted">{t.reason}</span>}
        </li>
      ))}
    </ul>
  )
}

function Label({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <span className="flex items-center gap-2 font-mono text-[11px] tracking-[.5px] text-faint">
      {icon} {children}
    </span>
  )
}

function FindingItem({ f, open, onToggle }: { f: Finding; open: boolean; onToggle: () => void }) {
  const id = useId()
  return (
    <li className="rounded-[10px] border border-line bg-surface-deep print:break-inside-avoid print:border-[#ccc] print:bg-[#fff]" data-finding={f.id} data-severity={f.severity}>
      <button type="button" aria-expanded={open} aria-controls={id} onClick={onToggle} className="flex min-h-11 w-full items-center gap-3 px-3 py-2 text-left">
        <SevBadge s={f.severity} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[14px] font-medium text-ink print:whitespace-normal print:text-[#000]">{f.title}</span>
          <span className="block truncate font-mono text-[11px] text-faint">
            {f.id} · {locationText(f.locations[0])} · {f.confidence} confidence · {f.triage}
          </span>
        </span>
        <ChevronDown size={16} className={`shrink-0 text-faint transition-transform print:hidden ${open ? 'rotate-180' : ''}`} aria-hidden />
      </button>
      <div id={id} hidden={!open} className="flex flex-col gap-3 border-t border-line px-3 py-3 text-[13px] leading-[1.6] text-ink-2 print:!block print:text-[#000]">
        {f.explanation && (
          <p className="m-0 whitespace-pre-wrap">
            <b className="text-ink">What could happen.</b> {f.explanation}
          </p>
        )}
        {f.description && (
          <p className="m-0 whitespace-pre-wrap">
            <b className="text-ink">Details.</b> {f.description}
          </p>
        )}
        <div className="flex flex-col gap-1">
          <Label icon={<FileCode2 size={13} aria-hidden />}>LOCATION</Label>
          {f.locations.length ? f.locations.map((l, i) => <code key={i} className="font-mono text-[12px] break-all text-ink">{locationText(l)}</code>) : <span className="text-faint">—</span>}
          <span className="font-mono text-[11px] text-faint">
            likelihood {f.likelihood} × impact {f.impact} · {f.category} · from {f.sources.map((s) => (s.detector ? `${s.tool}:${s.detector}` : s.tool)).join(', ') || 'the engine'}
          </span>
        </div>
        {f.recommendation && (
          <div className="flex flex-col gap-1">
            <Label icon={<Wrench size={13} aria-hidden />}>RECOMMENDATION</Label>
            <p className="m-0 whitespace-pre-wrap">{f.recommendation}</p>
          </div>
        )}
        {f.poc && (
          <div className="flex flex-col gap-1" data-testid="poc-block">
            <span className="flex flex-wrap items-center gap-2 font-mono text-[11px] tracking-[.5px] text-faint">
              <FlaskConical size={13} aria-hidden /> PROOF OF CONCEPT · <span data-testid="poc-status">{POC_LABEL[f.poc.status]}</span>
              {f.poc.code && (
                <button type="button" onClick={() => void copyWithToast(f.poc?.code ?? '', 'PoC')} className="ml-auto inline-flex min-h-9 items-center gap-[6px] rounded-full border border-line-strong px-3 text-[12px] text-ink-2 hover:border-gold hover:text-ink print:hidden">
                  <Copy size={13} aria-hidden /> Copy
                </button>
              )}
            </span>
            {f.poc.code ? (
              <pre className="m-0 max-h-[260px] overflow-auto rounded-input border border-line bg-bg p-3 font-mono text-[12px] leading-[1.55] text-ink-2 print:max-h-none print:whitespace-pre-wrap" data-testid="poc">
                {f.poc.code}
              </pre>
            ) : null}
            {f.poc.note && <span className="text-[12px] text-faint">{f.poc.note}</span>}
          </div>
        )}
        <span className="flex items-center gap-2 font-mono text-[11px] text-faint">
          <UserX size={13} aria-hidden /> Not verified by a human reviewer.
        </span>
      </div>
    </li>
  )
}

export function FindingsList({ findings, sev, setSev }: { findings: Finding[]; sev: Severity | 'all'; setSev: (s: Severity | 'all') => void }) {
  const [category, setCategory] = useState<string>('all')
  const [q, setQ] = useState('')
  const [open, setOpen] = useState<Record<string, boolean>>({})
  const categories = useMemo(() => [...new Set(findings.map((f) => f.category))].sort(), [findings])
  const counts = countsOf(findings)
  // The engine sorts findings already (severity, confidence, location); the filters keep that order.
  const shown = findings.filter((f) => (sev === 'all' || f.severity === sev) && (category === 'all' || f.category === category) && (!q || `${f.title} ${f.explanation} ${f.description} ${f.locations.map(locationText).join(' ')}`.toLowerCase().includes(q.toLowerCase())))
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
        {categories.length > 1 && (
          <label className="flex items-center gap-2 text-[12px] text-dim">
            Category
            <select value={category} onChange={(e) => setCategory(e.target.value)} className="h-10 rounded-input border border-line-strong bg-bg px-2 text-[13px] text-ink outline-none focus:border-gold">
              <option value="all">all</option>
              {categories.map((s) => (
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
            <FindingItem key={f.id} f={f} open={!!open[f.id]} onToggle={() => setOpen((o) => ({ ...o, [f.id]: !o[f.id] }))} />
          ))}
        </ul>
      ) : (
        <p className="m-0 rounded-input border border-dashed border-line-strong px-4 py-6 text-center text-[13px] text-faint">{findings.length ? 'No finding matches these filters.' : 'No findings were raised by the checks that ran. That is not evidence the code is safe.'}</p>
      )}
    </div>
  )
}

/** The whole report. */
export function ReportBody({ report }: { report: Report }) {
  const [sev, setSev] = useState<Severity | 'all'>('all')
  const counts = report.summary?.counts ?? countsOf(report.findings)
  const target = targetRows(report.target)
  const inScope = report.scope?.files?.filter((f) => f.inScope) ?? []
  return (
    <div className="grid grid-cols-[minmax(0,5fr)_minmax(0,7fr)] items-start gap-4 max-[1023px]:grid-cols-1 print:grid-cols-1" data-testid="report-body">
      <div className="flex min-w-0 flex-col gap-4">
        <Block title="Findings by severity" icon={<AlertTriangle size={15} />}>
          <ModeBadge label={report.label} mode={report.mode} />
          <SeverityCharts counts={counts} onPick={setSev} compact />
          {report.summary?.text && <p className="m-0 text-[13px] leading-[1.6] whitespace-pre-wrap text-ink-2 print:text-[#000]">{report.summary.text}</p>}
        </Block>
        <Block title="Tools" icon={<Wrench size={15} />}>
          <ToolsTable tools={report.tools} />
          {report.ai?.notReviewed?.length > 0 && <p className="m-0 text-[12px] text-faint">Not reviewed by the AI: {report.ai.notReviewed.join(', ')}</p>}
        </Block>
        <Block title="Scope" icon={<FileCode2 size={15} />}>
          <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[13px]">
            {target.map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="text-dim">{k}</dt>
                <dd className="m-0 font-mono text-[12px] break-all text-ink-2 print:text-[#000]">{v}</dd>
              </div>
            ))}
          </dl>
          {report.scope && (
            <details className="text-[12px] text-muted">
              <summary className="cursor-pointer">
                {report.scope.inScopeFiles} file{report.scope.inScopeFiles === 1 ? '' : 's'} in scope · {report.scope.totalNsloc} nSLOC
              </summary>
              <ul className="m-0 mt-2 flex list-none flex-col gap-[2px] p-0 font-mono text-[11px]">
                {inScope.slice(0, 60).map((f) => (
                  <li key={f.path}>
                    {f.path} <span className="text-faint">{f.nsloc}</span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </Block>
      </div>
      <div className="flex min-w-0 flex-col gap-4">
        <Block title={`Findings (${report.findings.length})`} icon={<ListFilter size={15} />}>
          <FindingsList findings={report.findings} sev={sev} setSev={setSev} />
        </Block>
        {report.checklist && report.checklist.length > 0 && (
          <Block title="Checklist" icon={<Check size={15} />}>
            <ul className="m-0 flex list-none flex-col gap-1 p-0 text-[13px]">
              {report.checklist.map((c) => (
                <li key={c.id} className="flex flex-wrap gap-2 border-b border-line py-[6px] last:border-b-0">
                  <span className={`font-mono text-[11px] uppercase ${c.result === 'pass' ? 'text-green' : c.result === 'fail' ? 'text-error' : 'text-gold'}`}>{c.result}</span>
                  <span className="min-w-0 flex-1 text-ink-2">
                    <b className="font-mono text-[11px] text-faint">{c.id}</b> {c.item}
                    {c.note && <span className="block text-[12px] text-muted">{c.note}</span>}
                  </span>
                </li>
              ))}
            </ul>
          </Block>
        )}
        {report.dropped?.length > 0 && (
          <Block title={`Dismissed tool findings (${report.dropped.length})`} icon={<Ban size={15} />}>
            <ul className="m-0 flex list-none flex-col gap-1 p-0 text-[12px] text-muted">
              {report.dropped.map((d, i) => (
                <li key={i}>
                  <span className="font-mono text-ink-2">{d.tool}</span> {d.title} <span className="font-mono">{locationText(d.location)}</span>: {d.reason}
                </li>
              ))}
            </ul>
          </Block>
        )}
        {report.limitations?.length > 0 && (
          <Block title="Limitations" icon={<ShieldAlert size={15} />}>
            <ul className="m-0 flex list-disc flex-col gap-1 pl-5 text-[13px] text-ink-2">
              {report.limitations.map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
          </Block>
        )}
        <p className="m-0 flex items-start gap-2 rounded-[10px] border border-line px-3 py-2 text-[12px] leading-[1.6] text-faint print:text-[#333]" data-testid="disclaimer">
          <Info size={14} className="mt-[2px] shrink-0" aria-hidden />
          <span>{report.disclaimer}</span>
        </p>
      </div>
    </div>
  )
}
