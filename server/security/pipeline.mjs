// One scan, start to finish: fetch -> static tools (worker) -> AI triage -> report. Each stage writes a
// checkpoint into the scan's folder (sources.json, static.json, ai.json) so a scan interrupted by a restart
// resumes from the last finished stage instead of paying for it twice.

import fs from 'node:fs'
import path from 'node:path'
import { config } from './config.mjs'
import { CHAINS } from './chains.mjs'
import { aiConfigured } from './claude.mjs'
import { bytecodeNotes, notesToFindings } from './bytecode.mjs'
import { fetchAddress, fetchGithubFiles, resolveGithub, uploadFiles } from './fetchers.mjs'
import { buildReport, renderReportHtml, targetText } from './report.mjs'
import { MODE_LABELS, validateReport } from './schema.mjs'
import { languageOf, nsloc, prepareForModel, scopeOf, sha256 } from './source.mjs'
import { numberToolFindings, PARSERS, runPoc, runStaticTools, workerHealth } from './tools.mjs'
import { chunkFiles, finalizeFindings, makeMeter, mergeFindings, reviewChunks, summarize } from './triage.mjs'
import { CHECKLIST, dependencyAudit, dependencyFindings, mergeChecklist, prioritiseWeb2 } from './web2.mjs'

export class ScanError extends Error {
  constructor(code, message) {
    super(message)
    this.code = code
  }
}

const readJson = (f) => {
  try {
    return JSON.parse(fs.readFileSync(f, 'utf8'))
  } catch {
    return null
  }
}
const writeJson = (f, v) => {
  fs.writeFileSync(f + '.tmp', JSON.stringify(v))
  fs.renameSync(f + '.tmp', f)
}

const CONTRACT_TOOLS = ['slither', 'aderyn', 'forge-build']

/* ------------------------------------------------------------------ fetch --- */

async function stageFetch(scan, dir) {
  const cp = path.join(dir, 'sources.json')
  const done = readJson(cp)
  if (done) return done
  const inp = scan.input
  const kind = scan.kind
  let target
  let files = []
  let meta = {}
  if (kind === 'address') {
    const a = await fetchAddress(inp.chainId, inp.address)
    const chain = CHAINS[inp.chainId]
    target = {
      type: 'address',
      chainId: inp.chainId,
      chainName: chain.name,
      address: inp.address,
      explorerUrl: `${chain.explorer}/address/${inp.address}`,
      verified: a.verified,
      sourceProvider: a.provider,
      sourceMatch: a.sourceMatch,
      sourceUrl: a.sourceUrl,
      contractName: a.contractName,
      compiler: a.compiler,
      proxy: a.proxy,
      bytecodeSha256: a.bytecode && a.bytecode !== '0x' ? sha256(Buffer.from(a.bytecode.replace(/^0x/, ''), 'hex')) : null,
      repo: null,
      upload: null,
    }
    files = a.files.filter((f) => /\.sol$/i.test(f.path) || !/\./.test(f.path.split('/').pop()))
    meta = { bytecode: a.bytecode, remappings: a.remappings, attempts: a.attempts }
  } else if (kind === 'github' || (kind === 'web2' && inp.source === 'github')) {
    const repo = await resolveGithub(inp.repo)
    target = { type: kind, chainId: null, address: null, verified: null, repo: { url: repo.url, owner: repo.owner, name: repo.name, ref: repo.ref, commit: repo.commit }, upload: null }
    files = await fetchGithubFiles(repo, kind)
  } else {
    const data = fs.readFileSync(path.join(dir, 'input.bin'))
    target = { type: kind, chainId: null, address: null, verified: null, repo: null, upload: { name: inp.upload.name, sha256: inp.upload.sha256, bytes: inp.upload.bytes } }
    files = uploadFiles(data, inp.upload.archive, inp.upload.name, kind)
  }
  const out = { target, files, meta }
  writeJson(cp, out)
  return out
}

