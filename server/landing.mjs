// The Gully Labs landing as one finished HTML response: header, hero, live board, products, footer, styled by the CSS in
// the page, with the last known figures already drawn. Nothing waits for a script, a wallet or a session. The only script
// (landing-live.mjs, with landing-graphs.mjs) keeps the figures current; without it the page is still whole.
// Words come from server/data/page-content.json (built from the files the rest of the site reads), logos from
// public/brand/kit (the 2026-11 kit, byte-identical) and each product's own kit.
import fs from 'node:fs'
import { hub } from './hub.mjs'
import { hubProducts } from './hub-products.mjs'
import { hubLive } from './hub-live.mjs'
import { readStats } from './stats.mjs'
import { board, cards, constellation, coreBars, METRIC } from './landing-graphs.mjs'
import { ICONS, NAV_ICON, PRODUCT_ICON } from './landing-icons.mjs'

const CONTENT = JSON.parse(fs.readFileSync(new URL('./data/page-content.json', import.meta.url), 'utf8'))
const L = CONTENT.landing
const CHAINS = JSON.parse(fs.readFileSync(new URL('./data/core-chains.json', import.meta.url), 'utf8'))
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const icon = (name) => `<svg class="ic" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] ?? ICONS.box}</svg>`
const ext = (href) => /^https?:/.test(href)
const a = (href, inner, cls = '') => `<a href="${esc(href)}"${cls ? ` class="${cls}"` : ''}${ext(href) ? ' target="_blank" rel="noopener noreferrer"' : ''}>${inner}</a>`
const navLink = ([href, label]) => `<li>${a(href, `${icon(NAV_ICON[label] ?? 'box')}<span>${esc(label)}</span>`)}</li>`

/** What the server holds now, or null: the page never waits long for a source (the script reads what is missing). */
const within = (p, ms) => Promise.race([p.catch(() => null), new Promise((r) => setTimeout(() => r(null), ms))])

