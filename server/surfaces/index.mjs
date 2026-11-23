// One entry point for the Gully AI surfaces, called from server.mjs. Every surface is off until its flag is "1"; with all
// flags off nothing here answers (the routes 404 as if absent).
import { sessionContext } from '../developer.mjs'
import { channelUrl, followsChannel, linkForTelegramUser, requiredChannel, telegramToken } from '../telegram.mjs'
import { getAccount } from '../store.mjs'
import { validateInitData } from '../telegram-miniapp.mjs'
import { handleDiscord } from './discord.mjs'
import { handleFarcaster } from './farcaster.mjs'
import { handleEmbed } from './embed.mjs'
import { handleTgAsk } from './tg-ask.mjs'
import { handleLinks } from './links.mjs'

/** The Mini App's blocked-account and News-channel checks (as /api/tg/me does), for the cost route /api/tg/ask. */
async function tgGate(userId) {
  const ch = requiredChannel()
  const follows = ch ? await followsChannel(userId) : true
  const link = linkForTelegramUser(userId)
  return { blocked: !!(link && getAccount(link.address)?.blocked), required: !!ch, follows, channel: ch, url: ch ? channelUrl(ch) : null }
}

export async function handleSurfaces(req, res, url) {
  const p = url.pathname
  if (p === '/api/discord/interactions') return handleDiscord(req, res, url)
  if (p === '/api/farcaster/webhook' || p === '/.well-known/farcaster.json') return handleFarcaster(req, res, url)
  if (p === '/api/ask/embed' || p === '/embed/ask') return handleEmbed(req, res, url)
  if (p === '/api/tg/ask' || p === '/api/tg/ask/chip') return handleTgAsk(req, res, url, { validateInitData, token: telegramToken(), linkForTelegramUser, gate: tgGate })
  if (p.startsWith('/api/surfaces/link/')) return handleLinks(req, res, url, { sessionContext, validateInitData, token: telegramToken() })
  return false
}
export { surfaceStatus } from './surface.mjs'
