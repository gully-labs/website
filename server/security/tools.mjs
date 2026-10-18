// Static tools: the HTTP client for the gully-scanner worker (ops/scanner) and the parsers that turn each
// tool's raw JSON into one finding shape. The worker only runs tools and returns their raw output; all
// interpretation happens here, so it is testable against recorded fixtures.

import { config } from './config.mjs'

export const STATIC_TOOLS = ['slither', 'aderyn', 'forge-build', 'semgrep']

let workerImpl = null
/** Test hook: replace the worker transport ({ path, body }) => json, or null to restore HTTP. */
export function setWorkerForTest(fn) {
  workerImpl = fn
}

async function call(path, body, timeoutMs) {
  if (workerImpl) return workerImpl({ path, body })
  const base = config.scannerUrl()
  const token = config.scannerToken()
  if (!base || !token) throw Object.assign(new Error('scanner worker not configured (SCANNER_URL / SCANNER_TOKEN)'), { code: 'worker-absent' })
  let r
  try {
    r = await fetch(`${base.replace(/\/+$/, '')}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'content-type': 'application/json', 'x-scanner-token': token },
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: 'manual',
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (e) {
    throw Object.assign(new Error(e?.name === 'TimeoutError' ? 'scanner worker timed out' : 'scanner worker not reachable'), { code: 'worker-absent' })
  }
  const j = await r.json().catch(() => null)
  if (!r.ok || !j) throw Object.assign(new Error(`scanner worker answered HTTP ${r.status}`), { code: r.status === 401 ? 'worker-auth' : 'worker-error' })
  return j
}

/** { ok, tools: { name: version|null }, solc: [...] } or { ok:false, reason }. Never throws. */
export async function workerHealth() {
  try {
    const j = await call('/health', undefined, 5_000)
    return { ok: !!j.ok, tools: j.tools ?? {}, solc: Array.isArray(j.solc) ? j.solc : [], reason: null }
  } catch (e) {
    return { ok: false, tools: {}, solc: [], reason: e.message }
  }
}

/** Runs the static tools on the worker. Returns the worker's per-tool results (raw output included). */
export const runStaticTools = (body) => call('/analyze', body, config.scannerTimeoutMs())
/** Compiles and runs one draft Foundry PoC on the worker (only when SECURITY_RUN_POC=1). */
export const runPoc = (body) => call('/poc', body, config.scannerTimeoutMs())

/* ----------------------------------------------------------------- parsers --- */

const SEV = { high: 'high', medium: 'medium', low: 'low', informational: 'info', optimization: 'info', info: 'info', error: 'high', warning: 'medium', critical: 'high' }
const sev = (s) => SEV[String(s ?? '').toLowerCase()] ?? 'info'
const clean = (s, n = 2000) => String(s ?? '').replace(/\s+\n/g, '\n').trim().slice(0, n)
const relPath = (p) => String(p ?? '').replace(/\\/g, '/').replace(/^(\.\/)+/, '').replace(/^\/?(tmp|work)\/[^/]+\/src-root\//, '')

/** Slither --json output -> findings. */
export function parseSlither(json) {
  const dets = json?.results?.detectors
  if (!Array.isArray(dets)) return []
  return dets.map((d) => {
    const locs = []
    for (const e of Array.isArray(d.elements) ? d.elements : []) {
      const sm = e?.source_mapping
      if (!sm) continue
      const lines = Array.isArray(sm.lines) ? sm.lines.filter(Number.isInteger) : []
      const file = relPath(sm.filename_relative ?? sm.filename_short ?? sm.filename_absolute)
      if (!file) continue
      const loc = { file, line: lines.length ? Math.min(...lines) : null, endLine: lines.length ? Math.max(...lines) : null }
      if (!locs.some((l) => l.file === loc.file && l.line === loc.line)) locs.push(loc)
      if (locs.length >= 5) break
    }
    return { tool: 'slither', detector: String(d.check ?? 'unknown'), title: String(d.check ?? 'Slither finding').replace(/-/g, ' '), toolSeverity: sev(d.impact), toolConfidence: String(d.confidence ?? '').toLowerCase() || null, description: clean(d.description), locations: locs }
  })
}

/** Aderyn report.json -> findings (one per issue, instances as locations). */
export function parseAderyn(json) {
  const out = []
  for (const [bucket, s] of [['high_issues', 'high'], ['medium_issues', 'medium'], ['low_issues', 'low'], ['nc_issues', 'info']]) {
    for (const i of Array.isArray(json?.[bucket]?.issues) ? json[bucket].issues : []) {
      const locs = (Array.isArray(i.instances) ? i.instances : []).slice(0, 8).map((x) => ({ file: relPath(x.contract_path), line: Number.isInteger(x.line_no) ? x.line_no : null, endLine: Number.isInteger(x.line_no) ? x.line_no : null }))
      out.push({ tool: 'aderyn', detector: String(i.detector_name ?? i.title ?? 'unknown'), title: clean(i.title, 200), toolSeverity: s, toolConfidence: null, description: clean(i.description), locations: locs })
    }
  }
  return out
}

/** Semgrep --json output -> findings. */
export function parseSemgrep(json) {
  return (Array.isArray(json?.results) ? json.results : []).slice(0, 500).map((r) => ({
    tool: 'semgrep',
    detector: String(r.check_id ?? 'unknown').split('.').slice(-1)[0],
    title: String(r.check_id ?? 'Semgrep finding').split('.').slice(-1)[0].replace(/[-_]/g, ' '),
    toolSeverity: sev(r.extra?.metadata?.impact ?? r.extra?.severity),
    toolConfidence: String(r.extra?.metadata?.confidence ?? '').toLowerCase() || null,
    description: clean(r.extra?.message),
    locations: [{ file: relPath(r.path), line: r.start?.line ?? null, endLine: r.end?.line ?? null }],
  }))
}

export const PARSERS = { slither: parseSlither, aderyn: parseAderyn, semgrep: parseSemgrep }

/** Removes exact duplicates (same tool, detector and first location) and numbers the rest T1, T2 … */
export function numberToolFindings(list) {
  const seen = new Set()
  const out = []
  for (const f of list) {
    const k = `${f.tool}|${f.detector}|${f.locations[0]?.file}|${f.locations[0]?.line}`
    if (seen.has(k)) continue
    seen.add(k)
    out.push({ ...f, ref: `T${out.length + 1}` })
  }
  return out
}

/** Likelihood/impact for a tool finding nobody triaged: impact from the tool, likelihood kept low/medium. */
export function untriagedRating(f) {
  const impact = f.toolSeverity === 'info' ? 'none' : f.toolSeverity
  const likelihood = f.toolConfidence === 'high' ? 'medium' : 'low'
  return { impact, likelihood, confidence: 'low' }
}
