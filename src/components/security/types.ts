/* Gully Security in the browser: the shapes server/security-routes.mjs answers, plus the labels and colours
   every Security surface shares (the app's Security tab, /security, the public report pages, admin).
   The report is the scan engine's ScanReport (server/security/schema.d.mts, schema 1.x), restated here for
   the browser build; keep the two in step. */

export type ScanStatus = 'queued' | 'fetching' | 'analysing' | 'triaging' | 'reporting' | 'done' | 'failed' | 'cancelled'
/** awaiting_payment is the UI's own state before a paid scan reaches the engine. */
export type JobStatus = ScanStatus | 'awaiting_payment' | 'unknown'
export type InputKind = 'address' | 'github' | 'upload' | 'web2'
export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info'
export type ScanMode = 'static+ai' | 'ai-only' | 'static-only' | 'bytecode-only' | 'checklist'

/** A job's input as the server stores it (security-contract.mjs). */
export interface ScanInput {
  kind: InputKind
  chain?: string
  address?: string
  repo?: string
  commit?: string | null
  ref?: string | null
  filename?: string
}

export interface Location {
  file: string
  line: number | null
  endLine: number | null
}

export interface Poc {
  framework: 'foundry'
  /** "draft-not-executed" unless the scanner worker ran it. */
  status: 'draft-not-executed' | 'executed-passed' | 'executed-failed'
  /** Empty on a public report (kept private by the owner). */
  code: string
  note: string
}

export interface Finding {
  id: string
  title: string
  severity: Severity
  likelihood: string
  impact: string
  confidence: string
  category: string
  triage: 'ai-triaged' | 'ai-found' | 'tool-untriaged' | 'engine-note'
  sources: { tool: string; detector: string | null }[]
  locations: Location[]
  description: string
  explanation: string
  recommendation: string
  poc: Poc | null
  verifiedByHuman: false
  status: 'open'
}

export interface Tool {
  name: string
  version: string | null
  status: 'ran' | 'failed' | 'not-run' | 'skipped'
  reason: string | null
  durationMs: number | null
  findings: number
}

export type Counts = Record<Severity, number>

export interface Report {
  id: string
  title: string
  mode: ScanMode
  /** The engine's fixed label for the mode, shown verbatim. */
  label: string
  createdAt: string
  completedAt: string
  target: {
    type: InputKind
    chainId: number | null
    chainName?: string | null
    address: string | null
    explorerUrl?: string | null
    verified: boolean | null
    sourceProvider?: string | null
    contractName?: string | null
    compiler?: { version: string | null } | null
    repo: { url: string; owner: string; name: string; ref: string; commit: string } | null
    upload: { name: string; sha256: string; bytes: number } | null
  }
  scope: { files: { path: string; nsloc: number; inScope: boolean; reason: string | null }[]; totalNsloc: number; inScopeFiles: number; excluded: { path: string; reason: string }[] }
  tools: Tool[]
  ai: { used: boolean; models: { analysis: string | null; summary: string | null }; chunks: number; chunksReviewed: number; capped: boolean; notReviewed: string[]; promptInjectionFlags: { file: string; line: number; excerpt: string }[] }
  summary: { text: string; counts: Counts; findings: number; dropped: number }
  findings: Finding[]
  dropped: { tool: string; detector: string | null; title: string; location: Location | null; reason: string }[]
  checklist: { id: string; area: string; item: string; result: 'pass' | 'fail' | 'warn' | 'not-checked'; note: string; locations: Location[] }[] | null
  limitations: string[]
  disclaimer: string
}

export interface ScanView {
  id: string
  status: JobStatus
  title: string
  input: ScanInput
  upload: { name: string; size?: number } | null
  free: boolean
  priceUsd: number
  payment: { invoiceId: string; status: 'open' | 'paid' | 'expired' | 'cancelled' | 'unknown'; usd: number; payUrl: string; expiresAt: string | null } | null
  /** pct 0–100 and the engine's step text. */
  progress: { pct: number; message: string } | null
  mode: ScanMode | null
  label: string | null
  /** The same target was already scanning: this is that scan. */
  duplicate: boolean
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
  /** The site's chain mark key (src/components/logos/registry.ts). */
  logo: string
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
  /** engineStatus(): the AI review configured, the static-tools worker reachable (and its tools). */
  engine: { installed: boolean; ai: boolean; worker: boolean; tools: string[]; queue: { running: string | null; queued: number } | null }
  checkout: { enabled: boolean }
  role: string
  canPublish: boolean
}

