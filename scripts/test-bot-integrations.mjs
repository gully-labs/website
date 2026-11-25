// Bots and apps on admin Integrations (server/admin-integrations-bots.mjs, server/bot-settings.mjs): a saved key wins over
// the environment, Discord's PING verification works from a saved public key alone, the field rules, the safe Checks and
// the one Discord action. No network: every platform is a fake fetch.
//   node --test scripts/test-bot-integrations.mjs
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import test from 'node:test'

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gully-bot-int-'))
const DIR = path.join(tmp, 'integrations')
fs.mkdirSync(DIR)
Object.assign(process.env, { DATA_DIR: tmp, CHAINKIT_INTEGRATIONS_DIR: DIR, ASK_REMOTE: 'off', ASK_STARTUP_PROBE: '0', ASK_EMBED: 'off' })
for (const k of ['DISCORD_APP_ID', 'DISCORD_APP_PUBLIC_KEY', 'DISCORD_BOT_TOKEN', 'DISCORD_GUILD_ID', 'TELEGRAM_BOT_TOKEN', 'TELEGRAM_ADMIN_CHAT_ID', 'AI_SURFACE_DISCORD']) delete process.env[k]

const { botSetting, botSettingSource, botSettingsChanged, BOT_SETTING_NAMES } = await import('../server/bot-settings.mjs')
const { BOT_GROUPS, BOT_FIELD_NAMES, DISCORD_INTERACTIONS_URL, runBotAction, runBotCheck } = await import('../server/admin-integrations-bots.mjs')
const { INTEGRATION_GROUPS, refuseValue } = await import('../server/admin-integrations.mjs')
const { handleDiscord, COMMANDS } = await import('../server/surfaces/discord.mjs')
const { telegramToken, adminChatId } = await import('../server/telegram.mjs')

const save = (name, v) => (fs.writeFileSync(path.join(DIR, name), v), botSettingsChanged(name))
const drop = (name) => (fs.rmSync(path.join(DIR, name), { force: true }), botSettingsChanged(name))
const field = (name) => BOT_GROUPS.flatMap((g) => g.fields).find((f) => f.name === name)

const APP = '123456789012345678'
const BOT = `${'M'.repeat(24)}.Gx1abc.${'k'.repeat(38)}`
const TG = '123456789:AAH' + 'x'.repeat(32)

test('every bot field is readable through bot-settings, and every group is on the Integrations list', () => {
  for (const n of BOT_FIELD_NAMES) assert.ok(BOT_SETTING_NAMES.has(n), n)
  for (const g of BOT_GROUPS) assert.ok(INTEGRATION_GROUPS.includes(g), g.id)
  for (const f of BOT_GROUPS.flatMap((g) => g.fields)) assert.equal(f.ownerOnly, true, f.name)
})

test('a saved value wins over the environment; other names stay environment only', () => {
  process.env.TELEGRAM_BOT_TOKEN = '999999:' + 'e'.repeat(30)
  assert.equal(botSettingSource('TELEGRAM_BOT_TOKEN'), 'server')
  save('TELEGRAM_BOT_TOKEN', TG)
  assert.equal(botSetting('TELEGRAM_BOT_TOKEN'), TG)
  assert.equal(botSettingSource('TELEGRAM_BOT_TOKEN'), 'saved')
  assert.equal(telegramToken(), TG, 'the Telegram bot reads the saved token')
  drop('TELEGRAM_BOT_TOKEN')
  assert.equal(telegramToken(), process.env.TELEGRAM_BOT_TOKEN)
  delete process.env.TELEGRAM_BOT_TOKEN
  assert.equal(telegramToken(), null)
  save('TELEGRAM_ADMIN_CHAT_ID', '-1001234567890')
  assert.equal(adminChatId(), '-1001234567890')
  drop('TELEGRAM_ADMIN_CHAT_ID')
  save('AI_SURFACE_DISCORD', '1')
  assert.equal(botSetting('AI_SURFACE_DISCORD'), '', 'flags are never read from the folder')
  drop('AI_SURFACE_DISCORD')
})

test('field rules: real shapes pass, wallet keys and wrong shapes are refused', () => {
  const ok = (n, v) => assert.equal(refuseValue(field(n), v), null, `${n} ${v.slice(0, 12)}`)
  const no = (n, v) => assert.notEqual(refuseValue(field(n), v), null, `${n} ${v.slice(0, 12)}`)
  ok('DISCORD_APP_ID', APP)
  ok('DISCORD_APP_PUBLIC_KEY', 'ab'.repeat(32))
  ok('DISCORD_BOT_TOKEN', BOT)
  ok('TELEGRAM_BOT_TOKEN', TG)
  ok('TELEGRAM_ADMIN_CHAT_ID', '-1001234567890')
  ok('FARCASTER_SIGNER_UUID', '1b4e28ba-2fa1-41d2-883f-0016d3cca427')
  ok('FARCASTER_ACCOUNT_ASSOCIATION', JSON.stringify({ header: 'eyJmaWQiOjF9', payload: 'eyJkb21haW4iOiJ4In0', signature: 'MHg0NTY3ODkwYWJj' }))
  no('DISCORD_BOT_TOKEN', '0x' + 'ab'.repeat(32))
  no('DISCORD_BOT_TOKEN', 'abandon '.repeat(12).trim())
  no('TELEGRAM_BOT_TOKEN', 'ab'.repeat(32))
  no('DISCORD_APP_ID', 'gully')
  no('FARCASTER_ACCOUNT_ASSOCIATION', '{"header":"x"}')
})

