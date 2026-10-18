// Holder Map launchpad detection (server/holders-launchpads.mjs), offline: the Peddles and PeddleSwap APIs and the
// RPCs are stubs, so no call leaves the machine. Covers both venues, every holder chain, the archive-RPC creation
// block, the PoolRegistered fallback, caching (positive, negative, failure), the call bounds and failing safe to null.
// Run: npm run test:launchpads
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

Object.assign(process.env, { GULLY_RPC_4663: 'https://rpc4663.test', GULLY_RPC_8453: 'https://rpc8453.test', GULLY_RPC_56: 'https://rpc56.test', GULLY_RPC_999: 'https://rpc999.test', PEDDLES_API: 'https://pd.test/api/v1' })

const H = await import('../server/holders.mjs')
const L = await import('../server/holders-launchpads.mjs')
const LG = await import('../server/holders-logs.mjs')
const { keccak256, toHex } = await import('viem')
const reg = (id) => L.LAUNCHPADS.find((l) => l.id === id)

const addr = (n) => '0x' + n.toString(16).padStart(40, '0')
const TOKEN = addr(0xabc)
const CREATOR = addr(0xc0ffee)
const LAUNCH_BLOCK = 86_310_714

let calls
let routes
const json = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body })

/** One stub for the APIs and the JSON-RPC nodes. `routes` maps a URL to a response, an Error, or (rpc) a handler. */
async function stub(url, init = {}) {
  calls.push(String(url))
  if (init.method === 'POST') {
    const b = JSON.parse(init.body)
    calls.push(`rpc ${b.method}`)
    const h = routes.rpc?.(b, String(url))
    if (h && typeof h === 'object' && !Array.isArray(h) && 'error' in h) return json(200, { jsonrpc: '2.0', id: 1, error: h.error })
    return json(200, { jsonrpc: '2.0', id: 1, result: h })
  }
  const h = routes[String(url)]
  if (!h) throw new Error(`unstubbed ${url}`)
  if (h instanceof Error) throw h
  return json(h.status, h.body)
}

/** A node with archive state: code exists from `born`; one PoolRegistered log in block `born` when `log` is set. */
const archiveNode = ({ born = LAUNCH_BLOCK, head = 90_000_000, log = null } = {}) => (b) => {
  if (b.method === 'eth_blockNumber') return '0x' + head.toString(16)
  if (b.method === 'eth_getBalance') return '0x0'
  if (b.method === 'eth_getCode') return parseInt(b.params[1], 16) >= born ? '0x6080' : '0x'
  if (b.method === 'eth_getLogs') {
    const f = b.params[0]
    if (!log || f.fromBlock !== '0x' + born.toString(16)) return []
    return [{ topics: f.topics, data: '0x' + '0'.repeat(24) + log.slice(2) + '0'.repeat(64 * 4), blockNumber: f.fromBlock }]
  }
  return { error: { code: -32601, message: 'nope' } }
}

const peddlesTok = (over = {}) => ({ status: 200, body: { success: true, data: { chainId: 4663, address: TOKEN, kind: 'LAUNCH', creatorAddress: CREATOR, ...over } } })
const notFound = { status: 404, body: { success: false, data: null, error: { code: 'NOT_FOUND' } } }
const psMiss = (api, t = TOKEN) => (routes[`${api}/v1/launches/${t}`] = { status: 404, body: { error: 'not_found' } })

beforeEach(() => {
  calls = []
  routes = {}
  L.resetLaunchpadsForTest()
  LG.resetLogsForTest()
  L.setLaunchpadsFetchForTest(stub)
  H.setHoldersFetchForTest(stub)
})

