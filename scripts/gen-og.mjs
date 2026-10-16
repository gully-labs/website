// Renders the 1200x630 share cards in public/social/ with Chromium, from the brand's own fonts,
// lockup, mascot, project logos and stock logos. Cards carry NO figures: an image cannot stay
// current, and the site's rule is that no number is typed in. Run after changing a page's copy:
//   node scripts/gen-og.mjs
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { chromium } from 'playwright'

const root = process.cwd()
const pub = (p) => pathToFileURL(path.join(root, 'public', p)).href
const font = (pkg, file) => pathToFileURL(path.join(root, 'node_modules/@fontsource', pkg, 'files', file)).href
const out = path.join(root, 'public/social')

const PROJECTS = [
  { slug: 'cartel-family', name: 'Cartel Family', tagline: 'We trade as one', tag: 'Social trading', logo: '/assets/cartel-family.png', bg: '#12151c', accent: '#b8926a', fit: 'cover' },
  { slug: 'deepcore', name: 'DeepCore', tagline: 'Launch on one core', tag: 'DeFi infrastructure', logo: '/assets/deepcore.png', bg: '#061729', accent: '#2ee6c5', fit: 'contain' },
  { slug: 'peddleswap', name: 'PeddleSwap', tagline: 'Swap. Lock. Launch.', tag: 'DEX', logo: '/assets/peddleswap.png', bg: '#15181b', accent: '#b8f03c', fit: 'contain' },
  { slug: 'peddles', name: 'Peddles', tagline: 'Launch, trade and play', tag: 'Launchpad', logo: '/assets/peddles.png', bg: '#1c1f22', accent: '#27b6ff', fit: 'cover' },
  { slug: 'peddlequest', name: 'PeddleQuest', tagline: 'Quest on-chain, earn the proof', tag: 'Quest to earn', logo: '/assets/peddlequest.png', bg: '#0a101c', accent: '#ffd60a', fit: 'contain' },
]
const STOCK_LOGOS = ['NVDA', 'TSLA', 'AAPL', 'MSFT', 'GOOGL', 'COIN', 'PLTR', 'META'].map((t) => {
  const f = fs.readdirSync(path.join(root, 'public/tokens/logos')).find((x) => x.startsWith(`${t}.`))
  return pub(`tokens/logos/${f}`)
})

const css = `
@font-face{font-family:Barlow;font-weight:800;src:url(${font('barlow-condensed', 'barlow-condensed-latin-800-normal.woff2')})}
@font-face{font-family:Barlow;font-weight:700;src:url(${font('barlow-condensed', 'barlow-condensed-latin-700-normal.woff2')})}
@font-face{font-family:Hanken;font-weight:400;src:url(${font('hanken-grotesk', 'hanken-grotesk-latin-400-normal.woff2')})}
@font-face{font-family:Plex;font-weight:500;src:url(${font('ibm-plex-mono', 'ibm-plex-mono-latin-500-normal.woff2')})}
*{box-sizing:border-box;margin:0}
body{width:1200px;height:630px;background:#0b0e13;color:#eef0f2;font-family:Hanken;overflow:hidden;position:relative}
.pad{position:absolute;inset:64px 72px}
.word{font-family:Barlow;font-weight:800;font-size:40px;letter-spacing:.5px}
.word b{color:#e8c060;font-weight:800}
.eye{font-family:Plex;font-weight:500;font-size:20px;letter-spacing:2px;color:#e8c060;text-transform:uppercase}
h1{font-family:Barlow;font-weight:800;text-transform:uppercase;line-height:.9;letter-spacing:.5px}
h1 em{font-style:normal;color:#e8c060}
p{font-size:28px;line-height:1.4;color:#a6b0bd}
.url{font-family:Plex;font-weight:500;font-size:20px;color:#6c7888;letter-spacing:1px}
.grid{position:absolute;inset:0;background-image:linear-gradient(#1d232c55 1px,transparent 1px),linear-gradient(90deg,#1d232c55 1px,transparent 1px);background-size:60px 60px;mask-image:radial-gradient(ellipse at 80% 40%,#000 0%,transparent 70%)}
`
const brand = '<div class="word">GULLY <b>LABS</b></div>'

function page({ eyebrow, title, body, url, right = '', accent = '#e8c060', titleSize = 104 }) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>${css} h1 em{color:${accent}} .eye{color:${accent}}</style></head><body>
<div class="grid"></div>${right}
<div class="pad" style="display:flex;flex-direction:column;justify-content:space-between;width:${right ? 640 : 1056}px">
  ${brand}
  <div style="display:flex;flex-direction:column;gap:22px">
    <div class="eye">${eyebrow}</div>
    <h1 style="font-size:${titleSize}px">${title}</h1>
    ${body ? `<p style="max-width:${right ? 600 : 900}px">${body}</p>` : ''}
  </div>
  <div class="url">${url}</div>
