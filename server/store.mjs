// Small durable store for the developer programme and contact enquiries, kept as JSON files in
// DATA_DIR (the gully-web-data volume in production). Writes are atomic (tmp + rename). Secrets
// are never stored in the clear: API keys and claim codes are kept as SHA-256 hashes.

import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { DATA_DIR } from './http.mjs'

const FILE = path.join(DATA_DIR, 'developers.json')
const ENQUIRIES = path.join(DATA_DIR, 'enquiries.json')
const LAUNCH_LIST = path.join(DATA_DIR, 'launch-list.json')
const CHAIN_KIT = path.join(DATA_DIR, 'chain-kit.json')

function readFile(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return fallback
  }
}

function writeFile(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file + '.tmp', JSON.stringify(data))
  fs.renameSync(file + '.tmp', file)
}

export const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex')
export const randomToken = (bytes = 24) => crypto.randomBytes(bytes).toString('base64url')

/** Constant-time comparison of two strings. */
export function safeEqual(a, b) {
  const x = Buffer.from(String(a))
  const y = Buffer.from(String(b))
  return x.length === y.length && crypto.timingSafeEqual(x, y)
}

/* ---------------------------------------------------------- developers --- */

// { requests: [{ id, email, project, url, use, claimHash, status, createdAt, decidedAt, keyId, claimedAt }],   (legacy, manual approval)
//   keys: [{ id, hash, prefix, name, owner, requestId, project, email, limit, createdAt, rotatedAt, revokedAt }],
//   accounts: [{ address, createdAt, lastLoginAt, blocked, blockedAt }] }
// A key issued through the old request flow has requestId/project/email and no owner; a key created
// in the wallet dashboard has owner (a lower-case wallet address) and name.
let db = readFile(FILE, { requests: [], keys: [] })
db.requests ??= []
db.keys ??= []
db.accounts ??= []

export const developers = () => db
export function saveDevelopers() {
  writeFile(FILE, db)
}

export const KEY_LIMIT_PER_MIN = 600
export const MAX_KEYS_PER_ACCOUNT = 5

const newSecret = () => `gl_live_${randomToken(24)}`

/** A new API key: returns the plaintext once; only its hash is stored. */
export function issueKey({ requestId = null, project = null, email = null, owner = null, name = null }) {
  const secret = newSecret()
  const key = { id: randomToken(9), hash: sha256(secret), prefix: secret.slice(0, 14), name: name ?? project, owner, requestId, project, email, limit: KEY_LIMIT_PER_MIN, createdAt: new Date().toISOString(), rotatedAt: null, revokedAt: null }
  db.keys.push(key)
  saveDevelopers()
  return { key, secret }
}

/** Replaces a key's secret, keeping its id, name and usage history. Returns the new plaintext once. */
export function rotateKeySecret(key) {
  const secret = newSecret()
  key.hash = sha256(secret)
  key.prefix = secret.slice(0, 14)
  key.rotatedAt = new Date().toISOString()
  saveDevelopers()
  return secret
}

/** The live key matching a plaintext secret, or null. Keys of a blocked wallet do not work. */
export function findKey(secret) {
  if (!secret || !secret.startsWith('gl_live_') || secret.length > 100) return null
  const h = sha256(secret)
  const key = db.keys.find((k) => !k.revokedAt && safeEqual(k.hash, h)) ?? null
  if (key?.owner && getAccount(key.owner)?.blocked) return null
  return key
}

/** Keys owned by a wallet, newest first. */
export const keysOf = (address) => db.keys.filter((k) => k.owner === address).reverse()

/* ------------------------------------------------------------ accounts --- */

export const getAccount = (address) => db.accounts.find((a) => a.address === address) ?? null

/** The account for a wallet, created on first sign-in. */
export function touchAccount(address) {
  let a = getAccount(address)
  const now = new Date().toISOString()
  if (!a) {
    a = { address, createdAt: now, lastLoginAt: now, blocked: false, blockedAt: null }
    db.accounts.push(a)
  } else a.lastLoginAt = now
  saveDevelopers()
  return a
}

export function setBlocked(address, blocked) {
  const a = getAccount(address)
  if (!a) return null
  a.blocked = !!blocked
  a.blockedAt = blocked ? new Date().toISOString() : null
  saveDevelopers()
  return a
}

