// The landing's graphics, as plain functions from live data to SVG strings. One file for both sides: server/landing.mjs
// draws them into the first HTML from the last known figures, and the browser imports this same file (served at
// /landing/graphs.mjs) to redraw them on every poll, so the page never changes shape when it goes live.
// Every number comes from /api/hub, /api/hub/products, /api/hub/live or /api/stats. A source that cannot be read gives
// an empty frame and "–", never a zero. A graphic with no data source is a diagram of how the feature works, and says so
// in its caption (`how`): it carries no figures, and the real number sits beside it.

const W = 240
const H = 96
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
export const fmtInt = (v) => (num(v) == null ? '–' : Math.round(v).toLocaleString('en-US'))
export const fmtUsd = (v) => {
  if (num(v) == null) return '–'
  if (v >= 1e6) return `$${(v / 1e6).toFixed(2)}M`
  if (v >= 1e3) return `$${(v / 1e3).toFixed(1)}K`
  return `$${v.toFixed(v < 100 ? 2 : 0)}`
}
/** `fit`: bars and lines stretch to the card; dots and diagrams keep their shape. */
const svg = (body, label, fit = false) => `<svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}"${fit ? ' preserveAspectRatio="none"' : ''} role="img" aria-label="${label}">${body}</svg>`
const empty = (label) => svg(`<line x1="0" y1="${H - 1}" x2="${W}" y2="${H - 1}" class="g-axis"/>`, `${label}: no data yet`, true)

/** Bars, newest on the right. */
export function bars(values, label, none) {
  const v = values.filter((x) => num(x) != null)
  if (!v.length) return empty(label)
  // Every hour is a real zero: keep the resting line and say so in the chart (the kre8 rule for empty charts).
  if (none && v.every((x) => x === 0)) return `<div class="g-wrap">${svg(`<line x1="0" y1="${H - 1}" x2="${W}" y2="${H - 1}" class="g-axis g-rest"/>`, `${label}: ${none}`, true)}<span class="g-none">${none}</span></div>`
  const max = Math.max(...v, 1)
  const w = W / values.length
  const rects = values.map((x, i) => {
    const h = num(x) ? Math.max(2, (x / max) * (H - 6)) : 1
    return `<rect class="g-bar" style="--i:${i}" x="${(i * w + 0.5).toFixed(1)}" y="${(H - h).toFixed(1)}" width="${Math.max(1, w - 1).toFixed(1)}" height="${h.toFixed(1)}" rx="1"/>`
  })
  return svg(rects.join(''), label, true)
}

/** A line with its area, drawn in on load. */
export function line(values, label) {
  const pts = values.map((x, i) => [i, num(x)]).filter((p) => p[1] != null)
  if (pts.length < 2) return empty(label)
  const ys = pts.map((p) => p[1])
  const lo = Math.min(...ys)
  const hi = Math.max(...ys)
  const span = hi - lo || 1
  const xy = pts.map(([i, y]) => [(i / (values.length - 1)) * W, H - 5 - ((y - lo) / span) * (H - 12)])
  const d = xy.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join('')
  const last = xy[xy.length - 1]
  return svg(`<path class="g-area" d="${d}L${last[0].toFixed(1)} ${H}L${xy[0][0].toFixed(1)} ${H}Z"/><path class="g-line" pathLength="1" d="${d}" vector-effect="non-scaling-stroke"/>`, label, true)
}

/** One dot per item, filled when it is up. */
export function dots(items, label) {
  if (!items.length) return empty(label)
  const per = Math.min(items.length, 12)
  const step = W / per
  return svg(items.slice(0, 24).map((it, i) => `<circle class="g-dot ${it.ok ? 'on' : ''}" style="--i:${i}" cx="${(step * (i % per) + step / 2).toFixed(1)}" cy="${items.length > per ? (i < per ? 18 : 46) : 32}" r="7"/>`).join(''), label)
}