const CORE = 'https://gullychain.xyz/core/app'
/** The Build tabs: each one links to the real Gully Core app route. `metric`: the real series beside it. */
const BUILD = [
  { key: 'token', label: 'Launch a token', icon: 'rocket', title: 'Launch a token', body: 'A token and its pool, tradable from the first block, with liquidity locked.', steps: ['Name your token', 'Set the launch rules', 'Go live'], cta: 'Launch a token', href: `${CORE}/launch/v2/new`, metric: 'launches' },
  { key: 'pad', label: 'Launchpad', icon: 'layers', title: 'Your own launchpad', body: 'A launch site with your brand, your domain and your rules, on the shared core.', steps: ['Pick a chain', 'Add your brand', 'Set your fee share'], cta: 'Build a launchpad', href: `${CORE}/pads/new`, metric: 'launches' },
  { key: 'dex', label: 'DEX', icon: 'arrow-left-right', title: 'Your own DEX', body: 'A swap site on Gully Core pools, ready to host with no contracts to deploy.', steps: ['Pick a chain', 'Choose your pairs', 'Publish your site'], cta: 'Build a DEX', href: `${CORE}/dexes/new?kind=dex`, metric: 'swaps' },
  { key: 'stock', label: 'Stock market', icon: 'chart-candlestick', title: 'Your own stock market', body: 'A market site for tokenised stocks, built on the same core.', steps: ['Pick a chain', 'Choose your stocks', 'Publish your site'], cta: 'Build a stock market', href: `${CORE}/pads/new?kind=stocks`, metric: 'trades' },
  { key: 'vault', label: 'Vault', icon: 'vault', title: 'Managed liquidity', body: 'A vault that follows a pool and manages liquidity for its depositors.', steps: ['Pick a pool', 'Set the strategy', 'Open deposits'], cta: 'Build a vault', href: `${CORE}/vaults/new`, metric: 'swaps' },
  { key: 'chain', label: 'Create a chain', icon: 'boxes', title: 'Your own chain', body: 'An Arbitrum Orbit chain on the stack Gully Chain runs: explorer, bridge and RPC included. We launch it with you.', steps: ['Tell us what you need', 'We set up the chain', 'You go live'], cta: 'Start a chain', href: '/services#contact', metric: 'trades' },
  { key: 'locks', label: 'Locks + splits', icon: 'lock', title: 'Locks, vesting and splits', body: 'Lock liquidity, vest tokens, run airdrops and split revenue with your team.', steps: ['Pick a position', 'Set the date', 'Lock it'], cta: 'Set up a lock', href: `${CORE}/locks/new`, metric: 'trades' },
]
const NAV = [['#build', 'Build', 'hammer'], ['#products', 'Products', 'layout-grid'], ['#chains', 'Chains', 'link'], ['https://docs.gullylabs.xyz', 'Developers', 'code-xml'], ['/status', 'Status', 'activity']]
/** Product tiles: the landing's list, kre8 beside its chain, the Gully Core emblem from its own kit. */
/** Features with their own host and a real probe, so their status is read like any product's. */
const TOOLS = [{ key: 'bridge', name: 'Gully Bridge', icon: '/brand/web/logos/gc-icon.svg', href: 'https://testnet-bridge.gullychain.xyz', label: 'Testnet' }, { key: 'faucet', name: 'Faucet', icon: '/brand/web/logos/gc-icon.svg', href: 'https://faucet.gullychain.xyz', label: 'Testnet' }, { key: 'explorer', name: 'Explorer', icon: '/brand/web/logos/gc-icon.svg', href: 'https://testnet-explorer.gullychain.xyz', label: 'Testnet' }]
const KRE8 = { key: 'kre8', name: 'kre8', icon: '/brand/products/kre8-icon-dark-1024.svg', href: 'https://kre8.fun', label: 'Testnet' }
const iconOf = (p) => (p.key === 'core' ? '/brand/products/gully-core-emblem-192.png' : p.icon)
const cap = (href, label, cls = '') => `<a class="cap ${cls}" href="${esc(href)}"${ext(href) ? ' target="_blank" rel="noopener noreferrer"' : ''}><b></b>${esc(label)}</a>`

