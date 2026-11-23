// Writes a SYNTHETIC sample facts file (sponsored smart-account swap) for the <gully-tx-map> prototype.   node scripts/make-explain-sample.mjs <out.json>
import fs from 'node:fs'
import { buildFacts, explain } from '../server/ai/explain-tx.mjs'
import { keccak_256 } from '../server/vendor/noble.mjs'
const hex = (u) => Array.from(u, (b) => b.toString(16).padStart(2, '0')).join('')
const tp = (s) => '0x' + hex(keccak_256(new TextEncoder().encode(s)))
const pad = (a) => '0x' + a.slice(2).padStart(64, '0')
const w = (v) => BigInt(v).toString(16).padStart(64, '0')
const U = '0x3267000000000000000000000000000000dd03aa'.slice(0, 42), B = '0x2e9c0000000000000000000000000000000d0768', PM = '0x7a00000000000000000000000000000000005e11', POOL = '0x90ad000000000000000000000000000000d38f75', T1 = '0x1111000000000000000000000000000000000001', T2 = '0x2222000000000000000000000000000000000002', EP = '0x0000000071727de22e5e9d8baf0edac6f37da032', W = '0x26acccb2e98ca9e067e58668aa3b101bef432754'
const TR = tp('Transfer(address,address,uint256)')
const lg = (t, f, to, v, i) => ({ address: t, topics: [TR, pad(f), pad(to)], data: '0x' + w(v), logIndex: '0x' + i.toString(16) })
const uo = { address: EP, topics: [tp('UserOperationEvent(bytes32,address,address,uint256,bool,uint256,uint256)'), '0x' + '9'.repeat(64), pad(U), pad(PM)], data: '0x' + w(0) + w(1) + w(5) + w(6), logIndex: '0x4' }
const hash = '0x' + 'ab'.repeat(32)
const str = (s) => '0x' + w(32) + w(s.length) + Buffer.from(s).toString('hex').padEnd(64, '0')
const deps = {
  rpc: async (m, p) => m === 'eth_getTransactionByHash' ? { from: B, to: EP, input: '0x1fad948c00', value: '0x0' } : m === 'eth_getTransactionReceipt' ? { status: '0x1', blockNumber: '0x1f4a2', gasUsed: '0x30d40', effectiveGasPrice: '0x77359400', logs: [lg(T1, U, POOL, 25n * 10n ** 18n, 1), lg(T2, POOL, U, 24_100_000n, 3), uo] } : p[0].data === '0x95d89b41' ? str(p[0].to === T1 ? 'GULL' : 'USDC.e') : '0x' + w(p[0].to === T2 ? 6 : 18),
  abi: async () => null,
  price: async (a) => ({ [W]: { usd: 2000, liquidityUsd: 1e6 }, [T1]: { usd: 0.98, liquidityUsd: 90000 }, [T2]: { usd: 1, liquidityUsd: 300 } })[a] ?? null,
}
const r = await buildFacts({ chainId: 485590, txHash: hash }, deps)
const { allowedNumbers, ...facts } = r.facts
const ex = await explain(r.facts, { gw: { run: async () => { throw new Error('sample: no model') } } })
fs.writeFileSync(process.argv[2], JSON.stringify({ sample: true, label: 'Sample', explanation: ex.text, facts }, null, 1))
