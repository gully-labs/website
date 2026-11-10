// Gully IPFS self-serve pinning (owner 2026-11-10: "Gully IPFS becomes a self-serve pinning service").
//
// The IPFS Pinning Service API v1 (https://ipfs.github.io/pinning-services-api-spec/) in front of our Kubo node, with
// hub API keys (Authorization: Bearer gl_live_…, scope `ipfs:pin`), plus an upload endpoint and the hub's own view.
//   Base URL  https://api.gullylabs.xyz/api/ipfs/psa      (also on gullylabs.xyz and app.gullylabs.xyz)
//   GET    /pins                 list this account's pins (cid, name, match, status, before, after, limit, meta)
//   POST   /pins                 { cid, name?, origins?, meta? } -> 202 PinStatus (queued; the worker pins it)
//   GET    /pins/{requestid}     -> PinStatus
//   POST   /pins/{requestid}     replace: a new pin, the old one removed -> 202 PinStatus
//   DELETE /pins/{requestid}     -> 202
//   POST   /api/ipfs/upload      a file (raw body, ?name=) or a CAR (Content-Type application/vnd.ipld.car): added,
//                                pinned and recorded at once -> 200 PinStatus
// Hub (session, workspace owner's account; developer.mjs gate, CSRF header):
//   GET  /api/developer/ipfs                      usage, plan, pins (newest first), daily usage
//   POST /api/developer/ipfs/upload               same as /api/ipfs/upload for the signed-in account
//   POST /api/developer/ipfs/pins/{id}/delete     unpin
// Replica (gully-ops gully/ipfs-replica on gully-l3; Bearer IPFS_SYNC_TOKEN, never a hub key):
//   GET  /api/ipfs/internal/pinset                every recursive pin on node 1, minus taken-down CIDs
//   POST /api/ipfs/internal/replica               the replica's report { node, pinned, missing, failed, at }
// Admin (admin.mjs calls ipfsAdmin*): the review queue (images and video wait for a look: the kre8 scanner is not
// reachable from the gully box) and takedowns (unpin everywhere, purge the blocks, gateway denylist).
//
// Ownership: a record belongs to the workspace owner's address (key.owner). The node's own pins (Gully content, made
// outside this module) are never in this DB and are never unpinned here: a record that found its CID already pinned
// is marked `preexisting`, and a CID is unpinned only when no live record still wants it and none was preexisting.
// The DB is one JSON file (DATA_DIR/ipfs-pins.json, atomic writes), backed up nightly with the rest of DATA_DIR.

import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { bearer, clientIp, DATA_DIR, json } from './http.mjs'
import { ipfsPlanOf } from './plans.mjs'
import { findKey, safeEqual } from './store.mjs'

export const PSA_BASE = '/api/ipfs/psa'
export const SCOPE = 'ipfs:pin'
const FILE = () => path.join(process.env.IPFS_PINS_DIR || DATA_DIR, 'ipfs-pins.json')
const DENY_DIR = () => process.env.IPFS_DENYLIST_DIR || path.join(DATA_DIR, 'ipfs-denylist')
const api = () => String(process.env.IPFS_API ?? 'http://gully-ipfs:5001').replace(/\/+$/, '')
const gatewayInternal = () => String(process.env.IPFS_GATEWAY ?? 'http://gully-ipfs:8080').replace(/\/+$/, '')
const PIN_TIMEOUT_MS = () => Number(process.env.IPFS_PIN_TIMEOUT_MS || 20 * 60_000)
const STATUSES = ['queued', 'pinning', 'pinned', 'failed']
const LIVE = new Set(['queued', 'pinning', 'pinned'])

/* -------------------------------------------------------------- the db --- */

let db = null
function load() {
  if (db) return db
  try {
    db = JSON.parse(fs.readFileSync(FILE(), 'utf8'))
  } catch {
    db = {}
  }
  db.pins ??= []
  db.reviews ??= []
  db.deny ??= []
  db.days ??= {}
  db.replica ??= null
  return db
}
function save() {
  const f = FILE()
  fs.mkdirSync(path.dirname(f), { recursive: true })
  fs.writeFileSync(f + '.tmp', JSON.stringify(db))
  fs.renameSync(f + '.tmp', f)
}

/* -------------------------------------------------------------- helpers --- */

const CID_RE = /^(Qm[1-9A-HJ-NP-Za-km-z]{44}|b[a-z2-7]{20,120}|z[1-9A-HJ-NP-Za-km-z]{20,120}|f[0-9a-f]{20,200})$/
export const validCid = (c) => typeof c === 'string' && CID_RE.test(c)
const newId = () => crypto.randomBytes(12).toString('base64url')
const nowIso = () => new Date().toISOString()
const err = (res, status, reason, details) => json(res, status, { error: { reason, ...(details ? { details } : {}) } })
const hasScope = (key) => Array.isArray(key?.scopes) && key.scopes.includes(SCOPE)

