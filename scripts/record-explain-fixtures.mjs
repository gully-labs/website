// Records REAL Gully Chain testnet data for the explain-tx tests. Public chain data only (receipts, logs, Sourcify ABIs,
// indexer token records); no keys, no auth headers. Run it from a box that reaches the keyless gateway:
//   EXPLAIN_RPC_URL=https://rpc.gullyrpc.xyz/gully-internal/evm/485590 node scripts/record-explain-fixtures.mjs <outDir> [scanBlocks=4000]
// Writes <outDir>/<case>.json (every dependency answer buildFacts used, so tests replay exactly), probes.json (which RPC
// methods the gateway supports) and manifest.json (which cases were found).
import fs from 'node:fs'
import path from 'node:path'
import { buildFacts, realDeps, CHAIN_ID } from '../server/ai/explain-tx.mjs'
import { keccak_256 } from '../server/vendor/noble.mjs'
const T_USEROP = '0x' + Array.from(keccak_256(new TextEncoder().encode('UserOperationEvent(bytes32,address,address,uint256,bool,uint256,uint256)')), (x) => x.toString(16).padStart(2, '0')).join('')

const out = process.argv[2]
const SCAN = Number(process.argv[3]) || 4000
const SKIP = Number(process.env.SCAN_SKIP) || 0 // start this many blocks below the head (look further back)
const ONLY = process.env.ONLY ? process.env.ONLY.split(',') : null // record only these cases and merge into manifest.json
if (!out) throw new Error('usage: record-explain-fixtures.mjs <outDir> [scanBlocks]')
fs.mkdirSync(out, { recursive: true })
const RPC = process.env.EXPLAIN_RPC_URL || 'https://rpc.gullyrpc.xyz/gully-internal/evm/485590'
const IDX = (process.env.GULLY_INDEXER || 'https://indexer.gullychain.xyz').replace(/\/+$/, '')
const EP = '0x0000000071727de22e5e9d8baf0edac6f37da032'
const T_TRANSFER = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'
let id = 0
const raw = async (method, params) => {
  const r = await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }), signal: AbortSignal.timeout(15000) })
  return r.json().catch(() => ({ error: { message: 'bad json', http: r.status } }))
}
const rpc = async (m, p) => {
  const j = await raw(m, p)
  if (j.error) throw Object.assign(new Error(j.error.message), { data: j.error.data })
  return j.result
}
const get = async (u) => {
  const r = await fetch(u, { signal: AbortSignal.timeout(10000) })
  return r.ok ? r.json() : null
}
const pool = async (items, n, fn) => {
  const res = []
  let i = 0
  await Promise.all(Array.from({ length: n }, async () => { for (;;) { const k = i++; if (k >= items.length) return; res[k] = await fn(items[k]).catch(() => null) } }))
  return res
}

// 1. probes: what does the gateway support
const probes = {}
const short = (j) => (j.error ? { error: { code: j.error.code, message: String(j.error.message).slice(0, 160), reason: j.error.data?.cause?.[0]?.cause?.code ?? j.error.data?.details?.rule ?? null } } : { ok: JSON.stringify(j.result).slice(0, 160) })
const head = Number(BigInt(await rpc('eth_blockNumber', [])))
probes.head = head
probes.debug_traceTransaction = short(await raw('debug_traceTransaction', ['0x' + 'ab'.repeat(32), { tracer: 'callTracer' }]))
probes.trace_transaction = short(await raw('trace_transaction', ['0x' + 'ab'.repeat(32)]))
probes.eth_simulateV1 = short(await raw('eth_simulateV1', [{ blockStateCalls: [{ calls: [{ to: '0x' + '11'.repeat(20), data: '0x' }] }] }, 'latest']))
probes.eth_getBlockReceipts = short(await raw('eth_getBlockReceipts', ['0x' + Math.max(1, head - 5).toString(16)]))
// state override proof: put code that returns 42 at an empty address; a supporting node answers ...2a
const ov = await raw('eth_call', [{ to: '0x' + '22'.repeat(20), data: '0x' }, 'latest', { ['0x' + '22'.repeat(20)]: { code: '0x602a60005260206000f3' } }])
probes.eth_call_state_override = ov.error ? short(ov) : { ok: ov.result, supported: /2a$/.test(ov.result) }
if (!ONLY) fs.writeFileSync(path.join(out, 'probes.json'), JSON.stringify(probes, null, 1))

