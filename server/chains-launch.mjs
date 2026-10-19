// Chain launch flow, server side: the list of testnet chains a workspace launched from the app's wizard
// (src/pages/developers/chains/). ADDRESSES AND CONFIGURATION ONLY. We never generate, receive or store a private
// key, a mnemonic or a seed: the wallet of the person launching signs the SDK's transaction in their browser,
// and anything that looks like key material in a request is refused with a 400, never stored.
//
//   GET  /api/developer/chains-launch               { parent, chains: [...] } for the active workspace
//   GET  /api/developer/chains-launch/check?chainId=N  { chainId, free, reason? } against chainlist data and
//                                                    chains launched by any workspace here
//   POST /api/developer/chains-launch               record a chain (upsert by txHash): { name, chainId, type,
//                                                    parentChainId, owner, validators[], batchPosters[], gasToken,
//                                                    txHash, status?: 'submitted' | 'deployed', coreContracts? }
//   POST /api/developer/chains-launch/remove        { id }
//
// Rules enforced HERE (the page enforces them too, but the server never trusts the page):
//   - testnet only: the parent chain must be Arbitrum Sepolia (421614); any other value is refused
//   - the gas token is ETH (custom tokens come later)
//   - the chain id is a positive safe integer, not one chainlist already lists, not one another workspace used
//   - owner, validators and batch posters are 0x addresses (EIP-55 case is not required, stored lower-cased)
//   - no key material anywhere in the body: field names like privateKey/mnemonic/seed/secret, and any value shaped
//     like a raw private key (64 hex digits) outside the txHash field
// Reads and writes follow the portal gate in developer.mjs (session, CSRF, workspace, role: workspaces.mjs 'chains').
//
// Storage: DATA_DIR/chains-launch.json (tmp + rename)  { [workspace]: [{ id, at, by, name, chainId, type, parentChainId,
//   owner, validators, batchPosters, gasToken, txHash, status, coreContracts }] }

import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { recordEvent } from './activity.mjs'
import { DATA_DIR, json, readJson } from './http.mjs'

export const PARENT = Object.freeze({ id: 421614, name: 'Arbitrum Sepolia' })
export const TYPES = ['rollup', 'anytrust']
export const MAX_PER_WORKSPACE = 20
export const MAX_ADDRESSES = 8
const ADDR_RE = /^0x[0-9a-fA-F]{40}$/
const TX_RE = /^0x[0-9a-fA-F]{64}$/
const NAME_RE = /^[\p{L}\p{N} ._\-]{3,40}$/u
const KEY_FIELD_RE = /priv|mnemonic|seed|secret|passphrase|phrase|keystore|wif|signer/i
const RAW_KEY_RE = /^(0x)?[0-9a-fA-F]{64}$/
const CORE_FIELDS = ['rollup', 'nativeToken', 'inbox', 'outbox', 'rollupEventInbox', 'challengeManager', 'adminProxy', 'sequencerInbox', 'bridge', 'upgradeExecutor', 'validatorUtils', 'validatorWalletCreator']
const chainlistUrl = () => process.env.CHAINLIST_URL ?? 'https://chainid.network/chains_mini.json'
const CHAINLIST_TTL = 6 * 3_600_000
const CHAINLIST_OFF = () => process.env.CHAINLIST_URL === 'off'

const file = () => path.join(DATA_DIR, 'chains-launch.json')
let db = null
function load() {
  if (db) return db
  try {
    db = JSON.parse(fs.readFileSync(file(), 'utf8'))
    if (!db || typeof db !== 'object' || Array.isArray(db)) db = {}
  } catch {
    db = {}
  }
  return db
}
function save() {
  fs.mkdirSync(path.dirname(file()), { recursive: true })
  fs.writeFileSync(file() + '.tmp', JSON.stringify(db))
  fs.renameSync(file() + '.tmp', file())
}

/* ------------------------------------------------------------ chainlist --- */

let listed = { at: 0, ids: null }
/** The chain ids chainlist (chainid.network) lists, cached; null when it can't be read (then only our own list is checked). */
async function chainlistIds() {
  if (CHAINLIST_OFF()) return null
  if (listed.ids && Date.now() - listed.at < CHAINLIST_TTL) return listed.ids
  try {
    const r = await fetch(chainlistUrl(), { signal: AbortSignal.timeout(6_000) })
    if (!r.ok) throw new Error(String(r.status))
    const rows = await r.json()
    if (!Array.isArray(rows) || rows.length < 100) throw new Error('unexpected chainlist')
    listed = { at: Date.now(), ids: new Map(rows.filter((c) => Number.isSafeInteger(c?.chainId)).map((c) => [c.chainId, String(c.name ?? '').slice(0, 60)])) }
    return listed.ids
  } catch {
    return listed.ids // a stale copy beats none
  }
}