test('constants: the topic is the seven-field PoolRegistered and every chain id matches HOLDER_CHAINS', () => {
  assert.equal(L.POOL_REGISTERED_TOPIC, '0xebfb244f562bae7d4ca6f8de1634c1681f434c280488827a5e5e402cba3dbe26')
  assert.deepEqual(L.LAUNCHPADS.map((l) => l.id), ['peddles', 'peddleswap'])
  for (const lp of L.LAUNCHPADS) for (const [k, c] of Object.entries(lp.chains)) assert.equal(c.chainId, H.HOLDER_CHAINS[k].id, `${lp.id} ${k}`)
  for (const c of Object.values(reg('peddles').chains)) {
    assert.match(c.factory, /^0x[0-9a-f]{40}$/)
    assert.match(c.pool, /^0x[0-9a-f]{40}$/)
  }
  assert.equal(keccak256(toHex(reg('peddles').event.signature)), reg('peddles').event.topic0, 'topic0 is the keccak of the signature')
})

test('Peddles launch on Robinhood: API creator + archive creation block + the v4 PoolManager as pool', async () => {
  routes[`https://pd.test/api/v1/tokens/4663/${TOKEN}`] = peddlesTok()
  psMiss('https://api.peddleswap.xyz')
  routes.rpc = archiveNode()
  const r = await L.knownLaunch('robinhood', TOKEN.toUpperCase().replace('0X', '0x'))
  assert.deepEqual(r, { venue: 'peddles', chainId: 4663, token: TOKEN, creationBlock: LAUNCH_BLOCK, deployer: CREATOR, pool: reg('peddles').chains.robinhood.pool })
})

test('Peddles on Base and BNB Chain use their own chain id and PoolManager', async () => {
  routes[`https://pd.test/api/v1/tokens/8453/${TOKEN}`] = peddlesTok({ chainId: 8453 })
  psMiss('https://api-base.peddleswap.xyz')
  routes.rpc = archiveNode({ born: 51_900_000, head: 52_000_000 })
  const b = await L.knownLaunch('base', TOKEN)
  assert.deepEqual([b.venue, b.chainId, b.pool, b.creationBlock], ['peddles', 8453, '0x498581ff718922c3f8e6a244956af099b2652b2b', 51_900_000])
  routes[`https://pd.test/api/v1/tokens/56/${TOKEN}`] = peddlesTok({ chainId: 56 })
  routes.rpc = archiveNode({ born: 100, head: 200 })
  const s = await L.knownLaunch('bsc', TOKEN)
  assert.deepEqual([s.venue, s.chainId, s.pool, s.creationBlock], ['peddles', 56, '0x28e2ea090877bf75740558f6bfb36a5ffee9e9df', 100])
})

test('Peddles stock tokens are not launches, and 404 is not a Peddles token', async () => {
  routes[`https://pd.test/api/v1/tokens/4663/${TOKEN}`] = peddlesTok({ kind: 'STOCK', creatorAddress: null })
  psMiss('https://api.peddleswap.xyz')
  assert.equal(await L.knownLaunch('robinhood', TOKEN), null)
  L.resetLaunchpadsForTest()
  routes[`https://pd.test/api/v1/tokens/4663/${TOKEN}`] = notFound
  assert.equal(await L.knownLaunch('robinhood', TOKEN), null)
})

test('Peddles without an archive RPC: still a launch with creationBlock null', async () => {
  routes[`https://pd.test/api/v1/tokens/4663/${TOKEN}`] = peddlesTok()
  psMiss('https://api.peddleswap.xyz')
  routes.rpc = () => ({ error: { code: -32602, message: 'Archive requests require a personal token' } })
  const r = await L.knownLaunch('robinhood', TOKEN)
  assert.deepEqual([r.venue, r.creationBlock, r.deployer], ['peddles', null, CREATOR])
})

test('Peddles API down: the creation block and the hook PoolRegistered log decide', async () => {
  routes[`https://pd.test/api/v1/tokens/4663/${TOKEN}`] = { status: 503, body: null }
  psMiss('https://api.peddleswap.xyz')
  routes.rpc = archiveNode({ log: CREATOR })
  const r = await L.knownLaunch('robinhood', TOKEN)
  assert.deepEqual([r.venue, r.creationBlock, r.deployer], ['peddles', LAUNCH_BLOCK, CREATOR])
  // no PoolRegistered in the creation block: not a Peddles launch
  L.resetLaunchpadsForTest()
  routes.rpc = archiveNode({ log: null })
  assert.equal(await L.knownLaunch('robinhood', TOKEN), null)
  // API down and no archive: unknown, so null
  L.resetLaunchpadsForTest()
  routes.rpc = () => ({ error: { code: -32011, message: 'request limit reached' } })
  assert.equal(await L.knownLaunch('robinhood', TOKEN), null)
})

