// The landing's graphics, as plain functions from live data to SVG strings. One file for both sides: server/landing.mjs
// draws them into the first HTML from the last known figures, and the browser imports this same file (served at
// /landing/graphs.mjs) to redraw them on every poll, so the page never changes shape when it goes live.
// Every number comes from /api/hub, /api/hub/products, /api/hub/live or /api/stats. A source that cannot be read gives
// an empty frame and "–", never a zero. A graphic with no data source is a diagram of how the feature works, and says so
// in its caption (`how`): it carries no figures.

const W = 240
const H = 64
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
export function bars(values, label) {
  const v = values.filter((x) => num(x) != null)
  if (!v.length) return empty(label)
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

/** Diagrams: how a feature works. No figures in them. */
export const diagrams = {
  multisig: () => svg(`<g class="g-flow"><circle class="g-node on" cx="28" cy="16" r="9"/><circle class="g-node on" cx="28" cy="48" r="9"/><circle class="g-node" cx="76" cy="32" r="9"/><path class="g-link" d="M37 16L120 30M37 48L120 34"/><rect class="g-box" x="120" y="16" width="44" height="32" rx="6"/><path class="g-link" d="M164 32H206"/><path class="g-arrow" d="M202 25l10 7-10 7"/></g>`, 'Diagram: owners sign until the threshold is met, then the transaction runs'),
  holders: () => svg(`<g class="g-flow"><circle class="g-node on" cx="60" cy="30" r="22"/><circle class="g-node" cx="104" cy="16" r="11"/><circle class="g-node" cx="112" cy="46" r="14"/><path class="g-link" d="M82 30L100 44M78 20L94 17"/><circle class="g-node on" cx="178" cy="32" r="17"/><circle class="g-node" cx="214" cy="18" r="8"/><path class="g-link" d="M194 26L207 21"/></g>`, 'Diagram: holders drawn as bubbles, linked when wallets trade with each other'),
  ai: () => svg(`<g class="g-flow"><rect class="g-box" x="12" y="14" width="96" height="14" rx="7"/><rect class="g-box on" x="60" y="36" width="168" height="14" rx="7"/></g>`, 'Diagram: a question and an answer with its sources'),
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
const sum = (xs) => xs.reduce((a, b) => a + (num(b) ?? 0), 0)

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

/** One card per product: { state, value, unit, graph, how } */
export function cards({ hub, products, live, stats }) {
  const chainHours = products?.chain?.hourly ?? []
  const act = products?.activity?.hourly ?? []
  const venue = (k) => (stats?.venues ?? []).find((v) => v.key === k)
  const gw = hub?.gateway
  const peddle = (k) => {
    const v = venue(k)
    return { state: v?.state === 'ok' ? 'live' : stats ? 'down' : 'reading', value: fmtUsd(v?.tvlUsd), unit: 'value locked', graph: line((v?.daily ?? []).slice(-30).map((d) => d.v), `${k} daily volume, last 30 days`) }
  }
  return {
    id: { state: stateOf(hub, KEYS.id), value: fmtInt(live?.id?.totals?.users), unit: 'accounts', graph: bars((live?.id?.dailySignins ?? []).map((d) => d.n), 'Gully ID sign-ins per day, last 30 days') },
    pay: { state: stateOf(hub, KEYS.pay), value: live?.pay ? `${Object.values(live.pay.services).filter((s) => s === 'operational').length}/${Object.keys(live.pay.services).length}` : '–', unit: 'services operational', graph: dots(Object.entries(live?.pay?.services ?? {}).map(([k, s]) => ({ k, ok: s === 'operational' })), 'Gully Pay services operational') },
    chain: { state: stateOf(hub, KEYS.chain), value: fmtInt(hub?.chain?.head ?? live?.head?.block), unit: 'latest block', graph: bars(chainHours.map((h) => h.txs), 'Gully Chain transactions per hour, last 24 hours') },
    rpc: { state: stateOf(hub, KEYS.rpc), value: gw ? `${gw.ok}/${gw.total}` : '–', unit: 'networks answering', graph: dots((gw?.networks ?? []).map((n) => ({ k: n.alias, ok: n.state === 'OK' })), 'Gully RPC gateway networks') },
    holdermaps: { state: stateOf(hub, KEYS.holdermaps), value: fmtInt(sum((products?.holders?.daily ?? []).map((d) => d.maps))), unit: 'maps opened', graph: bars((products?.holders?.daily ?? []).map((d) => d.maps), 'Holder maps opened per day') },
    // No scans in the window: the site's response time, a real line, rather than an empty frame.
    security: sum((products?.security?.daily ?? []).map((d) => d.scans)) ? { state: stateOf(hub, KEYS.security), value: fmtInt(products?.security?.total), unit: 'scans run', graph: bars(products.security.daily.map((d) => d.scans), 'Security scans per day, last 14 days') } : { state: stateOf(hub, KEYS.security), value: service(hub, 'security')?.ms != null ? `${service(hub, 'security').ms} ms` : '–', unit: 'site response', graph: line(history(hub, 'security'), 'Gully Security response time, last hour') },
    studio: { state: stateOf(hub, KEYS.studio), value: service(hub, 'studio')?.ms != null ? `${service(hub, 'studio').ms} ms` : '–', unit: 'site response', graph: line(history(hub, 'studio'), 'Gully Studio response time, last hour') },
    ai: { state: stateOf(hub, ['ai-api']) === 'live' ? 'live' : 'coming', value: stateOf(hub, ['gullyai']) === 'live' ? 'Site up' : '–', unit: 'API coming online', graph: diagrams.ai(), how: 'How it works' },
    multisig: { state: stateOf(hub, KEYS.multisig), value: service(hub, 'safe')?.ms != null ? `${service(hub, 'safe').ms} ms` : '–', unit: 'app response', graph: diagrams.multisig(), how: 'How it works' },
    core: { state: stateOf(hub, ['street', 'indexer']), value: fmtInt(sum(act.map((x) => x.launches))), unit: 'launches, 24 h', graph: bars(act.map((x) => (x.launches ?? 0) + (x.trades ?? 0) + (x.swaps ?? 0)), 'Gully Core launches and trades per hour') },
    peddleswap: peddle('peddleswap'),
    peddles: peddle('peddles'),
    peddlequest: peddle('peddlequest'),
  }
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
    cells: svcs.map((s) => `<i class="c ${s.state === 'up' ? 'up' : s.state === 'coming' ? 'soon' : 'off'}" title="${s.name}: ${s.state}"></i>`).join(''),
    pulse: line(series, 'Mean response time across every surface, last hour'),
  }
}
