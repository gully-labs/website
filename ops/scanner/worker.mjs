// gully-scanner: runs static-analysis tools on untrusted Solidity / JS code for the Gully Security engine
// (server/security). No npm dependencies. One job at a time.
//
//   GET  /health   -> { ok, tools: { slither, aderyn, forge, semgrep }, solc: [versions] }
//   POST /analyze  { mode: 'solidity'|'web2', files:[{path,content}], inScope:[paths], solcVersion, remappings, tools:[...] }
//                  -> { tools: { <name>: { status: 'ran'|'failed'|'skipped', version, durationMs, reason, output } } }
//   POST /poc      { files, test:{path,content}, solcVersion } -> { status: 'passed'|'failed'|'error', durationMs, output }
//
// Every request needs header x-scanner-token = SCANNER_TOKEN (constant-time compare).
//
// Untrusted input is data only:
// - files are written under a fresh temp dir with sanitised paths; only .sol (and .js/.ts for web2) and
//   remappings.txt are written. package.json, hardhat/truffle configs, the project's foundry.toml, scripts
//   and hooks are never written, so no tool can find a project build script to run.
// - Foundry runs with a foundry.toml we generate (ffi=false, offline, our solc binary), `forge build
//   --offline` only, tests and scripts skipped. Slither then reads Foundry's output (--ignore-compile) or,
//   when the build fails, compiles single files with solc directly. Aderyn and Semgrep only read files.
// - Children get a minimal environment (no tokens), no shell, a wall-clock timeout and capped output; the
//   container adds CPU/memory/pids limits, a read-only root, tmpfs /work and no outbound network.

import { spawn } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'

const PORT = Number(process.env.PORT) || 8090
const HOST = process.env.HOST || '0.0.0.0'
const TOKEN = String(process.env.SCANNER_TOKEN ?? '')
const WORK = process.env.SCANNER_WORK || os.tmpdir()
const TOOL_TIMEOUT = (Number(process.env.TOOL_TIMEOUT_SEC) || 300) * 1000
const MAX_BODY = (Number(process.env.SCANNER_MAX_BODY_MB) || 60) * 1024 * 1024
const MAX_OUT = 25 * 1024 * 1024
const BIN = {
  slither: process.env.SLITHER_BIN || 'slither',
  aderyn: process.env.ADERYN_BIN || 'aderyn',
  forge: process.env.FORGE_BIN || 'forge',
  semgrep: process.env.SEMGREP_BIN || 'semgrep',
}
const SOLC_DIR = process.env.SOLC_ARTIFACTS || path.join(os.homedir(), '.solc-select', 'artifacts')
const SEMGREP_RULES = process.env.SEMGREP_RULES_DIR || '/opt/semgrep-rules'
const FORGE_STD = process.env.FORGE_STD_DIR || '/opt/forge-std'

if (TOKEN.length < 24) {
  console.error('gully-scanner: SCANNER_TOKEN must be set (24+ characters)')
  process.exit(1)
}

/* ---------------------------------------------------------------- process --- */

const baseEnv = () => ({
  PATH: process.env.PATH ?? '',
  HOME: process.env.HOME ?? os.homedir(),
  USERPROFILE: process.env.USERPROFILE ?? '',
  SYSTEMROOT: process.env.SYSTEMROOT ?? '',
  LANG: 'C.UTF-8',
  FOUNDRY_FFI: 'false',
  FOUNDRY_OFFLINE: 'true',
  FOUNDRY_DISABLE_NIGHTLY_WARNING: '1',
  SEMGREP_SEND_METRICS: 'off',
  SEMGREP_ENABLE_VERSION_CHECK: '0',
  PYTHONDONTWRITEBYTECODE: '1',
})

/** Runs a binary without a shell. Resolves { code, stdout, stderr, timedOut, ms }. */
function run(bin, args, { cwd, timeoutMs = TOOL_TIMEOUT, env = {} } = {}) {
  const t0 = Date.now()
  return new Promise((resolve) => {
    let child
    try {
      child = spawn(bin, args, { cwd, env: { ...baseEnv(), ...env }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
    } catch (e) {
      return resolve({ code: -1, stdout: '', stderr: String(e?.message ?? e), timedOut: false, ms: 0 })
    }
    let stdout = ''
    let stderr = ''
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGKILL')
    }, timeoutMs)
    child.stdout.on('data', (c) => {
      if (stdout.length < MAX_OUT) stdout += c
    })
    child.stderr.on('data', (c) => {
      if (stderr.length < 256 * 1024) stderr += c
    })
    child.on('error', (e) => {
      clearTimeout(timer)
      resolve({ code: -1, stdout, stderr: stderr + String(e?.message ?? e), timedOut, ms: Date.now() - t0 })
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ code, stdout, stderr, timedOut, ms: Date.now() - t0 })
    })
  })
}