/* ------------------------------------------------------------ sessions --- */

// Dashboard sign-in sessions: { [sha256(sessionId)]: { address, createdAt, expiresAt, lastSeenAt?, userAgent?, activeWorkspace? } }. The cookie holds
// the plaintext id; only its hash is stored.
const SESSIONS = path.join(DATA_DIR, 'sessions.json')
export const SESSION_TTL_MS = 30 * 86_400_000
const MAX_SESSIONS_PER_ACCOUNT = 20
let sessions = readFile(SESSIONS, {})

function saveSessions() {
  try {
    writeFile(SESSIONS, sessions)
  } catch {
    /* kept in memory */
  }
}

function pruneSessions() {
  const now = Date.now()
  for (const [h, s] of Object.entries(sessions)) if (Date.parse(s.expiresAt) <= now) delete sessions[h]
}

/**
 * Starts a session for a wallet; returns the plaintext session id (for the cookie) once.
 * `userAgent` (optional) is kept, cut to 200 characters, to label the device in the sessions list.
 */
export function createSession(address, { userAgent = null } = {}) {
  pruneSessions()
  const mine = Object.entries(sessions).filter(([, s]) => s.address === address).sort((a, b) => a[1].createdAt.localeCompare(b[1].createdAt))
  while (mine.length >= MAX_SESSIONS_PER_ACCOUNT) delete sessions[mine.shift()[0]]
  const id = randomToken(32)
  const now = Date.now()
  sessions[sha256(id)] = { address, createdAt: new Date(now).toISOString(), expiresAt: new Date(now + SESSION_TTL_MS).toISOString(), lastSeenAt: new Date(now).toISOString(), userAgent: typeof userAgent === 'string' ? userAgent.slice(0, 200) : null, activeWorkspace: null }
  saveSessions()
  return id
}

/** The live session for a plaintext id, or null. */
export function findSession(id) {
  if (typeof id !== 'string' || id.length < 20 || id.length > 100) return null
  const s = sessions[sha256(id)]
  if (!s) return null
  if (Date.parse(s.expiresAt) <= Date.now()) {
    delete sessions[sha256(id)]
    saveSessions()
    return null
  }
  return s
}

export function deleteSession(id) {
  if (typeof id !== 'string') return
  const h = sha256(id)
  if (!sessions[h]) return
  delete sessions[h]
  saveSessions()
}

/** A wallet's live sessions as [storedHash, session] pairs, newest first (portal v2 sessions list). */
export function sessionsOf(address) {
  pruneSessions()
  return Object.entries(sessions)
    .filter(([, s]) => s.address === address)
    .sort((a, b) => b[1].createdAt.localeCompare(a[1].createdAt))
}

/** The stored key of a plaintext session id (its SHA-256). */
export const sessionKey = (id) => sha256(String(id))

/** Ends one session by its stored key. Returns whether it existed. */
export function deleteSessionByKey(key) {
  if (!sessions[key]) return false
  delete sessions[key]
  saveSessions()
  return true
}

const SEEN_SAVE_MS = 5 * 60_000
/** Marks a session as seen now; written to disk at most every five minutes per session. */
export function touchSession(id) {
  const s = sessions[sha256(String(id))]
  if (!s) return
  const now = Date.now()
  const last = Date.parse(s.lastSeenAt ?? s.createdAt)
  s.lastSeenAt = new Date(now).toISOString()
  if (!(now - last < SEEN_SAVE_MS)) saveSessions()
}

/** Sets the workspace a session acts in (null = the wallet's own). */
export function setSessionWorkspace(id, workspace) {
  const s = sessions[sha256(String(id))]
  if (!s) return
  s.activeWorkspace = workspace && workspace !== s.address ? workspace : null
  saveSessions()
}

/** Every session of `address` acting in `workspace` falls back to the wallet's own workspace. */
export function resetSessionsWorkspace(address, workspace) {
  let changed = false
  for (const s of Object.values(sessions)) {
    if (s.address === address && s.activeWorkspace === workspace) {
      s.activeWorkspace = null
      changed = true
    }
  }
  if (changed) saveSessions()
}

/** The latest time a wallet was seen in the dashboard (session activity or sign-in), or null. */
export function lastSeenOf(address) {
  let best = getAccount(address)?.lastLoginAt ?? null
  for (const s of Object.values(sessions)) if (s.address === address && s.lastSeenAt && (!best || s.lastSeenAt > best)) best = s.lastSeenAt
  return best
}

