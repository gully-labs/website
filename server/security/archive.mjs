// Archive reading for untrusted input (GitHub tarballs, uploaded zips), with no dependencies and no disk
// writes: everything is unpacked in memory, as data, under hard caps. Nothing is ever extracted to a path
// the archive chose, symlinks/hardlinks/devices are dropped, and every kept path is sanitised.

import zlib from 'node:zlib'

export class ArchiveError extends Error {
  constructor(message, code = 'bad-archive') {
    super(message)
    this.code = code
  }
}

/**
 * A safe relative path or null: forward slashes, no absolute/drive prefix, no '..' or '.', no NUL or
 * control characters, at most 300 characters and 30 segments.
 */
export function sanitizePath(p) {
  if (typeof p !== 'string') return null
  let s = p.replace(/\\/g, '/')
  if (/[\x00-\x1f\x7f]/.test(s)) return null
  s = s.replace(/^\.\/+/, '')
  if (s.startsWith('/') || /^[A-Za-z]:/.test(s)) return null
  const parts = s.split('/').filter((x) => x !== '')
  if (!parts.length || parts.length > 30) return null
  if (parts.some((x) => x === '..' || x === '.' || x.length > 120)) return null
  const out = parts.join('/')
  return out.length <= 300 ? out : null
}

/** Gunzips with an output cap. */
export function gunzipCapped(buf, maxBytes) {
  try {
    return zlib.gunzipSync(buf, { maxOutputLength: maxBytes })
  } catch (e) {
    if (e?.code === 'ERR_BUFFER_TOO_LARGE' || /maxOutputLength|buffer/i.test(String(e?.message))) throw new ArchiveError(`archive unpacks to more than ${maxBytes} bytes`, 'too-large')
    throw new ArchiveError('not a valid gzip archive')
  }
}

const cstr = (b) => {
  const i = b.indexOf(0)
  return b.subarray(0, i < 0 ? b.length : i).toString('utf8')
}
const octal = (b) => parseInt(cstr(b).trim() || '0', 8)

/**
 * Regular files from a tar buffer: [{ path, data }]. `keep(path, size)` decides which to keep (others are
 * skipped without being copied). PAX/GNU long names are honoured; links and special files are dropped.
 */
export function readTar(buf, { keep = () => true, maxFiles = 5000, maxBytes = Infinity, stripFirst = false } = {}) {
  const out = []
  let off = 0
  let longName = null
  let total = 0
  while (off + 512 <= buf.length) {
    const h = buf.subarray(off, off + 512)
    if (h.every((x) => x === 0)) break
    const size = octal(h.subarray(124, 136))
    const type = String.fromCharCode(h[156] || 48)
    if (!Number.isFinite(size) || size < 0) throw new ArchiveError('corrupt tar header')
    const dataStart = off + 512
    const data = buf.subarray(dataStart, dataStart + size)
    off = dataStart + Math.ceil(size / 512) * 512
    if (type === 'L') {
      longName = cstr(data)
      continue
    }
    if (type === 'x' || type === 'g') {
      const m = /\d+ path=([^\n]*)\n/.exec(data.toString('utf8'))
      if (type === 'x' && m) longName = m[1]
      continue
    }
    const prefix = cstr(h.subarray(345, 500))
    let name = longName ?? (prefix ? `${prefix}/${cstr(h.subarray(0, 100))}` : cstr(h.subarray(0, 100)))
    longName = null
    if (type !== '0' && type !== '\0' && type !== '7') continue // dirs, links, devices, fifos: dropped
    if (stripFirst) name = name.split('/').slice(1).join('/')
    const safe = sanitizePath(name)
    if (!safe || !keep(safe, size)) continue
    total += size
    if (total > maxBytes) throw new ArchiveError(`kept files exceed ${maxBytes} bytes`, 'too-large')
    if (out.length >= maxFiles) throw new ArchiveError(`more than ${maxFiles} files`, 'too-many-files')
    out.push({ path: safe, data: Buffer.from(data) })
  }
  return out
}

/**
 * Regular files from a zip buffer: [{ path, data }]. Reads the central directory, supports stored and
 * deflate, rejects encryption and zip64, drops directories and symlinks (unix mode in external attrs),
 * caps the uncompressed size per file and in total (zip-bomb guard: the inflater stops at the cap).
 */
