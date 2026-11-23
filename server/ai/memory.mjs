// Opt-in conversation memory (flag ASK_MEMORY=1). Per signed-in user and workspace; the user can delete it.
// Stores short notes only, keyed by an HMAC of workspace + wallet (never the raw address), short retention
// (default 14 days, max 90). Nothing is stored unless the user turned memory on; "forget" removes every row.
// File-backed JSON like the rest of this server. Flag off = every function is inert.
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { DATA_DIR } from '../http.mjs'

export const memoryOn = () => process.env.ASK_MEMORY === '1'
const FILE = () => path.join(process.env.DATA_DIR ?? DATA_DIR, 'ask-memory.json')
const RETENTION_DAYS = () => Math.min(90, Math.max(1, Number(process.env.ASK_MEMORY_DAYS) || 14))
const MAX_NOTES = 8
const salt = () => String(process.env.ASK_LOG_SALT ?? '').trim() || 'gully-ai-memory-dev'
export const memKey = (workspaceId, wallet) => crypto.createHmac('sha256', salt()).update(`${workspaceId}|${String(wallet).toLowerCase()}`).digest('hex').slice(0, 24)

const read = () => {
  try {
    return JSON.parse(fs.readFileSync(FILE(), 'utf8'))
  } catch {
    return { users: {} }
  }
}
const write = (d) => {
  fs.mkdirSync(path.dirname(FILE()), { recursive: true })
  fs.writeFileSync(FILE() + '.tmp', JSON.stringify(d))
  fs.renameSync(FILE() + '.tmp', FILE())
}
const fresh = (n, now) => now - Date.parse(n.at) < RETENTION_DAYS() * 86_400_000

export function getMemory(key, now = Date.now()) {
  if (!memoryOn()) return { enabled: false, notes: [] }
  const u = read().users[key]
  return { enabled: !!u?.enabled, notes: (u?.notes ?? []).filter((n) => fresh(n, now)).map((n) => n.text) }
}
export function setEnabled(key, on) {
  if (!memoryOn()) return false
  const d = read()
  d.users[key] = { ...(d.users[key] ?? { notes: [] }), enabled: !!on }
  if (!on) d.users[key].notes = []
  write(d)
  return true
}
/** Adds a short note (<= 240 chars) only when the user opted in. */
export function addNote(key, text, now = Date.now()) {
  if (!memoryOn()) return false
  const d = read()
  const u = d.users[key]
  if (!u?.enabled) return false
  u.notes = [...u.notes.filter((n) => fresh(n, now)), { at: new Date(now).toISOString(), text: String(text).slice(0, 240) }].slice(-MAX_NOTES)
  write(d)
  return true
}
export function forget(key) {
  const d = read()
  delete d.users[key]
  write(d)
}
export function prune(now = Date.now()) {
  const d = read()
  for (const k of Object.keys(d.users)) d.users[k].notes = (d.users[k].notes ?? []).filter((n) => fresh(n, now))
  write(d)
}
/** The text added to the system prompt, or null. */
export const memoryPrompt = (key) => {
  const m = getMemory(key)
  return m.enabled && m.notes.length ? `What the user chose to let you remember (may be stale; the docs win):\n- ${m.notes.join('\n- ')}` : null
}
