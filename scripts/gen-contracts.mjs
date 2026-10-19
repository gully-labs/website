// Rebuilds the entry block of src/content/contracts.ts from the files that hold our addresses, and asks Sourcify
// which of them have verified source.
//
//   node scripts/gen-contracts.mjs            read the sources, ask Sourcify, rewrite the block
//   node scripts/gen-contracts.mjs --offline  reuse the Sourcify answers saved in scripts/fixtures/sourcify-cache.json
//
// Nothing is typed in here: every address is read out of the file named in `source` (sibling repos live next to this
// checkout under PROJECTS). A source file that is missing aborts the run. Needs the sibling repos and, unless
// --offline, network access.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { keccak_256 } from '../server/vendor/noble.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PROJECTS = path.resolve(ROOT, '..')
const OUT = path.join(ROOT, 'src/content/contracts.ts')
const CACHE = path.join(ROOT, 'scripts/fixtures/sourcify-cache.json')
const offline = process.argv.includes('--offline')

const CHAINS = {
  1: ['Ethereum', 'https://etherscan.io'],
  10: ['OP Mainnet', 'https://optimistic.etherscan.io'],
  56: ['BNB Chain', 'https://bscscan.com'],
  999: ['HyperEVM', 'https://hyperevmscan.io'],
  4663: ['Robinhood Chain', 'https://robin.etherscan.io'],
  5042: ['Arc', 'https://explorer.arc.io'],
  8453: ['Base', 'https://basescan.org'],
  42161: ['Arbitrum One', 'https://arbiscan.io'],
}

const repoDir = (repo) => (repo === 'website' ? ROOT : path.join(PROJECTS, repo))
function read(source) {
  const i = source.indexOf(':')
  const file = path.join(repoDir(source.slice(0, i)), source.slice(i + 1))
  if (!fs.existsSync(file)) throw new Error(`source file missing: ${source} (${file})`)
  return fs.readFileSync(file, 'utf8')
}

/** EIP-55. */
function checksum(a) {
  const lo = a.slice(2).toLowerCase()
  const h = Buffer.from(keccak_256(Buffer.from(lo, 'ascii'))).toString('hex')
  return '0x' + [...lo].map((c, i) => (parseInt(h[i], 16) >= 8 ? c.toUpperCase() : c)).join('')
}
const ADDR = /^0x[0-9a-fA-F]{40}$/
const ZERO = '0x' + '0'.repeat(40)

const label = (key) =>
  key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/^./, (c) => c.toUpperCase())
    .replace(/\b(Cl|Lp|Dca|Dex)\b/g, (w) => w.toUpperCase())
    .replace('LPLocker', 'LP Locker')
const entries = []
function add(e) {
  const address = checksum(e.address)
  const id = `${e.chainId}:${address.toLowerCase()}`
  if (entries.some((x) => x.id === id)) return
  const [chain, explorer] = CHAINS[e.chainId]
  entries.push({
    id,
    name: e.name,
    role: e.role,
    kind: e.kind ?? ['protocol'],
    project: e.project,
    chainId: e.chainId,
    chain,
    address,
    owner: e.owner ?? 'gully-labs',
    explorerUrl: `${explorer}/address/${address}`,
    verifiedSource: null,
    verification: null,
    audit: null,
    source: e.source,
    ...(e.note ? { note: e.note } : {}),
  })
}
const mustContain = (source, address) => {
  if (!read(source).toLowerCase().includes(address.toLowerCase())) throw new Error(`${source} does not contain ${address}`)
}

// ------------------------------------------------------------------------------------------ treasury Safe + fee address
const TREASURY = '0xCaf7C1ce6F234bED687264cBE6210a4ab5c12fd6'
for (const [chainId, source] of [
  [1, 'website:contracts/CHOICE.md'],
  [8453, 'website:contracts/CHOICE.md'],
  [56, 'website:contracts/CHOICE.md'],
  [42161, 'website:contracts/CHOICE.md'],
  [4663, 'peddles-quest:docs/mainnet-readiness.md'],
  [5042, 'peddles-quest:docs/mainnet-readiness.md'],
]) {
  mustContain(source, TREASURY)
  const pay = [1, 8453, 56, 42161].includes(chainId)
  add({
    chainId,
    address: TREASURY,
    name: 'Gully Labs: Treasury',
    role: pay
      ? 'Gully Labs treasury Safe (2-of-3, Safe 1.5.0). Receives plan payments and is the fee address (feeAddress) of every Gully Pay fee split.'
      : 'Gully Labs treasury Safe (2-of-3, Safe 1.5.0), the same address as on every other chain. Owner and treasury of the PeddleQuest contracts on this chain.',
    kind: pay ? ['treasury', 'fee-address'] : ['treasury'],
    project: 'Gully Labs',
    source,
    note: 'The same Safe address on every chain it is deployed on. Not deployed on OP Mainnet, Polygon or Avalanche (contracts/CHOICE.md).',
  })
}

