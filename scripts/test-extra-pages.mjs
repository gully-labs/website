// /downloads, /explain, /ai-tools (server/extra-pages.mjs): whole pages from the server, kit rules kept.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import crypto from 'node:crypto'
import { renderAiTools, renderDownloads, renderExplain } from '../server/extra-pages.mjs'

const head = '<title>t</title>'
test('the downloads kit copy is byte-identical to its SHA256SUMS', () => {
  const dir = new URL('../server/vendor/gully-downloads/', import.meta.url)
  for (const line of fs.readFileSync(new URL('SHA256SUMS', dir), 'utf8').trim().split('\n')) {
    const [sum, name] = line.trim().split(/\s+\*?/)
    assert.equal(crypto.createHash('sha256').update(fs.readFileSync(new URL(name, dir))).digest('hex'), sum, name)
  }
})
test('/downloads: every group, coming soon items carry no store link or badge, live files carry a checksum', () => {
  const html = renderDownloads(head)
  const m = JSON.parse(fs.readFileSync(new URL('../server/data/gully-downloads.json', import.meta.url), 'utf8'))
  for (const g of m.groups) assert.ok(html.includes(`id="dl-${g.id}"`), g.id)
  for (const card of html.split('<article').slice(1).filter((c) => c.includes('data-state="soon"'))) {
    assert.ok(!/gdl-btn|gdl-badge/.test(card), 'a soon card has no download button or badge')
  }
  for (const it of m.groups.flatMap((g) => g.items).filter((i) => i.file && i.state !== 'soon')) assert.ok(html.includes(it.sha256), it.id)
  assert.equal((html.match(/<h1[\s>]/g) ?? []).length, 1)
  assert.ok(html.includes('application/ld+json'))
})
test('/explain: form only when the flag is on, an honest closed state otherwise', () => {
  const old = process.env.AI_EXPLAIN_TX
  process.env.AI_EXPLAIN_TX = '0'
  assert.ok(!renderExplain(head).includes('id="xform"') && renderExplain(head).includes('Opening soon'))
  process.env.AI_EXPLAIN_TX = '1'
  const on = renderExplain(head)
  assert.ok(on.includes('id="xform"') && on.includes('/gl-kit/explain.js') && on.includes('fixed template'))
  if (old === undefined) delete process.env.AI_EXPLAIN_TX; else process.env.AI_EXPLAIN_TX = old
})
test('/ai-tools: every tool says Live or Coming soon; nothing unpublished is offered as an install that works today', () => {
  const html = renderAiTools(head)
  assert.ok(html.includes('Coming soon') && html.includes('Live'))
  assert.ok(html.includes('Not on npm yet'))
  assert.ok(!/admin\.|internal|e2e/i.test(html.slice(html.indexOf('<main>'), html.indexOf('</main>'))))
})
