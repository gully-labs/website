// The ecosystem page and the launchpad submissions (src/pages/Ecosystem.tsx, src/pages/Partners.tsx).
//
//   GET  /api/ecosystem                     { chains, launchpads }  the chains a launchpad can list and, when the Holder Map
//                                           has a launchpad registry (holders-launchpads.mjs listLaunchpads), its launchpads
//                                           (null when there is no registry, so the page hides that section)
//   POST /api/ecosystem/submissions         "List your launchpad" (public, rate limited, honeypot, size limited).
//                                           It is only STORED: nothing is ever listed automatically.
//   GET  /api/admin/ecosystem/submissions   the stored submissions, newest first (admin token)
//   POST /api/admin/ecosystem/submissions   { id, action: 'approve' | 'reject' } -> { submission, registryEntry? }
//                                           Approving marks the submission and returns the registry entry text for an
//                                           admin to paste into the registry by hand; it changes nothing else.
//
// Stored in DATA_DIR/ecosystem-submissions.json (atomic writes). Every text field is validated against a strict
// character set or HTML-escaped before it is stored, so nothing stored can carry markup.

import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { clientIp, DATA_DIR, json } from './http.mjs'
import { HOLDER_CHAINS } from './holders.mjs'
import { notifyIntake, sendCsv, toCsv } from './intake-notify.mjs'

const FILE = () => path.join(DATA_DIR, 'ecosystem-submissions.json')
export const MAX_BODY = 6_000
export const RATE = { perHour: 5, windowMs: 3_600_000 }
export const MAX_PENDING = 200
export const MAX_STORED = 1_000

/** The chains a launchpad can be listed on: the ones the Holder Map reads. */
export const ecosystemChains = () => Object.entries(HOLDER_CHAINS).map(([key, c]) => ({ key, name: c.name, solana: key === 'solana' }))

const EMAIL_RE = /^[^@\s<>"']{1,64}@[^@\s<>"']{1,190}\.[^@\s<>"']{2,24}$/
const TELEGRAM_RE = /^(@[A-Za-z][A-Za-z0-9_]{4,31}|https:\/\/t\.me\/[A-Za-z][A-Za-z0-9_]{4,31})$/
const NAME_RE = /^[\p{L}\p{N}][\p{L}\p{N} .&'_+!:-]{1,59}$/u
const EVM_ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/
const SOLANA_ADDRESS_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/
const PARAM = '[A-Za-z0-9_\\[\\]]{1,40}(?: indexed)?(?: [A-Za-z_][A-Za-z0-9_]{0,31})?'
const EVENT_SIGNATURE_RE = new RegExp(`^[A-Za-z_][A-Za-z0-9_]{0,63}\\((?:${PARAM})?(?:, ?${PARAM}){0,15}\\)$`)
const TOPIC_RE = /^0x[0-9a-fA-F]{64}$/

export const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
const unesc = (s) => String(s).replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&amp;/g, '&')
// Control characters become spaces; one more than the limit is kept so an over-long value is seen as too long.
const clean = (v, max) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max + 1) : '')

/** A public https URL: no credentials, no loopback or private hosts, no whitespace. Returns its normal form or null. */
export function publicUrl(v) {
  const s = clean(v, 300)
  if (!s || s.length > 300 || /\s/.test(s)) return null
  let u
  try {
    u = new URL(s)
  } catch {
    return null
  }
  if (u.protocol !== 'https:' || u.username || u.password) return null
  const h = u.hostname.toLowerCase()
  if (!h.includes('.') || h.endsWith('.local') || h.endsWith('.internal') || h === 'localhost') return null
  if (/^\d+\.\d+\.\d+\.\d+$/.test(h) || h.startsWith('[')) return null
  return u.href
}

