// A small baseline JPEG encoder (4:4:4, standard Huffman tables) for the Holder Map share card: Telegram's inline
// photo results must be JPEG and resvg only writes PNG. Input is RGBA from resvg; the card is opaque so alpha is
// ignored. Output starts FF D8 FF and ends FF D9.

const ZZ = [0, 1, 8, 16, 9, 2, 3, 10, 17, 24, 32, 25, 18, 11, 4, 5, 12, 19, 26, 33, 40, 48, 41, 34, 27, 20, 13, 6, 7, 14, 21, 28, 35, 42, 49, 56, 57, 50, 43, 36, 29, 22, 15, 23, 30, 37, 44, 51, 58, 59, 52, 45, 38, 31, 39, 46, 53, 60, 61, 54, 47, 55, 62, 63]
const QY = [16, 11, 10, 16, 24, 40, 51, 61, 12, 12, 14, 19, 26, 58, 60, 55, 14, 13, 16, 24, 40, 57, 69, 56, 14, 17, 22, 29, 51, 87, 80, 62, 18, 22, 37, 56, 68, 109, 103, 77, 24, 35, 55, 64, 81, 104, 113, 92, 49, 64, 78, 87, 103, 121, 120, 101, 72, 92, 95, 98, 112, 100, 103, 99]
const QC = [17, 18, 24, 47, 99, 99, 99, 99, 18, 21, 26, 66, 99, 99, 99, 99, 24, 26, 56, 99, 99, 99, 99, 99, 47, 66, 99, 99, 99, 99, 99, 99, ...Array(32).fill(99)]
const DC_L = [0, 1, 5, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0]
const DC_V = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]
const DCC_L = [0, 3, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0]
const AC_L = [0, 2, 1, 3, 3, 2, 4, 3, 5, 5, 4, 4, 0, 0, 1, 0x7d]
const AC_V = [0x01, 0x02, 0x03, 0x00, 0x04, 0x11, 0x05, 0x12, 0x21, 0x31, 0x41, 0x06, 0x13, 0x51, 0x61, 0x07, 0x22, 0x71, 0x14, 0x32, 0x81, 0x91, 0xa1, 0x08, 0x23, 0x42, 0xb1, 0xc1, 0x15, 0x52, 0xd1, 0xf0, 0x24, 0x33, 0x62, 0x72, 0x82, 0x09, 0x0a, 0x16, 0x17, 0x18, 0x19, 0x1a, 0x25, 0x26, 0x27, 0x28, 0x29, 0x2a, 0x34, 0x35, 0x36, 0x37, 0x38, 0x39, 0x3a, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48, 0x49, 0x4a, 0x53, 0x54, 0x55, 0x56, 0x57, 0x58, 0x59, 0x5a, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68, 0x69, 0x6a, 0x73, 0x74, 0x75, 0x76, 0x77, 0x78, 0x79, 0x7a, 0x83, 0x84, 0x85, 0x86, 0x87, 0x88, 0x89, 0x8a, 0x92, 0x93, 0x94, 0x95, 0x96, 0x97, 0x98, 0x99, 0x9a, 0xa2, 0xa3, 0xa4, 0xa5, 0xa6, 0xa7, 0xa8, 0xa9, 0xaa, 0xb2, 0xb3, 0xb4, 0xb5, 0xb6, 0xb7, 0xb8, 0xb9, 0xba, 0xc2, 0xc3, 0xc4, 0xc5, 0xc6, 0xc7, 0xc8, 0xc9, 0xca, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7, 0xd8, 0xd9, 0xda, 0xe1, 0xe2, 0xe3, 0xe4, 0xe5, 0xe6, 0xe7, 0xe8, 0xe9, 0xea, 0xf1, 0xf2, 0xf3, 0xf4, 0xf5, 0xf6, 0xf7, 0xf8, 0xf9, 0xfa]
const AC_C_L = [0, 2, 1, 2, 4, 4, 3, 4, 7, 5, 4, 4, 0, 1, 2, 0x77]
const AC_C_V = [0x00, 0x01, 0x02, 0x03, 0x11, 0x04, 0x05, 0x21, 0x31, 0x06, 0x12, 0x41, 0x51, 0x07, 0x61, 0x71, 0x13, 0x22, 0x32, 0x81, 0x08, 0x14, 0x42, 0x91, 0xa1, 0xb1, 0xc1, 0x09, 0x23, 0x33, 0x52, 0xf0, 0x15, 0x62, 0x72, 0xd1, 0x0a, 0x16, 0x24, 0x34, 0xe1, 0x25, 0xf1, 0x17, 0x18, 0x19, 0x1a, 0x26, 0x27, 0x28, 0x29, 0x2a, 0x35, 0x36, 0x37, 0x38, 0x39, 0x3a, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48, 0x49, 0x4a, 0x53, 0x54, 0x55, 0x56, 0x57, 0x58, 0x59, 0x5a, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68, 0x69, 0x6a, 0x73, 0x74, 0x75, 0x76, 0x77, 0x78, 0x79, 0x7a, 0x82, 0x83, 0x84, 0x85, 0x86, 0x87, 0x88, 0x89, 0x8a, 0x92, 0x93, 0x94, 0x95, 0x96, 0x97, 0x98, 0x99, 0x9a, 0xa2, 0xa3, 0xa4, 0xa5, 0xa6, 0xa7, 0xa8, 0xa9, 0xaa, 0xb2, 0xb3, 0xb4, 0xb5, 0xb6, 0xb7, 0xb8, 0xb9, 0xba, 0xc2, 0xc3, 0xc4, 0xc5, 0xc6, 0xc7, 0xc8, 0xc9, 0xca, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7, 0xd8, 0xd9, 0xda, 0xe2, 0xe3, 0xe4, 0xe5, 0xe6, 0xe7, 0xe8, 0xe9, 0xea, 0xf2, 0xf3, 0xf4, 0xf5, 0xf6, 0xf7, 0xf8, 0xf9, 0xfa]