// ------------------------------------------------------------------------------------------ Request Network fee proxies
const proxyText = read('website:contracts/CHOICE.md')
for (const [chainId, address] of [
  [1, '0x370DE27fdb7D1Ff1e1BaA7D11c5820a324Cf623C'],
  [8453, '0x1892196E80C4c17ea5100Da765Ab48c1fE2Fb814'],
  [56, '0x0DfbEe143b42B41eFC5A6F87bFD1fFC78c2f0aC9'],
  [42161, '0x0DfbEe143b42B41eFC5A6F87bFD1fFC78c2f0aC9'],
  [10, '0x399F5EE127ce7432E4921a61b8CF52b0af52cbfE'],
]) {
  if (!proxyText.includes(address)) throw new Error(`CHOICE.md lacks ${address}`)
  add({
    chainId,
    address,
    name: 'Request Network ERC20FeeProxy',
    role: 'Third-party contract, not ours. Gully Pay pays merchants through it: one call sends the merchant their share and the Gully Labs fee to the treasury, and it never holds tokens (no owner, no upgrade, no pause).',
    kind: ['fee-proxy'],
    project: 'Gully Labs',
    owner: 'third-party',
    source: 'website:contracts/CHOICE.md',
    note: 'Deployed and maintained by Request Network. Gully Labs only calls it. Source: github.com/RequestNetwork/requestNetwork.',
  })
}