const tail = (s, n = 600) => String(s ?? '').replace(/\x1b\[[0-9;]*m/g, '').trim().slice(-n)

/* ------------------------------------------------------------------ tools --- */

let versions = { slither: null, aderyn: null, forge: null, semgrep: null }
let solcs = []

function listSolc() {
  try {
    return fs
      .readdirSync(SOLC_DIR)
      .map((d) => /^solc-(\d+\.\d+\.\d+)$/.exec(d)?.[1])
      .filter(Boolean)
      .sort(cmpVer)
  } catch {
    return []
  }
}
const cmpVer = (a, b) => {
  const x = a.split('.').map(Number)
  const y = b.split('.').map(Number)
  return x[0] - y[0] || x[1] - y[1] || x[2] - y[2]
}
function solcPath(v) {
  const p = path.join(SOLC_DIR, `solc-${v}`, `solc-${v}`)
  return fs.existsSync(p) ? p : fs.existsSync(p + '.exe') ? p + '.exe' : null
}
/** The installed solc closest to the request: exact, else the newest with the same minor, else newest. */
function pickSolc(want) {
  if (!solcs.length) return null
  if (want && solcs.includes(want)) return want
  const mm = want ? want.split('.').slice(0, 2).join('.') : null
  const same = solcs.filter((v) => mm && v.startsWith(mm + '.') && cmpVer(v, want) >= 0)
  return same[0] ?? solcs.filter((v) => mm && v.startsWith(mm + '.')).at(-1) ?? solcs.at(-1)
}

async function detect() {
  const v = async (bin, args, re) => {
    const r = await run(bin, args, { timeoutMs: 20_000 })
    if (r.code !== 0) return null
    const m = re.exec(`${r.stdout}\n${r.stderr}`)
    return m ? m[1] : null
  }
  versions = {
    slither: await v(BIN.slither, ['--version'], /(\d+\.\d+\.\d+)/),
    aderyn: await v(BIN.aderyn, ['--version'], /(\d+\.\d+\.\d+)/),
    forge: await v(BIN.forge, ['--version'], /(\d+\.\d+\.\d+[^\s]*)/),
    semgrep: fs.existsSync(SEMGREP_RULES) ? await v(BIN.semgrep, ['--version'], /(\d+\.\d+\.\d+)/) : null,
  }
  solcs = listSolc()
}

/* -------------------------------------------------------------- workspace --- */

function safeRel(p) {
  if (typeof p !== 'string') return null
  const s = p.replace(/\\/g, '/').replace(/^\.\/+/, '')
  if (!s || s.startsWith('/') || /^[A-Za-z]:/.test(s) || /[\x00-\x1f]/.test(s)) return null
  const parts = s.split('/').filter(Boolean)
  if (parts.some((x) => x === '..' || x === '.') || parts.length > 30) return null
  return parts.join('/')
}

const ALLOWED = { solidity: /(\.sol|(^|\/)remappings\.txt)$/i, web2: /\.(m?js|cjs|jsx|ts|tsx|mts|cts|sol)$/i }

function writeTree(root, files, mode) {
  let n = 0
  for (const f of Array.isArray(files) ? files : []) {
    const rel = safeRel(f?.path)
    if (!rel || !ALLOWED[mode].test(rel) || typeof f.content !== 'string') continue
    const abs = path.join(root, rel)
    if (!abs.startsWith(root + path.sep)) continue
    fs.mkdirSync(path.dirname(abs), { recursive: true })
    fs.writeFileSync(abs, f.content, { flag: 'wx' })
    n++
  }
  return n
}

function remappingsFor(root, given) {
  const out = new Map()
  const add = (line) => {
    const m = /^([^=\s]+)=([^\s]+)$/.exec(String(line).trim())
    if (!m) return
    const ctx = m[1].includes(':') ? null : m[1]
    const target = safeRel(m[2].replace(/\/?$/, '/'))
    if (ctx && target) out.set(ctx, target.endsWith('/') ? target : target + '/')
  }
  ;(Array.isArray(given) ? given : []).forEach(add)
  try {
    fs.readFileSync(path.join(root, 'remappings.txt'), 'utf8').split(/\r?\n/).forEach(add)
  } catch {
    /* none */
  }
  const guess = [
    ['forge-std/', 'lib/forge-std/src/'],
    ['@openzeppelin/contracts/', 'lib/openzeppelin-contracts/contracts/'],
    ['@openzeppelin/contracts-upgradeable/', 'lib/openzeppelin-contracts-upgradeable/contracts/'],
    ['solmate/', 'lib/solmate/src/'],
    ['solady/', 'lib/solady/src/'],
  ]
  for (const [k, v] of guess) if (!out.has(k) && fs.existsSync(path.join(root, v))) out.set(k, v)
  return [...out].map(([k, v]) => `${k}=${v}`)
}

function srcDir(inScope) {
  const list = Array.isArray(inScope) ? inScope.map(safeRel).filter(Boolean) : []
  for (const d of ['src', 'contracts']) if (list.length && list.every((p) => p.startsWith(d + '/'))) return d
  return '.'
}

const tomlStr = (s) => JSON.stringify(String(s))
function writeFoundryToml(root, { solc, remappings, src }) {
  const toml = [
    '[profile.default]',
    `src = ${tomlStr(src)}`,
    'out = "out"',
    'libs = ["lib", "node_modules"]',
    'test = "gully-no-tests"',
    'script = "gully-no-scripts"',
    'cache_path = "cache"',
    'ffi = false',
    'offline = true',
    'auto_detect_solc = false',
    `solc = ${tomlStr(solc)}`,
    'build_info = true',
    'extra_output = ["abi", "metadata"]',
    `remappings = [${remappings.map(tomlStr).join(', ')}]`,
    'fs_permissions = []',
    '',
  ].join('\n')
  fs.writeFileSync(path.join(root, 'foundry.toml'), toml)
}

/* ---------------------------------------------------------------- analyze --- */

async function analyze(body) {
  const mode = body.mode === 'web2' ? 'web2' : 'solidity'
  const want = new Set(Array.isArray(body.tools) ? body.tools : [])
  const job = fs.mkdtempSync(path.join(WORK, 'job-'))
  const root = path.join(job, 'src-root')
  fs.mkdirSync(root)
  const result = {}
  try {
    const n = writeTree(root, body.files, mode)
    if (!n) return { tools: Object.fromEntries([...want].map((t) => [t, { status: 'skipped', reason: 'no files', version: versions[t.replace('forge-build', 'forge')] ?? null }])) }
    if (mode === 'web2') {
      if (want.has('semgrep')) result.semgrep = await semgrep(root, 'web')
      return { tools: result }
    }
    const solcV = pickSolc(typeof body.solcVersion === 'string' ? body.solcVersion : null)
    const solc = solcV ? solcPath(solcV) : null
    const remaps = remappingsFor(root, body.remappings)
    let built = false
    if (want.has('forge-build')) {
      if (!versions.forge) result['forge-build'] = { status: 'skipped', version: null, reason: 'forge not installed' }
      else if (!solc) result['forge-build'] = { status: 'skipped', version: versions.forge, reason: 'no solc installed' }
      else {
        writeFoundryToml(root, { solc, remappings: remaps, src: srcDir(body.inScope) })
        const r = await run(BIN.forge, ['build', '--offline', '--force', '--skip', 'test', '--skip', 'script', '--no-auto-detect', '--use', solc], { cwd: root })
        built = r.code === 0
        result['forge-build'] = { status: built ? 'ran' : 'failed', version: versions.forge, durationMs: r.ms, reason: built ? `solc ${solcV}` : `build failed${r.timedOut ? ' (timeout)' : ''}: ${tail(r.stderr || r.stdout, 400)}`, output: null }
      }
    }
    if (want.has('slither')) result.slither = await slither(root, { built, solc, solcV, remaps, inScope: body.inScope })
    if (want.has('aderyn')) result.aderyn = await aderyn(root)
    if (want.has('semgrep')) result.semgrep = await semgrep(root, 'solidity')
    return { tools: result }
  } finally {
    fs.rmSync(job, { recursive: true, force: true })
  }
}

async function slither(root, { built, solc, solcV, remaps, inScope }) {
  if (!versions.slither) return { status: 'skipped', version: null, reason: 'slither not installed' }
  const filter = ['--filter-paths', '(^|/)(lib|node_modules|test|tests|script|mocks?)/']
  const t0 = Date.now()
  if (built) {
    const out = path.join(root, '..', 'slither.json')
    const r = await run(BIN.slither, ['.', '--ignore-compile', '--foundry-out-directory', 'out', '--json', out, ...filter, '--disable-color'], { cwd: root })
    const j = readJsonFile(out)
    if (j?.success) return { status: 'ran', version: versions.slither, durationMs: r.ms, reason: null, output: j }
  }
  if (!solc) return { status: 'failed', version: versions.slither, durationMs: Date.now() - t0, reason: 'no solc installed for this pragma', output: null }
  // Fallback: each in-scope file compiled by solc directly (no framework detection at all).
  const files = (Array.isArray(inScope) ? inScope : []).map(safeRel).filter((p) => p && /\.sol$/.test(p) && fs.existsSync(path.join(root, p))).slice(0, 60)
  const merged = { success: true, error: null, results: { detectors: [] } }
  const errors = []
  for (const f of files) {
    const out = path.join(root, '..', `slither-${crypto.randomBytes(4).toString('hex')}.json`)
    const args = [f, '--compile-force-framework', 'solc', '--solc', solc, '--solc-args', `--base-path . --include-path lib --include-path node_modules --allow-paths .`, '--json', out, ...filter, '--disable-color']
    if (remaps.length) args.splice(5, 0, '--solc-remaps', remaps.join(' '))
    const r = await run(BIN.slither, args, { cwd: root })
    const j = readJsonFile(out)
    if (j?.success) merged.results.detectors.push(...(j.results?.detectors ?? []))
    else errors.push(`${f}: ${tail(j?.error ?? r.stderr, 200)}`)
  }
  const ok = files.length && errors.length < files.length
  return { status: ok ? 'ran' : 'failed', version: versions.slither, durationMs: Date.now() - t0, reason: ok ? (errors.length ? `${errors.length} file(s) did not compile with solc ${solcV}` : `solc ${solcV}, per-file`) : `compile failed: ${errors.slice(0, 2).join(' | ') || 'no in-scope files'}`, output: ok ? merged : null }
}

async function aderyn(root) {
  if (!versions.aderyn) return { status: 'skipped', version: null, reason: 'aderyn not installed' }
  const out = path.join(root, '..', 'aderyn.json')
  const r = await run(BIN.aderyn, ['.', '--output', out, '--skip-update-check'], { cwd: root })
  const j = readJsonFile(out)
  return j ? { status: 'ran', version: versions.aderyn, durationMs: r.ms, reason: null, output: j } : { status: 'failed', version: versions.aderyn, durationMs: r.ms, reason: tail(r.stderr || r.stdout, 400) || 'no report', output: null }
}

async function semgrep(root, which) {
  if (!versions.semgrep) return { status: 'skipped', version: null, reason: 'semgrep not installed' }
  const rules = path.join(SEMGREP_RULES, which === 'web' ? 'web.yaml' : 'solidity.yaml')
  if (!fs.existsSync(rules)) return { status: 'skipped', version: versions.semgrep, reason: `no ${which} rules baked into the image` }
  const r = await run(BIN.semgrep, ['scan', '--config', rules, '--json', '--metrics=off', '--disable-version-check', '--no-git-ignore', '--timeout', '30', '--max-target-bytes', '1000000', '--quiet', '.'], { cwd: root })
  let j = null
  try {
    j = JSON.parse(r.stdout)
  } catch {
    j = null
  }
  return j ? { status: 'ran', version: versions.semgrep, durationMs: r.ms, reason: null, output: { results: j.results ?? [], errors: (j.errors ?? []).length } } : { status: 'failed', version: versions.semgrep, durationMs: r.ms, reason: tail(r.stderr, 400) || 'no output', output: null }
}

function readJsonFile(p) {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'))
  } catch {
    return null
  }
}