// 2. scan recent blocks for candidates
const blocks = Array.from({ length: Math.max(0, Math.min(SCAN, head - SKIP)) }, (_, i) => head - SKIP - i)
const found = { native: null, erc20: null, failed: null, aaSponsored: null, multi: null }
const scanOne = async (n) => {
  const hx = '0x' + n.toString(16)
  const [b, rc] = await Promise.all([rpc('eth_getBlockByNumber', [hx, true]), rpc('eth_getBlockReceipts', [hx])])
  if (!b?.transactions?.length) return
  const by = new Map(rc.map((r) => [r.transactionHash, r]))
  for (const t of b.transactions) {
    const r = by.get(t.hash)
    if (!r) continue
    const tt = (r.logs ?? []).filter((l) => l.topics?.[0] === T_TRANSFER && l.topics.length === 3)
    const toEp = (t.to ?? '').toLowerCase() === EP
    if (!found.native && t.input === '0x' && BigInt(t.value) > 0n && r.status === '0x1' && !toEp) found.native = t.hash
    if (!found.erc20 && t.input.startsWith('0xa9059cbb') && r.status === '0x1' && tt.length === 1 && !toEp) found.erc20 = t.hash
    if (!found.failed && r.status === '0x0' && !toEp && t.to) found.failed = t.hash
    if (!found.aaSponsored && toEp && r.status === '0x1' && tt.length >= 1 && r.logs.some((l) => l.topics?.[0] === T_USEROP && !/^0x0*$/.test(l.topics[3] ?? '0x0'))) found.aaSponsored = t.hash
    if (!found.multi && !toEp && r.status === '0x1' && tt.length >= 3) found.multi = t.hash
  }
}
await pool(blocks, 3, scanOne)

// 3. indexer-driven cases: a direct (non-AA) swap, an AA swap, a launch
const tokens = (await get(`${IDX}/tokens?limit=40`))?.tokens ?? []
const prev = ONLY && fs.existsSync(path.join(out, 'manifest.json')) ? JSON.parse(fs.readFileSync(path.join(out, 'manifest.json'), 'utf8')) : null
const manifest = prev ?? { recordedAt: new Date().toISOString(), head, scanned: blocks.length, cases: {} }
let swap = null, aaSwap = null
for (const t of tokens.slice(0, 12)) {
  const tr = (await get(`${IDX}/tokens/${t.address}/trades?limit=40`))?.trades ?? []
  for (const x of tr) {
    if (!swap && !x.relayer) swap = x.txHash
    if (!aaSwap && x.relayer) aaSwap = x.txHash
  }
  if (swap && aaSwap) break
}
const launch = tokens.find((t) => t.launchTx)?.launchTx ?? null
const cases = { native: found.native, erc20: found.erc20, failed: process.env.FAILED_HASH ?? found.failed, aa_sponsored: found.aaSponsored, multi_transfer: found.multi, swap, aa_swap: aaSwap, launch }

// 4. record each case: every dependency answer buildFacts uses
for (const [name, hash] of Object.entries(cases)) {
  if (ONLY && !ONLY.includes(name)) continue
  if (!hash) { manifest.cases[name] = { found: false }; continue }
  const real = realDeps()
  const rec = { rpc: [], abi: {}, price: {}, ethUsd: undefined }
  const deps = {
    rpc: async (m, p) => {
      try { const r = await real.rpc(m, p); rec.rpc.push({ m, p, result: r }); return r } catch (e) { rec.rpc.push({ m, p, error: { message: e.message, data: e.data ?? null } }); throw e }
    },
    abi: async (a) => (rec.abi[a] = await real.abi(a)),
    price: async (a) => (rec.price[a] = await real.price(a)),
    ethUsd: async () => (rec.ethUsd = await real.ethUsd()),
  }
  const r = await buildFacts({ chainId: CHAIN_ID, txHash: hash }, deps)
  // public indexer rows for hand checks (USD at trade time, relayer)
  const actor = r.facts?.actor?.address
  const rows = actor ? ((await get(`${IDX}/accounts/${actor}/trades?limit=100`))?.trades ?? []).filter((x) => x.txHash === hash) : []
  fs.writeFileSync(path.join(out, `${name}.json`), JSON.stringify({ case: name, hash, recordedAt: manifest.recordedAt, ok: r.ok, code: r.code ?? null, indexerRows: rows, rec, facts: r.facts ?? null }, null, 1))
  manifest.cases[name] = { found: true, hash, ok: r.ok, status: r.facts?.tx.status, method: r.facts?.method.name, aa: !!r.facts?.aa, transfers: r.facts?.transfers.length, revertReason: r.facts?.tx.revertReason ?? null }
}
fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify(manifest, null, 1))
console.log(JSON.stringify(manifest, null, 1))
