// "Ask this project": the embeddable Gully AI for third-party sites (flag AI_SURFACE_EMBED=1).
//
//   POST /api/ask/embed   { project, question, history? }   browser calls: Origin must be on the project's allowlist,
//                         header X-Gully-Site-Key (a public key bound to those origins); server calls: Authorization: Bearer sk_...
//   GET  /embed/ask?project=<id>   the iframe page (frame-ancestors = the project's allowed origins only)
//   GET  /gully-ask.js             the <gully-ask> custom element (public/gully-ask.js)
//
// Projects live in DATA_DIR/ask-projects.json (admin-written; the console for it belongs to the hardening/knowledge lane):
//   { "<id>": { name, origins: ["https://example.com"], siteKeyHash, serverKeyHash, enabled, knowledge: "global"|"project" } }
// Keys are stored as sha256 hex only. ISOLATION RULES (design): a project's questions are limited, logged and (when its
// index exists) answered from THAT project's index only; the project id comes from the key, never from the model or the
// visitor's text; no cross-project retrieval; a session is never accepted (ctx is null); no wallet tools.
//
// STUB: per-project knowledge indexes do not exist yet (Stage 0 lane: embeddings + per-project index builder). Until a
// project's `knowledge` is "project" with an index, the route answers 501 `project_knowledge_pending` for every project
// except the built-in `gully` (knowledge "global": Gully's own docs, so the widget can be shown and tested today).

import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { clientIp, DATA_DIR, json, rateKey, readJson } from '../http.mjs'
import { answerForSurface, surfaceEnabled } from './surface.mjs'

const FILE = () => path.join(process.env.DATA_DIR ?? DATA_DIR, 'ask-projects.json')
export const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex')
const ID = /^[a-z0-9][a-z0-9-]{1,40}$/

const BUILTIN = { gully: { name: 'Gully Labs', origins: ['https://gullylabs.xyz', 'https://docs.gullylabs.xyz', 'https://app.gullylabs.xyz'], siteKeyHash: null, serverKeyHash: null, enabled: true, knowledge: 'global' } }

/** Constant-time comparison of two hex digests. */
export function hashEq(a, b) {
  const x = Buffer.from(String(a ?? ''), 'utf8')
  const y = Buffer.from(String(b ?? ''), 'utf8')
  return x.length === y.length && crypto.timingSafeEqual(x, y)
}

/** Every project (stored + built-in), for answering a preflight that cannot name its project. */
function allProjects() {
  let stored = {}
  try {
    stored = JSON.parse(fs.readFileSync(FILE(), 'utf8'))
  } catch {
    /* none */
  }
  return Object.entries({ ...BUILTIN, ...stored }).map(([id, v]) => ({ id, ...v }))
}

// A project's questions per UTC day across every visitor (abuse bound; the global Ask cap still applies on top).
const projectDay = new Map()
export const resetEmbedForTest = () => projectDay.clear()
function takeProject(id, cap) {
  const day = new Date().toISOString().slice(0, 10)
  const e = projectDay.get(id)
  if (!e || e.day !== day) projectDay.set(id, { day, n: 1 })
  else if (e.n >= cap) return false
  else e.n++
  return true
}

export function projectOf(id) {
  if (!ID.test(String(id ?? ''))) return null
  try {
    const all = JSON.parse(fs.readFileSync(FILE(), 'utf8'))
    if (all[id]) return { id, ...all[id] }
  } catch {
    /* none */
  }
  return BUILTIN[id] ? { id, ...BUILTIN[id] } : null
}

/** The origin must be on the list exactly (scheme + host + port); "*" is never accepted. */
export const originAllowed = (project, origin) => !!origin && project.origins.some((o) => o !== '*' && o === origin)

/**
 * Checks the caller. Origin and the site key are only ABUSE HINTS (any script can send them; the site key is public by
 * design): a browser request from a site that is not on the list is refused and a wrong site key is refused, but passing them
 * authorises nothing beyond the free per-IP and per-project quotas. A paying project (`paying: true`, or one with its own
 * knowledge) is only served with its server key (Bearer): the browser path never reaches it.
 * Returns { ok, kind: 'server'|'free' } or { ok:false, status, error }.
 */
