# Gully AI runbook

Where: `server/ask.mjs` (answers, limits, log), `ask-knowledge.mjs` (coverage, versions), `ask-ops.mjs` (cap, cost, gate),
`ask-eval.mjs` (eval set), `ask-docs-sites.mjs` + `ask-remote.mjs` (public docs sources), `ask-public-guard.mjs`.
Admin: Admin > Gully AI (Knowledge console, Capacity, Eval, queues). Public: docs.gullylabs.xyz/gully-ai#knows.

## Symptoms

| You see | Meaning | Do |
|---|---|---|
| Answers start "Gully AI's writing service is not answering" | provider failed after 3 tries (and the fallback model) | Admin > Capacity: provider state + last error class. Billing or key: fix at the provider; the status row says "unavailable since ..." |
| Answers say "answered as many questions as it can today" | the daily cap is used up | Raise `ASK_DAILY_CAP` and restart the container, or wait for midnight Los Angeles time |
| Telegram message "Gully AI has used N of its M daily answers (80 %)" | cap warning | Decide before it reaches 100 % |
| Knowledge console: a product is Thin or Missing | too few indexed passages | Admin > Gully AI > Docs backlog (export), write the docs; check the product's docs source in "Remote sources" |
| A remote source shows `failed (HTTP ...)` | its public docs site did not answer; the last good copy stays in use | check the site; nothing to do if it is a blip |
| A source shows `refused N` | the public-text guard dropped N passages that looked internal | open the page, remove the internal text there |
| Eval run has failures | a question no longer finds its page, or an answer invented a number | open the failed case; fix the docs, or the retrieval synonym list in `ask-index.mjs` |

## Settings (container env, restart to apply)

`ASK_DAILY_CAP`, `ASK_MODEL`, `ASK_FALLBACK_MODEL`, `ASK_MAX_CONCURRENT`, `ASK_QUEUE_MAX`, `ASK_PRICE_INPUT_PER_MTOK`,
`ASK_PRICE_OUTPUT_PER_MTOK`, `ASK_PRICE_CACHE_READ_PER_MTOK`, `ASK_PRICE_CACHE_WRITE_PER_MTOK`, `ASK_IP_PER_MIN/DAY`.
Prices are the owner's, never hard-coded: without them the cost tile reads "not set".

## Data and deletion

Log `ask-log.jsonl` and ratings `ask-feedback.jsonl` in DATA_DIR, pruned at 90 days. A deletion request arrives through the
contact form: find the question text and time, delete those lines from both files (a salted hash is the only identifier).

## Rollback

The deploy keeps the previous image (`gully-web:rollback-*`, see deploy-gully-web-v2.sh). New data files
(`ask-versions.json`, `ask-eval.jsonl`) are additive and can stay.
