// Badge routes that are not a product's own (server/badges.mjs renders them all):
//   GET /badges/built-by-gully-labs.svg        "Built by Gully Labs", for our own projects' sites
//   GET /badges/example/:kind.svg              the docs gallery's examples (fixed example values, never real data)
//                                              kind: score | holders | security | project; ?tone= picks the tone
// both take ?size=S|M|L and ?theme=dark|light. The Gully Score badge is in gully-score.mjs and the Gully Security
// badge in security-routes.mjs; they use the same renderer.
//
// GET /api/holders/:chain/:token/badge.svg is owned by the partners branch (holders-partners.mjs); it calls
// renderBadge({ kind: 'holder-map', ...holderBadgeData }) from badges.mjs.

import { badgeHeaders, badgeStyleFrom, renderBadge } from './badges.mjs'

const SITE = 'https://gullylabs.xyz'

/** Example faces for the docs gallery: fixed values, labelled as examples on the page, no link, never a real token. */
const EXAMPLES = {
  score: { label: 'Gully Score', face: { brand: '64 Fair', good: '82 Strong', warn: '31 Poor', neutral: 'N/A' }, def: 'good' },
  holders: { label: 'Holder Map', face: { good: 'Health 82', brand: 'Health 55', warn: '3 bundles', neutral: '' }, def: 'good' },
  security: { label: 'Gully Security', face: { brand: 'Scanned 12 Oct 2026' }, def: 'brand' },
  project: { label: 'Built by', face: { brand: '' }, def: 'brand' },
}

function send(req, res, svg, maxAge) {
  res.writeHead(200, badgeHeaders(maxAge))
  res.end(req.method === 'HEAD' ? undefined : svg)
  return true
}

/** /badges/*. Returns true when answered. */
export async function handleBadgeRoutes(req, res, url) {
  const own = url.pathname === '/badges/built-by-gully-labs.svg'
  const ex = url.pathname.match(/^\/badges\/example\/(score|holders|security|project)\.svg$/)
  if (!own && !ex) return false
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { Allow: 'GET, HEAD', 'Access-Control-Allow-Origin': '*' })
    return res.end(), true
  }
  const style = badgeStyleFrom(url.searchParams)
  if (ex) {
    const e = EXAMPLES[ex[1]]
    const tone = url.searchParams.get('tone') in e.face ? url.searchParams.get('tone') : e.def
    return send(req, res, renderBadge({ kind: ex[1], label: e.label, value: e.face[tone], tone, title: `${e.label}: example`, ...style }), 86_400)
  }
  if (own) return send(req, res, renderBadge({ kind: 'project', label: 'Built by', title: 'Built by Gully Labs', href: SITE, ...style }), 86_400)
}
