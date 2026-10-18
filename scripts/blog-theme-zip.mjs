#!/usr/bin/env node
/* Packs the blog theme (ghost/theme/gully) into ghost/theme/gully.zip, ready for Ghost's theme upload.
   No dependencies: a minimal ZIP writer (deflate via node:zlib). Files sit at the zip root; Ghost takes
   the theme name from the file name, so the zip must stay "gully.zip". Dotfiles are left out.

   Usage: node scripts/blog-theme-zip.mjs   (then check it: npx gscan@6.6.1 --zip ghost/theme/gully.zip --v6) */
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { deflateRawSync, crc32 } from 'node:zlib'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const src = join(root, 'ghost', 'theme', 'gully')
const dest = join(root, 'ghost', 'theme', 'gully.zip')

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => !e.name.startsWith('.'))
    .flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]))
    .sort()
}

/* A fixed timestamp keeps the zip byte-for-byte reproducible. DOS time: 2026-01-01 00:00. */
const DOS_TIME = 0
const DOS_DATE = ((2026 - 1980) << 9) | (1 << 5) | 1

const locals = []
const centrals = []
let offset = 0
const files = walk(src)
for (const file of files) {
  const name = Buffer.from(relative(src, file).split('\\').join('/'), 'utf8')
  const data = readFileSync(file)
  const deflated = deflateRawSync(data, { level: 9 })
  const stored = deflated.length >= data.length
  const body = stored ? data : deflated
  const crc = crc32(data) >>> 0

  const local = Buffer.alloc(30)
  local.writeUInt32LE(0x04034b50, 0)
  local.writeUInt16LE(20, 4)
  local.writeUInt16LE(0x0800, 6) // UTF-8 names
  local.writeUInt16LE(stored ? 0 : 8, 8)
  local.writeUInt16LE(DOS_TIME, 10)
  local.writeUInt16LE(DOS_DATE, 12)
  local.writeUInt32LE(crc, 14)
  local.writeUInt32LE(body.length, 18)
  local.writeUInt32LE(data.length, 22)
  local.writeUInt16LE(name.length, 26)
  local.writeUInt16LE(0, 28)
  locals.push(local, name, body)

  const central = Buffer.alloc(46)
  central.writeUInt32LE(0x02014b50, 0)
  central.writeUInt16LE(20, 4)
  central.writeUInt16LE(20, 6)
  central.writeUInt16LE(0x0800, 8)
  central.writeUInt16LE(stored ? 0 : 8, 10)
  central.writeUInt16LE(DOS_TIME, 12)
  central.writeUInt16LE(DOS_DATE, 14)
  central.writeUInt32LE(crc, 16)
  central.writeUInt32LE(body.length, 20)
  central.writeUInt32LE(data.length, 24)
  central.writeUInt16LE(name.length, 28)
  central.writeUInt32LE(0, 30) // extra + comment length
  central.writeUInt32LE(0, 34) // disk + internal attrs
  central.writeUInt32LE(0, 38) // external attrs
  central.writeUInt32LE(offset, 42)
  centrals.push(central, name)

  offset += local.length + name.length + body.length
}
const cd = Buffer.concat(centrals)
const end = Buffer.alloc(22)
end.writeUInt32LE(0x06054b50, 0)
end.writeUInt16LE(files.length, 8)
end.writeUInt16LE(files.length, 10)
end.writeUInt32LE(cd.length, 12)
end.writeUInt32LE(offset, 16)
writeFileSync(dest, Buffer.concat([...locals, cd, end]))
console.log(`${relative(root, dest)}: ${files.length} files, ${(statSync(dest).size / 1024).toFixed(1)} KiB`)
