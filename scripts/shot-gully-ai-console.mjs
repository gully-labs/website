// Real-browser check of the Gully AI knowledge console (admin) and the public "What Gully AI knows" docs section, at
// 390 and 1440 px: runs the vite dev server (which mounts the real /api handlers), a fake Anthropic provider, seeds some
// questions, ratings and one degraded answer, then drives Chrome and fails on console errors, sideways scroll, or a
// missing part. Screenshots go to SHOTS_DIR (default a temp folder).
//
//   node scripts/shot-gully-ai-console.mjs

import crypto from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PORT = Number(process.env.TEST_PORT) || 5199
const BASE = `http://localhost:${PORT}`
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gully-ask-shot-'))
const SHOTS = process.env.SHOTS_DIR || path.join(tmp, 'shots')
fs.mkdirSync(SHOTS, { recursive: true })
const ADMIN = crypto.randomBytes(24).toString('hex')
let failed = 0
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  ${detail}`}`)
  if (!ok) failed++
}

let down = false
const stub = http.createServer((req, res) => {
  req.resume()
  req.on('end', () => {
    if (down) {
      res.writeHead(500, { 'content-type': 'application/json' })
      return res.end('{"type":"error","error":{"type":"api_error","message":"down"}}')
    }
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ id: 'm', type: 'message', role: 'assistant', model: 'fake', content: [{ type: 'text', text: 'The tracker compares tokenised stocks with their fair price [1].' }], stop_reason: 'end_turn', usage: { input_tokens: 900, output_tokens: 60, cache_read_input_tokens: 700 } }))
  })
})
await new Promise((r) => stub.listen(0, '127.0.0.1', r))

