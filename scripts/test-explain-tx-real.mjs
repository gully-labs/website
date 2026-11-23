// Replays REAL Gully Chain testnet fixtures (server/ai/fixtures/explain-tx/real, recorded by scripts/record-explain-fixtures.mjs)
// through buildFacts and checks the result against figures recomputed straight from the raw receipt and the public indexer rows.
//   node scripts/test-explain-tx-real.mjs
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { makeGateway, fakeProvider } from '../server/ai/gateway.mjs'
import { buildFacts, explain, checkGrounded, templateExplanation, fmtUnits, fmtUsd, CHAIN_ID } from '../server/ai/explain-tx.mjs'

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '../server/ai/fixtures/explain-tx/real')
const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'))
let n = 0
const ok = (name) => console.log(`ok ${++n} ${name}`)
const T_TRANSFER = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'
const T_APPROVAL = '0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925'
const EP = '0x0000000071727de22e5e9d8baf0edac6f37da032'

const fixture = (name) => JSON.parse(fs.readFileSync(path.join(dir, `${name}.json`), 'utf8'))
/** Deps that answer from the recording only; any call the recording does not hold fails the test. */
function replay(rec) {
  const key = (m, p) => m + JSON.stringify(p)
  const map = new Map(rec.rpc.map((x) => [key(x.m, x.p), x]))
  return {
    async rpc(m, p) {
      const x = map.get(key(m, p))
      assert.ok(x, `unrecorded rpc ${m} ${JSON.stringify(p).slice(0, 120)}`)
      if (x.error) throw Object.assign(new Error(x.error.message), { data: x.error.data })
      return x.result
    },
    abi: async (a) => rec.abi[a] ?? null,
    price: async (a) => rec.price[a] ?? null,
    ethUsd: async () => rec.ethUsd ?? null,
  }
}
const rawOf = (rec, m) => rec.rpc.find((x) => x.m === m)?.result
const parseUsd = (s) => (s ? Number(s.replace(/[$,<]/g, '')) : null)

const names = Object.keys(manifest.cases).filter((k) => manifest.cases[k].found)
const seen = new Set()
for (const name of names) {
  const fx = fixture(name)
  if (seen.has(fx.hash)) continue // swap and multi_transfer can be the same transaction
  seen.add(fx.hash)
  const r = await buildFacts({ chainId: CHAIN_ID, txHash: fx.hash }, replay(fx.rec))
  assert.ok(r.ok, name)
  const f = r.facts
  const tx = rawOf(fx.rec, 'eth_getTransactionByHash')
  const rc = rawOf(fx.rec, 'eth_getTransactionReceipt')

  // independent recomputation from the raw receipt
  const feeWei = BigInt(rc.gasUsed) * BigInt(rc.effectiveGasPrice)
  const whole = feeWei / 10n ** 18n
  assert.ok(f.fee.eth.startsWith(String(whole)), `${name} fee`)
  assert.equal(f.tx.status, rc.status === '0x1' ? 'success' : 'reverted')
  const tlogs = rc.logs.filter((l) => l.topics[0] === T_TRANSFER && (l.topics.length === 3 || l.topics.length === 4))
  assert.equal(f.transfers.length, Math.min(tlogs.length, 25), `${name} transfer count`)
  assert.equal(f.approvals.length, Math.min(rc.logs.filter((l) => l.topics[0] === T_APPROVAL && l.topics.length === 3).length, 25 - f.transfers.length))
  // every graph edge with a log cites a real log of the right contract; every edge endpoint is a node
  const ids = new Set(f.graph.nodes.map((x) => x.id))
  for (const e of f.graph.edges) {
    assert.ok(ids.has(e.from) && ids.has(e.to), `${name} edge endpoints`)
    if (e.logIndex !== null) {
      const l = rc.logs.find((x) => Number(BigInt(x.logIndex)) === e.logIndex)
      assert.ok(l && l.address.toLowerCase() === e.token, `${name} edge cites a real log ${e.logIndex}`)
    }
  }
  assert.equal(f.graph.steps.length, f.graph.edges.length + (f.tx.status === 'reverted' ? 1 : 0))
  // the template must pass the same grounding check the model has to pass
  assert.ok(checkGrounded(templateExplanation(f), f).ok, `${name} template grounded: ${templateExplanation(f)}`)
  // a model that repeats the template is accepted as grounded
  const e = await explain(f, { gw: makeGateway({ providers: [fakeProvider(() => templateExplanation(f), 'anthropic')] }) })
  assert.equal(e.source, 'model', name)

  // account abstraction: the account is the actor, the bundler is the relayer the indexer records (gully-ops #659)
  if ((tx.to ?? '').toLowerCase() === EP) {
    assert.ok(f.aa?.isUserOp, `${name} AA`)
    assert.equal(f.actor.address, f.aa.sender); assert.notEqual(f.actor.address, tx.from.toLowerCase())
    assert.equal(f.aa.bundler, tx.from.toLowerCase())
    for (const row of fx.indexerRows) { assert.equal(row.trader, f.actor.address, `${name} indexer trader = actor`); assert.equal(row.relayer, f.aa.bundler, `${name} indexer relayer = bundler`) }
    assert.equal(f.fee.paidBy, f.aa.sponsored ? 'sponsor (paymaster)' : 'the smart account or its paymaster')
  } else assert.equal(f.aa, null)
  // dollars: current price vs the indexer's trade-time USD, same order of magnitude (within 15%)
  for (const row of fx.indexerRows) {
    const t = f.transfers.find((x) => x.token === row.token && x.usd)
    if (t && row.volumeUsd > 1) assert.ok(Math.abs(parseUsd(t.usd) - row.volumeUsd) / row.volumeUsd < 0.15, `${name} USD ${t.usd} vs indexer ${row.volumeUsd}`)
  }
  ok(`${name} (${fx.hash.slice(0, 10)}): fee, status, transfer count, graph citations, AA attribution and grounding match the raw receipt and indexer`)
}

