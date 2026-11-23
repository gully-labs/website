# Gully AI modules other lanes can import (stable as of 2026-11-23)

All are plain ES modules under `server/`, no side effects on import beyond `ask.mjs` (which loads the index and starts no timers until `startAsk()`).

| Module | Export | Use |
|---|---|---|
| `ask-index.mjs` | `makeIndex(chunks)`, `chunkSection`, `markdownSections`, `rrf`, `rerank` | BM25 over `{ id, source, title, url, section, text, updatedAt }` chunks. Build your own index for another corpus (Swoop Copilot: its docs chunks) |
| `ask-public-guard.mjs` | `guardChunks(chunks)`, `findLeak(text)` | refuse internal data before indexing anything |
| `ask-docs-sites.mjs` | `DOC_SITES`, `docSource(site, getText)`, `htmlToSections` | fetch a public docs site (allow-listed host, same host only) into chunks |
| `ask-knowledge.mjs` | `knowledgeView`, `PRODUCTS`, `VersionStore`, `diffSnapshots` | coverage matrix and index versions for any chunk set |
| `ask-ops.mjs` | `Gate` (concurrency + short queue), `CapAlerter`, `opsView`, `costOf`, `pricesFromEnv` | limiter, 80 %/100 % alerts, p50/p95 and cost tiles; prices only from the owner's env |
| `ask-eval.mjs` | `runEval({ cases, retrieveFn, answerFn })`, `inventedNumbers`, `EvalHistory` | fixed question set; `retrieveFn` free, `answerFn` optional |
| `ask.mjs` | `retrieve(question, { k, perUrl })` | hybrid retrieval over the live index |
| `ask.mjs` | `generate({ model, system, extraSystem, userText, history, results, maxTokens, effort, onStage, ctx })` | the tool loop: model call, tool_use rounds (max 3), search_docs, returns `{ text, results, usedTools, runs, usage, stop }`. Own tools: pass `tools` (definitions), `runToolFn(name, input, ctx)` and, if you offer a `search_docs` tool, `searchFn(input, results)`; defaults are this module's `TOOLS`, `runTool`, `searchDocs`. `tools: []` sends no tools. Provider failures throw `AskError`; `degradedText(results, why)` builds the docs-only fallback |
| `ask.mjs` | `callClaude(body)` | one provider call with the gate, 3 tries with backoff and `ASK_FALLBACK_MODEL`; throws `AskError` (`status`, `code`: `busy`, `provider-unavailable`) |
| `ask.mjs` | `degradedText(results, why)` | the docs-passages fallback answer for any retrieval results |
| `ask.mjs` | `takeAllowance(key, { perMin, perDay })`, `dailyCap()`, `usedToday()` | per-key limits and the shared daily cap |
