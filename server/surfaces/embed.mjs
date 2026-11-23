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
import { DATA_DIR, json, readJson } from '../http.mjs'
import { answerForSurface, surfaceEnabled } from './surface.mjs'

const FILE = () => path.join(process.env.DATA_DIR ?? DATA_DIR, 'ask-projects.json')
export const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex')
const ID = /^[a-z0-9][a-z0-9-]{1,40}$/

const BUILTIN = { gully: { name: 'Gully Labs', origins: ['https://gullylabs.xyz', 'https://docs.gullylabs.xyz', 'https://app.gullylabs.xyz'], siteKeyHash: null, serverKeyHash: null, enabled: true, knowledge: 'global' } }

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

/** Checks the caller. Returns { ok, kind: 'site'|'server'|'builtin' } or { ok:false, status, error }. */
export function authorize(project, req) {
  if (!project.enabled) return { ok: false, status: 403, error: 'This assistant is switched off.' }
  const bearer = String(req.headers.authorization ?? '').replace(/^Bearer\s+/i, '')
  if (bearer && project.serverKeyHash && sha256(bearer) === project.serverKeyHash) return { ok: true, kind: 'server' }
  const origin = String(req.headers.origin ?? '')
  if (!originAllowed(project, origin)) return { ok: false, status: 403, error: 'This site is not allowed to use this assistant.' }
  const sk = String(req.headers['x-gully-site-key'] ?? '')
  if (project.siteKeyHash && sha256(sk) !== project.siteKeyHash) return { ok: false, status: 403, error: 'Bad site key.' }
  return { ok: true, kind: project.siteKeyHash ? 'site' : 'builtin' }
}

const cors = (origin) => ({ 'Access-Control-Allow-Origin': origin, Vary: 'Origin', 'Access-Control-Allow-Headers': 'content-type, x-gully-site-key, authorization', 'Access-Control-Allow-Methods': 'POST, OPTIONS' })

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
  const parsed = projectOf(url.searchParams.get('project'))
  if (req.method === 'OPTIONS') {
    if (parsed && originAllowed(parsed, origin)) res.writeHead(204, cors(origin))
    else res.writeHead(204)
    return res.end(), true
  }
  if (!surfaceEnabled('embed')) return json(res, 404, { error: 'not found' }), true
  if (req.method !== 'POST') return json(res, 405, { error: 'POST only' }), true
  const body = await readJson(req, 16_384)
  if (!body || typeof body !== 'object') return json(res, 400, { error: 'Send JSON: { project, question }.' }), true
  const project = projectOf(body.project)
  if (!project) return json(res, 404, { error: 'Unknown assistant.' }), true
  const a = authorize(project, req)
  const h = origin && originAllowed(project, origin) ? cors(origin) : {}
  if (!a.ok) return json(res, a.status, { error: a.error }, h), true
  if (project.knowledge !== 'global') return json(res, 501, { error: 'This assistant is being set up. Its answers are not available yet.', code: 'project_knowledge_pending' }, h), true
  const visitor = sha256(`${req.socket?.remoteAddress ?? ''}|${req.headers['cf-connecting-ip'] ?? ''}|${req.headers['user-agent'] ?? ''}`).slice(0, 16)
  const history = Array.isArray(body.history) ? body.history.slice(-6).map((m) => ({ role: m?.role === 'assistant' ? 'assistant' : 'user', content: String(m?.content ?? '').slice(0, 1500) })) : []
  const r = await answerForSurface({ surface: 'embed', userKey: visitor, question: body.question, place: 'public', locale: String(req.headers['accept-language'] ?? '').split(',')[0], ctx: null, project: project.id, history, askFn: deps.askFn })
  if (!r.ok) return json(res, r.status, { error: r.message }, { ...h, ...(r.retryAfter ? { 'Retry-After': String(r.retryAfter) } : {}) }), true
  return json(res, 200, { id: r.id, chunks: r.chunks, answered: r.answered, project: project.id, brand: { name: project.name } }, h), true
}

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