/** A fake request with a raw body and headers, and a fake response that records what was sent. */
function call(body, headers = {}) {
  const req = Readable.from([Buffer.from(body)])
  req.method = 'POST'
  req.headers = headers
  const res = { status: 0, body: null, writeHead(s) { this.status = s }, end(b) { this.body = JSON.parse(b) } }
  return { req, res }
}

test("Discord's PING verification answers from a saved public key alone (no flag, no restart)", async () => {
  const url = new URL('https://api.gullylabs.xyz/api/discord/interactions')
  let r = call('{"type":1}')
  await handleDiscord(r.req, r.res, url)
  assert.equal(r.res.status, 404, 'no key: the route stays hidden')
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519')
  const pub = publicKey.export({ format: 'der', type: 'spki' }).subarray(12).toString('hex')
  save('DISCORD_APP_PUBLIC_KEY', pub)
  const ts = String(Math.floor(Date.now() / 1000))
  const body = '{"type":1}'
  const sig = crypto.sign(null, Buffer.from(ts + body), privateKey).toString('hex')
  r = call(body, { 'x-signature-ed25519': sig, 'x-signature-timestamp': ts })
  await handleDiscord(r.req, r.res, url)
  assert.equal(r.res.status, 200)
  assert.deepEqual(r.res.body, { type: 1 })
  r = call(body, { 'x-signature-ed25519': '00'.repeat(64), 'x-signature-timestamp': ts })
  await handleDiscord(r.req, r.res, url)
  assert.equal(r.res.status, 401, 'a bad signature is refused (Discord tests this on purpose)')
  drop('DISCORD_APP_PUBLIC_KEY')
  assert.equal(DISCORD_INTERACTIONS_URL, url.href)
})

const fake = (routes) => {
  const calls = []
  const fn = async (u, o = {}) => {
    calls.push({ u: String(u), method: o.method ?? 'GET', auth: o.headers?.authorization, body: o.body })
    for (const [re, out] of routes) if (re.test(String(u))) return { status: out.status, json: async () => out.data }
    return { status: 404, json: async () => ({}) }
  }
  return Object.assign(fn, { calls })
}

test('Discord Check: token, application id and public key, read-only', async () => {
  const v = { DISCORD_APP_ID: APP, DISCORD_APP_PUBLIC_KEY: 'ab'.repeat(32), DISCORD_BOT_TOKEN: BOT }
  const read = (n) => v[n] ?? ''
  let f = fake([[/users\/@me$/, { status: 200, data: { id: APP, username: 'Gully' } }], [/applications\/@me$/, { status: 200, data: { id: APP, verify_key: 'AB'.repeat(32) } }]])
  let r = await runBotCheck('bot_discord', read, f)
  assert.equal(r.result, 'ok', r.detail)
  assert.ok(f.calls.every((c) => c.method === 'GET' && c.auth === `Bot ${BOT}`))
  assert.ok(!JSON.stringify(r).includes(BOT))
  f = fake([[/users\/@me$/, { status: 200, data: { id: APP, username: 'Gully' } }], [/applications\/@me$/, { status: 200, data: { id: APP, verify_key: 'cd'.repeat(32) } }]])
  assert.equal((await runBotCheck('bot_discord', read, f)).result, 'mismatch')
  f = fake([[/users\/@me$/, { status: 401, data: {} }]])
  assert.equal((await runBotCheck('bot_discord', read, f)).result, 'rejected')
  assert.equal((await runBotCheck('bot_discord', () => '', f)).result, 'incomplete')
})

test('Telegram Check is getMe; Gully Chain bots Check reads the public status row', async () => {
  let f = fake([[/getMe$/, { status: 200, data: { ok: true, result: { username: 'GullyLabsBot' } } }]])
  const r = await runBotCheck('bot_telegram', (n) => (n === 'TELEGRAM_BOT_TOKEN' ? TG : ''), f)
  assert.equal(r.result, 'ok')
  assert.match(r.detail, /@GullyLabsBot/)
  assert.ok(!r.detail.includes(TG))
  f = fake([[/status\.json$/, { status: 200, data: { services: [{ id: 'telegram-bots', status: 'down' }] } }]])
  const s = await runBotCheck('bot_gullybots', () => '', f)
  assert.equal(s.result, 'down')
  assert.equal(f.calls[0].auth, undefined, 'no token is sent to the status page')
})

test('Register slash commands: PUT the command list, globally and on the test server', async () => {
  const f = fake([[/commands$/, { status: 200, data: [] }]])
  const v = { DISCORD_APP_ID: APP, DISCORD_BOT_TOKEN: BOT, DISCORD_GUILD_ID: '223456789012345678' }
  const r = await runBotAction('bot_discord_register', (n) => v[n] ?? '', f)
  assert.equal(r.result, 'ok')
  assert.equal(f.calls.length, 2)
  assert.ok(f.calls.every((c) => c.method === 'PUT' && JSON.parse(c.body).length === COMMANDS.length))
  assert.match(f.calls[1].u, /guilds\/223456789012345678\/commands$/)
  assert.equal((await runBotAction('nope', () => '', f)).status, 404)
})

test('the Discord card shows the endpoint and an install link built from the saved application id', () => {
  const g = BOT_GROUPS.find((x) => x.id === 'bot_discord')
  const info = g.info((n) => (n === 'DISCORD_APP_ID' ? APP : null))
  assert.equal(info[0].value, DISCORD_INTERACTIONS_URL)
  assert.match(info[1].value, new RegExp(`client_id=${APP}`))
  assert.match(info[1].value, /permissions=/)
  assert.equal(g.info(() => null)[1].value, null)
})