/** code and length per symbol from the (counts per length, values) spec. */
function huffTable(counts, values) {
  const table = new Map()
  let code = 0
  let k = 0
  for (let len = 1; len <= 16; len++) {
    for (let i = 0; i < counts[len - 1]; i++) table.set(values[k++], [code++, len])
    code <<= 1
  }
  return table
}

const COS = []
for (let u = 0; u < 8; u++) for (let x = 0; x < 8; x++) COS[u * 8 + x] = ((u === 0 ? Math.SQRT1_2 : 1) * Math.cos(((2 * x + 1) * u * Math.PI) / 16)) / 2

function fdct(block, out) {
  const tmp = new Float64Array(64)
  for (let y = 0; y < 8; y++)
    for (let u = 0; u < 8; u++) {
      let s = 0
      for (let x = 0; x < 8; x++) s += block[y * 8 + x] * COS[u * 8 + x]
      tmp[y * 8 + u] = s
    }
  for (let u = 0; u < 8; u++)
    for (let v = 0; v < 8; v++) {
      let s = 0
      for (let y = 0; y < 8; y++) s += tmp[y * 8 + u] * COS[v * 8 + y]
      out[v * 8 + u] = s
    }
}

const scaleQ = (base, q) => {
  const s = q < 50 ? 5000 / q : 200 - q * 2
  return base.map((v) => Math.min(255, Math.max(1, Math.floor((v * s + 50) / 100))))
}

