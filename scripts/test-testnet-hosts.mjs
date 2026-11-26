// Testnet callers stay on testnet-rpc / testnet-bridge (mainnet plan step 2). Run: npm run test:testnet-hosts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ALLOW = {
  '.stack/snapshot.json': 'generated from the gully-ops stack registry (product home URLs), never hand edited',
  'public/spots/house-promos.json': 'byte copy of gully-ops sites/_shared/house-promos.json: href is the mainnet home, hrefTestnet the testnet one',
  'server/data/gully-core-manifest.json': 'copy of gullycore.xyz/manifest.json, synced from gully-ops (moves there)',
  'scripts/test-gully-mainnet.mjs': 'asserts the 48559 MAINNET RPC config',
  'scripts/test-testnet-hosts.mjs': 'this guard',
}
// Testnet callers use testnet-rpc.gullychain.xyz / testnet-bridge.gullychain.xyz. At the Gully Chain mainnet
// cut-over rpc.gullychain.xyz and bridge.gullychain.xyz start serving mainnet 48559 (gully-ops l3/mainnet/INFRA.md
// section 6), so a testnet default left on the old names would silently talk to the wrong chain.
// Every file that still names an old host must be in ALLOW with a reason.
const OLD_HOSTS = /\/\/(rpc|bridge)\.gullychain\.xyz/
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.next', 'out', 'coverage', '.turbo'])

function trackedFiles(root) {
  try {
    return execSync('git ls-files', { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] }).split('\n').filter(Boolean)
  } catch {
    const out = []
    const walk = (dir) => {
      for (const e of readdirSync(join(root, dir), { withFileTypes: true })) {
        if (SKIP_DIRS.has(e.name)) continue
        const p = dir ? `${dir}/${e.name}` : e.name
        if (e.isDirectory()) walk(p)
        else out.push(p)
      }
    }
    walk('')
    return out
  }
}

function offenders(root) {
  const bad = []
  for (const f of trackedFiles(root)) {
    if (f.endsWith('.md') || ALLOW[f] || !/\.(c|m)?[jt]sx?$|\.(json|ya?ml|sh|py|sol|html|caddy|env|example|toml)$|Caddyfile/.test(f)) continue
    let text
    try { text = readFileSync(join(root, f), 'utf8') } catch { continue }
    if (OLD_HOSTS.test(text)) bad.push(f)
  }
  return bad
}

test('testnet callers use the testnet-* hosts: no file outside the allowlist names rpc. or bridge.gullychain.xyz', () => {
  assert.deepEqual(offenders(join(dirname(fileURLToPath(import.meta.url)), '..')), [])
})
