#!/usr/bin/env node
/* Writes the blog theme's icon partials (ghost/theme/gully/partials/icons/*.hbs) as inline SVG.

   Line icons come from lucide (ISC licence, the same set the site uses through lucide-react).
   Brand marks (X, GitHub, Telegram) are the simple-icons paths the site's SocialIcon uses.

   Usage: node scripts/blog-theme-icons.mjs [path/to/node_modules/lucide-react]
   Defaults to ./node_modules/lucide-react. The partials are committed, so this only needs to run
   when an icon is added or changed. */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const lucide = process.argv[2] || join(root, 'node_modules', 'lucide-react')
const out = join(root, 'ghost', 'theme', 'gully', 'partials', 'icons')
mkdirSync(out, { recursive: true })

/* lucide name -> partial name. Keep this list in step with the templates. */
const ICONS = [
  'activity', 'chart-no-axes-combined', 'boxes', 'network', 'circle-dollar-sign', 'bot',
  'key-round', 'file-json', 'package', 'puzzle', 'history', 'flask-conical', 'tag', 'layers',
  'info', 'mail', 'newspaper', 'chevron-down', 'menu', 'x', 'arrow-up-right', 'arrow-right',
  'arrow-left', 'hash', 'rss', 'link', 'check', 'house', 'book-open', 'clock', 'calendar',
  'user', 'search', 'rocket', 'code', 'wrench', 'megaphone', 'file-text', 'zap', 'git-branch',
  'message-circle-question', 'send', 'copy', 'bell-ring',
]

const pkg = JSON.parse(readFileSync(join(lucide, 'package.json'), 'utf8'))
const attrs = (o) => Object.entries(o).filter(([k]) => k !== 'key').map(([k, v]) => `${k}="${v}"`).join(' ')

for (const name of ICONS) {
  const file = join(lucide, 'dist', 'esm', 'icons', `${name}.mjs`)
  if (!existsSync(file)) throw new Error(`lucide icon not found: ${name}`)
  let src = readFileSync(file, 'utf8')
  // Renamed icons are re-exports of their new name: follow them.
  const alias = src.match(/export \{ default \} from '\.\/([\w-]+)\.mjs'/)
  if (alias) src = readFileSync(join(lucide, 'dist', 'esm', 'icons', `${alias[1]}.mjs`), 'utf8')
  const m = src.match(/const __iconData = (\{[\s\S]*?\n\});/)
  if (!m) throw new Error(`could not parse ${name}`)
  // The icon data is a plain JS literal (strings, arrays, objects); evaluate it in isolation.
  const { node } = Function(`"use strict"; return (${m[1]})`)()
  const inner = node.map(([tag, a]) => `<${tag} ${attrs(a)}/>`).join('')
  const svg = `<svg class="gl-icon gl-icon-${name}" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${inner}</svg>`
  writeFileSync(join(out, `${name}.hbs`), `{{!-- lucide ${pkg.version} "${name}" (ISC) --}}\n${svg}\n`)
}

const BRANDS = {
  'brand-x': 'M18.901 1.153h3.68l-8.04 9.19L24 22.846h-7.406l-5.8-7.584-6.638 7.584H.474l8.6-9.83L0 1.154h7.594l5.243 6.932ZM17.61 20.644h2.039L6.486 3.24H4.298Z',
  'brand-github':
    'M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12',
  'brand-telegram':
    'M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z',
}
for (const [name, d] of Object.entries(BRANDS)) {
  const svg = `<svg class="gl-icon gl-icon-${name}" width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false"><path d="${d}"/></svg>`
  writeFileSync(join(out, `${name}.hbs`), `{{!-- simple-icons "${name.slice(6)}" (CC0) --}}\n${svg}\n`)
}
console.log(`wrote ${ICONS.length + Object.keys(BRANDS).length} icons to ${out}`)