const node = (x, y, r, on, t) => `<circle class="g-node${on ? ' on' : ''}" cx="${x}" cy="${y}" r="${r}"/>${t ? `<text class="g-t" x="${x}" y="${y + r + 11}" text-anchor="middle">${t}</text>` : ''}`
const box = (x, y, w, h, on, t) => `<rect class="g-box${on ? ' on' : ''}" x="${x}" y="${y}" width="${w}" height="${h}" rx="6"/>${t ? `<text class="g-t${on ? ' inv' : ''}" x="${x + w / 2}" y="${y + h / 2 + 3.5}" text-anchor="middle">${t}</text>` : ''}`
const wire = (d) => `<path class="g-link" d="${d}"/>`
const head = (x, y) => `<path class="g-arrow" d="M${x - 7} ${y - 6}l8 6-8 6"/>`

/** Diagrams: how a feature works. They carry no figures. */
export const diagrams = {
  id: () => svg(`<g>${box(6, 34, 70, 28, true, 'One passkey')}${wire('M76 48L150 15M76 48L150 37M76 48L150 59M76 48L150 81')}${['Pay', 'Chain', 'RPC', 'Studio'].map((t, i) => box(150, 4 + i * 22, 84, 20, false, t)).join('')}</g>`, 'Diagram: one passkey signs in to every Gully app'),
  pay: () => svg(`<g>${box(4, 34, 58, 28, false, 'Buyer')}${wire('M62 48H91')}${box(92, 26, 64, 44, true, 'Checkout')}${wire('M156 48H176')}${head(184, 48)}${box(186, 34, 50, 28, false, 'You')}<text class="g-t" x="124" y="84" text-anchor="middle">cards, USDC, x402</text></g>`, 'Diagram: a buyer pays through checkout and the money settles to your wallet'),
  holders: () => svg(`<g>${node(62, 44, 32, true)}${node(120, 22, 15)}${node(128, 66, 20)}${wire('M92 40L108 28M90 56L110 62')}${node(192, 46, 25, true)}${node(226, 20, 10)}${wire('M211 30L219 25')}</g>`, 'Diagram: holders drawn as bubbles, linked when wallets trade with each other'),
  security: () => svg(`<g>${box(4, 26, 62, 44, false, 'Contract')}${wire('M66 48H88')}${[0, 1, 2].map((i) => `<rect class="g-box${i === 1 ? ' on' : ''}" x="90" y="${22 + i * 19}" width="${[70, 54, 62][i]}" height="12" rx="4"/>`).join('')}${wire('M162 48H180')}${head(188, 48)}${box(190, 26, 46, 44, true, 'Report')}</g>`, 'Diagram: a contract is scanned, checks run, and a report comes out'),
  studio: () => svg(`<g>${box(84, 20, 72, 56, true, 'Game')}${wire('M84 32H50M84 48H50M84 64H50M156 48H190')}${box(4, 22, 46, 20, false, 'ID')}${box(4, 44, 46, 20, false, 'Pay')}${box(4, 66, 46, 20, false, 'Chain')}${box(190, 34, 46, 28, false, 'Friends')}</g>`, 'Diagram: games with Gully ID, Gully Pay and Gully Chain inside, played with friends'),
  ai: () => svg(`<g>${box(6, 10, 128, 26, false, 'Your question')}${box(50, 46, 184, 26, true, 'An answer, with sources')}<circle class="g-node on" cx="62" cy="84" r="3"/><circle class="g-node on" cx="74" cy="84" r="3"/><circle class="g-node on" cx="86" cy="84" r="3"/></g>`, 'Diagram: a question and an answer with its sources'),
  multisig: () => svg(`<g>${node(26, 14, 11, true)}${node(26, 48, 11, true)}${node(26, 82, 11)}${wire('M37 14L104 42M37 48H104M37 82L104 54')}${box(104, 28, 66, 40, true, 'Threshold')}${wire('M170 48H192')}${head(200, 48)}<text class="g-t" x="222" y="52" text-anchor="middle">Sent</text></g>`, 'Diagram: owners sign until the threshold is met, then the transaction runs'),
  core: () => svg(`<g><path class="g-line" pathLength="1" d="M8 86C60 84 110 72 150 26" vector-effect="non-scaling-stroke"/>${wire('M152 24H190')}${head(198, 24)}${box(200, 10, 36, 28, true, 'Pool')}<text class="g-t" x="66" y="66">Curve</text><text class="g-t" x="150" y="52">Graduates</text></g>`, 'Diagram: a token trades on its curve, then graduates to a pool'),
  swap: () => svg(`<g>${node(50, 40, 24, false, 'Token')}${node(190, 40, 24, true, 'Token')}<path class="g-link" d="M82 30H158"/>${head(166, 30)}<path class="g-link" d="M158 50H82"/><path class="g-arrow" d="M81 44l-8 6 8 6"/></g>`, 'Diagram: swap one token for another'),
  launch: () => svg(`<g>${box(6, 34, 62, 28, true, 'Memecoin')}${wire('M68 48H98')}${box(100, 34, 54, 28, false, 'Stock')}${wire('M154 48H176')}${head(184, 48)}${box(186, 34, 50, 28, true, 'Holders')}</g>`, 'Diagram: a memecoin paired to a stock pays its holders in that stock'),
  quest: () => svg(`<g>${[0, 1, 2].map((i) => `${node(30 + i * 62, 40, 15, i < 2)}${i < 2 ? wire(`M${45 + i * 62} 40H${77 + i * 62}`) : ''}`).join('')}${wire('M169 40H190')}${head(198, 40)}${box(200, 26, 36, 28, true, 'XP')}<text class="g-t" x="92" y="78" text-anchor="middle">Verified quests</text></g>`, 'Diagram: complete verified steps and earn the proof'),
}

