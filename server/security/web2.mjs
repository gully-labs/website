// Checklist mode for JS/TS backends: the checklist items, the dependency check (npm audit on a copy of the
// lockfile only: no install, no lifecycle scripts, no project .npmrc, a throwaway HOME and cache) and the
// selection of files the AI reads first (auth, sessions, secrets).

import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { config } from './config.mjs'

export const CHECKLIST = [
  { id: 'C01', area: 'auth', item: 'Every non-public route and handler requires authentication, and authorisation checks the caller owns the resource' },
  { id: 'C02', area: 'auth', item: 'Passwords are hashed with a slow KDF (bcrypt, scrypt, argon2), never stored plain or with a fast hash' },
  { id: 'C03', area: 'session', item: 'Sessions/JWTs are signed, verified with a pinned algorithm, expire, and their secret comes from the environment' },
  { id: 'C04', area: 'session', item: 'Session cookies are HttpOnly, Secure and SameSite' },
  { id: 'C05', area: 'session', item: 'State-changing requests authenticated by cookies are protected against CSRF' },
  { id: 'C06', area: 'secrets', item: 'No hard-coded secrets, API keys or private keys in code; secrets load from the environment or a secret store' },
  { id: 'C07', area: 'secrets', item: 'Secrets and tokens are never logged or returned in responses or error messages' },
  { id: 'C08', area: 'input', item: 'Input is validated; no SQL/NoSQL/command injection or path traversal' },
  { id: 'C09', area: 'network', item: 'Outbound requests to user-supplied URLs are restricted (SSRF)' },
  { id: 'C10', area: 'headers', item: 'Security headers are set and CORS does not allow any origin with credentials' },
  { id: 'C11', area: 'abuse', item: 'Login, sign-up and other sensitive endpoints are rate-limited' },
  { id: 'C12', area: 'dependencies', item: 'Dependencies have no known vulnerabilities (npm audit on the lockfile)' },
  { id: 'C13', area: 'crypto', item: 'Tokens use secure randomness (crypto), and secrets are compared in constant time' },
]

const RANK = { fail: 0, warn: 1, pass: 2, 'not-checked': 3 }

/** Merges per-chunk checklist answers: the worst result wins; notes and locations are combined. */
export function mergeChecklist(answers, knownFiles) {
  return CHECKLIST.map((c) => {
    const mine = answers.filter((a) => a.id === c.id && RANK[a.result] !== undefined)
    if (!mine.length) return { ...c, result: 'not-checked', note: 'No evidence in the reviewed code.', locations: [] }
    mine.sort((a, b) => RANK[a.result] - RANK[b.result])
    const worst = mine[0].result
    const notes = [...new Set(mine.filter((a) => a.result === worst && a.note).map((a) => String(a.note).trim()))].join(' ').slice(0, 1900)
    const locations = mine.filter((a) => a.result === worst && knownFiles.has(a.file)).map((a) => ({ file: a.file, line: a.line > 0 ? a.line : null, endLine: a.line > 0 ? a.line : null })).slice(0, 5)
    return { ...c, result: worst, note: notes || '—', locations }
  })
}

const PRIORITY = /(auth|login|logout|session|jwt|token|cookie|passport|oauth|password|bcrypt|argon|secret|crypto|csrf|cors|helmet|middleware|guard|permission|role|admin|user|account|server|app|index|routes?|api|config|env)/i

