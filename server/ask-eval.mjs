// Gully AI: the fixed evaluation set and its runner.
//
// Each case is one question with what a good answer must do:
//   cite     the retrieved sources (and the answer's citations) include a page whose URL matches `url`
//   unknown  the question is about something we do not publish: the answer must say it does not know (no invented fact)
//   nonumber every number in the answer must appear in the cited sources or the question (no invented figure)
// A case may need a source group that is only there once the remote docs are loaded (`needs: 'remote'`); a run reports
// those as skipped when none of its pages are in the index, so CI (local index only, fake provider) stays green and the
// admin run (live index) checks everything.
//
// Two layers: the RETRIEVAL layer is free and deterministic (no model call), the ANSWER layer calls the provider and is
// run from the admin on purpose (it spends tokens) or in CI against a fake provider.
//
//   runEval({ cases, retrieveFn, answerFn?, hasPages? })  -> { at, total, passed, failed, skipped, results[] }
//   EvalHistory(file)                                       the last 50 runs, newest first

import fs from 'node:fs'
import path from 'node:path'

/** A page-URL regex per case; `q` is asked exactly as written. */
export const EVAL_SET = [
  { id: 'tracker-what', q: 'What does the Gully Labs tracker do?', checks: ['cite'], url: /docs\.gullylabs\.xyz\/(?:$|tracker|api|getting-started)|gullylabs\.xyz\/tracker/ },
  { id: 'tracker-api', q: 'What is the public API for the tracker?', checks: ['cite'], url: /docs\.gullylabs\.xyz\/(?:api|tracker-api|widget)|gullylabs\.xyz\/api/ },
  { id: 'holder-map', q: 'What is the Holder Map?', checks: ['cite'], url: /holder/ },
  { id: 'pay-fee', q: 'What does Gully Pay charge merchants?', checks: ['cite', 'nonumber'], url: /gully-pay|gullypay|merchant-terms|pricing/ },
  { id: 'security-scan', q: 'What is an AI Security Scan and what does it not do?', checks: ['cite'], url: /security|scan-terms/ },
  { id: 'chain-kit', q: 'Can I order a Chain Kit explorer today?', checks: ['cite'], url: /chain-kit|chains/ },
  { id: 'ask-limits', q: 'How many questions can I ask Gully AI per day?', checks: ['cite', 'nonumber'], url: /gully-ai|\/ask/ },
  { id: 'telegram', q: 'How do I set up Telegram alerts?', checks: ['cite'], url: /telegram|plans-alerts/ },
  { id: 'privacy-retention', q: 'How long are my Gully AI questions kept?', checks: ['cite'], url: /privacy|gully-ai/ },
  { id: 'analytics', q: 'What is Gully Analytics?', checks: ['cite'], url: /analytics/ },
  { id: 'ipfs', q: 'Can I pin files on Gully IPFS?', checks: ['cite'], url: /ipfs/ },
  { id: 'core', q: 'What is Gully Core?', needs: 'remote', checks: ['cite'], url: /gullycore|gully-core|core-sdk/ },
  { id: 'chain', q: 'What is Gully Chain?', checks: ['cite'], url: /gullychain|gully-chain|\/chains?|chain-kit/ },
  { id: 'chain-wallet', q: 'How do I add Gully Chain to my wallet?', needs: 'remote', checks: ['cite'], url: /docs\.gullychain\.xyz|gully-chain/ },
  { id: 'gully-id', q: 'What is Gully ID and how do I sign in with it?', needs: 'remote', checks: ['cite'], url: /gullyid|gully-id/ },
  { id: 'rpc', q: 'How do I get an RPC endpoint from Gully RPC?', needs: 'remote', checks: ['cite'], url: /gullyrpc|gully-rpc/ },
  { id: 'kre8', q: 'What is kre8?', needs: 'remote', checks: ['cite'], url: /kre8/ },
  { id: 'swoop', q: 'How does a creator earn with Swoop Ads?', needs: 'remote', checks: ['cite'], url: /swoopads|swoop/ },
  { id: 'multisig', q: 'Which chains does Gully Multisig support?', needs: 'remote', checks: ['cite'], url: /multisig/ },
  { id: 'unknown-price', q: 'What is the price of the GLLY token on Coinbase tomorrow?', checks: ['unknown'] },
  { id: 'unknown-ceo', q: 'What is the home address of the Gully Labs founder?', checks: ['unknown'] },
  { id: 'unknown-sla', q: 'What is the contractual uptime SLA percentage for Gully RPC enterprise?', checks: ['unknown', 'nonumber'] },
]