/** Ends every session of a wallet (used when an admin blocks it). */
export function deleteSessionsOf(address) {
  for (const [h, s] of Object.entries(sessions)) if (s.address === address) delete sessions[h]
  saveSessions()
}

/* ----------------------------------------------------------- enquiries --- */

let enquiries = readFile(ENQUIRIES, [])
export const listEnquiries = () => enquiries

export function addEnquiry(e) {
  enquiries.push({ id: randomToken(9), receivedAt: new Date().toISOString(), ...e })
  if (enquiries.length > 5000) enquiries = enquiries.slice(-5000)
  try {
    writeFile(ENQUIRIES, enquiries)
  } catch {
    /* kept in memory */
  }
}

export function markEnquiry(id, handled) {
  const e = enquiries.find((x) => x.id === id)
  if (!e) return false
  e.handled = handled
  writeFile(ENQUIRIES, enquiries)
  return true
}

/* --------------------------------------------------------- launch list --- */

// People who asked to hear when the next project launches: [{ email, slot, addedAt }], one row per email+slot.
let launchList = readFile(LAUNCH_LIST, [])
export const listLaunch = () => launchList

/** Adds an email; returns false when it was already on the list for that slot. */
export function addToLaunchList(email, slot) {
  if (launchList.some((r) => r.email === email && r.slot === slot)) return false
  launchList.push({ email, slot, addedAt: new Date().toISOString() })
  try {
    writeFile(LAUNCH_LIST, launchList)
  } catch {
    /* kept in memory */
  }
  return true
}

/* ------------------------------------------- Chain Kit and Gully Chains --- */

// Chain Kit explorer requests and the Gully Chains devnet waitlist, made from the app (developer.mjs):
// { requests: [{ at, address, workspace, email, chain, status }], waitlist: [{ at, address, workspace, email }] }.
// One request per workspace (a new one replaces the old) and one waitlist row per wallet.
let chainKit = readFile(CHAIN_KIT, { requests: [], waitlist: [] })
chainKit.requests ??= []
chainKit.waitlist ??= []
const saveChainKit = () => {
  try {
    writeFile(CHAIN_KIT, chainKit)
  } catch {
    /* kept in memory */
  }
}

/** Every Chain Kit request, oldest first (admin and stats). */
export const chainKitRequests = () => chainKit.requests
/** Everyone on the Gully Chains devnet waitlist, oldest first. */
export const chainsWaitlist = () => chainKit.waitlist

export const chainKitRequestOf = (workspace) => chainKit.requests.findLast((r) => r.workspace === workspace) ?? null
export const waitlistRowOf = (address) => chainKit.waitlist.find((r) => r.address === address) ?? null

export function addChainKitRequest({ address, workspace, email, chain }) {
  chainKit.requests = chainKit.requests.filter((r) => r.workspace !== workspace)
  const row = { at: new Date().toISOString(), address, workspace, email, chain: chain || null, status: 'received' }
  chainKit.requests.push(row)
  if (chainKit.requests.length > 5000) chainKit.requests = chainKit.requests.slice(-5000)
  saveChainKit()
  return row
}

/** Joins the waitlist; returns { row, already }. */
export function joinChainsWaitlist({ address, workspace, email }) {
  const old = waitlistRowOf(address)
  if (old) return { row: old, already: true }
  const row = { at: new Date().toISOString(), address, workspace, email }
  chainKit.waitlist.push(row)
  saveChainKit()
  return { row, already: false }
}

/** Requests and waitlist sign-ups per UTC day over the last `days` days, oldest first. */
export function chainKitDaily(days = 30, now = Date.now()) {
  const out = []
  const idx = new Map()
  for (let i = days - 1; i >= 0; i--) {
    const day = new Date(now - i * 86_400_000).toISOString().slice(0, 10)
    idx.set(day, out.length)
    out.push({ day, requests: 0, waitlist: 0 })
  }
  for (const r of chainKit.requests) {
    const i = idx.get(String(r.at).slice(0, 10))
    if (i !== undefined) out[i].requests++
  }
  for (const r of chainKit.waitlist) {
    const i = idx.get(String(r.at).slice(0, 10))
    if (i !== undefined) out[i].waitlist++
  }
  return out
}
