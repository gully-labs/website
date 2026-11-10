// One page per product and one per Gully Core build, on one template, drawn by the server like the landing: the first
// response is the page, the only script (product-live.mjs) keeps the figures current. Products read their words from
// server/data/page-content.json (src/terminal/catalog.ts); the Core builds' words live here. Preview only for now:
// /preview/products/<slug> and /preview/build/<key>, noindex, until the owner flips them.
import fs from 'node:fs'
import { hub } from './hub.mjs'
import { hubProducts } from './hub-products.mjs'
import { hubLive } from './hub-live.mjs'
import { readStats } from './stats.mjs'
import { BUILD, CSS, TILES, cap, esc, icon, pageFoot, pageTop } from './landing.mjs'
import { feeCurve, productView, ptTime } from './landing-graphs.mjs'
import { gullyCore } from './gully-core.mjs'

const CONTENT = JSON.parse(fs.readFileSync(new URL('./data/page-content.json', import.meta.url), 'utf8'))
const SLUGS = Object.keys(CONTENT.product)
const ext = (h) => /^https?:/.test(h)
const within = (p, ms) => Promise.race([p.catch(() => null), new Promise((r) => setTimeout(() => r(null), ms))])

/** Which landing card and which live series belong to a product. */
const CARD = { 'gully-id': 'id', pay: 'pay', chain: 'chain', rpc: 'rpc', holders: 'holdermaps', security: 'security', studio: 'studio', ai: 'ai', safe: 'multisig', 'gully-core': 'core', street: 'kre8', bridge: 'bridge' }
const METRIC = { chain: 'blocks', 'gully-core': 'launches', street: 'trades' }
const CHART = { launches: 'Launches on Gully Chain testnet, last 24 hours', swaps: 'Swaps on Gully Chain testnet, last 24 hours', trades: 'Trades on Gully Chain testnet, last 24 hours', blocks: 'Newest Gully Chain blocks' }
const CHAIN_ICON = '/brand/web/logos/gc-icon.svg'
const CORE_ICON = '/brand/web/logos/gc-icon.svg'

/** The Core builds' own words. `presets` mirror LaunchPresets.sol, by way of the SDK's parity-tested table. */
const BUILDS = {
  token: {
    features: [['A pool from the first block', 'The token and its pool are made in one transaction.'], ['A fee that falls', 'The fee opens high and falls to 1%, so a sniper pays and a holder does not.'], ['Liquidity locked', 'The launch liquidity is locked, and anyone can read the lock on chain.'], ['Pick a preset', 'Four ready schedules, or set your own opening fee, final fee and window.']],
    presets: [
      { key: 'fair', name: 'Fair launch', from: 10, to: 1, line: '10% to 1% over 5 minutes', not: 'a buyer who simply waits five minutes. It removes free money at the open, nothing more.' },
      { key: 'sniper', name: 'Anti-sniper', from: 50, to: 1, line: '50% to 1% over 30 minutes, max buy required', not: 'sybil splitting across wallets or transactions. Thirty minutes of high fees also taxes real buyers.' },
      { key: 'stealth', name: 'Stealth', from: 50, to: 1, line: '50% to 1% over 2 minutes', not: 'observation. The pool, the config and the start time are public the moment the transaction lands.' },
      { key: 'notax', name: 'No tax', from: 1, to: 1, line: 'Flat 1% from the first block, no decay', not: 'anything. It is a plain 1% pool with a hook attached.' },
      { key: 'custom', name: 'Custom', line: 'Your own opening fee, final fee and window', not: 'anything you leave out. The app refuses a custom launch with empty fields.' },
    ],
    faq: [['Which preset should I pick?', 'Fair launch suits most tokens. Each preset says what it does not protect against.'], ['Can I change it after launch?', 'No. The schedule is fixed when the launch goes on chain.']],
  },
  pad: {
    features: [['Your brand', 'Your name, logo and domain on your own launch site.'], ['Your rules', 'Choose which launch presets your launchpad allows.'], ['Your fee share', 'You and your creators share what is left after the core fee.'], ['No contracts to deploy', 'A launchpad is a tenant on the shared core.']],
    faq: [['Do I need a developer?', 'No. The builder walks you through it, and the SDK is there if you want more.']],
  },
  dex: {
    features: [['Your own swap site', 'A DEX with your brand on Gully Core pools.'], ['Choose your pairs', 'Pick the pairs your site shows first.'], ['Router included', 'Trades route across pools on the same core.'], ['No contracts to deploy', 'Publish the site and it trades.']],
    faq: [['Whose pools does it use?', 'Gully Core pools on the chain you pick.']],
  },
  stock: {
    features: [['Tokenised stocks', 'A market site for the stock tokens on your chain.'], ['Your own brand', 'Your name and domain on the market.'], ['Stock pairs', 'A launch can pair to a stock token.'], ['No contracts to deploy', 'It runs on the same shared core.']],
    faq: [['Which stocks can I list?', 'The stock tokens available on the chain you pick. The builder shows them.']],
  },
  vault: {
    features: [['Follows a pool', 'A vault manages liquidity for one pool.'], ['Set the strategy', 'Choose how it manages the range.'], ['Open deposits', 'Depositors share the fees the vault earns.'], ['Readable on chain', 'Every position can be read on chain.']],
    faq: [['Is my deposit safe?', 'Liquidity can lose value. Read the pool and the strategy first.']],
  },
  locks: {
    features: [['Lock liquidity', 'Lock a position until a date you set.'], ['Vesting', 'Release tokens over time.'], ['Airdrops', 'Send a token to a list of wallets.'], ['Revenue splits', 'Split income with your team.']],
    faq: [['Can a lock be undone?', 'No. A lock holds until its date.']],
  },
}
const CORE_PRICE = 'Builders pay 0.30% of every trade on their pools, and nothing else.'
const CORE_HUB = ['street', 'indexer']