test('PeddleSwap launch on Robinhood and Base: block and creator from /v1/launches, pool from the directory', async () => {
  const pool = addr(0x9001)
  for (const [ck, api, id] of [['robinhood', 'https://api.peddleswap.xyz', 4663], ['base', 'https://api-base.peddleswap.xyz', 8453]]) {
    L.resetLaunchpadsForTest()
    routes[`https://pd.test/api/v1/tokens/${id}/${TOKEN}`] = notFound
    routes[`${api}/v1/launches/${TOKEN}`] = { status: 200, body: { launch: { chainId: id, address: TOKEN, creator: CREATOR, blockNumber: '123456', txHash: '0xab' } } }
    routes[`${api}/v1/token-directory/${TOKEN}`] = { status: 200, body: { token: { market: { pool } } } }
    assert.deepEqual(await L.knownLaunch(ck, TOKEN), { venue: 'peddleswap', chainId: id, token: TOKEN, creationBlock: 123456, deployer: CREATOR, pool }, ck)
  }
})

test('PeddleSwap: no market means no pool key; a directory failure keeps the launch; a wrong chain is null', async () => {
  const api = 'https://api.peddleswap.xyz'
  routes[`https://pd.test/api/v1/tokens/4663/${TOKEN}`] = notFound
  routes[`${api}/v1/launches/${TOKEN}`] = { status: 200, body: { launch: { chainId: 4663, address: TOKEN, creator: CREATOR, blockNumber: '77' } } }
  routes[`${api}/v1/token-directory/${TOKEN}`] = { status: 200, body: { token: { market: null } } }
  assert.equal('pool' in (await L.knownLaunch('robinhood', TOKEN)), false)
  L.resetLaunchpadsForTest()
  routes[`${api}/v1/token-directory/${TOKEN}`] = new Error('boom')
  assert.equal((await L.knownLaunch('robinhood', TOKEN)).creationBlock, 77)
  L.resetLaunchpadsForTest()
  routes[`${api}/v1/launches/${TOKEN}`] = { status: 200, body: { launch: { chainId: 8453, address: TOKEN, creator: CREATOR, blockNumber: '77' } } }
  assert.equal(await L.knownLaunch('robinhood', TOKEN), null)
})

test('chains without either venue, bad input and unknown chains never touch the network', async () => {
  for (const [ck, t] of [['hyperevm', TOKEN], ['solana', 'So11111111111111111111111111111111111111112'], ['nope', TOKEN], ['base', 'not-an-address'], ['base', undefined], [undefined, TOKEN]]) {
    assert.equal(await L.knownLaunch(ck, t), null, String(ck))
  }
  assert.equal(calls.length, 0)
})

test('upstream failures return null and never throw', async () => {
  routes[`https://pd.test/api/v1/tokens/4663/${TOKEN}`] = new Error('ECONNRESET')
  routes[`https://api.peddleswap.xyz/v1/launches/${TOKEN}`] = new Error('ECONNRESET')
  routes.rpc = archiveNode()
  assert.equal(await L.knownLaunch('robinhood', TOKEN), null)
  L.resetLaunchpadsForTest()
  routes[`https://pd.test/api/v1/tokens/4663/${TOKEN}`] = { status: 500, body: 'x' }
  routes[`https://api.peddleswap.xyz/v1/launches/${TOKEN}`] = { status: 502, body: null }
  routes.rpc = () => ({ error: { message: 'down' } })
  assert.equal(await L.knownLaunch('robinhood', TOKEN), null)
})

