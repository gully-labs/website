// Fetching what a scan reads: verified source + metadata for an address (Etherscan V2 multichain, then
// Blockscout, then Sourcify), bytecode and proxy slots over JSON-RPC, a GitHub tarball at one exact commit,
// and uploaded archives. Every response is size-capped and time-limited; nothing fetched is executed.
// API keys go only in the request; error messages never include a URL that carries one.

import { config } from './config.mjs'
import { CHAINS } from './chains.mjs'
import { ArchiveError, gunzipCapped, readTar, readZip } from './archive.mjs'
import { EIP1967_IMPL_SLOT } from './bytecode.mjs'
import { keepForKind } from './source.mjs'

export class FetchError extends Error {
  constructor(code, message) {
    super(message)
    this.code = code
  }
}

/** GET/POST with a byte cap on the body (streamed; aborted past the cap). */
export async function fetchCapped(url, { method = 'GET', headers = {}, body, maxBytes = 5 * 1024 * 1024, timeoutMs = config.fetchTimeoutMs(), what = 'request' } = {}) {
  let r
  try {
    r = await fetch(url, { method, headers: { 'user-agent': 'gully-security/1 (+https://gullylabs.xyz)', ...headers }, body, redirect: 'manual', signal: AbortSignal.timeout(timeoutMs) })
  } catch (e) {
    throw new FetchError('upstream-unreachable', `${what}: ${e?.name === 'TimeoutError' ? 'timed out' : 'could not be reached'}`)
  }
  const len = Number(r.headers.get('content-length'))
  if (Number.isFinite(len) && len > maxBytes) throw new FetchError('too-large', `${what}: larger than ${maxBytes} bytes`)
  const chunks = []
  let total = 0
  if (r.body) {
    const reader = r.body.getReader()
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.length
      if (total > maxBytes) {
        await reader.cancel().catch(() => {})
        throw new FetchError('too-large', `${what}: larger than ${maxBytes} bytes`)
      }
      chunks.push(value)
    }
  }
  return { status: r.status, headers: r.headers, body: Buffer.concat(chunks) }
}

const asJson = (buf) => {
  try {
    return JSON.parse(buf.toString('utf8'))
  } catch {
    return null
  }
}

/* --------------------------------------------------------------- explorers --- */

/** Turns Etherscan's SourceCode field (plain, multi-file JSON, or {{standard-json}}) into files. */
export function parseEtherscanSource(sourceCode, contractName) {
  const s = String(sourceCode ?? '').trim()
  if (!s) return { files: [], remappings: [] }
  if (s.startsWith('{')) {
    const j = asJson(Buffer.from(s.startsWith('{{') ? s.slice(1, -1) : s))
    if (j && typeof j === 'object') {
      const sources = j.sources && typeof j.sources === 'object' ? j.sources : j
      const files = Object.entries(sources)
        .filter(([, v]) => v && typeof v.content === 'string')
        .map(([p, v]) => ({ path: p, content: v.content }))
      if (files.length) return { files, remappings: Array.isArray(j.settings?.remappings) ? j.settings.remappings.map(String) : [] }
    }
  }
  return { files: [{ path: `${String(contractName || 'Contract').replace(/[^\w.-]/g, '') || 'Contract'}.sol`, content: s }], remappings: [] }
}

async function fromEtherscan(chainId, address) {
  const key = config.etherscanKey()
  if (!key) return { skipped: 'ETHERSCAN_API_KEY not set' }
  const u = new URL(config.etherscanBase())
  u.search = new URLSearchParams({ chainid: String(chainId), module: 'contract', action: 'getsourcecode', address, apikey: key }).toString()
  const r = await fetchCapped(u.href, { maxBytes: 20 * 1024 * 1024, what: 'Etherscan' })
  const j = asJson(r.body)
  if (r.status !== 200 || !j) return { error: `Etherscan answered HTTP ${r.status}` }
  if (String(j.status) !== '1' || !Array.isArray(j.result) || !j.result[0]) return { error: `Etherscan: ${String(typeof j.result === 'string' ? j.result : j.message ?? 'no result').slice(0, 80).replace(key, '***')}` }
  const x = j.result[0]
  const unverified = !x.SourceCode || /not verified/i.test(String(x.ABI))
  if (unverified) return { verified: false }
  const { files, remappings } = parseEtherscanSource(x.SourceCode, x.ContractName)
  return {
    verified: true,
    provider: 'etherscan',
    contractName: x.ContractName || null,
    compiler: { version: x.CompilerVersion || null, optimizer: x.OptimizationUsed === '1', runs: Number(x.Runs) || null, evmVersion: x.EVMVersion && x.EVMVersion !== 'Default' ? x.EVMVersion : null },
    proxyHint: x.Proxy === '1' && /^0x[0-9a-fA-F]{40}$/.test(x.Implementation ?? '') ? x.Implementation.toLowerCase() : null,
    files,
    remappings,
  }
}