function coreLinks() {
  return `<section class="s"><div class="w"><h2 class="t">What you can build</h2><div class="tiles">${Object.keys(BUILDS).map((k) => {
    const b = BUILD.find((x) => x.key === k)
    return `<a class="tile" href="/preview/build/${k}"><span><b>${esc(b.title)}</b><span class="pl">${esc(b.body)}</span></span></a>`
  }).join('')}</div></div></section>`
}

function presetPicker(list) {
  const pct = (p) => (p.from == null ? '' : ` data-from="${p.from}" data-to="${p.to}"`)
  return `<section class="s"><div class="w"><h2 class="t">Pick a launch preset</h2><div class="two"><div class="box"><ul class="prs">${list.map((p, i) => `<li><button type="button" class="ch" data-preset="${p.key}"${pct(p)} aria-pressed="${i === 0}"><span>${esc(p.name)}</span></button></li>`).join('')}</ul></div><div class="box">${list.map((p, i) => `<div data-pdetail="${p.key}"${i ? ' hidden' : ''}><h3 style="font-size:20px">${esc(p.name)}</h3><p>${esc(p.line)}</p><p>Does not protect against ${esc(p.not)}</p></div>`).join('')}<div class="g" data-curve>${feeCurve(list[0])}</div><span class="capt">The fee over the launch window, as the launch kit fixes it.</span></div></div></div></section>`
}

function pageFor(kind, id) {
  if (kind === 'product') {
    const p = Object.hasOwn(CONTENT.product, id) ? CONTENT.product[id] : null
    if (!p) return null
    const t = TILES.find((x) => x.key === CARD[id])
    const i = SLUGS.indexOf(id)
    const go = (d) => SLUGS[(i + d + SLUGS.length) % SLUGS.length]
    return {
      id, name: p.name, line: p.line, icon: id === 'gully-core' ? CORE_ICON : t?.icon ?? CHAIN_ICON, stage: t?.label ?? '', hub: p.hub, card: CARD[id] ?? null, metric: METRIC[id] ?? null,
      primary: [p.url, p.cta ?? `Open ${p.urlLabel}`], second: p.cta2, docs: p.docs, features: p.features.map((f) => [f.t, f.d]), how: p.how, price: id === 'gully-core' ? CORE_PRICE : p.price, faq: p.faq,
      prev: [`/preview/products/${go(-1)}`, CONTENT.product[go(-1)].name], next: [`/preview/products/${go(1)}`, CONTENT.product[go(1)].name], crumb: ['/preview/products/gully-core', 'Products'],
      extra: id === 'gully-core' ? coreLinks() : '',
    }
  }
  const b = BUILD.find((x) => x.key === id)
  const own = Object.hasOwn(BUILDS, id) ? BUILDS[id] : null
  if (!b || !own) return null
  const keys = Object.keys(BUILDS)
  const i = keys.indexOf(id)
  const at = (d) => BUILD.find((x) => x.key === keys[(i + d + keys.length) % keys.length])
  return {
    id, name: b.title, line: b.body, icon: CORE_ICON, stage: 'Gully Core', hub: CORE_HUB, card: 'core', metric: b.metric,
    primary: [b.href, b.cta], second: null, docs: gullyCore().links.docs, features: own.features, how: b.steps.map((s, n) => [s, ['Start in the Gully Core app.', 'Each choice says what it does before you sign.', 'It is on chain and open to everyone.'][n]]), price: CORE_PRICE, faq: own.faq,
    prev: [`/preview/build/${at(-1).key}`, at(-1).title], next: [`/preview/build/${at(1).key}`, at(1).title], crumb: ['/preview/products/gully-core', 'Gully Core'],
    extra: own.presets ? presetPicker(own.presets) : '',
  }
}

