// Gully Security: the shapes the product UI (security-routes.mjs, the app's Security tab, the public report
// pages) shares with the scan engine (server/security, part 1). The statuses, severities, kinds, mode labels
// and the disclaimer come from the engine's schema; this file adds the UI's own input normalisation (what a
// job stores and shows) and the conversion to the engine's input shape.
//
// Job input (stored on the job, shown in the UI):
//   { kind: 'address', chain: '<engine chain key>', address }
//   { kind: 'github' | 'web2', repo: 'owner/name', commit: '<hex>' | null, ref: '<branch|tag|HEAD>' | null }
//   { kind: 'upload', filename }                    (the bytes travel beside it, never inside it)

import { CHAINS } from './security/chains.mjs'

export { DISCLAIMER, INPUT_KINDS, MODE_LABELS, SCAN_STATUSES, SEVERITIES, TERMINAL_STATUSES } from './security/schema.mjs'

/** Statuses in which the engine is still working (in pipeline order). */
export const ACTIVE_STATUSES = ['queued', 'fetching', 'analysing', 'triaging', 'reporting']

/** Chains a deployed contract can be scanned on (engine chains.mjs): the mainnets, then Gully Chain Testnet (our own
    L3; no verification service covers it, so its scans read bytecode only). `logo` is the site's mark key. */
export const SCAN_CHAINS = [1, 8453, 42161, 10, 137, 56, 43114, 485590].map((id) => ({ key: CHAINS[id].key, chainId: id, name: CHAINS[id].name, logo: { bnb: 'bsc' }[CHAINS[id].key] ?? CHAINS[id].key }))

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/
const COMMIT_RE = /^[0-9a-f]{7,40}$/
const REF_RE = /^(?!.*\.\.)(?!\/)(?!.*\/\/)[A-Za-z0-9._/-]{1,120}(?<!\/)$/
const GH_RE = /^(?:https?:\/\/(?:www\.)?github\.com\/)?([A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))\/([A-Za-z0-9._-]{1,100}?)(?:\.git)?\/?$/
const UPLOAD_NAME_RE = /^[\w .()+-]{1,120}\.(zip|sol)$/i

/**
 * Checks and normalises a scan input from the browser. Resolves { ok: true, input } or { ok: false, error }
 * in plain words. The engine validates again (validateInput) before anything is charged.
 */
export function normaliseInput(raw) {
  const kind = String(raw?.kind ?? '')
  if (kind === 'address') {
    const chain = SCAN_CHAINS.find((c) => c.key === String(raw?.chain ?? ''))
    if (!chain) return { ok: false, error: `Pick a chain: ${SCAN_CHAINS.map((c) => c.name).join(', ')}.` }
    const address = String(raw?.address ?? '').trim()
    if (!ADDRESS_RE.test(address) || /^0x0{40}$/.test(address)) return { ok: false, error: 'The contract address must be 0x followed by 40 hex characters.' }
    return { ok: true, input: { kind, chain: chain.key, address: address.toLowerCase() } }
  }
  if (kind === 'github' || kind === 'web2') {
    const m = String(raw?.repo ?? '').trim().match(GH_RE)
    if (!m || m[2] === '.' || m[2] === '..') return { ok: false, error: 'Give a public GitHub repository as owner/name or https://github.com/owner/name.' }
    const commit = String(raw?.commit ?? '').trim().toLowerCase()
    if (commit && !COMMIT_RE.test(commit)) return { ok: false, error: 'The commit must be a hash of 7 to 40 hex characters, or left empty for the default branch.' }
    const ref = commit ? null : String(raw?.ref ?? '').trim() || 'HEAD'
    if (ref && !REF_RE.test(ref)) return { ok: false, error: 'The branch or tag name is not valid.' }
    return { ok: true, input: { kind, repo: `${m[1]}/${m[2]}`, commit: commit || null, ref } }
  }
  if (kind === 'upload') return { ok: true, input: { kind } }
  return { ok: false, error: 'Pick what to scan: a deployed contract, a GitHub repository, an upload or a web2 repository.' }
}

/** Checks an uploaded file's name (the engine takes a .zip of Solidity files or a single .sol file). */
export const checkUploadName = (name) => UPLOAD_NAME_RE.test(String(name ?? ''))

/** The engine's input for a job (+ its upload bytes for kind 'upload'). */
export function toEngineInput(input, upload = null) {
  if (input.kind === 'address') return { kind: 'address', chain: input.chain, address: input.address }
  if (input.kind === 'github' || input.kind === 'web2') return { kind: input.kind, repo: `https://github.com/${input.repo}`, ...(input.commit ? { commit: input.commit } : { ref: input.ref ?? 'HEAD' }) }
  return { kind: 'upload', filename: upload?.name ?? input.filename, data: upload?.bytes }
}

/** A one-line label of what a scan looks at ("0x1234…abcd on Base", "owner/repo @ 1a2b3c4"). */
export function scopeLabel(input, upload = null) {
  if (input?.kind === 'address') return `${input.address.slice(0, 6)}…${input.address.slice(-4)} on ${SCAN_CHAINS.find((c) => c.key === input.chain)?.name ?? input.chain}`
  if (input?.kind === 'github' || input?.kind === 'web2') return `${input.repo}${input.commit ? ` @ ${input.commit.slice(0, 7)}` : input.ref && input.ref !== 'HEAD' ? ` @ ${input.ref}` : ''}`
  if (input?.kind === 'upload') return upload?.name ? `upload ${upload.name}` : 'uploaded code'
  return 'scan'
}
