// Top movers: how each stock token's gap (and its onchain price) changed over the last hour or day,
// computed from the tracker's own five-minute snapshots. Pure: no I/O, so it is tested on its own
// with synthetic history (scripts/test-movers.mjs).
//
// Honesty rules:
//   - only tokens whose CURRENT status is trusted (premium, discount, drifting, in-line) are ranked;
//     a thin pool or an unreadable price never makes the list;
//   - "now" is the token's latest snapshot, and it must be recent (LATEST_MAX_AGE_S);
//   - "then" is the snapshot closest to now minus the window, and it must lie within the window's
//     tolerance of that time. A token without such a point is left out, never interpolated;
//   - when no token has both points the answer says so ("needs 24h of snapshots"), with how much
//     history there is.

export const MOVER_WINDOWS = { '1h': 3_600, '24h': 86_400 }
/** How far the "then" snapshot may sit from exactly one window ago. */
export const MOVER_TOLERANCE = { '1h': 15 * 60, '24h': 2 * 3_600 }
/** The latest snapshot must be at most this old for a token to count (snapshots are every 5 min). */
export const LATEST_MAX_AGE_S = 30 * 60
const TRUSTED = new Set(['premium', 'discount', 'drifting', 'in-line'])
const SPARK_POINTS = 48

const round = (v, d = 2) => Math.round(v * 10 ** d) / 10 ** d
const iso = (s) => new Date(s * 1000).toISOString()

/** The point whose time is closest to `t` (points oldest first). */
function closest(points, t) {
  let lo = 0
  let hi = points.length - 1
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (points[mid][0] < t) lo = mid + 1
    else hi = mid
  }
  const a = points[lo]
  const b = points[lo - 1]
  return b && Math.abs(b[0] - t) <= Math.abs(a[0] - t) ? b : a
}

/** At most `n` points of [unixSeconds, gapPct], evenly picked, the last one always kept. */
function thin(points, n) {
  if (points.length <= n) return points.map((p) => [p[0], p[1]])
  const out = []
  const step = (points.length - 1) / (n - 1)
  for (let i = 0; i < n; i++) {
    const p = points[Math.round(i * step)]
    out.push([p[0], p[1]])
  }
  return out
}

/**
 * Every trusted token's change over `window`, plus the rankings.
 * @param {object} o
 * @param {object[]} o.rows  current tracker rows (chain, ticker, name, token, status, gapPct, onchain, fair, pool)
 * @param {(chain: string, ticker: string) => [number, number, number, number][]} o.historyOf  [unixSeconds, gapPct, onchain, fair][], oldest first
 * @param {'1h' | '24h'} [o.window]
 * @param {number} [o.now]  ms
 */
export function computeMovers({ rows, historyOf, window = '24h', now = Date.now() }) {
  const span = MOVER_WINDOWS[window]
  if (!span) throw new Error(`unknown window ${window}`)
  const tol = MOVER_TOLERANCE[window]
  const nowS = Math.floor(now / 1000)
  const entries = []
  const left = { untrusted: 0, noHistory: 0, staleHistory: 0, tooShort: 0 }
  let coverage = 0
  let asOf = 0

  for (const r of rows) {
    if (!TRUSTED.has(r.status) || typeof r.gapPct !== 'number') {
      left.untrusted++
      continue
    }
    const pts = historyOf(r.chain, r.ticker) ?? []
    if (!pts.length) {
      left.noHistory++
      continue
    }
    const latest = pts[pts.length - 1]
    if (nowS - latest[0] > LATEST_MAX_AGE_S) {
      left.staleHistory++
      continue
    }
    coverage = Math.max(coverage, latest[0] - pts[0][0])
    const past = closest(pts, latest[0] - span)
    if (past === latest || Math.abs(past[0] - (latest[0] - span)) > tol) {
      left.tooShort++
      continue
    }
    asOf = Math.max(asOf, latest[0])
    const priceChangePct = past[2] > 0 && latest[2] > 0 ? round(((latest[2] - past[2]) / past[2]) * 100) : null
    entries.push({
      chain: r.chain,
      ticker: r.ticker,
      name: r.name,
      token: r.token,
      status: r.status,
      gapPct: round(r.gapPct),
      onchain: r.onchain,
      fair: r.fair,
      liquidityUsd: r.pool?.liquidityUsd ?? null,
      gapThen: past[1],
      gapNow: latest[1],
      gapChangePp: round(latest[1] - past[1]),
      onchainThen: past[2],
      onchainNow: latest[2],
      priceChangePct,
      from: iso(past[0]),
      to: iso(latest[0]),
      spark: thin(
        pts.filter((p) => p[0] >= past[0]),
        SPARK_POINTS,
      ),
    })
  }

  const byGap = [...entries].sort((a, b) => Math.abs(b.gapChangePp) - Math.abs(a.gapChangePp) || a.ticker.localeCompare(b.ticker))
  const byPrice = entries.filter((e) => e.priceChangePct !== null).sort((a, b) => Math.abs(b.priceChangePct) - Math.abs(a.priceChangePct) || a.ticker.localeCompare(b.ticker))
  const hours = Math.floor(coverage / 360) / 10
  return {
    window,
    windowSeconds: span,
    toleranceSeconds: tol,
    asOf: asOf ? iso(asOf) : null,
    from: asOf ? iso(asOf - span) : null,
    to: asOf ? iso(asOf) : null,
    eligible: entries.length,
    left,
    historyHours: hours,
    note: entries.length ? null : `Needs ${window} of snapshots: the longest series so far covers ${hours} h.`,
    byGap,
    byPrice,
  }
}

/** The public answer: the rankings cut to `limit`, optionally one chain, optionally one token. */
export function shapeMovers(full, { limit = 10, chain = null, ticker = null } = {}) {
  const pick = (list) => (chain ? list.filter((e) => e.chain === chain) : list).slice(0, limit)
  const { byGap, byPrice, ...head } = full
  const out = { ...head, limit, chain, byGap: pick(byGap), byPrice: pick(byPrice) }
  if (chain && ticker) out.stock = byGap.find((e) => e.chain === chain && e.ticker === ticker) ?? null
  return out
}
