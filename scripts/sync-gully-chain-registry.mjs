// Copies Gully Chain's contract registry (gully-ops l3/generated/registry.json) into
// server/data/gully-chain-registry.json: address, name, category and lifecycle of every contract on chain
// 485590. The Holder Map labels those addresses as protocol contracts (pools, lockers, routers, tokens),
// never as wallets (server/gully-chain-registry.mjs). Re-run after a new Gully Chain deploy:
//   node scripts/sync-gully-chain-registry.mjs [path/to/registry.json]
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const src = process.argv[2] ?? path.resolve(HERE, '../../gully-ops/l3/generated/registry.json')
const out = path.resolve(HERE, '../server/data/gully-chain-registry.json')
const reg = JSON.parse(fs.readFileSync(src, 'utf8'))
const chainId = 485590
const contracts = (reg.contracts ?? [])
  .filter((c) => Number(c.chainId) === chainId && /^0x[0-9a-fA-F]{40}$/.test(String(c.address ?? '')))
  .map((c) => ({ address: c.address.toLowerCase(), name: String(c.name ?? ''), category: String(c.category ?? ''), lifecycle: String(c.lifecycle ?? '') }))
  .sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name) || a.address.localeCompare(b.address))
const head = { source: 'gully-ops l3/generated/registry.json', chainId, updatedAt: reg.updatedAt ?? null, block: reg.block ?? null }
// One contract per line, so a registry update reads as a short diff.
const lines = Object.entries(head).map(([k, v]) => ` ${JSON.stringify(k)}: ${JSON.stringify(v)},`)
fs.writeFileSync(out, `{\n${lines.join('\n')}\n "contracts": [\n${contracts.map((c) => `  ${JSON.stringify(c)}`).join(',\n')}\n ]\n}\n`)
console.log(`${contracts.length} Gully Chain contracts -> ${path.relative(process.cwd(), out)}`)
