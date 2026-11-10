// Refreshes what this site knows about Gully Core from the published manifest (owner, 2026-11-09: the manifest is the
// one source of truth for Gully Core chains, contracts, features and fees; surfaces never hard-code a chain list).
//   node scripts/sync-gully-core.mjs                 fetch https://gullycore.xyz/manifest.json, write the copy and the generated file
//   node scripts/sync-gully-core.mjs --from <file>   the same from a file
//   node scripts/sync-gully-core.mjs --check         exit 1 when the committed copy's reading differs from the live manifest's
// Writes: server/data/gully-core-manifest.json (the full copy the server starts from) and src/content/gullyCore.generated.ts
// (the small typed view the client bundle and the content catalogs read). Then: node scripts/build-page-content.mjs,
// node scripts/build-ask-index.mjs, node scripts/build-discovery.mjs, and commit.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { MANIFEST_URL, derive, generatedTs } from '../server/gully-core-derive.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export const COPY = path.join(ROOT, 'server/data/gully-core-manifest.json')
export const GENERATED = path.join(ROOT, 'src/content/gullyCore.generated.ts')

export async function fetchManifest(url = process.env.GULLY_CORE_MANIFEST_URL || MANIFEST_URL, tries = 3) {
  let last = null
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { headers: { accept: 'application/json', 'user-agent': 'gullylabs.xyz sync-gully-core' }, signal: AbortSignal.timeout(15000) })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      return await r.json()
    } catch (e) {
      last = e
      await new Promise((res) => setTimeout(res, 2000 * (i + 1)))
    }
  }
  throw new Error(`could not read ${url}: ${last?.message ?? last}`)
}

/** The committed copy's reading and the generated file's text, as they are on disk. */
export function committed() {
  const copy = JSON.parse(fs.readFileSync(COPY, 'utf8'))
  return { copy, reading: derive(copy), generated: fs.existsSync(GENERATED) ? fs.readFileSync(GENERATED, 'utf8') : '' }
}

/** Lines that differ between two readings (the fields the site shows), [] when they agree. */
export function drift(a, b) {
  const out = []
  const A = JSON.parse(JSON.stringify(a))
  const B = JSON.parse(JSON.stringify(b))
  const keys = new Set([...Object.keys(A), ...Object.keys(B)])
  for (const k of keys) {
    if (k === 'chains' || k === 'features') {
      const ia = Object.fromEntries((A[k] ?? []).map((x) => [x.key ?? x.id, x]))
      const ib = Object.fromEntries((B[k] ?? []).map((x) => [x.key ?? x.id, x]))
      for (const id of new Set([...Object.keys(ia), ...Object.keys(ib)])) {
        if (!ia[id]) out.push(`${k} ${id}: only in the live manifest`)
        else if (!ib[id]) out.push(`${k} ${id}: only in the committed copy`)
        else for (const f of new Set([...Object.keys(ia[id]), ...Object.keys(ib[id])])) if (JSON.stringify(ia[id][f]) !== JSON.stringify(ib[id][f])) out.push(`${k} ${id}.${f}: committed ${JSON.stringify(ia[id][f])} vs live ${JSON.stringify(ib[id][f])}`)
      }
      if ((A[k] ?? []).map((x) => x.key ?? x.id).join() !== (B[k] ?? []).map((x) => x.key ?? x.id).join()) out.push(`${k}: order differs`)
    } else if (JSON.stringify(A[k]) !== JSON.stringify(B[k])) out.push(`${k}: committed ${JSON.stringify(A[k])} vs live ${JSON.stringify(B[k])}`)
  }
  return out
}

export function write(manifest) {
  const d = derive(manifest)
  fs.writeFileSync(COPY, JSON.stringify(manifest, null, 1) + '\n')
  fs.writeFileSync(GENERATED, generatedTs(d))
  return d
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const from = process.argv.indexOf('--from')
  const live = from > 0 ? JSON.parse(fs.readFileSync(process.argv[from + 1], 'utf8')) : await fetchManifest()
  if (process.argv.includes('--check')) {
    const { reading, generated } = committed()
    const lines = drift(reading, derive(live))
    if (generated !== generatedTs(reading)) lines.push('src/content/gullyCore.generated.ts is not what the committed copy generates')
    if (lines.length) {
      console.log('Gully Core reading is OUT OF DATE:\n  ' + lines.join('\n  ') + '\nrun node scripts/sync-gully-core.mjs and the build scripts, then commit')
      process.exit(1)
    }
    console.log('Gully Core reading agrees with the live manifest')
  } else {
    const d = write(live)
    console.log(`Gully Core: ${d.chains.length} chains (${d.liveMainnets.length} mainnets live: ${d.liveMainnets.join(', ')}; testnet: ${d.testnets.join(', ') || 'none'}); ${d.features.filter((f) => f.status === 'live').length}/${d.features.length} features live -> ${path.relative(ROOT, COPY)}, ${path.relative(ROOT, GENERATED)}`)
  }
}
