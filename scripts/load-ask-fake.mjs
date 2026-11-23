// A local load test of the Gully AI answer path against a FAKE provider (never the live one), with ramped concurrency.
// It measures the service's own behaviour (the concurrency gate, the queue, retries, the degraded fallback), not the
// model's: the fake provider answers after FAKE_MS (default 400 ms, scaled down from the real 2-4 s so a run is short).
//
//   node scripts/load-ask-fake.mjs                 ramp 2,6,12,24,48,96 concurrent askers, 60 questions each step
//   FAKE_MS=3000 STEPS=6,12 N=40 node scripts/load-ask-fake.mjs
//   FAKE_FAIL=0.1                                  10 % of provider calls answer 500 (retries and degraded mode show up)
//
// Prints one line per step: ok / degraded / refused, p50 and p95 latency, peak in flight and queued.

import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'

const FAKE_MS = Number(process.env.FAKE_MS) || 400
const FAIL = Number(process.env.FAKE_FAIL) || 0
const STEPS = (process.env.STEPS ?? '2,6,12,24,48,96').split(',').map(Number)
const N = Number(process.env.N) || 60

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gully-ask-load-'))
let inflight = 0
let peak = 0
const stub = http.createServer((req, res) => {
  req.resume()
  req.on('end', () => {
    inflight++
    peak = Math.max(peak, inflight)
    const ms = FAKE_MS * (0.6 + Math.random() * 0.8)
    setTimeout(() => {
      inflight--
      const fail = Math.random() < FAIL
      res.writeHead(fail ? 500 : 200, { 'content-type': 'application/json' })
      res.end(JSON.stringify(fail ? { type: 'error', error: { type: 'api_error', message: 'fake' } } : { id: 'm', type: 'message', role: 'assistant', model: 'fake', content: [{ type: 'text', text: 'The tracker compares tokenised stocks with their fair price [1].' }], stop_reason: 'end_turn', usage: { input_tokens: 900, output_tokens: 60, cache_read_input_tokens: 700 } }))
    }, ms)
  })
})
await new Promise((r) => stub.listen(0, '127.0.0.1', r))
Object.assign(process.env, { DATA_DIR: tmp, ASK_REMOTE: 'off', ANTHROPIC_API_KEY: 'sk-ant-load-test-0000000000000000', ANTHROPIC_API_URL: `http://127.0.0.1:${stub.address().port}`, ASK_DAILY_CAP: '10000000', ASK_RETRY_BASE_MS: '50', TRACKER_LOOP: 'off' })
const ask = await import('../server/ask.mjs')
const QUESTIONS = ['How do Telegram alerts work?', 'What does the tracker show?', 'Is there an API?', 'What does Gully Pay cost?', 'What is the Holder Map?', 'How long are questions kept?']

async function step(conc) {
  const lat = []
  const out = { ok: 0, degraded: 0, refused: 0 }
  let next = 0
  let queuedPeak = 0
  const t0 = Date.now()
  const poll = setInterval(() => (queuedPeak = Math.max(queuedPeak, ask.providerQueue().queued)), 20)
  await Promise.all(
    [...Array(conc)].map(async () => {
      while (next < N) {
        const i = next++
        const t = Date.now()
        const r = await ask.ask({ question: QUESTIONS[i % QUESTIONS.length], who: { channel: 'web', key: `load-${conc}-${i}`, perMin: 1000, perDay: 1000 } })
        lat.push(Date.now() - t)
        if (!r.ok) out.refused++
        else if (r.degraded) out.degraded++
        else out.ok++
      }
    }),
  )
  clearInterval(poll)
  lat.sort((a, b) => a - b)
  const q = (p) => lat[Math.min(lat.length - 1, Math.ceil(p * lat.length) - 1)]
  const secs = (Date.now() - t0) / 1000
  console.log(`concurrency ${String(conc).padStart(3)}  ok ${String(out.ok).padStart(3)}  degraded ${String(out.degraded).padStart(3)}  refused ${out.refused}  p50 ${q(0.5)} ms  p95 ${q(0.95)} ms  throughput ${(N / secs).toFixed(1)}/s  queued peak ${queuedPeak}  provider in flight peak ${peak}`)
  peak = 0
}

console.log(`fake provider ${FAKE_MS} ms (+/-40 %), ${FAIL * 100} % failures, gate ${JSON.stringify(ask.providerQueue())}, ${N} questions per step`)
for (const c of STEPS) await step(c)
stub.close()
fs.rmSync(tmp, { recursive: true, force: true })
process.exit(0)