const NUM = /\d[\d,]*(?:\.\d+)?%?/g
/** Numbers written in `answer` that appear in none of `sourceText` and `question` (the digits 1-9 alone, like list or [n] marks, are ignored). */
export function inventedNumbers(answer, sourceText, question = '') {
  const known = new Set((String(sourceText) + ' ' + String(question)).match(NUM)?.map((n) => n.replace(/[,%]/g, '')) ?? [])
  const body = String(answer).replace(/\[L?\d+\]/g, ' ').replace(/https?:\/\/\S+/g, ' ')
  const out = []
  for (const m of body.match(NUM) ?? []) {
    const n = m.replace(/[,%]/g, '')
    if (/^\d$/.test(n) || known.has(n)) continue
    out.push(m)
  }
  return [...new Set(out)]
}

const DONT_KNOW = /\b(i don[’']?t know|i do not know|not covered|don[’']?t have (that|this|any)|no information)\b/i

/**
 * @param {object} o
 * @param {object[]} [o.cases]
 * @param {(q:string)=>Promise<{results:{chunk:{url:string}}[]}>} o.retrieveFn
 * @param {(q:string)=>Promise<{answer:string,citations:{url:string}[],answered:boolean,sourceText:string}>} [o.answerFn] when set, the answer layer runs too
 * @param {(re:RegExp)=>boolean} [o.hasPages] is any indexed page matching the regex (to skip `needs: 'remote'` cases)
 */
export async function runEval({ cases = EVAL_SET, retrieveFn, answerFn = null, hasPages = () => true, now = () => new Date().toISOString() } = {}) {
  const results = []
  for (const c of cases) {
    if (c.needs === 'remote' && c.url && !hasPages(c.url)) {
      results.push({ id: c.id, question: c.q, status: 'skipped', checks: [], note: 'its source group is not indexed here' })
      continue
    }
    const checks = []
    let got = null
    if (c.checks.includes('cite')) {
      const r = await retrieveFn(c.q)
      const urls = r.results.map((x) => x.chunk.url)
      const hit = urls.find((u) => c.url.test(u))
      checks.push({ name: 'retrieval cites the right page', pass: !!hit, detail: hit ?? `top: ${urls.slice(0, 3).join(', ') || 'nothing'}` })
    }
    if (answerFn) {
      try {
        got = await answerFn(c.q)
      } catch (e) {
        checks.push({ name: 'answer was written', pass: false, detail: String(e?.message ?? e).slice(0, 120) })
      }
      if (got) {
        if (c.checks.includes('cite')) {
          const hit = got.citations.find((x) => c.url.test(x.url))
          checks.push({ name: 'answer cites the right page', pass: !!hit, detail: hit?.url ?? `cited: ${got.citations.map((x) => x.url).slice(0, 3).join(', ') || 'nothing'}` })
        }
        if (c.checks.includes('unknown')) checks.push({ name: 'says it does not know', pass: !got.answered || DONT_KNOW.test(got.answer), detail: got.answer.slice(0, 100) })
        if (c.checks.includes('nonumber')) {
          const bad = inventedNumbers(got.answer, got.sourceText, c.q)
          checks.push({ name: 'invents no number', pass: !bad.length, detail: bad.length ? `not in the sources: ${bad.join(', ')}` : 'ok' })
        }
      }
    } else if (c.checks.includes('unknown') && !c.checks.includes('cite')) {
      // No model call: an unknown-case can still be checked at retrieval level only loosely, so it is skipped.
      results.push({ id: c.id, question: c.q, status: 'skipped', checks: [], note: 'needs the answer layer' })
      continue
    }
    const pass = checks.length > 0 && checks.every((k) => k.pass)
    results.push({ id: c.id, question: c.q, status: pass ? 'pass' : 'fail', checks })
  }
  const count = (s) => results.filter((r) => r.status === s).length
  return { at: now(), layer: answerFn ? 'answer' : 'retrieval', total: results.length, passed: count('pass'), failed: count('fail'), skipped: count('skipped'), results }
}

/** The last 50 runs in one JSON-lines file. */
export class EvalHistory {
  constructor(file) {
    this.file = file
  }
  list() {
    try {
      return fs
        .readFileSync(this.file, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l))
        .reverse()
    } catch {
      return []
    }
  }
  add(run) {
    const keep = [...this.list().slice(0, 49).reverse(), run]
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true })
      fs.writeFileSync(this.file, keep.map((r) => JSON.stringify(r)).join('\n') + '\n')
    } catch (e) {
      console.error('ask eval history:', e?.message ?? e)
    }
    return run
  }
}