/** Scope table + the in-scope files. */
function buildScope(files, kind, target) {
  const mode = kind === 'web2' ? 'web2' : 'contracts'
  const rows = []
  const excluded = []
  for (const f of files) {
    if (/(^|\/)\.env(\.[\w-]+)?$/.test(f.path)) {
      excluded.push({ path: f.path, reason: 'environment file: contents never read or sent to the AI' })
      continue
    }
    const s = scopeOf(f.path, mode)
    const lang = languageOf(f.path)
    rows.push({ path: f.path, sha256: sha256(f.content), lines: f.content.split('\n').length, nsloc: lang === 'solidity' || lang === 'javascript' || lang === 'typescript' ? nsloc(f.content) : 0, language: lang, inScope: s.inScope, reason: s.reason })
  }
  // An explorer upload whose only paths look like dependencies: keep the file declaring the contract.
  if (mode === 'contracts' && !rows.some((r) => r.inScope) && target.contractName) {
    const re = new RegExp(`\\b(contract|library)\\s+${target.contractName.replace(/[^\w]/g, '')}\\b`)
    const main = files.find((f) => re.test(f.content))
    const row = main && rows.find((r) => r.path === main.path)
    if (row) Object.assign(row, { inScope: true, reason: null })
  }
  rows.sort((a, b) => Number(b.inScope) - Number(a.inScope) || a.path.localeCompare(b.path))
  const inScope = rows.filter((r) => r.inScope)
  return { files: rows, totalNsloc: inScope.reduce((a, r) => a + r.nsloc, 0), inScopeFiles: inScope.length, excluded }
}

const solcFrom = (compiler, files) => {
  const v = /(\d+\.\d+\.\d+)/.exec(compiler?.version ?? '')
  if (v) return v[1]
  const pr = files.map((f) => /pragma\s+solidity\s+([^;]+);/.exec(f.content)?.[1]).filter(Boolean)
  const vs = pr.flatMap((p) => [...p.matchAll(/(\d+)\.(\d+)\.(\d+)/g)].map((m) => m.slice(1).map(Number)))
  vs.sort((a, b) => b[0] - a[0] || b[1] - a[1] || b[2] - a[2])
  return vs[0] ? vs[0].join('.') : null
}

/* ----------------------------------------------------------------- static --- */

async function stageStatic(scan, dir, src, scope, health) {
  const cp = path.join(dir, 'static.json')
  const done = readJson(cp)
  if (done) return done
  const web2 = scan.kind === 'web2'
  const expected = web2 ? ['semgrep'] : [...CONTRACT_TOOLS, 'semgrep']
  const installed = (n) => !!health.tools?.[n === 'forge-build' ? 'forge' : n]
  const want = expected.filter(installed)
  const tools = []
  const toolFindings = []
  let buildOk = false
  if (!health.ok) {
    for (const n of expected) tools.push({ name: n, version: null, status: 'not-run', reason: `static tools unavailable: ${health.reason ?? 'scanner worker not reachable'}`, durationMs: null, findings: 0 })
  } else {
    let res = null
    let err = null
    if (want.length) {
      try {
        res = await runStaticTools({
          scanId: scan.id,
          mode: web2 ? 'web2' : 'solidity',
          files: src.files.filter((f) => !/(^|\/)\.env(\.[\w-]+)?$/.test(f.path)).map((f) => ({ path: f.path, content: f.content })),
          inScope: scope.files.filter((f) => f.inScope).map((f) => f.path),
          solcVersion: web2 ? null : solcFrom(src.target.compiler, src.files),
          remappings: src.meta?.remappings ?? [],
          tools: want,
        })
      } catch (e) {
        err = e.message
      }
    }
    for (const n of expected) {
      const r = res?.tools?.[n]
      if (!want.includes(n)) tools.push({ name: n, version: null, status: 'not-run', reason: 'not installed in the scanner worker', durationMs: null, findings: 0 })
      else if (!r) tools.push({ name: n, version: health.tools?.[n] ?? null, status: 'failed', reason: err ?? 'no result from the worker', durationMs: null, findings: 0 })
      else {
        let parsed = []
        if (r.status === 'ran' && PARSERS[n]) {
          try {
            parsed = PARSERS[n](r.output)
          } catch {
            parsed = []
          }
        }
        if (n === 'forge-build' && r.status === 'ran') buildOk = true
        toolFindings.push(...parsed)
        tools.push({ name: n, version: r.version ?? health.tools?.[n] ?? null, status: r.status, reason: r.reason ?? null, durationMs: Number.isInteger(r.durationMs) ? r.durationMs : null, findings: parsed.length })
      }
    }
  }
  const inScope = new Set(scope.files.filter((f) => f.inScope).map((f) => f.path))
  // Keep tool findings with at least one in-scope location (or none at all); dependency noise is dropped.
  const relevant = toolFindings.filter((f) => !f.locations.length || f.locations.some((l) => inScope.has(l.file)))
  const out = { tools, toolFindings: numberToolFindings(relevant), buildOk, workerRan: tools.some((t) => t.status === 'ran') }
  writeJson(cp, out)
  return out
}

