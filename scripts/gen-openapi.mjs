#!/usr/bin/env node
// Generates the public OpenAPI 3.1 document of the Gully AI API from the code:
//   openapi/gully-ai.json
// What is read from code (by parsing source text; nothing is imported, so no dependency is needed):
//   the route list (every '/api/ask...' and '/api/ai...' path literal under server/ and api/), each route's
//   method, the public host, request limits (question length, body size, history window, per-visitor and
//   service-wide allowances, rating window), the headers sent, which paths allow cross-origin reads, the error
//   answers (HTTP status + code), stream stages, card kinds, the answer id pattern and whether Explain this
//   transaction is switched on by default.
// What is written by hand: the wording below (summaries, descriptions, schemas' prose, examples).
// A public-prefix route in the code that is neither documented nor on EXCLUDED makes the generator throw.
// Usage: node scripts/gen-openapi.mjs          write the file
//        node scripts/gen-openapi.mjs --check  exit 1 when the committed file is stale
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { stableJson } from './openapi-safety.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => readFileSync(join(ROOT, p), 'utf8').replace(/\r\n/g, '\n')
const int = (s) => Number(String(s).replace(/_/g, ''))

// ---------------------------------------------------------------- code readers (exported for the drift test)

const ASK = 'server/ask.mjs'
const EXPLAIN = 'server/ai/explain-tx.mjs'
const SERVER = 'server/server.mjs'

/** Every source file that can register a route: server/**.mjs and api/** (data and vendored folders left out). */
export function routeSourceFiles(dirs = ['server', 'api']) {
  const out = []
  const walk = (rel) => {
    const abs = join(ROOT, rel)
    if (!existsSync(abs)) return
    for (const name of readdirSync(abs).sort()) {
      if (name === 'node_modules' || name === 'data') continue
      const r = `${rel}/${name}`
      if (statSync(join(ROOT, r)).isDirectory()) walk(r)
      else if (/\.(mjs|js|ts)$/.test(name) && !/\.d\.(mts|ts)$/.test(name)) out.push(r)
    }
  }
  dirs.forEach(walk)
  return out
}

/** Path literals under the public prefixes (/api/ask, /api/ai) in the given source texts, sorted. */
export function publicPrefixRoutes(sources = routeSourceFiles().map(read)) {
  const found = new Set()
  for (const src of sources) for (const m of src.matchAll(/['"`](\/api\/(?:ask|ai)(?:\/[A-Za-z0-9_\-/:.{}$]*)?)(?=['"`?])/g)) found.add(m[1])
  return [...found].sort()
}

/** The method a handler accepts for a path, from the method check that follows the path comparison. */
export function routeMethod(path, src) {
  const at = src.search(new RegExp(`[!=]== '${path.replace(/[/.]/g, '\\$&')}'\\)`))
  if (at < 0) throw new Error(`no handler found for ${path}`)
  const next = src.slice(at, at + 700)
  const m = /req\.method !== '(GET|POST)'/.exec(next)
  if (!m) throw new Error(`no method check found for ${path}`)
  return m[1].toLowerCase()
}

/** The slice of ask.mjs that serves the public: everything before the admin section. */
const askPublicSrc = (src = read(ASK)) => {
  const cut = src.indexOf('/* ----------------------------------------------------------------- admin --- */')
  if (cut < 0) throw new Error('the admin section marker moved in server/ask.mjs')
  return src.slice(0, cut)
}

const must = (re, src, what) => {
  const m = re.exec(src)
  if (!m) throw new Error(`could not read ${what} from the code (scripts/gen-openapi.mjs)`)
  return m
}

/** Limits and windows, read from the constants and defaults in the code. */
export function askLimits(askSrc = read(ASK), explainSrc = read(EXPLAIN)) {
  const pub = askPublicSrc(askSrc)
  const feedback = pub.slice(pub.indexOf("p === '/api/ask/feedback'"))
  const degraded = must(/perMin: (\d+), perDay: (\d+), noCap: true/, pub, 'the docs-passages allowance')
  return {
    maxQuestion: int(must(/export const MAX_QUESTION = ([\d_]+)/, pub, 'MAX_QUESTION')[1]),
    maxBodyBytes: int(must(/export const MAX_BODY = ([\d_]+)/, pub, 'MAX_BODY')[1]),
    maxHistoryTurns: int(must(/const MAX_HISTORY = ([\d_]+)/, pub, 'MAX_HISTORY')[1]),
    maxHistoryChars: int(must(/const MAX_HISTORY_CHARS = ([\d_]+)/, pub, 'MAX_HISTORY_CHARS')[1]),
    perVisitorPerMinute: int(must(/envInt\('ASK_IP_PER_MIN', ([\d_]+)\)/, pub, 'the per-minute allowance')[1]),
    perVisitorPerDay: int(must(/envInt\('ASK_IP_PER_DAY', ([\d_]+)\)/, pub, 'the per-day allowance')[1]),
    perDayService: int(must(/envInt\('ASK_DAILY_CAP', envInt\('ASK_DAILY_LIMIT', ([\d_]+)\)\)/, pub, 'the daily cap')[1]),
    passagesPerMinute: int(degraded[1]),
    passagesPerDay: int(degraded[2]),
    ratingsPerMinute: int(must(/hits\.length >= (\d+)/, pub, 'the ratings allowance')[1]),
    ratingWindowHours: int(must(/const ANSWER_TTL_MS = (\d+) \* 3_600_000/, pub, 'the rating window')[1]),
    ratingBodyBytes: int(must(/readBody\(req, ([\d_]+)\)/, feedback, 'the rating body size')[1]),
    logDays: int(must(/const LOG_KEEP_DAYS = ([\d_]+)/, pub, 'LOG_KEEP_DAYS')[1]),
    statusCacheSeconds: int(must(/askStatus\(\), \{ 'Cache-Control': 'public, max-age=(\d+)' \}/, pub, 'the status cache time')[1]),
    knowledgeCacheSeconds: int(must(/knowledgePublic\(\), \{ 'Cache-Control': 'public, max-age=(\d+)' \}/, pub, 'the knowledge cache time')[1]),
    explainPerMinute: int(must(/EXPLAIN_IP_PER_MIN\) \|\| (\d+)/, explainSrc, 'the explain per-minute allowance')[1]),
    explainPerDay: int(must(/EXPLAIN_IP_PER_DAY\) \|\| (\d+)/, explainSrc, 'the explain per-day allowance')[1]),
    explainBodyBytes: int(must(/readJson\(req, ([\d_]+)\)/, explainSrc, 'the explain body size')[1]),
    explainChainId: int(must(/export const CHAIN_ID = (\d+)/, explainSrc, 'the explain chain id')[1]),
    explainLabel: must(/export const TESTNET_LABEL = '([^']+)'/, explainSrc, 'the testnet label')[1],
  }
}

