// Gully shared downloads kit: framework-agnostic. Renders platform cards from a downloads.json manifest.
// No network, no tracking. Pure functions + one DOM mount. Rules are enforced here, not left to callers:
//   live  = real link (required, https). Official store badge only when the badge file is on record.
//   soon  = Coming soon. NO href, NO email capture. Neutral tile, never the official badge.
//   beta  = real link, labelled Beta.
import { qrSvg } from './qr.mjs'

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

// kind: store | direct | package | web. badge = official artwork file under badges/ (byte-identical), only where on record.
// Sizes are the badge's natural width/height in CSS px (Apple SVG 119.66x40; Google PNG 646x250 shown at 135x52).
export const PLATFORMS = {
  ios: { name: 'iPhone and iPad', store: 'App Store', kind: 'store', glyph: 'phone', badge: { file: 'badges/app-store-black-en.svg', alt: 'Download on the App Store', w: 120, h: 40 } },
  android: { name: 'Android', store: 'Google Play', kind: 'store', glyph: 'phone', badge: { file: 'badges/google-play-en.png', alt: 'Get it on Google Play', w: 135, h: 52 } },
  chrome: { name: 'Chrome', store: 'Chrome Web Store', kind: 'store', glyph: 'puzzle', badge: null },
  edge: { name: 'Edge', store: 'Microsoft Edge Add-ons', kind: 'store', glyph: 'puzzle', badge: null },
  firefox: { name: 'Firefox', store: 'Firefox Add-ons', kind: 'store', glyph: 'puzzle', badge: null },
  safari: { name: 'Safari', store: 'App Store', kind: 'store', glyph: 'puzzle', badge: null },
  opera: { name: 'Opera', store: 'Opera add-ons', kind: 'store', glyph: 'puzzle', badge: null },
  macos: { name: 'macOS', store: null, kind: 'direct', glyph: 'monitor', badge: null },
  windows: { name: 'Windows', store: null, kind: 'direct', glyph: 'monitor', badge: null },
  linux: { name: 'Linux', store: null, kind: 'direct', glyph: 'monitor', badge: null },
  vscode: { name: 'VS Code', store: 'VS Code Marketplace', kind: 'store', glyph: 'puzzle', badge: null },
  npm: { name: 'npm package', store: 'npm', kind: 'package', glyph: 'box', badge: null },
  pypi: { name: 'Python package', store: 'PyPI', kind: 'package', glyph: 'box', badge: null },
  packagist: { name: 'PHP package', store: 'Packagist', kind: 'package', glyph: 'box', badge: null },
  github: { name: 'GitHub release', store: 'GitHub', kind: 'direct', glyph: 'box', badge: null },
  telegram: { name: 'Telegram Mini App', store: 'Telegram', kind: 'web', glyph: 'globe', badge: null },
  pwa: { name: 'Install from the web', store: null, kind: 'web', glyph: 'globe', badge: null },
  wordpress: { name: 'WordPress plugin', store: null, kind: 'direct', glyph: 'box', badge: null },
  shopify: { name: 'Shopify app', store: null, kind: 'direct', glyph: 'box', badge: null },
  gtm: { name: 'Tag Manager template', store: null, kind: 'direct', glyph: 'box', badge: null },
}
export const STATES = ['live', 'soon', 'beta']

// Simple neutral glyphs drawn for this kit (not any brand's mark).
const GLYPH = {
  phone: '<rect x="7" y="2" width="10" height="20" rx="2.5"/><path d="M11 18.5h2"/>',
  puzzle: '<path d="M9 3h3v3a2 2 0 1 0 4 0V3h3v6h-3a2 2 0 1 0 0 4h3v8H9v-3a2 2 0 1 0-4 0v3H3V3z"/>',
  monitor: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>',
  box: '<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3z"/><path d="M12 12l8-4.5M12 12L4 7.5M12 12v9"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18"/>',
}
const glyph = (k) => `<svg class="gdl-glyph" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${GLYPH[k] || GLYPH.box}</svg>`