/** The newest blocks as a chain: each block's fill is how many transactions it held. */
export function blocks(recent, label) {
  const b = (recent ?? []).slice(-9)
  if (!b.length) return empty(label)
  const max = Math.max(1, ...b.map((x) => x.txs ?? 0))
  const size = 22
  const gap = (W - b.length * size) / Math.max(1, b.length - 1)
  return svg(b.map((x, i) => {
    const px = i * (size + gap)
    const fill = Math.max(3, ((x.txs ?? 0) / max) * size)
    return `<rect class="g-box" x="${px.toFixed(1)}" y="30" width="${size}" height="${size}" rx="4"/><rect class="g-bar" style="--i:${i}" x="${px.toFixed(1)}" y="${(52 - fill).toFixed(1)}" width="${size}" height="${fill.toFixed(1)}" rx="4"/>${i < b.length - 1 ? `<path class="g-link" d="M${(px + size).toFixed(1)} 41h${gap.toFixed(1)}"/>` : ''}`
  }).join('') + `<text class="g-t" x="0" y="72">Newest blocks, filled by transactions</text>`, label)
}

/** One key in the middle, one spoke per network the gateway serves, filled when it answers. */
export function spokes(nets, label) {
  if (!nets.length) return empty(label)
  const R = 38
  const cx = W / 2
  const cy = 48
  const pts = nets.slice(0, 10).map((n, i, a) => {
    const t = (i / a.length) * Math.PI * 2 - Math.PI / 2
    return [cx + Math.cos(t) * R * 2.2, cy + Math.sin(t) * R, n.ok]
  })
  return svg(pts.map(([x, y]) => `<path class="g-link" d="M${cx} ${cy}L${x.toFixed(1)} ${y.toFixed(1)}"/>`).join('') + pts.map(([x, y, ok]) => `<circle class="g-node${ok ? ' on' : ''}" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="7"/>`).join('') + box(cx - 18, cy - 12, 36, 24, true, 'Key'), label)
}

const history = (hub, key) => (hub?.services ?? []).find((s) => s.key === key)?.history?.map((h) => h.ms) ?? []
const service = (hub, key) => (hub?.services ?? []).find((s) => s.key === key)
/** live | down | coming | reading, from the probes that make up a product. */
function stateOf(hub, keys) {
  if (!hub) return 'reading'
  const svcs = (hub.services ?? []).filter((s) => keys.includes(s.key))
  const real = svcs.filter((s) => s.state !== 'coming')
  if (!real.length) return svcs.length ? 'coming' : 'reading'
  return real.every((s) => s.state === 'up') ? 'live' : 'down'
}
/** Null when there is nothing to add: an unreadable source is a dash, not a zero. */
const sum = (xs) => (xs.length ? xs.reduce((a, b) => a + (num(b) ?? 0), 0) : null)

