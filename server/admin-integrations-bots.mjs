// "Bots and apps" groups of admin.gullylabs.xyz Integrations (owner, 2026-11-25: "yes go and add token fields": keep bots
// to a minimum, and every bot token has a write-only field and a step-by-step guide here BEFORE the bot is created).
// Same write-only pattern and storage as the other groups in admin-integrations.mjs (files in the integrations folder,
// passkey step-up, audit of names only). The website reads them through bot-settings.mjs: a saved value wins over the
// server's environment, and is in use within 2 seconds (Discord, Farcaster) or at once with the webhook re-registered
// (the Telegram bot token: admin-integrations.mjs calls startTelegram after the save).
//
// Checks are safe reads only, never a post:
//   bot_discord   GET /users/@me and GET /applications/@me with the bot token: the token works, the bot belongs to the saved
//                 application id, and the saved public key is the application's (verify_key).
//   bot_telegram  getMe with the token.
//   bot_gullybots GET https://status.gullylabs.xyz/api/status.json: the public "Telegram bots" row (no token involved).
// One action writes to Discord (not a message): "Register slash commands" (PUT the command list; the same call is idempotent).
// Steps in the guides are from the Discord / Telegram / Neynar docs as known on 2026-11-25; every guide says to check the page.

import { COMMANDS, installUrl } from './surfaces/discord.mjs'

const f = (name, label, hint, format, extra = {}) => ({ name, label, hint, format, ...extra, ownerOnly: true })
const SNOWFLAKE = /^[0-9]{17,20}$/
const NOTE = 'The portal pages can move: if a link opens somewhere else, look for the same names in its menus. Never paste a token in chat or a ticket: only here.'
/** The Discord Interactions Endpoint URL this server answers (server/surfaces/discord.mjs). */
export const DISCORD_INTERACTIONS_URL = 'https://api.gullylabs.xyz/api/discord/interactions'

const jsonAssociation = {
  test(v) {
    try {
      const o = JSON.parse(v)
      return !!o && typeof o === 'object' && ['header', 'payload', 'signature'].every((k) => typeof o[k] === 'string' && o[k].length > 8 && o[k].length < 2048)
    } catch {
      return false
    }
  },
}

