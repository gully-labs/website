// Gully Security: the scan report contract (schema 1.x). Parts 2 (app/public UI) and 3 (monitoring and the
// Gully Score) code against this file and schema.d.mts; keep it stable. Additive changes bump the minor
// version; a change that removes or renames a field bumps the major and needs both other parts updated.
//
// Honesty rules the schema enforces:
// - The product is an "AI Security Scan", never an audit (kind is fixed; validateReport rejects the word in
//   the title and label).
// - Every report names what was checked (target + scope), by which tools (ran / not run, with versions),
//   at which commit/address, and carries the point-in-time disclaimer verbatim.
// - AI output is never presented as verified: every finding has verifiedByHuman:false (a human reviewer
//   flips it outside this engine), and a PoC is "draft-not-executed" unless the worker ran it.

export const SCHEMA_VERSION = '1.0.0'
export const REPORT_KIND = 'ai-security-scan'
export const REPORT_TITLE = 'AI Security Scan'

export const SEVERITIES = ['critical', 'high', 'medium', 'low', 'info']
export const LIKELIHOODS = ['high', 'medium', 'low']
export const IMPACTS = ['high', 'medium', 'low', 'none']
export const CONFIDENCES = ['high', 'medium', 'low']
export const INPUT_KINDS = ['address', 'github', 'upload', 'web2']
export const MODES = ['static+ai', 'ai-only', 'static-only', 'bytecode-only', 'checklist']
export const TOOL_STATUSES = ['ran', 'failed', 'not-run', 'skipped']
export const POC_STATUSES = ['draft-not-executed', 'executed-passed', 'executed-failed']
export const TRIAGE_STATES = ['ai-triaged', 'ai-found', 'tool-untriaged', 'engine-note']
export const CHECK_RESULTS = ['pass', 'fail', 'warn', 'not-checked']
export const SCAN_STATUSES = ['queued', 'fetching', 'analysing', 'triaging', 'reporting', 'done', 'failed', 'cancelled']
export const TERMINAL_STATUSES = ['done', 'failed', 'cancelled']

/** Labels shown verbatim at the top of the report (part 2 renders them as the report's badge). */
export const MODE_LABELS = {
  'static+ai': 'AI Security Scan: static analysis + AI triage',
  'ai-only': 'AI review only — static tools unavailable',
  'static-only': 'Static tools only — AI triage unavailable',
  'bytecode-only': 'Source not verified — bytecode notes only',
  checklist: 'Checklist scan — web2 code review, not a penetration test',
}

export const DISCLAIMER =
  'This AI Security Scan is an automated, point-in-time review of the code named in the scope above, at the ' +
  'exact address or commit shown, using the tools listed as run. It is not an audit, a security review by ' +
  'human reviewers, a guarantee or an endorsement. Findings were produced and triaged by software and an AI ' +
  'model and have not been reproduced by a human; some may be false positives, and issues outside the scope, ' +
  'in tools marked as not run, in off-chain components, in deployment or configuration, or introduced after ' +
  'this point in time are not covered. Code changes after the scanned commit and upgrades of the scanned ' +
  'contract are not reflected. Do not rely on this report as the only basis for deploying, investing in or ' +
  'interacting with the code.'

/**
 * Severity from likelihood x impact (the public 5-level scale used by contest platforms and firms).
 * Impact 'none' is always Info.
 */
export function severityFrom(likelihood, impact) {
  if (impact === 'none') return 'info'
  const M = {
    high: { high: 'critical', medium: 'high', low: 'medium' },
    medium: { high: 'high', medium: 'medium', low: 'low' },
    low: { high: 'medium', medium: 'low', low: 'low' },
  }
  return M[impact]?.[likelihood] ?? 'info'
}

export const severityRank = (s) => {
  const i = SEVERITIES.indexOf(s)
  return i < 0 ? SEVERITIES.length : i
}
const CONF_RANK = { high: 0, medium: 1, low: 2 }

/** Severity first, then confidence, then file and line: the order findings are listed in. */
export function compareFindings(a, b) {
  return (
    severityRank(a.severity) - severityRank(b.severity) ||
    (CONF_RANK[a.confidence] ?? 3) - (CONF_RANK[b.confidence] ?? 3) ||
    String(a.locations?.[0]?.file ?? '').localeCompare(String(b.locations?.[0]?.file ?? '')) ||
    (a.locations?.[0]?.line ?? 0) - (b.locations?.[0]?.line ?? 0) ||
    String(a.title).localeCompare(String(b.title))
  )
}