/* --------------------------------------------------------------------- AI --- */

async function stageAi(scan, dir, src, scope, stat, ctx) {
  const cp = path.join(dir, 'ai.json')
  const done = readJson(cp)
  if (done) return done
  const web2 = scan.kind === 'web2'
  const inScope = new Set(scope.files.filter((f) => f.inScope).map((f) => f.path))
  const flags = []
  const secrets = []
  let prepared = []
  for (const f of src.files) {
    if (!inScope.has(f.path)) continue
    const p = prepareForModel(f.content)
    p.flags.forEach((x) => flags.push({ file: f.path, line: x.line, excerpt: x.excerpt }))
    p.secrets.forEach((x) => secrets.push({ file: f.path, ...x }))
    prepared.push({ path: f.path, text: p.text })
  }
  if (web2) prepared = prioritiseWeb2(prepared)
  const meter = makeMeter({ capUsd: ctx.limits?.maxCostUsd ?? config.maxCostUsd() })
  const useAi = aiConfigured()
  const chunks = chunkFiles(prepared)
  let review = { raw: [], reviewed: [], notReviewed: [], refused: 0 }
  if (useAi && chunks.length) {
    const contextNote = src.target.type === 'address' ? `Deployed contract ${src.target.contractName ?? ''} on ${src.target.chainName}; compiler ${src.target.compiler?.version ?? 'unknown'}.` : `Repository files; in-scope paths only.`
    review = await reviewChunks({ chunks, toolFindings: stat.toolFindings, staticRan: stat.workerRan, mode: web2 ? 'web2' : 'contracts', checklist: CHECKLIST.filter((c) => c.id !== 'C12'), meter, contextNote, isCancelled: ctx.isCancelled, onProgress: (i, n) => ctx.progress(0.45 + 0.4 * (i / n), `AI review: chunk ${i + 1} of ${n}`) })
  } else if (chunks.length) {
    review.notReviewed = chunks.flat().map((p) => `${p.path}:${p.from}-${p.to}`)
  }
  const reviewedRefs = new Set()
  for (const r of review.raw) r.refs.forEach((x) => reviewedRefs.add(x))
  const knownFiles = new Set(src.files.map((f) => f.path))
  const merged = mergeFindings({ raw: review.raw, toolFindings: stat.toolFindings, reviewedRefs, knownFiles, pocAllowed: !web2 })
  const checklist = web2 ? mergeChecklist(review.raw.flatMap((r) => r.checklist), knownFiles) : null
  const out = {
    used: useAi && review.raw.length + review.refused > 0,
    findings: merged.findings,
    dropped: merged.dropped,
    checklist,
    flags,
    secrets,
    chunks: chunks.length,
    chunksReviewed: review.reviewed.length,
    notReviewed: review.notReviewed,
    meter: { usd: meter.usd, input: meter.input, output: meter.output, capped: meter.capped, capUsd: meter.capUsd },
  }
  writeJson(cp, out)
  return out
}

