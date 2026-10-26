// Pixel diff of a landing screenshot against the owner's reference (same pixel width). Reports the mismatch
// share overall and per 100 px band, so layout drift (not live numbers) is easy to spot.
// Usage: node scripts/lc-diff.mjs <ref.png> <shot.png> <diff.png>
import fs from 'node:fs'
import { PNG } from 'pngjs'
import pixelmatch from 'pixelmatch'
const [refP, shotP, outP] = process.argv.slice(2)
const a = PNG.sync.read(fs.readFileSync(refP)), b = PNG.sync.read(fs.readFileSync(shotP))
const w = Math.min(a.width, b.width), h = Math.min(a.height, b.height)
const crop = (p) => { const o = new PNG({ width: w, height: h }); for (let y = 0; y < h; y++) p.data.copy(o.data, y * w * 4, y * p.width * 4, y * p.width * 4 + w * 4); return o }
const A = crop(a), B = crop(b), D = new PNG({ width: w, height: h })
const n = pixelmatch(A.data, B.data, D.data, w, h, { threshold: 0.15 })
fs.writeFileSync(outP, PNG.sync.write(D))
console.log(`ref ${a.width}x${a.height} shot ${b.width}x${b.height}; mismatch ${(100 * n / (w * h)).toFixed(2)}%`)
const band = 100
const rows = []
for (let y0 = 0; y0 < h; y0 += band) { let c = 0; for (let y = y0; y < Math.min(h, y0 + band); y++) for (let x = 0; x < w; x++) { const i = (y * w + x) * 4; if (D.data[i] === 255 && D.data[i + 1] === 0 && D.data[i + 2] === 0) c++ } rows.push(`${y0}:${(100 * c / (w * Math.min(band, h - y0))).toFixed(1)}`) }
console.log(rows.join(' '))