export function authorize(project, req) {
  if (!project.enabled) return { ok: false, status: 403, error: 'This assistant is switched off.' }
  const bearer = String(req.headers.authorization ?? '').replace(/^Bearer\s+/i, '')
  if (bearer && project.serverKeyHash && hashEq(sha256(bearer), project.serverKeyHash)) return { ok: true, kind: 'server' }
  if (project.paying || project.knowledge === 'project') return { ok: false, status: 401, error: 'This assistant needs its server key.' }
  const origin = String(req.headers.origin ?? '')
  if (origin && !originAllowed(project, origin)) return { ok: false, status: 403, error: 'This site is not allowed to use this assistant.' }
  const sk = String(req.headers['x-gully-site-key'] ?? '')
  if (project.siteKeyHash && sk && !hashEq(sha256(sk), project.siteKeyHash)) return { ok: false, status: 403, error: 'Bad site key.' }
  return { ok: true, kind: 'free' }
}

const cors = (origin) => ({ 'Access-Control-Allow-Origin': origin, Vary: 'Origin', 'Access-Control-Allow-Headers': 'content-type, x-gully-site-key', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Max-Age': '600' })

/** Only the visitor's own turns are accepted from a client: nobody can forge assistant turns. */
export const userTurns = (h) => (Array.isArray(h) ? h.filter((m) => m && m.role === 'user').slice(-4).map((m) => ({ role: 'user', content: String(m.content ?? '').slice(0, 500) })) : [])

export async function handleEmbed(req, res, url, deps = {}) {
  const p = url.pathname
  if (p === '/embed/ask') {
    if (!surfaceEnabled('embed')) return json(res, 404, { error: 'not found' }), true
    const project = projectOf(url.searchParams.get('project'))
    if (!project?.enabled) return json(res, 404, { error: 'not found' }), true
    const anc = project.origins.filter((o) => o !== '*').join(' ') || "'none'"
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Security-Policy': `default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors ${anc}; base-uri 'none'`, 'X-Robots-Tag': 'noindex' })
    res.end(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Ask ${escapeHtml(project.name)}</title><gully-ask project="${escapeHtml(project.id)}" mode="page"></gully-ask><script src="/gully-ask.js"></script>`)
    return true
  }
  if (p !== '/api/ask/embed') return false
  const origin = String(req.headers.origin ?? '')
  if (req.method === 'OPTIONS') {
    // The POST names its project in the query too (the widget sends ?project=); a preflight that does not is answered from
    // the Origin against every enabled free project, so a browser call from an allowed site never fails for want of it.
    const named = projectOf(url.searchParams.get('project'))
    const ok = named ? !named.paying && originAllowed(named, origin) : allProjects().some((p) => p.enabled && !p.paying && originAllowed(p, origin))
    res.writeHead(ok ? 204 : 403, ok ? cors(origin) : {})
    return res.end(), true
  }
  if (!surfaceEnabled('embed')) return json(res, 404, { error: 'not found' }), true
  if (req.method !== 'POST') return json(res, 405, { error: 'POST only' }), true
  const body = await readJson(req, 16_384)
  if (!body || typeof body !== 'object') return json(res, 400, { error: 'Send JSON: { project, question }.' }), true
  const project = projectOf(body.project ?? url.searchParams.get('project'))
  if (!project) return json(res, 404, { error: 'Unknown assistant.' }), true
  const a = authorize(project, req)
  const h = origin && originAllowed(project, origin) ? cors(origin) : {}
  if (!a.ok) return json(res, a.status, { error: a.error }, h), true
  if (project.knowledge !== 'global') return json(res, 501, { error: 'This assistant is being set up. Its answers are not available yet.', code: 'project_knowledge_pending' }, h), true
  // The visitor is the network (IPv6 reduced to its /64), never anything the client chooses (no user-agent).
  const visitor = rateKey(clientIp(req))
  if (!takeProject(project.id, Number(process.env.AI_EMBED_PROJECT_DAILY) || 500)) return json(res, 429, { error: 'This assistant has reached its daily limit. Try again tomorrow.' }, h), true
  const history = userTurns(body.history)
  const r = await answerForSurface({ surface: 'embed', userKey: visitor, question: body.question, place: 'public', locale: String(req.headers['accept-language'] ?? '').split(',')[0], ctx: null, project: project.id, history, askFn: deps.askFn })
  if (!r.ok) return json(res, r.status, { error: r.message }, { ...h, ...(r.retryAfter ? { 'Retry-After': String(r.retryAfter) } : {}) }), true
  return json(res, 200, { id: r.id, chunks: r.chunks, answered: r.answered, project: project.id, brand: { name: project.name } }, h), true
}

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
