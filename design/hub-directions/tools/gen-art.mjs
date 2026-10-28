// Generates every original illustration for both hub directions (deterministic: same seed, same art).
// node tools/gen-art.mjs  -> a/img/*.svg, b/img/*.svg, a/og.svg, b/og.svg
// Colours: the Gully Labs kit (#06050D ground, #00D2FF cyan, #7B3BFF violet) and each product kit's accent.
// No stock, no reused Gully artwork; official logos are referenced (<image>) in the OG cards, never redrawn.
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const C = { bg: '#06050D', night: '#0C0B16', line: '#1B1F33', cyan: '#00D2FF', violet: '#7B3BFF', text: '#EEF1F4', muted: '#8D96A3', faint: '#5D6672', paper: '#F5F4EF', ink: '#121222', inkSoft: '#4A4D5E' }
const P = { id: '#00D2FF', pay: '#3479FD', chain: '#00B2FA', chain2: '#46FB04', rpc: '#FF7300', hm: '#FFD52E', sec: '#F2B232', studio: '#1E8BFF', ai: '#00F0F2' }
const uri = (rel, type = 'image/svg+xml') => `data:${type};base64,${readFileSync(join(ROOT, rel)).toString('base64')}`
const f = (n) => +n.toFixed(2)
function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32) }
const svg = (w, h, body, title, extra = '') => `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-labelledby="t"${extra}><title id="t">${title}</title>${body}</svg>\n`
function out(rel, s) { const p = join(ROOT, rel); mkdirSync(join(p, '..'), { recursive: true }); writeFileSync(p, s); console.log('wrote', rel, s.length, 'bytes') }

// ================================================================ A: Constellation (dark Terminal)
// A1 hero field: concentric orbit ellipses, a faint star dust and three comet arcs, behind the live constellation.
function aHeroField() {
  const W = 1200, H = 760, cx = 600, cy = 380, r = rng(7)
  let b = `<defs><radialGradient id="core" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="${C.cyan}" stop-opacity=".16"/><stop offset=".55" stop-color="${C.violet}" stop-opacity=".05"/><stop offset="1" stop-color="${C.bg}" stop-opacity="0"/></radialGradient></defs>`
  b += `<ellipse cx="${cx}" cy="${cy}" rx="520" ry="330" fill="url(#core)"/>`
  for (let i = 1; i <= 7; i++) {
    const rx = 70 * i + 20, ry = rx * 0.62, op = f(0.22 - i * 0.022)
    b += `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${f(ry)}" fill="none" stroke="${i % 3 === 0 ? C.violet : C.cyan}" stroke-opacity="${op}" stroke-width="1" ${i % 2 ? 'stroke-dasharray="2 6"' : ''}/>`
  }
  for (let i = 0; i < 220; i++) {
    const x = r() * W, y = r() * H, s = r() < 0.08 ? 1.4 : 0.7
    b += `<circle cx="${f(x)}" cy="${f(y)}" r="${s}" fill="${r() < 0.2 ? C.violet : C.text}" fill-opacity="${f(0.08 + r() * 0.3)}"/>`
  }
  for (const [a0, a1, R, col] of [[200, 250, 420, C.cyan], [20, 60, 330, C.violet], [110, 140, 480, C.cyan]]) {
    const p = (a) => [cx + Math.cos(a * Math.PI / 180) * R, cy + Math.sin(a * Math.PI / 180) * R * 0.62]
    const [x0, y0] = p(a0), [x1, y1] = p(a1)
    b += `<path d="M${f(x0)} ${f(y0)} A${R} ${f(R * 0.62)} 0 0 1 ${f(x1)} ${f(y1)}" fill="none" stroke="${col}" stroke-width="1.5" stroke-linecap="round" stroke-opacity=".55"/><circle cx="${f(x1)}" cy="${f(y1)}" r="2.6" fill="${col}"/>`
  }
  return svg(W, H, b, 'Orbit field behind the product constellation', ' preserveAspectRatio="xMidYMid slice"')
}