/* ------------------------------------------------------------- JSON Schema --- */
// A JSON Schema (draft 2020-12 subset) of the report. validateReport() interprets exactly this subset:
// type (incl. arrays of types), enum, const, required, properties, additionalProperties:false, items,
// minimum, maxLength, pattern.

const S = (type, extra = {}) => ({ type, ...extra })
const str = (extra = {}) => S('string', extra)
const nstr = (extra = {}) => S(['string', 'null'], extra)
const int = (extra = {}) => S('integer', { minimum: 0, ...extra })
const nint = () => S(['integer', 'null'], { minimum: 0 })
const obj = (properties, required = Object.keys(properties)) => ({ type: 'object', properties, required, additionalProperties: false })
const arr = (items, extra = {}) => ({ type: 'array', items, ...extra })
const enm = (values) => ({ type: 'string', enum: values })
const ISO = { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}T' }

const location = obj({ file: str({ maxLength: 512 }), line: nint(), endLine: nint() })
const counts = obj(Object.fromEntries(SEVERITIES.map((s) => [s, int()])))

export const FINDING_SCHEMA = obj({
  id: str({ pattern: '^GS-\\d{3,}$' }),
  title: str({ maxLength: 200 }),
  severity: enm(SEVERITIES),
  likelihood: enm(LIKELIHOODS),
  impact: enm(IMPACTS),
  confidence: enm(CONFIDENCES),
  category: str({ maxLength: 80 }),
  triage: enm(TRIAGE_STATES),
  sources: arr(obj({ tool: str(), detector: nstr() })),
  locations: arr(location),
  description: str({ maxLength: 6000 }),
  explanation: str({ maxLength: 6000 }),
  recommendation: str({ maxLength: 6000 }),
  poc: {
    type: ['object', 'null'],
    properties: { framework: { const: 'foundry' }, status: enm(POC_STATUSES), code: str({ maxLength: 20000 }), note: str() },
    required: ['framework', 'status', 'code', 'note'],
    additionalProperties: false,
  },
  verifiedByHuman: { const: false },
  status: enm(['open']),
})

export const REPORT_JSON_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://gullylabs.xyz/schemas/security-scan-report-1.json',
  title: 'Gully Security AI Security Scan report',
  ...obj({
    schemaVersion: { const: SCHEMA_VERSION },
    kind: { const: REPORT_KIND },
    id: str({ pattern: '^scn_[A-Za-z0-9_-]{8,40}$' }),
    title: str({ maxLength: 200 }),
    mode: enm(MODES),
    label: str({ maxLength: 200 }),
    workspace: str({ maxLength: 200 }),
    createdAt: ISO,
    completedAt: ISO,
    engine: obj({ name: { const: 'gully-security' }, version: str() }),
    target: {
      type: 'object',
      properties: {
        type: enm(INPUT_KINDS),
        chainId: S(['integer', 'null']),
        chainName: nstr(),
        address: nstr({ pattern: '^0x[0-9a-f]{40}$' }),
        explorerUrl: nstr(),
        verified: S(['boolean', 'null']),
        sourceProvider: { type: ['string', 'null'], enum: ['etherscan', 'blockscout', 'sourcify', null] },
        contractName: nstr(),
        compiler: S(['object', 'null']),
        proxy: S(['object', 'null']),
        bytecodeSha256: nstr(),
        repo: S(['object', 'null']),
        upload: S(['object', 'null']),
      },
      required: ['type', 'chainId', 'address', 'verified', 'repo', 'upload'],
      additionalProperties: false,
    },
    scope: obj({
      files: arr(obj({ path: str({ maxLength: 512 }), sha256: str({ pattern: '^[0-9a-f]{64}$' }), lines: int(), nsloc: int(), language: str(), inScope: S('boolean'), reason: nstr() })),
      totalNsloc: int(),
      inScopeFiles: int(),
      excluded: arr(obj({ path: str(), reason: str() })),
    }),
    tools: arr(obj({ name: str(), version: nstr(), status: enm(TOOL_STATUSES), reason: nstr(), durationMs: nint(), findings: int() })),
    ai: obj({
      used: S('boolean'),
      models: obj({ analysis: nstr(), summary: nstr() }),
      chunks: int(),
      chunksReviewed: int(),
      inputTokens: int(),
      outputTokens: int(),
      costUsd: S('number', { minimum: 0 }),
      costCapUsd: S('number', { minimum: 0 }),
      capped: S('boolean'),
      notReviewed: arr(str()),
      promptInjectionFlags: arr(obj({ file: str(), line: int(), excerpt: str({ maxLength: 240 }) })),
    }),
    summary: obj({ text: str({ maxLength: 4000 }), counts, findings: int(), dropped: int() }),
    findings: arr(FINDING_SCHEMA),
    dropped: arr(obj({ tool: str(), detector: nstr(), title: str(), location: S(['object', 'null']), reason: str({ maxLength: 1000 }) })),
    checklist: S(['array', 'null'], { items: obj({ id: str(), area: str(), item: str(), result: enm(CHECK_RESULTS), note: str({ maxLength: 2000 }), locations: arr(location) }) }),
    dependencies: S(['object', 'null']),
    limitations: arr(str()),
    disclaimer: { const: DISCLAIMER },
  }),
}

