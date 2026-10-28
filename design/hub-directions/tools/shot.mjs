// Full-page screenshots through headless Chrome's DevTools protocol (no dependencies; Node 22+ global WebSocket).
// node tools/shot.mjs <url> <out.png> <width> [height=900] [waitMs=6000] [--viewport]
// Prints the document height (in viewports) and whether the page scrolls sideways.
import { spawn } from 'node:child_process'
import { writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const [url, outFile, width = '1440', height = '900', wait = '6000'] = process.argv.slice(2)
const viewportOnly = process.argv.includes('--viewport')
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const port = 9300 + Math.floor(Math.random() * 500)
const prof = mkdtempSync(join(tmpdir(), 'glshot-'))
const ch = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${prof}`, '--hide-scrollbars', '--no-first-run', '--disable-gpu', 'about:blank'], { stdio: 'ignore' })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let target
for (let i = 0; i < 50 && !target; i++) { await sleep(200); try { target = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((t) => t.type === 'page') } catch {} }
const ws = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((r) => ws.addEventListener('open', r, { once: true }))
let id = 0; const pend = new Map()
ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id) } })
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })) })
const W = +width, H = +height, mobile = W < 600
await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: mobile ? 2 : 1, mobile })
if (mobile) await send('Emulation.setTouchEmulationEnabled', { enabled: true })
await send('Page.enable')
await send('Page.navigate', { url })
await sleep(+wait)
const ev = async (expr) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true })).result.result.value
const docH = await ev('Math.max(document.documentElement.scrollHeight, document.body.scrollHeight)')
const sw = await ev('document.documentElement.scrollWidth')
const errs = await ev('window.__errs ? window.__errs.join(" | ") : ""')
const shot = await send('Page.captureScreenshot', viewportOnly ? { format: 'png' } : { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: 0, width: W, height: docH, scale: 1 } })
writeFileSync(outFile, Buffer.from(shot.result.data, 'base64'))
console.log(JSON.stringify({ url, outFile, width: W, docHeight: docH, viewports: +(docH / H).toFixed(2), horizontalScroll: sw > W, scrollWidth: sw, errors: errs }))
ws.close(); ch.kill()