test('cache: a positive and a negative are kept, a failure is cached only briefly, concurrent callers share one lookup', async () => {
  routes[`https://pd.test/api/v1/tokens/4663/${TOKEN}`] = peddlesTok()
  psMiss('https://api.peddleswap.xyz')
  routes.rpc = archiveNode()
  const [a, b] = await Promise.all([L.knownLaunch('robinhood', TOKEN), L.knownLaunch('robinhood', TOKEN)])
  assert.deepEqual(a, b)
  assert.equal(calls.filter((c) => c.includes('/tokens/4663/')).length, 1, 'one API call for two callers')
  const n = calls.length
  assert.deepEqual(await L.knownLaunch('robinhood', TOKEN), a)
  assert.equal(calls.length, n, 'served from cache')

  const other = addr(0xdef)
  routes[`https://pd.test/api/v1/tokens/4663/${other}`] = notFound
  psMiss('https://api.peddleswap.xyz', other)
  assert.equal(await L.knownLaunch('robinhood', other), null)
  const m = calls.length
  assert.equal(await L.knownLaunch('robinhood', other), null)
  assert.equal(calls.length, m, 'a negative is cached')

  // a failure is cached too (30 s), so a dead upstream is not hammered
  const flaky = addr(0x123)
  routes[`https://pd.test/api/v1/tokens/4663/${flaky}`] = new Error('down')
  routes[`https://api.peddleswap.xyz/v1/launches/${flaky}`] = new Error('down')
  assert.equal(await L.knownLaunch('robinhood', flaky), null)
  const k = calls.length
  assert.equal(await L.knownLaunch('robinhood', flaky), null)
  assert.equal(calls.length, k)
})

test('bounds: at most 120 uncached lookups a minute, then null without calling upstream', async () => {
  routes.rpc = archiveNode()
  for (let i = 1; i <= 121; i++) {
    routes[`https://pd.test/api/v1/tokens/4663/${addr(i)}`] = notFound
    psMiss('https://api.peddleswap.xyz', addr(i))
  }
  for (let i = 1; i <= 120; i++) await L.knownLaunch('robinhood', addr(i))
  const n = calls.length
  assert.equal(await L.knownLaunch('robinhood', addr(121)), null)
  assert.equal(calls.length, n, 'the 121st lookup did not leave the machine')
})

// ---- the registry: a declarative entry per launchpad, exercised with fake entries of each lookup type ----

const FAKE_API = {
  id: 'fakeapi',
  name: 'FakeAPI Pad',
  url: 'https://fakeapi.test',
  lookup: 'api',
  api: { base: 'https://api.fakeapi.test', path: '/launch/{chainId}/{token}', fields: { chainId: 'network', address: 'token.addr', creator: 'meta.by', block: 'meta.block' }, pool: { path: '/pool/{token}', field: 'pair' } },
  chains: { hyperevm: { chainId: 999 } },
}
const FAKE_EVENT_SIG = 'TokenLaunched(address,address,uint256)'
const FAKE_FACTORY = addr(0xfac7)
const FAKE_EVENT = {
  id: 'fakefactory',
  name: 'FakeFactory Pad',
  url: 'https://fakefactory.test',
  lookup: 'factory-event',
  event: { signature: FAKE_EVENT_SIG, topic0: keccak256(toHex(FAKE_EVENT_SIG)), token: { topic: 1 }, creator: { topic: 2 } },
  chains: { hyperevm: { chainId: 999, factory: FAKE_FACTORY, pool: addr(0x9009) } },
}

test('listLaunchpads: public metadata only, in registry order', () => {
  const l = L.listLaunchpads()
  assert.deepEqual(l.map((x) => x.id), ['peddles', 'peddleswap'])
  assert.deepEqual(Object.keys(l[0]).sort(), ['chains', 'id', 'name', 'url'])
  assert.deepEqual(l[0].chains.map((c) => c.key), ['robinhood', 'base', 'bsc'])
  assert.deepEqual(l[1].chains, [{ key: 'robinhood', id: 4663, name: 'Robinhood Chain' }, { key: 'base', id: 8453, name: 'Base' }])
  assert.equal(JSON.stringify(l).includes('factory'), false)
  assert.equal(JSON.stringify(l).includes('0xfe05'), false)
  L.setLaunchpadsForTest([FAKE_API, FAKE_EVENT])
  assert.deepEqual(L.listLaunchpads().slice(2).map((x) => [x.id, x.chains[0].key]), [['fakeapi', 'hyperevm'], ['fakefactory', 'hyperevm']])
  L.setLaunchpadsForTest()
})