const env = { ...process.env, DATA_DIR: tmp, ADMIN_TOKEN: ADMIN, ANTHROPIC_API_KEY: 'sk-ant-shot-test-0000000000000000', ANTHROPIC_API_URL: `http://127.0.0.1:${stub.address().port}`, ASK_REMOTE: 'off', ASK_RETRY_BASE_MS: '5', TRACKER_LOOP: 'off', TRACKER_SKIP_APIS: '1', ASK_PRICE_INPUT_PER_MTOK: '1', ASK_PRICE_OUTPUT_PER_MTOK: '5' }
const vite = spawn(process.execPath, [path.join(ROOT, 'node_modules/vite/bin/vite.js'), '--port', String(PORT), '--strictPort'], { cwd: ROOT, env, stdio: 'pipe' })
let viteLog = ''
vite.stdout.on('data', (d) => (viteLog += d))
vite.stderr.on('data', (d) => (viteLog += d))
const stop = () => {
  vite.kill()
  stub.close()
}
try {
  for (let i = 0; i < 120; i++) {
    if (/Local:/.test(viteLog)) break
    await new Promise((r) => setTimeout(r, 500))
  }
  const post = (p, body, h = {}) => fetch(BASE + p, { method: 'POST', headers: { 'content-type': 'application/json', 'x-requested-with': 'gully', 'cf-connecting-ip': `203.0.113.${1 + Math.floor(Math.random() * 250)}`, ...h }, body: JSON.stringify(body) }).then((r) => r.json())
  const answers = []
  for (const q of ['How do gap alerts work?', 'What is the Holder Map?', 'What does Gully Pay cost?', 'How long are questions kept?', 'Is there an API?']) answers.push(await post('/api/ask', { question: q }))
  await post('/api/ask/feedback', { id: answers[0].id, rating: 'down' })
  down = true
  const dg = await post('/api/ask', { question: 'What is Swoop Ads?' })
  down = false
  check('seed: a degraded answer comes back with docs passages', dg.degraded === 'provider' && dg.citations?.length > 0, JSON.stringify(dg).slice(0, 200))

  const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : process.platform === 'win32' ? { executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' } : {})
  for (const [w, h] of [[390, 844], [1440, 900]]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h } })
    await ctx.addInitScript((t) => sessionStorage.setItem('gully-admin-token', t), ADMIN)
    const page = await ctx.newPage()
    const errors = []
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
    page.on('pageerror', (e) => errors.push(String(e)))
    await page.goto(`${BASE}/admin#ai`, { waitUntil: 'networkidle', timeout: 90_000 })
    await page.waitForSelector('[data-testid="ask-knowledge"]', { timeout: 60_000 })
    await page.waitForSelector('[data-testid="ask-coverage"] li', { timeout: 30_000 })
    await page.waitForSelector('[data-testid="ask-capacity"] [role=meter]', { timeout: 30_000 })
    await page.click('[data-testid="ask-coverage"] li:first-child button')
    await page.waitForTimeout(400)
    for (const id of ['ask-knowledge', 'ask-capacity', 'ask-queues', 'ask-eval']) {
      const el = page.locator(`[data-testid="${id}"]`)
      await el.scrollIntoViewIfNeeded()
      check(`admin ${w}: ${id} renders`, (await el.count()) === 1)
    }
    await page.click('[data-testid="ask-eval"] button:has-text("retrieval check")')
    await page.waitForSelector('[data-testid="ask-eval"] :text("LAST RUN")', { timeout: 30_000 })
    const rows = await page.locator('[data-testid="ask-coverage"] li').count()
    check(`admin ${w}: the coverage matrix lists the products`, rows >= 15, `${rows}`)
    check(`admin ${w}: the capacity tile shows a cost from the prices set`, /\$\d/.test(await page.locator('[data-testid="ask-capacity"]').innerText()))
    check(`admin ${w}: the rated-down queue shows the answer`, /tracker compares/.test(await page.locator('[data-testid="ask-queues"]').innerText()))
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    check(`admin ${w}: no sideways scroll`, overflow <= 1, `${overflow}px`)
    await page.locator('[data-testid="ask-knowledge"]').screenshot({ path: path.join(SHOTS, `admin-knowledge-${w}.png`) })
    await page.locator('[data-testid="ask-capacity"]').screenshot({ path: path.join(SHOTS, `admin-capacity-${w}.png`) })
    await page.locator('[data-testid="ask-eval"]').screenshot({ path: path.join(SHOTS, `admin-eval-${w}.png`) })
    check(`admin ${w}: no console errors`, !errors.some((e) => !/favicon|Failed to load resource.*(404|401)/.test(e)), errors.join(' | ').slice(0, 300))

    const dp = await ctx.newPage()
    const derrors = []
    dp.on('console', (m) => m.type() === 'error' && derrors.push(m.text()))
    await dp.goto(`${BASE}/docs/gully-ai#knows`, { waitUntil: 'networkidle', timeout: 90_000 })
    await dp.waitForSelector('[data-testid="ask-knowledge-public"] details', { timeout: 30_000 })
    await dp.waitForSelector('[data-testid="ask-dataflow"] ol li', { timeout: 30_000 })
    const txt = await dp.locator('[data-testid="ask-dataflow"]').innerText()
    check(`docs ${w}: providers, retention and the deletion path are on the page`, /Anthropic/.test(txt) && /90 days/.test(txt) && /Delete a question/.test(txt))
    await dp.locator('[data-testid="ask-knowledge-public"] details').first().click()
    const o2 = await dp.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    check(`docs ${w}: no sideways scroll`, o2 <= 1, `${o2}px`)
    await dp.locator('[data-testid="ask-knowledge-public"]').screenshot({ path: path.join(SHOTS, `docs-knows-${w}.png`) })
    await dp.locator('[data-testid="ask-dataflow"]').screenshot({ path: path.join(SHOTS, `docs-dataflow-${w}.png`) })
    check(`docs ${w}: no console errors`, !derrors.some((e) => !/favicon|Failed to load resource/.test(e)), derrors.join(' | ').slice(0, 300))
    await ctx.close()
  }
  // /ask in degraded mode (the fake provider is down): the page says plainly it is not a written answer.
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
    const page = await ctx.newPage()
    down = true
    await page.goto(`${BASE}/ask`, { waitUntil: 'networkidle', timeout: 90_000 })
    const box = page.locator('textarea, input[type=text]').first()
    await box.fill('What is the Holder Map?')
    await box.press('Enter')
    await page.waitForSelector('[data-testid="ask-degraded"]', { timeout: 30_000 })
    check('/ask 390: a degraded answer shows "Not a written answer" and its source links', /Not a written answer/.test(await page.locator('[data-testid="ask-degraded"]').innerText()) && (await page.locator('[aria-label="Answers"] a').count()) > 0)
    await page.screenshot({ path: path.join(SHOTS, 'ask-degraded-390.png') })
    down = false
    await ctx.close()
  }
  await browser.close()
  console.log(`screenshots: ${SHOTS}`)
} catch (e) {
  check(`no exception (${e?.stack ?? e})`, false)
}
stop()
console.log(failed ? `${failed} failed` : 'all passed')
if (viteLog && failed) console.log(viteLog.slice(-1500))
process.exit(failed ? 1 : 0)