const CSS = `@font-face{font-family:Figtree;src:url(/fonts/figtree-latin-500.woff2) format("woff2");font-weight:400 500;font-display:swap}
@font-face{font-family:'IBM Plex Mono';src:url(/fonts/ibm-plex-mono-latin-500.woff2) format("woff2");font-weight:500;font-display:swap}
@font-face{font-family:Figtree;src:url(/fonts/figtree-latin-700.woff2) format("woff2");font-weight:600 800;font-display:swap}
:root{color-scheme:dark;--navy:#0E1C38;--blue:#3754A0;--sky:#6F8DDF;--ground:#F1F3F8;--soft:#C9D2E8;--ok:#6F8DDF;--bad:#FF8A7A;--soon:#C9D2E8}
*{box-sizing:border-box}html{-webkit-text-size-adjust:100%;scroll-behavior:smooth;scroll-padding-top:16px}
body{margin:0;background:var(--navy);color:#fff;font:500 16px/1.5 Figtree,system-ui,-apple-system,Segoe UI,sans-serif}
a{color:inherit;text-decoration:none}ul{list-style:none;margin:0;padding:0}h1,h2,h3,p{margin:0}
.ic{width:16px;height:16px;flex:none;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
.w{max-width:1240px;margin:0 auto;padding:0 20px}
.fx-off .fx{display:none}.fx{position:relative;display:flex;align-items:center;justify-content:center;height:44px;border-bottom:1px solid var(--blue);color:#fff;font-size:14px}.fx a{display:flex;align-items:center;height:44px;padding:0 48px}.fx button{position:absolute;top:0;right:0;width:44px;height:44px;border:0;background:none;color:inherit;font:inherit;font-size:18px;cursor:pointer}
.top .w{display:flex;align-items:center;gap:18px;min-height:68px}.top img{display:block;height:28px;width:auto}.top nav{flex:1}.top ul{display:flex;gap:2px}.top li a{display:flex;align-items:center;gap:6px;min-height:44px;padding:0 10px;border-radius:10px;font-size:14px;color:var(--soft)}.top li a:hover{color:#fff;background:rgba(55,84,160,.4)}
.cap{display:inline-flex;align-items:center;gap:10px;min-height:48px;padding:0 22px 0 16px;border:1px solid var(--sky);border-radius:14px;background:transparent;color:#fff;font:inherit;font-size:15px;font-weight:600;white-space:nowrap;cursor:pointer}
.cap b{width:9px;height:9px;border-radius:3px;background:var(--sky);transition:width .25s ease}.cap:hover b,.cap:focus-visible b{width:18px}
.cap.solid{background:#fff;color:var(--navy);border-color:#fff}.cap.solid b{background:var(--blue)}.cap.sm{min-height:44px;font-size:14px}
:focus-visible{outline:2px solid var(--sky);outline-offset:2px}
.hero .w{display:grid;grid-template-columns:minmax(0,5fr) minmax(0,7fr);gap:24px;align-items:center}
.eye{font-size:14px;font-weight:600;color:var(--sky)}h1{margin-top:12px;font-size:clamp(38px,5.2vw,60px);line-height:1.03;font-weight:800;letter-spacing:-.03em}
.lede{margin-top:14px;max-width:46ch;font-size:18px;line-height:1.45;color:var(--soft)}.cta{display:flex;flex-wrap:wrap;gap:10px;margin-top:18px}
.hero{overflow:hidden;padding:10px 0 18px;background:radial-gradient(ellipse at 66% 45%,#0E1C38 0,#081226 58%,#060C1C 100%)}.howl{display:block;height:170px;width:auto;margin-top:14px}
.cmap{position:relative;min-width:0;aspect-ratio:760/560}.cmap svg{position:absolute;inset:0;width:100%;height:100%;overflow:visible}.cmap-tall{display:none}.cfield{position:absolute;inset:-6% -10%;width:120%;height:112%;object-fit:cover;pointer-events:none;opacity:.9;-webkit-mask-image:radial-gradient(closest-side,#000 55%,transparent);mask-image:radial-gradient(closest-side,#000 55%,transparent)}
.edge{fill:none;stroke:#6F8DDF;stroke-opacity:.45;stroke-width:1.5}.edge.plan{stroke:#3754A0;stroke-opacity:1;stroke-dasharray:4 5}.spark{fill:#6F8DDF}.nd2 .halo{fill:#060C1C;stroke:var(--c);stroke-width:2;transition:stroke-width .18s}a:hover .nd2 .halo,a:focus-visible .nd2 .halo{stroke-width:3.5}.nd2 .ping{fill:none;stroke:var(--c);stroke-opacity:.5;transform-box:fill-box;transform-origin:center;opacity:0}.in .nd2.is-up .ping{animation:ping 2.6s ease-out infinite}.nd2.is-soon .halo{stroke-dasharray:3 4}
.nd2 .nm{font:600 13px Figtree,sans-serif;fill:#F1F3F8}.nd2 .mt{font:500 11px 'IBM Plex Mono',ui-monospace,monospace;fill:var(--soft)}.nd2 .st{font:500 9.5px 'IBM Plex Mono',ui-monospace,monospace;letter-spacing:.08em;text-transform:uppercase;fill:#6F8DDF}.nd2 .st.live{fill:#F1F3F8}.nd2 .st.soon{fill:#C9D2E8}.nd2 .st.down{fill:var(--bad)}
.orbit{display:block;width:100%;max-height:460px}.ring{fill:none;stroke:var(--blue)}.tileb{fill:#fff}
.spin,.spin-r,.un,.un-r{transform-box:view-box;transform-origin:center}.in .spin{animation:turn 160s linear infinite}.in .spin-r{animation:turn 110s linear infinite reverse}
.node{transform-box:fill-box;transform-origin:center}.in .spin .node{animation:turn 160s linear infinite reverse}.in .spin-r .node{animation:turn 110s linear infinite}
.kpis{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));border:1px solid var(--blue);border-radius:18px}.kpis>div{padding:12px 20px;min-width:0}.kpis small{display:block;font-size:12px;color:var(--soft)}.kpis b{display:block;font-size:22px;font-weight:600;font-variant-numeric:tabular-nums;white-space:nowrap}
.cells{display:flex;flex-wrap:wrap;gap:3px;margin-top:8px;min-height:10px}.c{width:14px;height:8px;border-radius:2px;background:var(--ok)}.c.soon{background:var(--blue)}.c.off{background:var(--bad)}.bar-l{display:flex;align-items:center;gap:8px;min-height:44px;font-size:13px;color:var(--soft)}
section.s{margin-top:32px}h2.t{font-size:clamp(26px,3vw,34px);line-height:1.15;font-weight:800;letter-spacing:-.02em}.hd{display:flex;align-items:center;gap:12px;margin-bottom:12px}.hd img{width:34px;height:34px;border-radius:8px}
.tabs{display:flex;flex-wrap:wrap;gap:4px;margin-bottom:12px}.tb{display:flex;align-items:center;gap:8px;min-height:44px;padding:0 14px;border:0;border-radius:12px;background:transparent;color:var(--soft);font:inherit;font-size:14px;font-weight:600;cursor:pointer}.tb:hover{color:#fff}.tb[aria-selected=true]{background:#fff;color:var(--navy)}
.two{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:12px}.box{min-width:0;border:1px solid var(--blue);border-radius:20px;padding:20px 22px}
.box h3{font-size:24px;font-weight:800}.box p{margin-top:8px;font-size:15px;line-height:1.5;color:var(--soft)}.steps{margin:12px 0 14px;font-size:14px}.steps li{display:flex;gap:10px;min-height:26px}.steps i{font-style:normal;color:var(--sky);font-variant-numeric:tabular-nums}
.g{--bar:var(--sky);--ln:var(--sky);--ar:rgba(111,141,223,.2);height:150px;margin-top:10px}.g svg{display:block;height:150px}.capt{font-size:13px;color:var(--soft)}.capt b{color:#fff;font-weight:600}
.g-bar{fill:var(--bar);transform-box:fill-box;transform-origin:bottom}.in .g-bar{animation:grow .5s ease both;animation-delay:calc(var(--i)*12ms)}.g-axis{stroke:var(--blue)}
.pick{display:grid;grid-template-columns:minmax(220px,300px) minmax(0,1fr) minmax(240px,340px);gap:12px;align-items:center}.pick>ul{display:flex;flex-direction:column;gap:6px}
.ch{display:flex;align-items:center;justify-content:space-between;gap:10px;width:100%;min-height:48px;padding:0 14px;border:1px solid var(--blue);border-radius:13px;background:transparent;color:#fff;font:inherit;font-size:14px;font-weight:600;text-align:left;cursor:pointer}.ch span+span{font-size:12px;font-weight:500;color:var(--soft)}.ch[aria-pressed=true]{background:#fff;color:var(--navy);border-color:#fff}.ch[aria-pressed=true] span+span{color:var(--navy)}
.bd{fill:var(--blue);transition:fill .2s}.bt{fill:#fff;font:700 14px Figtree,sans-serif;text-anchor:middle}.nd.on .bd{fill:#fff}.nd.on .bt{fill:var(--navy)}.nd.on .node>*{transform-box:fill-box;transform-origin:center}.nd.on circle{stroke:var(--sky);stroke-width:4}
.feats{margin-top:10px;font-size:14px}.feats li{display:flex;align-items:center;gap:8px;min-height:26px}.feats li:before{content:"";width:9px;height:9px;border-radius:3px;background:var(--sky)}.feats li.soon{color:var(--soft)}.feats li.soon:before{background:none;box-shadow:inset 0 0 0 1px var(--sky)}.feats small{font-size:12px}.box .cap{margin-top:12px}
.fee{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-top:12px}.fee h2{font-size:20px;font-weight:800}.fee p{margin-top:4px;font-size:14px;color:var(--soft)}.fee b{font-size:40px;font-weight:600;font-variant-numeric:tabular-nums}
.tiles{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:10px;margin-top:12px}.tile{display:flex;align-items:center;gap:10px;min-height:60px;border:1px solid var(--blue);border-radius:14px;padding:10px 12px;transition:background .2s}.tile:hover{background:var(--blue)}.tile img{width:32px;height:32px;flex:none;border-radius:8px;background:#fff;object-fit:contain}.tile>span{min-width:0}.tile b{display:block;font-size:14px;font-weight:600}
.st{display:flex;align-items:center;gap:5px;font-size:12px;color:var(--soft);white-space:nowrap;overflow:hidden}.st:before{content:"";width:7px;height:7px;flex:none;border-radius:50%;background:var(--soft)}[data-state=live] .st:before{background:var(--ok)}[data-state=down] .st:before{background:var(--bad)}[data-state=coming] .st:before{background:var(--soon)}
footer{margin-top:36px;padding:26px 0;border-top:1px solid var(--blue)}footer a:hover{color:var(--sky)}.f{display:grid;grid-template-columns:1.2fr repeat(3,minmax(0,1fr));gap:20px}.f img{display:block;height:34px;width:auto}.f .lab{display:block;margin-bottom:6px;font-size:12px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--soft)}
.f li a{display:flex;align-items:center;gap:7px;min-height:32px;font-size:14px}.f .ic{width:15px;height:15px;color:var(--sky)}
.fb{display:flex;flex-wrap:wrap;align-items:center;gap:10px 16px;margin-top:18px;padding-top:14px;border-top:1px solid rgba(201,210,232,.25);font-size:13px;color:var(--soft)}.fb ul{display:flex;gap:12px}.fb li a{min-height:44px}.fb .pb{margin-left:auto}.fb .pb img{height:40px}
#toasts{position:fixed;right:16px;top:16px;z-index:40;display:flex;flex-direction:column;gap:8px;width:min(320px,calc(100vw - 32px))}
.toast{position:relative;display:flex;flex-direction:column;padding:12px 40px 12px 16px;border-radius:14px;background:#fff;color:var(--navy);font-size:13px;font-weight:600;box-shadow:0 8px 24px rgba(0,0,0,.3);animation:rise .3s cubic-bezier(.2,.8,.2,1) both}.toast a,.toast span{font-weight:500}.toast button{position:absolute;top:0;right:0;width:44px;height:44px;border:0;background:none;color:inherit;font:inherit;font-size:18px;cursor:pointer}
[hidden]{display:none!important}
@keyframes ping{0%{transform:scale(1);opacity:.7}100%{transform:scale(1.45);opacity:0}}@keyframes grow{from{transform:scaleY(.1)}}@keyframes turn{to{transform:rotate(360deg)}}@keyframes rise{from{opacity:0;transform:translateY(-10px)}}
@media (max-width:1040px){.pick{grid-template-columns:minmax(0,1fr) minmax(0,1fr)}.pick .orbit{grid-column:1/-1;grid-row:1;max-height:320px}.f{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media (max-width:760px){.cmap{aspect-ratio:360/720;max-width:460px;width:100%;margin:0 auto}.cmap-wide{display:none}.cmap-tall{display:block}.howl{display:none}.hero .w,.two,.pick{grid-template-columns:minmax(0,1fr)}.pick .orbit{grid-column:auto}.kpis{grid-template-columns:repeat(2,minmax(0,1fr))}.top li span{display:none}.top li a{padding:0 8px}.top .w{flex-wrap:wrap;gap:4px 8px;padding-top:6px;padding-bottom:6px}.top nav{order:3;flex-basis:100%}.top ul{justify-content:space-between}.top li a{min-width:44px;justify-content:center}.top .cap{margin-left:auto}.fee b{font-size:32px}.f{grid-template-columns:minmax(0,1fr)}.fb .pb{margin-left:0}}
@media (prefers-reduced-motion:reduce){.spark{display:none}.nd2 .ping{opacity:.4}*,*:before,*:after{animation:none!important;transition:none!important;scroll-behavior:auto!important}}`

