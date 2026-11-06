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
import { board, cards } from './landing-graphs.mjs'
import { ICONS, NAV_ICON, PRODUCT_ICON } from './landing-icons.mjs'

const CONTENT = JSON.parse(fs.readFileSync(new URL('./data/page-content.json', import.meta.url), 'utf8'))
const L = CONTENT.landing
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const icon = (name) => `<svg class="ic" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] ?? ICONS.box}</svg>`
const ext = (href) => /^https?:/.test(href)
const a = (href, inner, cls = '') => `<a href="${esc(href)}"${cls ? ` class="${cls}"` : ''}${ext(href) ? ' target="_blank" rel="noopener noreferrer"' : ''}>${inner}</a>`
const navLink = ([href, label]) => `<li>${a(href, `${icon(NAV_ICON[label] ?? 'box')}<span>${esc(label)}</span>`)}</li>`

/** What the server holds now, or null: the page never waits long for a source (the script reads what is missing). */
const within = (p, ms) => Promise.race([p.catch(() => null), new Promise((r) => setTimeout(() => r(null), ms))])

const CSS = `@font-face{font-family:Figtree;src:url(/fonts/figtree-latin-500.woff2) format("woff2");font-weight:400 500;font-display:swap}
@font-face{font-family:Figtree;src:url(/fonts/figtree-latin-700.woff2) format("woff2");font-weight:600 800;font-display:swap}
:root{--navy:#0E1C38;--blue:#3754A0;--sky:#6F8DDF;--ground:#F1F3F8;--grey:#5B6478;--rule:#D6DCE8;--soft:#C9D2E8;--card:#fff;--ok:#1E7A4F;--bad:#B3261E;--soon:#8A6A1A}
*{box-sizing:border-box}html{-webkit-text-size-adjust:100%;scroll-behavior:smooth}
body{margin:0;background:var(--ground);color:var(--navy);font:500 16px/1.5 Figtree,system-ui,-apple-system,Segoe UI,sans-serif}
a{color:inherit;text-decoration:none}ul{list-style:none;margin:0;padding:0}h1,h2,h3,p{margin:0}
.ic{width:18px;height:18px;flex:none;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
.w{max-width:1200px;margin:0 auto;padding:0 20px}
.top{position:sticky;top:0;z-index:20;background:rgba(241,243,248,.92);backdrop-filter:blur(8px);border-bottom:1px solid var(--rule)}
.top .w{display:flex;align-items:center;gap:20px;height:64px}.top img{display:block;height:32px;width:auto}
.top nav{margin-left:auto}.top ul{display:flex;gap:4px}.top li a{display:flex;align-items:center;gap:6px;min-height:44px;padding:0 10px;border-radius:8px;font-size:15px}
.top li a:hover,.top li a:focus-visible{background:#fff}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:44px;padding:0 18px;border-radius:10px;background:var(--navy);color:#fff;font-weight:600;white-space:nowrap}
.btn:hover,.btn:focus-visible{background:var(--blue)}.btn.alt{background:transparent;color:var(--navy);box-shadow:inset 0 0 0 1px var(--soft)}.btn.alt:hover{background:#fff}
:focus-visible{outline:2px solid var(--blue);outline-offset:2px}
.hero{padding:44px 0 28px}.hero .w{display:grid;grid-template-columns:1.15fr .85fr;gap:28px;align-items:stretch}
h1{font-size:clamp(36px,5.2vw,60px);line-height:1.04;font-weight:700;letter-spacing:-.02em}h1 em{font-style:normal;color:var(--blue)}
.lede{margin-top:16px;max-width:54ch;font-size:18px;color:var(--grey)}.cta{display:flex;flex-wrap:wrap;gap:10px;margin-top:22px}
.live{position:relative;overflow:hidden;min-height:340px;padding:20px;border-radius:18px;background:var(--navy);color:#fff}
.live h2{display:flex;align-items:center;gap:8px;font-size:13px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--soft)}
.pip{width:8px;height:8px;border-radius:50%;background:#5FD49B}.in .pip{animation:pip 2s ease-in-out infinite}
.kpis{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px 16px;margin-top:14px;max-width:62%}.kpis b{display:block;font-size:26px;line-height:1.1;font-weight:700;font-variant-numeric:tabular-nums}.kpis small{font-size:12px;color:var(--soft)}
.cells{display:grid;grid-template-columns:repeat(16,minmax(0,1fr));gap:3px;margin-top:16px;max-width:62%;min-height:24px}.c{height:10px;border-radius:2px;background:#5FD49B}.c.soon{background:var(--sky);opacity:.45}.c.off{background:#FF8A7A}
.pulse{position:absolute;left:0;right:0;bottom:0;height:96px;opacity:.9;--bar:var(--sky);--ln:var(--sky);--ar:rgba(111,141,223,.2)}
.owl{position:absolute;right:-6px;bottom:-30px;width:auto;height:290px}.in .owl{animation:float 6s ease-in-out infinite}
section.s{padding:24px 0}.s h2.t{font-size:26px;line-height:1.2;font-weight:700;letter-spacing:-.01em}.s .sub{color:var(--grey);margin-top:4px}
.grid{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:12px;margin-top:14px}.grid.g3{grid-template-columns:repeat(3,minmax(0,1fr))}
.p{display:flex;flex-direction:column;min-width:0;height:100%;padding:14px;border-radius:14px;background:var(--card);box-shadow:inset 0 0 0 1px var(--rule);transition:box-shadow .15s,transform .15s}
.p:hover{box-shadow:inset 0 0 0 1px var(--sky);transform:translateY(-2px)}
.ph{display:flex;align-items:center;gap:8px;min-height:32px}.ph img{width:28px;height:28px;object-fit:contain;border-radius:6px}.ph h3{font-size:16px;font-weight:700;min-width:0}
.st{margin-left:auto;display:inline-flex;align-items:center;gap:5px;font-size:12px;font-weight:600;color:var(--grey)}.st:before{content:"";width:7px;height:7px;border-radius:50%;background:var(--soft)}
[data-state=live] .st{color:var(--ok)}[data-state=live] .st:before{background:var(--ok)}[data-state=down] .st{color:var(--bad)}[data-state=down] .st:before{background:var(--bad)}[data-state=coming] .st{color:var(--soon)}[data-state=coming] .st:before{background:var(--soon)}
.p p{margin-top:6px;font-size:14px;line-height:1.4;color:var(--grey);min-height:2.8em}
.capt{display:block;margin-top:6px;font-size:12px;color:var(--soft)}.g{position:relative;margin-top:10px;height:96px;--bar:var(--blue);--ln:var(--blue);--ar:rgba(55,84,160,.1)}
.k{display:flex;align-items:baseline;gap:6px;min-height:28px;margin-top:auto;padding-top:6px;white-space:nowrap;overflow:hidden}.k b:empty{display:none}.k b{font-size:18px;font-weight:700;font-variant-numeric:tabular-nums}.k span{font-size:12px;color:var(--grey)}
.how{margin-top:2px;font-size:11px;line-height:14px;color:var(--grey)}.g-t{font-size:10px;font-weight:600;fill:var(--grey)}.g-t.inv{fill:#fff}
.g-bar{fill:var(--bar);transform-box:fill-box;transform-origin:bottom}.in .g-bar{animation:grow .5s ease both;animation-delay:calc(var(--i)*12ms)}
.g-line{fill:none;stroke:var(--ln);stroke-width:2}.in .g-line{stroke-dasharray:1;animation:draw .9s ease both}.g-area{fill:var(--ar)}.g-now{fill:var(--ln);animation:pip 2s ease-in-out infinite}
.g-axis{stroke:var(--rule)}.g-dot{fill:var(--rule)}.g-dot.on{fill:var(--bar)}.in .g-dot.on{animation:pip 3s ease-in-out infinite;animation-delay:calc(var(--i)*160ms)}
.g svg{display:block}.g-node{fill:var(--soft)}.g-node.on{fill:var(--blue)}.g-box{fill:var(--soft)}.g-box.on{fill:var(--sky)}.g-link{fill:none;stroke:var(--sky);stroke-width:2;stroke-dasharray:5 5}.in .g-link{animation:dash 1.4s linear infinite}.g-arrow{fill:none;stroke:var(--blue);stroke-width:2}
.news li{display:flex;gap:10px;padding:8px 0;border-top:1px solid var(--rule);font-size:15px}.news time{flex:none;color:var(--grey);font-variant-numeric:tabular-nums}
.band{display:flex;flex-wrap:wrap;align-items:center;gap:14px;justify-content:space-between;padding:18px;border-radius:14px;background:#fff;box-shadow:inset 0 0 0 1px var(--rule)}
footer{margin-top:28px;padding:28px 0;background:var(--navy);color:#fff}footer a:hover{color:var(--sky)}
.f{display:grid;grid-template-columns:1.2fr repeat(3,minmax(0,1fr));gap:20px}.f img{display:block;height:34px;width:auto}.f .lab{display:block;margin-bottom:6px;font-size:12px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--soft)}
.f li a{display:flex;align-items:center;gap:7px;min-height:32px;font-size:14px}.f .ic{width:15px;height:15px;color:var(--sky)}
.fb{display:flex;flex-wrap:wrap;align-items:center;gap:10px 16px;margin-top:18px;padding-top:14px;border-top:1px solid rgba(201,210,232,.25);font-size:13px;color:var(--soft)}.fb ul{display:flex;gap:12px}.fb li a{min-height:44px}.fb .pb{margin-left:auto}.fb .pb img{height:40px}
#toasts{position:fixed;right:16px;bottom:16px;z-index:40;display:flex;flex-direction:column;gap:8px;width:min(320px,calc(100vw - 32px))}
.toast{position:relative;padding:10px 36px 10px 12px;border-radius:10px;background:var(--navy);color:#fff;font-size:14px;box-shadow:0 8px 24px rgba(14,28,56,.3);animation:rise .25s ease both}.toast b{display:block}.toast a,.toast span{color:var(--soft)}.toast button{position:absolute;top:0;right:0;width:44px;height:44px;border:0;background:none;color:#fff;font:inherit;font-size:18px;cursor:pointer}
@keyframes grow{from{transform:scaleY(.1)}}@keyframes draw{from{stroke-dashoffset:1}to{stroke-dashoffset:0}}@keyframes pip{50%{opacity:.45}}@keyframes float{50%{transform:translateY(-8px)}}@keyframes dash{to{stroke-dashoffset:-10}}@keyframes rise{from{opacity:0;transform:translateY(8px)}}
@media (max-width:1160px){.grid{grid-template-columns:repeat(3,minmax(0,1fr))}}@media (max-width:1040px){.grid,.grid.g3{grid-template-columns:repeat(2,minmax(0,1fr))}.top li span{display:none}.hero .w{grid-template-columns:1fr}.f{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media (max-width:640px){.grid,.grid.g3{grid-template-columns:minmax(0,1fr)}.top .w{gap:8px}.top img{height:26px}.top li a{padding:0 7px}.top .btn{display:none}.top ul{gap:0}.hero{padding-top:24px}.kpis,.cells{max-width:none}.live{padding-bottom:100px}.owl{display:none}.f{grid-template-columns:minmax(0,1fr)}.fb .pb{margin-left:0}}
@media (prefers-reduced-motion:reduce){*,*:before,*:after{animation:none!important;transition:none!important;scroll-behavior:auto!important}}
@media (prefers-color-scheme:dark){:root{--ground:#0B1730;--card:#13233F;--navy:#F1F3F8;--rule:#2A3A5C;--soft:#C9D2E8;--grey:#C9D2E8;--blue:#9DB4EE;--ok:#5FD49B;--bad:#FF8A7A;--soon:#E8C877}.top{background:rgba(11,23,48,.92)}.top li a:hover,.band,.btn.alt:hover{background:#13233F}.live,footer,.toast{background:#13233F;color:#fff}.btn{background:#F1F3F8;color:#0E1C38}.btn:hover{background:#C9D2E8}.btn.alt{color:#F1F3F8}.band{box-shadow:inset 0 0 0 1px var(--rule)}.top .logo-l{display:none}.top .logo-d{display:block}}
.top .logo-d{display:none}`