</div>
<div style="position:absolute;left:0;right:0;bottom:0;height:8px;background:${accent}"></div>
</body></html>`
}

const mascot = `<img src="${pub('assets/mascot-scientist.png')}" style="position:absolute;right:-60px;bottom:0;height:610px;object-fit:contain;-webkit-mask-image:radial-gradient(ellipse 72% 80% at 62% 58%,#000 50%,transparent 100%);mask-image:radial-gradient(ellipse 72% 80% at 62% 58%,#000 50%,transparent 100%)">`
const stockWall = `<div style="position:absolute;right:64px;top:110px;display:grid;grid-template-columns:repeat(4,104px);gap:22px">${STOCK_LOGOS.map(
  (s, i) =>
    `<div style="width:104px;height:104px;border-radius:50%;background:#fff;display:flex;align-items:center;justify-content:center;box-shadow:0 0 0 2px #1d232c,0 12px 40px #0008;transform:translateY(${i % 2 ? 26 : 0}px)"><img src="${s}" style="width:72px;height:72px;object-fit:contain"></div>`,
).join('')}</div>
<div style="position:absolute;right:64px;bottom:96px;width:460px;display:flex;flex-direction:column;gap:12px">${[
  ['#1f9e89', 74, '+'],
  ['#1f9e89', 52, '+'],
  ['#e4572e', 36, '−'],
].map(([c, w, sign]) => `<div style="display:flex;align-items:center;gap:14px"><div style="height:14px;width:${w}%;border-radius:7px;background:${c}"></div><span style="font-family:Plex;font-size:20px;color:${c}">${sign}gap</span></div>`).join('')}</div>`
const codeCard = (lines) =>
  `<div style="position:absolute;right:64px;top:150px;width:470px;border:1px solid #1d232c;border-radius:16px;background:#10141a;padding:28px;font-family:Plex;font-size:19px;line-height:1.7;color:#a6b0bd;box-shadow:0 20px 60px #0009">${lines}</div>`

const CARDS = [
  { file: 'og-home.png', html: page({ eyebrow: 'Five venues · one ledger', titleSize: 88, title: 'Built here.<br><em>Measured</em><br>live.', body: 'A blockchain development company that builds, launches and runs its own Web3 projects.', url: 'gullylabs.xyz', right: mascot }) },
  { file: 'og-tracker.png', html: page({ eyebrow: 'Live · stock token tracker', title: 'Is your stock token <em>fairly priced?</em>', body: 'Every tokenised stock on Robinhood Chain and BNB Chain against its Chainlink fair price.', url: 'gullylabs.xyz/tracker', right: stockWall, titleSize: 92 }) },
  {
    file: 'og-widget.png',
    html: page({ eyebrow: 'Embed · free', title: 'The tracker, <em>on your site</em>', body: 'A live ticker, a one-stock badge or a table of the widest gaps. One script tag.', url: 'gullylabs.xyz/widget', right: codeCard('&lt;<span style="color:#e8c060">div</span> data-gully-widget=<br>&nbsp;&nbsp;"<span style="color:#1f9e89">ticker</span>"&gt;&lt;/<span style="color:#e8c060">div</span>&gt;<br><br>&lt;<span style="color:#e8c060">script</span> async<br>&nbsp;&nbsp;src="https://gullylabs.xyz/widget.js"&gt;<br>&lt;/<span style="color:#e8c060">script</span>&gt;') }),
  },
  { file: 'og-services.png', html: page({ eyebrow: 'Services', titleSize: 84, title: 'The same team, <em>on your project</em>', body: 'Smart contracts, dApps, chain infrastructure and security audits.', url: 'gullylabs.xyz/services', right: mascot }) },
  { file: 'og-about.png', html: page({ eyebrow: 'About', titleSize: 84, title: 'We build, launch <em>and run</em> Web3', body: 'A blockchain development company releasing projects under its own name.', url: 'gullylabs.xyz/about', right: mascot }) },
  {
    file: 'og-docs.png',
    html: page({ eyebrow: 'Docs', title: 'Gully Labs <em>docs</em>', body: 'Methodology, the public API, the widget and API keys.', url: 'docs.gullylabs.xyz', right: codeCard('<span style="color:#e8c060">GET</span> /api/tracker<br><span style="color:#e8c060">GET</span> /api/tracker/history<br><br><span style="color:#6c7888"># 60 calls a minute, no key</span><br><span style="color:#6c7888"># 600 with a key</span>') }),
  },
  {
    file: 'og-developers.png',
    html: page({ eyebrow: 'Developer portal', title: 'Build on <em>live data</em>', body: 'API keys, usage and quickstarts for the Gully Labs tracker API.', url: 'developers.gullylabs.xyz', right: codeCard('curl gullylabs.xyz/api/tracker \\<br>&nbsp;&nbsp;-H "Authorization: Bearer <span style="color:#1f9e89">gl_live_…</span>"') }),
  },
  ...PROJECTS.map((p) => ({
    file: `og-project-${p.slug}.png`,
    html: page({
      eyebrow: `${p.tag} · by Gully Labs`,
      title: `${p.name}`,
      body: p.tagline,
      url: `gullylabs.xyz/projects/${p.slug}`,
      accent: p.accent,
      right: `<div style="position:absolute;right:64px;top:50%;transform:translateY(-50%);width:440px;height:248px;border-radius:24px;overflow:hidden;background:${p.bg};border-bottom:8px solid ${p.accent};box-shadow:0 30px 80px #000a;display:flex;align-items:center;justify-content:center"><img src="${pub(p.logo.slice(1))}" style="width:100%;height:100%;object-fit:${p.fit};padding:${p.fit === 'contain' ? '30px 40px' : 0}"></div>`,
    }),
  })),
]

const browser = await chromium.launch()
const page_ = await browser.newPage({ viewport: { width: 1200, height: 630 } })
for (const c of CARDS) {
  const tmp = path.join(out, `.tmp-${c.file}.html`)
  fs.writeFileSync(tmp, c.html)
  await page_.goto(pathToFileURL(tmp).href, { waitUntil: 'load' })
  await page_.evaluate(() => document.fonts.ready)
  await page_.waitForTimeout(150)
  await page_.screenshot({ path: path.join(out, c.file) })
  fs.rmSync(tmp)
  console.log('wrote', c.file)
}
await browser.close()
