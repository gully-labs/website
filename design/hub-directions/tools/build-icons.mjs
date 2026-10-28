// Builds shared/icons.svg: a <symbol> sprite of the Lucide icons both directions use (ISC licence, lucide-react 1.49
// as installed in the website repo). Use: <svg class="t-ic"><use href="/shared/icons.svg#i-NAME"/></svg>
// node tools/build-icons.mjs [path-to-lucide-react/dist/esm/icons]
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const DIR = process.argv[2] || 'C:/Users/Admin/Desktop/PROJECTS/website/node_modules/lucide-react/dist/esm/icons'
const NAMES = `fingerprint-pattern wallet mail users activity layout-dashboard book-open code key-round shield-check life-buoy log-in
arrow-right arrow-up-right at-sign badge-check check x copy external-link layers link zap gauge credit-card radio sparkles
user-round id-card blocks box globe lock clock rocket terminal list-checks menu chevron-right chevron-left award map
gamepad-2 cpu server send git-merge network orbit newspaper briefcase message-square file-code-2 monitor-smartphone
compass flask-conical scan-search coins store bot hammer waypoints workflow circle-dot hourglass radar trophy
bell-ring chart-no-axes-column chart-spline info table-2 bubbles circle-check circle-alert triangle-alert`.split(/\s+/)

let out = '<svg xmlns="http://www.w3.org/2000/svg" style="display:none">\n<!-- Lucide icons (ISC licence), lucide-react 1.49.0 -->\n'
for (const n of NAMES) {
  let src = readFileSync(join(DIR, n + '.mjs'), 'utf8')
  const alias = /export \{ default \} from '\.\/([\w-]+)\.mjs'/.exec(src)
  if (alias) src = readFileSync(join(DIR, alias[1] + '.mjs'), 'utf8')
  const m = /const __iconData = (\{[\s\S]*?\n\});/.exec(src) || /const __iconNode = (\[[\s\S]*?\n\]);/.exec(src)
  if (!m) throw new Error('no icon data in ' + n)
  const data = Function('return ' + m[1])()
  const node = Array.isArray(data) ? data : data.node
  const body = node.map(([tag, attrs]) => '<' + tag + Object.entries(attrs).filter(([k]) => k !== 'key').map(([k, v]) => ` ${k}="${v}"`).join('') + '/>').join('')
  out += `<symbol id="i-${n}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</symbol>\n`
}
out += '</svg>\n'
writeFileSync(join(ROOT, 'shared', 'icons.svg'), out)
console.log('icons.svg:', NAMES.length, 'icons,', out.length, 'bytes')