const card = (p, v) => `<a class="p" data-p="${p.key}" data-state="${v.state}" href="${esc(p.href)}"${ext(p.href) ? ' target="_blank" rel="noopener noreferrer"' : ''}><div class="ph"><img src="${esc(p.icon)}" alt="" width="28" height="28" loading="lazy"><h3>${esc(p.name)}</h3><span class="st">${esc(p.kind ?? p.label)}</span></div><p>${esc(p.line)}</p><div class="g" data-g>${v.graph}</div>${v.how ? `<span class="how">${esc(v.how)}</span>` : ''}<div class="k" data-fb="${esc(p.fact)}"><b data-v>${esc(v.value)}</b><span data-u>${esc(v.unit || p.fact)}</span></div></a>`

/** Only what the graphics read: the first HTML stays small. */
function slim({ hub: h, products: p, live: l, stats: s }) {
  return {
    hub: h && { chain: h.chain, gateway: h.gateway, services: h.services?.map((x) => ({ key: x.key, name: x.name, state: x.state, ms: x.ms, history: x.history?.map((y) => ({ ms: y.ms })) })) },
    products: p && { chain: { recent: p.chain?.recent?.slice(-9).map((x) => ({ txs: x.txs })) }, activity: { hourly: p.activity?.hourly?.map(({ launches, trades, swaps }) => ({ launches, trades, swaps })) }, holders: { daily: p.holders?.daily?.map((x) => ({ maps: x.maps })) }, security: p.security && { daily: p.security.daily?.map((x) => ({ scans: x.scans })), total: p.security.total } },
    live: l && { id: l.id && { totals: { users: l.id.totals?.users }, dailySignins: l.id.dailySignins?.map((x) => ({ n: x.n })) }, pay: l.pay && { services: l.pay.services }, head: l.head, feed: l.feed && { items: l.feed.items?.map((x) => ({ id: x.id })) } },
    stats: s && { totals: { tvlUsd: s.totals?.tvlUsd }, venues: s.venues?.map((v) => ({ key: v.key, state: v.state, tvlUsd: v.tvlUsd, daily: (v.daily ?? []).slice(-30).map((d) => ({ v: d.v })) })) },
  }
}

