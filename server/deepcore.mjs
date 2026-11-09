// RETIRED 2026-11-08 (owner: "retire deepcore"). The DeepCore partnership ended on 2026-10-29 and every DeepCore data
// feature on this site is gone: the launch poller and its store, the "new launch" alert kind, the router-quote proxy,
// the Gully AI tools, the Holder Map's launch source, the Telegram launch screens and channel posts, the token-logo
// list. Nothing in this module reads deepcore.fun or api.deepcore.fun. What stays is the plain answer for old clients:
// the two public routes answer 410 Gone with code RETIRED and a pointer to Gully Core (gullycore.xyz), Gully Labs' own
// launchpad and DEX core. Code adapted from DeepCore (MIT) keeps its credit where it is used; see LICENSES/.
import { json } from './http.mjs'

export const RETIRED = "DeepCore integrations were retired on 2026-11-08. Gully Core is Gully Labs' own launchpad and DEX core: https://gullycore.xyz"

const gone = (res) => (json(res, 410, { error: 'gone', code: 'RETIRED', message: RETIRED, gullyCore: 'https://gullycore.xyz' }, { 'Cache-Control': 'public, max-age=3600' }), true)

/** GET /api/deepcore/launches: 410 Gone since 2026-11-08 (any query shape). */
export async function handleDeepcoreLaunches(req, res) {
  return gone(res)
}

/** GET /api/deepcore/quote: 410 Gone since 2026-11-08 (any query shape). */
export async function handleDeepcoreQuote(req, res) {
  return gone(res)
}
