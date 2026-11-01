// Gully Chain's protocol contracts as Holder Map labels. The list is gully-ops l3/generated/registry.json,
// copied into data/gully-chain-registry.json by scripts/sync-gully-chain-registry.mjs (one entry per contract:
// address, name, category, lifecycle). Every address in it is infrastructure (a pool, a locker, a router, a
// token contract, a hook or another protocol contract), so the Holder Map never counts it as a wallet in the
// top-10 share, the clusters or the launch health. The Gully Core Vault holds the tokens of every Gully Core
// pool; when a coin's launch kit seeded it, the launch liquidity is locked forever (GullyCoreLPLocker /
// GullyCoreBinLPLocker), and the vault is shown as "Pool (locked)".
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const lower = (a) => String(a ?? '').toLowerCase()
const isAddr = (a) => /^0x[0-9a-fA-F]{40}$/.test(String(a ?? ''))

let cached = null
/** The registry's Gully Chain contracts: [{ address (lower case), name, category, lifecycle }]. Read once. */
export function registryContracts(file = path.join(HERE, 'data', 'gully-chain-registry.json')) {
  if (cached && file === cached.file) return cached.list
  let list = []
  try {
    const body = JSON.parse(fs.readFileSync(file, 'utf8'))
    list = (Array.isArray(body?.contracts) ? body.contracts : []).filter((c) => isAddr(c?.address)).map((c) => ({ address: lower(c.address), name: String(c.name ?? ''), category: String(c.category ?? ''), lifecycle: String(c.lifecycle ?? '') }))
  } catch (e) {
    console.warn(`gully-chain-registry: ${String(e?.message ?? e).slice(0, 120)}`)
  }
  cached = { file, list }
  return list
}

/** The words a holder row shows before the contract's name, per label kind. */
export const KIND_TAG = { pool: 'Pool', lock: 'Lock', burn: 'Burn', token: 'Token contract', router: 'Router', gully: 'Protocol contract', deepcore: 'Protocol contract', exchange: 'Exchange' }

/**
 * The label kind of one registry contract, or null (not labelled: an unidentified address). Safes are
 * people's or the team's multisigs: named ('known') but still counted as wallets. Pure.
 */
export function registryKindOf({ name, category }) {
  const n = String(name ?? '')
  if (category === 'Unidentified' || !n) return null
  if (category === 'Safe') return /SafeProxy \(|governance Safe/i.test(n) ? 'known' : 'gully'
  if (/Treasury/i.test(n)) return 'gully'
  if (category === 'Tokens' || /^(LaunchToken\b|WETH9?\b|USDC\.e\b|glUSD\b|Bridged WETH|aeWETH|HypERC20$|Token \()/.test(n)) return 'token'
  if (/Locker|Lock\b|Vesting/.test(n)) return 'lock'
  if (/LaunchpadKit|Factory|Owner$|Descriptor|Quoter|Lens|Registry|Registrar|Resolver|Controller|Verifier|Policy|Signer|Validator|Implementation|impl\)|Proxy|Module|Handler|Hook\b|Hook$/i.test(n)) return 'gully'
  if (/Vault\b|PoolManager$|PositionManager|UniswapV3Pool|Launchpad|FairLaunch|Staker|RangeOrders|\bDCA\b|LaunchLegs/.test(n)) return 'pool'
  if (/Router|SwapAndPay|Multisend|MultiSend/i.test(n)) return 'router'
  return 'gully'
}

/** Display names for the contracts people meet most (others: "<tag> · <registry name>"). */
const NICE = [
  [/^Gully Core Vault$/, 'Pool · Gully Core vault'],
  [/^Gully Core (CL|Bin)PoolManager$/, (m) => `Pool · Gully Core ${m[1]} pool manager`],
  [/^Gully Core (CL|Bin)PositionManager$/, (m) => `Pool · Gully Core ${m[1]} positions`],
  [/^GullyCore(Bin)?LPLocker$/, (m) => `Pool (locked) · Gully Core ${m[1] ? 'Bin ' : ''}LP locker`],
  [/^Gully Core LaunchpadKitV2$/, 'Protocol contract · Gully Core launch kit'],
]
const niceName = (c, kind) => {
  for (const [re, out] of NICE) {
    const m = c.name.match(re)
    if (m) return typeof out === 'function' ? out(m) : out
  }
  return kind === 'known' ? c.name : `${KIND_TAG[kind] ?? 'Protocol contract'} · ${c.name}${c.lifecycle === 'deprecated' && !/old|retired|superseded/i.test(c.name) ? ' (retired)' : ''}`
}

/** [address, kind, name] for every labelled registry contract, for staticLabels(). */
export function registryLabels(list = registryContracts()) {
  const out = []
  for (const c of list) {
    const kind = registryKindOf(c)
    if (kind) out.push([c.address, kind, niceName(c, kind)])
  }
  return out
}

/** Every infrastructure address of the registry (not the Safes), plus the burn addresses: Set of lower case. */
export function registryInfra(list = registryContracts()) {
  const s = new Set(['0x0000000000000000000000000000000000000000', '0x000000000000000000000000000000000000dead'])
  for (const c of list) {
    const k = registryKindOf(c)
    if (k && k !== 'known') s.add(c.address)
  }
  return s
}

/** The Gully Core contracts the launch check needs: { vault, kit } (lower case) or nulls. */
export function gullyCoreAddrs(list = registryContracts()) {
  const by = (re) => list.find((c) => c.category === 'Gully Core' && re.test(c.name))?.address ?? null
  return { vault: by(/^Gully Core Vault$/), kit: by(/^Gully Core LaunchpadKitV2$/) }
}

/**
 * A Gully Core launch: the launch kit paid the token into the Vault (the pool seeding, whose position the kit
 * locks forever in GullyCoreLPLocker or GullyCoreBinLPLocker). Returns the vault address, else null. Pure.
 */
export function gullyCoreLaunchVault(transfers, addrs = gullyCoreAddrs()) {
  if (!addrs.vault || !addrs.kit || !Array.isArray(transfers)) return null
  return transfers.some((t) => t?.from === addrs.kit && t?.to === addrs.vault) ? addrs.vault : null
}
