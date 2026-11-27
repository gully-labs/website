// A small QR code encoder (byte mode, error correction M, versions 1-10: up to 213 characters). No dependencies, no network:
// the address you are asked to send coins to is drawn in the page itself. Algorithm after Project Nayuki's QR Code generator (MIT).
const ECC_PER_BLOCK = [0, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26]
const BLOCKS = [0, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5]

const rawModules = (v) => {
  let r = (16 * v + 128) * v + 64
  if (v >= 2) {
    const n = Math.floor(v / 7) + 2
    r -= (25 * n - 10) * n - 55
    if (v >= 7) r -= 36
  }
  return r
}
const dataWords = (v) => Math.floor(rawModules(v) / 8) - ECC_PER_BLOCK[v] * BLOCKS[v]

// GF(256) with 0x11D
const EXP = new Uint8Array(512)
const LOG = new Uint8Array(256)
for (let i = 0, x = 1; i < 255; i++) {
  EXP[i] = x
  LOG[x] = i
  x <<= 1
  if (x & 0x100) x ^= 0x11d
}
for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255]
const mul = (a, b) => (a && b ? EXP[LOG[a] + LOG[b]] : 0)
function rsDivisor(deg) {
  let r = [1]
  for (let i = 0; i < deg; i++) {
    const n = new Array(r.length + 1).fill(0)
    for (let j = 0; j < r.length; j++) {
      n[j] ^= r[j]
      n[j + 1] ^= mul(r[j], EXP[i])
    }
    r = n
  }
  return r.slice(1)
}
function rsRemainder(data, div) {
  const r = new Array(div.length).fill(0)
  for (const b of data) {
    const f = b ^ r.shift()
    r.push(0)
    for (let i = 0; i < div.length; i++) r[i] ^= mul(div[i], f)
  }
  return r
}

function codewords(bytes, v) {
  const bits = []
  const put = (val, n) => {
    for (let i = n - 1; i >= 0; i--) bits.push((val >>> i) & 1)
  }
  put(4, 4)
  put(bytes.length, v < 10 ? 8 : 16)
  for (const b of bytes) put(b, 8)
  const cap = dataWords(v) * 8
  put(0, Math.min(4, cap - bits.length))
  while (bits.length % 8) bits.push(0)
  for (let pad = 0xec; bits.length < cap; pad ^= 0xec ^ 0x11) put(pad, 8)
  const data = []
  for (let i = 0; i < bits.length; i += 8) data.push(parseInt(bits.slice(i, i + 8).join(''), 2))
  const nb = BLOCKS[v]
  const eccLen = ECC_PER_BLOCK[v]
  const total = Math.floor(rawModules(v) / 8)
  const shortCount = nb - (total % nb)
  const shortLen = Math.floor(total / nb)
  const div = rsDivisor(eccLen)
  const blocks = []
  for (let i = 0, k = 0; i < nb; i++) {
    const len = shortLen - eccLen + (i < shortCount ? 0 : 1)
    const d = data.slice(k, k + len)
    k += len
    blocks.push({ d, e: rsRemainder(d, div) })
  }
  const out = []
  for (let i = 0; i < blocks[blocks.length - 1].d.length; i++) for (const b of blocks) if (i < b.d.length) out.push(b.d[i])
  for (let i = 0; i < eccLen; i++) for (const b of blocks) out.push(b.e[i])
  return out
}