/** { free: true } or { free: false, reason }. */
export async function checkChainId(chainId, { exceptTx = null } = {}) {
  if (!Number.isSafeInteger(chainId) || chainId < 1 || chainId > 4_503_599_627_370_495) return { free: false, reason: 'A chain id is a whole number from 1 up to 4503599627370495.' }
  for (const rows of Object.values(load()))
    for (const c of rows) if (c.chainId === chainId && c.txHash !== exceptTx) return { free: false, reason: 'A chain launched from the Gully Labs app already uses this id.' }
  const ids = await chainlistIds()
  if (ids?.has(chainId)) return { free: false, reason: `Chainlist lists chain ${chainId} as ${ids.get(chainId) || 'another chain'}.` }
  return { free: true, checkedChainlist: !!ids }
}

/* ------------------------------------------------------------ validation --- */

/** The first sign of key material in a body (a field name or a value shaped like a raw private key), or null. */
export function keyMaterialIn(v, where = '') {
  if (typeof v === 'string') return RAW_KEY_RE.test(v.trim()) && where !== 'txHash' ? `${where || 'a value'} looks like a private key` : null
  if (Array.isArray(v)) {
    for (const x of v) {
      const f = keyMaterialIn(x, where)
      if (f) return f
    }
    return null
  }
  if (v && typeof v === 'object') {
    for (const [k, x] of Object.entries(v)) {
      if (KEY_FIELD_RE.test(k)) return `the field "${k}" is key material`
      const f = keyMaterialIn(x, k)
      if (f) return f
    }
  }
  return null
}

const addr = (v) => (typeof v === 'string' && ADDR_RE.test(v.trim()) ? v.trim().toLowerCase() : null)

function addressList(v, label) {
  if (!Array.isArray(v) || v.length < 1 || v.length > MAX_ADDRESSES) return { error: `${label}: give 1 to ${MAX_ADDRESSES} addresses.` }
  const out = []
  for (const x of v) {
    const a = addr(x)
    if (!a) return { error: `${label}: "${String(x).slice(0, 12)}…" is not a 0x address.` }
    if (a === '0x0000000000000000000000000000000000000000') return { error: `${label}: the zero address can't be used.` }
    if (!out.includes(a)) out.push(a)
  }
  return { list: out }
}

/** Validates a record body. { ok: true, row } or { ok: false, error }. Pure: the chain id lookup is separate. */
export function readLaunch(b) {
  if (!b || typeof b !== 'object' || Array.isArray(b)) return { ok: false, error: 'The request could not be read.' }
  const km = keyMaterialIn(b)
  if (km) return { ok: false, error: `Refused: ${km}. Gully Labs never receives or stores private keys; the wallet signs in your browser and the node's keys stay on your machine.` }
  if (b.parentChainId !== PARENT.id) return { ok: false, error: `Testnet only: the parent chain must be ${PARENT.name} (${PARENT.id}). There is no mainnet path here.` }
  if (b.gasToken !== 'ETH') return { ok: false, error: 'The gas token must be ETH for now. Custom gas tokens come later.' }
  if (!TYPES.includes(b.type)) return { ok: false, error: 'The chain type must be rollup or anytrust.' }
  const name = typeof b.name === 'string' ? b.name.trim() : ''
  if (!NAME_RE.test(name)) return { ok: false, error: 'Name the chain: 3 to 40 letters, digits, spaces, dots, dashes or underscores.' }
  if (!Number.isSafeInteger(b.chainId) || b.chainId < 1) return { ok: false, error: 'The chain id must be a whole number of at least 1.' }
  const owner = addr(b.owner)
  if (!owner) return { ok: false, error: 'The owner must be a 0x address.' }
  const validators = addressList(b.validators, 'Validators')
  if (validators.error) return { ok: false, error: validators.error }
  const batchPosters = addressList(b.batchPosters, 'Batch posters')
  if (batchPosters.error) return { ok: false, error: batchPosters.error }
  if (typeof b.txHash !== 'string' || !TX_RE.test(b.txHash)) return { ok: false, error: 'The transaction hash must be 0x followed by 64 hex digits.' }
  const status = b.status === 'deployed' ? 'deployed' : 'submitted'
  let coreContracts = null
  if (b.coreContracts !== undefined && b.coreContracts !== null) {
    if (typeof b.coreContracts !== 'object' || Array.isArray(b.coreContracts)) return { ok: false, error: 'coreContracts must be an object of addresses.' }
    coreContracts = {}
    for (const f of CORE_FIELDS) {
      const v = b.coreContracts[f]
      if (v === undefined || v === null) continue
      const a = addr(v)
      if (!a) return { ok: false, error: `coreContracts.${f} is not a 0x address.` }
      coreContracts[f] = a
    }
    const block = b.coreContracts.deployedAtBlockNumber
    if (block !== undefined) {
      if (!Number.isSafeInteger(block) || block < 0) return { ok: false, error: 'coreContracts.deployedAtBlockNumber must be a block number.' }
      coreContracts.deployedAtBlockNumber = block
    }
    if (status === 'deployed' && !coreContracts.rollup) return { ok: false, error: 'A deployed chain needs its rollup address.' }
  } else if (status === 'deployed') return { ok: false, error: 'A deployed chain needs its core contract addresses.' }
  return { ok: true, row: { name, chainId: b.chainId, type: b.type, parentChainId: PARENT.id, owner, validators: validators.list, batchPosters: batchPosters.list, gasToken: 'ETH', txHash: b.txHash.toLowerCase(), status, coreContracts } }
}

