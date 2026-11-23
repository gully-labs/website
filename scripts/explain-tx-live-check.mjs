// Live end-to-end check of explain-tx against the real keyless gateway and indexer, with a fake provider (and, when
// ANTHROPIC_API_KEY is set in the environment, optionally the real one: EXPLAIN_REAL=1). Flag-on only inside this process.
//   EXPLAIN_RPC_URL=https://rpc.gullyrpc.xyz/gullychain/evm/485590 node scripts/explain-tx-live-check.mjs <manifest.json>
import fs from 'node:fs'
import { explainTx, realDeps, checkGrounded, templateExplanation } from '../server/ai/explain-tx.mjs'
import { makeGateway, fakeProvider, gateway } from '../server/ai/gateway.mjs'
const m = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'))
const hashes = [...new Set(Object.values(m.cases).filter((c) => c.found).map((c) => c.hash))]
const fake = makeGateway({ providers: [fakeProvider((req) => { const f = JSON.parse(req.messages[0].content); return 'The sender ran ' + (f.method.name ?? 'a call') + '. Testnet: no real value.' }, 'anthropic')] })
process.env.AI_PROVIDERS = 'anthropic'
let bad = 0
for (const h of hashes) {
  const t0 = Date.now()
  const r = await explainTx({ chainId: 485590, txHash: h }, { deps: realDeps(), gw: fake })
  const ms = Date.now() - t0
  const ok = r.ok && r.facts.graph.edges.length > 0
  if (!ok) bad++
  console.log(ok ? 'ok ' : 'BAD', h.slice(0, 12), r.ok ? `${r.source} ${ms} ms transfers=${r.facts.transfers.length} edges=${r.facts.graph.edges.length} fee=${r.facts.fee.usd}` : r.error)
}
if (process.env.EXPLAIN_REAL === '1') {
  for (const h of hashes.slice(0, 3)) {
    const t0 = Date.now()
    const r = await explainTx({ chainId: 485590, txHash: h }, { deps: realDeps(), gw: gateway })
    console.log('real', h.slice(0, 12), r.ok ? `${r.source} ${Date.now() - t0} ms ${r.fellBackBecause ? 'fellBack=' + JSON.stringify(r.fellBackBecause) : ''}\n   ${r.explanation}` : r.error)
  }
}
process.exit(bad ? 1 : 0)
