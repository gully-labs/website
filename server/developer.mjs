// /api/developer/* — API key requests and a key holder's own usage.
//
//   POST /api/developer/request  { email, project, url?, use }   -> { requestId, claimCode, status: 'pending' }
//        The claim code is shown once and stored only as a hash. Five requests per IP per hour.
//   POST /api/developer/claim    { requestId, claimCode }        -> { status } | { status: 'approved', key }
//        After an admin approves, the claim code redeems the key exactly once.
//   GET  /api/developer/me       (Bearer key)                    -> the key's project, limit and usage
//   POST /api/developer/rotate   (Bearer key)                    -> { key }  new key; the old one is revoked

import { keyUsage } from './access.mjs'
import { bearer, clientIp, json, readJson } from './http.mjs'
import { developers, findKey, issueKey, randomToken, safeEqual, saveDevelopers, sha256 } from './store.mjs'

const EMAIL_RE = /^[^@\s]{1,64}@[^@\s]{1,190}\.[^@\s]{2,24}$/
const requestWindow = new Map() // ip -> [timestamps]
const claimFailures = new Map() // ip -> [timestamps]

function recent(map, ip, ms) {
  const now = Date.now()
  const hits = (map.get(ip) ?? []).filter((t) => now - t < ms)
  map.set(ip, hits)
  return hits
}

const clean = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '')

export async function handleDeveloper(req, res, url) {
  const p = url.pathname

  if (p === '/api/developer/request') {
    if (req.method !== 'POST') return json(res, 405, { error: 'POST only' }), true
    const ip = clientIp(req)
    const hits = recent(requestWindow, ip, 3_600_000)
    if (hits.length >= 5) return json(res, 429, { error: 'Too many requests from this address. Try again in an hour.' }), true
    const body = await readJson(req)
    const email = clean(body?.email, 254).toLowerCase()
    const project = clean(body?.project, 80)
    const use = clean(body?.use, 1000)
    const site = clean(body?.url, 200)
    if (!EMAIL_RE.test(email)) return json(res, 400, { error: 'A valid email is required.' }), true
    if (project.length < 2) return json(res, 400, { error: 'Name your project.' }), true
    if (use.length < 10) return json(res, 400, { error: 'Say in a sentence what you will build.' }), true
    if (site && !/^https?:\/\/\S+$/.test(site)) return json(res, 400, { error: 'The website must start with http:// or https://.' }), true
    hits.push(Date.now())
    const claimCode = `glc_${randomToken(18)}`
    const r = { id: randomToken(9), email, project, url: site || null, use, claimHash: sha256(claimCode), status: 'pending', createdAt: new Date().toISOString(), decidedAt: null, keyId: null, claimedAt: null }
    developers().requests.push(r)
    saveDevelopers()
    return json(res, 201, { requestId: r.id, claimCode, status: 'pending' }), true
  }

  if (p === '/api/developer/claim') {
    if (req.method !== 'POST') return json(res, 405, { error: 'POST only' }), true
    const ip = clientIp(req)
    const fails = recent(claimFailures, ip, 900_000)
    if (fails.length >= 10) return json(res, 429, { error: 'Too many failed attempts. Try again in 15 minutes.' }), true
    const body = await readJson(req)
    const r = developers().requests.find((x) => x.id === clean(body?.requestId, 40))
    if (!r || !safeEqual(r.claimHash, sha256(clean(body?.claimCode, 80)))) {
      fails.push(Date.now())
      return json(res, 404, { error: 'No request matches that ID and claim code.' }), true
    }
    if (r.status !== 'approved') return json(res, 200, { status: r.status, project: r.project, createdAt: r.createdAt }), true
    if (r.claimedAt) return json(res, 200, { status: 'claimed', project: r.project, claimedAt: r.claimedAt }), true
    const { key, secret } = issueKey({ requestId: r.id, project: r.project, email: r.email })
    r.keyId = key.id
    r.claimedAt = new Date().toISOString()
    saveDevelopers()
    return json(res, 200, { status: 'approved', project: r.project, key: secret, limit: key.limit }), true
  }

  if (p === '/api/developer/me') {
    const key = findKey(bearer(req))
    if (!key) return json(res, 401, { error: 'Sign in with a valid API key.' }), true
    return json(res, 200, { project: key.project, prefix: key.prefix, limit: key.limit, createdAt: key.createdAt, usage: keyUsage(key.id) }), true
  }

  if (p === '/api/developer/rotate') {
    if (req.method !== 'POST') return json(res, 405, { error: 'POST only' }), true
    const key = findKey(bearer(req))
    if (!key) return json(res, 401, { error: 'Sign in with a valid API key.' }), true
    key.revokedAt = new Date().toISOString()
    const { key: next, secret } = issueKey({ requestId: key.requestId, project: key.project, email: key.email })
    const r = developers().requests.find((x) => x.id === key.requestId)
    if (r) r.keyId = next.id
    saveDevelopers()
    return json(res, 200, { key: secret, limit: next.limit }), true
  }

  return false
}