test('validateLaunchpad: the built-ins and both fakes are valid; broken entries say why', () => {
  for (const e of [...L.LAUNCHPADS, FAKE_API, FAKE_EVENT]) assert.deepEqual(L.validateLaunchpad(e), [], e.id)
  assert.match(L.validateLaunchpad({ ...FAKE_API, id: 'X' }).join(), /id/)
  assert.match(L.validateLaunchpad({ ...FAKE_API, url: 'http://x.test' }).join(), /url/)
  assert.match(L.validateLaunchpad({ ...FAKE_API, chains: { hyperevm: { chainId: 1 } } }).join(), /chainId must be 999/)
  assert.match(L.validateLaunchpad({ ...FAKE_API, chains: { solana: { chainId: 'solana' } } }).join(), /not an EVM/)
  assert.match(L.validateLaunchpad({ ...FAKE_EVENT, chains: { hyperevm: { chainId: 999 } } }).join(), /factory must be an address/)
  assert.match(L.validateLaunchpad({ ...FAKE_EVENT, event: { ...FAKE_EVENT.event, topic0: '0x12' } }).join(), /topic0/)
  assert.match(L.validateLaunchpad({ ...FAKE_API, lookup: 'rpc' }).join(), /lookup/)
  assert.throws(() => L.setLaunchpadsForTest([FAKE_API, FAKE_API]), /duplicate id/)
  L.setLaunchpadsForTest()
})

test('fake api launchpad: dotted field mapping, API block (no archive call), dynamic pool, wrong chain or address is null', async () => {
  L.setLaunchpadsForTest([FAKE_API])
  const pool = addr(0x7001)
  const url = `https://api.fakeapi.test/launch/999/${TOKEN}`
  routes[url] = { status: 200, body: { network: 999, token: { addr: TOKEN.toUpperCase().replace('0X', '0x') }, meta: { by: CREATOR, block: 4242 } } }
  routes[`https://api.fakeapi.test/pool/${TOKEN}`] = { status: 200, body: { pair: pool } }
  const r = await L.knownLaunch('hyperevm', TOKEN)
  assert.deepEqual(r, { venue: 'fakeapi', chainId: 999, token: TOKEN, creationBlock: 4242, deployer: CREATOR, pool })
  assert.equal(calls.some((c) => c.startsWith('rpc ')), false, 'a block in the API means no RPC call')
  L.resetLaunchpadsForTest()
  routes[url].body.network = 8453
  assert.equal(await L.knownLaunch('hyperevm', TOKEN), null)
  L.resetLaunchpadsForTest()
  routes[url] = notFound
  assert.equal(await L.knownLaunch('hyperevm', TOKEN), null)
  L.resetLaunchpadsForTest()
  routes[url] = { status: 500, body: null }
  assert.equal(await L.knownLaunch('hyperevm', TOKEN), null, 'API down and no event declared: unknown, so null')
  L.setLaunchpadsForTest()
})