const tile = (p, v) => `<a class="tile" data-p="${p.key}" data-state="${v.state}" href="${esc(p.href)}"${ext(p.href) ? ' target="_blank" rel="noopener noreferrer"' : ''}><img src="${esc(iconOf(p))}" alt="" width="32" height="32" loading="lazy"><span><b>${esc(p.name)}</b><span class="st" data-fb="${esc(p.kind ?? p.label)}" data-u>${esc(v.value ? `${v.value} ${v.unit}` : p.kind ?? p.label)}</span></span></a>`
const byKey = Object.fromEntries(L.products.map((p) => [p.key, p]))
const TILES = [byKey.core, byKey.chain, KRE8, ...L.products.filter((p) => !['core', 'chain'].includes(p.key)), ...TOOLS, ...L.peddle]

const MAP_ICON = { id: '/brand/hub/icons/gully-id.svg', ai: '/brand/hub/icons/ai.png' }
const MAP_NODES = ['id', 'pay', 'rpc', 'holdermaps', 'security', 'studio', 'ai', 'chain', 'core', 'kre8', 'multisig'].map((k) => {
  const p = TILES.find((q) => q.key === k)
  return { key: k, name: p.name, href: p.href, icon: MAP_ICON[k] ?? iconOf(p) }
})
const STAGES = Object.fromEntries(TILES.map((p) => [p.key, p.label]))