export const fmtSize = (b) => (b == null ? '' : b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`)

// ---- validation (used by the gate and by render) ----
export function validate(manifest) {
  const errs = []
  if (!manifest || typeof manifest !== 'object') return ['manifest must be an object']
  if (!manifest.product) errs.push('product missing')
  const seen = new Set()
  for (const it of manifest.items || []) {
    const w = `item ${it.id || '?'}`
    if (!it.id) errs.push('item without id')
    if (seen.has(it.id)) errs.push(`${w}: duplicate id`)
    seen.add(it.id)
    if (!PLATFORMS[it.platform]) errs.push(`${w}: unknown platform ${it.platform}`)
    if (!STATES.includes(it.state)) errs.push(`${w}: bad state ${it.state}`)
    if (it.state === 'soon') {
      if (it.url) errs.push(`${w}: a soon card must have no url`)
      if (it.email || it.waitlist) errs.push(`${w}: no email capture or waitlist (owner rule)`)
      if (!it.willDo) errs.push(`${w}: soon card needs willDo`)
      if (!it.today) errs.push(`${w}: soon card needs what works today (today)`)
    } else if (STATES.includes(it.state)) {
      if (!/^https:\/\//.test(it.url || '')) errs.push(`${w}: live/beta needs an https url`)
      if (it.file && !/^[0-9a-f]{64}$/.test(it.sha256 || '')) errs.push(`${w}: a downloadable file needs sha256`)
    }
    if (it.sha256 && !/^[0-9a-f]{64}$/.test(it.sha256)) errs.push(`${w}: sha256 must be 64 hex`)
    for (const p of it.permissions || []) if (!p.name || !p.why) errs.push(`${w}: permission needs name and why`)
  }
  return errs
}

// ---- platform detection: UA hints only, nothing stored or sent ----
export function detectPlatform(nav = {}) {
  const ua = String(nav.userAgent || '')
  const plat = String(nav.userAgentData?.platform || nav.platform || '')
  const hay = plat + ' ' + ua
  const os = /iPhone|iPad|iPod/.test(ua) ? 'ios' : /Android/i.test(ua) ? 'android' : /Mac/i.test(hay) ? (nav.maxTouchPoints > 1 ? 'ios' : 'macos') : /Win/i.test(hay) ? 'windows' : /Linux|X11/i.test(hay) ? 'linux' : null
  const browser = /Edg\//.test(ua) ? 'edge' : /OPR\//.test(ua) ? 'opera' : /Firefox\//.test(ua) ? 'firefox' : /Chrome\//.test(ua) ? 'chrome' : /Safari\//.test(ua) ? 'safari' : null
  return { os, browser }
}
export function order(items, det) {
  const rank = (it) => {
    let r = it.state === 'live' ? 0 : it.state === 'beta' ? 1 : 2
    if (det && (it.platform === det.os || it.platform === det.browser)) r -= 10
    return r
  }
  return items.map((it, i) => [it, i]).sort((a, b) => rank(a[0]) - rank(b[0]) || a[1] - b[1]).map((x) => x[0])
}

// ---- JSON-LD: only live/beta items are advertised as installable ----
export function jsonLd(manifest) {
  const apps = (manifest.items || []).filter((i) => i.state !== 'soon').map((i) => ({
    '@type': 'SoftwareApplication',
    name: i.name || `${manifest.title || manifest.product} for ${PLATFORMS[i.platform].name}`,
    applicationCategory: i.category || 'UtilitiesApplication',
    operatingSystem: i.minOS ? `${PLATFORMS[i.platform].name} ${i.minOS}+` : PLATFORMS[i.platform].name,
    ...(i.version ? { softwareVersion: i.version } : {}),
    ...(i.releasedAt ? { datePublished: i.releasedAt } : {}),
    downloadUrl: i.url,
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
  }))
  return { '@context': 'https://schema.org', '@graph': apps }
}

// ---- rendering ----
function badgeFor(it, base) {
  const p = PLATFORMS[it.platform]
  if (it.state !== 'live' || !p.badge) return null // a store badge only when the app is live in that store
  return `<a class="gdl-badge" href="${esc(it.url)}" rel="noopener" target="_blank"><img src="${esc(base + p.badge.file)}" alt="${esc(p.badge.alt)}" width="${p.badge.w}" height="${p.badge.h}"></a>`
}
export function cardHtml(it, opts = {}) {
  const base = opts.badgeBase || ''
  const p = PLATFORMS[it.platform]
  const title = it.name || p.name
  const chip = it.state === 'live' ? '<span class="gdl-chip gdl-live">Available</span>' : it.state === 'beta' ? '<span class="gdl-chip gdl-beta">Beta</span>' : '<span class="gdl-chip gdl-soon">Coming soon</span>'
  const meta = [it.version && `Version ${esc(it.version)}`, it.size != null && fmtSize(it.size), it.minOS && `Needs ${esc(p.name)} ${esc(it.minOS)} or newer`, it.releasedAt && `Released ${esc(it.releasedAt)}`].filter(Boolean)
  let action
  if (it.state === 'soon') {
    action = `<div class="gdl-tile" role="note"><span class="gdl-tile-g">${glyph(p.glyph)}</span><span>${esc(p.store || p.name)}<br><small>Not available yet</small></span></div>`
  } else {
    const verb = p.kind === 'store' ? `Open ${esc(p.store)}` : p.kind === 'package' ? `View on ${esc(p.store)}` : p.kind === 'web' ? 'Open' : 'Download'
    action = badgeFor(it, base) || `<a class="gdl-btn" href="${esc(it.url)}" rel="noopener" target="_blank">${glyph(p.glyph)}<span>${verb}</span></a>`
  }
  const detail = []
  if (it.state === 'soon') {
    detail.push(`<p><strong>What it will do.</strong> ${esc(it.willDo)}</p>`, `<p><strong>What works today.</strong> ${esc(it.today)}${it.docs ? ` <a href="${esc(it.docs)}">Read the docs</a>` : ''}</p>`)
  } else {
    if (it.summary) detail.push(`<p>${esc(it.summary)}</p>`)
    if (it.install) detail.push(`<p class="gdl-code"><code>${esc(it.install)}</code></p>`)
    if (it.sha256) detail.push(`<p class="gdl-sha"><span>SHA-256</span> <code>${esc(it.sha256)}</code></p>`)
    const links = [it.notes && `<a href="${esc(it.notes)}">Release notes</a>`, it.docs && `<a href="${esc(it.docs)}">Docs</a>`].filter(Boolean)
    if (links.length) detail.push(`<p>${links.join(' &middot; ')}</p>`)
  }
  if (it.permissions?.length) detail.push(`<details class="gdl-perm"><summary>What it asks for, and why</summary><ul>${it.permissions.map((x) => `<li><strong>${esc(x.name)}.</strong> ${esc(x.why)}</li>`).join('')}</ul></details>`)
  const wantsQr = it.state !== 'soon' && (it.platform === 'ios' || it.platform === 'android' || p.kind === 'web') && it.url.length <= 200
  const qr = wantsQr ? `<details class="gdl-qr"><summary>Open on your phone</summary>${qrSvg(it.url, { label: esc(`QR code to open ${title}`) })}</details>` : ''
  return `<article class="gdl-card gdl-${it.state}" data-platform="${esc(it.platform)}" data-state="${esc(it.state)}" aria-labelledby="gdl-${esc(it.id)}">
<header><span class="gdl-ico">${glyph(p.glyph)}</span><h3 id="gdl-${esc(it.id)}">${esc(title)}</h3>${chip}</header>
${meta.length ? `<p class="gdl-meta">${meta.join(' &middot; ')}</p>` : ''}
<div class="gdl-action">${action}</div>${detail.join('')}${qr}</article>`
}
export function render(manifest, opts = {}) {
  const errs = validate(manifest)
  if (errs.length) throw new Error('downloads manifest invalid: ' + errs.join('; '))
  const items = order(manifest.items || [], opts.detect)
  const req = manifest.requirements ? `<p class="gdl-req"><strong>System requirements.</strong> ${esc(manifest.requirements)}</p>` : ''
  const priv = `<p class="gdl-priv">${esc(manifest.privacy || 'No account, no tracking and no cookies are needed to download. Checksums let you verify files.')}</p>`
  return `<section class="gdl" aria-label="${esc(manifest.title || manifest.product)} downloads"><div class="gdl-grid">${items.map((i) => cardHtml(i, opts)).join('')}</div>${req}${priv}</section>`
}
export function mount(el, manifest, opts = {}) {
  const det = opts.detect ?? (typeof navigator !== 'undefined' ? detectPlatform(navigator) : null)
  el.innerHTML = render(manifest, { ...opts, detect: det })
  if (opts.jsonLd !== false && typeof document !== 'undefined') {
    const s = document.createElement('script')
    s.type = 'application/ld+json'
    s.textContent = JSON.stringify(jsonLd(manifest))
    el.appendChild(s)
  }
}