/* -------------------------------------------------------------------- poc --- */

async function poc(body) {
  if (!versions.forge) return { status: 'error', durationMs: 0, output: 'forge not installed' }
  const rel = safeRel(body?.test?.path)
  if (!rel || !/^test\/GullyPoc_[A-Za-z0-9]+\.t\.sol$/.test(rel) || typeof body.test.content !== 'string' || body.test.content.length > 50_000) return { status: 'error', durationMs: 0, output: 'bad test' }
  if (/\bvm\s*\.\s*(ffi|setEnv|envOr|readFile|writeFile|createSelectFork|createFork|rpc)\b/.test(body.test.content)) return { status: 'error', durationMs: 0, output: 'cheatcodes that touch files, env, network or processes are not allowed' }
  const job = fs.mkdtempSync(path.join(WORK, 'poc-'))
  const root = path.join(job, 'src-root')
  fs.mkdirSync(root)
  try {
    writeTree(root, body.files, 'solidity')
    fs.mkdirSync(path.join(root, 'test'), { recursive: true })
    fs.writeFileSync(path.join(root, rel), body.test.content)
    if (!fs.existsSync(path.join(root, 'lib', 'forge-std')) && fs.existsSync(FORGE_STD)) fs.cpSync(FORGE_STD, path.join(root, 'lib', 'forge-std'), { recursive: true })
    const solcV = pickSolc(typeof body.solcVersion === 'string' ? body.solcVersion : null)
    const solc = solcV ? solcPath(solcV) : null
    if (!solc) return { status: 'error', durationMs: 0, output: 'no solc' }
    writeFoundryToml(root, { solc, remappings: remappingsFor(root, []), src: '.' })
    fs.writeFileSync(path.join(root, 'foundry.toml'), fs.readFileSync(path.join(root, 'foundry.toml'), 'utf8').replace('test = "gully-no-tests"', 'test = "test"'))
    const r = await run(BIN.forge, ['test', '--offline', '--no-auto-detect', '--use', solc, '--match-path', rel, '-vv'], { cwd: root, timeoutMs: Math.min(TOOL_TIMEOUT, 180_000) })
    const passed = r.code === 0 && /\[PASS\]/.test(r.stdout)
    const failed = /\[FAIL/.test(r.stdout)
    return { status: passed ? 'passed' : failed ? 'failed' : 'error', durationMs: r.ms, output: tail(r.stdout + r.stderr, 4000) }
  } finally {
    fs.rmSync(job, { recursive: true, force: true })
  }
}

/* ------------------------------------------------------------------ server --- */

let busy = false

function authed(req) {
  const got = Buffer.from(String(req.headers['x-scanner-token'] ?? ''))
  const want = Buffer.from(TOKEN)
  return got.length === want.length && crypto.timingSafeEqual(got, want)
}

function send(res, status, body) {
  const b = Buffer.from(JSON.stringify(body))
  res.writeHead(status, { 'content-type': 'application/json', 'content-length': b.length, 'cache-control': 'no-store' })
  res.end(b)
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let n = 0
    req.on('data', (c) => {
      n += c.length
      if (n > MAX_BODY) {
        reject(Object.assign(new Error('too large'), { status: 413 }))
        req.destroy()
      } else chunks.push(c)
    })
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch {
        reject(Object.assign(new Error('bad json'), { status: 400 }))
      }
    })
    req.on('error', reject)
  })
}

const server = http.createServer(async (req, res) => {
  if (!authed(req)) return send(res, 401, { error: 'unauthorised' })
  const url = new URL(req.url, 'http://x')
  try {
    if (req.method === 'GET' && url.pathname === '/health') return send(res, 200, { ok: true, tools: versions, solc: solcs, busy })
    if (req.method !== 'POST' || !['/analyze', '/poc'].includes(url.pathname)) return send(res, 404, { error: 'not found' })
    if (busy) return send(res, 429, { error: 'busy' })
    busy = true
    try {
      const body = await readBody(req)
      return send(res, 200, url.pathname === '/analyze' ? await analyze(body) : await poc(body))
    } finally {
      busy = false
    }
  } catch (e) {
    console.error('gully-scanner:', e?.message ?? e)
    if (!res.headersSent) send(res, e?.status ?? 500, { error: e?.status ? e.message : 'internal error' })
  }
})

await detect()
fs.mkdirSync(WORK, { recursive: true })
server.listen(PORT, HOST, () => console.log(`gully-scanner on ${HOST}:${PORT}; tools ${JSON.stringify(versions)}; solc ${solcs.join(',') || 'none'}`))