/** RGBA pixels (width x height) to a baseline JPEG Buffer. quality 1..100. */
export function encodeJpeg(rgba, width, height, quality = 86) {
  const out = []
  const marker = (m, data) => {
    out.push(0xff, m, (data.length + 2) >> 8, (data.length + 2) & 255)
    for (const b of data) out.push(b)
  }
  const qy = scaleQ(QY, quality)
  const qc = scaleQ(QC, quality)
  out.push(0xff, 0xd8)
  marker(0xe0, [0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0])
  marker(0xdb, [0, ...ZZ.map((i) => qy[i])])
  marker(0xdb, [1, ...ZZ.map((i) => qc[i])])
  marker(0xc0, [8, height >> 8, height & 255, width >> 8, width & 255, 3, 1, 0x11, 0, 2, 0x11, 1, 3, 0x11, 1])
  marker(0xc4, [0x00, ...DC_L, ...DC_V])
  marker(0xc4, [0x10, ...AC_L, ...AC_V])
  marker(0xc4, [0x01, ...DCC_L, ...DC_V])
  marker(0xc4, [0x11, ...AC_C_L, ...AC_C_V])
  marker(0xda, [3, 1, 0x00, 2, 0x11, 3, 0x11, 0, 63, 0])
  const dcY = huffTable(DC_L, DC_V)
  const acY = huffTable(AC_L, AC_V)
  const dcC = huffTable(DCC_L, DC_V)
  const acC = huffTable(AC_C_L, AC_C_V)

  let acc = 0
  let nbits = 0
  const put = (code, len) => {
    acc = (acc << len) | code
    nbits += len
    while (nbits >= 8) {
      const b = (acc >> (nbits - 8)) & 255
      out.push(b)
      if (b === 0xff) out.push(0)
      nbits -= 8
    }
    acc &= (1 << nbits) - 1
  }
  const sizeOf = (v) => {
    let a = Math.abs(v)
    let n = 0
    while (a) {
      n++
      a >>= 1
    }
    return n
  }
  const bitsOf = (v, n) => (v < 0 ? v + (1 << n) - 1 : v) & ((1 << n) - 1)

  const prev = [0, 0, 0]
  const block = new Float64Array(64)
  const dct = new Float64Array(64)
  const coef = new Int32Array(64)
  const planes = [new Float64Array(64), new Float64Array(64), new Float64Array(64)]
  for (let by = 0; by < height; by += 8) {
    for (let bx = 0; bx < width; bx += 8) {
      for (let y = 0; y < 8; y++)
        for (let x = 0; x < 8; x++) {
          const px = Math.min(width - 1, bx + x)
          const py = Math.min(height - 1, by + y)
          const o = (py * width + px) * 4
          const r = rgba[o]
          const g = rgba[o + 1]
          const b = rgba[o + 2]
          const i = y * 8 + x
          planes[0][i] = 0.299 * r + 0.587 * g + 0.114 * b - 128
          planes[1][i] = -0.168736 * r - 0.331264 * g + 0.5 * b
          planes[2][i] = 0.5 * r - 0.418688 * g - 0.081312 * b
        }
      for (let c = 0; c < 3; c++) {
        block.set(planes[c])
        fdct(block, dct)
        const q = c === 0 ? qy : qc
        for (let i = 0; i < 64; i++) coef[i] = Math.round(dct[ZZ[i]] / q[ZZ[i]])
        const dcT = c === 0 ? dcY : dcC
        const acT = c === 0 ? acY : acC
        const diff = coef[0] - prev[c]
        prev[c] = coef[0]
        const n = sizeOf(diff)
        put(...dcT.get(n))
        if (n) put(bitsOf(diff, n), n)
        let run = 0
        for (let i = 1; i < 64; i++) {
          if (coef[i] === 0) {
            run++
            continue
          }
          while (run > 15) {
            put(...acT.get(0xf0))
            run -= 16
          }
          const s = sizeOf(coef[i])
          put(...acT.get((run << 4) | s))
          put(bitsOf(coef[i], s), s)
          run = 0
        }
        if (run) put(...acT.get(0))
      }
    }
  }
  if (nbits) put((1 << (8 - nbits)) - 1, 8 - nbits)
  out.push(0xff, 0xd9)
  return Buffer.from(out)
}