/** Checks a submission body. Returns { ok: true, value } or { ok: false, error, field }. */
export function validateSubmission(b) {
  const bad = (field, error) => ({ ok: false, field, error })
  if (!b || typeof b !== 'object' || Array.isArray(b)) return bad('body', 'Send the form as JSON.')
  const name = clean(b.name, 60)
  if (!NAME_RE.test(name) || name.length > 60) return bad('name', "Name: 2 to 60 letters, numbers, spaces and . & ' _ + ! : - only.")
  const url = publicUrl(b.url)
  if (!url) return bad('url', 'Website: a public https:// address.')
  const contact = clean(b.contact, 120)
  if (contact.length > 120 || !(EMAIL_RE.test(contact) || TELEGRAM_RE.test(contact))) return bad('contact', 'Contact: an email, or a Telegram @handle or t.me link.')
  const known = new Set(ecosystemChains().map((c) => c.key))
  if (!Array.isArray(b.chains) || b.chains.length < 1 || b.chains.length > known.size) return bad('chains', 'Pick at least one supported chain.')
  const chains = [...new Set(b.chains.map((c) => clean(c, 20).toLowerCase()))]
  if (chains.some((c) => !known.has(c))) return bad('chains', 'Pick chains from the supported list.')

  const factoryRaw = clean(b.factory, 64)
  const eventRaw = clean(b.eventSignature, 200)
  const lookupRaw = clean(b.lookupUrl, 300)
  const hasFactory = !!factoryRaw || !!eventRaw
  if (!hasFactory && !lookupRaw) return bad('factory', 'Give a factory or hook address with its creation event, or a token-lookup API URL.')
  let factory = null
  let eventSignature = null
  let lookupUrl = null
  if (hasFactory) {
    if (!factoryRaw || !eventRaw) return bad(factoryRaw ? 'eventSignature' : 'factory', 'A factory address needs its creation-event signature, and the other way round.')
    const onlySolana = chains.every((c) => c === 'solana')
    if (chains.includes('solana') && !onlySolana) return bad('chains', 'Submit a Solana launchpad separately from EVM chains: the address formats differ.')
    if (onlySolana ? !SOLANA_ADDRESS_RE.test(factoryRaw) : !EVM_ADDRESS_RE.test(factoryRaw)) return bad('factory', onlySolana ? 'Factory: a Solana program address (base58).' : 'Factory or hook: a 0x address with 40 hex characters.')
    if (eventRaw.length > 200 || !(EVENT_SIGNATURE_RE.test(eventRaw) || TOPIC_RE.test(eventRaw))) return bad('eventSignature', 'Creation event: a signature such as TokenCreated(address,address,string) or its 0x topic hash.')
    factory = factoryRaw
    eventSignature = eventRaw
  }
  if (lookupRaw) {
    lookupUrl = publicUrl(lookupRaw)
    if (!lookupUrl) return bad('lookupUrl', 'Token-lookup API: a public https:// address.')
  }
  const note = clean(b.note, 500)
  if (note.length > 500) return bad('note', 'Note: at most 500 characters.')
  return { ok: true, value: { name, url, contact: esc(contact), chains, factory, eventSignature: eventSignature && esc(eventSignature), lookupUrl, note: esc(note) } }
}

/** The JSON body, or { tooBig: true } past `max` bytes (answered 413; the rest of the upload is discarded), or null on bad JSON. */
function readBody(req, max) {
  return new Promise((resolve) => {
    let body = ''
    let big = false
    req.on('data', (c) => {
      if (big) return
      body += c
      if (body.length > max) {
        big = true
        body = ''
        resolve({ tooBig: true })
      }
    })
    req.on('end', () => {
      if (big) return
      try {
        resolve(JSON.parse(body || 'null'))
      } catch {
        resolve(null)
      }
    })
    req.on('error', () => resolve(null))
  })
}

/* -------------------------------------------------------------- storage --- */

function read() {
  try {
    const d = JSON.parse(fs.readFileSync(FILE(), 'utf8'))
    return Array.isArray(d.submissions) ? d : { submissions: [] }
  } catch {
    return { submissions: [] }
  }
}
function write(d) {
  fs.mkdirSync(path.dirname(FILE()), { recursive: true })
  fs.writeFileSync(FILE() + '.tmp', JSON.stringify(d))
  fs.renameSync(FILE() + '.tmp', FILE())
}

export const listSubmissions = () => [...read().submissions].reverse()

const hits = new Map()
function limited(ip) {
  const now = Date.now()
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < RATE.windowMs)
  if (recent.length >= RATE.perHour) {
    hits.set(ip, recent)
    return true
  }
  hits.set(ip, [...recent, now])
  if (hits.size > 5_000) for (const [k, v] of hits) if (!v.some((t) => now - t < RATE.windowMs)) hits.delete(k)
  return false
}

/** The registry entry text an admin pastes by hand: a plain object literal, nothing is applied. */
export function registryEntry(s) {
  const name = unesc(s.name)
  const slug = name.toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  const lines = [`  id: '${slug}'`, `  name: '${name.replace(/'/g, "\\'")}'`, `  url: '${s.url}'`, `  chains: [${s.chains.map((c) => `'${c}'`).join(', ')}]`]
  if (s.factory) lines.push(`  factory: '${s.factory}'`, `  creationEvent: '${unesc(s.eventSignature)}'`)
  if (s.lookupUrl) lines.push(`  lookupUrl: '${s.lookupUrl}'`)
  return `{\n${lines.join(',\n')},\n}`
}

/* --------------------------------------------------------------- routes --- */

async function launchpads() {
  try {
    const m = await import('./holders-launchpads.mjs')
    if (typeof m.listLaunchpads !== 'function') return null
    const list = await m.listLaunchpads()
    if (!Array.isArray(list)) return null
    const s = (v, n = 120) => (typeof v === 'string' ? v.slice(0, n) : null)
    return list.slice(0, 200).map((l) => ({
      id: s(l.id ?? l.key, 60),
      name: s(l.name ?? l.id ?? l.key, 80),
      url: s(l.url ?? l.website, 300),
      // listLaunchpads() gives { key, id, name } per chain; older shapes gave the key string. Either becomes a display name.
      chains: Array.isArray(l.chains) ? l.chains.map((c) => s(typeof c === 'string' ? c : String(c?.name ?? c?.key ?? ''), 30)).filter(Boolean).slice(0, 12) : [],
    }))
  } catch {
    return null
  }
}

