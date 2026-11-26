// The Gully Labs token set: every text pair is AA (4.5:1) in both themes, both themes name the same tokens, and the
// server-drawn pages use no colour literal for text or ground outside the token module (the kit stays the only source).
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { TOKENS, TEXT_PAIRS } from '../server/gl-tokens.mjs'

const lum = (hex) => {
  const v = hex.replace('#', '').match(/../g).map((h) => parseInt(h, 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
  return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]
}
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05) }

test('both themes carry the same token names', () => {
  assert.deepEqual(Object.keys(TOKENS.light).sort(), Object.keys(TOKENS.dark).sort())
})
for (const theme of ['dark', 'light']) {
  test(`${theme}: text pairs are AA`, () => {
    for (const [fg, bg] of TEXT_PAIRS) {
      const r = ratio(TOKENS[theme][fg], TOKENS[theme][bg])
      assert.ok(r >= 4.5, `${theme} ${fg} on ${bg} is ${r.toFixed(2)}:1`)
    }
  })
}
test('kit colours: navy, blue, light blue and ground are the kit values', () => {
  assert.equal(TOKENS.dark.bg, '#0E1C38')
  assert.equal(TOKENS.dark.blue, '#3754A0')
  assert.equal(TOKENS.dark.sky, '#6F8DDF')
  assert.equal(TOKENS.light.bg, '#F1F3F8')
})
test('the landing CSS uses tokens, not white text or navy grounds', () => {
  const s = fs.readFileSync(new URL('../server/landing.mjs', import.meta.url), 'utf8')
  const css = s.slice(s.indexOf('export const CSS'), s.indexOf('const STATE_KEY'))
  assert.equal((css.match(/color:#fff\b|background:#fff\b|var\(--navy\)/gi) ?? []).length, 0)
  assert.ok(css.includes('${TOKEN_CSS}'))
})