/** Fixed one-minute / one-hour windows in memory (a restart forgets them, which only ever errs in the caller's favour). */
const windows = new Map()
function allow(bucket, id, limit, ms) {
  const k = `${bucket}:${id}`
  const t = Date.now()
  let w = windows.get(k)
  if (!w || t - w.at >= ms) w = { at: t, n: 0 }
  w.n++
  windows.set(k, w)
  if (windows.size > 20_000) for (const [kk, ww] of windows) if (t - ww.at > 3_600_000) windows.delete(kk)
  return w.n <= limit
}

async function call(url, init = {}, timeout = 15_000) {
  const ctl = new AbortController()
  const t = setTimeout(() => ctl.abort(), timeout)
  try {
    return await fetch(url, { ...init, signal: init.signal ?? ctl.signal })
  } finally {
    clearTimeout(t)
  }
}
/** One Kubo RPC call (POST only). Throws with Kubo's own message on an error answer. */
async function kubo(pathq, { body, headers, timeout = 15_000 } = {}) {
  const r = await call(`${api()}/api/v0/${pathq}`, { method: 'POST', body, headers }, timeout)
  const text = await r.text()
  if (!r.ok) {
    let m = text
    try {
      m = JSON.parse(text).Message ?? text
    } catch {
      /* plain text */
    }
    throw new Error(String(m).slice(0, 300))
  }
  return text
}
const kuboJson = async (p, o) => JSON.parse(await kubo(p, o))
const lines = (text) =>
  text
    .split('\n')
    .filter(Boolean)
    .map((l) => {
      try {
        return JSON.parse(l)
      } catch {
        return null
      }
    })
    .filter(Boolean)

let nodePeer = null
async function peerId() {
  if (nodePeer) return nodePeer
  try {
    nodePeer = (await kuboJson('id', { timeout: 5_000 })).ID ?? null
  } catch {
    /* the node is down: delegates fall back to none until it answers */
  }
  return nodePeer
}
/** Delegates: our node's peer id as a /p2p multiaddr (no box address in a public answer; peers find it in the DHT). */
const delegates = () => (nodePeer ? [`/p2p/${nodePeer}`] : [])

function pinStatus(r) {
  return {
    requestid: r.id,
    status: r.status,
    created: r.created,
    pin: { cid: r.cid, ...(r.name ? { name: r.name } : {}), ...(r.origins?.length ? { origins: r.origins } : {}), ...(r.meta ? { meta: r.meta } : {}) },
    delegates: delegates(),
    info: { ...(r.bytes != null ? { size: String(r.bytes) } : {}), ...(r.reason ? { status_details: r.reason } : {}), ...(r.review ? { review: r.review } : {}) },
  }
}

const liveOf = (owner) => load().pins.filter((r) => r.owner === owner && LIVE.has(r.status))
/** Bytes held for an account: each CID counted once, at its largest known size. */
export function usageOf(owner) {
  const by = new Map()
  for (const r of liveOf(owner)) by.set(r.cid, Math.max(by.get(r.cid) ?? 0, r.bytes ?? 0))
  let bytes = 0
  for (const b of by.values()) bytes += b
  return { pins: liveOf(owner).length, bytes }
}
const denied = (cid) => load().deny.some((d) => d.cid === cid)

function noteDay(owner) {
  const d = load()
  const day = nowIso().slice(0, 10)
  d.days[owner] ??= {}
  d.days[owner][day] = usageOf(owner).bytes
  const keys = Object.keys(d.days[owner]).sort()
  for (const k of keys.slice(0, Math.max(0, keys.length - 60))) delete d.days[owner][k]
}

/* -------------------------------------------------------------- kubo ops --- */

async function isPinnedOnNode(cid) {
  try {
    const j = await kuboJson(`pin/ls?arg=${encodeURIComponent(cid)}&type=recursive`, { timeout: 10_000 })
    return Boolean(j?.Keys && Object.keys(j.Keys).length)
  } catch {
    return false
  }
}

/** Removes a DAG's blocks from the node, except blocks any pin still holds (Kubo refuses those). No repo-wide GC. */
async function purge(cid) {
  try {
    const refs = lines(await kubo(`refs?arg=${encodeURIComponent(cid)}&recursive=true&unique=true&offline=true`, { timeout: 60_000 }))
      .map((x) => x.Ref)
      .filter(Boolean)
    const all = [cid, ...refs]
    for (let i = 0; i < all.length; i += 200) {
      const q = all
        .slice(i, i + 200)
        .map((c) => `arg=${encodeURIComponent(c)}`)
        .join('&')
      await kubo(`block/rm?${q}&force=false&quiet=true`, { timeout: 60_000 }).catch(() => {})
    }
  } catch {
    /* nothing local, or the node is down: the denylist still covers a takedown */
  }
}

