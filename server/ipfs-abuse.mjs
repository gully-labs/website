// Gully IPFS abuse reports: anyone may report a CID or gateway link; a person in the admin queue decides.
//   POST /api/ipfs/report   { cid | url, category, details?, email?, name? }  -> 201 { ok: true, id }
//   GET  /api/ipfs/report/categories                                           -> the category list the form shows
// Admin (admin.mjs): GET /api/admin/ipfs/reports, POST /api/admin/ipfs/reports/:id/takedown | dismiss.
//
// A report never removes anything by itself (so a report cannot be used as a weapon): a takedown goes through the
// existing path, ipfsTakedown in ipfs-pins.mjs (unpin everywhere, purge, gateway denylist, SHA-256 denylist). Reports of
// the most serious categories sort first in the queue. The reporter's email is kept only to answer them and never shown
// to anyone but admins. Rate limits: 5 an hour per IP, 200 a day in all, one open report per (CID, IP) a day.
// The wording of the policy this serves is a DRAFT until the owner and counsel approve it (docs/ipfs-content-policy-DRAFT.md).

import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { clientIp, DATA_DIR, json, readJson } from './http.mjs'
import { ipfsTakedown, validCid } from './ipfs-pins.mjs'

export const REPORT_CATEGORIES = [
  { id: 'csam', label: 'Child sexual abuse material', priority: 0 },
  { id: 'illegal', label: 'Other illegal content (terrorism, trafficking, threats)', priority: 1 },
  { id: 'malware', label: 'Malware or phishing', priority: 2 },
  { id: 'copyright', label: 'Copyright or trademark', priority: 3 },
  { id: 'privacy', label: 'Private information or non-consensual imagery', priority: 1 },
  { id: 'other', label: 'Something else', priority: 4 },
]
const CATS = new Map(REPORT_CATEGORIES.map((c) => [c.id, c]))
const FILE = () => path.join(process.env.IPFS_PINS_DIR || DATA_DIR, 'ipfs-reports.json')

let db = null
function load() {
  if (db) return db
  try {
    db = JSON.parse(fs.readFileSync(FILE(), 'utf8'))
  } catch {
    db = {}
  }
  db.reports ??= []
  return db
}
function save() {
  const f = FILE()
  fs.mkdirSync(path.dirname(f), { recursive: true })
  fs.writeFileSync(f + '.tmp', JSON.stringify(db))
  fs.renameSync(f + '.tmp', f)
}

const windows = new Map()
function allow(bucket, id, limit, ms) {
  const k = `${bucket}:${id}`
  const t = Date.now()
  let w = windows.get(k)
  if (!w || t - w.at >= ms) w = { at: t, n: 0 }
  w.n++
  windows.set(k, w)
  if (windows.size > 10_000) for (const [kk, ww] of windows) if (t - ww.at > 3_600_000) windows.delete(kk)
  return w.n <= limit
}

/** The CID in a bare CID, /ipfs/<cid>[/path] or a gateway URL (ours or any public one); null when there is none. */
export function cidOf(input) {
  const s = String(input ?? '').trim().slice(0, 600)
  if (validCid(s)) return s
  const m = s.match(/\/ipfs\/([A-Za-z0-9]{20,200})/) ?? s.match(/^https?:\/\/([a-z0-9]{20,200})\.ipfs\./i)
  return m && validCid(m[1]) ? m[1] : null
}

const clean = (v, n) => String(v ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, n)
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,24}$/

