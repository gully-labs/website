# Gully Security scan engine (part 1 of 3)

The engine behind the **AI Security Scan**. Part 2 (app and public UI) and part 3 (monitoring and the Gully
Score) call it through `index.mjs` and read reports shaped by `schema.mjs` / `schema.d.mts`.

**Honesty rule.** It is an *AI Security Scan*, never an "audit". Every report states what was checked
(target and scope), by which tools (run / not run, with versions), at which commit or address, and carries
the point-in-time disclaimer verbatim. Every finding has `verifiedByHuman: false`. A PoC is
`draft-not-executed` unless the worker ran it. `validateReport()` enforces all of this.

## Module API (`server/security/index.mjs`)

| Call | Returns |
|---|---|
| `createScan({ workspace, input, limits? })` | `ScanRecord` (queued). Throws `ScanInputError { code, status }` (400 input, 413 upload too large, 429 limits, 503 engine unavailable). An active scan of the same target in the same workspace is returned instead of a duplicate (`duplicate: true`). |
| `getScan(id, { workspace? })` | `ScanRecord` or `null` (pass `workspace` to enforce ownership) |
| `listScans(workspace, { limit?, status? })` | `ScanRecord[]`, newest first |
| `cancelScan(id, { workspace? })` | `{ ok, scan }`: a queued scan is cancelled at once, a running one at its next checkpoint |
| `getReport(id, { workspace? })` | report JSON (`ScanReport`) or `null` |
| `getReportHtml(id, { workspace? })` | static HTML (print-ready) or `null` |
| `scanEvents` | `EventEmitter`: `update` on every change, plus `queued` / `progress` / `done` / `failed` / `cancelled`. Payload `{ id, workspace, status, progress, message }`; `done` adds `{ counts, mode }`. |
| `engineStatus()` | `{ ai, worker: { reachable, tools, reason }, explorers: { etherscanKey }, queue }` |
| `startSecurity()` | loads the queue, requeues interrupted scans, prunes old ones, starts the runner. Call once at server start. |
| `renderReportHtml(report, { logoUrl, standalone, inlineCss })`, `REPORT_CSS` | the HTML render and its stylesheet |

`limits` (from the plan, part 2): `{ scansPerDay, maxQueued, maxCostUsd, maxNsloc }`.

### Inputs

```js
{ kind: 'address', chain: 'base' | 8453, address: '0x…' }
{ kind: 'github',  repo: 'https://github.com/owner/name', commit: '<7-40 hex>' }   // or ref: 'main' (resolved to a full SHA)
{ kind: 'upload',  filename: 'contracts.zip' | 'Token.sol', data: Buffer | base64 }
{ kind: 'web2',    repo, commit }  |  { kind: 'web2', filename: 'api.zip', data }   // checklist mode for JS/TS backends
```

Chains: ethereum, base, arbitrum, optimism, bnb, polygon, avalanche, sepolia, base-sepolia (`chains.mjs`).

### Scan states

`queued → fetching → analysing → triaging → reporting → done` (or `failed` with `error.code`, or `cancelled`).
Error codes include `nothing-to-scan`, `scope-too-large`, `repo-not-found`, `repo-private`, `commit-not-found`,
`too-large`, `explorers-unavailable`, `engine-unavailable`, `timeout`, `too-many-attempts`.

## Report schema (v1.0.0)

Types: `schema.d.mts` (`ScanReport`, `Finding`, `ScanRecord`, …). JSON Schema: `REPORT_JSON_SCHEMA` in
`schema.mjs`. Keep it stable: additive changes bump the minor version; renames/removals bump the major and
need parts 2 and 3 updated.

- `mode` and its fixed `label`:
  - `static+ai`: "AI Security Scan: static analysis + AI triage"
  - `ai-only`: "AI review only — static tools unavailable" (worker absent; static tools listed as not run)
  - `static-only`: "Static tools only — AI triage unavailable"
  - `bytecode-only`: "Source not verified — bytecode notes only"
  - `checklist`: "Checklist scan — web2 code review, not a penetration test"