/** Unpins a CID from the node only when nothing else wants it (no live record left, none preexisting). */
async function releaseCid(cid) {
  const recs = load().pins.filter((r) => r.cid === cid)
  if (recs.some((r) => LIVE.has(r.status)) || recs.some((r) => r.preexisting)) return false
  try {
    await kubo(`pin/rm?arg=${encodeURIComponent(cid)}&recursive=true`, { timeout: 60_000 })
  } catch {
    /* not pinned (failed early): purge what was fetched anyway */
  }
  // Blocks the node held before a customer asked for them (other products put raw blocks without pinning) are never
  // purged: only what a customer's own pin brought in is removed.
  if (!recs.some((r) => r.localBefore || r.noPurge)) await purge(cid)
  return true
}

/** Whether the node holds a block locally right now (no network). */
async function hasLocal(cid) {
  try {
    await kubo(`block/stat?arg=${encodeURIComponent(cid)}&offline=true`, { timeout: 5_000 })
    return true
  } catch {
    return false
  }
}

/** Sniffs a media type from the first bytes: images and video go to the review queue. */
export function sniff(buf) {
  if (!buf || buf.length < 12) return null
  const h = buf.subarray(0, 16)
  if (h[0] === 0xff && h[1] === 0xd8 && h[2] === 0xff) return 'image/jpeg'
  if (h[0] === 0x89 && h[1] === 0x50 && h[2] === 0x4e && h[3] === 0x47) return 'image/png'
  if (h.toString('latin1', 0, 4) === 'GIF8') return 'image/gif'
  if (h.toString('latin1', 0, 4) === 'RIFF' && h.toString('latin1', 8, 12) === 'WEBP') return 'image/webp'
  if (h.toString('latin1', 4, 8) === 'ftyp') return /^(avif|avis|heic|heix|mif1)/.test(h.toString('latin1', 8, 12)) ? 'image/avif' : 'video/mp4'
  if (h[0] === 0x1a && h[1] === 0x45 && h[2] === 0xdf && h[3] === 0xa3) return 'video/webm'
  if (/^\s*(<\?xml[^>]*>\s*)?<svg/i.test(buf.subarray(0, 200).toString('utf8'))) return 'image/svg+xml'
  return null
}
const isMedia = (t) => /^(image|video)\//.test(String(t ?? ''))

function queueReview(r, mime) {
  if (!isMedia(mime)) return
  const d = load()
  if (d.reviews.some((x) => x.cid === r.cid && x.state === 'open')) return
  d.reviews.push({ id: newId(), cid: r.cid, owner: r.owner, pinId: r.id, mime, at: nowIso(), state: 'open' })
  r.review = 'queued'
}

/* ------------------------------------------------------------ the worker --- */

let running = 0
const MAX_RUNNING = 2
export function kick() {
  while (running < MAX_RUNNING) {
    const r = load().pins.find((x) => x.status === 'queued')
    if (!r) return
    r.status = 'pinning'
    save()
    running++
    pinOne(r)
      .catch((e) => fail(r, e?.message ?? 'pin failed'))
      .finally(() => {
        running--
        noteDay(r.owner)
        save()
        kick()
      })
  }
}
function fail(r, reason) {
  r.status = 'failed'
  r.reason = String(reason).slice(0, 200)
  save()
  releaseCid(r.cid).catch(() => {})
}

