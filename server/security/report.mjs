// Report assembly (schema.mjs shape) and a static, print-ready HTML render. The HTML has no scripts and no
// external requests except the kit's logo from the site's own /brand/ path; every value is escaped. Part 2
// styles it through the CSS custom properties on .gs-report and the gs-* classes (the branding hooks).

import { DISCLAIMER, MODE_LABELS, REPORT_KIND, REPORT_TITLE, SCHEMA_VERSION, SEVERITIES } from './schema.mjs'

export const ENGINE_VERSION = '1.0.0'

/** Builds the report object from the pipeline's parts. */
export function buildReport({ id, workspace, createdAt, mode, target, scope, tools, ai, summaryText, findings, dropped, checklist = null, dependencies = null, limitations = [] }) {
  const counts = Object.fromEntries(SEVERITIES.map((s) => [s, findings.filter((f) => f.severity === s).length]))
  return {
    schemaVersion: SCHEMA_VERSION,
    kind: REPORT_KIND,
    id,
    title: REPORT_TITLE,
    mode,
    label: MODE_LABELS[mode],
    workspace,
    createdAt,
    completedAt: new Date().toISOString(),
    engine: { name: 'gully-security', version: ENGINE_VERSION },
    target,
    scope,
    tools,
    ai,
    summary: { text: summaryText, counts, findings: findings.length, dropped: dropped.length },
    findings,
    dropped,
    checklist,
    dependencies,
    limitations,
    disclaimer: DISCLAIMER,
  }
}

/** One line naming the target, for summaries and the report header. */
export function targetText(t) {
  if (t.type === 'address') return `${t.contractName ? `${t.contractName} at ` : ''}${t.address} on ${t.chainName ?? `chain ${t.chainId}`}${t.verified ? ` (source verified on ${t.sourceProvider}${t.sourceMatch ? `, ${t.sourceMatch} match` : ''})` : ' (source not verified)'}`
  if (t.repo) return `${t.repo.owner}/${t.repo.name} at commit ${t.repo.commit}`
  if (t.upload) return `uploaded ${t.upload.name} (sha256 ${t.upload.sha256.slice(0, 16)}…)`
  return 'unknown target'
}

/* -------------------------------------------------------------------- HTML --- */

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
const loc = (l) => (l ? `${esc(l.file)}${l.line ? `:${l.line}${l.endLine && l.endLine !== l.line ? `-${l.endLine}` : ''}` : ''}` : '')

/** Kit tokens (src/index.css / BRAND.md), printable on light paper. Override any --gs-* to restyle. */
export const REPORT_CSS = `
.gs-report{--gs-ink:#0d141c;--gs-muted:#4a5564;--gs-line:#d9dde3;--gs-paper:#ffffff;--gs-panel:#f4f2ec;--gs-gold:#d9b563;--gs-gold-ink:#5a4a22;
--gs-critical:#9b1c1c;--gs-high:#c2410c;--gs-medium:#a16207;--gs-low:#1d4ed8;--gs-info:#4a5564;
--gs-font-display:"Barlow Condensed",system-ui,sans-serif;--gs-font-body:"Hanken Grotesk",system-ui,sans-serif;--gs-font-mono:"IBM Plex Mono",ui-monospace,monospace;
background:var(--gs-paper);color:var(--gs-ink);font:14px/1.55 var(--gs-font-body);max-width:960px;margin:0 auto;padding:32px 24px}
.gs-report h1,.gs-report h2,.gs-report h3{font-family:var(--gs-font-display);font-weight:800;letter-spacing:.01em;line-height:1.1;margin:1.6em 0 .5em}
.gs-report h1{font-size:36px;margin-top:.4em}.gs-report h2{font-size:24px;border-bottom:2px solid var(--gs-gold);padding-bottom:4px}.gs-report h3{font-size:18px}
.gs-report code,.gs-report pre,.gs-mono{font-family:var(--gs-font-mono);font-size:12px}
.gs-report pre{background:var(--gs-panel);border:1px solid var(--gs-line);padding:12px;overflow-x:auto;white-space:pre-wrap;word-break:break-word}
.gs-report table{width:100%;border-collapse:collapse;margin:8px 0}.gs-report th,.gs-report td{border-bottom:1px solid var(--gs-line);padding:6px 8px;text-align:left;vertical-align:top}
.gs-report th{font-family:var(--gs-font-display);font-size:13px;text-transform:uppercase;letter-spacing:.06em;color:var(--gs-muted)}
.gs-header{display:flex;justify-content:space-between;align-items:center;gap:16px;border-bottom:1px solid var(--gs-line);padding-bottom:16px}
.gs-logo{height:36px;width:auto}
.gs-badge{display:inline-block;border:1px solid var(--gs-gold-ink);background:var(--gs-panel);color:var(--gs-gold-ink);font:600 12px/1 var(--gs-font-mono);padding:6px 10px;border-radius:4px}
.gs-sev{display:inline-block;min-width:68px;text-align:center;color:#fff;font:600 11px/1 var(--gs-font-mono);text-transform:uppercase;padding:5px 6px;border-radius:3px}
.gs-sev-critical{background:var(--gs-critical)}.gs-sev-high{background:var(--gs-high)}.gs-sev-medium{background:var(--gs-medium)}.gs-sev-low{background:var(--gs-low)}.gs-sev-info{background:var(--gs-info)}
.gs-finding{border:1px solid var(--gs-line);border-left:4px solid var(--gs-line);padding:12px 16px;margin:12px 0;break-inside:avoid}
.gs-finding[data-severity=critical]{border-left-color:var(--gs-critical)}.gs-finding[data-severity=high]{border-left-color:var(--gs-high)}.gs-finding[data-severity=medium]{border-left-color:var(--gs-medium)}.gs-finding[data-severity=low]{border-left-color:var(--gs-low)}
.gs-meta{color:var(--gs-muted);font-size:12px}.gs-muted{color:var(--gs-muted)}
.gs-disclaimer{background:var(--gs-panel);border:1px solid var(--gs-line);padding:12px 16px;font-size:12px}
.gs-counts{display:flex;flex-wrap:wrap;gap:8px}.gs-count{border:1px solid var(--gs-line);padding:8px 12px;min-width:90px}.gs-count b{display:block;font:800 24px/1 var(--gs-font-display)}
@media print{.gs-report{max-width:none;padding:0;font-size:11pt}.gs-report pre{font-size:8.5pt}.gs-report h2{break-after:avoid}.gs-finding,.gs-disclaimer,.gs-report table{break-inside:avoid}@page{size:A4;margin:16mm 14mm}}
`