- `target`: address + chain + explorer URL + verification provider + compiler + proxy (EIP-1967) + bytecode
  sha256; or repo URL + **full 40-hex commit**; or upload name + sha256.
- `scope`: every file with sha256, lines, nSLOC, in/out of scope and why; `totalNsloc`.
- `tools`: slither, aderyn, forge-build, semgrep, npm-audit, forge-poc, ai-review, bytecode-notes; each with
  `status` (`ran`/`failed`/`not-run`/`skipped`), version and reason.
- `ai`: models, chunks reviewed, tokens, `costUsd` vs `costCapUsd`, `capped`, `notReviewed`,
  `promptInjectionFlags`.
- `findings[]`: `GS-001…`, sorted by severity, then confidence, then file:line. `severity` is always
  `severityFrom(likelihood, impact)` (Critical/High/Medium/Low/Info). `triage`: `ai-triaged` (tool finding
  the AI confirmed), `ai-found`, `tool-untriaged` (kept, low confidence), `engine-note`. Plain-English
  `explanation`, technical `description`, `recommendation`, `locations` (file:line), `poc`.
- `dropped[]`: tool findings the AI dismissed as false positives, each with the stated reason.
- `checklist` / `dependencies`: checklist scans only.
- `limitations[]`, `disclaimer` (constant `DISCLAIMER`).

Likelihood × impact:

| impact \ likelihood | high | medium | low |
|---|---|---|---|
| high | Critical | High | Medium |
| medium | High | Medium | Low |
| low | Medium | Low | Low |
| none | Info | Info | Info |

## Pipeline

Queue (persisted in `DATA_DIR/security/scans.json`, concurrency 1, per-workspace limits) → **fetch**
(Etherscan V2 multichain with `ETHERSCAN_API_KEY`, else Blockscout, else Sourcify; bytecode and the EIP-1967
slot over Gully Pay's RPCs; GitHub tarball of the exact commit, size-capped; zip uploads unpacked in memory
with sanitised paths, links dropped, bomb-capped) → **static tools** on the `gully-scanner` worker →
**AI triage** (Claude Sonnet in chunks, JSON-schema output; Haiku for the summary) → **report** (JSON +
HTML). Each stage checkpoints into `DATA_DIR/security/scans/<id>/`; after a restart a scan resumes from its
last finished stage.

- **Unverified contract**: bytecode-only report (selectors, DELEGATECALL/SELFDESTRUCT/tx.origin, minimal
  proxy, EIP-1967, solc from metadata). No AI spend.
- **Worker absent**: AI-only path, labelled as such, static tools listed as "not run".
- **Cost cap**: each call is estimated first and refused past `SECURITY_MAX_COST_USD` / `SECURITY_MAX_TOKENS`;
  unreviewed chunks are listed; actual cost is recorded on the report and the scan record.
- **Prompt injection**: the system prompt says the data may contain instructions and that they are never
  followed; data sits in tags with a per-call random nonce; comments that look addressed to an AI are
  removed (line numbers kept) and reported as findings. Secrets in code are redacted before any prompt and
  reported; `.env` files are never read. No API key is ever in a prompt, log or report.
- **Web2 checklist**: `npm audit --json --package-lock-only --ignore-scripts` on a copy of package.json +
  package-lock.json only (throwaway HOME, no project .npmrc, no install); Semgrep OWASP rules if the
  worker has them; Claude reviews auth/session/secret handling against 13 checklist items.

## Configuration (all optional unless noted)