/** The whole page. `meta`: title, description and head tags, already rendered for this path by seo.mjs. */
export async function renderLanding(head, given = null) {
  const [hubB, products, live, stats] = given ? [given.hub, given.products, given.live, given.stats] : await Promise.all([within(hub(), 250), within(hubProducts(), 250), within(hubLive(), 250), within(readStats(), 250)])
  const data = { hub: hubB, products, live, stats }
  const c = cards(data)
  const b = board(data)
  const N = CONTENT.nav
  const [h1a, h1b, h1c] = L.headline
  const boot = JSON.stringify(slim(data)).replace(/</g, '\\u003c')
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${head}<link rel="preload" href="/fonts/figtree-latin-700.woff2" as="font" type="font/woff2" crossorigin><link rel="preload" href="/brand/kit/owl/owl-presenting-400.webp" as="image"><link rel="modulepreload" href="/landing/graphs.mjs"><style>${CSS}</style></head><body>
<header class="top"><div class="w"><a href="/" aria-label="Gully Labs home"><img class="logo-l" src="/brand/kit/logotype-color.svg" alt="Gully Labs" width="165" height="32"><img class="logo-d" src="/brand/kit/logotype-reversed.svg" alt="" width="165" height="32"></a><nav aria-label="Main"><ul>${N.headerHome.map(navLink).join('')}</ul></nav><a class="btn" href="https://app.gullylabs.xyz" target="_blank" rel="noopener noreferrer">${icon('zap')}Launch app</a></div></header>
<main>
<section class="hero"><div class="w"><div><h1>${esc(h1a)} <em>${esc(h1b)}</em> ${esc(h1c)}</h1><p class="lede">${esc(L.lede)}</p><div class="cta"><a class="btn" href="#products">${icon('layout-grid')}See the products</a><a class="btn alt" href="/services#contact">${icon('mail')}Start a project</a></div></div>
<div class="live" id="live" data-anim><h2><i class="pip"></i>Live now</h2><div class="kpis"><div><b data-b="up">${esc(b.up)}</b><small>surfaces up</small></div><div><b data-b="ms">${esc(b.ms)}</b><small>mean response</small></div><div><b data-b="tvl">${esc(b.tvl)}</b><small>value locked</small></div><div><b data-b="block">${esc(b.block)}</b><small>Gully Chain block</small></div></div><div class="cells" data-b="cells" role="img" aria-label="One cell per public surface">${b.cells}</div><small class="capt">Every public surface, checked each minute</small><img class="owl" src="/brand/kit/owl/owl-presenting-400.webp" alt="" width="217" height="400" fetchpriority="low"><div class="pulse" data-b="pulse">${b.pulse}</div></div></div></section>
<section class="s" id="products"><div class="w"><h2 class="t">${esc(L.productsTitle)}</h2><p class="sub">${esc(L.productsSub)}</p><div class="grid" data-anim>${L.products.map((p) => card(p, c[p.key])).join('')}</div></div></section>
<section class="s"><div class="w"><h2 class="t">${esc(L.peddleTitle)}</h2><p class="sub">${esc(L.peddleSub)}</p><div class="grid g3" data-anim>${L.peddle.map((p) => card(p, c[p.key])).join('')}</div></div></section>
<section class="s"><div class="w"><h2 class="t">${esc(L.newsTitle)}</h2><ul class="news" style="margin-top:10px">${L.news.map((n) => `<li><time datetime="${esc(n.d)}">${esc(n.d)}</time>${a(n.href, esc(n.t))}</li>`).join('')}</ul></div></section>
<section class="s"><div class="w"><div class="band"><div><h2 class="t">${esc(L.buildTitle)}</h2><p class="sub">${esc(L.buildSub)}</p></div><a class="btn" href="/services#contact">${icon('mail')}Start a project</a></div></div></section>
</main>
<footer><div class="w"><div class="f"><div><img src="/brand/kit/logotype-reversed.svg" alt="Gully Labs" width="175" height="34" loading="lazy"><p style="margin-top:10px;font-size:14px;color:var(--soft)">${esc(N.tagline)}</p><ul style="margin-top:8px">${N.footer.map(navLink).join('')}</ul></div>${N.products.map((g) => `<nav aria-label="${esc(g.group)}"><span class="lab">${esc(g.group)}</span><ul>${g.links.map(([href, label]) => `<li>${a(href, `${icon(PRODUCT_ICON[label] ?? 'box')}<span>${esc(label)}</span>`)}</li>`).join('')}</ul></nav>`).join('')}</div><div class="fb"><span>${esc(N.copy)}</span><ul>${N.legal.map(navLink).join('')}</ul><a class="pb" href="/" aria-label="Powered by Gully Labs"><img src="/brand/kit/powered-by-clear-white.svg" alt="Powered by Gully Labs" width="150" height="40" loading="lazy"></a></div></div></footer>
<div id="toasts" role="status" aria-live="polite"></div>
<script type="application/json" id="boot">${boot}</script><script type="module" src="/landing/live.js"></script></body></html>`
}

/** The two script files, from server/ so the server and the browser run the same graph code. */
export function landingAsset(pathname) {
  const f = pathname === '/landing/graphs.mjs' ? 'landing-graphs.mjs' : pathname === '/landing/live.js' ? 'landing-live.mjs' : null
  return f ? fs.readFileSync(new URL(`./${f}`, import.meta.url), 'utf8') : null
}
