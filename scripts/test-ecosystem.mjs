// Tests for the ecosystem page's server side: GET /api/ecosystem, "List your launchpad" submissions
// (validation, honeypot, size limit, rate limit, nothing listed automatically), the admin list / approve /
// reject routes and their auth, and the SEO entries for /ecosystem and /partners.
//
//   node scripts/test-ecosystem.mjs      (no build needed)
//
// The real server runs in this process on TEST_PORT (default 9081) with a fresh temporary DATA_DIR.

import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { makeChecker, guardTestRun } from './test-helpers.mjs'

const PORT = Number(process.env.TEST_PORT) || 9081
await guardTestRun(PORT)
const BASE = `http://localhost:${PORT}`
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gully-ecosystem-'))
const ADMIN = crypto.randomBytes(24).toString('hex')
const t = makeChecker()
const { check } = t

Object.assign(process.env, { PORT: String(PORT), DATA_DIR: tmp, TRACKER_DATA: path.join(tmp, 'tracker-history.json'), DIST_DIR: path.join(tmp, 'no-dist'), ADMIN_TOKEN: ADMIN, TRACKER_LOOP: 'off' })
await import('../server/server.mjs')
await new Promise((r) => setTimeout(r, 300))

let ipN = 0
/** A call as a fresh visitor address (the rate limit is per IP; Cloudflare's header names it). */
async function call(p, { method = 'GET', body, raw, ip, token } = {}) {
  const headers = { 'content-type': 'application/json', 'cf-connecting-ip': ip ?? `198.51.100.${++ipN}` }
  if (token) headers.authorization = `Bearer ${token}`
  const r = await fetch(BASE + p, { method, headers, body: raw ?? (body === undefined ? undefined : JSON.stringify(body)) })
  const text = await r.text()
  let data = null
  try {
    data = JSON.parse(text)
  } catch {
    /* not json */
  }
  return { status: r.status, data, text }
}
const submit = (b, o) => call('/api/ecosystem/submissions', { method: 'POST', body: b, ...o })
const admin = (p, method = 'GET', body) => call(p, { method, body, token: ADMIN })
const stored = () => admin('/api/admin/ecosystem/submissions').then((r) => r.data)

const GOOD = {
  name: 'Example Pad',
  url: 'https://example-pad.xyz/',
  contact: 'team@example-pad.xyz',
  chains: ['base', 'bsc'],
  factory: '0x' + 'ab'.repeat(20),
  eventSignature: 'TokenCreated(address,address,string)',
}

