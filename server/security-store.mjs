// Gully Security's own records (the product UI's side; the scan engine keeps its scans itself).
//
// DATA_DIR/security.json (atomic writes):
//   { jobs: [Job], reviews: [Review], credits: { [workspace]: n } }
// Job: one scan a workspace asked for. Its id (sec_…) is the stable id every page and URL uses; the engine's
// scan id stays server-side. { id, workspace, createdBy, createdAt, input, upload: { name, size } | null,
//   free, priceCents, invoiceId, state: 'awaiting_payment' | 'started' | 'cancelled', scanId, startedAt,
//   status (the engine's, mirrored), statusAt, completedAt, counts (findings per severity, once done),
//   published, publishedAt, publishedBy, indexable, cancelledAt, startError, creditUsed, creditEarned }
// Credits: free re-runs a workspace holds because a paid scan failed (security-routes.mjs settleFailure).
// Review: a request for a human Security Review or an Audit (the /security form and the app).
//   { id, tier, name, email, company, project, scope, repo, chain, address, timeline, budget, status, note,
//     createdAt, updatedAt, source, workspace }
// seo.mjs reads published() synchronously for the report pages' head tags and the sitemap.

import fs from 'node:fs'
import path from 'node:path'
import { DATA_DIR } from './http.mjs'

const FILE = path.join(DATA_DIR, 'security.json')

let db
try {
  db = JSON.parse(fs.readFileSync(FILE, 'utf8'))
} catch {
  db = null
}
if (!db || typeof db !== 'object' || Array.isArray(db)) db = {}
db.jobs = Array.isArray(db.jobs) ? db.jobs : []
db.reviews = Array.isArray(db.reviews) ? db.reviews : []
if (!db.credits || typeof db.credits !== 'object' || Array.isArray(db.credits)) db.credits = {}

export function save() {
  try {
    fs.mkdirSync(path.dirname(FILE), { recursive: true })
    fs.writeFileSync(FILE + '.tmp', JSON.stringify(db))
    fs.renameSync(FILE + '.tmp', FILE)
  } catch (e) {
    console.error('security store: save failed:', e?.message ?? e)
  }
}

export const jobs = () => db.jobs
export const reviews = () => db.reviews

/** Re-run credits a workspace holds (spent before the price, see security-routes.mjs). */
export const creditsOf = (workspace) => Math.max(0, Number(db.credits[workspace]) || 0)
/** Adds (or, with a negative n, spends) credits. The caller saves. */
export function addCredits(workspace, n) {
  const next = creditsOf(workspace) + n
  if (next > 0) db.credits[workspace] = next
  else delete db.credits[workspace]
}

const JOB_RE = /^sec_[A-Za-z0-9_-]{16}$/
export const isJobId = (id) => JOB_RE.test(String(id ?? ''))
export const findJob = (id) => (isJobId(id) ? (db.jobs.find((j) => j.id === id) ?? null) : null)

/** A published report's job, or null (unknown, unpublished, or not done). */
export function published(id) {
  const j = findJob(id)
  return j && j.published && j.status === 'done' ? j : null
}

/** Every published report's job, newest first. */
export const publishedJobs = () => db.jobs.filter((j) => j.published && j.status === 'done').sort((a, b) => String(b.publishedAt).localeCompare(String(a.publishedAt)))