/** The surfaces that make up each product's state (as src/pages/hub/hubData.ts SERVICE_KEYS). */
export const KEYS = {
  id: ['gully-id'],
  pay: ['pay', 'x402', 'pay-admin'],
  chain: ['chain-site', 'street', 'explorer', 'faucet', 'bridge', 'indexer', 'rpc-public', 'copy', 'social-api', 'docs', 'devportal', 'sentry', 'offerwall'],
  rpc: ['rpc-site', 'rpc-app', 'rpc-gateway'],
  holdermaps: ['holders'],
  security: ['security'],
  studio: ['studio', 'studio-dev', 'studio-docs'],
  ai: ['gullyai', 'ai-api'],
  multisig: ['safe'],
}

/** A figure worth showing: a dash for a source that cannot be read, nothing for a value too small to say anything. */
const usd = (v, min = 1000) => (num(v) == null || v < min ? '' : fmtUsd(v))

/** One card per product: { state, value, unit, graph, how }. `how` marks a graphic as a diagram, not a metric. An empty
    value and unit leave the card's own fixed line (data-fb). */
export function cards({ hub, products, live, stats }) {
  const act = products?.activity?.hourly ?? []
  const venue = (k) => (stats?.venues ?? []).find((v) => v.key === k)
  const gw = hub?.gateway
  const how = 'How it works'
  const peddle = (k, g) => {
    const v = venue(k)
    const value = usd(v?.tvlUsd)
    return { state: v?.state === 'ok' ? 'live' : stats ? 'down' : 'reading', value, unit: value ? 'value locked' : '', graph: g(), how }
  }
  const launches = act.length ? sum(act.map((x) => x.launches)) : null
  const maps = (products?.holders?.daily ?? []).length ? sum(products.holders.daily.map((d) => d.maps)) : null
  return {
    id: { state: stateOf(hub, KEYS.id), value: fmtInt(live?.id?.totals?.users), unit: 'accounts', graph: diagrams.id(), how },
    pay: { state: stateOf(hub, KEYS.pay), value: live?.pay ? `${Object.values(live.pay.services).filter((s) => s === 'operational').length}/${Object.keys(live.pay.services).length}` : '–', unit: 'services operational', graph: diagrams.pay(), how },
    chain: { state: stateOf(hub, KEYS.chain), value: fmtInt(hub?.chain?.head ?? live?.head?.block), unit: 'latest block', graph: blocks(products?.chain?.recent, 'Newest Gully Chain blocks') },
    rpc: { state: stateOf(hub, KEYS.rpc), value: gw ? `${gw.ok}/${gw.total}` : '–', unit: 'networks answering', graph: spokes((gw?.networks ?? []).map((n) => ({ ok: n.state === 'OK' })), 'One API key, one spoke per network on the Gully RPC gateway') },
    holdermaps: { state: stateOf(hub, KEYS.holdermaps), value: fmtInt(maps), unit: 'maps opened', graph: diagrams.holders(), how },
    security: { state: stateOf(hub, KEYS.security), value: products?.security?.total ? fmtInt(products.security.total) : '', unit: products?.security?.total ? 'scans run' : '', graph: diagrams.security(), how },
    studio: { state: stateOf(hub, KEYS.studio), value: '', unit: '', graph: diagrams.studio(), how },
    ai: { state: stateOf(hub, ['ai-api']) === 'live' ? 'live' : 'coming', value: '', unit: '', graph: diagrams.ai(), how },
    multisig: { state: stateOf(hub, KEYS.multisig), value: '', unit: '', graph: diagrams.multisig(), how },
    kre8: { state: stateOf(hub, ['street']), value: '', unit: '', graph: '', how: '' },
    bridge: { state: stateOf(hub, ['bridge']), value: '', unit: '', graph: '', how: '' },
    faucet: { state: stateOf(hub, ['faucet']), value: '', unit: '', graph: '', how: '' },
    explorer: { state: stateOf(hub, ['explorer']), value: '', unit: '', graph: '', how: '' },
    core: { state: stateOf(hub, ['street', 'indexer']), value: launches ? fmtInt(launches) : '', unit: launches ? 'launches, 24 h' : '', graph: diagrams.core(), how },
    peddleswap: peddle('peddleswap', diagrams.swap),
    peddles: peddle('peddles', diagrams.launch),
    peddlequest: peddle('peddlequest', diagrams.quest),
  }
}

/* ---- the constellation: the same geometry as src/pages/hub/hubData.ts MAP, with Gully Core, kre8 and Gully Multisig added
   on the bottom row, where nothing else sits. Rings, tags and metrics redraw from live data; links never move. ---- */