export function readZip(buf, { keep = () => true, maxFiles = 5000, maxBytes = Infinity, maxFileBytes = Infinity } = {}) {
  let eocd = -1
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65_535); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw new ArchiveError('not a zip file')
  const count = buf.readUInt16LE(eocd + 10)
  let p = buf.readUInt32LE(eocd + 16)
  if (count === 0xffff || p === 0xffffffff) throw new ArchiveError('zip64 archives are not accepted')
  const out = []
  let total = 0
  for (let n = 0; n < count; n++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) throw new ArchiveError('corrupt zip directory')
    const flags = buf.readUInt16LE(p + 8)
    const method = buf.readUInt16LE(p + 10)
    const csize = buf.readUInt32LE(p + 20)
    const usize = buf.readUInt32LE(p + 24)
    const nlen = buf.readUInt16LE(p + 28)
    const xlen = buf.readUInt16LE(p + 30)
    const clen = buf.readUInt16LE(p + 32)
    const ext = buf.readUInt32LE(p + 38)
    const local = buf.readUInt32LE(p + 42)
    const name = buf.subarray(p + 46, p + 46 + nlen).toString('utf8')
    p += 46 + nlen + xlen + clen
    if (flags & 1) throw new ArchiveError('encrypted zip entries are not accepted')
    if (name.endsWith('/')) continue
    const unixType = (ext >>> 16) & 0o170000
    if (unixType && unixType !== 0o100000) continue // symlink or special file
    const safe = sanitizePath(name)
    if (!safe || !keep(safe, usize)) continue
    if (usize > maxFileBytes) throw new ArchiveError(`${safe} is larger than ${maxFileBytes} bytes`, 'too-large')
    if (local + 30 > buf.length || buf.readUInt32LE(local) !== 0x04034b50) throw new ArchiveError('corrupt zip entry')
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28)
    const raw = buf.subarray(start, start + csize)
    let data
    if (method === 0) data = Buffer.from(raw)
    else if (method === 8) {
      try {
        data = zlib.inflateRawSync(raw, { maxOutputLength: Math.min(maxFileBytes, maxBytes - total) + 1 })
      } catch {
        throw new ArchiveError(`${safe}: could not be inflated within the size cap`, 'too-large')
      }
    } else throw new ArchiveError(`${safe}: unsupported compression method ${method}`)
    if (data.length > maxFileBytes) throw new ArchiveError(`${safe} is larger than ${maxFileBytes} bytes`, 'too-large')
    total += data.length
    if (total > maxBytes) throw new ArchiveError(`archive unpacks to more than ${maxBytes} bytes`, 'too-large')
    if (out.length >= maxFiles) throw new ArchiveError(`more than ${maxFiles} files`, 'too-many-files')
    out.push({ path: safe, data })
  }
  return out
}

/** A minimal stored (uncompressed) zip writer, used by the tests to build fixtures. */
export function writeZip(files) {
  const locals = []
  const centrals = []
  let off = 0
  for (const f of files) {
    const name = Buffer.from(f.path)
    const data = Buffer.from(f.data)
    const crc = zlib.crc32 ? zlib.crc32(data) : 0
    const l = Buffer.alloc(30)
    l.writeUInt32LE(0x04034b50, 0)
    l.writeUInt16LE(20, 4)
    l.writeUInt32LE(crc >>> 0, 14)
    l.writeUInt32LE(data.length, 18)
    l.writeUInt32LE(data.length, 22)
    l.writeUInt16LE(name.length, 26)
    const c = Buffer.alloc(46)
    c.writeUInt32LE(0x02014b50, 0)
    c.writeUInt16LE(20, 4)
    c.writeUInt16LE(20, 6)
    c.writeUInt32LE(crc >>> 0, 16)
    c.writeUInt32LE(data.length, 20)
    c.writeUInt32LE(data.length, 24)
    c.writeUInt16LE(name.length, 28)
    c.writeUInt32LE((f.mode ?? 0o100644) * 65536, 38)
    c.writeUInt32LE(off, 42)
    locals.push(l, name, data)
    centrals.push(c, name)
    off += 30 + name.length + data.length
  }
  const cd = Buffer.concat(centrals)
  const e = Buffer.alloc(22)
  e.writeUInt32LE(0x06054b50, 0)
  e.writeUInt16LE(files.length, 8)
  e.writeUInt16LE(files.length, 10)
  e.writeUInt32LE(cd.length, 12)
  e.writeUInt32LE(off, 16)
  return Buffer.concat([...locals, cd, e])
}

/** A minimal ustar writer (tests: fake GitHub tarballs). */
export function writeTar(files) {
  const parts = []
  for (const f of files) {
    const data = Buffer.from(f.data ?? '')
    const h = Buffer.alloc(512)
    h.write(f.path.slice(0, 100), 0)
    h.write('0000644\0', 100)
    h.write('0000000\0', 108)
    h.write('0000000\0', 116)
    h.write(data.length.toString(8).padStart(11, '0') + '\0', 124)
    h.write('00000000000\0', 136)
    h.write('        ', 148)
    h.write(f.type ?? '0', 156)
    h.write('ustar\0', 257)
    h.write('00', 263)
    let sum = 0
    for (const b of h) sum += b
    h.write(sum.toString(8).padStart(6, '0') + '\0 ', 148)
    parts.push(h, data, Buffer.alloc((512 - (data.length % 512)) % 512))
  }
  parts.push(Buffer.alloc(1024))
  return Buffer.concat(parts)
}