/** Orders web2 files so the AI reads the most security-relevant first. */
export function prioritiseWeb2(files) {
  const score = (f) => (PRIORITY.test(f.path) ? 2 : 0) + (/(jwt|bcrypt|cookie|session|passport|crypto\.|process\.env|createHash|randomBytes|Math\.random|exec\(|query\(|fetch\(|axios)/.test(f.text) ? 1 : 0)
  return [...files].sort((a, b) => score(b) - score(a) || a.path.localeCompare(b.path))
}

/* --------------------------------------------------------------- npm audit --- */

let npmImpl = null
/** Test hook: ({ packageJson, lockfile }) => npm audit JSON (or throw). */
export function setNpmAuditForTest(fn) {
  npmImpl = fn
}

function npmCli() {
  const candidates = [path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js'), path.join(path.dirname(process.execPath), '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'), '/usr/local/lib/node_modules/npm/bin/npm-cli.js', '/usr/lib/node_modules/npm/bin/npm-cli.js']
  return candidates.find((p) => fs.existsSync(p)) ?? null
}

async function spawnNpmAudit({ packageJson, lockfile }) {
  const cli = npmCli()
  if (!cli) throw new Error('npm is not available on this server')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gully-npm-audit-'))
  try {
    fs.writeFileSync(path.join(dir, 'package.json'), packageJson)
    fs.writeFileSync(path.join(dir, 'package-lock.json'), lockfile)
    fs.writeFileSync(path.join(dir, '.npmrc-empty'), '')
    const env = { PATH: process.env.PATH ?? '', HOME: dir, USERPROFILE: dir, npm_config_userconfig: path.join(dir, '.npmrc-empty'), npm_config_globalconfig: path.join(dir, '.npmrc-empty'), npm_config_cache: path.join(dir, 'cache'), npm_config_update_notifier: 'false', npm_config_fund: 'false', SYSTEMROOT: process.env.SYSTEMROOT ?? '' }
    const args = [cli, 'audit', '--json', '--package-lock-only', '--ignore-scripts', `--registry=${config.npmRegistry()}`]
    const out = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, args, { cwd: dir, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
      let stdout = ''
      const timer = setTimeout(() => child.kill('SIGKILL'), 90_000)
      child.stdout.on('data', (c) => {
        if (stdout.length < 20 * 1024 * 1024) stdout += c
      })
      child.stderr.resume()
      child.on('error', reject)
      child.on('close', () => {
        clearTimeout(timer)
        resolve(stdout)
      })
    })
    const j = JSON.parse(out)
    if (j?.error) throw new Error(String(j.error.summary ?? j.error.code ?? 'npm audit error').slice(0, 160))
    return j
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

/** Finds the root-most package.json + package-lock.json pair among the fetched files. */
export function findLockfile(files) {
  const locks = files.filter((f) => /(^|\/)package-lock\.json$/.test(f.path)).sort((a, b) => a.path.split('/').length - b.path.split('/').length)
  for (const l of locks) {
    const dir = l.path.replace(/package-lock\.json$/, '')
    const pkg = files.find((f) => f.path === `${dir}package.json`)
    if (pkg) return { dir, packageJson: pkg.content, lockfile: l.content }
  }
  return null
}

/** Runs the dependency check. Never throws: returns the report's `dependencies` block + the tool entry. */
export async function dependencyAudit(files) {
  const t0 = Date.now()
  const lock = findLockfile(files)
  const none = (reason, status = 'not-run') => ({ dependencies: { tool: 'npm audit', ran: false, reason, counts: null, advisories: [] }, tool: { name: 'npm-audit', version: null, status, reason, durationMs: null, findings: 0 } })
  if (!config.npmAudit()) return none('disabled on this server (SECURITY_NPM_AUDIT=off)')
  if (!lock) return none('no package.json + package-lock.json pair found', 'skipped')
  let j
  try {
    JSON.parse(lock.lockfile)
    j = npmImpl ? await npmImpl(lock) : await spawnNpmAudit(lock)
  } catch (e) {
    return { ...none(String(e?.message ?? e).slice(0, 160), 'failed') }
  }
  const advisories = []
  for (const [name, v] of Object.entries(j?.vulnerabilities ?? {})) {
    const via = (Array.isArray(v.via) ? v.via : []).find((x) => x && typeof x === 'object')
    advisories.push({ name, severity: String(v.severity ?? 'info'), title: String(via?.title ?? `Depends on a vulnerable package (${(v.via ?? []).filter((x) => typeof x === 'string').join(', ')})`).slice(0, 200), url: typeof via?.url === 'string' ? via.url : null, range: v.range ? String(v.range) : null, fixAvailable: !!v.fixAvailable })
  }
  const m = j?.metadata?.vulnerabilities ?? {}
  const counts = { critical: m.critical ?? 0, high: m.high ?? 0, moderate: m.moderate ?? 0, low: m.low ?? 0, info: m.info ?? 0 }
  return {
    dependencies: { tool: 'npm audit', ran: true, reason: lock.dir ? `lockfile at ${lock.dir}package-lock.json` : null, counts, advisories: advisories.slice(0, 300) },
    tool: { name: 'npm-audit', version: j?.auditReportVersion ? `report v${j.auditReportVersion}` : null, status: 'ran', reason: null, durationMs: Date.now() - t0, findings: advisories.length },
  }
}

/** Findings for direct-or-transitive advisories of moderate severity and above (max 20). */
export function dependencyFindings(dep) {
  if (!dep?.ran) return []
  const RATE = { critical: ['medium', 'high'], high: ['low', 'high'], moderate: ['low', 'medium'] }
  return dep.advisories
    .filter((a) => RATE[a.severity])
    .sort((a, b) => Object.keys(RATE).indexOf(a.severity) - Object.keys(RATE).indexOf(b.severity))
    .slice(0, 20)
    .map((a) => ({
      title: `Vulnerable dependency: ${a.name}`.slice(0, 200),
      likelihood: RATE[a.severity][0],
      impact: RATE[a.severity][1],
      confidence: 'medium',
      category: 'dependency',
      triage: 'engine-note',
      sources: [{ tool: 'npm-audit', detector: a.severity }],
      locations: [],
      description: `${a.title}${a.range ? ` (affected range ${a.range})` : ''}${a.url ? `. Advisory: ${a.url}` : ''}.`,
      explanation: 'A package this project installs has a published vulnerability. Whether it is reachable from this code was not checked.',
      recommendation: a.fixAvailable ? 'Upgrade to a fixed version (npm audit fix, then test).' : 'No fixed version is published yet; check whether the vulnerable code path is used and consider replacing the package.',
      poc: null,
    }))
}