// A2 services: an engineering schematic, a contract block wired to app, chain and shield modules.
function aServices() {
  const W = 560, H = 300
  let b = `<rect width="${W}" height="${H}" fill="${C.night}"/>`
  for (let x = 0; x <= W; x += 20) b += `<line x1="${x}" y1="0" x2="${x}" y2="${H}" stroke="#fff" stroke-opacity="${x % 100 ? .025 : .06}"/>`
  for (let y = 0; y <= H; y += 20) b += `<line x1="0" y1="${y}" x2="${W}" y2="${y}" stroke="#fff" stroke-opacity="${y % 100 ? .025 : .06}"/>`
  const box = (x, y, w, h, col, label) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="4" fill="${C.bg}" stroke="${col}" stroke-width="1.5"/><rect x="${x}" y="${y}" width="${w}" height="16" rx="4" fill="${col}" fill-opacity=".14"/><text x="${x + 8}" y="${y + 11.5}" font-family="JetBrains Mono,monospace" font-size="9" fill="${col}" letter-spacing="1">${label}</text>`
  const wire = (d, col) => `<path d="${d}" fill="none" stroke="${col}" stroke-width="1.5" stroke-dasharray="4 4"/>`
  b += wire('M160 150 H230', C.cyan) + wire('M330 110 H380 V70 H420', C.violet) + wire('M330 150 H420', C.cyan) + wire('M330 190 H380 V230 H420', P.sec)
  b += box(40, 110, 120, 80, C.cyan, 'CONTRACT.SOL')
  for (let i = 0; i < 4; i++) b += `<rect x="52" y="${136 + i * 12}" width="${[80, 58, 92, 44][i]}" height="4" rx="2" fill="${C.text}" fill-opacity="${.18 + i * .05}"/>`
  b += `<rect x="230" y="100" width="100" height="100" rx="4" fill="${C.bg}" stroke="${C.text}" stroke-opacity=".3"/><circle cx="280" cy="150" r="30" fill="none" stroke="${C.cyan}" stroke-width="1.5"/><circle cx="280" cy="150" r="12" fill="${C.violet}" fill-opacity=".8"/><text x="280" y="214" text-anchor="middle" font-family="JetBrains Mono,monospace" font-size="9" fill="${C.muted}" letter-spacing="1">BUILD</text>`
  b += box(420, 46, 110, 48, C.violet, 'APP')
  b += box(420, 126, 110, 48, C.cyan, 'CHAIN')
  b += box(420, 206, 110, 48, P.sec, 'SECURITY')
  b += `<rect x="432" y="70" width="40" height="14" rx="2" fill="${C.violet}" fill-opacity=".5"/><rect x="476" y="70" width="40" height="14" rx="2" fill="none" stroke="${C.violet}"/>`
  for (let i = 0; i < 5; i++) b += `<rect x="${432 + i * 18}" y="148" width="14" height="14" rx="2" fill="${C.cyan}" fill-opacity="${.25 + i * .14}"/>`
  b += `<path d="M475 226 l12 5 v9 c0 6 -5 9 -12 11 c-7 -2 -12 -5 -12 -11 v-9 z" fill="none" stroke="${P.sec}" stroke-width="1.5"/>`
  return svg(W, H, b, 'Schematic: a contract built into an app, a chain and a security monitor')
}

// A3 What's new: a signal trace with dated ticks.
function aNews() {
  const W = 560, H = 120, r = rng(31)
  let b = `<rect width="${W}" height="${H}" fill="${C.night}"/>`, d = 'M0 70'
  for (let x = 0; x <= W; x += 8) { const spike = r() < 0.12 ? -30 - r() * 20 : 0; d += ` L${x} ${f(70 + Math.sin(x / 23) * 6 + spike)}` }
  b += `<path d="${d}" fill="none" stroke="${C.cyan}" stroke-width="1.5" stroke-opacity=".8"/>`
  for (let i = 0; i < 7; i++) { const x = 40 + i * 80; b += `<line x1="${x}" y1="96" x2="${x}" y2="104" stroke="${C.muted}"/><circle cx="${x}" cy="70" r="3" fill="${i === 6 ? C.violet : C.cyan}"/>` }
  return svg(W, H, b, 'A signal trace with one tick per day of releases')
}

// ================================================================ B: The Gully stack (editorial, light)
// B1 hero: an isometric stack of five slabs (identity, payments, chain, data & security, games & AI) threaded by
// one dashed journey line, each slab carrying its own small motif.
function bStack() {
  const W = 620, H = 600, cx = 310
  const layers = [
    { y: 470, col: P.studio, col2: P.ai, label: '05 GAMES &amp; AI', motif: 'play' },
    { y: 375, col: P.sec, col2: P.hm, label: '04 DATA &amp; SECURITY', motif: 'bubbles' },
    { y: 280, col: P.chain, col2: P.chain2, label: '03 CHAIN', motif: 'blocks' },
    { y: 185, col: P.pay, col2: '#16B2FE', label: '02 PAYMENTS', motif: 'coins' },
    { y: 90, col: C.cyan, col2: C.violet, label: '01 IDENTITY', motif: 'key' },
  ]
  const w = 210, h = 105, t = 26
  const top = (y) => `M${cx} ${y - h / 2} L${cx + w} ${y} L${cx} ${y + h / 2} L${cx - w} ${y} Z`
  let b = '<defs>'
  layers.forEach((L, i) => { b += `<linearGradient id="g${i}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${L.col}"/><stop offset="1" stop-color="${L.col2}"/></linearGradient>` })
  b += '</defs>'
  b += `<ellipse cx="${cx}" cy="${560}" rx="250" ry="34" fill="${C.ink}" fill-opacity=".07"/>`
  layers.forEach((L, i) => {
    const y = L.y
    b += `<path d="M${cx - w} ${y} L${cx} ${y + h / 2} L${cx} ${y + h / 2 + t} L${cx - w} ${y + t} Z" fill="${L.col}" fill-opacity=".55"/>`
    b += `<path d="M${cx + w} ${y} L${cx} ${y + h / 2} L${cx} ${y + h / 2 + t} L${cx + w} ${y + t} Z" fill="${L.col}" fill-opacity=".8"/>`
    b += `<path d="${top(y)}" fill="url(#g${i})"/><path d="${top(y)}" fill="#fff" fill-opacity=".72"/>`
    b += `<path d="${top(y)}" fill="none" stroke="${C.ink}" stroke-opacity=".18"/>`
    // motif on the slab top (isometric: x' = cx + (u - v), y' = y + (u + v) / 2)
    const iso = (u, v) => [cx + (u - v), y + (u + v) / 2 - h / 2 + h / 2 - 0]
    if (L.motif === 'key') { for (let k = 0; k < 3; k++) b += `<ellipse cx="${cx - 60 + k * 60}" cy="${y}" rx="${22}" ry="11" fill="none" stroke="${C.violet}" stroke-width="2" stroke-opacity="${.5 + k * .2}"/>` ; b += `<circle cx="${cx + 60}" cy="${y}" r="5" fill="${C.violet}"/>` }
    if (L.motif === 'coins') for (let k = 0; k < 4; k++) { const x = cx - 90 + k * 60; b += `<ellipse cx="${x}" cy="${y + 4}" rx="20" ry="10" fill="${L.col}"/><ellipse cx="${x}" cy="${y}" rx="20" ry="10" fill="#fff" stroke="${L.col}" stroke-width="2"/>` }
    if (L.motif === 'blocks') for (let k = 0; k < 5; k++) { const x = cx - 120 + k * 60, yy = y + (k % 2 ? 6 : -6); b += `<path d="M${x} ${yy - 12} l18 9 l-18 9 l-18 -9 z" fill="${k === 4 ? P.chain2 : L.col}" stroke="${C.ink}" stroke-opacity=".2"/>${k ? `<line x1="${x - 42}" y1="${y + (k % 2 ? -6 : 6)}" x2="${x - 18}" y2="${yy}" stroke="${C.ink}" stroke-opacity=".35" stroke-width="1.5"/>` : ''}` }
    if (L.motif === 'bubbles') { const r = rng(5); for (let k = 0; k < 9; k++) { const x = cx - 120 + r() * 240, yy = y - 18 + r() * 36, rr = 4 + r() * 11; b += `<ellipse cx="${f(x)}" cy="${f(yy)}" rx="${f(rr)}" ry="${f(rr / 2)}" fill="${k % 3 ? P.hm : P.sec}" fill-opacity=".9" stroke="${C.ink}" stroke-opacity=".2"/>` } }
    if (L.motif === 'play') { b += `<path d="M${cx - 80} ${y - 10} l20 10 l-20 10 z" fill="${P.studio}"/><rect x="${cx - 20}" y="${y - 9}" width="40" height="18" rx="9" fill="none" stroke="${P.studio}" stroke-width="2"/><circle cx="${cx + 80}" cy="${y}" r="10" fill="none" stroke="${P.ai}" stroke-width="2"/><circle cx="${cx + 80}" cy="${y}" r="3" fill="${P.ai}"/>` }
    // label tab on the right face
    b += `<text x="${cx + w + 14}" y="${y + 6}" font-family="JetBrains Mono,monospace" font-size="12" font-weight="500" fill="${C.ink}" letter-spacing="1.2">${L.label}</text><line x1="${cx + w + 2}" y1="${y + 2}" x2="${cx + w + 10}" y2="${y + 2}" stroke="${C.ink}"/>`
  })
  // the journey thread through every layer
  b += `<path d="M${cx} 40 V545" stroke="${C.ink}" stroke-width="2" stroke-dasharray="3 6" stroke-linecap="round"/>`
  layers.forEach((L) => { b += `<circle cx="${cx}" cy="${L.y}" r="7" fill="${C.paper}" stroke="${C.ink}" stroke-width="2"/><circle cx="${cx}" cy="${L.y}" r="3" fill="${C.ink}"/>` })
  b += `<circle cx="${cx}" cy="34" r="10" fill="${C.ink}"/><path d="M${cx - 4} 30 l8 4 l-8 4 z" fill="${C.paper}"/>`
  return svg(W + 150, H, b, 'The Gully stack: identity, payments, chain, data and security, games and AI, threaded by one user journey')
}

// B2 work with us: a workbench of building blocks being assembled (isometric, paper).
function bStudio() {
  const W = 520, H = 300, r = rng(19)
  let b = `<rect width="${W}" height="${H}" rx="16" fill="#ECEAF6"/>`
  for (let i = 0; i < 26; i++) b += `<line x1="${i * 24 - 120}" y1="300" x2="${i * 24 + 60}" y2="0" stroke="${C.ink}" stroke-opacity=".04"/>`
  const cube = (x, y, s, col) => `<path d="M${x} ${y} l${s} ${s / 2} l${-s} ${s / 2} l${-s} ${-s / 2} z" fill="${col}"/><path d="M${x - s} ${y + s / 2} l${s} ${s / 2} v${s} l${-s} ${-s / 2} z" fill="${col}" fill-opacity=".7"/><path d="M${x + s} ${y + s / 2} l${-s} ${s / 2} v${s} l${s} ${-s / 2} z" fill="${col}" fill-opacity=".5"/><path d="M${x} ${y} l${s} ${s / 2} l${-s} ${s / 2} l${-s} ${-s / 2} z" fill="none" stroke="${C.ink}" stroke-opacity=".25"/>`
  const cols = [C.violet, P.pay, C.cyan, P.sec, P.studio]
  // a finished tower on the left, loose blocks on the right
  for (let k = 0; k < 4; k++) b += cube(150, 190 - k * 34, 34, cols[k])
  for (let k = 0; k < 5; k++) b += cube(290 + (k % 3) * 70, 210 - Math.floor(k / 3) * 60 + (r() * 10 | 0), 26, cols[(k + 2) % 5])
  b += `<path d="M330 120 C 300 80, 220 70, 190 90" fill="none" stroke="${C.ink}" stroke-width="1.5" stroke-dasharray="4 5"/><path d="M196 82 l-8 8 l11 3" fill="none" stroke="${C.ink}" stroke-width="1.5"/>`
  b += `<text x="24" y="40" font-family="JetBrains Mono,monospace" font-size="11" fill="${C.inkSoft}" letter-spacing="1.2">DISCOVER → PROTOTYPE → BUILD → LAUNCH</text>`
  return svg(W, H, b, 'Blocks assembled into a tower: the studio builds products with you')
}

// B3 What's new: a stack of dated cards fanned out.
function bNews() {
  const W = 520, H = 160
  let b = `<rect width="${W}" height="${H}" rx="16" fill="#E8F7FC"/>`
  const cols = [C.cyan, P.pay, P.chain2, P.sec, C.violet]
  cols.forEach((c, i) => { const x = 40 + i * 86, y = 34 + (i % 2) * 14; b += `<g transform="rotate(${-6 + i * 3} ${x + 40} ${y + 50})"><rect x="${x}" y="${y}" width="96" height="92" rx="10" fill="#fff" stroke="${C.ink}" stroke-opacity=".12"/><rect x="${x + 10}" y="${y + 12}" width="30" height="8" rx="4" fill="${c}"/><rect x="${x + 10}" y="${y + 30}" width="70" height="5" rx="2.5" fill="${C.ink}" fill-opacity=".2"/><rect x="${x + 10}" y="${y + 42}" width="54" height="5" rx="2.5" fill="${C.ink}" fill-opacity=".14"/><text x="${x + 10}" y="${y + 78}" font-family="JetBrains Mono,monospace" font-size="10" fill="${C.inkSoft}">OCT ${21 + i + (i > 2 ? 1 : 0)}</text></g>` })
  return svg(W, H, b, 'Release notes fanned out, one card per product update')
}

// ================================================================ OG cards (1200 x 630)
function nodeRing(cx, cy, R, ry, cols) {
  let b = ''
  const pts = cols.map((c, i) => { const a = -Math.PI / 2 + i * Math.PI * 2 / cols.length; return [cx + Math.cos(a) * R, cy + Math.sin(a) * ry, c] })
  pts.forEach((p, i) => pts.forEach((q, j) => { if (j > i && (j - i === 1 || j - i === 4 || (i === 0 && j === cols.length - 1))) b += `<line x1="${f(p[0])}" y1="${f(p[1])}" x2="${f(q[0])}" y2="${f(q[1])}" stroke="${C.cyan}" stroke-opacity=".28" stroke-width="1.5"/>` }))
  pts.forEach((p) => { b += `<circle cx="${f(p[0])}" cy="${f(p[1])}" r="20" fill="${C.bg}" stroke="${p[2]}" stroke-width="2.5"/><circle cx="${f(p[0])}" cy="${f(p[1])}" r="6" fill="${p[2]}"/>` })
  b += `<circle cx="${cx}" cy="${cy}" r="46" fill="${C.bg}" stroke="${C.cyan}" stroke-width="2"/><image href="${uri('shared/logos/labs.png', 'image/png')}" x="${cx - 30}" y="${cy - 30}" width="60" height="60"/>`
  pts.forEach((p) => { b += `<line x1="${cx}" y1="${cy}" x2="${f(p[0])}" y2="${f(p[1])}" stroke="${p[2]}" stroke-opacity=".35" stroke-dasharray="3 5"/>` })
  return b
}
function aOg() {
  let b = `<rect width="1200" height="630" fill="${C.bg}"/>`
  for (let x = 0; x <= 1200; x += 40) b += `<line x1="${x}" y1="0" x2="${x}" y2="630" stroke="#fff" stroke-opacity=".035"/>`
  for (let y = 0; y <= 630; y += 40) b += `<line x1="0" y1="${y}" x2="1200" y2="${y}" stroke="#fff" stroke-opacity=".035"/>`
  for (let i = 1; i <= 4; i++) b += `<ellipse cx="930" cy="315" rx="${80 * i + 60}" ry="${(80 * i + 60) * .62}" fill="none" stroke="${i % 2 ? C.cyan : C.violet}" stroke-opacity=".14" stroke-dasharray="2 6"/>`
  b += nodeRing(940, 315, 200, 190, [P.id, P.pay, P.chain, P.rpc, P.hm, P.sec, P.studio, P.ai])
  b += `<image href="${uri('shared/logos/labs-wordmark.png', 'image/png')}" x="72" y="70" height="44" width="260"/>`
  b += `<text x="72" y="250" font-family="Poppins,sans-serif" font-weight="700" font-size="54" fill="${C.text}">Eight products.</text><text x="72" y="320" font-family="Poppins,sans-serif" font-weight="700" font-size="54" fill="${C.cyan}">One connected suite.</text>`
  b += `<text x="72" y="392" font-family="Poppins,sans-serif" font-size="24" fill="${C.muted}">Sign in with Gully ID, pay with Gully Pay,</text><text x="72" y="426" font-family="Poppins,sans-serif" font-size="24" fill="${C.muted}">built on Gully Chain.</text>`
  b += `<rect x="72" y="500" width="240" height="44" rx="4" fill="none" stroke="${C.cyan}"/><text x="92" y="528" font-family="JetBrains Mono,monospace" font-size="18" fill="${C.cyan}" letter-spacing="1">gullylabs.xyz</text>`
  return svg(1200, 630, b, 'Gully Labs: eight products, one connected suite')
}
function bOg() {
  let b = `<rect width="1200" height="630" fill="${C.paper}"/>`
  b += `<image href="${uri('b/img/stack.svg')}" x="640" y="40" width="560" height="${f(560 * 600 / 770)}"/>`
  b += `<image href="${uri('shared/logos/labs-wordmark-light.png', 'image/png')}" x="72" y="72" height="40" width="240"/>`
  b += `<text x="68" y="270" font-family="Poppins,sans-serif" font-weight="800" font-size="104" fill="${C.ink}" letter-spacing="-3">The Gully</text><text x="68" y="380" font-family="Poppins,sans-serif" font-weight="800" font-size="104" fill="${C.violet}" letter-spacing="-3">stack.</text>`
  b += `<text x="72" y="448" font-family="Poppins,sans-serif" font-size="24" fill="${C.inkSoft}">Identity, payments, chain, data and games:</text><text x="72" y="482" font-family="Poppins,sans-serif" font-size="24" fill="${C.inkSoft}">eight products that work as one.</text>`
  b += `<rect x="72" y="526" width="236" height="48" rx="24" fill="${C.ink}"/><text x="98" y="557" font-family="JetBrains Mono,monospace" font-size="18" fill="${C.paper}" letter-spacing="1">gullylabs.xyz</text>`
  return svg(1200, 630, b, 'Gully Labs: the Gully stack')
}

out('a/img/hero-field.svg', aHeroField())
out('a/img/services.svg', aServices())
out('a/img/news.svg', aNews())
out('a/og.svg', aOg())
out('b/img/stack.svg', bStack())
out('b/img/studio.svg', bStudio())
out('b/img/news.svg', bNews())
out('b/og.svg', bOg())