/** The public host, from the site constant the answers link to. */
export function publicHost(askSrc = read(ASK)) {
  return new URL(must(/const SITE = '(https:\/\/[^']+)'/, askSrc, 'the public host')[1]).host
}

/** Paths whose answers carry Access-Control-Allow-Origin: * (the line in server.mjs that sets it for the ask routes). */
export function corsOpenPaths(serverSrc = read(SERVER)) {
  const out = new Set()
  for (const line of serverSrc.split('\n')) {
    if (!/setHeader\('Access-Control-Allow-Origin', '\*'\)/.test(line)) continue
    for (const m of line.matchAll(/url\.pathname === '(\/api\/(?:ask|ai)[^']*)'/g)) out.add(m[1])
  }
  return [...out].sort()
}

/** Response header names the public handlers send, beyond Content-Type. */
export function sentHeaders(askSrc = read(ASK), explainSrc = read(EXPLAIN)) {
  const pub = askPublicSrc(askSrc)
  const handler = pub.slice(pub.indexOf('export async function handleAsk')) + explainSrc.slice(explainSrc.indexOf('export async function handleExplainTx'))
  const names = new Set()
  for (const m of handler.matchAll(/(?:\{ |, |\.\.\.\([^?]+\? \{ )'?([A-Z][A-Za-z]*(?:-[A-Za-z]+)*)'?: /g)) if (/^(Retry-After|Allow|Cache-Control|X-[A-Za-z-]+|Connection)$/.test(m[1])) names.add(m[1])
  return [...names].sort()
}

/** Rate-limit header names: any X-RateLimit-* the handlers send, and Retry-After when a 429 carries it. */
export function rateLimitHeaders(askSrc = read(ASK), explainSrc = read(EXPLAIN)) {
  const src = askPublicSrc(askSrc) + explainSrc
  const names = new Set([...src.matchAll(/'(X-RateLimit-[A-Za-z-]+)'/g)].map((m) => m[1]))
  if (/'Retry-After': String\(/.test(src)) names.add('Retry-After')
  return [...names].sort()
}

/** Error answers as "http" or "http:code" keys, from the status and code literals in the public code paths. */
export function errorAnswers(askSrc = read(ASK), explainSrc = read(EXPLAIN)) {
  const pub = askPublicSrc(askSrc)
  const keys = new Set()
  const add = (http, code) => keys.add(code ? `${http}:${code}` : String(http))
  const handler = pub.slice(pub.indexOf('export async function handleAsk'))
  const explainHandler = explainSrc.slice(explainSrc.indexOf('export async function handleExplainTx'))
  for (const src of [handler, explainHandler]) for (const m of src.matchAll(/json\(res, (\d{3}), \{ error: /g)) add(m[1])
  for (const m of pub.matchAll(/status: (\d{3}), (?:code: '([\w-]+)', )?error: /g)) add(m[1], m[2])
  for (const m of pub.matchAll(/new AskError\(.*$/gm)) {
    const tail = /, (\d{3})(?:, '([\w-]+)')?\)\s*$/.exec(m[0])
    const either = /\? (\d{3}) : (\d{3})\)\s*$/.exec(m[0])
    if (tail) add(tail[1], tail[2])
    else if (either) [either[1], either[2]].forEach((s) => add(s))
    else add(must(/constructor\(message, status = (\d{3})/, pub, 'the default error status')[1])
  }
  const map = must(/const map = \{ (.+) \}\n/, explainSrc, 'the explain error map')[1]
  for (const m of map.matchAll(/(\w+): \[(\d{3}), '/g)) add(m[2], m[1])
  const credits = /status: g\?\.status \?\? (\d{3}),.*code: g\?\.code \?\? '(\w+)'/.exec(explainSrc)
  if (credits) add(credits[1], credits[2])
  return [...keys].sort()
}

/** Stages a streamed answer reports, card kinds, action kinds, docs-passages reasons, live read names, the id pattern. */
export function answerVocabulary(askSrc = read(ASK)) {
  const pub = askPublicSrc(askSrc)
  const stages = [...pub.matchAll(/onStage\(([^\n]+)\)\n/g)].flatMap((m) => [...m[1].matchAll(/'(\w+)'|`(tool:)\$\{/g)].map((x) => x[1] ?? 'tool:<name>'))
  const cardSrc = pub.slice(pub.indexOf('function cardOf('), pub.indexOf('export function cardsFrom'))
  const actionSrc = pub.slice(pub.indexOf('export function actionsFrom'))
  const intro = must(/const DEGRADED_INTRO = \{\n([\s\S]*?)\n\}/, pub, 'the docs-passages reasons')[1]
  const toolsSrc = pub.slice(pub.indexOf('export const TOOLS = ['), pub.indexOf('export const MY_TOOLS'))
  return {
    stages: [...new Set(stages)].sort(),
    cardKinds: [...new Set([...cardSrc.matchAll(/kind: '(\w+)'/g)].map((m) => m[1]))].sort(),
    actionKinds: [...new Set([...actionSrc.matchAll(/kind: '(\w+)'/g)].map((m) => m[1]))].sort(),
    degraded: [...intro.matchAll(/^\s+(\w+): /gm)].map((m) => m[1]).sort(),
    tools: [...new Set([...toolsSrc.matchAll(/^\s{4}name: '(\w+)'/gm)].map((m) => m[1]))].sort(),
    idPattern: must(/!\/(\^a_[^/]+\$)\/\.test\(id\)/, pub, 'the answer id pattern')[1],
  }
}

/** True when Explain this transaction answers without an operator switching it on. */
export function explainOnByDefault(explainSrc = read(EXPLAIN)) {
  const m = must(/export const explainEnabled = \(\) => String\(process\.env\.\w+ \?\? '(\d)'\) === '1'/, explainSrc, 'the explain switch')
  return m[1] === '1'
}

// ---------------------------------------------------------------- hand-written wording

const PH_ADDR = '0x1111111111111111111111111111111111111111'
const PH_ADDR2 = '0x2222222222222222222222222222222222222222'
const PH_TOKEN = '0x3333333333333333333333333333333333333333'
const PH_HASH = '0x' + 'ab'.repeat(32)
const PH_ID = 'a_AAAAAAAAAAAAAAAA'
const PH_TIME = '2026-01-01T00:00:00.000Z'
const DOCS_URL = 'https://docs.gullylabs.xyz/gully-ai'

/** Routes under the public prefixes that stay out of the document, each with the reason. */
export const EXCLUDED = {}

/** Documented routes: where the handler lives (the method is read from it). */
const DOCUMENTED = {
  '/api/ask': ASK,
  '/api/ask/status': ASK,
  '/api/ask/knowledge': ASK,
  '/api/ask/feedback': ASK,
  '/api/ai/explain-tx': EXPLAIN,
}

/** Wording for every error answer the code can give. key = "http" or "http:code" as errorAnswers() reads them. */
const ERR = {
  '202:pending': { code: 'pending', ops: ['explainTransaction'], meaning: 'The transaction is not in a block yet. Ask again shortly.' },
  400: { code: null, ops: ['askQuestion', 'rateAnswer', 'explainTransaction'], meaning: 'The body is not the expected JSON, a field is missing or malformed, the question is empty or too long, or the question looks like a private key or recovery phrase.' },
  '400:bad_input': { code: 'bad_input', ops: ['explainTransaction'], meaning: 'The transaction hash is not 0x followed by 64 hex characters.' },
  '400:wrong_chain': { code: 'wrong_chain', ops: ['explainTransaction'], meaning: 'Only Gully Chain Testnet is supported for now.' },
  '402:credits': { code: 'credits', ops: ['explainTransaction'], meaning: 'Not enough credits. Nothing is charged today; this answer exists for a later paid tier.' },
  403: { code: null, ops: ['askQuestion', 'rateAnswer', 'explainTransaction'], meaning: 'The `X-Requested-With: gully` header is missing.' },
  404: { code: null, ops: ['rateAnswer', 'explainTransaction'], meaning: 'The answer can no longer be rated (unknown id or past the rating window), or the route is not switched on yet.' },
  '404:not_found': { code: 'not_found', ops: ['explainTransaction'], meaning: 'No transaction with that hash was found on Gully Chain Testnet.' },
  405: { code: null, ops: ['askQuestion', 'getAskStatus', 'getAskKnowledge', 'rateAnswer', 'explainTransaction'], meaning: 'Wrong method. Questions, ratings and explanations are POST; status and knowledge are GET.' },
  413: { code: null, ops: ['askQuestion', 'rateAnswer'], meaning: 'The request body is too large.' },
  429: { code: null, ops: ['askQuestion', 'rateAnswer', 'explainTransaction'], meaning: 'Too many requests from one place this minute or today. Wait `Retry-After` seconds when the header is present.' },
  '429:cap': { code: null, ops: ['explainTransaction'], meaning: 'The service has answered as many requests as it can today. Resets at the start of the next day (US Pacific time). On questions this is not an error: the answer becomes docs passages instead.' },
  500: { code: null, ops: ['rateAnswer'], meaning: 'The rating could not be saved. Try again.' },
  502: { code: null, ops: ['askQuestion'], meaning: 'The answer could not be written just now. Try again.' },
  503: { code: null, ops: ['askQuestion'], meaning: 'Gully AI is not available yet (`configured` is false), busy, or its writing service did not answer and no docs passages could be found. Try again shortly.' },
  '503:busy': { code: 'busy', ops: ['askQuestion'], meaning: 'Too many answers are being written at once. Try again in a minute.' },
  '503:provider-unavailable': { code: 'provider-unavailable', ops: ['askQuestion'], meaning: 'The writing service is unavailable. Try again later.' },
  '503:unavailable': { code: 'unavailable', ops: ['explainTransaction'], meaning: 'The chain could not be read just now. Try again shortly.' },
}

const TAGS = [
  { name: 'Ask', description: 'Ask Gully AI a question about Gully Labs and its products, and rate the answer.' },
  { name: 'About', description: 'What Gully AI knows, where a question goes and whether it is answering now.' },
  { name: 'Explain', description: 'A transaction in plain words. Not switched on yet.' },
]

// ---------------------------------------------------------------- the document

export function buildGullyAi({ routes = publicPrefixRoutes(), askSrc = read(ASK), explainSrc = read(EXPLAIN), serverSrc = read(SERVER) } = {}) {
  // Every public-prefix route in the code is documented or excluded with a reason; nothing else is documented.
  for (const r of routes) if (!DOCUMENTED[r] && !EXCLUDED[r]) throw new Error(`route ${r} is in the code but is neither documented nor on EXCLUDED with a reason (scripts/gen-openapi.mjs)`)
  for (const r of Object.keys(DOCUMENTED)) if (!routes.includes(r)) throw new Error(`route ${r} is documented but no longer in the code (scripts/gen-openapi.mjs)`)

  const L = askLimits(askSrc, explainSrc)
  const V = answerVocabulary(askSrc)
  const host = publicHost(askSrc)
  const base = `https://${host}`
  const cors = corsOpenPaths(serverSrc)
  const headers = sentHeaders(askSrc, explainSrc)
  const rateHeaders = rateLimitHeaders(askSrc, explainSrc)
  const explainOn = explainOnByDefault(explainSrc)
  const method = (p) => routeMethod(p, DOCUMENTED[p] === ASK ? askSrc : explainSrc)
  const expect = (p, m) => {
    if (method(p) !== m) throw new Error(`${p} now answers ${method(p).toUpperCase()}, the document says ${m.toUpperCase()} (scripts/gen-openapi.mjs)`)
  }
  expect('/api/ask', 'post')
  expect('/api/ask/status', 'get')
  expect('/api/ask/knowledge', 'get')
  expect('/api/ask/feedback', 'post')
  expect('/api/ai/explain-tx', 'post')
  for (const h of ['Retry-After', 'X-Ask-Degraded', 'Allow', 'Cache-Control']) if (!headers.includes(h)) throw new Error(`the handlers no longer send ${h}; update the document (scripts/gen-openapi.mjs)`)

  const found = errorAnswers(askSrc, explainSrc)
  for (const k of found) if (!ERR[k] || !ERR[k].meaning) throw new Error(`error answer ${k} has no wording in ERR (scripts/gen-openapi.mjs)`)
  const errors = found.map((k) => ({ code: ERR[k].code, http: Number(k.split(':')[0]), meaning: ERR[k].meaning, operations: ERR[k].ops }))
  const errorTable = ['| HTTP | code | Meaning |', '|---|---|---|', ...errors.map((e) => `| ${e.http} | ${e.code ?? 'none'} | ${e.meaning} |`)].join('\n')
  const kb = (n) => `${n / 1024} KB`

  const errRef = { $ref: '#/components/schemas/Error' }
  const errBody = (example) => ({ 'application/json': { schema: errRef, example } })
  const retryAfter = { 'Retry-After': { description: 'Seconds to wait before the next try.', schema: { type: 'integer' } } }
  const requestedWith = { name: 'X-Requested-With', in: 'header', required: true, description: 'Must be exactly `gully`. A request without it is refused with 403.', schema: { type: 'string', const: 'gully' }, example: 'gully' }
  const refused = { description: 'The `X-Requested-With: gully` header is missing.', content: errBody({ error: 'Cross-site request refused.' }) }
  const wrongMethod = (m) => ({ description: `Only ${m} is accepted.`, ...(m === 'POST' ? { headers: { Allow: { description: 'The accepted method.', schema: { type: 'string' } } } } : {}), content: errBody({ error: `${m} only` }) })
  const curlPost = (path, body) => `curl -X POST ${base}${path} -H "Content-Type: application/json" -H "X-Requested-With: gully" -d '${JSON.stringify(body)}'`

  const answerExample = {
    id: PH_ID,
    answer: 'Gully AI answers questions about Gully Labs products from the public docs [1].',
    citations: [{ n: 1, title: 'Gully AI', url: DOCS_URL, source: 'docs' }],
    live: [],
    cards: [],
    actions: [],
    usedTools: [],
    model: 'example-model',
    retrieval: 'bm25',
    signedIn: false,
  }
  const passagesExample = {
    id: PH_ID,
    answer: 'Gully AI has answered as many questions as it can today, so this is not a written answer. These are the closest passages from our docs (no generated text):\n\n[1] Gully AI · Limits: Each visitor can ask a few questions a minute.',
    citations: [{ n: 1, title: 'Gully AI', url: DOCS_URL, source: 'docs' }],
    live: [],
    cards: [],
    actions: [],
    usedTools: [],
    model: null,
    retrieval: 'bm25',
    degraded: 'cap',
    signedIn: false,
  }
  const sseExample = `event: status\ndata: {"stage":"thinking"}\n\nevent: status\ndata: {"stage":"writing"}\n\nevent: answer\ndata: ${JSON.stringify(answerExample)}\n\n`
  const explainExample = {
    ok: true,
    explanation: `The sender moved 1.5 EXAMPLE to another address. The network fee was under $0.01. ${L.explainLabel}.`,
    source: 'template',
    label: L.explainLabel,
    facts: {
      schema: 1,
      chain: { id: L.explainChainId, name: 'Gully Chain Testnet', testnet: true, label: L.explainLabel },
      tx: { hash: PH_HASH, status: 'success', block: 1000000, from: PH_ADDR, to: PH_TOKEN, valueEth: null, valueUsd: null, revertReason: null },
      method: { name: 'transfer', signature: 'transfer(address,uint256)', source: 'known' },
      actor: { address: PH_ADDR, short: '0x1111…1111' },
      aa: null,
      fee: { eth: '0.000001', usd: '$0.01', paidBy: 'sender' },
      transfers: [{ kind: 'token', logIndex: 0, token: PH_TOKEN, from: PH_ADDR, to: PH_ADDR2, symbol: 'EXAMPLE', amount: '1.5', usd: null }],
      approvals: [],
      contracts: [{ address: PH_TOKEN, sourcePublished: true }],
      counts: { transfers: 1, approvals: 0, logs: 1 },
      notes: ['Dollar figures use current prices, not the price at the time of the transaction.'],
    },
  }

  const paths = {
    '/api/ask': {
      post: {
        operationId: 'askQuestion',
        tags: ['Ask'],
        summary: 'Ask Gully AI a question',
        description: [
          'Answers one question about Gully Labs and its products from the public docs, with numbered sources. Some answers also read live public figures (for example a plan price in USD or the status page) and return them as cards.',
          `**Limits.** A question is at most ${L.maxQuestion} characters and the body at most ${kb(L.maxBodyBytes)}. One visitor may ask ${L.perVisitorPerMinute} questions a minute and ${L.perVisitorPerDay} a day. The service as a whole writes about ${L.perDayService.toLocaleString('en-US')} answers a day.`,
          `**History.** Send the earlier turns of the same conversation in \`history\`. Only the last ${L.maxHistoryTurns} entries are read and each is cut to ${L.maxHistoryChars} characters.`,
          '**When the service is full or its writing service is down** the answer is still HTTP 200: `degraded` names the reason, `model` is null and `answer` holds the closest docs passages with links, with no generated text. The `X-Ask-Degraded` header carries the same reason.',
          '**Streaming.** Send `Accept: text/event-stream` to get server-sent events: zero or more `status` events (`{ "stage": ... }`), then one `answer` event with the same JSON as the plain answer, or one `error` event (`{ "error", "status", "code"? }`). A request refused before work starts (bad body, missing header, over the limit) is answered with a plain JSON error and its HTTP status, not a stream. Once the stream is open the HTTP status is 200 even when it ends in an `error` event.',
          '**Privacy.** Emails, phone numbers and keys in a question are masked before it is logged or sent on. Never send a private key or recovery phrase: such a question is refused. `GET /api/ask/knowledge` says where a question goes and what is kept.',
          'A visitor signed in to the Gully Labs app in the same browser can also ask about their own workspace; `signedIn` says whether that applied. No key is needed.',
          'Information only: no advice and no predictions.',
        ].join('\n\n'),
        security: [],
        parameters: [requestedWith, { name: 'Accept', in: 'header', required: false, description: 'Send `text/event-stream` for a streamed answer. Anything else gets one JSON answer.', schema: { type: 'string' }, example: 'application/json' }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/AskRequest' },
              examples: {
                question: { summary: 'One question', value: { question: 'What does Gully AI know about?' } },
                followUp: { summary: 'A follow-up with history', value: { question: 'And how do I rate an answer?', history: [{ role: 'user', content: 'What does Gully AI know about?' }, { role: 'assistant', content: 'It answers from the public docs of Gully Labs products.' }] } },
              },
            },
          },
        },
        responses: {
          200: {
            description: 'The answer. With `Accept: text/event-stream`, the same answer as server-sent events.',
            headers: {
              'Cache-Control': { description: 'Always `no-store`.', schema: { type: 'string' } },
              'X-Ask-Degraded': { description: `Present only on a docs-passages answer (not sent on a stream): ${V.degraded.join(', ')}.`, schema: { type: 'string', enum: V.degraded } },
            },
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/Answer' }, examples: { written: { summary: 'A written answer', value: answerExample }, passages: { summary: 'Docs passages while the service is full', value: passagesExample } } },
              'text/event-stream': {
                schema: { type: 'string', description: 'Server-sent events. Each event is `event: <name>` then `data: <one line of JSON>` then a blank line. Names: `status` (data: StreamStatus), `answer` (data: Answer), `error` (data: StreamError). The stream closes after `answer` or `error`.' },
                example: sseExample,
              },
            },
          },
          400: { description: 'The body is not `{ question, history? }`, the question is empty or too long, or it looks like a private key or recovery phrase.', content: errBody({ error: `A question can be at most ${L.maxQuestion} characters.` }) },
          403: refused,
          405: wrongMethod('POST'),
          413: { description: `The body is larger than ${kb(L.maxBodyBytes)}.`, content: errBody({ error: `The request is larger than ${kb(L.maxBodyBytes)}.` }) },
          429: { description: 'Too many questions from one place this minute or today.', headers: retryAfter, content: errBody({ error: `At most ${L.perVisitorPerMinute} questions a minute. Try again shortly.` }) },
          502: { description: 'The answer could not be written and no docs passages could be returned.', content: errBody({ error: 'The answer could not be written just now. Try again.' }) },
          503: { description: 'Gully AI is not available yet, or it is busy and no docs passages could be returned.', content: errBody({ error: 'Ask is busy just now. Try again in a minute.', code: 'busy' }) },
        },
        'x-code-samples': [
          { lang: 'curl', label: 'JSON', source: curlPost('/api/ask', { question: 'What does Gully AI know about?' }) },
          { lang: 'curl', label: 'Stream', source: curlPost('/api/ask', { question: 'What does Gully AI know about?' }).replace('-H "Content-Type', '-N -H "Accept: text/event-stream" -H "Content-Type') },
        ],
      },
    },
    '/api/ask/status': {
      get: {
        operationId: 'getAskStatus',
        tags: ['About'],
        summary: 'Whether Gully AI is answering now',
        description: `Whether Gully AI is set up, how many docs passages it can search, when they were last refreshed and whether today's service limit is near. Read-only, no key, readable from any origin. Cached for ${L.statusCacheSeconds} seconds. HEAD is accepted too.`,
        security: [],
        responses: {
          200: {
            description: 'The status.',
            headers: { 'Cache-Control': { description: `\`public, max-age=${L.statusCacheSeconds}\`.`, schema: { type: 'string' } } },
            content: { 'application/json': { schema: { $ref: '#/components/schemas/AskStatus' }, example: { configured: true, model: 'example-model', indexSize: 500, updatedAt: PH_TIME, retrieval: 'bm25', provider: 'ok', since: null, cap: null } } },
          },
          405: wrongMethod('GET'),
        },
        'x-code-samples': [{ lang: 'curl', label: 'curl', source: `curl ${base}/api/ask/status` }],
      },
    },
    '/api/ask/knowledge': {
      get: {
        operationId: 'getAskKnowledge',
        tags: ['About'],
        summary: 'What Gully AI knows and where a question goes',
        description: `The sources Gully AI answers from, grouped by product (Covered, Thin or Missing), the services that receive the text of a question, what is logged and for how long, how to ask for deletion, and the limits in force. Read-only, no key, readable from any origin. Cached for ${L.knowledgeCacheSeconds} seconds. HEAD is accepted too.`,
        security: [],
        responses: {
          200: {
            description: 'The knowledge document.',
            headers: { 'Cache-Control': { description: `\`public, max-age=${L.knowledgeCacheSeconds}\`.`, schema: { type: 'string' } } },
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/Knowledge' },
                example: {
                  products: [{ id: 'ai', name: 'Gully AI', status: 'Covered', passages: 12, lastIndexedAt: PH_TIME, pages: [{ title: 'Gully AI', url: DOCS_URL, updatedAt: PH_TIME }], moreSources: 0 }],
                  general: { name: 'General', passages: 40, lastIndexedAt: PH_TIME },
                  totals: { passages: 500, words: 60000, pages: 80, covered: 10, thin: 3, missing: 1 },
                  updatedAt: PH_TIME,
                  retrieval: 'bm25',
                  owned: false,
                  note: 'Gully AI is software written around third-party model providers.',
                  providers: [{ name: 'Example provider', purpose: 'writes the answer', model: 'example-model', active: true, sends: 'your question and the matching passages of the public docs' }],
                  retention: { logDays: L.logDays, logHolds: 'the question, the sources used and a salted hash of your IP address', ratingsHold: 'the rating, the question and the same hash', rawIp: false },
                  deletion: { how: 'Send the contact form and say which question you want removed.', url: `${base}/services` },
                  limits: { question: L.maxQuestion, perVisitorPerMin: L.perVisitorPerMinute, perVisitorPerDay: L.perVisitorPerDay, perChatPerMin: 5, perChatPerDay: 60, perDayService: L.perDayService },
                },
              },
            },
          },
          405: wrongMethod('GET'),
        },
        'x-code-samples': [{ lang: 'curl', label: 'curl', source: `curl ${base}/api/ask/knowledge` }],
      },
    },
    '/api/ask/feedback': {
      post: {
        operationId: 'rateAnswer',
        tags: ['Ask'],
        summary: 'Rate an answer up or down',
        description: `Stores one rating for an answer given in the last ${L.ratingWindowHours} hours, by its \`id\`. A second rating of the same answer replaces the first. The question is taken from the server's own record of that answer, never from this request. A thumbs-down also keeps the answer text and its sources so the docs can be fixed. At most ${L.ratingsPerMinute} ratings a minute from one place; the body is at most ${kb(L.ratingBodyBytes)}.`,
        security: [],
        parameters: [requestedWith],
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/FeedbackRequest' }, example: { id: PH_ID, rating: 'up' } } } },
        responses: {
          200: { description: 'Saved.', content: { 'application/json': { schema: { type: 'object', required: ['ok'], properties: { ok: { type: 'boolean', const: true } } }, example: { ok: true } } } },
          400: { description: 'The body is not `{ id, rating }` or a field is malformed.', content: errBody({ error: 'rating must be "up" or "down".' }) },
          403: refused,
          404: { description: `Unknown answer id, or the answer is older than ${L.ratingWindowHours} hours.`, content: errBody({ error: 'That answer can no longer be rated.' }) },
          405: wrongMethod('POST'),
          413: { description: `The body is larger than ${kb(L.ratingBodyBytes)}.`, content: errBody({ error: 'Too large.' }) },
          429: { description: 'Too many ratings in a minute.', content: errBody({ error: 'Too many ratings in a minute.' }) },
          500: { description: 'The rating could not be saved.', content: errBody({ error: 'The rating could not be saved.' }) },
        },
        'x-code-samples': [{ lang: 'curl', label: 'curl', source: curlPost('/api/ask/feedback', { id: PH_ID, rating: 'up' }) }],
      },
    },
    '/api/ai/explain-tx': {
      post: {
        operationId: 'explainTransaction',
        tags: ['Explain'],
        summary: explainOn ? 'Explain a transaction in plain words' : 'Explain a transaction in plain words (not switched on yet)',
        description: [
          ...(explainOn ? [] : ['**Not switched on yet.** Until it is, every call is answered with HTTP 404 `{ "error": "not found" }`. The shape below is what it answers once it is on, and may still change.']),
          `Reads one transaction on Gully Chain Testnet (chain ${L.explainChainId}) and returns the facts (who sent it, what moved, approvals, the fee in ETH and USD) and a short explanation written only from those facts. When the explanation cannot be written or does not match the facts, a fixed-template explanation is returned instead and \`source\` is \`template\`.`,
          `**Limits.** ${L.explainPerMinute} calls a minute and ${L.explainPerDay} a day from one place, inside the same service-wide daily limit as questions. The body is at most ${kb(L.explainBodyBytes)}.`,
          `Every answer carries the label "${L.explainLabel}". USD figures use current prices, not the price at the time of the transaction. Information only.`,
        ].join('\n\n'),
        ...(explainOn ? {} : { 'x-status': 'off' }),
        security: [],
        parameters: [requestedWith],
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/ExplainRequest' }, example: { chainId: L.explainChainId, txHash: PH_HASH } } } },
        responses: {
          200: { description: 'The facts and the explanation.', content: { 'application/json': { schema: { $ref: '#/components/schemas/Explanation' }, example: explainExample } } },
          202: { description: 'The transaction is not in a block yet.', content: errBody({ error: 'That transaction has not been included in a block yet.', code: 'pending' }) },
          400: { description: 'Not a transaction hash, another chain, or a body that is not JSON.', content: errBody({ error: 'Send a 0x transaction hash (66 characters).', code: 'bad_input' }) },
          402: { description: 'Not enough credits. Nothing is charged today.', content: errBody({ error: 'Not enough credits.', code: 'credits' }) },
          403: refused,
          404: { description: explainOn ? 'No transaction with that hash was found.' : 'Not switched on yet, or (once on) no transaction with that hash was found.', content: { 'application/json': { schema: errRef, examples: { ...(explainOn ? {} : { off: { summary: 'Not switched on yet', value: { error: 'not found' } } }), unknown: { summary: 'Unknown transaction', value: { error: 'No transaction with that hash was found on Gully Chain Testnet.', code: 'not_found' } } } } } },
          405: wrongMethod('POST'),
          429: { description: 'Too many calls from one place, or the service-wide daily limit is reached.', headers: retryAfter, content: errBody({ error: `At most ${L.explainPerMinute} questions a minute. Try again shortly.` }) },
          503: { description: 'The chain could not be read just now.', content: errBody({ error: 'The chain could not be read just now. Try again shortly.', code: 'unavailable' }) },
        },
        'x-code-samples': [{ lang: 'curl', label: 'curl', source: curlPost('/api/ai/explain-tx', { txHash: PH_HASH }) }],
      },
    },
  }
  const documented = Object.keys(paths).sort()
  const fromCode = routes.filter((r) => !EXCLUDED[r])
  if (JSON.stringify(documented) !== JSON.stringify(fromCode)) throw new Error(`routes changed: code has ${fromCode.join(', ')}; the generator documents ${documented.join(', ')}`)

  const stat = { type: 'object', required: ['label', 'value'], properties: { label: { type: 'string' }, value: { type: 'string', description: 'Already formatted for display. Money is in USD.' }, tone: { type: 'string', enum: ['ok', 'warn', 'up', 'down'] } } }
  const nullableTime = { type: ['string', 'null'], format: 'date-time' }
  const tryOps = Object.entries(paths).flatMap(([p, item]) => (item.get && cors.includes(p) ? [item.get.operationId] : []))
  const getOps = Object.values(paths).flatMap((item) => (item.get ? [item.get.operationId] : []))
  const allOpen = tryOps.length === getOps.length

  return {
    openapi: '3.1.0',
    info: {
      title: 'Gully AI',
      version: JSON.parse(read('package.json')).version,
      summary: 'Ask questions about Gully Labs products and get answers with sources.',
      description: [
        'Gully AI answers questions about Gully Labs and its products from the public docs and from live public figures, and always names its sources. This document covers the public HTTP routes: ask a question, rate the answer, and read what Gully AI knows and whether it is answering now.',
        `## Calling it\n\nNo key is needed. Every POST must carry the header \`X-Requested-With: gully\` and a JSON body. That header cannot be sent from a page on another site, so call the POST routes from your server or from the command line. The two GET routes (status and knowledge) are readable from any origin, including a browser page.`,
        `## Limits\n\n| What | Limit |\n|---|---|\n| Question length | ${L.maxQuestion} characters |\n| Request body | ${kb(L.maxBodyBytes)} |\n| History read | last ${L.maxHistoryTurns} entries, ${L.maxHistoryChars} characters each |\n| Questions from one place | ${L.perVisitorPerMinute} a minute, ${L.perVisitorPerDay} a day |\n| Written answers, whole service | about ${L.perDayService.toLocaleString('en-US')} a day |\n| Docs-passages answers from one place (when the service is full or busy) | ${L.passagesPerMinute} a minute, ${L.passagesPerDay} a day |\n| Ratings from one place | ${L.ratingsPerMinute} a minute, for answers of the last ${L.ratingWindowHours} hours |\n\nThese are the defaults; the operators may change them, and \`GET /api/ask/knowledge\` reports the values in force. One place means one IPv4 address or one IPv6 /64. A day runs on US Pacific time. Over a limit the answer is HTTP 429, with a \`Retry-After\` header (seconds) on questions. No \`X-RateLimit-*\` headers are sent. When the whole service has reached its daily limit a question is still answered with HTTP 200, as docs passages with no generated text (\`degraded\` is set).`,
        `## Errors\n\nEvery error is JSON: \`{ "error": "<plain words>" }\`, sometimes with a short \`code\`. Rely on the HTTP status first; most errors carry no code.\n\n${errorTable}`,
        '## Good to know\n\nAnswers are information only: no advice and no predictions. Questions are logged without a raw IP address (a salted hash only) and kept for a limited time; the knowledge route gives the details and how to ask for deletion.',
      ].join('\n\n'),
      'x-generated-by': 'scripts/gen-openapi.mjs',
    },
    servers: [{ url: base, description: 'Gully Labs' }],
    tags: TAGS,
    paths,
    components: {
      schemas: {
        AskRequest: {
          type: 'object',
          required: ['question'],
          properties: {
            question: { type: 'string', minLength: 1, maxLength: L.maxQuestion, description: 'The question, in plain words. Runs of spaces are collapsed before the length is checked.' },
            history: {
              type: 'array',
              description: `Earlier turns of this conversation, oldest first. Only the last ${L.maxHistoryTurns} entries are read; each is cut to ${L.maxHistoryChars} characters.`,
              items: { type: 'object', required: ['role', 'content'], properties: { role: { type: 'string', enum: ['user', 'assistant'] }, content: { type: 'string' } } },
            },
            holders: {
              type: ['object', 'null'],
              description: 'Optional: the Holder Map the question is asked from, so the answer can read that map.',
              properties: { chain: { type: 'string', description: 'Chain name as the Holder Map uses it.', examples: ['bsc'] }, token: { type: 'string', maxLength: 64, description: 'Token address or ticker: letters and digits only.', examples: [PH_TOKEN] } },
            },
          },
        },
        Answer: {
          type: 'object',
          required: ['id', 'answer', 'citations', 'live', 'cards', 'actions', 'usedTools', 'model', 'signedIn'],
          properties: {
            id: { type: 'string', pattern: V.idPattern, description: `Use it to rate the answer within ${L.ratingWindowHours} hours.` },
            answer: { type: 'string', description: 'The answer text. `[1]` marks a source in `citations`; `[L1]` marks a live read in `live`.' },
            citations: { type: 'array', items: { $ref: '#/components/schemas/Citation' } },
            live: { type: 'array', items: { $ref: '#/components/schemas/LiveRead' } },
            cards: { type: 'array', maxItems: 3, items: { $ref: '#/components/schemas/Card' } },
            actions: { type: 'array', maxItems: 4, items: { $ref: '#/components/schemas/Action' } },
            usedTools: { type: 'array', description: 'Names of the live reads the answer used.', items: { type: 'string', examples: V.tools.slice(0, 3) } },
            model: { type: ['string', 'null'], description: 'Name of the model that wrote the answer. null on a docs-passages answer.' },
            retrieval: { type: 'string', enum: ['hybrid', 'bm25'], description: 'How the docs were searched: by keywords, or keywords plus meaning.' },
            degraded: { type: 'string', enum: V.degraded, description: 'Present only when the answer is docs passages with no generated text: the service-wide daily limit was reached (cap), too many answers were being written (busy), or the writing service did not answer (provider).' },
            signedIn: { type: 'boolean', description: 'true when the request came from a visitor signed in to the Gully Labs app.' },
          },
        },
        Citation: {
          type: 'object',
          required: ['n', 'title', 'url', 'source'],
          properties: { n: { type: 'integer', description: 'The number used in the answer text.' }, title: { type: 'string' }, url: { type: 'string', format: 'uri' }, source: { type: 'string', description: 'The kind of page, for example docs or blog.' } },
        },
        LiveRead: {
          type: 'object',
          required: ['n', 'tool', 'label', 'url'],
          properties: { n: { type: 'string', description: 'The label used in the answer text.', examples: ['L1'] }, tool: { type: 'string', description: 'Name of the live read.', examples: V.tools.slice(0, 3) }, label: { type: 'string' }, url: { type: 'string', format: 'uri', description: 'Where the figures can be checked.' }, asOf: { description: 'When the figures were read (ISO time or a millisecond timestamp).', type: ['string', 'number', 'null'] } },
        },
        Card: {
          type: 'object',
          description: 'A small panel built from a live read itself, never from the generated text, so its figures are exactly what was read.',
          required: ['kind', 'tool', 'title', 'stats'],
          properties: {
            kind: { type: 'string', enum: V.cardKinds },
            tool: { type: 'string' },
            cite: { type: 'string', description: 'The live read it belongs to.', examples: ['L1'] },
            asOf: { type: ['string', 'number', 'null'] },
            source: { type: ['object', 'null'], properties: { label: { type: 'string' }, url: { type: 'string', format: 'uri' } } },
            title: { type: 'string' },
            subtitle: { type: 'string' },
            stats: { type: 'array', items: stat },
            chart: {
              type: ['object', 'null'],
              description: 'A small line (`spark`: `points`, oldest first) or bars (`bars`). Absent or null with fewer than two points.',
              properties: { type: { type: 'string', enum: ['spark', 'bars'] }, points: { type: 'array', items: { type: 'number' } }, bars: { type: 'array', items: { type: 'object', properties: { label: { type: 'string' }, value: { type: ['number', 'null'] } } } }, unit: { type: 'string', examples: ['%', '$'] }, label: { type: 'string' } },
            },
            link: { type: 'object', properties: { label: { type: 'string' }, url: { type: 'string', format: 'uri' } } },
            note: { type: 'string' },
          },
        },
        Action: {
          type: 'object',
          description: 'A suggested next step as a link. `prefill` opens a form already filled in; nothing is created until the visitor saves it.',
          required: ['kind', 'label', 'url'],
          properties: { kind: { type: 'string', enum: V.actionKinds }, label: { type: 'string' }, url: { type: 'string', format: 'uri' }, note: { type: 'string' } },
        },
        StreamStatus: {
          type: 'object',
          description: 'Data of a `status` event.',
          required: ['stage'],
          properties: { stage: { type: 'string', description: `What is happening now: ${V.stages.map((s) => `\`${s}\``).join(', ')} (\`tool:<name>\` names the live read in progress).`, examples: V.stages } },
        },
        StreamError: {
          type: 'object',
          description: 'Data of an `error` event.',
          required: ['error', 'status'],
          properties: { error: { type: 'string' }, status: { type: 'integer', description: 'The HTTP status the same failure has without streaming.' }, code: { type: 'string' } },
        },
        FeedbackRequest: {
          type: 'object',
          required: ['id', 'rating'],
          properties: { id: { type: 'string', pattern: V.idPattern, description: 'The `id` of the answer.' }, rating: { type: 'string', enum: ['up', 'down'] } },
        },
        AskStatus: {
          type: 'object',
          required: ['configured', 'model', 'indexSize', 'updatedAt', 'retrieval', 'provider', 'cap'],
          properties: {
            configured: { type: 'boolean', description: 'false while Gully AI is not set up: questions are answered with 503.' },
            model: { type: 'string', description: 'Name of the model that writes answers.' },
            indexSize: { type: 'integer', description: 'Docs passages that can be searched.' },
            updatedAt: { ...nullableTime, description: 'When the passages were last refreshed.' },
            retrieval: { type: 'string', enum: ['hybrid', 'bm25'] },
            provider: { type: 'string', enum: ['ok', 'degraded', 'unavailable'], description: 'Whether the writing service is answering.' },
            since: { ...nullableTime, description: 'Since when `provider` has had its current value, when known.' },
            cap: { type: ['string', 'null'], enum: ['warn', 'full', null], description: "Today's service-wide limit: null, `warn` at 80 % or `full` when reached (answers become docs passages)." },
          },
        },
        Knowledge: {
          type: 'object',
          required: ['products', 'general', 'totals', 'providers', 'retention', 'deletion', 'limits'],
          properties: {
            products: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  name: { type: 'string' },
                  status: { type: 'string', enum: ['Covered', 'Thin', 'Missing'], description: 'How much Gully AI has to answer from for this product.' },
                  passages: { type: 'integer' },
                  lastIndexedAt: nullableTime,
                  pages: { type: 'array', maxItems: 40, items: { type: 'object', properties: { title: { type: 'string' }, url: { type: 'string' }, updatedAt: nullableTime } } },
                  moreSources: { type: 'integer', description: 'Pages beyond the 40 listed.' },
                },
              },
            },
            general: { type: 'object', description: 'Passages that name no single product.', properties: { name: { type: 'string' }, passages: { type: 'integer' }, lastIndexedAt: nullableTime } },
            totals: { type: 'object', properties: { passages: { type: 'integer' }, words: { type: 'integer' }, pages: { type: 'integer' }, covered: { type: 'integer' }, thin: { type: 'integer' }, missing: { type: 'integer' } } },
            updatedAt: nullableTime,
            retrieval: { type: 'string', enum: ['hybrid', 'bm25'] },
            owned: { type: 'boolean', description: 'false: Gully AI is software around third-party model providers, not a model Gully Labs trains or hosts.' },
            note: { type: 'string' },
            providers: { type: 'array', description: 'The services that receive text, and exactly what they receive.', items: { type: 'object', properties: { name: { type: 'string' }, purpose: { type: 'string' }, model: { type: ['string', 'null'] }, active: { type: 'boolean' }, sends: { type: 'string' } } } },
            retention: { type: 'object', properties: { logDays: { type: 'integer' }, logHolds: { type: 'string' }, ratingsHold: { type: 'string' }, rawIp: { type: 'boolean', description: 'false: a raw IP address is never stored.' } } },
            deletion: { type: 'object', properties: { how: { type: 'string' }, url: { type: 'string', format: 'uri' } } },
            limits: { type: 'object', description: 'The limits in force now.', properties: { question: { type: 'integer' }, perVisitorPerMin: { type: 'integer' }, perVisitorPerDay: { type: 'integer' }, perChatPerMin: { type: 'integer', description: 'Per chat on the Telegram bot.' }, perChatPerDay: { type: 'integer' }, perDayService: { type: 'integer' } } },
          },
        },
        ExplainRequest: {
          type: 'object',
          required: ['txHash'],
          properties: { txHash: { type: 'string', pattern: '^0x[0-9a-fA-F]{64}$', description: 'Transaction hash.' }, chainId: { type: 'integer', const: L.explainChainId, description: `Optional. Only ${L.explainChainId} (Gully Chain Testnet) is supported for now.` } },
        },
        Explanation: {
          type: 'object',
          required: ['ok', 'explanation', 'source', 'label', 'facts'],
          properties: {
            ok: { type: 'boolean', const: true },
            explanation: { type: 'string', description: 'A few plain sentences written only from `facts`.' },
            source: { type: 'string', enum: ['model', 'template'], description: '`template` when the fixed wording was used.' },
            label: { type: 'string', const: L.explainLabel },
            facts: { $ref: '#/components/schemas/TransactionFacts' },
            fellBackBecause: { type: 'array', maxItems: 3, items: { type: 'string' }, description: 'Present when `source` is `template`: why the written explanation was not used.' },
            usage: { type: 'object', description: 'Present when a model wrote the explanation: its token counts.', additionalProperties: true },
          },
        },
        TransactionFacts: {
          type: 'object',
          description: 'What was read from the chain. Money is in ETH and USD; USD fields are null when no price was available.',
          properties: {
            schema: { type: 'integer', const: 1 },
            chain: { type: 'object', properties: { id: { type: 'integer' }, name: { type: 'string' }, testnet: { type: 'boolean' }, label: { type: 'string' } } },
            tx: { type: 'object', properties: { hash: { type: 'string' }, status: { type: 'string', enum: ['success', 'reverted'] }, block: { type: 'integer' }, from: { type: 'string' }, to: { type: ['string', 'null'] }, valueEth: { type: ['string', 'null'] }, valueUsd: { type: ['string', 'null'] }, revertReason: { type: ['string', 'null'] } } },
            method: { type: 'object', properties: { name: { type: ['string', 'null'] }, signature: { type: ['string', 'null'] }, source: { type: ['string', 'null'] } } },
            actor: { type: 'object', description: 'Who acted: the sender, or the smart account behind a bundled operation.', properties: { address: { type: 'string' }, short: { type: 'string' } } },
            aa: { type: ['object', 'null'], description: 'Set when the transaction carries smart-account operations.', properties: { isUserOp: { type: 'boolean' }, bundler: { type: 'string' }, userOps: { type: 'integer' }, sender: { type: ['string', 'null'] }, paymaster: { type: ['string', 'null'] }, sponsored: { type: 'boolean' }, userOpSuccess: { type: ['boolean', 'null'] } } },
            fee: { type: 'object', properties: { eth: { type: 'string' }, usd: { type: ['string', 'null'] }, paidBy: { type: 'string' } } },
            transfers: { type: 'array', items: { type: 'object', properties: { kind: { type: 'string' }, logIndex: { type: 'integer' }, token: { type: 'string' }, from: { type: 'string' }, to: { type: 'string' }, symbol: { type: ['string', 'null'] }, amount: { type: ['string', 'null'] }, usd: { type: ['string', 'null'] }, tokenId: { type: 'string' } } } },
            approvals: { type: 'array', items: { type: 'object', properties: { logIndex: { type: 'integer' }, token: { type: 'string' }, symbol: { type: ['string', 'null'] }, owner: { type: 'string' }, spender: { type: 'string' }, amount: { type: ['string', 'null'], description: 'A formatted amount, or `unlimited`.' } } } },
            contracts: { type: 'array', maxItems: 8, items: { type: 'object', properties: { address: { type: 'string' }, sourcePublished: { type: ['boolean', 'null'], description: 'Whether the contract source is published.' } } } },
            counts: { type: 'object', properties: { transfers: { type: 'integer' }, approvals: { type: 'integer' }, logs: { type: 'integer' } } },
            notes: { type: 'array', items: { type: 'string' } },
            graph: { type: 'object', description: 'The same facts as nodes, edges and steps for drawing a flow.', additionalProperties: true },
          },
        },
        Error: {
          type: 'object',
          required: ['error'],
          properties: {
            error: { type: 'string', description: 'The reason, in plain words.' },
            code: { type: 'string', enum: [...new Set(errors.map((e) => e.code).filter(Boolean))].sort(), description: 'A short code. Most errors carry none.' },
            configured: { type: 'boolean', description: 'false on the 503 sent while Gully AI is not set up.' },
          },
        },
      },
    },
    'x-rate-limit': {
      headers: rateHeaders,
      note: rateHeaders.some((h) => /^X-RateLimit/i.test(h))
        ? 'See each operation for the headers.'
        : `No X-RateLimit-* headers are sent. Retry-After (seconds) comes with a 429 on questions and explanations. Defaults: ${L.perVisitorPerMinute} questions a minute and ${L.perVisitorPerDay} a day from one place.`,
      perVisitor: { perMinute: L.perVisitorPerMinute, perDay: L.perVisitorPerDay },
      service: { perDay: L.perDayService },
    },
    'x-errors': errors,
    'x-try-it': {
      keyless: allOpen && tryOps.length > 0,
      operations: tryOps,
      note: allOpen
        ? 'The two GET routes need no key and are readable from any origin. Asking a question, rating and explaining are POST routes that need a header a page on another site cannot send, and a question uses the shared daily allowance, so the hub shows curl for those.'
        : 'The GET routes are not readable from other origins, so the hub shows curl.',
    },
  }
}

export const DOCS = { 'openapi/gully-ai.json': buildGullyAi }

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const check = process.argv.includes('--check')
  let stale = 0
  for (const [file, build] of Object.entries(DOCS)) {
    const text = stableJson(build())
    const abs = join(ROOT, file)
    if (check) {
      const cur = existsSync(abs) ? readFileSync(abs, 'utf8').replace(/\r\n/g, '\n') : ''
      if (cur !== text) {
        console.error(`STALE ${file}: run node scripts/gen-openapi.mjs`)
        stale++
      }
    } else {
      mkdirSync(dirname(abs), { recursive: true })
      writeFileSync(abs, text)
      console.log(`wrote ${file}`)
    }
  }
  process.exit(stale ? 1 : 0)
}