const PCSS = `.ph{padding:14px 0 18px;background:radial-gradient(ellipse at 66% 45%,#0E1C38 0,#081226 58%,#060C1C 100%)}.crumb{display:flex;align-items:center;gap:6px;min-height:32px;font-size:13px;color:var(--soft)}.crumb a:hover{color:#fff}
.ph-g{display:grid;grid-template-columns:minmax(0,7fr) minmax(0,5fr);gap:20px;align-items:center}.ph h1{margin-top:8px}.pm{display:flex;align-items:center;gap:12px}.pm img{width:48px;height:48px;border-radius:12px;background:#fff;object-fit:contain}
.bg{display:inline-flex;align-items:center;gap:6px;min-height:26px;padding:0 10px;border:1px solid var(--blue);border-radius:9px;font-size:12px;color:var(--soft)}.bg:before{content:"";width:7px;height:7px;border-radius:50%;background:var(--soft)}[data-state=live] .bg:before{background:var(--ok)}[data-state=down] .bg:before{background:var(--bad)}
.big{display:block;font-size:40px;font-weight:600;line-height:1.1;font-variant-numeric:tabular-nums;overflow-wrap:anywhere}.pl{display:block;font-size:13px;line-height:1.35;color:var(--soft)}
.prs{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:6px}details{border-bottom:1px solid var(--blue)}summary{display:flex;align-items:center;min-height:48px;font-size:15px;font-weight:600;cursor:pointer}details p{padding-bottom:12px;font-size:14px;color:var(--soft)}.lk{margin-top:8px}.lk li a{display:flex;align-items:center;gap:8px;min-height:44px;font-size:14px}.lk .ic{color:var(--sky)}.pn{display:flex;justify-content:space-between;gap:10px;margin-top:20px}.pn a{display:flex;align-items:center;min-height:44px;font-size:14px;color:var(--soft)}.pn a:hover{color:#fff}
@media (max-width:760px){.ph-g{grid-template-columns:minmax(0,1fr)}.prs{grid-template-columns:repeat(2,minmax(0,1fr))}}`

function slim({ hub: h, products: p, live: l, stats: s }) {
  return {
    hub: h && { chain: h.chain, gateway: h.gateway, services: h.services?.map((x) => ({ key: x.key, name: x.name, state: x.state, ms: x.ms, history: x.history?.map((y) => ({ ms: y.ms })) })) },
    products: p && { chain: { recent: p.chain?.recent?.slice(-9).map((x) => ({ txs: x.txs })) }, activity: { hourly: p.activity?.hourly?.map(({ launches, trades, swaps }) => ({ launches, trades, swaps })) }, holders: { daily: p.holders?.daily?.map((x) => ({ maps: x.maps })) }, security: p.security && { total: p.security.total } },
    live: l && { id: l.id && { totals: { users: l.id.totals?.users } }, pay: l.pay && { services: l.pay.services }, head: l.head },
    stats: s && { venues: s.venues?.map((v) => ({ key: v.key, state: v.state, tvlUsd: v.tvlUsd })) },
  }
}

const link = ([href, label]) => `<li><a href="${esc(href)}"${ext(href) ? ' target="_blank" rel="noopener noreferrer"' : ''}>${icon('link')}<span>${esc(label)}</span></a></li>`

