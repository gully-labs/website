// Gully Security scan engine: every limit, model, price and URL in one place (read at call time, so tests
// and the owner can change them through the environment without a code change).
//
// Nothing secret is ever returned from here except through the two key getters, and those values are only
// put in request headers/URLs, never in a prompt, a log line or a report.

import path from 'node:path'
import { DATA_DIR } from '../http.mjs'

const num = (k, d, { min = 0 } = {}) => {
  const n = Number(process.env[k])
  return Number.isFinite(n) && n >= min && String(process.env[k] ?? '').trim() !== '' ? n : d
}
const str = (k, d = '') => String(process.env[k] ?? '').trim() || d

export const config = {
  /** DATA_DIR/security holds scans.json and one folder per scan. */
  dataDir: () => path.join(process.env.DATA_DIR ?? DATA_DIR, 'security'),

  // Queue and rate limits (per workspace). Part 2 may pass stricter limits per plan into createScan.
  scansPerDay: () => num('SECURITY_SCANS_PER_DAY', 10, { min: 1 }),
  maxQueuedPerWorkspace: () => num('SECURITY_MAX_QUEUED', 3, { min: 1 }),
  maxAttempts: () => num('SECURITY_MAX_ATTEMPTS', 3, { min: 1 }),
  scanTimeoutMs: () => num('SECURITY_SCAN_TIMEOUT_SEC', 1800, { min: 30 }) * 1000,
  keepDays: () => num('SECURITY_KEEP_DAYS', 180, { min: 1 }),

  // Input size caps.
  maxUploadBytes: () => num('SECURITY_MAX_UPLOAD_BYTES', 5 * 1024 * 1024, { min: 1024 }),
  maxTarballBytes: () => num('SECURITY_MAX_TARBALL_BYTES', 25 * 1024 * 1024, { min: 1024 }),
  maxUnpackedBytes: () => num('SECURITY_MAX_UNPACKED_BYTES', 40 * 1024 * 1024, { min: 1024 }),
  maxFiles: () => num('SECURITY_MAX_FILES', 1500, { min: 1 }),
  maxFileBytes: () => num('SECURITY_MAX_FILE_BYTES', 1024 * 1024, { min: 1024 }),
  maxScopeNsloc: () => num('SECURITY_MAX_NSLOC', 15_000, { min: 10 }),
  fetchTimeoutMs: () => num('SECURITY_FETCH_TIMEOUT_SEC', 30, { min: 1 }) * 1000,

  // Explorers / GitHub. Keys are optional; without them the keyless fallbacks are used.
  etherscanKey: () => str('ETHERSCAN_API_KEY') || null,
  etherscanBase: () => str('SECURITY_ETHERSCAN_URL', 'https://api.etherscan.io/v2/api'),
  sourcifyBase: () => str('SECURITY_SOURCIFY_URL', 'https://sourcify.dev/server'),
  /** Optional override for every Blockscout instance (tests); else the per-chain host in chains.mjs. */
  blockscoutOverride: () => str('SECURITY_BLOCKSCOUT_URL') || null,
  githubToken: () => str('GITHUB_TOKEN') || null,
  githubApi: () => str('SECURITY_GITHUB_API', 'https://api.github.com'),
  githubCodeload: () => str('SECURITY_GITHUB_CODELOAD', 'https://codeload.github.com'),

  // Scanner worker (ops/scanner). Unset or unreachable = AI-only path.
  scannerUrl: () => str('SCANNER_URL') || null,
  scannerToken: () => str('SCANNER_TOKEN') || null,
  scannerTimeoutMs: () => num('SCANNER_TIMEOUT_SEC', 900, { min: 5 }) * 1000,
  runPoc: () => str('SECURITY_RUN_POC', '0') === '1',

  // npm audit for checklist scans (runs on the server: lockfile only, no install, no scripts).
  npmAudit: () => str('SECURITY_NPM_AUDIT', 'on') !== 'off',
  npmRegistry: () => str('SECURITY_NPM_REGISTRY', 'https://registry.npmjs.org/'),

  // AI. Same key and base URL as Gully Ask (server/ask.mjs).
  analysisModel: () => str('SECURITY_MODEL', 'claude-sonnet-5-5'),
  summaryModel: () => str('SECURITY_SUMMARY_MODEL', 'claude-haiku-5-5'),
  analysisEffort: () => str('SECURITY_EFFORT', 'high'),
  maxCostUsd: () => num('SECURITY_MAX_COST_USD', 3, { min: 0 }),
  maxTokensPerScan: () => num('SECURITY_MAX_TOKENS', 600_000, { min: 1000 }),
  chunkChars: () => num('SECURITY_CHUNK_CHARS', 60_000, { min: 2000 }),
  maxOutputTokens: () => num('SECURITY_MAX_OUTPUT_TOKENS', 16_000, { min: 256 }),
  aiTimeoutMs: () => num('SECURITY_AI_TIMEOUT_SEC', 300, { min: 5 }) * 1000,
}

/**
 * USD per million tokens. Owner-editable: SECURITY_PRICE_<MODEL_ID_WITH_UNDERSCORES>="in,out" overrides.
 * Defaults are Anthropic's first-party list prices (checked 2026-10-18). Unknown models are priced as the
 * most expensive known one so the cost cap stays conservative.
 */
const PRICES = {
  'claude-sonnet-5-5': { in: 2, out: 10, cacheRead: 0.2 },
  'claude-haiku-5-5': { in: 0.1, out: 0.5, cacheRead: 0.01 },
  'claude-opus-5-5': { in: 4, out: 20, cacheRead: 0.2 },
}
export function priceOf(model) {
  const env = str(`SECURITY_PRICE_${String(model).replace(/[^A-Za-z0-9]/g, '_').toUpperCase()}`)
  if (env) {
    const [i, o] = env.split(',').map(Number)
    if (Number.isFinite(i) && Number.isFinite(o)) return { in: i, out: o, cacheRead: i / 10 }
  }
  return PRICES[model] ?? { in: 10, out: 50, cacheRead: 1 }
}
export function costOf(model, usage) {
  const p = priceOf(model)
  return ((usage.input ?? 0) * p.in + (usage.output ?? 0) * p.out + (usage.cacheRead ?? 0) * p.cacheRead + (usage.cacheWrite ?? 0) * p.in * 1.25) / 1e6
}