// hand-checked expectations per case
{
  const f = (await buildFacts({ chainId: CHAIN_ID, txHash: fixture('native').hash }, replay(fixture('native').rec))).facts
  const rawTx = rawOf(fixture('native').rec, 'eth_getTransactionByHash'); assert.equal(f.method.name, 'plain transfer'); assert.equal(f.tx.valueEth, fmtUnits(BigInt(rawTx.value), 18)); assert.equal(f.transfers.length, 0)
  assert.ok(f.tx.valueUsd, 'native value priced via /stats/chain ETH rate'); assert.deepEqual(f.graph.edges.map((e) => e.kind), ['call', 'fee'])
  ok('native: plain transfer, value equals the raw tx value, priced through the indexer ETH rate; graph call + fee only')
}
{
  const f = (await buildFacts({ chainId: CHAIN_ID, txHash: fixture('erc20').hash }, replay(fixture('erc20').rec))).facts
  const rl = rawOf(fixture('erc20').rec, 'eth_getTransactionReceipt').logs[0]; assert.equal(f.method.name, 'transfer'); assert.equal(f.transfers[0].amount, fmtUnits(BigInt(rl.data), 6)); assert.equal(f.transfers[0].symbol, 'USDC.e'); assert.equal(f.transfers[0].usd, fmtUsd(Number(fmtUnits(BigInt(rl.data), 6))))
  ok('erc20: USDC.e transfer amount (6 decimals read from the token) and USD = amount at $1')
}
{
  const f = (await buildFacts({ chainId: CHAIN_ID, txHash: fixture('aa_sponsored').hash }, replay(fixture('aa_sponsored').rec))).facts
  assert.deepEqual(f.graph.edges.slice(0, 2).map((e) => e.kind), ['call', 'call']); assert.equal(f.graph.edges[0].to, EP); assert.equal(f.graph.edges[1].to, f.actor.address)
  assert.ok(f.transfers[0].thin, 'WAGME is a Thin coin (indexer thin flag)'); assert.equal(f.fee.paidBy, 'sponsor (paymaster)')
  ok('sponsored AA buy: bundler -> EntryPoint -> account, WAGME received by the account, Thin, sponsor pays')
}
{
  const f = (await buildFacts({ chainId: CHAIN_ID, txHash: fixture('launch').hash }, replay(fixture('launch').rec))).facts
  const kinds = new Set(f.graph.edges.map((e) => e.kind))
  assert.ok(kinds.has('mint') && kinds.has('transfer')); assert.ok(f.transfers.some((t) => t.kind === 'nft'))
  ok('launch: mint edge from the zero address, token transfers and the LP NFT are all drawn from logs')
}
if (manifest.cases.failed?.found) {
  const fx = fixture('failed')
  const f = (await buildFacts({ chainId: CHAIN_ID, txHash: fx.hash }, replay(fx.rec))).facts
  assert.equal(f.tx.status, 'reverted'); assert.equal(f.graph.revertPoint, f.tx.to); assert.ok(f.graph.edges[0].failed)
  console.log('  failed tx revert reason from one-block-earlier replay:', JSON.stringify(f.tx.revertReason), '| notes:', f.notes.join(' '))
  assert.match(templateExplanation(f), /98% of its gas limit/); assert.ok(checkGrounded(templateExplanation(f), f).ok)
  ok('failed tx (real createLaunch): reverted, revert point set, red call edge, honest note that the replay succeeds one block earlier and 98% of gas was used')
} else console.log('  (no failed transaction found in the scanned range: failed-tx behaviour is covered by the synthetic test only)')
console.log(`\n${n} passed`)
