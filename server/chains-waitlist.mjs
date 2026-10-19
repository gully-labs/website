// Gully Chains waitlist: POST /api/chains/waitlist (public), GET /api/chains/plans (public, prices from
// chains-plans.mjs) and GET /api/admin/chains/waitlist (admin, called from admin.mjs after its bearer check).
//
// The form follows the contact form's pattern (server.mjs handleContact): JSON in, size-capped, saved to a file in
// DATA_DIR for the admin dashboard. On top of that: a per-IP rate limit, a honeypot field (`website`) answered
// like a success and stored nowhere, only the listed choices accepted, and every free-text value stored
// escaped (HTML characters as entities, control characters removed), so a stored row is safe to print anywhere.

import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { publicChains, WAITLIST_CHOICES } from './chains-plans.mjs'
import { clientIp, DATA_DIR, json, readJson } from './http.mjs'
import { decodeEntities, notifyIntake, sendCsv, toCsv } from './intake-notify.mjs'

const MAX_BODY = 8_000
const MAX_ROWS = 5_000
const PER_IP = 5
const WINDOW_MS = 3_600_000
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/
const TELEGRAM_RE = /^@?[A-Za-z][A-Za-z0-9_]{4,31}$/

const file = () => path.join(DATA_DIR, 'chains-waitlist.json')
let rows = null
function load() {
  if (rows) return rows
  try {
    rows = JSON.parse(fs.readFileSync(file(), 'utf8'))
    if (!Array.isArray(rows)) rows = []
  } catch {
    rows = []
  }
  return rows
}
function save() {
  fs.mkdirSync(path.dirname(file()), { recursive: true })
  fs.writeFileSync(file() + '.tmp', JSON.stringify(rows))
  fs.renameSync(file() + '.tmp', file())
}