/** The whole page, or null when there is no such product or build. */
export async function renderProduct(head, kind, id, given = null) {
  const pg = pageFor(kind, id)
  if (!pg) return null
  const [h, products, live, stats] = given ? [given.hub, given.products, given.live, given.stats] : await Promise.all([within(hub(), 250), within(hubProducts(), 250), within(hubLive(), 250), within(readStats(), 250)])
  const data = { hub: h, products, live, stats }
  const page = { card: pg.card, hub: pg.hub, metric: pg.metric }
  const v = productView(data, page)
  const boot = JSON.stringify({ ...slim(data), page }).replace(/</g, '\\u003c')
  const where = pg.card === 'core' ? `<section class="s"><div class="w"><h2 class="t">Where it runs</h2><div class="tiles">${gullyCore().chains.map((c) => `<div class="tile">${c.logo ? `<img class="pad" src="${esc(c.logo)}" alt="" width="40" height="40" loading="lazy">` : ''}<span><b>${esc(c.name)}</b><span class="pl">${esc(c.state)}</span></span></div>`).join('')}</div></div></section>` : ''
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${head}<link rel="preload" href="/fonts/figtree-latin-700.woff2" as="font" type="font/woff2" crossorigin><link rel="modulepreload" href="/landing/graphs.mjs"><script src="/landing/fx.js"></script><style>${CSS}${PCSS}</style></head><body>
${pageTop()}
<main>
<section class="ph"><div class="w"><nav class="crumb" aria-label="Breadcrumb"><a href="${esc(pg.crumb[0])}">${esc(pg.crumb[1])}</a><span>/</span><span>${esc(pg.name)}</span></nav><div class="ph-g"><div><div class="pm" data-state-of data-state="${v.state}"><img src="${esc(pg.icon)}" alt="" width="48" height="48"><span class="bg"><span data-v="word">${esc(v.word)}</span>${pg.stage ? `<span>${esc(pg.stage)}</span>` : ''}</span></div><h1>${esc(pg.name)}</h1><p class="lede">${esc(pg.line)}</p><div class="cta">${cap(pg.primary[0], pg.primary[1], 'solid')}${pg.second ? cap(pg.second[1], pg.second[0]) : ''}${pg.docs ? cap(pg.docs, 'Docs') : ''}</div></div>
<div class="box" data-anim><span class="capt">Read at <span data-v="at">${ptTime()}</span></span><span class="big" data-v="value">${esc(v.value || v.up)}</span><span class="capt" data-v="unit">${esc(v.value ? v.unit : 'surfaces answering')}</span><div class="g" data-v="latency">${v.latency}</div><span class="capt">Mean response time, last hour</span></div></div></div></section>
<section class="s" aria-label="Live numbers" style="margin-top:8px"><div class="w"><div class="kpis"><div><small>Answering</small><b data-v="up">${esc(v.up)}</b></div><div><small>Response now</small><b data-v="ms">${esc(v.ms)}</b></div><div><small>Answered, last hour</small><b data-v="answered">${esc(v.answered)}</b></div><div><small>Mean, last hour</small><b data-v="meanMs">${esc(v.meanMs)}</b></div></div><div class="cells" data-v="cells">${v.cells}</div></div></section>
${v.activity ? `<section class="s"><div class="w"><div class="box" data-anim><span class="capt"><b>${esc(CHART[pg.metric])}</b></span><div class="g" data-v="activity">${v.activity}</div></div></div></section>` : ''}
${pg.extra}
<section class="s"><div class="w"><h2 class="t">What it does</h2><ul class="tiles">${pg.features.map(([t, d]) => `<li class="tile"><span><b>${esc(t)}</b><span class="pl">${esc(d)}</span></span></li>`).join('')}</ul></div></section>
<section class="s"><div class="w"><div class="two"><div class="box"><h3>Three steps</h3><ol class="steps">${pg.how.map(([t, d], i) => `<li><i>0${i + 1}</i><span><b>${esc(t)}</b><span class="pl">${esc(d)}</span></span></li>`).join('')}</ol></div><div class="box"><h3>Price</h3><p>${esc(pg.price)}</p></div></div></div></section>
${where}
<section class="s"><div class="w"><div class="two"><div><h2 class="t">Questions</h2>${pg.faq.map(([q, x]) => `<details><summary>${esc(q)}</summary><p>${esc(x)}</p></details>`).join('')}</div><div><h2 class="t">Go further</h2><ul class="lk">${[pg.primary, ...(pg.docs ? [[pg.docs, 'Docs']] : []), ['/status', 'Status of every Gully service']].map(link).join('')}</ul></div></div><nav class="pn" aria-label="Other pages"><a href="${esc(pg.prev[0])}">← ${esc(pg.prev[1])}</a><a href="${esc(pg.next[0])}">${esc(pg.next[1])} →</a></nav></div></section>
</main>
${pageFoot()}
<script type="application/json" id="boot">${boot}</script><script type="module" src="/landing/product.js"></script></body></html>`.replaceAll('href="/products/', 'href="/preview/products/')
}

/** Title and description for a preview page, or null. */
export function productMeta(kind, id) {
  const pg = pageFor(kind, id)
  return pg && { title: `${pg.name} · Gully Labs`, description: pg.line }
}
export const PREVIEW_PATHS = [...SLUGS.map((s) => `/preview/products/${s}`), ...Object.keys(BUILDS).map((k) => `/preview/build/${k}`)]
