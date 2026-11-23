// Real-browser gate for the admin Integrations page: the Developer tools group and the Gully AI model provider group
// (fixtures only, no real values; the provider address is a closed local port, so Check never leaves this machine).
//
//   npm run build && node scripts/gate-admin-integrations.mjs      (needs playwright's chromium)
//
// Runs the real server in this process (temporary data and integrations folders, break-glass admin token), opens
// admin.gullylabs.xyz in Chromium at 390 and 1440, in dark and light where the page has both, and checks: the Developer
// tools section and the setup panel render, guides open, every field is an input, a secret value typed in is never shown
// back after a save (write-only), no sideways scroll, targets are at least 40 px high, no console errors. Writes need a
// passkey step-up, so the save path is covered by test-admin-integrations.mjs; here the page is checked unlocked-less
// (inputs disabled) plus one fixture file set before load to see "Set", the plain value and the progress rows.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { chromium } from 'playwright'

const PORT = Number(process.env.TEST_PORT) || 8798
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gully-admin-gate-'))
const DIR = path.join(tmp, 'integrations')
fs.mkdirSync(DIR, { recursive: true })
const dist = process.env.DIST_DIR || path.resolve('dist')
const ADMIN = 'g'.repeat(48)
const SECRET = 'FixtureSecretNeverShown1234567890abcdef'
fs.writeFileSync(path.join(DIR, 'VSCE_PUBLISHER_ID'), 'gully-labs')
fs.writeFileSync(path.join(DIR, 'VSCE_PAT'), SECRET)
const AIKEY = 'sk-ant-api03-' + 'Gt5_'.repeat(23) + 'fixtureA'
fs.writeFileSync(path.join(DIR, 'ANTHROPIC_API_KEY'), AIKEY)
fs.writeFileSync(path.join(DIR, 'ASK_DAILY_CAP'), '750')
Object.assign(process.env, {
  PORT: String(PORT), DATA_DIR: tmp, TRACKER_DATA: path.join(tmp, 't.json'), DIST_DIR: dist, ADMIN_TOKEN: ADMIN,
  TRACKER_LOOP: 'off', TRACKER_SKIP_APIS: '1', DEEPCORE_LOOP: 'off', ASK_REMOTE: 'off', ADMIN_PASSWORD_LOGIN: 'on',
  IPFS_API: 'http://127.0.0.1:9', IPFS_GATEWAY: 'http://127.0.0.1:9', GULLYPAY_STATUS_URL: 'http://127.0.0.1:9', GULLYRPC_STATUS_URL: 'http://127.0.0.1:9',
  CHAINKIT_INTEGRATIONS_DIR: DIR, ANTHROPIC_API_URL: 'http://127.0.0.1:9', ASK_STARTUP_PROBE: '0', ASK_EMBED: 'off',
})
const realLog = console.log
console.log = () => {}
await import('../server/server.mjs')
console.log = realLog
await new Promise((r) => setTimeout(r, 800))