export const BOT_GROUPS = [
  {
    id: 'bot_discord',
    section: 'bots',
    title: 'Gully Discord app (one app for every Gully Labs product)',
    body: 'The one "Gully" Discord application: Gully AI (/ask, /explain, /token), and later buy and launch alerts and quest roles. kre8 has its own app on admin.kre8.fun and Swoop its own on admin.swoopads.xyz. The application id, public key and server id are not secret; the bot token and the client secret are write-only.',
    usedIn: 'Gully AI on Discord (signed HTTP interactions, flag AI_SURFACE_DISCORD), Discord account linking for Gully AI (flag AI_LINKING). A saved value is used within seconds, no restart.',
    guide: {
      steps: [
        'Open the Discord Developer Portal, signed in with the Gully Labs owner account, and choose New Application. Name: Gully. Accept the terms.',
        'General Information: copy the Application ID and the Public Key into the fields below and save them.',
        'Bot: choose Reset Token, copy the token once and paste it below as the bot token. Leave Public Bot on only if other servers may add it. Turn every Privileged Gateway Intent OFF (presence, server members, message content): the app never reads messages.',
        'OAuth2: copy the Client Secret below (only needed for Gully AI account linking). Add the redirect https://gullylabs.xyz/api/surfaces/link/discord/callback.',
        'Press Check below: it should name the bot and say the public key matches.',
        'General Information: paste the Interactions Endpoint URL shown below and save. Discord sends a test ping; the save only succeeds when this server answers it (the public key must be saved here first).',
        'Press Register slash commands below. Global commands can take up to an hour to show; with a test server id saved they show there at once.',
        'Open the install link below and add the app to the Gully server. It asks only for slash commands and the two thread permissions.',
      ],
      links: [
        { label: 'Discord Developer Portal, applications', url: 'https://discord.com/developers/applications' },
        { label: 'Discord docs: receiving interactions', url: 'https://discord.com/developers/docs/interactions/receiving-and-responding' },
      ],
      note: NOTE,
    },
    fields: [
      f('DISCORD_APP_ID', 'Application ID', '17 to 20 digits, General Information', SNOWFLAKE, { plain: true }),
      f('DISCORD_APP_PUBLIC_KEY', 'Public key', '64 hex characters, General Information', /^[0-9a-fA-F]{64}$/, { plain: true, hexKeyOk: true }),
      f('DISCORD_BOT_TOKEN', 'Bot token', 'from Bot > Reset Token, shown once', /^[A-Za-z0-9_-]{20,40}\.[A-Za-z0-9_-]{4,10}\.[A-Za-z0-9_-]{20,64}$/),
      f('DISCORD_CLIENT_SECRET', 'Client secret', 'from OAuth2, only for account linking', /^[A-Za-z0-9_-]{24,64}$/, { optional: true }),
      f('DISCORD_GUILD_ID', 'Test server id', 'optional: commands show there at once', SNOWFLAKE, { plain: true, optional: true }),
    ],
    test: 'discord',
    info: (read) => [
      { label: 'Interactions Endpoint URL (paste into the Developer Portal)', value: DISCORD_INTERACTIONS_URL },
      { label: 'Install link (slash commands + thread permissions only)', value: read('DISCORD_APP_ID') ? installUrl(read('DISCORD_APP_ID')) : null, empty: 'Appears once the application id is saved.', url: true },
      { label: 'OAuth2 redirect (account linking)', value: 'https://gullylabs.xyz/api/surfaces/link/discord/callback' },
    ],
    actions: [{ id: 'bot_discord_register', label: 'Register slash commands', detail: 'Sends the /ask, /explain and /token command list to Discord. Posts nothing in any channel.' }],
  },
  {
    id: 'bot_telegram',
    section: 'bots',
    title: 'Gully Labs Telegram bot (gap tracker and Gully AI)',
    body: 'The website\'s own Telegram bot: the gap tracker, alerts and Gully AI in chats and the Mini App. It is OFF today (no token on the server). It must be its own BotFather bot: a token used by another service (the Gully Chain bots poll theirs) cannot also run here.',
    usedIn: 'server/telegram.mjs: a saved token is used at once and the webhook, commands and menu button are registered again for it.',
    guide: {
      steps: [
        'In Telegram open @BotFather and send /newbot (or /mybots and pick the bot, if it already exists).',
        'Name it (for example Gully Labs) and pick a username ending in bot. Copy the token BotFather sends (123456789:AA...).',
        'Paste it below and save. The server registers its webhook at once: you do not set a webhook by hand.',
        'Press Check: it should answer with the bot\'s @username.',
        'Optional: the operators\' chat id for admin alerts (a number, groups start with -100). Add the bot to that chat first.',
        'In BotFather: /setprivacy stays Enabled (the bot only sees commands and replies in groups). Bot Settings > Configure Mini App: https://gullylabs.xyz/tg.',
      ],
      links: [{ label: 'BotFather', url: 'https://t.me/BotFather' }, { label: 'Telegram Bot API', url: 'https://core.telegram.org/bots/api' }],
      note: NOTE,
    },
    fields: [
      f('TELEGRAM_BOT_TOKEN', 'Bot token', '123456789:AA... from BotFather', /^[0-9]{6,12}:[A-Za-z0-9_-]{30,64}$/),
      f('TELEGRAM_ADMIN_CHAT_ID', 'Operators\' chat id', 'a number; groups start with -100', /^-?[0-9]{5,20}$/, { plain: true, optional: true }),
    ],
    test: 'telegram',
  },
  {
    id: 'bot_farcaster',
    section: 'bots',
    title: 'Gully AI on Farcaster',
    body: 'Replies to casts that mention the Gully AI account, through a Neynar webhook and managed signer. Posting stays a dry run until the server flag FARCASTER_POSTING=live. The account fid and the Mini App association are not secret.',
    usedIn: 'server/surfaces/farcaster.mjs (flag AI_SURFACE_FARCASTER). A saved value is used within seconds, no restart.',
    guide: {
      steps: [
        'Create or pick the Farcaster account Gully AI answers as. Its fid is on the profile (Settings > Advanced, or the account\'s About page).',
        'Sign in to the Neynar developer portal with that account and create an app. Copy the API key below.',
        'Create a managed signer for the account in the portal and approve it in the Farcaster app. Copy the signer UUID below.',
        'Webhooks: create one for cast.created filtered to mentions of the fid, URL https://api.gullylabs.xyz/api/farcaster/webhook. Copy its signing secret below.',
        'Optional, Mini App: in the Farcaster app (Developers > Manifest) sign the domain gullylabs.xyz and paste the accountAssociation JSON ({"header":...,"payload":...,"signature":...}).',
        'The provider pages and names were not re-read on 2026-11-25: check them before you pay for a plan.',
      ],
      links: [{ label: 'Neynar developer portal', url: 'https://dev.neynar.com' }, { label: 'Farcaster Mini Apps', url: 'https://miniapps.farcaster.xyz' }],
      note: NOTE,
    },
    fields: [
      f('NEYNAR_API_KEY', 'Neynar API key', 'from the Neynar app page', /^[A-Za-z0-9-]{20,80}$/),
      f('FARCASTER_SIGNER_UUID', 'Signer UUID', 'from the managed signer', /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/),
      f('FARCASTER_WEBHOOK_SECRET', 'Webhook signing secret', 'from the Neynar webhook', /^[A-Za-z0-9_-]{16,128}$/, { hexKeyOk: true }),
      f('FARCASTER_BOT_FID', 'Account fid', 'a number', /^[0-9]{1,10}$/, { plain: true }),
      f('FARCASTER_ACCOUNT_ASSOCIATION', 'Mini App account association', 'the JSON from the manifest tool', jsonAssociation, { plain: true, optional: true, multiline: true }),
    ],
    info: () => [{ label: 'Webhook URL (paste into Neynar)', value: 'https://api.gullylabs.xyz/api/farcaster/webhook' }],
  },
  {
    id: 'bot_gullybots',
    section: 'bots',
    title: 'Gully Chain bots (@GullyBuyBot, @GullyChainBot, @GullyQuestBot): status only',
    body: 'These run in the gully-bots service on the other Gully box, not in this website, so their tokens are not entered on this page. Check reads the public status row "Telegram bots".',
    usedIn: 'gully-bots (compose project gully-bots on gully-l3): bots service (@GullyBuyBot BUYBOT_TOKEN, @GullyChainBot TRADEBOT_TOKEN, channels @GullyChain and @GullyChainDeploys) and questbot (@GullyQuestBot QUESTBOT_TOKEN).',
    guideOnly: true,
    fields: [],
    test: 'gullybots',
    notes: [
      { id: 'gb_where', title: 'Where the tokens live', text: 'One file per token in the gully-bots secrets folder on gully-l3 (buybot_token, tradebot_token, questbot_token), written in place by deploy/fill-keys.sh from your keys file. Each bot re-reads its file every 60 seconds, so a new token needs no restart. All three are set today.', links: [] },
      { id: 'gb_discord', title: 'Discord for the quest bot', text: 'The quest bot\'s Discord half folds into the one Gully Discord app above: one application can take interactions either over the gateway or at the Interactions Endpoint URL, not both, so the quest commands move behind the same endpoint before that app gets a bot there. Leave gully-bots\' discord_bot_token empty.', links: [] },
    ],
  },
]

