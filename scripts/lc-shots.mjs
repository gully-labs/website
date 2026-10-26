// Lab console layout check: screenshots + no horizontal scroll + one-line header + axe, per route and width.
// Usage: node scripts/lc-shots.mjs <baseUrl> <outDir> [routes comma list] [widths comma list] [--axe]
import { chromium } from 'playwright'
import fs from 'node:fs'
const [base, out, routesArg, widthsArg] = process.argv.slice(2)
const axe = process.argv.includes('--axe')
const routes = (routesArg || '/').split(',')
const widths = (widthsArg || '1920').split(',').map(Number)
fs.mkdirSync(out, { recursive: true })
const browser = await chromium.launch()
const results = []
try {
  for (const w of widths) {
    const ctx = await browser.newContext({ viewport: { width: w, height: w < 600 ? 844 : 1000 }, deviceScaleFactor: Number(process.env.DPR || 1), bypassCSP: true })
    const page = await ctx.newPage()
    for (const r of routes) {
      await page.goto(base + r, { waitUntil: 'domcontentloaded', timeout: 240000 })
      await page.waitForTimeout(Number(process.env.WAIT || 9000))
      await page.addStyleTag({ content: '.toasts{display:none!important}' })
      const m = await page.evaluate(() => {
        const nav = document.querySelector('header.nav')
        const navH = nav ? nav.getBoundingClientRect().height : 0
        return { sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, h: document.documentElement.scrollHeight, navH }
      })
      let violations = null
      if (axe) {
        await page.addScriptTag({ path: 'node_modules/axe-core/axe.min.js' })
        violations = await page.evaluate(async () => {
          const r = await window.axe.run(document, { resultTypes: ['violations'] })
          return r.violations.map((v) => `${v.id}(${v.nodes.length}): ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`)
        })
      }
      const name = `${r === '/' ? 'home' : r.replace(/[^a-z0-9]+/gi, '_')}-${w}.png`
      if (!process.env.NOSHOT) await page.screenshot({ path: `${out}/${name}`, fullPage: true })
      results.push({ r, w, hscroll: m.sw > m.cw, navH: m.navH, vh: +(m.h / (w < 600 ? 844 : 900)).toFixed(2), violations })
    }
    await ctx.close()
  }
} finally {
  await browser.close()
}
for (const x of results) console.log(JSON.stringify(x))