/** Public routes: GET /api/ecosystem and POST /api/ecosystem/submissions. Resolves true when answered. */
export async function handleEcosystem(req, res, url) {
  const p = url.pathname.replace(/\/+$/, '')
  if (p === '/api/ecosystem') {
    if (req.method !== 'GET') return json(res, 405, { error: 'GET only' }, { Allow: 'GET' }), true
    return json(res, 200, { chains: ecosystemChains(), launchpads: await launchpads() }, { 'Cache-Control': 'public, max-age=60' }), true
  }
  if (p !== '/api/ecosystem/submissions') return false
  if (req.method !== 'POST') return json(res, 405, { error: 'POST only' }, { Allow: 'POST' }), true
  if (limited(clientIp(req))) return json(res, 429, { error: 'Too many submissions from this address. Try again later.' }), true
  const body = await readBody(req, MAX_BODY)
  if (body?.tooBig) return json(res, 413, { error: 'That is too large: 6 KB at most.' }, { Connection: 'close' }), true
  if (!body) return json(res, 400, { error: 'Send the form as JSON.' }), true
  // The honeypot: a field no person sees. A bot that fills it is told it worked and nothing is stored.
  if (typeof body.company === 'string' && body.company.trim()) return json(res, 200, { ok: true }), true
  const v = validateSubmission(body)
  if (!v.ok) return json(res, 400, { error: v.error, field: v.field }), true
  const d = read()
  if (d.submissions.filter((s) => s.status === 'pending').length >= MAX_PENDING) return json(res, 503, { error: 'The review queue is full. Please try again later or write to team@gullylabs.xyz.' }), true
  d.submissions.push({ id: `es_${crypto.randomBytes(9).toString('base64url')}`, ...v.value, status: 'pending', createdAt: new Date().toISOString(), decidedAt: null })
  if (d.submissions.length > MAX_STORED) d.submissions = [...d.submissions.filter((s) => s.status === 'pending'), ...d.submissions.filter((s) => s.status !== 'pending').slice(-(MAX_STORED - MAX_PENDING))]
  write(d)
  const x = v.value
  void notifyIntake({
    kind: 'ecosystem',
    title: `New launchpad submission: ${unesc(x.name)}`,
    fields: [['Website', x.url], ['Contact', unesc(x.contact)], ['Chains', x.chains.join(', ')], ['Factory', x.factory], ['Event', x.eventSignature && unesc(x.eventSignature)], ['Note', unesc(x.note)]],
    contact: unesc(x.contact),
  })
  return json(res, 200, { ok: true }), true
}

/** Admin routes (the caller has already checked the admin token): list, approve, reject. */
const CSV_COLUMNS = [
  ['submitted_at', (s) => s.createdAt],
  ['status', (s) => s.status],
  ['name', (s) => unesc(s.name)],
  ['website', (s) => s.url],
  ['contact', (s) => unesc(s.contact)],
  ['chains', (s) => (s.chains ?? []).join(' ')],
  ['factory', (s) => s.factory],
  ['creation_event', (s) => s.eventSignature && unesc(s.eventSignature)],
  ['lookup_url', (s) => s.lookupUrl],
  ['note', (s) => unesc(s.note)],
  ['decided_at', (s) => s.decidedAt],
]

export async function handleEcosystemAdmin(req, res) {
  if (req.method === 'GET') {
    const submissions = listSubmissions()
    if (new URL(req.url, 'http://x').searchParams.get('format') === 'csv') return sendCsv(res, 'ecosystem-submissions.csv', toCsv(CSV_COLUMNS, submissions))
    const count = (st) => submissions.filter((s) => s.status === st).length
    return json(res, 200, { submissions, counts: { pending: count('pending'), approved: count('approved'), rejected: count('rejected') } }), true
  }
  if (req.method !== 'POST') return json(res, 405, { error: 'GET or POST only' }, { Allow: 'GET, POST' }), true
  const body = await readBody(req, 1_000)
  if (!body || typeof body.id !== 'string' || !['approve', 'reject'].includes(body.action)) return json(res, 400, { error: 'Send { id, action: "approve" | "reject" }.' }), true
  const d = read()
  const s = d.submissions.find((x) => x.id === body.id)
  if (!s) return json(res, 404, { error: 'No such submission.' }), true
  if (s.status !== 'pending') return json(res, 409, { error: `Already ${s.status}.` }), true
  s.status = body.action === 'approve' ? 'approved' : 'rejected'
  s.decidedAt = new Date().toISOString()
  write(d)
  // Approval only marks the submission: the entry text is for an admin to paste into the registry by hand.
  if (s.status === 'approved') return json(res, 200, { submission: s, registryEntry: registryEntry(s) }), true
  return json(res, 200, { submission: s }), true
}
