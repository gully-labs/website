// GET /api/chain/fee-history: base fee per gas over the last 128 blocks on the chains the Gully L3 could settle
// to (docs "Roadmap: Gully L3" chart). Read here with eth_feeHistory and cached 20 s, so visitors' browsers call
// only our own API, never a third-party RPC (audit P1-7). Errors are reduced to plain words; no RPC URL is sent.
// Env: GULLY_FEEHISTORY_RPC_<KEY> (ARBITRUM, BASE, ARBITRUMSEPOLIA) overrides a chain's public RPC.

const BLOCKS = 128
const CACHE_MS = 20_000
const TIMEOUT_MS = 8_000

const PARENTS = [
  { key: 'arbitrum', name: 'Arbitrum One', rpc: 'https://arb1.arbitrum.io/rpc', role: 'settlement candidate (recommended)' },
  { key: 'base', name: 'Base', rpc: 'https://mainnet.base.org', role: 'settlement candidate' },
  { key: 'arbitrumsepolia', name: 'Arbitrum Sepolia', rpc: 'https://sepolia-rollup.arbitrum.io/rpc', role: 'parent of the public devnet (S1)' },
]

const rpcOf = (p) => {
  const v = String(process.env[`GULLY_FEEHISTORY_RPC_${p.key.toUpperCase()}`] ?? '').trim()
  return /^https?:\/\//.test(v) ? v : p.rpc
}

async function readOne(p) {
  try {
    const r = await fetch(rpcOf(p), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_feeHistory', params: [`0x${BLOCKS.toString(16)}`, 'latest', []] }),
      redirect: 'manual',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    const j = await r.json().catch(() => null)
    const fees = j?.result?.baseFeePerGas
    if (!r.ok || !Array.isArray(fees) || !fees.length) return { gwei: [], newest: null, error: 'the chain did not answer' }
    // feeHistory returns one extra entry, the next block's base fee. Keep the mined blocks only.
    const mined = fees.slice(0, Math.max(1, fees.length - 1))
    const gwei = mined.map((h) => parseInt(h, 16) / 1e9).filter((v) => Number.isFinite(v))
    const oldest = j.result.oldestBlock ? parseInt(j.result.oldestBlock, 16) : NaN
    return { gwei, newest: Number.isFinite(oldest) ? oldest + mined.length - 1 : null, error: null }
  } catch (e) {
    return { gwei: [], newest: null, error: e?.name === 'TimeoutError' ? 'timed out' : 'unreachable' }
  }
}

let cache = null // { at, body }
let inflight = null

/** Every chain's series (or its own plain-words error), cached 20 s and read once at a time. */
export async function feeHistory(now = Date.now()) {
  if (cache && now - cache.at < CACHE_MS) return cache.body
  inflight ??= (async () => {
    const chains = await Promise.all(PARENTS.map(async (p) => ({ key: p.key, name: p.name, role: p.role, ...(await readOne(p)), at: new Date().toISOString() })))
    const body = { blocks: BLOCKS, chains }
    cache = { at: Date.now(), body }
    return body
  })().finally(() => (inflight = null))
  return inflight
}

/** Tests: forget the cache. */
export const resetFeeHistoryForTest = () => (cache = null)

export async function handleFeeHistory(req, res) {
  const head = { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=20', 'Access-Control-Allow-Origin': '*' }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { ...head, Allow: 'GET' })
    return res.end(JSON.stringify({ error: 'GET only' }))
  }
  const body = await feeHistory()
  res.writeHead(200, head)
  res.end(req.method === 'HEAD' ? undefined : JSON.stringify(body))
}