/** Control characters out, cut to `n` characters, then HTML-significant characters as entities. */
export function clean(v, n) {
  const s = typeof v === 'string' ? v.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').trim().slice(0, n) : ''
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

const hits = new Map()
function allow(ip) {
  const now = Date.now()
  const list = (hits.get(ip) ?? []).filter((t) => now - t < WINDOW_MS)
  if (list.length >= PER_IP) return hits.set(ip, list), false
  list.push(now)
  hits.set(ip, list)
  return true
}
setInterval(() => {
  const now = Date.now()
  for (const [k, list] of hits) if (!list.some((t) => now - t < WINDOW_MS)) hits.delete(k)
}, 600_000).unref?.()

// The questions are optional: left out they are stored as '' (not given); a value that is given must be a listed one.
const given = (v) => v === undefined || v === null || v === ''
const oneOf = (field, v) => (given(v) ? '' : WAITLIST_CHOICES[field].some(([k]) => k === v) ? v : null)
const yesNo = (v) => (given(v) ? '' : v === 'yes' || v === true ? 'yes' : v === 'no' || v === false ? 'no' : null)

/** Validates a body. { ok: true, row } or { ok: false, error }. */
export function readEntry(b) {
  const project = clean(b?.project, 80)
  if (!project) return { ok: false, error: 'Please tell us the project name.' }
  const rawContact = typeof b?.contact === 'string' ? b.contact.trim() : ''
  let contact = ''
  if (EMAIL_RE.test(rawContact) && rawContact.length <= 254) contact = rawContact.toLowerCase()
  else if (TELEGRAM_RE.test(rawContact)) contact = '@' + rawContact.replace(/^@/, '')
  else return { ok: false, error: 'Please give an email or a Telegram handle (like @yourname) so we can reach you.' }
  const useCase = oneOf('useCase', b?.useCase)
  const scale = oneOf('scale', b?.scale)
  const gasToken = oneOf('gasToken', b?.gasToken)
  const da = oneOf('da', b?.da)
  const wantsAa = yesNo(b?.wantsAa)
  const wantsDeepcore = yesNo(b?.wantsDeepcore)
  if ([useCase, scale, gasToken, da, wantsAa, wantsDeepcore].includes(null)) return { ok: false, error: 'One of the answers is not a listed choice.' }
  return { ok: true, row: { project, contact: clean(contact, 254), useCase, scale, gasToken, da, wantsAa, wantsDeepcore, notes: clean(b?.notes, 2000) } }
}

/** Every stored row, oldest first (the daily digest counts them). */
export const waitlistRows = () => load()

const CSV_COLUMNS = [
  ['signed_up_at', (r) => r.at],
  ['project', (r) => decodeEntities(r.project)],
  ['contact', (r) => decodeEntities(r.contact)],
  ['use_case', (r) => r.useCase],
  ['scale', (r) => r.scale],
  ['gas_token', (r) => r.gasToken],
  ['data_availability', (r) => r.da],
  ['wants_account_abstraction', (r) => r.wantsAa],
  ['wants_deepcore', (r) => r.wantsDeepcore],
  ['notes', (r) => decodeEntities(r.notes)],
]

/** GET /api/admin/chains/waitlist (?format=csv for a download): newest first, as stored (escaped). The caller has already checked the bearer token. */
export function handleChainsAdmin(req, res) {
  if (req.method !== 'GET') return json(res, 405, { error: 'GET only' }), true
  if (new URL(req.url, 'http://x').searchParams.get('format') === 'csv') return sendCsv(res, 'chains-waitlist.csv', toCsv(CSV_COLUMNS, [...load()].reverse()))
  const list = [...load()].reverse()
  return json(res, 200, { total: list.length, rows: list }), true
}

/* GET /api/chains/waitlist/stats: sign-ups per UTC day, a public aggregate (counts only, never a name or contact),
   cached 60 s. Days run from the first sign-up to today, zeros included, the newest 30 at most. */
const STATS_MS = 60_000
let statsCache = null
export function waitlistStats(now = Date.now()) {
  if (statsCache && now - statsCache.at < STATS_MS) return statsCache.body
  const list = load()
  const per = new Map()
  for (const r of list) {
    const d = String(r.at ?? '').slice(0, 10)
    if (/^\d{4}-\d{2}-\d{2}$/.test(d)) per.set(d, (per.get(d) ?? 0) + 1)
  }
  const days = []
  if (per.size) {
    const first = [...per.keys()].sort()[0]
    const end = new Date(now).toISOString().slice(0, 10)
    for (let t = Date.parse(first + 'T00:00:00Z'); days.length < 400; t += 86_400_000) {
      const d = new Date(t).toISOString().slice(0, 10)
      if (d > end) break
      days.push({ day: d, n: per.get(d) ?? 0 })
    }
  }
  const body = { days: days.slice(-30), total: list.length }
  statsCache = { at: now, body }
  return body
}
/** Tests: forget the stats cache. */
export const resetWaitlistStatsForTest = () => (statsCache = null)

/** /api/chains/*. Resolves true when it answered. */
export async function handleChains(req, res, url) {
  const p = url.pathname
  if (p === '/api/chains/plans') {
    if (req.method !== 'GET') return res.writeHead(405, { Allow: 'GET' }).end(), true
    return json(res, 200, publicChains(), { 'Cache-Control': 'public, max-age=60' }), true
  }
  if (p === '/api/chains/waitlist/stats') {
    if (req.method !== 'GET') return res.writeHead(405, { Allow: 'GET' }).end(), true
    return json(res, 200, waitlistStats(), { 'Cache-Control': 'public, max-age=60' }), true
  }
  if (p === '/api/chains/waitlist') {
    if (req.method !== 'POST') return res.writeHead(405, { Allow: 'POST' }).end(), true
    if (req.headers['x-requested-with'] !== 'gully') return json(res, 403, { error: 'Cross-site request refused.' }), true
    if (!allow(clientIp(req))) return json(res, 429, { error: 'Too many sign-ups from this address. Try again in an hour, or write to team@gullylabs.xyz.' }), true
    const body = await readJson(req, MAX_BODY)
    if (!body || typeof body !== 'object') return json(res, 400, { error: 'The request could not be read.' }), true
    // A filled honeypot is a bot: answered like a success, stored nowhere.
    if (typeof body.website === 'string' && body.website.trim()) return json(res, 201, { ok: true }), true
    const r = readEntry(body)
    if (!r.ok) return json(res, 400, { error: r.error }), true
    const list = load()
    if (list.some((x) => x.contact === r.row.contact)) return json(res, 200, { ok: true, alreadyOnList: true }), true
    statsCache = null
    list.push({ id: crypto.randomBytes(9).toString('base64url'), at: new Date().toISOString(), ...r.row })
    if (list.length > MAX_ROWS) list.splice(0, list.length - MAX_ROWS)
    try {
      save()
    } catch {
      /* kept in memory */
    }
    // Tell the operators (and thank the submitter when they are on the bot); never delays or fails the sign-up.
    const x = r.row
    void notifyIntake({
      kind: 'chains-waitlist',
      title: `New Gully Chains waitlist sign-up: ${decodeEntities(x.project)}`,
      fields: [['Contact', decodeEntities(x.contact)], ['Use case', x.useCase], ['Scale', x.scale], ['Gas token', x.gasToken], ['DA', x.da], ['Account abstraction', x.wantsAa], ['DeepCore', x.wantsDeepcore], ['Notes', decodeEntities(x.notes)]],
      contact: decodeEntities(x.contact),
    })
    return json(res, 201, { ok: true, alreadyOnList: false }), true
  }
  return false
}