try {
  /* ------------------------------------------------------------ public read --- */
  const eco = await call('/api/ecosystem')
  check('GET /api/ecosystem answers 200', eco.status === 200)
  check('it lists the supported chains', Array.isArray(eco.data?.chains) && eco.data.chains.some((c) => c.key === 'base') && eco.data.chains.some((c) => c.key === 'solana'))
  check('launchpads is null or a list (hidden while there is no registry)', eco.data?.launchpads === null || Array.isArray(eco.data?.launchpads))
  // The registry gives chains as { key, id, name }: the page shows names, never "[object Object]".
  check('launchpad chains are display names (strings)', (eco.data?.launchpads ?? []).every((l) => l.chains.every((c) => typeof c === 'string' && c !== '[object Object]')))
  check('POST /api/ecosystem is refused', (await call('/api/ecosystem', { method: 'POST', body: {} })).status === 405)
  check('GET on the submissions route is refused', (await call('/api/ecosystem/submissions')).status === 405)

  /* ------------------------------------------------------------- validation --- */
  const ok = await submit(GOOD)
  check('a good submission with a factory and event is accepted', ok.status === 200 && ok.data?.ok === true)
  check('a token-lookup API URL instead of a factory is accepted', (await submit({ name: 'Lookup Pad', url: 'https://lookup.pad', contact: '@lookuppad', chains: ['solana'], lookupUrl: 'https://api.lookup.pad/token/{address}' })).status === 200)
  check('an event topic hash is accepted as the creation event', (await submit({ ...GOOD, name: 'Topic Pad', eventSignature: '0x' + 'cd'.repeat(32) })).status === 200)
  check('a Solana program address is accepted on Solana', (await submit({ ...GOOD, name: 'Sol Pad', chains: ['solana'], factory: '9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin' })).status === 200)

  const rejects = [
    ['a short factory address', { factory: '0x1234' }, 'factory'],
    ['a non-hex factory address', { factory: '0x' + 'zz'.repeat(20) }, 'factory'],
    ['a Solana address on an EVM chain', { factory: '9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin' }, 'factory'],
    ['a factory without its event', { eventSignature: '' }, 'eventSignature'],
    ['an event without its factory', { factory: '' }, 'factory'],
    ['a malformed event signature', { eventSignature: 'not a signature' }, 'eventSignature'],
    ['neither a factory nor a lookup URL', { factory: '', eventSignature: '' }, 'factory'],
    ['an unsupported chain', { chains: ['mars'] }, 'chains'],
    ['no chains', { chains: [] }, 'chains'],
    ['Solana mixed with EVM chains', { chains: ['solana', 'base'] }, 'chains'],
    ['a name with markup', { name: '<script>alert(1)</script>' }, 'name'],
    ['an empty name', { name: ' ' }, 'name'],
    ['an http website', { url: 'http://example-pad.xyz' }, 'url'],
    ['a javascript: website', { url: 'javascript:alert(1)' }, 'url'],
    ['a localhost website', { url: 'https://localhost/x' }, 'url'],
    ['a website with credentials', { url: 'https://user:pw@example-pad.xyz' }, 'url'],
    ['an IP address as lookup API', { lookupUrl: 'https://10.0.0.1/x' }, 'lookupUrl'],
    ['a contact that is neither email nor Telegram', { contact: 'call me' }, 'contact'],
    ['an over-long note', { note: 'x'.repeat(501) }, 'note'],
  ]
  for (const [label, patch, field] of rejects) {
    const r = await submit({ ...GOOD, ...patch })
    check(`rejected: ${label}`, r.status === 400 && r.data?.field === field, `${r.status} ${r.data?.field ?? ''}`)
  }
  check('rejected: a body that is not JSON', (await submit(undefined, { raw: 'not json' })).status === 400)
  check('rejected: a body over the size limit (413)', (await submit({ ...GOOD, note: 'x'.repeat(8_000) })).status === 413)

  /* --------------------------------------------------------------- honeypot --- */
  const before = (await stored()).submissions.length
  const bot = await submit({ ...GOOD, name: 'Bot Pad', company: 'Spam Inc' })
  check('the honeypot answers 200 so a bot learns nothing', bot.status === 200 && bot.data?.ok === true)
  check('the honeypot stores nothing', (await stored()).submissions.length === before)

  /* -------------------------------------------------- escaping and listing --- */
  const note = await submit({ ...GOOD, name: 'Escape Pad', note: '<img src=x onerror=alert(1)> & "quotes"' })
  check('a note with markup is accepted', note.status === 200)
  const after = await stored()
  const esc = after.submissions.find((s) => s.name === 'Escape Pad')
  check('markup in the note is stored escaped', !!esc && !/[<>]/.test(esc.note) && esc.note.includes('&lt;img'), esc?.note)
  check('every stored submission starts pending', after.submissions.every((s) => s.status === 'pending'))
  check('the public list never gains a submission (no auto-listing)', !((await call('/api/ecosystem')).data?.launchpads ?? []).some((l) => /Example Pad/.test(l.name ?? '')))
  check('the submissions file is in the data dir', fs.existsSync(path.join(tmp, 'ecosystem-submissions.json')))

  /* --------------------------------------------------------------- rate limit --- */
  const ip = '203.0.113.77'
  const codes = []
  for (let i = 0; i < 7; i++) codes.push((await submit({ ...GOOD, name: `Rate Pad ${i}` }, { ip })).status)
  check('the sixth submission from one address in an hour is limited', codes.slice(0, 5).every((c) => c === 200) && codes[5] === 429 && codes[6] === 429, codes.join(','))
  check('another address is not limited', (await submit({ ...GOOD, name: 'Other Pad' })).status === 200)
  check('invalid submissions count toward the limit', await (async () => {
    const ip2 = '203.0.113.78'
    for (let i = 0; i < 5; i++) await submit({ name: '' }, { ip: ip2 })
    return (await submit(GOOD, { ip: ip2 })).status === 429
  })())

  /* ------------------------------------------------------------------ admin --- */
  check('admin list without a token is 401', (await call('/api/admin/ecosystem/submissions')).status === 401)
  check('admin list with a wrong token is 401', (await call('/api/admin/ecosystem/submissions', { token: 'x'.repeat(48) })).status === 401)
  check('admin approve without a token is 401', (await call('/api/admin/ecosystem/submissions', { method: 'POST', body: { id: 'x', action: 'approve' } })).status === 401)
  const list = await admin('/api/admin/ecosystem/submissions')
  check('admin list works with the token', list.status === 200 && list.data.submissions.length > 5 && list.data.counts.pending === list.data.submissions.length)
  check('the list is newest first', list.data.submissions[0].createdAt >= list.data.submissions.at(-1).createdAt)
  const target = list.data.submissions.find((s) => s.name === 'Example Pad')
  const bad = await admin('/api/admin/ecosystem/submissions', 'POST', { id: target.id, action: 'delete' })
  check('an unknown action is 400', bad.status === 400)
  check('an unknown id is 404', (await admin('/api/admin/ecosystem/submissions', 'POST', { id: 'es_nope', action: 'approve' })).status === 404)
  const appr = await admin('/api/admin/ecosystem/submissions', 'POST', { id: target.id, action: 'approve' })
  check('approve marks the submission approved', appr.status === 200 && appr.data.submission.status === 'approved' && !!appr.data.submission.decidedAt)
  check('approve returns the registry entry text', typeof appr.data.registryEntry === 'string' && appr.data.registryEntry.includes("name: 'Example Pad'") && appr.data.registryEntry.includes(GOOD.factory) && appr.data.registryEntry.includes("'base', 'bsc'") && appr.data.registryEntry.includes('TokenCreated(address,address,string)'), appr.data.registryEntry)
  check('approving changes nothing else: the public list is unchanged', !((await call('/api/ecosystem')).data?.launchpads ?? []).some((l) => l.name === 'Example Pad'))
  check('a decided submission cannot be decided again', (await admin('/api/admin/ecosystem/submissions', 'POST', { id: target.id, action: 'reject' })).status === 409)
  const other = list.data.submissions.find((s) => s.name === 'Lookup Pad')
  const rej = await admin('/api/admin/ecosystem/submissions', 'POST', { id: other.id, action: 'reject' })
  check('reject marks the submission rejected, with no registry entry', rej.status === 200 && rej.data.submission.status === 'rejected' && rej.data.registryEntry === undefined)
  const counts = (await stored()).counts
  check('the counts follow', counts.approved === 1 && counts.rejected === 1 && counts.pending === list.data.submissions.length - 2, JSON.stringify(counts))
  check('admin routes only take GET and POST', (await call('/api/admin/ecosystem/submissions', { method: 'DELETE', token: ADMIN })).status === 405)

  /* -------------------------------------------------------------------- SEO --- */
  const { pageMeta, sitemapFor } = await import('../server/seo.mjs')
  for (const p of ['/ecosystem', '/partners']) {
    const m = pageMeta('gullylabs.xyz', p)
    check(`${p} has its own head tags`, m.found && m.canonical === `https://gullylabs.xyz${p}` && /Gully Labs/.test(m.title) && m.description.length > 60)
    check(`${p} is in the sitemap`, sitemapFor('gullylabs.xyz').includes(`<loc>https://gullylabs.xyz${p}</loc>`))
  }
} catch (e) {
  check(`no exception (${e?.stack ?? e})`, false)
}

console.log(`\n${t.passed} passed, ${t.failed} failed`)
try {
  fs.rmSync(tmp, { recursive: true, force: true })
} catch {
  /* temp dir */
}
process.exit(t.failed ? 1 : 0)