export const BOT_FIELD_NAMES = new Set(BOT_GROUPS.flatMap((g) => g.fields.map((x) => x.name)))

const getJson = async (fetchImpl, url, headers = {}, method = 'GET', body) => {
  const ctl = new AbortController()
  const t = setTimeout(() => ctl.abort(), 8000)
  try {
    const r = await fetchImpl(url, { method, headers: { accept: 'application/json', 'user-agent': 'gully-admin-check', ...(body ? { 'content-type': 'application/json' } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined, signal: ctl.signal, redirect: 'error' })
    return { status: r.status, data: await r.json().catch(() => null) }
  } finally {
    clearTimeout(t)
  }
}
const DISCORD = () => (String(process.env.DISCORD_API ?? '').trim() || 'https://discord.com/api/v10').replace(/\/$/, '')
const TELEGRAM = () => (String(process.env.TELEGRAM_API ?? '').trim() || 'https://api.telegram.org').replace(/\/$/, '')
const STATUS_URL = () => String(process.env.GULLY_STATUS_JSON ?? '').trim() || 'https://status.gullylabs.xyz/api/status.json'
const clip = (s) => String(s ?? '').replace(/[^\w .@-]/g, '').slice(0, 60)

/** The Check button. `read(name)` gives the value in use (saved, else server). Never returns a value. */
export async function runBotCheck(id, read, fetchImpl = fetch) {
  const g = BOT_GROUPS.find((x) => x.id === id)
  if (!g || !g.test) return { ok: false, status: 404, result: 'unknown', detail: 'No such check.' }
  const missing = g.fields.filter((x) => !x.optional && !read(x.name)).map((x) => x.label)
  if (g.test !== 'gullybots' && g.test !== 'telegram' && missing.length) return { ok: false, status: 200, result: 'incomplete', detail: `Not set yet: ${missing.join(', ')}.` }
  try {
    if (g.test === 'discord') {
      const auth = { authorization: `Bot ${read('DISCORD_BOT_TOKEN')}` }
      const me = await getJson(fetchImpl, `${DISCORD()}/users/@me`, auth)
      if (me.status === 401) return { ok: false, status: 200, result: 'rejected', detail: 'Discord did not accept the bot token. Reset it in the portal and save the new one.' }
      if (me.status !== 200) return { ok: false, status: 200, result: 'rejected', detail: `Discord answered ${me.status}.` }
      const app = await getJson(fetchImpl, `${DISCORD()}/applications/@me`, auth)
      const sameApp = String(app.data?.id ?? me.data?.id ?? '') === read('DISCORD_APP_ID')
      const sameKey = String(app.data?.verify_key ?? '').toLowerCase() === read('DISCORD_APP_PUBLIC_KEY').toLowerCase()
      const name = clip(me.data?.username)
      if (!sameApp) return { ok: false, status: 200, result: 'mismatch', detail: `The token works (bot ${name}) but belongs to another application than the saved application id.` }
      if (app.status === 200 && !sameKey) return { ok: false, status: 200, result: 'mismatch', detail: `The token works (bot ${name}) but the saved public key is not this application's. Copy it again from General Information.` }
      return { ok: true, status: 200, result: 'ok', detail: `Discord accepted the token: bot ${name}, the application id${app.status === 200 ? ' and the public key' : ''} match.` }
    }
    if (g.test === 'telegram') {
      const t = read('TELEGRAM_BOT_TOKEN')
      if (!t) return { ok: false, status: 200, result: 'incomplete', detail: 'Not set yet: Bot token.' }
      const r = await getJson(fetchImpl, `${TELEGRAM()}/bot${t}/getMe`)
      if (r.status === 200 && r.data?.ok) return { ok: true, status: 200, result: 'ok', detail: `Telegram answers as @${clip(r.data.result?.username)}.` }
      return { ok: false, status: 200, result: 'rejected', detail: r.status === 401 || r.status === 404 ? 'Telegram did not accept this token.' : `Telegram answered ${r.status}.` }
    }
    if (g.test === 'gullybots') {
      const r = await getJson(fetchImpl, STATUS_URL())
      const row = (r.data?.services ?? []).find((s) => s?.id === 'telegram-bots')
      if (!row) return { ok: false, status: 200, result: 'unknown', detail: 'The status page has no Telegram bots row just now.' }
      const up = row.status === 'up'
      return { ok: up, status: 200, result: up ? 'ok' : 'down', detail: up ? 'Status page: Telegram bots are posting.' : `Status page: Telegram bots row is ${clip(row.status)}. The details are on the internal status page (which bot has not posted in its window).` }
    }
  } catch {
    return { ok: false, status: 200, result: 'unreachable', detail: 'The service could not be reached just now. Try again later.' }
  }
  return { ok: false, status: 404, result: 'unknown', detail: 'No such check.' }
}

/** The one write action: register the Gully AI slash commands (global, and on the test server when one is saved). */
export async function runBotAction(id, read, fetchImpl = fetch) {
  if (id !== 'bot_discord_register') return { ok: false, status: 404, result: 'unknown', detail: 'No such action.' }
  const app = read('DISCORD_APP_ID')
  const token = read('DISCORD_BOT_TOKEN')
  if (!app || !token) return { ok: false, status: 200, result: 'incomplete', detail: 'Save the application id and the bot token first.' }
  const auth = { authorization: `Bot ${token}` }
  try {
    const g = await getJson(fetchImpl, `${DISCORD()}/applications/${encodeURIComponent(app)}/commands`, auth, 'PUT', COMMANDS)
    if (g.status !== 200) return { ok: false, status: 200, result: 'rejected', detail: g.status === 401 ? 'Discord did not accept the bot token.' : `Discord answered ${g.status} for the global commands.` }
    const guild = read('DISCORD_GUILD_ID')
    if (guild) {
      const s = await getJson(fetchImpl, `${DISCORD()}/applications/${encodeURIComponent(app)}/guilds/${encodeURIComponent(guild)}/commands`, auth, 'PUT', COMMANDS)
      if (s.status !== 200) return { ok: true, status: 200, result: 'partial', detail: `Global commands registered (up to an hour to show). The test server answered ${s.status}: add the app to it with the install link first.` }
      return { ok: true, status: 200, result: 'ok', detail: `${COMMANDS.length} commands registered: on the test server now, everywhere within an hour.` }
    }
    return { ok: true, status: 200, result: 'ok', detail: `${COMMANDS.length} commands registered. They can take up to an hour to show in every server.` }
  } catch {
    return { ok: false, status: 200, result: 'unreachable', detail: 'Discord could not be reached just now. Try again later.' }
  }
}