/** Files one report. Returns { status, body }. */
export function fileReport(input, ip) {
  if (!allow('report-ip', ip, 5, 3_600_000)) return { status: 429, body: { error: 'Too many reports from this address. Try again in an hour.' } }
  if (!allow('report-all', 'all', 200, 86_400_000)) return { status: 429, body: { error: 'The report line is busy. Try again later.' } }
  if (input?.website) return { status: 201, body: { ok: true } } // honeypot: a bot filled the hidden field, answer as if filed
  const cid = cidOf(input?.cid ?? input?.url)
  if (!cid) return { status: 400, body: { error: 'Give the CID or the gateway link of the content (it starts with bafy…, bafk… or Qm…).' } }
  const cat = CATS.get(String(input?.category ?? ''))
  if (!cat) return { status: 400, body: { error: 'Choose what is wrong with it.' } }
  const email = clean(input?.email, 254)
  if (email && !EMAIL.test(email)) return { status: 400, body: { error: 'That email does not look right. Leave it empty to report without one.' } }
  const day = new Date().toISOString().slice(0, 10)
  const ipHash = crypto.createHash('sha256').update(`ipfs-report:${ip}`).digest('hex').slice(0, 20)
  const d = load()
  if (d.reports.some((r) => r.cid === cid && r.ipHash === ipHash && r.at.startsWith(day))) return { status: 200, body: { ok: true, duplicate: true } }
  const r = { id: crypto.randomBytes(9).toString('base64url'), cid, category: cat.id, details: clean(input?.details, 2000), email: email || null, name: clean(input?.name, 120) || null, ipHash, at: new Date().toISOString(), state: 'open' }
  d.reports.push(r)
  if (d.reports.length > 5000) d.reports.splice(0, d.reports.length - 5000)
  save()
  return { status: 201, body: { ok: true, id: r.id } }
}

/** Open reports first (most serious category, then oldest), then the last 100 decided. */
export function ipfsReports() {
  const prio = (r) => CATS.get(r.category)?.priority ?? 9
  const all = load().reports
  const open = all.filter((r) => r.state === 'open').sort((a, b) => prio(a) - prio(b) || (a.at < b.at ? -1 : 1))
  const done = all.filter((r) => r.state !== 'open').sort((a, b) => ((b.decidedAt ?? '') < (a.decidedAt ?? '') ? -1 : 1)).slice(0, 100)
  const view = (r) => ({ id: r.id, cid: r.cid, category: r.category, details: r.details, email: r.email, name: r.name, at: r.at, state: r.state, decidedAt: r.decidedAt ?? null, by: r.by ?? null })
  return [...open, ...done].map(view)
}

/** An admin's decision on a report: 'takedown' goes through ipfsTakedown (every open report of that CID is closed with it), 'dismiss' closes this one. */
export async function decideReport(id, action, by) {
  const r = load().reports.find((x) => x.id === id)
  if (!r) return { status: 404, body: { error: 'No such report.' } }
  if (r.state !== 'open') return { status: 409, body: { error: 'Already decided.' } }
  const now = new Date().toISOString()
  if (action === 'dismiss') {
    Object.assign(r, { state: 'dismissed', by: by ?? null, decidedAt: now })
    save()
    return { status: 200, body: { ok: true } }
  }
  if (action !== 'takedown') return { status: 400, body: { error: 'takedown or dismiss' } }
  const out = await ipfsTakedown(r.cid, `report ${r.category}`, by ?? 'admin')
  if (out.error) return { status: 400, body: { error: out.error } }
  for (const x of load().reports.filter((y) => y.cid === r.cid && y.state === 'open')) Object.assign(x, { state: 'actioned', by: by ?? null, decidedAt: now })
  save()
  return { status: 200, body: { ok: true, cid: r.cid } }
}

/** /api/ipfs/report*. Returns true when it answered. */
export async function handleIpfsAbuse(req, res, url) {
  const p = url.pathname
  if (p === '/api/ipfs/report/categories') {
    if (req.method !== 'GET') return json(res, 405, { error: 'GET only' }), true
    return json(res, 200, { categories: REPORT_CATEGORIES.map(({ id, label }) => ({ id, label })) }, { 'Cache-Control': 'public, max-age=300' }), true
  }
  if (p !== '/api/ipfs/report') return false
  if (req.method !== 'POST') return json(res, 405, { error: 'POST only' }, { Allow: 'POST' }), true
  // CSRF-style guard like the rest of the site's POSTs: a cross-site form post cannot set this header.
  if (req.headers['x-requested-with'] !== 'gully') return json(res, 403, { error: 'Send the report from the form.' }), true
  let body
  try {
    body = await readJson(req, 8_000)
  } catch {
    return json(res, 400, { error: 'The report did not arrive whole.' }), true
  }
  const out = fileReport(body, clientIp(req))
  return json(res, out.status, out.body), true
}

/** Tests: forget the in-memory db and windows. */
export function _resetIpfsAbuse() {
  db = null
  windows.clear()
}