const MAPS = {
  wide: { vb: [926, 646], r: 34, rc: 47, spark: 3, t: [13, 23, 40], at: { id: [163, 114], pay: [451, 58], rpc: [740, 114], holdermaps: [785, 330], security: [622, 548], studio: [280, 548], ai: [118, 330], chain: [451, 300], core: [451, 548], kre8: [118, 548], multisig: [785, 548] } },
  tall: { vb: [360, 600], r: 24, rc: 32, spark: 2.4, t: [8, 15, 28], at: { id: [64, 62], pay: [180, 62], rpc: [296, 62], ai: [64, 216], chain: [180, 216], holdermaps: [296, 216], studio: [64, 376], core: [180, 376], security: [296, 376], kre8: [100, 530], multisig: [260, 530] } },
}
const EDGES = [['id', 'chain', 'live'], ['id', 'pay', 'plan'], ['id', 'rpc', 'plan'], ['id', 'studio', 'live'], ['pay', 'chain', 'live'], ['pay', 'rpc', 'plan'], ['pay', 'studio', 'live'], ['rpc', 'chain', 'live'], ['chain', 'holdermaps', 'live'], ['chain', 'security', 'live'], ['chain', 'studio', 'live'], ['ai', 'studio', 'plan'], ['chain', 'core', 'live'], ['chain', 'kre8', 'live'], ['chain', 'multisig', 'live']]
/** Rings on the kit palette; the logos carry each product's own colour. */
const RING = '#6F8DDF'
function curve(a, b, c, k = 18) {
  const mx = (a[0] + b[0]) / 2
  const my = (a[1] + b[1]) / 2
  const dx = mx - c[0]
  const dy = my - c[1]
  const d = Math.hypot(dx, dy) || 1
  return `M${a[0]} ${a[1]} Q${(mx + (dx / d) * k).toFixed(1)} ${(my + (dy / d) * k).toFixed(1)} ${b[0]} ${b[1]}`
}

/** Tag and one-line metric per node, from the live sources. `stages`: each product's stage (Live, Testnet, Open beta,
    Coming online); a service that is down says so whatever its stage. An unreadable source is a dash, never a zero. */
export function mapNodes({ hub, products, live, stages = {} }) {
  const n = (v, unit) => (num(v) == null ? '–' : `${fmtInt(v)} ${unit}`)
  const act = products?.activity?.hourly
  const total = (k) => (act?.length ? sum(act.map((x) => x[k])) : null)
  const pay = live?.pay?.services
  const gw = hub?.gateway
  const q = hub?.quests
  const frog = (q?.quests ?? []).filter((x) => /frog hop/i.test(x.title ?? ''))
  const scans = products?.security?.daily
  const api = (hub?.services ?? []).find((s) => s.key === 'ai-api')
  const apiUp = !!api && (api.state === 'up' || api.up)
  const safe = service(hub, 'safe')
  const metric = {
    id: n(live?.id?.signins24h, 'sign-ins 24h'),
    pay: pay ? `${Object.values(pay).filter((s) => s === 'operational').length}/${Object.keys(pay).length} services ok` : '–',
    chain: num(live?.head?.block ?? hub?.chain?.head) == null ? '–' : `block ${fmtInt(live?.head?.block ?? hub?.chain?.head)}`,
    rpc: gw ? `${gw.ok}/${gw.total} networks ok` : '–',
    holdermaps: n(products?.holders?.today, 'maps today'),
    security: scans ? `${fmtInt(sum(scans.map((d) => d.scans)) ?? 0)} scans ${scans.length} d` : '–',
    studio: !q ? '–' : frog.length ? `${fmtInt(frog.reduce((a, x) => a + (x.completions || 0), 0))} Frog Hop runs` : 'no Frog Hop runs yet',
    ai: apiUp ? 'API answering' : 'API coming online',
    core: n(total('launches'), 'launches 24h'),
    kre8: n(total('trades'), 'trades 24h'),
    multisig: num(safe?.ms) == null ? '–' : `${fmtInt(safe.ms)} ms`,
  }
  const keys = { ...KEYS, core: ['street', 'indexer'], kre8: ['street'], ai: ['ai-api'] }
  const out = {}
  for (const k of Object.keys(metric)) {
    const st = stateOf(hub, keys[k])
    const stage = k === 'ai' && apiUp ? 'Live' : stages[k] ?? 'Live'
    const down = st === 'down' && stage !== 'Coming online'
    out[k] = { tag: down ? 'Down' : stage, cls: down ? 'down' : /coming/i.test(stage) ? 'soon' : /live/i.test(stage) ? 'live' : 'beta', metric: metric[k], up: st === 'live', soon: /coming/i.test(stage) }
  }
  return out
}