/* --------------------------------------------------------------- pipeline --- */

/**
 * Runs a scan. ctx: { progress(fraction, message), isCancelled(), limits }. Returns the report.
 * Throws ScanError / FetchError with a code on failure.
 */
export async function runPipeline(scan, dir, ctx) {
  const check = () => {
    if (ctx.isCancelled()) throw new ScanError('cancelled', 'cancelled')
  }
  ctx.progress(0.05, 'Fetching source', 'fetching')
  const src = await stageFetch(scan, dir)
  check()
  const limitations = ['Automated scan: business logic, economic and cross-protocol attacks need manual review by people.']
  for (const a of src.meta?.attempts ?? []) if (/^error/.test(a.outcome)) limitations.push(`${a.provider}: ${a.outcome}`)

  /* Unverified contract: bytecode notes only. */
  if (src.target.type === 'address' && !src.target.verified) {
    ctx.progress(0.6, 'Source not verified: reading bytecode', 'analysing')
    const notes = bytecodeNotes(src.meta?.bytecode ?? '')
    const findings = finalizeFindings(notesToFindings(notes, { proxyImplementation: src.target.proxy?.implementation }).map((f) => ({ ...f, _refs: [] })))
    const tools = [
      { name: 'bytecode-notes', version: '1', status: 'ran', reason: null, durationMs: 0, findings: findings.length },
      ...[...CONTRACT_TOOLS, 'ai-review'].map((n) => ({ name: n, version: null, status: 'not-run', reason: 'source not verified', durationMs: null, findings: 0 })),
    ]
    if (notes.solc) limitations.push(`Metadata says it was compiled with solc ${notes.solc}.`)
    limitations.push('Without verified source, only bytecode-level observations are possible; the logic was not reviewed.')
    ctx.progress(0.9, 'Writing report', 'reporting')
    const summary = await summarize({ findings, label: MODE_LABELS['bytecode-only'], targetText: targetText(src.target), meter: makeMeter(), useAi: false })
    return finish(scan, dir, {
      mode: 'bytecode-only',
      target: src.target,
      scope: { files: [], totalNsloc: 0, inScopeFiles: 0, excluded: [] },
      tools,
      ai: aiBlock(null, null),
      summaryText: summary.text,
      findings,
      dropped: [],
      limitations,
    })
  }

  const scope = buildScope(src.files, scan.kind, src.target)
  if (!scope.inScopeFiles) throw new ScanError('nothing-to-scan', scan.kind === 'web2' ? 'no JavaScript or TypeScript source files were found' : 'no Solidity source files were found in scope')
  const cap = ctx.limits?.maxNsloc ?? config.maxScopeNsloc()
  if (scope.totalNsloc > cap) throw new ScanError('scope-too-large', `${scope.totalNsloc} nSLOC in scope is more than this plan's ${cap}; scan a smaller set of contracts`)
  check()

  ctx.progress(0.2, 'Running static analysis', 'analysing')
  const health = await workerHealth()
  const stat = await stageStatic(scan, dir, src, scope, health)
  let dep = null
  if (scan.kind === 'web2') {
    dep = await dependencyAudit(src.files)
    stat.tools.unshift(dep.tool)
  }
  check()
  if (!aiConfigured() && !stat.workerRan && scan.kind !== 'web2') throw new ScanError('engine-unavailable', 'neither the static-analysis worker nor the AI is available; try again later')

  ctx.progress(0.45, 'AI triage', 'triaging')
  const ai = await stageAi(scan, dir, src, scope, stat, ctx)
  check()

  ctx.progress(0.88, 'Writing report', 'reporting')
  const extra = []
  for (const f of ai.flags) extra.push({ title: 'Comment addressed to AI reviewers', likelihood: 'medium', impact: 'low', confidence: 'high', category: 'prompt-injection', triage: 'engine-note', sources: [{ tool: 'injection-guard', detector: null }], locations: [{ file: f.file, line: f.line, endLine: f.line }], description: `A comment reads like an instruction to an automated reviewer: "${f.excerpt}". It was removed before the AI review.`, explanation: 'Someone wrote a comment that tries to steer AI or automated security tools. Legitimate projects rarely do this; treat the surrounding code with extra suspicion.', recommendation: 'Remove the comment and have a person review the code around it.', poc: null, _refs: [] })
  const bySecret = new Map()
  for (const s of ai.secrets) bySecret.set(`${s.file}:${s.line}`, s)
  for (const s of bySecret.values()) extra.push({ title: `Possible hard-coded secret (${s.kind})`, likelihood: 'medium', impact: 'high', confidence: 'medium', category: 'secrets', triage: 'engine-note', sources: [{ tool: 'secret-scan', detector: s.kind }], locations: [{ file: s.file, line: s.line, endLine: s.line }], description: `A value matching the pattern of a ${s.kind} is in the source. It was redacted and not sent to the AI.`, explanation: 'If this is a real credential, anyone who can read the code can use it.', recommendation: 'Revoke and rotate the credential, remove it from the code and git history, and load it from the environment or a secret store.', poc: null, _refs: [] })
  const envFiles = scope.excluded.filter((e) => /\.env/.test(e.path) && !/\.(example|sample|template)$/.test(e.path))
  if (envFiles.length) extra.push({ title: 'Environment file committed to the repository', likelihood: 'medium', impact: 'medium', confidence: 'medium', category: 'secrets', triage: 'engine-note', sources: [{ tool: 'secret-scan', detector: 'env-file' }], locations: envFiles.map((e) => ({ file: e.path, line: null, endLine: null })), description: `${envFiles.map((e) => e.path).join(', ')} is present in the scanned tree. Its contents were not read.`, explanation: 'Environment files usually hold passwords and API keys; committing them exposes those secrets.', recommendation: 'Remove the file from the repository and its history, rotate any secrets it held, and add it to .gitignore.', poc: null, _refs: [] })
  if (dep) extra.push(...dependencyFindings(dep.dependencies).map((f) => ({ ...f, _refs: [] })))
  let findings = finalizeFindings([...ai.findings, ...extra])

  const tools = [...stat.tools]
  if (stat.buildOk && config.runPoc()) findings = await executePocs(findings, src, tools, ctx)
  tools.push({ name: 'ai-review', version: ai.used ? config.analysisModel() : null, status: ai.used ? 'ran' : 'not-run', reason: ai.used ? null : aiConfigured() ? 'nothing to review' : 'AI unavailable (ANTHROPIC_API_KEY not set)', durationMs: null, findings: ai.findings.filter((f) => f.triage !== 'tool-untriaged').length })

  const mode = scan.kind === 'web2' ? 'checklist' : stat.workerRan && ai.used ? 'static+ai' : ai.used ? 'ai-only' : stat.workerRan ? 'static-only' : null
  if (!mode) throw new ScanError('engine-unavailable', 'no analysis could be run; try again later')
  if (scan.kind === 'web2' && !ai.used) limitations.push('The AI checklist review did not run; checklist items are not checked.')
  if (src.target.proxy?.isProxy) limitations.push(`This address is a proxy; its implementation ${src.target.proxy.implementation} was not scanned. Scan it separately.`)
  if (ai.meter.capped) limitations.push(`The AI cost cap ($${ai.meter.capUsd.toFixed(2)}) was reached; parts of the code were not reviewed by the AI (listed under Tools).`)
  if (scan.kind !== 'web2' && !stat.buildOk && stat.workerRan) limitations.push('The project did not compile in the worker (dependencies such as git submodules are not fetched); tools that need a full build may have been limited.')
  if (scan.kind === 'web2') limitations.push('Checklist scan of source code only: the running service, its infrastructure and its configuration were not tested.')
  if (scope.files.some((f) => !f.inScope)) limitations.push('Dependencies, tests and scripts are out of scope (listed in the scope table).')

  const sm = makeMeter({ capUsd: Math.max(0, ai.meter.capUsd - ai.meter.usd) })
  const summary = await summarize({ findings, label: MODE_LABELS[mode], targetText: targetText(src.target), meter: sm, useAi: ai.used })
  ai.meter.usd += sm.usd
  ai.meter.input += sm.input
  ai.meter.output += sm.output
  const checklist = ai.checklist ? ai.checklist.map((c) => (c.id === 'C12' && dep ? { ...c, result: !dep.dependencies.ran ? 'not-checked' : dep.dependencies.counts.critical + dep.dependencies.counts.high > 0 ? 'fail' : dep.dependencies.counts.moderate > 0 ? 'warn' : 'pass', note: dep.dependencies.ran ? `npm audit: ${Object.entries(dep.dependencies.counts).map(([k, v]) => `${v} ${k}`).join(', ')}` : `npm audit not run: ${dep.dependencies.reason}` } : c)) : null

  return finish(scan, dir, {
    mode,
    target: src.target,
    scope,
    tools,
    ai: aiBlock(ai, summary.model),
    summaryText: summary.text,
    findings,
    dropped: ai.dropped,
    checklist,
    dependencies: dep?.dependencies ?? null,
    limitations,
  })
}