test('fake api launchpad: require, okField and the archive creation block when the API names none', async () => {
  const e = { ...FAKE_API, api: { ...FAKE_API.api, root: 'data', okField: 'ok', require: { field: 'type', equals: 'launch' }, fields: { chainId: 'chain', address: 'address', creator: 'owner' }, pool: undefined } }
  L.setLaunchpadsForTest([e])
  const url = `https://api.fakeapi.test/launch/999/${TOKEN}`
  const data = { chain: 999, address: TOKEN, owner: CREATOR, type: 'launch' }
  routes[url] = { status: 200, body: { ok: true, data } }
  routes.rpc = archiveNode({ born: 555, head: 1000 })
  const r = await L.knownLaunch('hyperevm', TOKEN)
  assert.deepEqual(r, { venue: 'fakeapi', chainId: 999, token: TOKEN, creationBlock: 555, deployer: CREATOR })
  L.resetLaunchpadsForTest()
  routes[url] = { status: 200, body: { ok: true, data: { ...data, type: 'listing' } } }
  assert.equal(await L.knownLaunch('hyperevm', TOKEN), null, 'require.equals not met')
  L.resetLaunchpadsForTest()
  routes[url] = { status: 200, body: { ok: false, data } }
  assert.equal(await L.knownLaunch('hyperevm', TOKEN), null, 'okField falsy counts as API down')
  L.setLaunchpadsForTest()
})

test('fake factory-event launchpad: creation block, then the event (token at topic 1, creator at topic 2)', async () => {
  L.setLaunchpadsForTest([FAKE_EVENT])
  const asTopic = (a) => '0x' + '0'.repeat(24) + a.slice(2)
  let filter
  routes.rpc = (b) => {
    if (b.method !== 'eth_getLogs') return archiveNode({ born: 777, head: 1000 })(b)
    filter = b.params[0]
    if (filter.fromBlock !== '0x309') return []
    return [{ topics: [FAKE_EVENT.event.topic0, asTopic(TOKEN), asTopic(CREATOR)], data: '0x' + '0'.repeat(64), blockNumber: filter.fromBlock }]
  }
  const r = await L.knownLaunch('hyperevm', TOKEN)
  assert.deepEqual(r, { venue: 'fakefactory', chainId: 999, token: TOKEN, creationBlock: 777, deployer: CREATOR, pool: addr(0x9009) })
  assert.equal(filter.address, FAKE_FACTORY)
  assert.deepEqual(filter.topics, [FAKE_EVENT.event.topic0, asTopic(TOKEN)], 'the token filter sits at topic 1')
  // no event in the creation block: not a launch of this pad
  L.resetLaunchpadsForTest()
  routes.rpc = (b) => (b.method === 'eth_getLogs' ? [] : archiveNode({ born: 777, head: 1000 })(b))
  assert.equal(await L.knownLaunch('hyperevm', TOKEN), null)
  // no archive RPC: unknown, so null
  L.resetLaunchpadsForTest()
  routes.rpc = () => ({ error: { code: -32011, message: 'request limit reached' } })
  assert.equal(await L.knownLaunch('hyperevm', TOKEN), null)
  L.setLaunchpadsForTest()
})

test('fake factory-event launchpad: creator from a data word; two pads claiming one token resolve by registry order', async () => {
  const E = { ...FAKE_EVENT, event: { ...FAKE_EVENT.event, token: { topic: 3 }, creator: { word: 1 } } }
  L.setLaunchpadsForTest([E, FAKE_API])
  const asTopic = (a) => '0x' + '0'.repeat(24) + a.slice(2)
  routes.rpc = (b) => {
    if (b.method !== 'eth_getLogs' || b.params[0].address !== FAKE_FACTORY) return archiveNode({ born: 777, head: 1000 })(b)
    assert.deepEqual(b.params[0].topics, [E.event.topic0, null, null, asTopic(TOKEN)])
    return [{ topics: [], data: '0x' + '0'.repeat(64) + '0'.repeat(24) + CREATOR.slice(2) }]
  }
  routes[`https://api.fakeapi.test/launch/999/${TOKEN}`] = { status: 200, body: { network: 999, token: { addr: TOKEN }, meta: { by: addr(0xbad), block: 9 } } }
  routes[`https://api.fakeapi.test/pool/${TOKEN}`] = { status: 404, body: null }
  const r = await L.knownLaunch('hyperevm', TOKEN)
  assert.deepEqual([r.venue, r.deployer, r.creationBlock], ['fakefactory', CREATOR, 777])
  L.setLaunchpadsForTest()
})