/** The constellation as SVG. `nodes`: [{ key, name, icon, href }]. Pulses are SMIL along the solid links. */
export function constellation(layout, nodes, data) {
  const L = MAPS[layout]
  const c = L.at.chain
  const live = mapNodes(data)
  const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
  const lines = EDGES.map(([a, b, kind], i) => `<path id="${layout}-e${i}" class="edge ${kind}" d="${curve(L.at[a], L.at[b], c)}"/>`).join('')
  const sparks = EDGES.map(([, , kind], i) => (kind === 'live' ? `<circle class="spark" r="${L.spark}"><animateMotion dur="${3 + (i % 4) * 0.7}s" repeatCount="indefinite" begin="-${(i * 0.37).toFixed(2)}s"><mpath href="#${layout}-e${i}"/></animateMotion></circle>` : '')).join('')
  const clips = nodes.map((p) => `<clipPath id="${layout}-cp-${p.key}"><circle r="${(p.key === 'chain' ? L.rc : L.r) - 5}"/></clipPath>`).join('')
  const ext = (h) => (/^https?:/.test(h) ? ' target="_blank" rel="noopener noreferrer"' : '')
  const body = nodes.map((p) => {
    const r = p.key === 'chain' ? L.rc : L.r
    const [x, y] = L.at[p.key]
    const v = live[p.key]
    const inset = Math.round(((p.inset ?? 0) * r) / 34)
    return `<a href="${esc(p.href)}"${ext(p.href)} aria-label="${esc(p.name)}"><g class="nd2${v.up ? ' is-up' : ''}${v.soon ? ' is-soon' : ''}" data-mk="${p.key}" style="--c:${RING}" transform="translate(${x} ${y})"><circle class="out" r="${r + 9}"/><circle class="ping" r="${r + 2}"/><circle class="halo" r="${r}"/><image href="${esc(p.icon)}" x="${-(r - 5 - inset)}" y="${-(r - 5 - inset)}" width="${2 * (r - 5 - inset)}" height="${2 * (r - 5 - inset)}" clip-path="url(#${layout}-cp-${p.key})" preserveAspectRatio="xMidYMid slice"/><text class="st ${v.cls}" y="${-r - L.t[0]}" text-anchor="middle">${esc(v.tag)}</text><text class="nm" y="${r + L.t[1]}" text-anchor="middle">${esc(p.name)}</text><text class="mt" y="${r + L.t[2]}" text-anchor="middle">${esc(v.metric)}</text></g></a>`
  }).join('')
  return `<svg class="cmap-${layout}" viewBox="0 0 ${L.vb[0]} ${L.vb[1]}" role="group" aria-label="The Gully products as a connected map, with a live reading on each"><defs>${clips}</defs><g>${lines}${sparks}</g>${body}</svg>`
}

/** The Build panel's chart: real Gully Chain testnet activity by the hour, never a drawn curve. */
export const METRIC = { launches: 'Launches', swaps: 'Swaps', trades: 'Trades', blocks: 'Newest blocks' }
export const metricNote = (metric) => (metric === 'blocks' ? 'on Gully Chain testnet, filled by transactions' : 'on Gully Chain testnet, last 24 hours')
export const coreBars = (products, metric) => {
  if (metric === 'blocks') return blocks(products?.chain?.recent, 'Newest Gully Chain blocks')
  const hourly = products?.activity?.hourly ?? []
  return bars(hourly.map((h) => h[metric] ?? 0), `${METRIC[metric]} on Gully Chain testnet, last 24 hours`, `No ${METRIC[metric].toLowerCase()} in the last 24 hours`)
}