function aiBlock(ai, summaryModel) {
  if (!ai) return { used: false, models: { analysis: null, summary: null }, chunks: 0, chunksReviewed: 0, inputTokens: 0, outputTokens: 0, costUsd: 0, costCapUsd: config.maxCostUsd(), capped: false, notReviewed: [], promptInjectionFlags: [] }
  return {
    used: ai.used,
    models: { analysis: ai.used ? config.analysisModel() : null, summary: summaryModel },
    chunks: ai.chunks,
    chunksReviewed: ai.chunksReviewed,
    inputTokens: ai.meter.input,
    outputTokens: ai.meter.output,
    costUsd: Math.round(ai.meter.usd * 1e6) / 1e6,
    costCapUsd: ai.meter.capUsd,
    capped: ai.meter.capped,
    notReviewed: ai.notReviewed.slice(0, 200),
    promptInjectionFlags: ai.flags.slice(0, 100),
  }
}

async function executePocs(findings, src, tools, ctx) {
  const t0 = Date.now()
  let ran = 0
  let failedReason = null
  for (const f of findings) {
    if (ran >= 3 || !f.poc || !['critical', 'high'].includes(f.severity) || ctx.isCancelled()) continue
    try {
      const r = await runPoc({ files: src.files.map((x) => ({ path: x.path, content: x.content })), test: { path: `test/GullyPoc_${f.id.replace('-', '')}.t.sol`, content: f.poc.code }, solcVersion: solcFrom(src.target.compiler, src.files) })
      ran++
      if (r.status === 'passed' || r.status === 'failed') f.poc = { ...f.poc, status: r.status === 'passed' ? 'executed-passed' : 'executed-failed', note: r.status === 'passed' ? 'Compiled and run by the scanner worker: the test passed (the issue reproduced). Still verify manually.' : 'Compiled and run by the scanner worker: the test failed, so the issue did not reproduce as written.' }
    } catch (e) {
      failedReason = e.message
      break
    }
  }
  tools.push({ name: 'forge-poc', version: null, status: ran ? 'ran' : failedReason ? 'failed' : 'skipped', reason: ran ? null : failedReason ?? 'no critical/high finding had a PoC', durationMs: Date.now() - t0, findings: 0 })
  return findings
}

function finish(scan, dir, parts) {
  const report = buildReport({ id: scan.id, workspace: scan.workspace, createdAt: scan.createdAt, ...parts })
  const v = validateReport(report)
  if (!v.ok) throw new ScanError('report-invalid', `report failed validation: ${v.errors.slice(0, 3).join('; ')}`)
  writeJson(path.join(dir, 'report.json'), report)
  fs.writeFileSync(path.join(dir, 'report.html'), renderReportHtml(report))
  return report
}
