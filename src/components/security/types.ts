/* Gully Security in the browser: the shapes server/security-routes.mjs answers, plus the labels and colours
   every Security surface shares (the app's Security tab, /security, the public report pages, admin).
   The scan and report shapes follow the engine contract in server/security-contract.mjs; where the engine
   leaves a field open (scope, location, cost) the UI reads it defensively. */

export type ScanStatus = 'queued' | 'fetching' | 'analysing' | 'triaging' | 'done' | 'failed' | 'cancelled'
/** awaiting_payment is the UI's own state before a paid scan reaches the engine. */
export type JobStatus = ScanStatus | 'awaiting_payment' | 'unknown'
export type InputKind = 'address' | 'repo' | 'upload' | 'web2'
export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info'

export interface ScanInput {
  kind: InputKind
  chain?: string
  address?: string
  repo?: string
  commit?: string | null
}

export type FindingLocation = string | { file?: string; line?: number; startLine?: number; endLine?: number; snippet?: string; address?: string; function?: string } | null

export interface Finding {
  id: string
  severity: Severity
  title: string
  location: FindingLocation
  description: string
  recommendation: string
  /** Draft proof of concept: only members of the workspace see it; never published. */
  poc?: string
  pocExecuted: boolean
  status: string
  /** Public reports say whether a draft PoC exists without showing it. */
  hasPoc?: boolean
}

export interface Tool {
  name: string
  version: string | null
  ran: boolean
  reason?: string | null
}

export interface Report {
  scope: unknown
  tools: Tool[]
  findings: Finding[]
  summary: string
  disclaimer: string
  cost?: unknown
}

export type Counts = Record<Severity, number>

export interface ScanView {
  id: string
  status: JobStatus
  title: string
  input: ScanInput
  upload: { name: string; size?: number } | null
  free: boolean
  priceUsd: number
  payment: { invoiceId: string; status: 'open' | 'paid' | 'expired' | 'cancelled' | 'unknown'; usd: number; payUrl: string; expiresAt: string | null } | null
  progress: { step: string; pct: number } | null
  createdAt: string
  startedAt: string | null
  updatedAt: string
  completedAt: string | null
  counts: Counts | null
  published: boolean
  publishedAt: string | null
  indexable: boolean
  publicUrl: string | null
  startError: string | null
  report?: Report | null
  failure?: string | null
}

export interface SecurityOffer {
  scan: { id: 'scan'; name: string; priceUsd: number; freePerMonth: Record<string, number>; maxActive: number; maxUploadBytes: number }
  review: { id: 'review'; name: string; quoted: boolean; available: boolean }
  audit: { id: 'audit'; name: string; quoted: boolean; available: boolean }
}

export interface ScanChain {
  key: string
  chainId: number
  name: string
}

export interface Quota {
  plan: { id: string; name: string }
  freePerMonth: number
  used: number
  left: number
  resetsAt: string
  nextPriceUsd: number
  active: number
  maxActive: number
}

export interface SecurityOverview {
  quota: Quota
  offer: SecurityOffer
  chains: ScanChain[]
  engine: { installed: boolean }
  checkout: { enabled: boolean }
  role: string
  canPublish: boolean
}

export interface PublicReport extends Omit<Report, 'cost'> {
  id: string
  title: string
  input: ScanInput
  upload: { name: string } | null
  completedAt: string | null
  publishedAt: string
  indexable: boolean
  counts: Counts
  url: string
}

export type PublicReportListItem = Pick<PublicReport, 'id' | 'title' | 'input' | 'upload' | 'completedAt' | 'publishedAt' | 'indexable' | 'counts' | 'url'>

export interface SecurityStats {
  generatedAt: string
  totals: { started: number; done: number; failed: number; published: number }
  days: { day: string; started: number; done: number; failed: number }[]
}

/* ------------------------------------------------------------ labels --- */

export const SEVERITIES: Severity[] = ['critical', 'high', 'medium', 'low', 'info']

/** Severity colours, from the brand palette (src/components/charts/chartPresets PALETTE and the tokens). */
export const SEV_COLOR: Record<Severity, string> = { critical: '#e4572e', high: '#ff8a7a', medium: '#e8c060', low: '#5aa9e6', info: '#7f8b9c' }
export const SEV_LABEL: Record<Severity, string> = { critical: 'Critical', high: 'High', medium: 'Medium', low: 'Low', info: 'Info' }

/** The engine's pipeline, in order, with what each step does in plain words. */
export const STEPS: { id: ScanStatus; label: string; text: string }[] = [
  { id: 'queued', label: 'Queued', text: 'Waiting for a scanner' },
  { id: 'fetching', label: 'Fetching', text: 'Reading the code or the verified source' },
  { id: 'analysing', label: 'Analysing', text: 'Static analysers and the AI pass' },
  { id: 'triaging', label: 'Triaging', text: 'Removing duplicates and ranking findings' },
  { id: 'done', label: 'Report', text: 'Findings, tools run and limits' },
]

export const STATUS_LABEL: Record<JobStatus, string> = {
  awaiting_payment: 'Awaiting payment',
  queued: 'Queued',
  fetching: 'Fetching',
  analysing: 'Analysing',
  triaging: 'Triaging',
  done: 'Done',
  failed: 'Failed',
  cancelled: 'Cancelled',
  unknown: 'Unreadable',
}

export const KIND_LABEL: Record<InputKind, string> = { address: 'Deployed contract', repo: 'Smart contract repo', upload: 'Upload', web2: 'Web2 repo' }

export const isActive = (s: JobStatus) => s === 'queued' || s === 'fetching' || s === 'analysing' || s === 'triaging'
export const isFinal = (s: JobStatus) => s === 'done' || s === 'failed' || s === 'cancelled'

/** "src/Vault.sol:42" for any location shape. */
export function locationText(l: FindingLocation): string {
  if (!l) return '—'
  if (typeof l === 'string') return l
  const lines = l.startLine && l.endLine ? `${l.startLine}-${l.endLine}` : (l.line ?? l.startLine)
  return [l.file ?? l.address ?? '', lines ? `:${lines}` : '', l.function ? ` ${l.function}()` : ''].join('') || '—'
}
export const locationSnippet = (l: FindingLocation) => (l && typeof l === 'object' ? (l.snippet ?? null) : null)

/** The scope the engine reported, as label/value rows (it may be a string or a small object). */
export function scopeRows(scope: unknown): [string, string][] {
  if (scope == null) return []
  if (typeof scope === 'string') return [['Scope', scope]]
  if (typeof scope !== 'object') return [['Scope', String(scope)]]
  return Object.entries(scope as Record<string, unknown>)
    .filter(([, v]) => v != null && v !== '')
    .map(([k, v]) => [k.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase()), Array.isArray(v) ? v.join(', ') : typeof v === 'object' ? JSON.stringify(v) : String(v)])
}

export const countsOf = (findings: Finding[]): Counts => Object.fromEntries(SEVERITIES.map((s) => [s, findings.filter((f) => f.severity === s).length])) as Counts

export const fmtWhen = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—')