/** Pins one queued record: size checked while the DAG is walked (stopped past the account's room), then pinned. */
async function pinOne(r) {
  if (denied(r.cid)) return fail(r, 'This CID was taken down and cannot be pinned here.')
  r.localBefore = await hasLocal(r.cid)
  r.preexisting = (await isPinnedOnNode(r.cid)) && !load().pins.some((x) => x !== r && x.cid === r.cid && LIVE.has(x.status) && !x.preexisting)
  for (const o of (r.origins ?? []).slice(0, 5)) await kubo(`swarm/connect?arg=${encodeURIComponent(o)}`, { timeout: 10_000 }).catch(() => {})
  const plan = ipfsPlanOf(r.owner)
  const room = plan.storageBytes - (usageOf(r.owner).bytes - (r.bytes ?? 0))
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), PIN_TIMEOUT_MS())
  let size = 0
  try {
    const resp = await fetch(`${api()}/api/v0/dag/stat?arg=${encodeURIComponent(r.cid)}&progress=true`, { method: 'POST', signal: ctl.signal })
    if (!resp.ok) throw new Error(((await resp.text()) || 'dag stat failed').slice(0, 200))
    const dec = new TextDecoder()
    let buf = ''
    for await (const chunk of resp.body) {
      buf += dec.decode(chunk, { stream: true })
      let i
      while ((i = buf.indexOf('\n')) >= 0) {
        const l = buf.slice(0, i)
        buf = buf.slice(i + 1)
        try {
          const j = JSON.parse(l)
          const s = Number(j.TotalSize ?? j.Size ?? j.DagStats?.[0]?.Size ?? 0)
          if (Number.isFinite(s) && s > size) size = s
          if (j.Message) throw new Error(j.Message)
        } catch (e) {
          if (e instanceof SyntaxError) continue
          throw e
        }
        if (size > room) {
          ctl.abort()
          throw new Error(`Over your storage quota: this DAG is larger than the ${room > 0 ? Math.floor(room / 1048576) : 0} MB left on your plan.`)
        }
      }
    }
  } catch (e) {
    if (ctl.signal.aborted && !/quota/.test(String(e?.message))) throw new Error('Timed out fetching the DAG from the network.')
    throw e
  } finally {
    clearTimeout(timer)
  }
  if (load().pins.find((x) => x.id === r.id)?.status !== 'pinning') return // deleted while pinning
  await kubo(`pin/add?arg=${encodeURIComponent(r.cid)}&recursive=true`, { timeout: PIN_TIMEOUT_MS() })
  r.bytes = size
  r.status = 'pinned'
  r.pinnedAt = nowIso()
  r.reason = null
  try {
    const h = await call(`${gatewayInternal()}/ipfs/${r.cid}`, { method: 'HEAD' }, 8_000)
    queueReview(r, h.headers.get('content-type'))
  } catch {
    /* no type: not queued */
  }
  save()
}

/* ------------------------------------------------------------- adding --- */

function addRecord(owner, keyId, { cid, name, origins, meta }, extra = {}) {
  const r = { id: newId(), owner, keyId, cid, name: name ?? null, origins: origins ?? [], meta: meta ?? null, status: 'queued', created: nowIso(), bytes: null, reason: null, review: null, preexisting: false, ...extra }
  load().pins.push(r)
  return r
}