function build(v, cw, mask) {
  const size = v * 4 + 17
  const m = Array.from({ length: size }, () => new Array(size).fill(false))
  const fn = Array.from({ length: size }, () => new Array(size).fill(false))
  const set = (x, y, dark) => {
    m[y][x] = dark
    fn[y][x] = true
  }
  for (let i = 0; i < size; i++) {
    set(6, i, i % 2 === 0)
    set(i, 6, i % 2 === 0)
  }
  const finder = (cx, cy) => {
    for (let dy = -4; dy <= 4; dy++)
      for (let dx = -4; dx <= 4; dx++) {
        const x = cx + dx
        const y = cy + dy
        if (x < 0 || y < 0 || x >= size || y >= size) continue
        const d = Math.max(Math.abs(dx), Math.abs(dy))
        set(x, y, d !== 2 && d !== 4)
      }
  }
  finder(3, 3)
  finder(size - 4, 3)
  finder(3, size - 4)
  const n = Math.floor(v / 7) + 2
  const step = Math.ceil((v * 4 + 4) / (n * 2 - 2)) * 2
  const pos = [6]
  for (let p = size - 7; pos.length < n; p -= step) pos.splice(1, 0, p)
  for (let i = 0; v > 1 && i < n; i++)
    for (let j = 0; j < n; j++) {
      if ((i === 0 && j === 0) || (i === 0 && j === n - 1) || (i === n - 1 && j === 0)) continue
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(pos[i] + dx, pos[j] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1)
    }
  // format bits (error correction M = 0b00) and the dark module
  const fmtData = mask
  let rem = fmtData
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537)
  const fmt = ((fmtData << 10) | rem) ^ 0x5412
  const bit = (i) => ((fmt >>> i) & 1) !== 0
  for (let i = 0; i <= 5; i++) set(8, i, bit(i))
  set(8, 7, bit(6))
  set(8, 8, bit(7))
  set(7, 8, bit(8))
  for (let i = 9; i < 15; i++) set(14 - i, 8, bit(i))
  for (let i = 0; i < 8; i++) set(size - 1 - i, 8, bit(i))
  for (let i = 8; i < 15; i++) set(8, size - 15 + i, bit(i))
  set(8, size - 8, true)
  if (v >= 7) {
    let r = v
    for (let i = 0; i < 12; i++) r = (r << 1) ^ ((r >>> 11) * 0x1f25)
    const vb = (v << 12) | r
    for (let i = 0; i < 18; i++) {
      const a = size - 11 + (i % 3)
      const b = Math.floor(i / 3)
      set(a, b, ((vb >>> i) & 1) !== 0)
      set(b, a, ((vb >>> i) & 1) !== 0)
    }
  }
  // data, zigzag from the bottom right
  let i = 0
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5
    for (let vert = 0; vert < size; vert++)
      for (let j = 0; j < 2; j++) {
        const x = right - j
        const up = ((right + 1) & 2) === 0
        const y = up ? size - 1 - vert : vert
        if (!fn[y][x] && i < cw.length * 8) {
          m[y][x] = ((cw[i >>> 3] >>> (7 - (i & 7))) & 1) !== 0
          i++
        }
      }
  }
  const inv = [
    (x, y) => (x + y) % 2 === 0,
    (x, y) => y % 2 === 0,
    (x) => x % 3 === 0,
    (x, y) => (x + y) % 3 === 0,
    (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
    (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
    (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
    (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
  ][mask]
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (!fn[y][x] && inv(x, y)) m[y][x] = !m[y][x]
  return m
}

function penalty(m) {
  const n = m.length
  let p = 0
  for (const line of [m, m[0].map((_, x) => m.map((r) => r[x]))])
    for (const row of line) {
      let run = 1
      for (let i = 1; i <= n; i++) {
        if (i < n && row[i] === row[i - 1]) run++
        else {
          if (run >= 5) p += run - 2
          run = 1
        }
      }
    }
  for (let y = 0; y < n - 1; y++) for (let x = 0; x < n - 1; x++) if (m[y][x] === m[y][x + 1] && m[y][x] === m[y + 1][x] && m[y][x] === m[y + 1][x + 1]) p += 3
  const dark = m.flat().filter(Boolean).length
  p += Math.floor(Math.abs(dark * 20 - n * n * 10) / (n * n)) * 10
  return p
}

/** The QR matrix (rows of booleans, true = dark) for a text, or null when it does not fit (over 213 bytes). */
export function qrMatrix(text) {
  const bytes = [...new TextEncoder().encode(String(text))]
  let v = 1
  while (v <= 10 && 4 + (v < 10 ? 8 : 16) + bytes.length * 8 > dataWords(v) * 8) v++
  if (v > 10) return null
  const cw = codewords(bytes, v)
  let best = null
  let bp = Infinity
  for (let mask = 0; mask < 8; mask++) {
    const m = build(v, cw, mask)
    const p = penalty(m)
    if (p < bp) {
      bp = p
      best = m
    }
  }
  return best
}

/** An inline SVG of the code with a 4-module quiet zone, on a white plate so it scans in dark mode too. */
export function qrSvg(text, { label = 'QR code' } = {}) {
  const m = qrMatrix(text)
  if (!m) return ''
  const n = m.length
  const q = 4
  let d = ''
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (m[y][x]) d += `M${x + q} ${y + q}h1v1h-1z`
  return `<svg class="qr" viewBox="0 0 ${n + q * 2} ${n + q * 2}" role="img" aria-label="${label}" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="#fff"/><path d="${d}" fill="#000"/></svg>`
}
