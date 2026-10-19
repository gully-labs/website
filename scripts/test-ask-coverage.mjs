// Retrieval coverage eval for Gully AI: for each product, questions whose top-k retrieval must hit a chunk of that
// product. Retrieval only: the same retrieve() ask.mjs uses (BM25 + synonym expansion, no embeddings: VOYAGE_API_KEY
// is cleared), no LLM calls, no network, no server.
//
//   node scripts/test-ask-coverage.mjs
//
// The index is built from the working tree into a temp file, with the feature catalog read from
// scripts/fixtures/features.sample.ts (src/content/features.ts is merged separately; if it exists it is NOT used here,
// so the eval is the same before and after that merge). Also checks the catalog rules: only live, beta and testnet
// features are "Features" chunks; building and planned ones are "Roadmap" chunks that say they are not available.

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { makeChecker } from './test-helpers.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gully-ask-cov-'))
const INDEX = path.join(tmp, 'ask-index.json')
execFileSync(process.execPath, [path.join(here, 'build-ask-index.mjs'), '--out', INDEX, '--features', path.join(here, 'fixtures', 'features.sample.ts')], { stdio: 'pipe' })

process.env.ASK_INDEX_FILE = INDEX
process.env.ASK_REMOTE = 'off'
process.env.DATA_DIR = tmp
delete process.env.VOYAGE_API_KEY
delete process.env.ANTHROPIC_API_KEY
const { retrieve } = await import('../server/ask.mjs')

const t = makeChecker()
const { check } = t
const K = 6

