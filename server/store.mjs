// Small durable store for the developer programme and contact enquiries, kept as JSON files in
// DATA_DIR (the gully-web-data volume in production). Writes are atomic (tmp + rename). Secrets
// are never stored in the clear: API keys and claim codes are kept as SHA-256 hashes.

import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { DATA_DIR } from './http.mjs'

const FILE = path.join(DATA_DIR, 'developers.json')
const ENQUIRIES = path.join(DATA_DIR, 'enquiries.json')

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

// { requests: [{ id, email, project, url, use, claimHash, status, createdAt, decidedAt, keyId, claimedAt }],
//   keys: [{ id, hash, prefix, requestId, project, email, limit, createdAt, revokedAt }] }
let db = readFile(FILE, { requests: [], keys: [] })

export const developers = () => db
export function saveDevelopers() {
  writeFile(FILE, db)
}

export const KEY_LIMIT_PER_MIN = 600

/** A new API key: returns the plaintext once; only its hash is stored. */
export function issueKey({ requestId, project, email }) {
  const secret = `gl_live_${randomToken(24)}`
  const key = { id: randomToken(9), hash: sha256(secret), prefix: secret.slice(0, 14), requestId, project, email, limit: KEY_LIMIT_PER_MIN, createdAt: new Date().toISOString(), revokedAt: null }
  db.keys.push(key)
  saveDevelopers()
  return { key, secret }
}

/** The live key matching a plaintext secret, or null. */
export function findKey(secret) {
  if (!secret || !secret.startsWith('gl_live_')) return null
  const h = sha256(secret)
  return db.keys.find((k) => !k.revokedAt && k.hash === h) ?? null
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
