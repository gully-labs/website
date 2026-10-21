// The public SAMPLE report (/security/sample, GET /api/security/sample): what a buyer of the AI Security Scan gets,
// shown on a FICTIONAL contract (SampleVault.sol, written for this page; it is not deployed anywhere and is no
// one's code). It is built with the engine's own buildReport and must pass validateReport, so it can never drift
// from the real report shape (scripts/test-security-routes.mjs checks both).
// It is in the mode the engine runs in today (ai-only: the static-tools worker is not deployed yet), so the sample
// never shows more than a scan delivers. Every page that shows it labels it "Sample".

import crypto from 'node:crypto'
import { buildReport } from './report.mjs'
import { severityFrom } from './schema.mjs'

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex')

export const SAMPLE_ID = 'scn_SAMPLE_vault_01'
/** Fixed dates: the sample does not pretend to be fresh. */
const CREATED = '2026-10-20T09:00:00.000Z'
const COMPLETED = '2026-10-20T09:06:42.000Z'

const loc = (line, endLine = null) => ({ file: 'src/SampleVault.sol', line, endLine })

function finding(n, f) {
  return { id: `GS-${String(n).padStart(3, '0')}`, severity: severityFrom(f.likelihood, f.impact), category: f.category, triage: 'ai-found', sources: [{ tool: 'ai-review', detector: null }], poc: null, verifiedByHuman: false, status: 'open', ...f }
}

const FINDINGS = [
  finding(1, {
    title: 'Anyone can change the fee recipient',
    likelihood: 'high',
    impact: 'high',
    confidence: 'high',
    category: 'access-control',
    locations: [loc(58, 61)],
    explanation: 'Any wallet can call setFeeRecipient and send every future fee to itself. No special access is needed.',
    description: 'setFeeRecipient(address) is external and has no onlyOwner modifier or role check. The constructor sets owner, but no function reads it. Fees collected in withdraw() are sent to feeRecipient.',
    recommendation: 'Add the onlyOwner modifier (or an AccessControl role) to setFeeRecipient, and emit an event when it changes.',
  }),
  finding(2, {
    title: 'Withdraw sends ETH before updating the balance (reentrancy)',
    likelihood: 'medium',
    impact: 'high',
    confidence: 'high',
    category: 'reentrancy',
    locations: [loc(41, 47)],
    explanation: 'A contract that receives a withdrawal can call withdraw again before its balance is reduced, and drain other depositors.',
    description: 'withdraw(uint256) performs msg.sender.call{value: amount}("") on line 44 and only then subtracts amount from balances[msg.sender] on line 46. The contract has no reentrancy guard.',
    recommendation: 'Update balances[msg.sender] before the external call (checks-effects-interactions) and add OpenZeppelin ReentrancyGuard to withdraw.',
    poc: {
      framework: 'foundry',
      status: 'draft-not-executed',
      code: [
        'contract Attacker {',
        '    SampleVault vault;',
        '    constructor(SampleVault v) { vault = v; }',
        '    function attack() external payable {',
        '        vault.deposit{value: msg.value}();',
        '        vault.withdraw(msg.value);',
        '    }',
        '    receive() external payable {',
        '        if (address(vault).balance >= msg.value) vault.withdraw(msg.value);',
        '    }',
        '}',
      ].join('\n'),
      note: 'Written by the AI and not run: the static-tools worker that executes PoCs is not deployed yet.',
    },
  }),
  finding(3, {
    title: 'ERC-20 transfer result is not checked',
    likelihood: 'medium',
    impact: 'medium',
    confidence: 'medium',
    category: 'unchecked-call',
    locations: [loc(72)],
    explanation: 'With a token that returns false instead of reverting, a failed rescue looks like a success.',
    description: 'rescueToken() calls IERC20(token).transfer(to, amount) and ignores the returned bool.',
    recommendation: 'Use OpenZeppelin SafeERC20 (safeTransfer), which reverts on a false return and on tokens that return nothing.',
  }),
  finding(4, {
    title: 'Fee rounds down to zero on small withdrawals',
    likelihood: 'medium',
    impact: 'low',
    confidence: 'medium',
    category: 'arithmetic',
    locations: [loc(43)],
    explanation: 'Splitting a withdrawal into small amounts avoids the fee completely.',
    description: 'fee = amount * feeBps / 10_000 is 0 whenever amount * feeBps < 10_000, e.g. any amount under 334 wei at 30 bps.',
    recommendation: 'Round the fee up (Math.mulDiv with Rounding.Ceil) or set a minimum withdrawal.',
  }),
  finding(5, {
    title: 'Floating pragma',
    likelihood: 'low',
    impact: 'none',
    confidence: 'high',
    category: 'best-practice',
    locations: [loc(2)],
    explanation: 'The contract can be compiled with a different compiler than the one it was tested with.',
    description: 'pragma solidity ^0.8.20 allows any 0.8.x compiler from 0.8.20 on.',
    recommendation: 'Pin the compiler version used in tests and deployment, e.g. pragma solidity 0.8.26.',
  }),
]

