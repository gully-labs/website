// Gully AI inside the Telegram Mini App: POST /api/tg/ask and GET /api/tg/ask/chip (flag AI_SURFACE_TGAPP=1).
// Auth is the Mini App's initData (telegram-miniapp.mjs validateInitData, per https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app).
// The Mini App is a private place: the account linked to this Telegram user (the bot's own link, or an AI_LINKING link)
// gives the "my" tools their workspace, exactly as the bot's private chat does. Nothing is stored here.
//
//   POST /api/tg/ask  { question, history? } -> { id, chunks, answered } | { error }
//   GET  /api/tg/ask/chip                    -> { state: 'free'|'credits'|'soon', balance: number|null, freeLeft: null }
//
// Billing: digital goods/services sold INSIDE Telegram must use Telegram Stars (see SPEC.md section 5); this route never
// takes money. The chip shows what the credits service reports; until it exists it says state 'soon'.

import { json, readJson } from '../http.mjs'
import { answerForSurface, surfaceEnabled } from './surface.mjs'
import { ctxOfLink } from './links.mjs'

let chipHook = async () => ({ state: 'soon', balance: null })
export const setChipHook = (fn) => (chipHook = fn ?? (async () => ({ state: 'soon', balance: null })))

/** deps: { validateInitData, token, linkForTelegramUser, askFn } */
export async function handleTgAsk(req, res, url, deps) {
  if (url.pathname !== '/api/tg/ask' && url.pathname !== '/api/tg/ask/chip') return false
  if (!surfaceEnabled('tgapp') || !deps.token) return json(res, 404, { error: 'not found' }), true
  const h = String(req.headers.authorization ?? '')
  const auth = deps.validateInitData(h.startsWith('tma ') ? h.slice(4).trim() : '', deps.token)
  if (!auth.ok) return json(res, 401, { error: auth.error }), true
  const uid = auth.user.id
  if (url.pathname === '/api/tg/ask/chip') return json(res, 200, { ...(await chipHook({ platform: 'telegram', id: uid })) }), true
  if (req.method !== 'POST') return json(res, 405, { error: 'POST only' }), true
  const body = (await readJson(req, 16_384)) ?? {}
  const link = deps.linkForTelegramUser?.(uid)
  const ctx = link?.address ? { user: link.address, workspace: link.address, role: 'linked chat' } : ctxOfLink('telegram', uid)
  const history = Array.isArray(body.history) ? body.history.slice(-6).map((m) => ({ role: m?.role === 'assistant' ? 'assistant' : 'user', content: String(m?.content ?? '').slice(0, 1500) })) : []
  const r = await answerForSurface({ surface: 'tgapp', userKey: uid, question: body.question, place: 'private', locale: auth.user.languageCode ?? '', ctx, history, askFn: deps.askFn })
  if (!r.ok) return json(res, r.status, { error: r.message }, r.retryAfter ? { 'Retry-After': String(r.retryAfter) } : {}), true
  return json(res, 200, { id: r.id, chunks: r.chunks, answered: r.answered }), true
}