const view = (c) => ({ id: c.id, at: c.at, by: c.by, name: c.name, chainId: c.chainId, type: c.type, parentChainId: c.parentChainId, owner: c.owner, validators: c.validators, batchPosters: c.batchPosters, gasToken: c.gasToken, txHash: c.txHash, status: c.status, coreContracts: c.coreContracts })

/** A workspace's launched chains, newest first. */
export const chainsOf = (workspace) => [...(load()[workspace] ?? [])].reverse().map(view)

const hits = new Map()
function allow(user) {
  const now = Date.now()
  const list = (hits.get(user) ?? []).filter((t) => now - t < 3_600_000)
  if (list.length >= 200) return hits.set(user, list), false
  list.push(now)
  hits.set(user, list)
  return true
}

/** /api/developer/chains-launch[/…], called by developer.mjs after the portal gate. ctx = { user, workspace, role }. */
export async function handleChainsLaunch(req, res, url, ctx) {
  const p = url.pathname.replace(/\/$/, '')
  const post = req.method === 'POST'
  const { user, workspace } = ctx

  if (p === '/api/developer/chains-launch') {
    if (!post) return json(res, 200, { parent: PARENT, types: TYPES, max: MAX_PER_WORKSPACE, chains: chainsOf(workspace) }), true
    if (!allow(user)) return json(res, 429, { error: 'Too many requests. Try again in an hour.' }), true
    const body = await readJson(req, 12_000)
    const r = readLaunch(body)
    if (!r.ok) return json(res, 400, { error: r.error }), true
    const rows = (load()[workspace] ??= [])
    const existing = rows.find((c) => c.txHash === r.row.txHash)
    if (!existing && rows.length >= MAX_PER_WORKSPACE) return json(res, 409, { error: `A workspace can list ${MAX_PER_WORKSPACE} launched chains. Remove one first.` }), true
    const free = await checkChainId(r.row.chainId, { exceptTx: r.row.txHash })
    if (!free.free) return json(res, 409, { error: free.reason }), true
    if (existing) {
      // The same transaction again: only a move from submitted to deployed, with its addresses, is accepted.
      if (existing.status === 'deployed' && r.row.status !== 'deployed') return json(res, 200, { chain: view(existing), chains: chainsOf(workspace) }), true
      Object.assign(existing, r.row, { id: existing.id, at: existing.at, by: existing.by })
    } else {
      rows.push({ id: 'cl_' + crypto.randomBytes(9).toString('base64url'), at: new Date().toISOString(), by: user, ...r.row })
    }
    try {
      save()
    } catch {
      /* kept in memory until the next successful write */
    }
    const chain = view(existing ?? rows[rows.length - 1])
    if (!existing) recordEvent(workspace, { actor: user, action: 'chain.launched', target: chain.name, detail: { chainId: chain.chainId, parent: PARENT.name } })
    return json(res, existing ? 200 : 201, { chain, chains: chainsOf(workspace) }), true
  }

  if (p === '/api/developer/chains-launch/check') {
    if (post) return json(res, 405, { error: 'GET only' }), true
    const raw = url.searchParams.get('chainId') ?? ''
    const id = /^\d{1,16}$/.test(raw) ? Number(raw) : NaN
    return json(res, 200, { chainId: Number.isFinite(id) ? id : null, ...(await checkChainId(id)) }), true
  }

  if (p === '/api/developer/chains-launch/remove') {
    if (!post) return json(res, 405, { error: 'POST only' }), true
    const body = await readJson(req, 1_000)
    const rows = load()[workspace] ?? []
    const i = rows.findIndex((c) => c.id === body?.id)
    if (i < 0) return json(res, 404, { error: 'No such chain in this workspace.' }), true
    const [gone] = rows.splice(i, 1)
    try {
      save()
    } catch {
      /* kept in memory */
    }
    recordEvent(workspace, { actor: user, action: 'chain.removed', target: gone.name, detail: null })
    return json(res, 200, { chains: chainsOf(workspace) }), true
  }

  return json(res, 404, { error: 'not found' }), true
}