/** The sample report (a fresh copy each call). */
export function sampleReport() {
  const r = buildReport({
    id: SAMPLE_ID,
    workspace: 'sample',
    createdAt: CREATED,
    mode: 'ai-only',
    target: { type: 'upload', chainId: null, address: null, verified: null, repo: null, upload: { name: 'SampleVault.zip', sha256: sha('gully-security-sample-vault'), bytes: 4182 } },
    scope: {
      files: [
        { path: 'src/SampleVault.sol', sha256: sha('src/SampleVault.sol'), lines: 96, nsloc: 64, language: 'solidity', inScope: true, reason: null },
        { path: 'test/SampleVault.t.sol', sha256: sha('test/SampleVault.t.sol'), lines: 58, nsloc: 41, language: 'solidity', inScope: false, reason: 'test file' },
      ],
      totalNsloc: 64,
      inScopeFiles: 1,
      excluded: [{ path: 'test/SampleVault.t.sol', reason: 'test file' }],
    },
    tools: [
      { name: 'slither', version: null, status: 'not-run', reason: 'static tools unavailable: scanner worker not reachable', durationMs: null, findings: 0 },
      { name: 'aderyn', version: null, status: 'not-run', reason: 'static tools unavailable: scanner worker not reachable', durationMs: null, findings: 0 },
      { name: 'forge-build', version: null, status: 'not-run', reason: 'static tools unavailable: scanner worker not reachable', durationMs: null, findings: 0 },
      { name: 'ai-review', version: 'claude-sonnet-5-5', status: 'ran', reason: null, durationMs: 371_000, findings: FINDINGS.length },
    ],
    ai: { used: true, models: { analysis: 'claude-sonnet-5-5', summary: 'claude-haiku-5-5' }, chunks: 2, chunksReviewed: 2, inputTokens: 18_400, outputTokens: 3_150, costUsd: 0.1024, costCapUsd: 2, capped: false, notReviewed: [], promptInjectionFlags: [] },
    summaryText:
      'SampleVault holds ETH deposits and charges a fee on withdrawal. The AI review found one critical issue (anyone can redirect the fees), one high (reentrancy in withdraw), one medium, one low and one informational note. Fix GS-001 and GS-002 before deploying. This is a sample on a fictional contract; the static tools did not run.',
    findings: FINDINGS,
    dropped: [],
    limitations: [
      'Automated scan: business logic, economic and cross-protocol attacks need manual review by people.',
      'AI review only: the static-analysis tools (Slither, Aderyn) and PoC execution did not run; they are listed under Tools as not run.',
      'Dependencies, tests and scripts are out of scope (listed in the scope table).',
    ],
  })
  r.completedAt = COMPLETED
  return r
}