/** The hero's board: one cell per public surface, and the figures across them. */
export function board({ hub, stats }) {
  const svcs = hub?.services ?? []
  const real = svcs.filter((s) => s.state !== 'coming')
  const up = real.filter((s) => s.state === 'up')
  const ms = up.map((s) => s.ms).filter((m) => num(m) != null)
  const series = []
  const len = Math.max(0, ...svcs.map((s) => s.history?.length ?? 0))
  for (let i = 0; i < len; i++) {
    const at = svcs.map((s) => s.history?.[s.history.length - len + i]?.ms).filter((m) => num(m) != null)
    series.push(at.length ? at.reduce((a, b) => a + b, 0) / at.length : null)
  }
  return {
    up: hub ? `${up.length}/${real.length}` : '–',
    ms: ms.length ? `${Math.round(ms.reduce((a, b) => a + b, 0) / ms.length)} ms` : '–',
    block: fmtInt(hub?.chain?.head),
    tvl: fmtUsd(stats?.totals?.tvlUsd),
    vol: fmtUsd(stats?.totals?.volumeAllUsd),
    cells: svcs.map((s) => `<i class="c ${s.state === 'up' ? 'up' : s.state === 'coming' ? 'soon' : 'off'}" title="${s.name}: ${s.state}"></i>`).join(''),
    pulse: line(series, 'Mean response time across every surface, last hour'),
  }
}

/** A reading on the clock people here read: Los Angeles, labelled PT. Instants stay in UTC in the data. */
export const ptTime = (t = Date.now()) => `${new Date(t).toLocaleTimeString('en-US', { timeZone: 'America/Los_Angeles', hour: 'numeric', minute: '2-digit' })} PT`

const WORD = { live: 'Live', down: 'Down', coming: 'Coming online', reading: 'Reading' }
/** Everything a product page shows that moves. `page`: { card, hub: [probe keys], metric }. Same rules as the landing:
    an unreadable source is a dash and an empty frame, never a zero. */
export function productView({ hub, products, live, stats }, page) {
  const card = page.card ? cards({ hub, products, live, stats })[page.card] : null
  const svcs = (hub?.services ?? []).filter((s) => page.hub.includes(s.key))
  const state = card?.state ?? stateOf(hub, page.hub)
  const up = svcs.filter((s) => s.state === 'up')
  const mean = (xs) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null)
  const msNow = mean(up.map((s) => s.ms).filter((m) => num(m) != null))
  const len = Math.max(0, ...svcs.map((s) => s.history?.length ?? 0))
  const series = []
  for (let i = 0; i < len; i++) {
    const at = svcs.map((s) => s.history?.[s.history.length - len + i]?.ms).filter((m) => num(m) != null)
    series.push(at.length ? at.reduce((a, b) => a + b, 0) / at.length : null)
  }
  const all = svcs.flatMap((s) => s.history ?? [])
  const answered = all.filter((h) => num(h.ms) != null).length
  const meanMs = mean(series.filter((x) => x != null))
  return {
    state,
    word: WORD[state] ?? state,
    value: card?.value && card.value !== '–' ? card.value : '',
    unit: card?.unit ?? '',
    up: hub ? `${up.length}/${svcs.length}` : '–',
    ms: msNow == null ? '–' : `${msNow} ms`,
    answered: all.length ? `${((answered / all.length) * 100).toFixed(1)}%` : '–',
    meanMs: meanMs == null ? '–' : `${meanMs} ms`,
    latency: line(series, 'Mean response time of this product, last hour'),
    activity: page.metric === 'blocks' ? blocks(products?.chain?.recent, 'Newest Gully Chain blocks') : page.metric ? coreBars(products, page.metric) : '',
    cells: svcs.map((s) => `<i class="c ${s.state === 'up' ? 'up' : s.state === 'coming' ? 'soon' : 'off'}" title="${s.name}: ${s.state}"></i>`).join(''),
  }
}

/** A launch preset's fee over its window. `p`: { from, to }, percent: the opening fee, falling to the final fee. */
export function feeCurve(p) {
  const y = (v) => (H - 8 - (v / 50) * (H - 16)).toFixed(1)
  return svg(`<path class="g-line" pathLength="1" d="M0 ${y(p.from)}L${p.from === p.to ? W : W * 0.8} ${y(p.to)}L${W} ${y(p.to)}" vector-effect="non-scaling-stroke"/>`, `The fee falls from ${p.from}% to ${p.to}%`, true)
}