/* ---------------------------------------------------------------- validator --- */

const typeOf = (v) => (v === null ? 'null' : Array.isArray(v) ? 'array' : Number.isInteger(v) ? 'integer' : typeof v)
const typeOk = (v, t) => {
  const actual = typeOf(v)
  const list = Array.isArray(t) ? t : [t]
  return list.includes(actual) || (actual === 'integer' && list.includes('number'))
}

function check(v, s, p, errors) {
  if (errors.length > 50) return
  if ('const' in s && v !== s.const) return void errors.push(`${p}: must be ${JSON.stringify(s.const)}`)
  if (s.type && !typeOk(v, s.type)) return void errors.push(`${p}: expected ${[].concat(s.type).join('|')}, got ${typeOf(v)}`)
  if (s.enum && !s.enum.includes(v)) return void errors.push(`${p}: ${JSON.stringify(v)} not in ${s.enum.join(',')}`)
  if (v === null) return
  if (typeof v === 'string') {
    if (s.maxLength && v.length > s.maxLength) errors.push(`${p}: longer than ${s.maxLength}`)
    if (s.pattern && !new RegExp(s.pattern).test(v)) errors.push(`${p}: does not match ${s.pattern}`)
  }
  if (typeof v === 'number' && s.minimum !== undefined && v < s.minimum) errors.push(`${p}: below ${s.minimum}`)
  if (Array.isArray(v) && s.items) v.forEach((x, i) => check(x, s.items, `${p}[${i}]`, errors))
  if (typeOf(v) === 'object' && s.properties) {
    for (const k of s.required ?? []) if (!(k in v)) errors.push(`${p}.${k}: required`)
    for (const [k, x] of Object.entries(v)) {
      if (s.properties[k]) check(x, s.properties[k], `${p}.${k}`, errors)
      else if (s.additionalProperties === false) errors.push(`${p}.${k}: not allowed`)
    }
  }
}

/** Validates a report against REPORT_JSON_SCHEMA plus the honesty rules. Returns { ok, errors }. */
export function validateReport(report) {
  const errors = []
  check(report, REPORT_JSON_SCHEMA, '$', errors)
  if (errors.length) return { ok: false, errors }
  if (/\baudit(ed|s|or|ors)?\b/i.test(`${report.title} ${report.label}`)) errors.push('$.title/label: must not call the scan an audit')
  if (report.label !== MODE_LABELS[report.mode]) errors.push('$.label: must be the label of its mode')
  const sum = Object.values(report.summary.counts).reduce((a, b) => a + b, 0)
  if (sum !== report.findings.length || report.summary.findings !== report.findings.length) errors.push('$.summary.counts: do not add up to the findings')
  for (let i = 1; i < report.findings.length; i++) if (compareFindings(report.findings[i - 1], report.findings[i]) > 0) errors.push(`$.findings[${i}]: not sorted by severity`)
  const pocRan = report.tools.some((t) => t.name === 'forge-poc' && t.status === 'ran')
  report.findings.forEach((f, i) => {
    if (f.severity !== severityFrom(f.likelihood, f.impact)) errors.push(`$.findings[${i}].severity: does not match likelihood x impact`)
    if (f.poc && f.poc.status !== 'draft-not-executed' && !pocRan) errors.push(`$.findings[${i}].poc.status: executed, but the worker ran no PoC`)
  })
  if (!report.ai.used && report.findings.some((f) => f.triage === 'ai-triaged' || f.triage === 'ai-found')) errors.push('$.findings: AI triage states without AI')
  if (report.target.type === 'github' && !/^[0-9a-f]{40}$/.test(report.target.repo?.commit ?? '')) errors.push('$.target.repo.commit: a full 40-hex commit is required')
  if (report.target.type === 'address' && !report.target.address) errors.push('$.target.address: required for an address scan')
  return { ok: errors.length === 0, errors }
}