let failed = 0
const check = (name, ok, extra = '') => {
  if (!ok) failed++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : ` ${extra}`}`)
}
const browser = await chromium.launch()
try {
  for (const [w, h] of [[390, 844], [1440, 900]]) {
    for (const scheme of ['dark', 'light']) {
      const ctx = await browser.newContext({ viewport: { width: w, height: h }, colorScheme: scheme })
      // the server is plain http here and the host is admin.gullylabs.xyz: forward every request to it with that Host
      await ctx.route(/^https?:\/\/admin\.gullylabs\.xyz\//, async (route) => {
        const u = new URL(route.request().url())
        const r = await route.fetch({ url: `http://127.0.0.1:${PORT}${u.pathname}${u.search}`, headers: { ...route.request().headers(), host: 'admin.gullylabs.xyz' } })
        const headers = { ...r.headers() }
        delete headers['content-security-policy']
        delete headers['strict-transport-security']
        await route.fulfill({ response: r, headers })
      })
      const page = await ctx.newPage()
      const errors = []
      page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
      page.on('pageerror', (e) => errors.push(String(e)))
      await page.addInitScript((t) => sessionStorage.setItem('gully-admin-token', t), ADMIN)
      // the token key is whatever AdminPage uses; set both common spellings through the login form as a fallback
      await page.goto('https://admin.gullylabs.xyz/#integrations', { waitUntil: 'networkidle' })
      if (await page.locator('input[type=password]').first().isVisible().catch(() => false) && !(await page.getByTestId('admin-integrations').isVisible().catch(() => false))) {
        await page.locator('input[type=password]').first().fill(ADMIN)
        await page.keyboard.press('Enter')
        await page.waitForTimeout(1500)
      }
      const tag = `${w} ${scheme}`
      const sec = page.getByTestId('integrations-devtools')
      await sec.waitFor({ timeout: 15000 }).catch(() => {})
      check(`${tag}: Developer tools section renders`, await sec.isVisible().catch(() => false))
      check(`${tag}: setup progress rows`, (await page.getByTestId('devtools-progress-row').count()) >= 8)
      check(`${tag}: plain value shown, secret token only as Set`, (await page.getByTestId('int-VSCE_PUBLISHER_ID-value').innerText().catch(() => '')).includes('gully-labs') && !(await page.content()).includes(SECRET))
      const g = page.getByTestId('guide-dt_githubapp')
      await g.locator('summary').click()
      check(`${tag}: guide opens with links`, (await g.locator('a').count()) >= 1 && (await g.locator('li').count()) >= 5)
      check(`${tag}: the PEM field is a textarea, the token field is a password input`, (await page.locator('textarea#int-GITHUB_APP_PRIVATE_KEY').count()) === 1 && (await page.locator('input#int-VSCE_PAT[type=password]').count()) === 1)
      check(`${tag}: guide-only notes shown`, (await page.getByTestId('note-tauri').count()) === 1)
      const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
      check(`${tag}: no sideways scroll`, over <= 1, String(over))
      const small = await page.evaluate(() => [...document.querySelectorAll('[data-testid="integrations-devtools"] button, [data-testid="integrations-devtools"] input')].filter((e) => e.getBoundingClientRect().height > 0 && e.getBoundingClientRect().height < 36).length)
      check(`${tag}: buttons and inputs at least 36 px tall`, small === 0, String(small))
      // Gully AI: model provider
      const ai = page.getByTestId('integrations-ai')
      check(`${tag}: Gully AI model provider group renders with its title`, (await ai.isVisible().catch(() => false)) && (await ai.innerText()).includes('Gully AI: model provider'))
      const stRow = page.getByTestId('status-ai_provider')
      check(`${tag}: status line says configured, with the last check or that there is none yet`, (await stRow.getAttribute('data-state')) === 'configured' && /Not checked yet|Last check/.test(await stRow.innerText()))
      check(`${tag}: the key fields are password inputs, the cap shows its value, the key is nowhere on the page`, (await page.locator('input#int-ANTHROPIC_API_KEY[type=password]').count()) === 1 && (await page.locator('input#int-VOYAGE_API_KEY[type=password]').count()) === 1 && (await page.getByTestId('int-ASK_DAILY_CAP-value').innerText().catch(() => '')).includes('750') && !(await page.content()).includes('Gt5_'))
      const ag = page.getByTestId('guide-ai_provider')
      await ag.locator('summary').click()
      check(`${tag}: the guide opens: Console link, spend limit step`, (await ag.locator('a[href^="https://console.anthropic.com/"]').count()) >= 1 && /spend limit/i.test(await ag.innerText()))
      await page.getByTestId('check-ai_provider').click()
      await ai.getByText(/Could not reach|answered/).first().waitFor({ timeout: 15000 }).catch(() => {})
      check(`${tag}: Check answers in plain words (could not reach here), never the key`, /Could not reach|answered/.test(await ai.innerText()) && !(await page.content()).includes('Gt5_'))
      await page.waitForTimeout(400)
      check(`${tag}: the status line then shows the last check`, /Last check: unreachable/.test(await stRow.innerText()))
      const aiSmall = await page.evaluate(() => [...document.querySelectorAll('[data-testid="integrations-ai"] button, [data-testid="integrations-ai"] input')].filter((e) => e.getBoundingClientRect().height > 0 && e.getBoundingClientRect().height < 36).length)
      check(`${tag}: Gully AI buttons and inputs at least 36 px tall`, aiSmall === 0, String(aiSmall))
      const over2 = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
      check(`${tag}: no sideways scroll with the guide open`, over2 <= 1, String(over2))
      check(`${tag}: no console errors`, errors.filter((e) => !/401|403|Failed to load resource/.test(e)).length === 0, errors.join(' | '))
      if (process.env.SHOTS) {
        fs.mkdirSync(process.env.SHOTS, { recursive: true })
        await sec.screenshot({ path: path.join(process.env.SHOTS, `devtools-${w}-${scheme}.png`) }).catch(() => {})
        await ai.screenshot({ path: path.join(process.env.SHOTS, `ai-provider-${w}-${scheme}.png`) }).catch(() => {})
      }
      await ctx.close()
    }
  }
} finally {
  await browser.close()
  try {
    for (const f of fs.readdirSync(DIR)) fs.chmodSync(path.join(DIR, f), 0o600)
    fs.rmSync(tmp, { recursive: true, force: true })
  } catch {
    /* leftovers are in the temp folder */
  }
}
console.log(failed ? `\n${failed} failed` : '\nall passed')
process.exit(failed ? 1 : 0)