/**
 * Static HTML for a report. Options: logoUrl (default the kit's horizontal lockup for light paper),
 * standalone (wrap in a full document; default true), inlineCss (default true).
 */
export function renderReportHtml(r, { logoUrl = '/brand/gullylabs-logo-horizontal-on-light.svg', standalone = true, inlineCss = true } = {}) {
  const t = r.target
  const targetRows = [
    ['Target', targetText(t)],
    t.type === 'address' && ['Chain', `${t.chainName ?? ''} (${t.chainId})`],
    t.explorerUrl && ['Explorer', t.explorerUrl],
    t.sourceUrl && ['Sourcify', `${t.sourceUrl}${t.sourceMatch ? ` (${t.sourceMatch} match)` : ''}`],
    t.compiler?.version && ['Compiler', `${t.compiler.version}${t.compiler.optimizer ? `, optimizer ${t.compiler.runs ?? ''} runs` : ''}${t.compiler.evmVersion ? `, EVM ${t.compiler.evmVersion}` : ''}`],
    t.proxy?.isProxy && ['Proxy', `implementation ${t.proxy.implementation}`],
    t.repo && ['Repository', `${t.repo.url} @ ${t.repo.commit}`],
    t.upload && ['Upload', `${t.upload.name}, ${t.upload.bytes} bytes, sha256 ${t.upload.sha256}`],
    t.bytecodeSha256 && ['Runtime bytecode sha256', t.bytecodeSha256],
    ['Scanned', `${r.createdAt} → ${r.completedAt}`],
    ['Report', `${r.id} (schema ${r.schemaVersion}, engine ${r.engine.version})`],
  ].filter(Boolean)
  const counts = SEVERITIES.map((s) => `<div class="gs-count gs-count-${s}"><b>${r.summary.counts[s]}</b><span class="gs-sev gs-sev-${s}">${s}</span></div>`).join('')
  const findings = r.findings
    .map(
      (f) => `<article class="gs-finding" id="${esc(f.id)}" data-severity="${esc(f.severity)}">
<h3><span class="gs-sev gs-sev-${esc(f.severity)}">${esc(f.severity)}</span> ${esc(f.id)} · ${esc(f.title)}</h3>
<p class="gs-meta">Likelihood ${esc(f.likelihood)} × impact ${esc(f.impact)} · confidence ${esc(f.confidence)} · ${esc(f.category)} · ${esc(f.triage)} · sources: ${f.sources.map((s) => esc(s.detector ? `${s.tool}:${s.detector}` : s.tool)).join(', ')}</p>
${f.locations.length ? `<p class="gs-mono">${f.locations.map(loc).join('<br>')}</p>` : ''}
<p><strong>What could happen.</strong> ${esc(f.explanation)}</p>
<p><strong>Details.</strong> ${esc(f.description)}</p>
<p><strong>Recommendation.</strong> ${esc(f.recommendation)}</p>
${f.poc ? `<details class="gs-poc"><summary>Proof of concept (${esc(f.poc.status)}): ${esc(f.poc.note)}</summary><pre>${esc(f.poc.code)}</pre></details>` : ''}
<p class="gs-meta">Not verified by a human reviewer.</p>
</article>`,
    )
    .join('\n')
  const tools = r.tools.map((x) => `<tr><td>${esc(x.name)}</td><td>${esc(x.version ?? '—')}</td><td>${esc(x.status)}</td><td>${esc(x.reason ?? '')}</td><td>${x.findings}</td></tr>`).join('')
  const files = r.scope.files.map((f) => `<tr><td class="gs-mono">${esc(f.path)}</td><td>${f.nsloc}</td><td>${f.inScope ? 'in scope' : esc(`out: ${f.reason}`)}</td><td class="gs-mono">${esc(f.sha256.slice(0, 16))}…</td></tr>`).join('')
  const dropped = r.dropped.length ? `<h2>Dismissed tool findings</h2><table><thead><tr><th>Tool</th><th>Finding</th><th>Location</th><th>Why dismissed</th></tr></thead><tbody>${r.dropped.map((d) => `<tr><td>${esc(d.tool)}</td><td>${esc(d.title)}</td><td class="gs-mono">${loc(d.location)}</td><td>${esc(d.reason)}</td></tr>`).join('')}</tbody></table>` : ''
  const checklist = r.checklist ? `<h2>Checklist</h2><table><thead><tr><th>Item</th><th>Result</th><th>Note</th></tr></thead><tbody>${r.checklist.map((c) => `<tr><td><b>${esc(c.id)}</b> ${esc(c.item)}</td><td>${esc(c.result)}</td><td>${esc(c.note)}${c.locations.length ? `<br><span class="gs-mono">${c.locations.map(loc).join(', ')}</span>` : ''}</td></tr>`).join('')}</tbody></table>` : ''
  const deps = r.dependencies ? `<h2>Dependencies</h2><p>${r.dependencies.ran ? `npm audit on the lockfile: ${Object.entries(r.dependencies.counts ?? {}).map(([k, v]) => `${v} ${k}`).join(', ')}.` : `npm audit not run: ${esc(r.dependencies.reason)}`}</p>${r.dependencies.advisories.length ? `<table><thead><tr><th>Package</th><th>Severity</th><th>Advisory</th></tr></thead><tbody>${r.dependencies.advisories.slice(0, 60).map((a) => `<tr><td class="gs-mono">${esc(a.name)}</td><td>${esc(a.severity)}</td><td>${esc(a.title)}${a.url ? ` <span class="gs-mono">${esc(a.url)}</span>` : ''}</td></tr>`).join('')}</tbody></table>` : ''}` : ''
  const inj = r.ai.promptInjectionFlags.length ? `<h3>Comments addressed to AI reviewers (removed before review)</h3><ul>${r.ai.promptInjectionFlags.map((p) => `<li class="gs-mono">${esc(p.file)}:${p.line}: ${esc(p.excerpt)}</li>`).join('')}</ul>` : ''
  const body = `<main class="gs-report" data-mode="${esc(r.mode)}">
<header class="gs-header"><img class="gs-logo" src="${esc(logoUrl)}" alt="Gully Labs"><span class="gs-badge">${esc(r.label)}</span></header>
<h1>${esc(r.title)}</h1>
<p class="gs-muted">${esc(targetText(t))}</p>
<section class="gs-summary"><h2>Summary</h2><p>${esc(r.summary.text)}</p><div class="gs-counts">${counts}</div>${r.summary.dropped ? `<p class="gs-meta">${r.summary.dropped} tool finding(s) dismissed as false positives, listed below with reasons.</p>` : ''}</section>
<section class="gs-scope"><h2>Scope</h2><table><tbody>${targetRows.map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join('')}</tbody></table>
<p>${r.scope.inScopeFiles} file(s) in scope, ${r.scope.totalNsloc} nSLOC.</p>
<table><thead><tr><th>File</th><th>nSLOC</th><th>Scope</th><th>sha256</th></tr></thead><tbody>${files}</tbody></table></section>
<section class="gs-tools"><h2>Tools</h2><table><thead><tr><th>Tool</th><th>Version</th><th>Status</th><th>Note</th><th>Findings</th></tr></thead><tbody>${tools}</tbody></table>
<p class="gs-meta">AI: ${r.ai.used ? `${esc(r.ai.models.analysis ?? '')}${r.ai.models.summary ? ` + ${esc(r.ai.models.summary)}` : ''}, ${r.ai.chunksReviewed}/${r.ai.chunks} chunk(s) reviewed, ${r.ai.inputTokens + r.ai.outputTokens} tokens, $${r.ai.costUsd.toFixed(4)} of a $${r.ai.costCapUsd.toFixed(2)} cap${r.ai.capped ? ' (cap reached)' : ''}` : 'not used'}.</p>
${r.ai.notReviewed.length ? `<p class="gs-meta">Not reviewed by the AI: ${r.ai.notReviewed.map(esc).join(', ')}</p>` : ''}${inj}</section>
${checklist}${deps}
<section class="gs-findings"><h2>Findings</h2>${findings || '<p>No findings were raised by the checks that ran. That is not evidence the code is safe.</p>'}</section>
${dropped}
${r.limitations.length ? `<section class="gs-limitations"><h2>Limitations</h2><ul>${r.limitations.map((l) => `<li>${esc(l)}</li>`).join('')}</ul></section>` : ''}
<section class="gs-disclaimer"><h2>Disclaimer</h2><p>${esc(r.disclaimer)}</p></section>
</main>`
  if (!standalone) return body
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${esc(r.title)} ${esc(r.id)}</title>${inlineCss ? `<style>${REPORT_CSS}</style>` : ''}</head><body style="margin:0;background:#fff">${body}</body></html>`
}
