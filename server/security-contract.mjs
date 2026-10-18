// Gully Security: the shapes the product UI (security-routes.mjs, the app's Security tab, the public report
// pages) shares with the scan engine.
//
// INTEGRATION POINT (part 1, feat/sec-engine): the engine will publish these in server/security/schema.mjs
// (+ schema.d.mts). When it merges, replace the constants below with re-exports from there, e.g.
//   export { SCAN_STATUSES, INPUT_KINDS, SEVERITIES } from './security/schema.mjs'
// and keep normaliseInput() only if the engine's schema has no validator of its own. Every name used by
// security-routes.mjs is exported from this file, so that merge touches this file alone.
//
// A scan, as the engine returns it:
//   { id, workspace, status: queued|fetching|analysing|triaging|done|failed|cancelled,
//     input: { kind: 'address'|'repo'|'upload'|'web2', chain?, address?, repo?, commit? },
//     progress: { step, pct },
//     report?: { scope, tools: [{ name, version, ran, reason? }],
//                findings: [{ id, severity, title, location, description, recommendation, poc?, pocExecuted, status }],
//                summary, disclaimer, cost },
//     createdAt, updatedAt }

export const SCAN_STATUSES = ['queued', 'fetching', 'analysing', 'triaging', 'done', 'failed', 'cancelled']
/** Statuses in which the engine is still working (in pipeline order). */
export const ACTIVE_STATUSES = ['queued', 'fetching', 'analysing', 'triaging']
export const TERMINAL_STATUSES = ['done', 'failed', 'cancelled']
export const INPUT_KINDS = ['address', 'repo', 'upload', 'web2']
export const SEVERITIES = ['critical', 'high', 'medium', 'low', 'info']

/** Chains a deployed contract can be scanned on (keys match src/components/logos/registry.ts for the marks). */
export const SCAN_CHAINS = [
  { key: 'ethereum', chainId: 1, name: 'Ethereum' },
  { key: 'base', chainId: 8453, name: 'Base' },
  { key: 'arbitrum', chainId: 42161, name: 'Arbitrum' },
  { key: 'optimism', chainId: 10, name: 'OP Mainnet' },
  { key: 'polygon', chainId: 137, name: 'Polygon' },
  { key: 'bsc', chainId: 56, name: 'BNB Chain' },
  { key: 'avalanche', chainId: 43114, name: 'Avalanche' },
]

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/
const COMMIT_RE = /^[0-9a-f]{7,40}$/
const GH_RE = /^(?:https?:\/\/(?:www\.)?github\.com\/)?([A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))\/([A-Za-z0-9._-]{1,100}?)(?:\.git)?\/?$/
const UPLOAD_NAME_RE = /^[\w .()+-]{1,120}\.(zip|sol|vy|rs|move|tar|gz|tgz)$/i

/**
 * Checks and normalises a scan input from the browser. Resolves { ok: true, input } with only the
 * contract's fields (repo as "owner/name", commit lower-case or null, address lower-case), or
 * { ok: false, error } in plain words.
 */
export function normaliseInput(raw) {
  const kind = String(raw?.kind ?? '')
  if (!INPUT_KINDS.includes(kind)) return { ok: false, error: `Pick what to scan: ${INPUT_KINDS.join(', ')}.` }
  if (kind === 'address') {
    const chain = SCAN_CHAINS.find((c) => c.key === String(raw?.chain ?? ''))
    if (!chain) return { ok: false, error: `Pick a chain: ${SCAN_CHAINS.map((c) => c.name).join(', ')}.` }
    const address = String(raw?.address ?? '').trim()
    if (!ADDRESS_RE.test(address) || /^0x0{40}$/.test(address)) return { ok: false, error: 'The contract address must be 0x followed by 40 hex characters.' }
    return { ok: true, input: { kind, chain: chain.key, address: address.toLowerCase() } }
  }
  if (kind === 'repo' || kind === 'web2') {
    const m = String(raw?.repo ?? '').trim().match(GH_RE)
    if (!m || m[2] === '.' || m[2] === '..') return { ok: false, error: 'Give a public GitHub repository as owner/name or https://github.com/owner/name.' }
    const commit = String(raw?.commit ?? '').trim().toLowerCase()
    if (commit && !COMMIT_RE.test(commit)) return { ok: false, error: 'The commit must be a hash of 7 to 40 hex characters, or left empty for the default branch.' }
    return { ok: true, input: { kind, repo: `${m[1]}/${m[2]}`, commit: commit || null } }
  }
  // upload: the bytes travel next to the input (security-routes.mjs readUpload), never inside it.
  return { ok: true, input: { kind } }
}

/** Checks an uploaded file's name and size. */
export function checkUploadName(name) {
  return UPLOAD_NAME_RE.test(String(name ?? ''))
}

/** A one-line label of what a scan looks at ("0x1234…abcd on Base", "owner/repo @ 1a2b3c4"). */
export function scopeLabel(input, upload = null) {
  if (input?.kind === 'address') return `${input.address.slice(0, 6)}…${input.address.slice(-4)} on ${SCAN_CHAINS.find((c) => c.key === input.chain)?.name ?? input.chain}`
  if (input?.kind === 'repo' || input?.kind === 'web2') return `${input.repo}${input.commit ? ` @ ${input.commit.slice(0, 7)}` : ''}`
  if (input?.kind === 'upload') return upload?.name ? `upload ${upload.name}` : 'uploaded code'
  return 'scan'
}