// ------------------------------------------------------------------------------------------ DeepCore (SDK address book)
{
  const source = 'deepcore:packages/sdk/src/deployments/index.ts'
  const text = read(source)
  const SKIP = new Set(['permit2', 'weth', 'create3Factory', 'clPoolManagerOwner', 'binPoolManagerOwner'])
  const ROLE = {
    vault: 'The shared Vault that holds all pool liquidity for the chain. Immutable.',
    clPoolManager: 'Concentrated-liquidity pool manager of the core.',
    binPoolManager: 'Liquidity-bin pool manager of the core.',
    universalRouter: 'The router users trade through.',
    fillRouter: 'Best-price router across DeepCore pools and the major DEXes.',
    governanceSafe: 'The Safe that governs this chain deployment (owner of the registry and timelocks).',
    feeController: 'Sets and collects protocol fees within their caps.',
    registry: 'Registry of hosted Launchpads and DEXes.',
    launchRegistry: 'Registry of tokens launched on the core.',
    padFactory: 'Opens a hosted Launchpad or DEX in one transaction.',
    launchAndBuy: 'Launches a token and buys it in one transaction.',
    timelockCustody: 'Timelock in front of custody changes.',
    clLPLocker: 'Locks launch liquidity (concentrated) forever.',
    binLPLocker: 'Locks launch liquidity (bins) forever.',
  }
  const chainBlocks = [...text.matchAll(/\n {2}(\d+): \{\n {4}chainId: (\d+),\n {4}key: "(\w+)",\n {4}name: "([^"]+)",\n {4}explorer: "([^"]+)",\n {4}isMainnet: (\w+),/g)]
  const starts = chainBlocks.map((m) => m.index)
  chainBlocks.forEach((m, i) => {
    const chainId = Number(m[2])
    if (m[6] !== 'true') return
    if (!CHAINS[chainId]) throw new Error(`DeepCore chain ${chainId} unknown to the generator`)
    const block = text.slice(starts[i], starts[i + 1] ?? text.length)
    // Only the top-level and launchpadV2 fields; the token list and the revShareHooks history are left out.
    const head = block.split(/\n {4}tokens: \[/)[0].replace(/\n {4}revShareHooks: \[[\s\S]*?\n {4}\],/, '')
    for (const f of head.matchAll(/\n {4,6}(\w+): "(0x[0-9a-fA-F]{40})"/g)) {
      const [, key, address] = f
      if (SKIP.has(key) || address.toLowerCase() === ZERO) continue
      add({
        chainId,
        address,
        name: `DeepCore ${label(key)}`,
        role: ROLE[key] ?? `Part of the DeepCore protocol on this chain: ${label(key).toLowerCase()}.`,
        project: 'DeepCore',
        source,
      })
    }
  })
}

// ------------------------------------------------------------------------------------------ Peddles (deployment records)
for (const chainId of [56, 4663, 8453, 5042]) {
  const source = `peddles-launchpad:contracts/deployments/${chainId}.json`
  const json = JSON.parse(read(source))
  for (const [key, address] of Object.entries(json)) {
    // `treasury` and `deployer` are constructor-time values and stale (the Peddles Safe replaced them, 2026-10-02).
    if (typeof address !== 'string' || !ADDR.test(address) || key === 'treasury' || key === 'deployer' || address === ZERO) continue
    add({
      chainId,
      address,
      name: key,
      role: `Peddles launchpad contract (${label(key.replace(/^Peddles/, '')).toLowerCase()}).`,
      project: 'Peddles',
      source,
    })
  }
}

// ------------------------------------------------------------------------------------------ PeddleSwap
for (const chainId of [8453, 4663, 5042]) {
  const source = `peddleswap:contracts/deployments/${chainId}.json`
  const json = JSON.parse(read(source))
  for (const [key, address] of Object.entries(json)) {
    if (typeof address !== 'string' || !ADDR.test(address) || address === ZERO || key === 'weth9') continue
    add({
      chainId,
      address,
      name: `PeddleSwap ${label(key)}`,
      role: `PeddleSwap DEX contract (${label(key).toLowerCase()}).`,
      project: 'PeddleSwap',
      source,
    })
  }
}

// ------------------------------------------------------------------------------------------ PeddleQuest (docs/chains.md)
{
  const source = 'peddles-quest:docs/chains.md'
  const text = read(source)
  const list = [
    ['PeddlesQuestRouter', 'Router that takes quest and promotion payments.', '0x0c90BD0A17879C9b627705206522020078C51231'],
    ['PeddlesQuestEscrow', 'Escrow that holds quest rewards until holders claim them. Custodies third-party funds; unaudited.', '0x16267bE6D067b3d411bf779B5aD041f9eba4CadE'],
    ['PeddlesPromotionMarket', 'Market for promoted quest slots.', '0x704E5eA6752EbfcEDB377512b67c0138461f4849'],
    ['PeddlesQuestBadge', 'Soulbound badge contract: the proof a quest was completed.', '0x6DA219d4072A91665F702e34ca6CcaCd3eA7AE91'],
  ]
  for (const [name, role, address] of list) {
    if (!text.includes(address)) throw new Error(`${source} lacks ${address}`)
    for (const chainId of [8453, 4663, 56, 5042])
      add({ chainId, address, name, role, project: 'PeddleQuest', source, note: 'The same address on all four production chains (docs/chains.md).' })
  }
}

// ------------------------------------------------------------------------------------------ Cartel Family
{
  const source = 'Cartel-Family:deploy/deploy_fee_router.md'
  const text = read(source)
  const router = '0x5a423653f722bb427A09d05b4e80175A703e861F'
  if (!text.includes(router)) throw new Error('Cartel router missing')
  for (const chainId of [4663, 56])
    add({
      chainId,
      address: router,
      name: 'CartelFeeRouter v1',
      role: 'Cartel Family fee router (first build, deployed 2026-10-15): takes the Cartel fee and a launchpad bonding-curve trade in one transaction.',
      project: 'Cartel Family',
      source,
      note: 'The deployment record in deploy_fee_router.md lists this address on Robinhood Chain and BNB Chain. The same file calls this build superseded (two-day route delay); the app does not route through it yet.',
    })
}

// ------------------------------------------------------------------------------------------ Sourcify
const cache = fs.existsSync(CACHE) ? JSON.parse(fs.readFileSync(CACHE, 'utf8')) : {}
async function ask(e) {
  const k = e.id
  if (cache[k] !== undefined && (offline || cache[k].on === '2026-10-18')) return cache[k]
  if (offline) return { match: null }
  for (let t = 0; t < 4; t++) {
    try {
      const r = await fetch(`https://sourcify.dev/server/v2/contract/${e.chainId}/${e.address}`, { signal: AbortSignal.timeout(20000) })
      if (r.status === 404) return (cache[k] = { match: null, on: '2026-10-18' })
      if (r.ok) return (cache[k] = { match: (await r.json()).match ?? null, on: '2026-10-18' })
    } catch {
      /* retry */
    }
    await new Promise((res) => setTimeout(res, 1500 * (t + 1)))
  }
  throw new Error(`Sourcify did not answer for ${k}`)
}
const queue = [...entries]
await Promise.all(
  Array.from({ length: 6 }, async () => {
    for (let e; (e = queue.shift()); ) {
      const a = await ask(e)
      e.verification = a.match === 'exact_match' ? 'full' : a.match === 'match' ? 'partial' : null
      e.verifiedSource = e.verification ? `https://repo.sourcify.dev/${e.chainId}/${e.address}` : null
    }
  }),
)
fs.mkdirSync(path.dirname(CACHE), { recursive: true })
fs.writeFileSync(CACHE, JSON.stringify(cache, null, 1) + '\n')

// ------------------------------------------------------------------------------------------ write
const order = { 'Gully Labs': 0, DeepCore: 1, Peddles: 2, PeddleSwap: 3, PeddleQuest: 4, 'Cartel Family': 5 }
entries.sort((a, b) => order[a.project] - order[b.project] || a.chainId - b.chainId || a.name.localeCompare(b.name))
const block = `// BEGIN ENTRIES\nexport const contracts: ContractEntry[] = [\n${entries.map((e) => `  ${JSON.stringify(e)},`).join('\n')}\n]\n// END ENTRIES`
const src = fs.readFileSync(OUT, 'utf8')
fs.writeFileSync(OUT, src.replace(/\/\/ BEGIN ENTRIES[\s\S]*\/\/ END ENTRIES/, () => block))
const by = {}
for (const e of entries) by[e.project] = (by[e.project] ?? 0) + 1
console.log(`${entries.length} entries`, by, `verified ${entries.filter((e) => e.verification).length}`)