async function fromBlockscout(chainId, address) {
  const base = config.blockscoutOverride() ?? CHAINS[chainId].blockscout
  if (!base) return { skipped: 'no Blockscout instance for this chain' }
  const r = await fetchCapped(`${base.replace(/\/+$/, '')}/api/v2/smart-contracts/${address}`, { maxBytes: 20 * 1024 * 1024, what: 'Blockscout' })
  if (r.status === 404) return { verified: false }
  const j = asJson(r.body)
  if (r.status !== 200 || !j) return { error: `Blockscout answered HTTP ${r.status}` }
  if (!j.source_code || j.is_verified === false) return { verified: false }
  const files = [{ path: j.file_path || `${j.name || 'Contract'}.sol`, content: String(j.source_code) }]
  for (const a of Array.isArray(j.additional_sources) ? j.additional_sources : []) if (a?.file_path && typeof a.source_code === 'string') files.push({ path: a.file_path, content: a.source_code })
  return {
    verified: true,
    provider: 'blockscout',
    contractName: j.name || null,
    compiler: { version: j.compiler_version || null, optimizer: j.optimization_enabled ?? null, runs: Number(j.optimization_runs) || null, evmVersion: j.evm_version && j.evm_version !== 'default' ? j.evm_version : null },
    proxyHint: null,
    files,
    remappings: [],
  }
}

async function fromSourcify(chainId, address) {
  const r = await fetchCapped(`${config.sourcifyBase().replace(/\/+$/, '')}/v2/contract/${chainId}/${address}?fields=sources,compilation`, { maxBytes: 20 * 1024 * 1024, what: 'Sourcify' })
  if (r.status === 404) return { verified: false }
  const j = asJson(r.body)
  if (r.status !== 200 || !j) return { error: `Sourcify answered HTTP ${r.status}` }
  if (!j.sources || !Object.keys(j.sources).length) return { verified: false }
  const c = j.compilation ?? {}
  return {
    verified: true,
    provider: 'sourcify',
    contractName: c.name || null,
    compiler: { version: c.compilerVersion || null, optimizer: c.compilerSettings?.optimizer?.enabled ?? null, runs: c.compilerSettings?.optimizer?.runs ?? null, evmVersion: c.compilerSettings?.evmVersion ?? null },
    proxyHint: null,
    files: Object.entries(j.sources).filter(([, v]) => typeof v?.content === 'string').map(([p, v]) => ({ path: p, content: v.content })),
    remappings: Array.isArray(c.compilerSettings?.remappings) ? c.compilerSettings.remappings.map(String) : [],
  }
}

/* --------------------------------------------------------------------- rpc --- */

let rpcImpl = null
/** Test hook: replace JSON-RPC (chainId, method, params) => result. */
export function setRpcForTest(fn) {
  rpcImpl = fn
}

async function rpc(chainId, method, params) {
  if (rpcImpl) return rpcImpl(chainId, method, params)
  try {
    const pay = await import('../payments.mjs')
    if (pay.CHAINS?.[chainId]) return await pay.rpc(chainId, method, params)
  } catch (e) {
    if (e?.code !== 'ERR_MODULE_NOT_FOUND') {
      /* fall through to the explorers' RPC */
    }
  }
  const key = config.etherscanKey()
  if (key && method === 'eth_getCode') {
    const u = new URL(config.etherscanBase())
    u.search = new URLSearchParams({ chainid: String(chainId), module: 'proxy', action: 'eth_getCode', address: params[0], tag: 'latest', apikey: key }).toString()
    const r = await fetchCapped(u.href, { maxBytes: 1024 * 1024, what: 'Etherscan RPC' })
    const j = asJson(r.body)
    if (typeof j?.result === 'string' && j.result.startsWith('0x')) return j.result
  }
  const bs = config.blockscoutOverride() ?? CHAINS[chainId].blockscout
  if (bs) {
    const r = await fetchCapped(`${bs.replace(/\/+$/, '')}/api/eth-rpc`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), maxBytes: 1024 * 1024, what: 'Blockscout RPC' })
    const j = asJson(r.body)
    if (j && 'result' in j) return j.result
  }
  throw new FetchError('rpc-unavailable', 'no RPC answered for this chain')
}

/**
 * Everything known about a deployed contract. Never throws for "unverified": returns verified:false with
 * the bytecode so the scan can run in bytecode-only mode. `attempts` records each provider's outcome.
 */
