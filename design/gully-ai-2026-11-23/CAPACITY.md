# Gully AI: capacity for 1,000 active users (estimate, 2026-11-23)

Nothing here was measured against the live provider. The service-side numbers come from the code and a local fake-provider
ramp (`node scripts/load-ask-fake.mjs`); the model's latency and token counts are ASSUMPTIONS until the admin "Capacity"
tiles have a week of real answers (they show p50/p95 latency and tokens from the log).

## What limits it, in order

| Limit | Default | Where | What happens past it |
|---|---|---|---|
| Per visitor | 6 a minute, 60 a day (per IP) | `ASK_IP_PER_MIN`, `ASK_IP_PER_DAY` | 429 with Retry-After |
| Per Telegram chat | 5 a minute, 60 a day | `ASK_CHAT_PER_MIN`, `ASK_CHAT_PER_DAY` | 429 |
| **Whole service** | **2,000 model answers a day** | `ASK_DAILY_CAP` (old name `ASK_DAILY_LIMIT`) | docs passages only ("degraded: cap"), alert at 80 % and 100 % |
| Provider calls in flight | 6, queue of 24, 20 s wait | `ASK_MAX_CONCURRENT`, `ASK_QUEUE_MAX` | docs passages only ("degraded: busy") |
| Retries | 3 tries, 0.8 s doubling with jitter, Retry-After up to 5 s | `ASK_RETRY_BASE_MS` | then the optional `ASK_FALLBACK_MODEL` once, then docs passages |

## 1,000 active users

"Active" = opens Gully AI on a day. Questions per active user per day is the number that decides everything:

| Questions per active user per day | Answers a day | vs the 2,000 cap |
|---|---|---|
| 1 | 1,000 | 50 % |
| 2 | 2,000 | 100 %: cap hit at the end of the day |
| 3 | 3,000 | hit at about two thirds of the day; the last third is docs-only |
| 5 | 5,000 | hit at 40 % of the day |

So **the default cap is hit by about 1,000 users who ask two questions each.** The cap is a spending decision, not a technical
limit: the service itself is nowhere near its ceiling (below). Owner step: pick the daily number (set `ASK_DAILY_CAP`).

A cap that holds 1,000 users at 3 questions is 3,000; at 5,000 users it is 15,000. Spend is linear in answers:

    daily cost = answers x ( input tokens x price_in + output tokens x price_out + cache reads x price_cache )

with the owner's prices in `ASK_PRICE_*_PER_MTOK`. The admin tile shows the real token average per answer and the running
estimate; with no prices set it says "not set". Order of magnitude to expect: an answer sends about 6 source passages
(~1,000-1,500 input tokens, most of the system prompt served from the provider's cache) and returns 60-200 tokens.

## Concurrency (the part that is not a problem)

- 1,000 users, 3 questions each = 3,000 a day. Busiest hour ~15 % of the day = 450 an hour = 0.125 a second.
- At a model latency of 3 s (assumption) that is 0.4 answers in flight on average. A 10x burst is 4: inside the gate of 6.
- Throughput ceiling of the gate: 6 / 3 s = 2 answers a second = 172,000 a day. The cap, not the gate, is the limit.
- One Node process holds the whole index in memory (about 460 passages today, ~0.5 MB JSON; the product docs add a few
  hundred). Retrieval is BM25 plus a cosine pass over the vectors: milliseconds.

## Local ramp against a fake provider (400 ms +/- 40 %, gate 6, queue 24)

    concurrency   2  ok  60  degraded   0  p50  543 ms  p95  741 ms  provider in flight peak 2
    concurrency   6  ok  60  degraded   0  p50  485 ms  p95  654 ms  provider in flight peak 6
    concurrency  12  ok  60  degraded   0  p50 1260 ms  p95 1796 ms  queued peak 6
    concurrency  24  ok  60  degraded   0  p50 2055 ms  p95 2874 ms  queued peak 18
    concurrency  48  ok  30  degraded  30  p50  914 ms  p95 3996 ms  queue full: half the askers get docs passages
    concurrency  96  ok  30  degraded  30  p50  783 ms  p95 3590 ms

Reading it: up to 24 simultaneous askers every one gets a written answer, waiting in the queue; at 48 simultaneous askers
(a burst far above 1,000 users' real peak of a few at a time) the overflow gets the docs-passages fallback in under 1 s
instead of an error. With 20 % provider failures every failed call is retried and, past the retries, degrades the same way
(`FAKE_FAIL=0.2`). The fake latency is 400 ms; at the real 3 s the same ramp scales by 7.5x in latency, not in shape.

## What would change the answer

- A provider rate limit lower than 6 concurrent calls: lower `ASK_MAX_CONCURRENT` to match, or ask the provider for more.
- Voyage embeddings: one call per question (a short text). Rebuilding the index re-embeds only new passages.
- More than one container: the per-visitor counters and the daily cap are in memory per process. Two containers would each
  allow the full cap. Today there is one; a shared counter is needed before scaling out.
- The 90-day log is a JSON-lines file read whole by the admin views: fine to about 200,000 lines (~100 days at 2,000 a day).

## Not verified

Real model latency, real token averages, real provider rate limits, cost in dollars (no prices configured), behaviour under
the real provider's 429s (tested only with a stub), and the status/Telegram alert delivery on the live box.
