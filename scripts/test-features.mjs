// Validates src/content/features.ts, the feature catalog Gully AI and the marketing rules are built from.
//   - schema: every field present, right type, status from the allowed set, ids kebab-case and unique
//   - every `source` exists: 'website:<path>' in this checkout, 'website:<branch>:<path>' via git show,
//     '<sibling-repo>:<path>' under the PROJECTS folder next to this checkout (skipped, with a note, if the repo is absent)
//   - a 'live' feature never cites a branch-only source
//   - urls are well formed https URLs
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const file = path.join(root, 'src/content/features.ts')
const out = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
const { features } = await import('data:text/javascript;base64,' + Buffer.from(out).toString('base64'))

const STATUSES = ['live', 'beta', 'testnet', 'building', 'planned']
const projects = path.resolve(root, '..')
const failures = []
let notes = 0
const bad = (id, msg) => failures.push(`${id}: ${msg}`)

const mainRepo = (() => {
  // The git directory that holds the branches (a worktree shares its refs with the main checkout).
  try {
    return execFileSync('git', ['-C', root, 'rev-parse', '--git-common-dir'], { encoding: 'utf8' }).trim()
  } catch {
    return null
  }
})()
const gitHas = (ref, p) => {
  if (!mainRepo) return null
  try {
    execFileSync('git', ['--git-dir', path.resolve(root, mainRepo), 'cat-file', '-e', `${ref}:${p}`], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

/** Splits a source into { repo, branch, p }. */
function parse(s) {
  const parts = s.split(':')
  if (parts.length === 2) return { repo: parts[0], branch: null, p: parts[1] }
  if (parts.length === 3) return { repo: parts[0], branch: parts[1], p: parts[2] }
  return null
}

if (!Array.isArray(features) || !features.length) bad('features', 'is not a non-empty array')
const ids = new Set()
for (const f of features ?? []) {
  const id = f?.id ?? '(no id)'
  if (typeof f.id !== 'string' || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(f.id)) bad(id, 'id must be kebab-case')
  if (ids.has(f.id)) bad(id, 'duplicate id')
  ids.add(f.id)
  for (const k of ['product', 'name', 'summary']) if (typeof f[k] !== 'string' || !f[k].trim()) bad(id, `${k} must be a non-empty string`)
  if (!STATUSES.includes(f.status)) bad(id, `status must be one of ${STATUSES.join(', ')}`)
  if (!Array.isArray(f.facts) || !f.facts.length || f.facts.some((x) => typeof x !== 'string' || !x.trim())) bad(id, 'facts must be a non-empty array of strings')
  if (!Array.isArray(f.source) || !f.source.length || f.source.some((x) => typeof x !== 'string')) bad(id, 'source must be a non-empty array of strings')
  if (f.url !== undefined) {
    try {
      const u = new URL(f.url)
      if (u.protocol !== 'https:' || !u.hostname.includes('.')) bad(id, `url is not a public https URL: ${f.url}`)
    } catch {
      bad(id, `url is malformed: ${f.url}`)
    }
  }
  for (const key of Object.keys(f)) if (!['id', 'product', 'name', 'status', 'summary', 'facts', 'url', 'source'].includes(key)) bad(id, `unknown field ${key}`)
  for (const s of f.source ?? []) {
    const r = typeof s === 'string' ? parse(s) : null
    if (!r) {
      bad(id, `source is not repo:path or repo:branch:path: ${s}`)
      continue
    }
    if (r.repo === 'website' && r.branch) {
      if (f.status === 'live') bad(id, `a live feature cites a branch-only source: ${s}`)
      const has = gitHas(r.branch, r.p)
      if (has === false) bad(id, `source missing on branch ${r.branch}: ${r.p}`)
    } else if (r.repo === 'website') {
      if (!fs.existsSync(path.join(root, r.p))) bad(id, `source missing in this checkout: ${r.p}`)
    } else {
      const dir = path.join(projects, r.repo)
      if (!fs.existsSync(dir)) {
        notes++
        continue
      }
      if (r.branch) {
        const has = (() => {
          try {
            execFileSync('git', ['-C', dir, 'cat-file', '-e', `${r.branch}:${r.p}`], { stdio: 'ignore' })
            return true
          } catch {
            return false
          }
        })()
        if (!has) bad(id, `source missing on ${r.repo} branch ${r.branch}: ${r.p}`)
      } else if (!fs.existsSync(path.join(dir, r.p))) bad(id, `source missing: ${s}`)
    }
  }
}

if (failures.length) {
  console.error(`test:features FAILED (${failures.length})`)
  for (const m of failures) console.error('  ' + m)
  process.exit(1)
}
const by = {}
for (const f of features) by[f.status] = (by[f.status] ?? 0) + 1
console.log(`test:features ok: ${features.length} features (${Object.entries(by).map(([k, v]) => `${k} ${v}`).join(', ')})${notes ? `; ${notes} sibling-repo sources skipped (repo not present)` : ''}`)