| Variable | Default | Meaning |
|---|---|---|
| `ANTHROPIC_API_KEY` | — | Same key as Gully Ask. Without it: no AI (static-only or refused). |
| `ETHERSCAN_API_KEY` | — | Etherscan V2 multichain key (one key, all chains). Without it: Blockscout/Sourcify only. |
| `GITHUB_TOKEN` | — | Raises GitHub's API rate limit (public repos only; read-only scope is enough). |
| `SCANNER_URL`, `SCANNER_TOKEN` | — | The worker (`http://gully-scanner:8090`) and its shared token (24+ chars). |
| `SECURITY_MODEL` / `SECURITY_SUMMARY_MODEL` | claude-sonnet-5-5 / claude-haiku-5-5 | Models. |
| `SECURITY_EFFORT` | high | Effort for the analysis calls. |
| `SECURITY_MAX_COST_USD` | 3 | Per-scan AI cost cap. |
| `SECURITY_MAX_TOKENS` | 600000 | Per-scan token cap. |
| `SECURITY_CHUNK_CHARS` / `SECURITY_MAX_OUTPUT_TOKENS` | 60000 / 16000 | Chunk size, output per call. |
| `SECURITY_PRICE_<MODEL>` | list prices | "in,out" USD per MTok, e.g. `SECURITY_PRICE_CLAUDE_SONNET_5_5=2,10`. |
| `SECURITY_SCANS_PER_DAY` / `SECURITY_MAX_QUEUED` | 10 / 3 | Per-workspace limits (plans may pass stricter ones). |
| `SECURITY_MAX_NSLOC` | 15000 | In-scope size cap. |
| `SECURITY_MAX_UPLOAD_BYTES` / `SECURITY_MAX_TARBALL_BYTES` / `SECURITY_MAX_UNPACKED_BYTES` | 5 MB / 25 MB / 40 MB | Size caps. |
| `SECURITY_SCAN_TIMEOUT_SEC` | 1800 | Whole-scan timeout. |
| `SECURITY_RUN_POC` | 0 | 1 = run up to 3 Critical/High draft PoCs on the worker (forge test, offline). |
| `SECURITY_NPM_AUDIT` | on | off = skip the dependency check. |
| `SECURITY_KEEP_DAYS` | 180 | Finished scans older than this are deleted at start. |

## The worker (`ops/scanner/`)

`gully-scanner` runs Slither, Aderyn, Foundry (`forge build --offline`, generated foundry.toml with
`ffi = false`, tests and scripts skipped) and optional Semgrep. It writes only `.sol` (and `.js/.ts` for web2)
plus `remappings.txt`; package.json, hardhat/truffle configs, the project's foundry.toml, scripts and hooks
are never written, so no project build script can run. Children get no shell, a minimal environment, a
timeout and capped output. The container: read-only root, tmpfs `/work`, non-root uid 10001, all
capabilities dropped, `no-new-privileges`, 1.5 CPU, 2 GB RAM, 256 pids, and an **internal** network with no
route out (solc versions, forge-std and Semgrep rules are baked in at build time).

**Not started on the server** (disk was at 97 % on 2026-10-18). When there is room:

```sh
cd ~/gully-web
export SCANNER_TOKEN=$(openssl rand -hex 24)        # same value goes into ~/gully-web/.env
./ops/scanner/preflight.sh                          # refuses under 15 GB free or 3 GB RAM
docker compose -p gully-scanner -f ops/scanner/compose.scanner.yaml up -d --build
docker network connect gully-scanner-net gully-web  # and in ops/deploy.sh run_next() for later deploys
# ~/gully-web/.env: SCANNER_URL=http://gully-scanner:8090  SCANNER_TOKEN=<same>
```

Needs: image about 1.5 GB (2 GB with `SCANNER_WITH_SEMGREP=1`), about 3 GB of build layers while building
(prune the scanner's own build cache afterwards), 1 GB tmpfs for jobs, RAM capped at 2 GB.

## Wiring left to part 2

- `Dockerfile` copies `server/*.mjs` flat; add `COPY server/security ./security` so the engine ships.
- Call `startSecurity()` at server start; route HTTP and auth (workspace ownership) to the API above.
- Uploads: pass the raw zip/sol bytes as `data`.

## Tests

`npm run test:security` (`scripts/test-security-engine.mjs`): stubbed explorers, GitHub, RPC, worker,
Claude and npm audit; the worker stub answers with real Slither 0.11.6 + forge 1.8.1 output recorded
against `scripts/fixtures/security/vuln/src/VulnBank.sol` (reentrancy, unchecked low-level call, tx.origin)
in `scripts/fixtures/security/worker-analyze-vulnbank.json`.
