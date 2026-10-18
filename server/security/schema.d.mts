// Types for server/security/schema.mjs: the AI Security Scan report (schema 1.x) and the scan record.
// The frontend (part 2) and monitoring / Gully Score (part 3) import these. Keep in step with schema.mjs.

export declare const SCHEMA_VERSION: '1.0.0'
export declare const REPORT_KIND: 'ai-security-scan'
export declare const REPORT_TITLE: 'AI Security Scan'

export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info'
export type Likelihood = 'high' | 'medium' | 'low'
export type Impact = 'high' | 'medium' | 'low' | 'none'
export type Confidence = 'high' | 'medium' | 'low'
export type InputKind = 'address' | 'github' | 'upload' | 'web2'
export type ScanMode = 'static+ai' | 'ai-only' | 'static-only' | 'bytecode-only' | 'checklist'
export type ToolStatus = 'ran' | 'failed' | 'not-run' | 'skipped'
export type PocStatus = 'draft-not-executed' | 'executed-passed' | 'executed-failed'
/** ai-triaged: a tool finding the AI confirmed; ai-found: raised by the AI review; tool-untriaged: a tool
    finding the AI did not get to (cost cap / no AI); engine-note: a fact the engine itself established. */
export type TriageState = 'ai-triaged' | 'ai-found' | 'tool-untriaged' | 'engine-note'
export type CheckResult = 'pass' | 'fail' | 'warn' | 'not-checked'
export type ScanStatus = 'queued' | 'fetching' | 'analysing' | 'triaging' | 'reporting' | 'done' | 'failed' | 'cancelled'

export declare const SEVERITIES: Severity[]
export declare const LIKELIHOODS: Likelihood[]
export declare const IMPACTS: Impact[]
export declare const CONFIDENCES: Confidence[]
export declare const INPUT_KINDS: InputKind[]
export declare const MODES: ScanMode[]
export declare const SCAN_STATUSES: ScanStatus[]
export declare const TERMINAL_STATUSES: ScanStatus[]
export declare const MODE_LABELS: Record<ScanMode, string>
export declare const DISCLAIMER: string
export declare const REPORT_JSON_SCHEMA: Record<string, unknown>
export declare function severityFrom(likelihood: Likelihood, impact: Impact): Severity
export declare function severityRank(s: Severity): number
export declare function compareFindings(a: Finding, b: Finding): number
export declare function validateReport(report: unknown): { ok: boolean; errors: string[] }

export interface Location {
  /** Path relative to the scanned root, forward slashes. */
  file: string
  line: number | null
  endLine: number | null
}

export interface Poc {
  framework: 'foundry'
  /** "draft-not-executed" unless the scanner worker compiled and ran it. */
  status: PocStatus
  code: string
  note: string
}

export interface Finding {
  /** GS-001, GS-002 … in report order. */
  id: string
  title: string
  /** Always severityFrom(likelihood, impact). */
  severity: Severity
  likelihood: Likelihood
  impact: Impact
  confidence: Confidence
  category: string
  triage: TriageState
  sources: { tool: string; detector: string | null }[]
  locations: Location[]
  /** Technical description. */
  description: string
  /** Plain-English explanation for non-specialists. */
  explanation: string
  recommendation: string
  poc: Poc | null
  /** Always false from the engine: AI never signs off a finding. */
  verifiedByHuman: false
  status: 'open'
}

export interface ToolRun {
  /** slither | aderyn | forge-build | forge-poc | semgrep | npm-audit | ai-review | bytecode-notes */
  name: string
  version: string | null
  status: ToolStatus
  /** Why it was not run / failed / skipped (null when it ran). */
  reason: string | null
  durationMs: number | null
  findings: number
}

export interface ScopeFile {
  path: string
  sha256: string
  lines: number
  /** Normalised source lines: no blank lines, no comment-only lines. */
  nsloc: number
  language: string
  inScope: boolean
  reason: string | null
}

export interface Target {
  type: InputKind
  chainId: number | null
  chainName?: string | null
  /** Lower-case 0x address for address scans. */
  address: string | null
  explorerUrl?: string | null
  /** null when not applicable (repo/upload). */
  verified: boolean | null
  sourceProvider?: 'etherscan' | 'blockscout' | 'sourcify' | null
  contractName?: string | null
  compiler?: { version: string | null; optimizer: boolean | null; runs: number | null; evmVersion: string | null } | null
  proxy?: { isProxy: boolean; implementation: string | null; kind: string | null } | null
  bytecodeSha256?: string | null
  /** commit is always the full 40-hex SHA the tarball was fetched at. */
  repo: { url: string; owner: string; name: string; ref: string; commit: string } | null
  upload: { name: string; sha256: string; bytes: number } | null
}

export interface ChecklistItem {
  id: string
  area: string
  item: string
  result: CheckResult
  note: string
  locations: Location[]
}

export interface DependencyAudit {
  tool: 'npm audit'
  ran: boolean
  reason: string | null
  counts: Record<'critical' | 'high' | 'moderate' | 'low' | 'info', number> | null
  advisories: { name: string; severity: string; title: string; url: string | null; range: string | null; fixAvailable: boolean }[]
}

export interface ScanReport {
  schemaVersion: '1.0.0'
  kind: 'ai-security-scan'
  id: string
  title: string
  mode: ScanMode
  /** MODE_LABELS[mode], shown as the report badge. */
  label: string
  workspace: string
  createdAt: string
  completedAt: string
  engine: { name: 'gully-security'; version: string }
  target: Target
  scope: { files: ScopeFile[]; totalNsloc: number; inScopeFiles: number; excluded: { path: string; reason: string }[] }
  tools: ToolRun[]
  ai: {
    used: boolean
    models: { analysis: string | null; summary: string | null }
    chunks: number
    chunksReviewed: number
    inputTokens: number
    outputTokens: number
    costUsd: number
    costCapUsd: number
    capped: boolean
    /** Files (or file:line ranges) the AI did not review, e.g. because of the cost cap. */
    notReviewed: string[]
    /** Comments that looked like instructions to an AI reviewer; removed before review. */
    promptInjectionFlags: { file: string; line: number; excerpt: string }[]
  }
  summary: { text: string; counts: Record<Severity, number>; findings: number; dropped: number }
  findings: Finding[]
  /** Tool findings the AI dismissed as false positives, with the stated reason. */
  dropped: { tool: string; detector: string | null; title: string; location: Location | null; reason: string }[]
  /** Checklist scans only (mode "checklist"); null otherwise. */
  checklist: ChecklistItem[] | null
  dependencies: DependencyAudit | null
  limitations: string[]
  disclaimer: string
}

/** What getScan / listScans return (never includes the uploaded bytes or fetched source). */
export interface ScanRecord {
  id: string
  workspace: string
  kind: InputKind
  /** Normalised input: chain + address, repo URL + ref, upload name + sha256. */
  input: Record<string, unknown>
  status: ScanStatus
  /** 0..1 */
  progress: number
  message: string
  createdAt: string
  updatedAt: string
  startedAt: string | null
  finishedAt: string | null
  attempts: number
  error: { code: string; message: string } | null
  cost: { usd: number; inputTokens: number; outputTokens: number }
  mode: ScanMode | null
  label: string | null
  counts: Record<Severity, number> | null
  reportReady: boolean
}

export interface ScanEvent {
  id: string
  workspace: string
  status: ScanStatus
  progress: number
  message: string
}