export async function fetchAddress(chainId, address) {
  const attempts = []
  let src = null
  for (const [name, fn] of [['etherscan', fromEtherscan], ['blockscout', fromBlockscout], ['sourcify', fromSourcify]]) {
    let r
    try {
      r = await fn(chainId, address)
    } catch (e) {
      r = { error: String(e?.message ?? e).slice(0, 120) }
    }
    attempts.push({ provider: name, outcome: r.skipped ? `skipped: ${r.skipped}` : r.error ? `error: ${r.error}` : r.verified ? 'verified' : 'not verified' })
    if (r.verified && r.files?.length) {
      src = r
      break
    }
  }
  let bytecode = null
  let implementation = null
  try {
    bytecode = await rpc(chainId, 'eth_getCode', [address, 'latest'])
  } catch (e) {
    attempts.push({ provider: 'rpc', outcome: `error: ${String(e?.message ?? e).slice(0, 80)}` })
  }
  try {
    const slot = await rpc(chainId, 'eth_getStorageAt', [address, EIP1967_IMPL_SLOT, 'latest'])
    const a = /^0x0*([0-9a-fA-F]{40})$/.exec(String(slot ?? ''))
    if (a && !/^0+$/.test(a[1])) implementation = `0x${a[1].toLowerCase()}`
  } catch {
    /* proxy check is best effort */
  }
  implementation ??= src?.proxyHint ?? null
  if (bytecode !== null && typeof bytecode !== 'string') bytecode = null
  if (!src && bytecode === null && attempts.every((a) => a.outcome.startsWith('error') || a.outcome.startsWith('skipped'))) {
    throw new FetchError('explorers-unavailable', 'no explorer or RPC could be read for this address; try again later')
  }
  return {
    verified: !!src,
    provider: src?.provider ?? null,
    contractName: src?.contractName ?? null,
    compiler: src?.compiler ?? null,
    files: src?.files ?? [],
    remappings: src?.remappings ?? [],
    bytecode,
    proxy: { isProxy: !!implementation, implementation, kind: implementation ? 'eip1967' : null },
    attempts,
  }
}

/* ------------------------------------------------------------------ GitHub --- */

/** Resolves a ref to a full commit SHA and checks the repo is public and not too big. */
export async function resolveGithub(repo) {
  const headers = { accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', ...(config.githubToken() ? { authorization: `Bearer ${config.githubToken()}` } : {}) }
  const api = config.githubApi().replace(/\/+$/, '')
  const meta = await fetchCapped(`${api}/repos/${repo.owner}/${repo.name}`, { headers, maxBytes: 512 * 1024, what: 'GitHub' })
  if (meta.status === 404) throw new FetchError('repo-not-found', 'the repository does not exist or is private (only public repositories can be scanned)')
  const mj = asJson(meta.body)
  if (meta.status !== 200 || !mj) throw new FetchError('github-unavailable', `GitHub answered HTTP ${meta.status}`)
  if (mj.private) throw new FetchError('repo-private', 'only public repositories can be scanned')
  if (Number(mj.size) * 1024 > config.maxTarballBytes() * 8) throw new FetchError('repo-too-large', 'the repository is too large to scan; upload the contracts as a zip instead')
  const c = await fetchCapped(`${api}/repos/${repo.owner}/${repo.name}/commits/${encodeURIComponent(repo.ref)}`, { headers, maxBytes: 2 * 1024 * 1024, what: 'GitHub' })
  const cj = asJson(c.body)
  if (c.status === 404 || c.status === 422) throw new FetchError('commit-not-found', `commit or ref "${repo.ref}" was not found in ${repo.owner}/${repo.name}`)
  if (c.status !== 200 || !/^[0-9a-f]{40}$/.test(cj?.sha ?? '')) throw new FetchError('github-unavailable', `GitHub answered HTTP ${c.status}`)
  if (repo.commit && !cj.sha.startsWith(repo.commit)) throw new FetchError('commit-not-found', 'the commit did not resolve to itself')
  return { ...repo, commit: cj.sha, defaultBranch: mj.default_branch ?? null }
}

/** Downloads the tarball of exactly `commit` and returns the kept files (in memory). */
export async function fetchGithubFiles(repo, kind) {
  const url = `${config.githubCodeload().replace(/\/+$/, '')}/${repo.owner}/${repo.name}/tar.gz/${repo.commit}`
  const r = await fetchCapped(url, { maxBytes: config.maxTarballBytes(), timeoutMs: Math.max(config.fetchTimeoutMs(), 60_000), what: 'GitHub tarball' })
  if (r.status !== 200) throw new FetchError('github-unavailable', `GitHub tarball answered HTTP ${r.status}`)
  return unpack(() => readTar(gunzipCapped(r.body, config.maxUnpackedBytes() * 4), { keep: keepFn(kind), maxFiles: config.maxFiles(), maxBytes: config.maxUnpackedBytes(), stripFirst: true }))
}

/** Files from an upload (zip or a single .sol). */
export function uploadFiles(data, archive, name, kind) {
  if (archive === 'sol') return [{ path: name, content: data.toString('utf8') }]
  return unpack(() => readZip(data, { keep: keepFn(kind), maxFiles: config.maxFiles(), maxBytes: config.maxUnpackedBytes(), maxFileBytes: config.maxFileBytes() }))
}

const keepFn = (kind) => {
  const k = keepForKind(kind === 'web2' ? 'web2' : 'contracts')
  return (p, size) => size <= config.maxFileBytes() && k(p)
}

function unpack(fn) {
  try {
    return fn().map((f) => ({ path: f.path, content: f.data.toString('utf8') }))
  } catch (e) {
    if (e instanceof ArchiveError) throw new FetchError(e.code, e.message)
    throw e
  }
}