export interface PublicReport extends Report {
  url: string
  input: ScanInput
  upload: { name: string } | null
  publishedAt: string
  indexable: boolean
  counts: Counts
}

export interface PublicReportListItem {
  id: string
  title: string
  input: ScanInput
  upload: { name: string } | null
  completedAt: string | null
  publishedAt: string
  indexable: boolean
  counts: Counts | null
  mode: ScanMode | null
  label: string | null
  url: string
}

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
  { id: 'queued', label: 'Queued', text: 'Waiting for the scanner' },
  { id: 'fetching', label: 'Fetching', text: 'Reading the code or the verified source' },
  { id: 'analysing', label: 'Analysing', text: 'Static tools and the AI review' },
  { id: 'triaging', label: 'Triaging', text: 'Checking tool findings, ranking them' },
  { id: 'reporting', label: 'Reporting', text: 'Writing the report' },
  { id: 'done', label: 'Report', text: 'Findings, tools run and limits' },
]

export const STATUS_LABEL: Record<JobStatus, string> = {
  awaiting_payment: 'Awaiting payment',
  queued: 'Queued',
  fetching: 'Fetching',
  analysing: 'Analysing',
  triaging: 'Triaging',
  reporting: 'Reporting',
  done: 'Done',
  failed: 'Failed',
  cancelled: 'Cancelled',
  unknown: 'Unreadable',
}

export const KIND_LABEL: Record<InputKind, string> = { address: 'Deployed contract', github: 'Smart contract repo', upload: 'Upload', web2: 'Web2 repo' }

/** The engine's draft PoC status in plain words. */
export const POC_LABEL: Record<Poc['status'], string> = { 'draft-not-executed': 'Draft, not executed', 'executed-passed': 'Executed: the exploit worked', 'executed-failed': 'Executed: the exploit did not work' }

/** The chain's mark for a contract scan (engine chain keys; BNB Chain's mark is "bsc" on this site). */
export const chainLogoKey = (chain: string) => (chain === 'bnb' ? 'bsc' : chain)

export const isActive = (s: JobStatus) => s === 'queued' || s === 'fetching' || s === 'analysing' || s === 'triaging' || s === 'reporting'
export const isFinal = (s: JobStatus) => s === 'done' || s === 'failed' || s === 'cancelled'

/** "src/Vault.sol:42-44". */
export const locationText = (l: Location | null | undefined) => (l ? `${l.file}${l.line ? `:${l.line}${l.endLine && l.endLine !== l.line ? `-${l.endLine}` : ''}` : ''}` : '—')

/** The report's target as label/value rows. */
export function targetRows(t: Report['target']): [string, string][] {
  const rows: [string, string | null | undefined][] = [
    ['Contract', t.address ? `${t.contractName ? `${t.contractName} at ` : ''}${t.address}` : null],
    ['Chain', t.chainName ?? (t.chainId ? `chain ${t.chainId}` : null)],
    ['Source', t.type === 'address' ? (t.verified ? `verified (${t.sourceProvider ?? 'explorer'})` : 'not verified') : null],
    ['Compiler', t.compiler?.version ?? null],
    ['Repository', t.repo ? `${t.repo.owner}/${t.repo.name}` : null],
    ['Commit', t.repo?.commit ?? null],
    ['Upload', t.upload ? `${t.upload.name} (sha256 ${t.upload.sha256.slice(0, 16)}…)` : null],
  ]
  return rows.filter((r): r is [string, string] => !!r[1])
}

export const countsOf = (findings: Finding[]): Counts => Object.fromEntries(SEVERITIES.map((s) => [s, findings.filter((f) => f.severity === s).length])) as Counts

export const fmtWhen = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—')
