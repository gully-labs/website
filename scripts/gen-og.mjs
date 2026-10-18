// Renders the 1200x630 share cards in public/social/ with Chromium, from the brand's own fonts, the
// brand kit's wordmark and mascot (public/brand, see scripts/brand-from-kit.mjs), project logos and stock logos. Cards carry NO figures: an image cannot stay
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
  { slug: 'cartel-family', name: 'Cartel Family', tagline: 'We trade as one', tag: 'Social trading', logo: '/assets/cartel-family.webp', bg: '#12151c', accent: '#b8926a', fit: 'cover' },
  { slug: 'deepcore', name: 'DeepCore', tagline: 'Launch on one core', tag: 'DeFi infrastructure', logo: '/assets/deepcore.webp', bg: '#061729', accent: '#2ee6c5', fit: 'contain' },
  { slug: 'peddleswap', name: 'PeddleSwap', tagline: 'Swap. Lock. Launch.', tag: 'DEX', logo: '/assets/peddleswap.webp', bg: '#15181b', accent: '#b8f03c', fit: 'contain' },
  { slug: 'peddles', name: 'Peddles', tagline: 'Launch, trade and play', tag: 'Launchpad', logo: '/assets/peddles.webp', bg: '#1c1f22', accent: '#27b6ff', fit: 'cover' },
  { slug: 'peddlequest', name: 'PeddleQuest', tagline: 'Quest on-chain, earn the proof', tag: 'Quest to earn', logo: '/assets/peddlequest.webp', bg: '#0a101c', accent: '#ffd60a', fit: 'contain' },
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
body{width:1200px;height:630px;background:#0d141c;color:#f4f2ec;font-family:Hanken;overflow:hidden;position:relative}
.pad{position:absolute;inset:64px 72px}
.word{display:block;height:40px;width:auto;align-self:flex-start}
.eye{font-family:Plex;font-weight:500;font-size:20px;letter-spacing:2px;color:#d9b563;text-transform:uppercase}
h1{font-family:Barlow;font-weight:800;text-transform:uppercase;line-height:.9;letter-spacing:.5px}
h1 em{font-style:normal;color:#d9b563}
p{font-size:28px;line-height:1.4;color:#aeb5be}
.url{font-family:Plex;font-weight:500;font-size:20px;color:#6c7888;letter-spacing:1px}
.grid{position:absolute;inset:0;background-image:linear-gradient(#1f293555 1px,transparent 1px),linear-gradient(90deg,#1f293555 1px,transparent 1px);background-size:60px 60px;mask-image:radial-gradient(ellipse at 80% 40%,#000 0%,transparent 70%)}
`
// The brand kit's wordmark, byte for byte (public/brand/gullylabs-wordmark-on-dark.svg), 40 px tall.
const brand = `<img class="word" src="${pub('brand/gullylabs-wordmark-on-dark.svg')}" alt="Gully Labs">`

function page({ eyebrow, title, body, url, right = '', accent = '#d9b563', titleSize = 104 }) {
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

// The kit's mascot master render (png/mascot/gullylabs-mascot-00-scientist-1024.png).
const mascot = `<img src="${pub('brand/gullylabs-mascot-00-scientist-1024.png')}" style="position:absolute;right:-60px;bottom:0;height:610px;object-fit:contain;-webkit-mask-image:radial-gradient(ellipse 72% 80% at 62% 58%,#000 50%,transparent 100%);mask-image:radial-gradient(ellipse 72% 80% at 62% 58%,#000 50%,transparent 100%)">`
const stockWall = `<div style="position:absolute;right:64px;top:110px;display:grid;grid-template-columns:repeat(4,104px);gap:22px">${STOCK_LOGOS.map(
  (s, i) =>
    `<div style="width:104px;height:104px;border-radius:50%;background:#fff;display:flex;align-items:center;justify-content:center;box-shadow:0 0 0 2px #1f2935,0 12px 40px #0008;transform:translateY(${i % 2 ? 26 : 0}px)"><img src="${s}" style="width:72px;height:72px;object-fit:contain"></div>`,
).join('')}</div>
<div style="position:absolute;right:64px;bottom:96px;width:460px;display:flex;flex-direction:column;gap:12px">${[
  ['#26ab94', 74, '+'],
  ['#26ab94', 52, '+'],
  ['#f2704a', 36, '−'],
].map(([c, w, sign]) => `<div style="display:flex;align-items:center;gap:14px"><div style="height:14px;width:${w}%;border-radius:7px;background:${c}"></div><span style="font-family:Plex;font-size:20px;color:${c}">${sign}gap</span></div>`).join('')}</div>`
const codeCard = (lines) =>
  `<div style="position:absolute;right:64px;top:150px;width:470px;border:1px solid #1f2935;border-radius:16px;background:#151d28;padding:28px;font-family:Plex;font-size:19px;line-height:1.7;color:#aeb5be;box-shadow:0 20px 60px #0009">${lines}</div>`

const CARDS = [
  { file: 'og-home.png', html: page({ eyebrow: 'Five venues · one ledger', titleSize: 88, title: 'Built here.<br><em>Measured</em><br>live.', body: 'A blockchain development company that builds, launches and runs its own Web3 projects.', url: 'gullylabs.xyz', right: mascot }) },
  { file: 'og-tracker.png', html: page({ eyebrow: 'Live · stock token tracker', title: 'Is your stock token <em>fairly priced?</em>', body: 'Every tokenised stock on Robinhood Chain and BNB Chain against its Chainlink fair price.', url: 'gullylabs.xyz/tracker', right: stockWall, titleSize: 92 }) },
  {
    file: 'og-widget.png',
    html: page({ eyebrow: 'Embed · free', title: 'The tracker, <em>on your site</em>', body: 'A live ticker, a one-stock badge or a table of the widest gaps. One script tag.', url: 'gullylabs.xyz/widget', right: codeCard('&lt;<span style="color:#d9b563">div</span> data-gully-widget=<br>&nbsp;&nbsp;"<span style="color:#26ab94">ticker</span>"&gt;&lt;/<span style="color:#d9b563">div</span>&gt;<br><br>&lt;<span style="color:#d9b563">script</span> async<br>&nbsp;&nbsp;src="https://gullylabs.xyz/widget.js"&gt;<br>&lt;/<span style="color:#d9b563">script</span>&gt;') }),
  },
  { file: 'og-services.png', html: page({ eyebrow: 'Services', titleSize: 84, title: 'The same team, <em>on your project</em>', body: 'Smart contracts, dApps, chain infrastructure and security testing.', url: 'gullylabs.xyz/services', right: mascot }) },
  { file: 'og-about.png', html: page({ eyebrow: 'About', titleSize: 84, title: 'We build, launch <em>and run</em> Web3', body: 'A blockchain development company releasing projects under its own name.', url: 'gullylabs.xyz/about', right: mascot }) },
  {
    file: 'og-docs.png',
    html: page({ eyebrow: 'Docs', title: 'Gully Labs <em>docs</em>', body: 'Methodology, the public API, the widget and API keys.', url: 'docs.gullylabs.xyz', right: codeCard('<span style="color:#d9b563">GET</span> /api/tracker<br><span style="color:#d9b563">GET</span> /api/tracker/history<br><br><span style="color:#6c7888"># 60 calls a minute, no key</span><br><span style="color:#6c7888"># 600 with a key</span>') }),
  },
  {
    file: 'og-ask.png',
    html: page({ eyebrow: 'Gully AI', title: 'Ask <em>Gully AI</em>', body: 'Answers about the tracker, its API, plans and products, from the docs and the site, with sources.', url: 'gullylabs.xyz/ask', right: codeCard('<span style="color:#6c7888"># you</span><br>How do gap alerts work?<br><br><span style="color:#6c7888"># Gully AI</span><br>An alert fires when a stock\'s<br>gap crosses your threshold <span style="color:#d9b563">[1]</span><br><br><span style="color:#6c7888">[1] docs · Plans &amp; alerts</span>') }),
  },
  {
    file: 'og-developers.png',
    html: page({ eyebrow: 'Gully Labs App', title: 'Build on <em>live data</em>', body: 'API keys, alerts, analytics and payments for every Gully Labs product, in one app.', url: 'app.gullylabs.xyz', right: codeCard('curl gullylabs.xyz/api/tracker \\<br>&nbsp;&nbsp;-H "Authorization: Bearer <span style="color:#26ab94">gl_live_…</span>"') }),
  },
  {
    file: 'og-pricing.png',
    html: page({ eyebrow: 'Pricing · tracker API', title: 'More calls, <em>alerts and history</em>', body: 'Pay in USDC on Base from your own wallet. No card, no custody, nothing that renews behind your back.', url: 'gullylabs.xyz/pricing', right: codeCard('<span style="color:#6c7888"># gap alert, signed</span><br>POST your-app.com/hook<br>X-Gully-Signature: <span style="color:#26ab94">sha256=…</span><br><br>{ <span style="color:#d9b563">"ticker"</span>: "NVDA",<br>&nbsp;&nbsp;<span style="color:#d9b563">"gapPct"</span>: 2.4 }'), titleSize: 88 }),
  },
  {
    file: 'og-analytics.png',
    html: page({ eyebrow: 'Gully Analytics', title: 'Analytics that see <em>the wallet</em>', body: 'Page views plus wallet connects, chains and transactions, with a visit → wallet → transaction funnel.', url: 'gullylabs.xyz/analytics', right: codeCard('&lt;<span style="color:#d9b563">script</span> defer<br>&nbsp;&nbsp;src="analytics.gullylabs.xyz/script.js"<br>&nbsp;&nbsp;data-web3="<span style="color:#26ab94">true</span>"&gt;<br>&lt;/<span style="color:#d9b563">script</span>&gt;'), titleSize: 88 }),
  },
  {
    file: 'og-chain-kit.png',
    html: page({ eyebrow: 'Chain Kit', title: 'An explorer for <em>your chain</em>', body: 'A branded Blockscout block explorer for your EVM chain, deployed and operated by Gully Labs.', url: 'gullylabs.xyz/chain-kit', right: codeCard('<span style="color:#6c7888"># your chain, your brand</span><br>CHAIN_ID=<span style="color:#26ab94">4663</span><br>CHAIN_TYPE=<span style="color:#26ab94">arbitrum</span><br>NETWORK_NAME="Your Chain"<br>ACCENT=<span style="color:#d9b563">#D9B563</span>'), titleSize: 92 }),
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

// One card per tracked stock token: its own logo and chain mark, no figures (a card cannot stay current).
const tokenLogos = JSON.parse(fs.readFileSync(path.join(root, 'public/tokens/SOURCES.json'), 'utf8'))
const companyLogos = JSON.parse(fs.readFileSync(path.join(root, 'public/tokens/logos/SOURCES.json'), 'utf8'))
const CHAIN = { robinhood: ['Robinhood Chain', 'chains/robinhood.png'], bsc: ['BNB Chain', 'chains/bnb.png'] }
for (const key of Object.keys(CHAIN)) {
  const stocks = JSON.parse(fs.readFileSync(path.join(root, `server/data/${key}-stocks.json`), 'utf8')).stocks
  for (const st of stocks) {
    const file = tokenLogos[`${key}/${st.token.toLowerCase()}`]?.file ?? companyLogos[st.ticker]?.file
    const logo = file
      ? `<div style="position:relative;width:300px;height:300px"><div style="width:300px;height:300px;border-radius:50%;background:#fff;display:flex;align-items:center;justify-content:center;box-shadow:0 0 0 3px #1f2935,0 30px 80px #000a;overflow:hidden"><img src="${pub(file.slice(1))}" style="width:78%;height:78%;object-fit:contain"></div><img src="${pub(CHAIN[key][1])}" style="position:absolute;right:6px;bottom:6px;width:92px;height:92px;border-radius:50%;box-shadow:0 0 0 8px #0d141c"></div>`
      : ''
    CARDS.push({
      file: `og-tracker/${key}/${st.ticker}.png`,
      html: page({
        eyebrow: `Stock token · ${CHAIN[key][0]}`,
        title: `${st.ticker} <em>vs fair value</em>`,
        body: `${st.name}: its price in its deepest pool against the Chainlink fair price, read live.`,
        url: `gullylabs.xyz/tracker/${key}/${st.ticker}`,
        right: `<div style="position:absolute;right:110px;top:50%;transform:translateY(-50%)">${logo}</div>`,
        titleSize: st.ticker.length > 4 ? 96 : 110,
      }),
    })
  }
}

const browser = await chromium.launch()
const page_ = await browser.newPage({ viewport: { width: 1200, height: 630 } })
const only = process.argv[2] // optional: render only cards whose file starts with this
for (const c of CARDS) {
  if (only && !c.file.startsWith(only)) continue
  fs.mkdirSync(path.dirname(path.join(out, c.file)), { recursive: true })
  const tmp = path.join(out, `.tmp-${c.file.replace(/[\/]/g, '_')}.html`)
  fs.writeFileSync(tmp, c.html)
  await page_.goto(pathToFileURL(tmp).href, { waitUntil: 'load' })
  await page_.evaluate(() => document.fonts.ready)
  await page_.waitForTimeout(150)
  await page_.screenshot({ path: path.join(out, c.file) })
  fs.rmSync(tmp)
  console.log('wrote', c.file)
}
await browser.close()