// product, question, a regex the hit's "url title" must match
const CASES = [
  ['Holder Map', 'How does the Holder Map show connected clusters of wallets?', /holder-map|\/holders/],
  ['Holder Map', 'What is the Launch Health score of a token launch?', /holder-map|\/holders/],
  ['Holder Map', 'Can I embed a Holder Map on my own site?', /holder-map|widget|\/holders/],
  ['Gully Pay', 'Which chains and coins can I pay with on Gully Pay?', /docs\.gullylabs\.xyz\/gully-pay/],
  ['Gully Pay', 'How do I set up a merchant store, its wallets and its fees?', /gully-pay-merchants/],
  ['Gully Pay', 'Can funds get stuck in the fee proxy?', /gully-pay|contracts\/(CHOICE|TESTNET)/],
  ['Gully Security', 'What does the AI Security Scan check and is it an audit?', /gully-security|\/security/],
  ['Gully Security', 'Do you offer a human security review?', /gully-security|\/security/],
  ['Gully Score', 'How is the Gully Score of a contract worked out?', /gully-score|\/score/],
  ['Tracker', 'What is the gap between a stock token\'s onchain price and its fair price?', /methodology|tracker|\/api/],
  ['Tracker', 'What does a stock token page show?', /stock-pages|tracker/],
  ['Gully AI', 'What sources does Gully AI answer from?', /gully-ai|\/ask/],
  ['Telegram bot', 'What commands does the Telegram bot have?', /docs\.gullylabs\.xyz\/telegram#|t\.me\/GullyLabsBot/],
  ['Mini App', 'How do I open the Mini App inside Telegram?', /telegram-mini-app|gullylabs\.xyz\/tg/],
  ['News gate', 'Do I have to follow the news channel to use the bot?', /news-gate|\/telegram/],
  ['Analytics', 'How do I install the Gully Analytics tracking script on my site?', /analytics/],
  ['Chain Kit', 'What does Chain Kit include for launching my own chain and explorer?', /chain-kit/],
  ['Gully Chains', 'What is the Gully L3 and how does it settle and store data?', /roadmap-l3|l3\/SPEC|roadmap/],
  ['SDK', 'Which npm packages does the Gully SDK have?', /\/sdk|github\.com\/gully-labs\/sdk/],
  ['Widget', 'How do I embed the tracker widget on my page?', /widget/],
  ['Solana', 'Does the tracker cover tokenised stocks on Solana?', /\/solana/],
  ['Solana Pay', 'Can I accept Solana Pay payments?', /solana-pay/],
  ['Swaps', 'How do swaps work and who holds my funds?', /swaps/],
  ['Status', 'Where can I check the status page for outages?', /status/],
  ['Pricing', 'How much does the paid API plan cost and what are the rate limits?', /pricing|plans-alerts/],
  ['Legal', 'How long does Gully Labs keep my data?', /legal\/privacy/],
  ['Treasury Safe', 'How is the treasury Safe deployed on another chain?', /TREASURY-SAFE|gully-pay-merchants#safe/],
  ['Services', 'Can Gully Labs build a custom project for us?', /services|about/],
  ['Repos', 'Which GitHub repository is the Gully Analytics fork of Umami?', /github\.com\/gully-labs\/umami/],
  ['Repos', 'What is in the gullylabs.xyz website repository README?', /github\.com\/gully-labs\/website/],
  ['Repos', 'What is the Gully Bridge, the Arbitrum token bridge fork?', /arbitrum-token-bridge|chain-kit/],
  ['Project: Cartel Family', 'What is Cartel Family?', /projects\/cartel-family/],
  ['Project: DeepCore', 'What is DeepCore?', /projects\/deepcore|deepcore/],
  ['Project: PeddleSwap', 'What is PeddleSwap?', /projects\/peddleswap/],
  ['Project: Peddles', 'What is Peddles?', /projects\/peddles(?!\w)/],
  ['Project: PeddleQuest', 'What is PeddleQuest?', /projects\/peddlequest/],
  // The feature catalog (fixture): available features are found, with their honest status.
  ['Catalog (live)', 'What are the Launch Health checks in the Holder Map?', /gullylabs\.xyz\/holders|holder-map/, (c) => c.source === 'Features' || /holder/.test(c.url)],
  ['Catalog (beta)', 'Can merchants take Solana Pay payments with a QR code?', /solana-pay/, (c) => c.source === 'Features' && /beta/.test(c.text)],
  ['Catalog (testnet)', 'Is there a test network for the Gully L3?', /chain-kit|roadmap/, (c) => c.source === 'Features' && /testnet only/.test(c.text)],
  ['Catalog (building)', 'Is the Zeta vault sweeper available?', /./, (c) => c.source === 'Roadmap' && /NOT available yet/.test(c.text)],
  ['Catalog (planned)', 'Is there a Python SDK for the tracker API?', /./, (c) => c.source === 'Roadmap' && /NOT available yet/.test(c.text)],
]

const rows = []
for (const [product, question, want, extra] of CASES) {
  const { results, mode } = await retrieve(question, { k: K })
  const rank = results.findIndex((r) => want.test(`${r.chunk.url} ${r.chunk.title}`) && (!extra || extra(r.chunk))) + 1
  rows.push({ product, question, rank, top: results[0]?.chunk.url ?? '-', mode })
  check(`${product}: "${question}" hits in the top ${K}`, rank > 0, rank ? `rank ${rank}` : `top: ${results.slice(0, 3).map((r) => r.chunk.url).join(' | ')}`)
}

// Catalog rules, on the built index.
const doc = JSON.parse(fs.readFileSync(INDEX, 'utf8'))
const feat = doc.chunks.filter((c) => c.feature)
check('the catalog fixture is indexed', feat.length >= 6, `${feat.length} feature chunks`)
check('"Features" chunks are only live, beta or testnet', doc.chunks.filter((c) => c.source === 'Features').every((c) => ['live', 'beta', 'testnet'].includes(c.status)))
check('building and planned features are only "Roadmap" chunks that say they are not available', feat.filter((c) => ['building', 'planned'].includes(c.status)).length >= 2 && feat.filter((c) => ['building', 'planned'].includes(c.status)).every((c) => c.source === 'Roadmap' && /NOT available yet/.test(c.text)))
check('every available feature chunk states its status', feat.filter((c) => c.source === 'Features').every((c) => /Status: (live now|in beta|on testnet only)/.test(c.text)))
check('no Features chunk mentions a building or planned feature', !doc.chunks.some((c) => c.source === 'Features' && /Zeta vault sweeper|Python SDK/.test(c.text)))
check('no secrets or full addresses in the index', !doc.chunks.some((c) => /\b0x[0-9a-fA-F]{40,}\b/.test(c.text) || /BEGIN [A-Z ]*PRIVATE KEY|\bsk-[A-Za-z0-9]{10}/.test(c.text)))
check('no admin-only pages or env files are indexed', !doc.chunks.some((c) => /\/admin|\.env/i.test(c.url)))
const sources = doc.chunks.reduce((m, c) => ((m[c.source] = (m[c.source] ?? 0) + 1), m), {})
for (const s of ['Docs', 'Site', 'Legal', 'Ops notes', 'GitHub README', 'Features', 'Roadmap', 'Telegram bot', 'Telegram Mini App']) check(`the index has "${s}" chunks`, (sources[s] ?? 0) > 0, String(sources[s] ?? 0))

console.log('\nproduct | question | rank | top hit')
for (const r of rows) console.log(`${r.product} | ${r.question} | ${r.rank || 'MISS'} | ${r.top}`)
console.log(`\nretrieval mode: ${rows[0]?.mode}; ${doc.chunks.length} chunks ${JSON.stringify(sources)}`)
console.log(`\n${t.passed} passed, ${t.failed} failed`)
fs.rmSync(tmp, { recursive: true, force: true })
process.exit(t.failed ? 1 : 0)
