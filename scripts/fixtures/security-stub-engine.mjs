// A STUB scan engine for the Gully Security tests (test-security-routes.mjs, e2e.mjs). It never ships: the
// server loads the real engine (part 1, server/security/) through server/security-engine.mjs, and the tests
// install this one with setEngineForTest(). It follows the contract in server/security-contract.mjs:
// createScan / getScan / listScans / cancelScan and onProgress(listener).
//
// A scan walks queued -> fetching -> analysing -> triaging -> done, one step per `stepMs`, with progress pct.
// Inputs whose address or repo contains "fail" end in `failed`. The report is FIXTURE data for tests only.

import { EventEmitter } from 'node:events'

export function createStubEngine({ stepMs = 150 } = {}) {
  const scans = new Map()
  const events = new EventEmitter()
  const listeners = new Set()
  let n = 0
  const STEPS = [
    ['queued', 0],
    ['fetching', 15],
    ['analysing', 45],
    ['triaging', 80],
  ]
  const emit = (s) => {
    s.updatedAt = new Date().toISOString()
    for (const l of listeners) l(view(s))
    events.emit('progress', view(s))
  }
  const report = (input) => ({
    scope: input.kind === 'address' ? { chain: input.chain, address: input.address, contracts: ['Vault', 'Token'] } : { repo: input.repo ?? null, commit: input.commit ?? 'HEAD', files: ['src/Vault.sol', 'src/Token.sol'] },
    tools: [
      { name: 'slither', version: '0.10.4', ran: true },
      { name: 'aderyn', version: '0.3.2', ran: true },
      { name: 'mythril', version: '0.24.8', ran: false, reason: 'Timed out after 10 minutes on this code size.' },
      { name: 'llm-triage', version: 'stub', ran: true },
    ],
    findings: [
      { id: 'F-1', severity: 'high', title: 'Reentrancy in withdraw()', location: { file: 'src/Vault.sol', line: 42, snippet: 'payable(msg.sender).call{value: amt}("");\nbalances[msg.sender] = 0;' }, description: 'The balance is cleared after the external call, so a contract receiver can re-enter withdraw().', recommendation: 'Clear the balance before the call (checks-effects-interactions) or add a reentrancy guard.', poc: 'contract Attack {\n  function go(Vault v) external { v.withdraw(); }\n  receive() external payable { /* re-enter */ }\n}', pocExecuted: false, status: 'open' },
      { id: 'F-2', severity: 'medium', title: 'Unchecked return value of transfer', location: 'src/Token.sol:88', description: 'The ERC-20 transfer result is ignored.', recommendation: 'Use SafeERC20.safeTransfer.', pocExecuted: false, status: 'open' },
      { id: 'F-3', severity: 'low', title: 'Missing event on owner change', location: { file: 'src/Vault.sol', line: 12 }, description: 'setOwner() emits no event.', recommendation: 'Emit OwnershipTransferred.', pocExecuted: false, status: 'open' },
      { id: 'F-4', severity: 'info', title: 'Floating pragma', location: { file: 'src/Token.sol', line: 2 }, description: 'pragma solidity ^0.8.0 allows many compiler versions.', recommendation: 'Pin the compiler version.', pocExecuted: false, status: 'acknowledged' },
    ],
    summary: 'FIXTURE REPORT (stub engine, tests only): one high, one medium, one low and one informational finding.',
    disclaimer: 'Automated scan. It can miss issues and report false positives. It is not an audit.',
    cost: { usd: 0.42 },
  })
  function advance(s) {
    if (s.status === 'cancelled' || s.status === 'done' || s.status === 'failed') return
    const i = STEPS.findIndex(([st]) => st === s.status)
    const fail = /fail/.test(`${s.input.address ?? ''}${s.input.repo ?? ''}`)
    if (fail && s.status === 'analysing') {
      s.status = 'failed'
      s.error = 'FIXTURE: the analyser crashed.'
      s.progress = { step: 'failed', pct: 45 }
      return emit(s)
    }
    if (i === STEPS.length - 1) {
      s.status = 'done'
      s.progress = { step: 'done', pct: 100 }
      s.report = report(s.input)
      return emit(s)
    }
    const [next, pct] = STEPS[i + 1]
    s.status = next
    s.progress = { step: next, pct }
    emit(s)
    s.timer = setTimeout(() => advance(s), stepMs)
  }
  const view = (s) => (s ? (({ timer, ...rest }) => structuredClone(rest))(s) : null)
  return {
    events,
    calls: [],
    async createScan({ workspace, input, upload }) {
      this.calls.push({ workspace, input, upload: upload ? { name: upload.name, size: upload.size } : null })
      const now = new Date().toISOString()
      const s = { id: `stub_${++n}`, workspace, status: 'queued', input, progress: { step: 'queued', pct: 0 }, createdAt: now, updatedAt: now }
      scans.set(s.id, s)
      s.timer = setTimeout(() => advance(s), stepMs)
      return view(s)
    },
    async getScan(id) {
      return view(scans.get(id))
    },
    async listScans({ workspace } = {}) {
      return [...scans.values()].filter((s) => !workspace || s.workspace === workspace).map(view)
    },
    async cancelScan(id) {
      const s = scans.get(id)
      if (!s) throw new Error('no such scan')
      clearTimeout(s.timer)
      s.status = 'cancelled'
      emit(s)
      return view(s)
    },
    onProgress(l) {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    /** Test helper: finishes every running scan now. */
    finishAll() {
      for (const s of scans.values()) {
        while (!['done', 'failed', 'cancelled'].includes(s.status)) {
          clearTimeout(s.timer)
          advance(s)
          clearTimeout(s.timer)
        }
      }
    },
  }
}