/** Only what the graphics read: the first HTML stays small. */
function slim({ hub: h, products: p, live: l, stats: s }) {
  return {
    hub: h && { chain: h.chain, gateway: h.gateway, quests: h.quests && { quests: h.quests.quests?.map(({ title, completions }) => ({ title, completions })) }, services: h.services?.map((x) => ({ key: x.key, name: x.name, state: x.state, ms: x.ms, history: x.history?.map((y) => ({ ms: y.ms })) })) },
    products: p && { chain: { recent: p.chain?.recent?.slice(-9).map((x) => ({ txs: x.txs })) }, activity: { hourly: p.activity?.hourly?.map(({ launches, trades, swaps }) => ({ launches, trades, swaps })) }, holders: { today: p.holders?.today, daily: p.holders?.daily?.map((x) => ({ maps: x.maps })) }, security: p.security && { daily: p.security.daily?.map((x) => ({ scans: x.scans })), total: p.security.total } },
    live: l && { id: l.id && { signins24h: l.id.signins24h, totals: { users: l.id.totals?.users }, dailySignins: l.id.dailySignins?.map((x) => ({ n: x.n })) }, pay: l.pay && { services: l.pay.services }, head: l.head, feed: l.feed && { items: l.feed.items?.map((x) => ({ id: x.id })) } },
    stats: s && { totals: { tvlUsd: s.totals?.tvlUsd, volumeAllUsd: s.totals?.volumeAllUsd }, venues: s.venues?.map((v) => ({ key: v.key, state: v.state, tvlUsd: v.tvlUsd, daily: (v.daily ?? []).slice(-30).map((d) => ({ v: d.v })) })) },
  }
}