/** Validates a Pin object (spec): cid required, name <= 255, origins multiaddrs (<= 20), meta string map (<= 50). */
function readPin(b) {
  if (!b || typeof b !== 'object') return { error: 'The body must be a JSON Pin object.' }
  if (!validCid(b.cid)) return { error: 'cid is missing or not a valid CID.' }
  if (b.name != null && (typeof b.name !== 'string' || b.name.length > 255)) return { error: 'name must be a string of at most 255 characters.' }
  if (b.origins != null && (!Array.isArray(b.origins) || b.origins.length > 20 || b.origins.some((o) => typeof o !== 'string' || !/^\/(ip4|ip6|dns4|dns6|dns|dnsaddr)\//.test(o) || o.length > 300))) return { error: 'origins must be at most 20 multiaddrs.' }
  if (b.meta != null && (typeof b.meta !== 'object' || Array.isArray(b.meta) || Object.keys(b.meta).length > 50 || Object.entries(b.meta).some(([k, v]) => k.length > 255 || typeof v !== 'string' || v.length > 1000))) return { error: 'meta must be an object of at most 50 string values.' }
  // Origins on private or loopback addresses are dropped: the node never dials into a private network for a customer.
  const origins = (b.origins ?? []).filter((o) => !/^\/ip4\/(10\.|127\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)|^\/ip6\/(::1|f[cd]|fe80)/i.test(o))
  return { pin: { cid: b.cid, name: b.name ?? null, origins, meta: b.meta ?? null } }
}

function quotaError(owner, addBytes = 0) {
  const plan = ipfsPlanOf(owner)
  const u = usageOf(owner)
  if (u.pins >= plan.maxPins) return `Your plan holds at most ${plan.maxPins} pins. Remove one first.`
  if (u.bytes + addBytes > plan.storageBytes) return `Over your storage quota (${Math.round(plan.storageBytes / 1048576)} MB on the ${plan.name} plan). Remove a pin first. Nothing was deleted.`
  return null
}

const readBody = (req, max) =>
  new Promise((resolve, reject) => {
    const parts = []
    let n = 0
    req.on('data', (c) => {
      n += c.length
      if (n > max) {
        reject(Object.assign(new Error('too large'), { code: 413 }))
        req.destroy()
        return
      }
      parts.push(c)
    })
    req.on('end', () => resolve(Buffer.concat(parts)))
    req.on('error', reject)
  })

let uploading = 0
/** Adds an uploaded file or CAR on the node, pinned, and records it for `owner`. Answers the HTTP request itself. */
export async function upload(req, res, url, owner, keyId) {
  if (req.method !== 'POST') return err(res, 405, 'METHOD_NOT_ALLOWED', 'POST only')
  if (!allow('upload', owner, 60, 3_600_000)) return err(res, 429, 'RATE_LIMITED', 'At most 60 uploads an hour per account.')
  const plan = ipfsPlanOf(owner)
  const len = Number(req.headers['content-length'])
  if (!Number.isFinite(len) || len <= 0) return err(res, 411, 'LENGTH_REQUIRED', 'Send the file as the request body with a Content-Length.')
  if (len > plan.maxFileBytes) return err(res, 413, 'FILE_TOO_LARGE', `Files up to ${Math.round(plan.maxFileBytes / 1048576)} MB on the ${plan.name} plan.`)
  const q = quotaError(owner, len)
  if (q) return err(res, 403, 'QUOTA_EXCEEDED', q)
  if (uploading >= 3) return err(res, 503, 'BUSY', 'Uploads are busy. Try again in a minute.')
  uploading++
  try {
    let body
    try {
      body = await readBody(req, plan.maxFileBytes)
    } catch (e) {
      return err(res, e.code === 413 ? 413 : 400, e.code === 413 ? 'FILE_TOO_LARGE' : 'BAD_REQUEST', e.code === 413 ? 'The body is larger than your plan allows.' : 'The upload did not arrive whole.')
    }
    const car = /application\/vnd\.ipld\.car/i.test(String(req.headers['content-type'] ?? ''))
    const name = String(url.searchParams.get('name') ?? req.headers['x-file-name'] ?? '').slice(0, 255) || null
    let cid
    let localBefore = false
    let pinnedBefore = null // a CAR import pins its root at once: what the node held before decides `preexisting`
    const fd = new FormData()
    fd.append('file', new Blob([body]), name ?? (car ? 'upload.car' : 'file'))
    try {
      if (car) {
        pinnedBefore = new Set(Object.keys((await kuboJson('pin/ls?type=recursive&quiet=true', { timeout: 30_000 }))?.Keys ?? {}))
        const out = lines(await kubo('dag/import?pin-roots=true&stats=false', { body: fd, timeout: 300_000 }))
        const roots = out.map((x) => x.Root?.Cid?.['/']).filter(Boolean)
        if (roots.length !== 1) {
          for (const c of roots) if (!pinnedBefore.has(c) && !load().pins.some((r) => r.cid === c)) await releaseCid(c)
          return err(res, 400, 'BAD_CAR', 'A CAR with exactly one root is accepted.')
        }
        cid = roots[0]
      } else {
        // The CID first (only-hash stores nothing), so a block the node already held is never purged on unpin later.
        const fd0 = new FormData()
        fd0.append('file', new Blob([body]), name ?? 'file')
        const pre0 = lines(await kubo('add?cid-version=1&only-hash=true&quieter=true', { body: fd0, timeout: 120_000 })).at(-1)?.Hash
        localBefore = validCid(pre0) ? await hasLocal(pre0) : true
        const out = lines(await kubo('add?cid-version=1&pin=false&quieter=true&wrap-with-directory=false', { body: fd, timeout: 300_000 }))
        cid = out.at(-1)?.Hash
      }
    } catch (e) {
      return err(res, 502, 'NODE_ERROR', `The node did not take the upload: ${String(e?.message ?? '').slice(0, 120)}`)
    }
    if (!validCid(cid)) return err(res, 502, 'NODE_ERROR', 'The node did not return a CID.')
    const pre = pinnedBefore ? pinnedBefore.has(cid) : await isPinnedOnNode(cid)
    if (denied(cid)) {
      if (!pre && !load().pins.some((r) => r.cid === cid)) await releaseCid(cid)
      return err(res, 451, 'TAKEN_DOWN', 'This content was taken down and cannot be pinned here.')
    }
    if (!car) await kubo(`pin/add?arg=${encodeURIComponent(cid)}&recursive=true`, { timeout: 120_000 })
    const r = addRecord(owner, keyId, { cid, name, origins: [], meta: null }, { status: 'pinned', bytes: body.length, pinnedAt: nowIso(), source: car ? 'car' : 'upload', localBefore, noPurge: car, preexisting: pre && !load().pins.some((x) => x.cid === cid && LIVE.has(x.status) && !x.preexisting) })
    queueReview(r, car ? null : sniff(body))
    noteDay(owner)
    save()
    await peerId()
    return json(res, 200, pinStatus(r))
  } finally {
    uploading--
  }
}
/* ---------------------------------------------------------- the PSA API --- */

function listPins(owner, sp) {
  const statuses = String(sp.get('status') ?? 'pinned')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  if (statuses.some((s) => !STATUSES.includes(s))) return { error: 'status must be a list of queued, pinning, pinned, failed.' }
  const cids = sp.get('cid') ? String(sp.get('cid')).split(',').filter(Boolean) : null
  if (cids && (cids.length > 10 || cids.some((c) => !validCid(c)))) return { error: 'cid must be at most 10 valid CIDs.' }
  const name = sp.get('name')
  const match = sp.get('match') ?? 'exact'
  if (!['exact', 'iexact', 'partial', 'ipartial'].includes(match)) return { error: 'match must be exact, iexact, partial or ipartial.' }
  const before = sp.get('before') ? Date.parse(sp.get('before')) : null
  const after = sp.get('after') ? Date.parse(sp.get('after')) : null
  if (Number.isNaN(before) || Number.isNaN(after)) return { error: 'before and after must be ISO 8601 timestamps.' }
  const limit = sp.get('limit') == null ? 10 : Number(sp.get('limit'))
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000) return { error: 'limit must be 1 to 1000.' }
  let meta = null
  if (sp.get('meta')) {
    try {
      meta = JSON.parse(sp.get('meta'))
    } catch {
      return { error: 'meta must be a JSON object.' }
    }
  }
  const nameOk = (n) => {
    if (name == null) return true
    if (n == null) return false
    if (match === 'exact') return n === name
    if (match === 'iexact') return n.toLowerCase() === name.toLowerCase()
    if (match === 'partial') return n.includes(name)
    return n.toLowerCase().includes(name.toLowerCase())
  }
  const all = load()
    .pins.filter((r) => r.owner === owner && !r.deletedAt && statuses.includes(r.status))
    .filter((r) => !cids || cids.includes(r.cid))
    .filter((r) => nameOk(r.name))
    .filter((r) => before == null || Date.parse(r.created) < before)
    .filter((r) => after == null || Date.parse(r.created) > after)
    .filter((r) => !meta || Object.entries(meta).every(([k, v]) => r.meta?.[k] === v))
    .sort((a, b) => (a.created < b.created ? 1 : a.created > b.created ? -1 : 0))
  return { count: all.length, results: all.slice(0, limit).map(pinStatus) }
}

async function readJsonBody(req, max = 64_000) {
  try {
    const b = await readBody(req, max)
    return JSON.parse(b.toString('utf8') || 'null')
  } catch {
    return undefined
  }
}

async function removeRecord(r) {
  r.status = r.status === 'failed' ? 'failed' : 'removed'
  r.deletedAt = nowIso()
  noteDay(r.owner)
  save()
  await releaseCid(r.cid).catch(() => {})
}

/** The /api/ipfs/psa/* routes for a key holder. Returns true when it answered. */
async function handlePsa(req, res, url) {
  const key = findKey(bearer(req))
  if (!key || !key.owner) return err(res, 401, 'UNAUTHORIZED', 'Send a hub API key with the ipfs:pin scope: Authorization: Bearer gl_live_…'), true
  if (!hasScope(key)) return err(res, 403, 'FORBIDDEN', 'This key has no ipfs:pin scope. Create a key with it on the Keys page.'), true
  if (!allow('psa', key.id, 300, 60_000)) return err(res, 429, 'RATE_LIMITED', 'At most 300 requests a minute per key.'), true
  const owner = key.owner
  await peerId()
  const sub = url.pathname.slice(PSA_BASE.length)
  if (sub === '/pins' || sub === '/pins/') {
    if (req.method === 'GET') {
      const out = listPins(owner, url.searchParams)
      if (out.error) return err(res, 400, 'BAD_REQUEST', out.error), true
      return json(res, 200, out), true
    }
    if (req.method === 'POST') {
      const body = await readJsonBody(req)
      const { pin, error } = readPin(body)
      if (error) return err(res, 400, 'BAD_REQUEST', error), true
      if (denied(pin.cid)) return err(res, 451, 'TAKEN_DOWN', 'This CID was taken down and cannot be pinned here.'), true
      if (!allow('newpin', owner, 600, 3_600_000)) return err(res, 429, 'RATE_LIMITED', 'At most 600 new pins an hour per account.'), true
      const q = quotaError(owner)
      if (q) return err(res, 403, 'QUOTA_EXCEEDED', q), true
      const r = addRecord(owner, key.id, pin)
      save()
      kick()
      return json(res, 202, pinStatus(r)), true
    }
    return err(res, 405, 'METHOD_NOT_ALLOWED', 'GET or POST'), true
  }
  const m = sub.match(/^\/pins\/([\w-]{1,64})$/)
  if (!m) return err(res, 404, 'NOT_FOUND', 'No such route.'), true
  const r = load().pins.find((x) => x.id === m[1] && x.owner === owner && !x.deletedAt)
  if (!r) return err(res, 404, 'NOT_FOUND', 'No pin with that requestid on this account.'), true
  if (req.method === 'GET') return json(res, 200, pinStatus(r)), true
  if (req.method === 'DELETE') {
    await removeRecord(r)
    res.writeHead(202, { 'Cache-Control': 'no-store' })
    res.end()
    return true
  }
  if (req.method === 'POST') {
    const body = await readJsonBody(req)
    const { pin, error } = readPin(body)
    if (error) return err(res, 400, 'BAD_REQUEST', error), true
    if (denied(pin.cid)) return err(res, 451, 'TAKEN_DOWN', 'This CID was taken down and cannot be pinned here.'), true
    const nr = addRecord(owner, key.id, pin)
    if (pin.cid === r.cid && r.status === 'pinned') Object.assign(nr, { status: 'pinned', bytes: r.bytes, pinnedAt: nowIso(), preexisting: r.preexisting })
    save()
    await removeRecord(r)
    kick()
    return json(res, 202, pinStatus(nr)), true
  }
  return err(res, 405, 'METHOD_NOT_ALLOWED', 'GET, POST or DELETE'), true
}

/* ------------------------------------------------------- replica (sync) --- */

const syncAuth = (req) => {
  const t = process.env.IPFS_SYNC_TOKEN
  const b = bearer(req)
  return Boolean(t && t.length >= 24 && b && safeEqual(b, t))
}
async function pinset() {
  const j = await kuboJson('pin/ls?type=recursive&quiet=true', { timeout: 30_000 })
  const deny = new Set(load().deny.map((d) => d.cid))
  return Object.keys(j?.Keys ?? {}).filter((c) => !deny.has(c))
}
/** The replica's last report, for the status page and the hub's "copies" figure. */
export function replicaState() {
  const r = load().replica
  if (!r) return { reported: false, up: false, inSync: false }
  const fresh = Date.now() - Date.parse(r.at) < 30 * 60_000
  return { reported: true, up: fresh, inSync: fresh && r.missing === 0, at: r.at, pinned: r.pinned, missing: r.missing, failed: r.failed }
}

/* ------------------------------------------------------------ hub view --- */

export function accountIpfs(owner) {
  const plan = ipfsPlanOf(owner)
  const u = usageOf(owner)
  const rep = replicaState()
  const pins = load()
    .pins.filter((r) => r.owner === owner && !r.deletedAt)
    .sort((a, b) => (a.created < b.created ? 1 : -1))
    .slice(0, 200)
    .map((r) => ({ id: r.id, cid: r.cid, name: r.name, status: r.status, created: r.created, bytes: r.bytes, reason: r.reason ?? null, source: r.source ?? 'api', review: r.review ?? null, copies: r.status === 'pinned' ? (rep.inSync || (rep.up && Date.parse(r.pinnedAt ?? r.created) < Date.parse(rep.at)) ? 2 : 1) : 0 }))
  const days = Object.entries(load().days[owner] ?? {})
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([day, bytes]) => ({ day, bytes }))
  const month = nowIso().slice(0, 7)
  const uploads = load().pins.filter((r) => r.owner === owner && (r.source === 'upload' || r.source === 'car') && r.created.startsWith(month)).length
  return { plan, usage: { ...u, uploadsThisMonth: uploads }, pins, days, replica: { inSync: rep.inSync }, api: { base: `https://api.gullylabs.xyz${PSA_BASE}`, scope: SCOPE } }
}

/** /api/developer/ipfs* for the signed-in workspace (ctx from developer.mjs). Returns true when it answered. */
export async function handleIpfsAccount(req, res, url, ctx) {
  const owner = ctx.workspace
  const p = url.pathname
  if (p === '/api/developer/ipfs') {
    if (req.method !== 'GET') return json(res, 405, { error: 'GET only' }), true
    return json(res, 200, accountIpfs(owner)), true
  }
  if (p === '/api/developer/ipfs/upload') return (await upload(req, res, url, owner, null)), true
  const m = p.match(/^\/api\/developer\/ipfs\/pins\/([\w-]{1,64})\/delete$/)
  if (m && req.method === 'POST') {
    const r = load().pins.find((x) => x.id === m[1] && x.owner === owner && !x.deletedAt)
    if (!r) return json(res, 404, { error: 'No such pin on this account.' }), true
    await removeRecord(r)
    return json(res, 200, { ok: true, usage: usageOf(owner) }), true
  }
  return json(res, 404, { error: 'not found' }), true
}

/* -------------------------------------------------------------- admin --- */

export const ipfsReviews = () => load().reviews.filter((x) => x.state === 'open')
export function ipfsReviewOk(id, by) {
  const r = load().reviews.find((x) => x.id === id)
  if (!r) return null
  r.state = 'ok'
  r.by = by ?? null
  r.decidedAt = nowIso()
  for (const p of load().pins.filter((x) => x.cid === r.cid && x.review === 'queued')) p.review = 'ok'
  save()
  return r
}
/** Takedown: every record of the CID removed, unpinned and purged (unless it is Gully's own pin), and the gateway
    denylist refuses it (the node reads DENY_DIR/gully.deny and follows appended lines). */
export async function ipfsTakedown(cid, reason, by) {
  if (!validCid(cid)) return { error: 'not a CID' }
  const d = load()
  if (!d.deny.some((x) => x.cid === cid)) d.deny.push({ cid, reason: String(reason ?? '').slice(0, 300), by: by ?? null, at: nowIso() })
  for (const r of d.pins.filter((x) => x.cid === cid && LIVE.has(x.status))) {
    r.status = 'removed'
    r.deletedAt = nowIso()
    r.reason = 'Taken down under the content policy.'
    r.review = 'removed'
    noteDay(r.owner)
  }
  for (const rv of d.reviews.filter((x) => x.cid === cid && x.state === 'open')) Object.assign(rv, { state: 'removed', by: by ?? null, decidedAt: nowIso() })
  save()
  writeDenyLine(cid)
  const internal = d.pins.filter((x) => x.cid === cid).some((x) => x.preexisting)
  if (!internal) {
    await kubo(`pin/rm?arg=${encodeURIComponent(cid)}&recursive=true`, { timeout: 60_000 }).catch(() => {})
    await purge(cid)
  }
  return { ok: true, cid, unpinned: !internal }
}
function writeDenyLine(cid) {
  try {
    const dir = DENY_DIR()
    fs.mkdirSync(dir, { recursive: true })
    const f = path.join(dir, 'gully.deny')
    if (!fs.existsSync(f)) fs.writeFileSync(f, 'version: 1\nname: Gully IPFS takedowns\ndescription: CIDs removed under the Gully IPFS content policy\n---\n')
    fs.appendFileSync(f, `/ipfs/${cid}\n`)
  } catch (e) {
    console.error('[ipfs] denylist write failed:', e?.message ?? e)
  }
}
/** Makes sure the denylist file exists before the node starts reading it (server start-up). */
export function ensureDenylist() {
  try {
    const dir = DENY_DIR()
    fs.mkdirSync(dir, { recursive: true })
    const f = path.join(dir, 'gully.deny')
    if (!fs.existsSync(f)) fs.writeFileSync(f, 'version: 1\nname: Gully IPFS takedowns\ndescription: CIDs removed under the Gully IPFS content policy\n---\n')
  } catch {
    /* read-only data dir (tests): fine */
  }
}

/* ------------------------------------------------------------- routing --- */

/** /api/ipfs/psa/*, /api/ipfs/upload and /api/ipfs/internal/*. Returns true when it answered. */
export async function handleIpfsPins(req, res, url) {
  const p = url.pathname
  if (p === PSA_BASE || p.startsWith(PSA_BASE + '/')) {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, DELETE', 'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Max-Age': '600' })
      res.end()
      return true
    }
    res.setHeader('Access-Control-Allow-Origin', '*')
    return handlePsa(req, res, url)
  }
  if (p === '/api/ipfs/upload') {
    const key = findKey(bearer(req))
    if (!key || !key.owner) return err(res, 401, 'UNAUTHORIZED', 'Send a hub API key with the ipfs:pin scope.'), true
    if (!hasScope(key)) return err(res, 403, 'FORBIDDEN', 'This key has no ipfs:pin scope.'), true
    await upload(req, res, url, key.owner, key.id)
    return true
  }
  if (p === '/api/ipfs/internal/pinset' || p === '/api/ipfs/internal/replica') {
    if (!syncAuth(req)) return err(res, 401, 'UNAUTHORIZED', 'not allowed'), true
    if (!allow('sync', clientIp(req), 120, 60_000)) return err(res, 429, 'RATE_LIMITED', 'slow down'), true
    if (p.endsWith('/pinset')) {
      try {
        return json(res, 200, { generatedAt: nowIso(), cids: await pinset() }), true
      } catch {
        return err(res, 503, 'NODE_DOWN', 'node 1 did not answer'), true
      }
    }
    if (req.method !== 'POST') return err(res, 405, 'METHOD_NOT_ALLOWED', 'POST'), true
    const b = await readJsonBody(req, 8_000)
    const n = (v) => (Number.isInteger(v) && v >= 0 ? v : 0)
    load().replica = { node: String(b?.node ?? 'replica').slice(0, 40), pinned: n(b?.pinned), missing: n(b?.missing), failed: n(b?.failed), at: nowIso() }
    save()
    return json(res, 200, { ok: true }), true
  }
  return false
}

/** Start-up: the denylist file, and any pin left queued or pinning by a restart goes back to the queue. */
export function startIpfsPins() {
  ensureDenylist()
  const d = load()
  let n = 0
  for (const r of d.pins) if (r.status === 'pinning') ((r.status = 'queued'), n++)
  if (n) save()
  kick()
}

/** Tests: forget the in-memory db and windows. */
export function _resetIpfsPins() {
  db = null
  nodePeer = null
  windows.clear()
}
