// Stubs around the REAL Gully Security scan engine (server/security) for the product UI's tests
// (test-security-routes.mjs, e2e.mjs). Nothing is stubbed inside the engine: its outbound calls are pointed
// at a local HTTP server (Etherscan V2, Blockscout, Sourcify, GitHub API and codeload) and its test hooks
// answer for the RPC, the static-tools worker (absent by default, as on the server today) and Claude.
//
//   const stubs = await installEngineStubs()      call BEFORE the server is imported (it sets env vars)
//   stubs.ADDR_VERIFIED     a verified VulnBank contract (AI review finds a reentrancy with a draft PoC)
//   stubs.ADDR_UNVERIFIED   no verified source: a bytecode-only report
//   stubs.REPO              'acme/vault' at stubs.COMMIT; 'acme/missing' does not exist (the scan fails)
//   stubs.setDelay(ms)      slows every AI call (to hold scans in "analysing")
//   stubs.setWorker(bool)   the static-tools worker reachable or not
//   stubs.setAi(bool)       the AI review available or not

import crypto from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import zlib from 'node:zlib'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))

export async function installEngineStubs() {
  const VULN = fs.readFileSync(path.join(here, 'security', 'vuln', 'src', 'VulnBank.sol'), 'utf8')
  const RECORDED = JSON.parse(fs.readFileSync(path.join(here, 'security', 'worker-analyze-vulnbank.json'), 'utf8'))
  const COMMIT = 'c0ffee00' + crypto.randomBytes(16).toString('hex')
  const ADDR_VERIFIED = '0x' + '1b'.repeat(20)
  const ADDR_UNVERIFIED = '0x' + '2c'.repeat(20)
  const { writeTar } = await import('../../server/security/archive.mjs')
  const tarball = zlib.gzipSync(writeTar([{ path: `acme-vault-${COMMIT.slice(0, 7)}/src/VulnBank.sol`, data: VULN }]))

  const stub = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x')
    const send = (status, body, type = 'application/json') => {
      res.writeHead(status, { 'content-type': type })
      res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body))
    }
    if (u.pathname === '/etherscan/v2/api') {
      if (u.searchParams.get('address') === ADDR_VERIFIED)
        return send(200, { status: '1', message: 'OK', result: [{ SourceCode: `{${JSON.stringify({ language: 'Solidity', sources: { 'src/VulnBank.sol': { content: VULN } }, settings: { remappings: [] } })}}`, ABI: '[]', ContractName: 'VulnBank', CompilerVersion: 'v0.8.24+commit.e11b9ed9', OptimizationUsed: '1', Runs: '200', EVMVersion: 'Default', Proxy: '0', Implementation: '' }] })
      return send(200, { status: '1', message: 'OK', result: [{ SourceCode: '', ABI: 'Contract source code not verified', ContractName: '' }] })
    }
    if (u.pathname.startsWith('/blockscout/') || u.pathname.startsWith('/sourcify/')) return send(404, { message: 'Not found' })
    if (u.pathname === '/gh/repos/acme/vault') return send(200, { private: false, size: 120, default_branch: 'main' })
    if (u.pathname.startsWith('/gh/repos/acme/vault/commits/')) {
      const ref = decodeURIComponent(u.pathname.split('/').pop())
      if (COMMIT.startsWith(ref) || ref === 'main' || ref === 'HEAD') return send(200, { sha: COMMIT })
      return send(422, { message: 'No commit found' })
    }
    if (u.pathname === `/codeload/acme/vault/tar.gz/${COMMIT}`) return send(200, tarball, 'application/gzip')
    send(404, { message: 'Not Found' })
  })
  await new Promise((r) => stub.listen(0, '127.0.0.1', r))
  stub.unref()
  const SB = `http://127.0.0.1:${stub.address().port}`
  Object.assign(process.env, {
    ETHERSCAN_API_KEY: `TESTKEY${crypto.randomBytes(8).toString('hex')}`,
    SECURITY_ETHERSCAN_URL: `${SB}/etherscan/v2/api`,
    SECURITY_BLOCKSCOUT_URL: `${SB}/blockscout`,
    SECURITY_SOURCIFY_URL: `${SB}/sourcify`,
    SECURITY_GITHUB_API: `${SB}/gh`,
    SECURITY_GITHUB_CODELOAD: `${SB}/codeload`,
    SECURITY_AI_TIMEOUT_SEC: '20',
  })
  delete process.env.SCANNER_URL

  const { setRpcForTest } = await import('../../server/security/fetchers.mjs')
  const { setWorkerForTest } = await import('../../server/security/tools.mjs')
  const { setClaudeForTest } = await import('../../server/security/claude.mjs')
  // Runtime bytecode with a PUSH4 selector, DELEGATECALL and CBOR metadata naming solc 0.8.24.
  const cbor = 'a264697066735822' + '00'.repeat(34) + '64736f6c6343000818' + '0033'
  const BYTECODE = '0x6080604052' + '6340c10f19' + '14' + '6100aa57' + 'f4' + '00' + cbor
  setRpcForTest(async (_chainId, method, params) => {
    if (method === 'eth_getCode') return params[0] === ADDR_UNVERIFIED ? BYTECODE : '0x6080'
    if (method === 'eth_getStorageAt') return '0x' + '0'.repeat(64)
    throw new Error('unexpected rpc')
  })
  let worker = false
  setWorkerForTest(async ({ path: p, body }) => {
    if (!worker) throw Object.assign(new Error('scanner worker not reachable'), { code: 'worker-absent' })
    if (p === '/health') return { ok: true, tools: { slither: '0.11.6', aderyn: null, forge: '1.8.1', semgrep: null }, solc: ['0.8.24'] }
    if (p === '/analyze') return { tools: Object.fromEntries(body.tools.map((n) => [n, RECORDED.response.tools[n] ?? { status: 'skipped', reason: 'not installed', version: null }])) }
    throw new Error('unexpected worker path')
  })
  let delay = 0
  const claude = async (body) => {
    if (delay) await new Promise((r) => setTimeout(r, delay))
    const user = body.messages[0].content
    if (!body.output_config?.format) return { content: [{ type: 'text', text: 'FIXTURE SUMMARY (test stub): the automated scan raised a high-severity reentrancy and a medium tx.origin check. Findings are AI-assisted and unverified.' }], stop_reason: 'end_turn', usage: { input_tokens: 400, output_tokens: 60 } }
    const file = /path="([^"]+)"/.exec(user)?.[1] ?? 'src/VulnBank.sol'
    const findings = []
    if (/function withdraw/.test(user)) findings.push({ title: 'Reentrancy in withdraw drains the bank', category: 'reentrancy', likelihood: 'medium', impact: 'high', confidence: 'high', file, line: 21, endLine: 23, toolRefs: [], description: 'External call before the balance is updated.', explanation: 'An attacker can call withdraw again before their balance is zeroed.', recommendation: 'Zero the balance before the call or add a reentrancy guard.', poc: 'contract VulnBankTest is Test { function test_reenter() public {} }' })
    if (/tx\.origin/.test(user)) findings.push({ title: 'tx.origin used for authorisation', category: 'access-control', likelihood: 'medium', impact: 'medium', confidence: 'medium', file, line: 28, endLine: 28, toolRefs: [], description: 'tx.origin check.', explanation: 'A phishing contract can make the owner sweep funds.', recommendation: 'Use msg.sender.', poc: '' })
    return { content: [{ type: 'text', text: JSON.stringify({ findings, dismissed: [] }) }], stop_reason: 'end_turn', usage: { input_tokens: 3000, output_tokens: 800 }, model: body.model }
  }
  setClaudeForTest(claude)
  return {
    ADDR_VERIFIED,
    ADDR_UNVERIFIED,
    COMMIT,
    REPO: 'acme/vault',
    setDelay: (ms) => (delay = ms),
    setWorker: (on) => (worker = !!on),
    /** The AI review configured (the stub) or not (no key, no stub). */
    setAi: (on) => setClaudeForTest(on ? claude : null),
    close: () => stub.close(),
  }
}