/** The whole page. `meta`: title, description and head tags, already rendered for this path by seo.mjs. */
export async function renderLanding(head, given = null) {
  const [hubB, products, live, stats] = given ? [given.hub, given.products, given.live, given.stats] : await Promise.all([within(hub(), 250), within(hubProducts(), 250), within(hubLive(), 250), within(readStats(), 250)])
  const data = { hub: hubB, products, live, stats, stages: STAGES }
  const c = cards(data)
  const b = board(data)
  const N = CONTENT.nav
  const boot = JSON.stringify({ ...slim(data), stages: STAGES }).replace(/</g, '\\u003c')
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${head}<link rel="preload" href="/fonts/figtree-latin-700.woff2" as="font" type="font/woff2" crossorigin><link rel="preload" href="/brand/kit/owl/owl-presenting-400.webp" as="image"><link rel="modulepreload" href="/landing/graphs.mjs"><script src="/landing/fx.js"></script><style>${CSS}</style></head><body>
<div class="fx" id="fx"><a href="https://x.com/Gully_Labs" target="_blank" rel="noopener noreferrer">Follow @Gully_Labs on X</a><button type="button" aria-label="Dismiss">×</button></div><header class="top"><div class="w"><a href="/" aria-label="Gully Labs home"><img src="/brand/kit/logotype-reversed.svg" alt="Gully Labs" width="154" height="28"></a><nav aria-label="Main"><ul>${NAV.map(([href, label, ic]) => `<li>${a(href, `${icon(ic)}<span>${esc(label)}</span>`)}</li>`).join('')}</ul></nav>${cap('https://app.gullylabs.xyz', 'Open app', 'solid sm')}</div></header>
<main>
<section class="hero"><div class="w"><div><p class="eye">You Think It, We Ship It</p><h1>Launch a token. Run a launchpad. Own a DEX.</h1><p class="lede">Gully Core gives you the whole stack, on the chains your users already use.</p><div class="cta">${cap('#build', 'Start building', 'solid')}${cap('https://app.gullylabs.xyz', 'Open the app')}</div><img class="howl" src="/brand/kit/owl/owl-presenting-400.webp" alt="The Gully Labs owl presenting" width="92" height="170"></div>
<div class="cmap" data-anim><img class="cfield" src="/brand/hub/art/hero-field-kit.svg" alt="" width="1200" height="760">${constellation('wide', MAP_NODES, data)}${constellation('tall', MAP_NODES, data)}</div></div></section>
<section class="s" aria-label="Live numbers" style="margin-top:8px"><div class="w"><div class="kpis"><div><small>Value locked</small><b data-b="tvl">${esc(b.tvl)}</b></div><div><small>All-time volume</small><b data-b="vol">${esc(b.vol)}</b></div><div><small>Products</small><b>${TILES.length}</b></div><div><small>Services up</small><b data-b="up">${esc(b.up)}</b></div></div><a class="bar-l" href="/status">${icon('activity')}<span>Every public surface, checked each minute</span></a><div class="cells" data-b="cells">${b.cells}</div></div></section>
<section class="s" id="build"><div class="w"><div class="hd"><img src="/brand/products/gully-core-emblem-192.png" alt="" width="34" height="34"><h2 class="t">Build on Gully Core</h2></div><div class="tabs" role="tablist" aria-label="What to build">${BUILD.map((t, i) => `<button type="button" class="tb" role="tab" id="t-${t.key}" aria-controls="p-${t.key}" aria-selected="${i === 0}" data-tab="${t.key}" data-metric="${t.metric}">${icon(t.icon)}${esc(t.label)}</button>`).join('')}</div><div class="two" data-anim><div class="box">${BUILD.map((t, i) => `<div role="tabpanel" id="p-${t.key}" aria-labelledby="t-${t.key}"${i ? ' hidden' : ''}><h3>${esc(t.title)}</h3><p>${esc(t.body)}</p><ol class="steps">${t.steps.map((x, n) => `<li><i>0${n + 1}</i>${esc(x)}</li>`).join('')}</ol>${cap(t.href, t.cta, 'solid')}</div>`).join('')}</div><div class="box"><span class="capt"><b data-b="mname">${esc(METRIC[BUILD[0].metric])}</b> on Gully Chain testnet, last 24 hours</span><div class="g" data-b="core">${coreBars(products, BUILD[0].metric)}</div></div></div></div></section>
<section class="s" id="chains"><div class="w"><h2 class="t" style="margin-bottom:12px">Chains</h2><div class="pick" data-anim><ul>${CHAINS.map((c, i) => `<li><button type="button" class="ch" data-chain="${c.key}" aria-pressed="${i === 0}"><span>${esc(c.name)}</span><span>${esc(c.state)}</span></button></li>`).join('')}</ul>
<svg class="orbit" viewBox="0 0 460 460" role="img" aria-label="Chains orbiting Gully Core" style="max-height:400px"><circle class="ring" cx="230" cy="230" r="190"/><circle class="ring" cx="230" cy="230" r="110"/><rect x="182" y="182" width="96" height="96" rx="26" class="tileb"/><image href="/brand/products/gully-core-emblem-192.png" x="192" y="192" width="76" height="76"/>${['spin', 'spin-r'].map((cls, ring) => `<g class="${cls}">${CHAINS.map((c, i) => { if (i % 2 !== ring) return ''; const r = ring ? 110 : 190; const t = (i / CHAINS.length) * Math.PI * 2; return `<g class="nd${i === 0 ? ' on' : ''}" data-node="${c.key}" transform="translate(${(230 + r * Math.cos(t)).toFixed(1)} ${(230 + r * Math.sin(t)).toFixed(1)})"><g class="node"><circle class="bd" r="24"/>${c.logo ? `<image href="${esc(c.logo)}" x="-15" y="-15" width="30" height="30"/>` : `<text class="bt" y="5">${esc(c.short)}</text>`}</g></g>` }).join('')}</g>`).join('')}</svg>
<div class="box">${CHAINS.map((c, i) => `<div data-detail="${c.key}"${i ? ' hidden' : ''}><h3 style="font-size:22px">${esc(c.name)}</h3><p>${esc(c.note)}</p><ul class="feats">${c.live.map((f) => `<li>${esc(f)}</li>`).join('')}${c.planned.map((f) => `<li class="soon">${esc(f)} <small>coming</small></li>`).join('')}</ul>${c.cta ? cap(c.cta.href, c.cta.label, 'solid') : ''}</div>`).join('')}</div></div>
<div class="box fee"><div><h2>One simple fee</h2><p>Builders pay 0.30% of every trade. Nothing else.</p></div><b>0.30%</b></div></div></section>
<section class="s" id="products"><div class="w"><h2 class="t">Everything in orbit</h2><div class="tiles">${TILES.map((p) => tile(p, c[p.key])).join('')}</div></div></section>
</main>
<footer><div class="w"><div class="f"><div><img src="/brand/kit/logotype-reversed.svg" alt="Gully Labs" width="175" height="34" loading="lazy"><p style="margin-top:10px;font-size:14px;color:var(--soft)">${esc(N.tagline)}</p><ul style="margin-top:8px">${N.footer.map(navLink).join('')}</ul></div>${N.products.map((g) => `<nav aria-label="${esc(g.group)}"><span class="lab">${esc(g.group)}</span><ul>${g.links.map(([href, label]) => `<li>${a(href, `${icon(PRODUCT_ICON[label] ?? 'box')}<span>${esc(label)}</span>`)}</li>`).join('')}</ul></nav>`).join('')}</div><div class="fb"><span>${esc(N.copy)}</span><ul>${N.legal.map(navLink).join('')}</ul><a class="pb" href="/" aria-label="Powered by Gully Labs"><img src="/brand/kit/powered-by-clear-white.svg" alt="Powered by Gully Labs" width="150" height="40" loading="lazy"></a></div></div></footer>
<div id="toasts" role="status" aria-live="polite"></div>
<script type="application/json" id="boot">${boot}</script><script type="module" src="/landing/live.js"></script></body></html>`
}

/** The two script files, from server/ so the server and the browser run the same graph code. */
export function landingAsset(pathname) {
  // A blocking one-liner before the first paint, so a dismissed bar never shows or shifts the page (the CSP refuses inline scripts).
  if (pathname === '/landing/fx.js') return "try{if(localStorage.getItem('gl-follow-x-dismissed')==='1')document.documentElement.classList.add('fx-off')}catch(e){}"
  const f = pathname === '/landing/graphs.mjs' ? 'landing-graphs.mjs' : pathname === '/landing/live.js' ? 'landing-live.mjs' : null
  return f ? fs.readFileSync(new URL(`./${f}`, import.meta.url), 'utf8') : null
}
