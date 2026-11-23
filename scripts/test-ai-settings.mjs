// Gully AI settings reader (server/ai-settings.mjs) and its users: the saved file wins over the environment, a save is
// in use on the next request with no restart, and no value reaches a log. The provider is a local stub: no network.
//   node --test scripts/test-ai-settings.mjs
import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import test, { after } from 'node:test'

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gully-ai-settings-'))
const DIR = path.join(tmp, 'integrations')
fs.mkdirSync(DIR)
const tail = (s) => 'Kp4-'.repeat(23) + s
const ENVKEY = `sk-ant-api03-${tail('envEnvAA')}`
const FILEKEY = `sk-ant-api03-${tail('fileFiAA')}`
const FILEKEY2 = `sk-ant-api03-${tail('file2FAA')}`

// the stub provider: records the key each call came with; FILEKEY2 is "revoked"
const calls = []
const stub = http.createServer((req, res) => {
  let body = ''
  req.on('data', (c) => (body += c))
  req.on('end', () => {
    const key = req.headers['x-api-key']
    calls.push({ method: req.method, url: req.url, key })
    res.setHeader('content-type', 'application/json')
    if (key === FILEKEY2) return res.writeHead(401).end(JSON.stringify({ type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } }))
    if (req.url.startsWith('/v1/models')) return res.writeHead(200).end(JSON.stringify({ data: [] }))
    res.writeHead(200).end(JSON.stringify({ content: [{ type: 'text', text: 'hi' }], usage: { input_tokens: 1, output_tokens: 1 }, stop_reason: 'end_turn' }))
  })
})
await new Promise((r) => stub.listen(0, '127.0.0.1', r))

Object.assign(process.env, { DATA_DIR: tmp, CHAINKIT_INTEGRATIONS_DIR: DIR, ANTHROPIC_API_URL: `http://127.0.0.1:${stub.address().port}`, ASK_REMOTE: 'off', ASK_STARTUP_PROBE: '0', ASK_RETRY_BASE_MS: '1', ASK_EMBED: 'off' })
for (const k of ['ANTHROPIC_API_KEY', 'VOYAGE_API_KEY', 'ASK_DAILY_CAP', 'ASK_DAILY_LIMIT', 'ASK_FALLBACK_MODEL', 'ASK_PRICE_INPUT_PER_MTOK', 'ASK_PRICE_OUTPUT_PER_MTOK']) delete process.env[k]

const logs = []
const real = { log: console.log, error: console.error, warn: console.warn }
for (const k of Object.keys(real)) console[k] = (...a) => logs.push(a.map(String).join(' '))

const st = await import('../server/ai-settings.mjs')
const ask = await import('../server/ask.mjs')
const gw = await import('../server/ai/gateway.mjs')
const save = (name, value) => (fs.writeFileSync(path.join(DIR, name), value), st.aiSettingsChanged(name))
const clear = (name) => (fs.rmSync(path.join(DIR, name), { force: true }), st.aiSettingsChanged(name))
const body = { model: 'claude-test', max_tokens: 8, messages: [{ role: 'user', content: 'hi' }] }

after(() => {
  for (const k of Object.keys(real)) console[k] = real[k]
  stub.close()
  fs.rmSync(tmp, { recursive: true, force: true })
})

test('precedence: nothing, then the environment, then the saved file over it', () => {
  assert.equal(st.aiSetting('ANTHROPIC_API_KEY'), '')
  assert.equal(st.aiSettingSource('ANTHROPIC_API_KEY'), null)
  assert.equal(ask.askConfigured(), false)
  process.env.ANTHROPIC_API_KEY = `  ${ENVKEY}  `
  assert.equal(st.aiSetting('ANTHROPIC_API_KEY'), ENVKEY)
  assert.equal(st.aiSettingSource('ANTHROPIC_API_KEY'), 'server')
  assert.equal(ask.askConfigured(), true)
  save('ANTHROPIC_API_KEY', `${FILEKEY}\n`)
  assert.equal(st.aiSetting('ANTHROPIC_API_KEY'), FILEKEY)
  assert.equal(st.aiSettingSource('ANTHROPIC_API_KEY'), 'saved')
  clear('ANTHROPIC_API_KEY')
  assert.equal(st.aiSetting('ANTHROPIC_API_KEY'), ENVKEY)
})

test('only the listed names are read from a file', () => {
  fs.writeFileSync(path.join(DIR, 'ADMIN_TOKEN'), 'from-a-file')
  process.env.ADMIN_TOKEN_TEST_X = 'env'
  assert.equal(st.aiSetting('ADMIN_TOKEN'), String(process.env.ADMIN_TOKEN ?? '').trim())
  assert.equal(st.aiSetting('ADMIN_TOKEN_TEST_X'), 'env')
  st.aiSettingsChanged('ADMIN_TOKEN') // not a listed name: nothing happens
})

test('hot reload: a saved key is used by the next model call, with no restart; the old state is cleared and the new key probed once', async () => {
  await ask.callClaude(body)
  assert.equal(calls.at(-1).key, ENVKEY)
  assert.equal(calls.at(-1).url, '/v1/messages')

  // the provider starts refusing: Gully AI reads unavailable
  save('ANTHROPIC_API_KEY', FILEKEY2)
  assert.equal((await ask.providerRecheck()).result, 'unavailable')
  assert.equal(ask.askStatus().provider, 'unavailable')
  await assert.rejects(ask.callClaude(body), (e) => e.code === 'provider-unavailable')
  assert.equal(calls.at(-1).key, FILEKEY2)

  // the owner saves a working key
  const before = calls.length
  save('ANTHROPIC_API_KEY', FILEKEY)
  assert.equal(ask.askStatus().provider, 'ok', 'cleared at once, before the probe answers')
  assert.deepEqual(await ask.providerRecheck(), { result: 'ok', status: 200 })
  assert.deepEqual(calls.slice(before).map((c) => [c.method, c.url, c.key]), [['GET', '/v1/models?limit=1', FILEKEY]])
  assert.equal(JSON.parse(fs.readFileSync(path.join(tmp, 'ask-health.json'), 'utf8')).ok, true)
  await ask.callClaude(body)
  assert.equal(calls.at(-1).key, FILEKEY)
  assert.equal(ask.askStatus().provider, 'ok')

  // the gateway reads the same value
  assert.equal(gw.anthropicProvider.configured(), true)
  await gw.anthropicProvider.call({ messages: body.messages, maxTokens: 8 }, 'claude-test')
  assert.equal(calls.at(-1).key, FILEKEY)
})

test('a file changed outside the admin page is noticed within a few seconds, and listeners hear it', async () => {
  const heard = []
  const off = st.onAiSettingsChanged((n) => heard.push(n))
  assert.equal(st.aiSetting('ANTHROPIC_API_KEY'), FILEKEY)
  fs.writeFileSync(path.join(DIR, 'ANTHROPIC_API_KEY'), FILEKEY2)
  assert.equal(st.aiSetting('ANTHROPIC_API_KEY'), FILEKEY, 'inside the re-check window the cached value stands')
  await new Promise((r) => setTimeout(r, 2_200))
  assert.equal(st.aiSetting('ANTHROPIC_API_KEY'), FILEKEY2)
  await new Promise((r) => setTimeout(r, 50))
  assert.deepEqual(heard, ['ANTHROPIC_API_KEY'])
  assert.equal((await ask.providerRecheck()).result, 'unavailable')
  off()
  save('ANTHROPIC_API_KEY', FILEKEY)
  assert.equal((await ask.providerRecheck()).result, 'ok')
  assert.deepEqual(heard, ['ANTHROPIC_API_KEY'])
})

test('settings: the cap, the prices and the fallback model follow the saved value at once', () => {
  assert.equal(ask.dailyCap(), 2000)
  process.env.ASK_DAILY_CAP = '900'
  assert.equal(ask.dailyCap(), 900)
  save('ASK_DAILY_CAP', '120')
  assert.equal(ask.dailyCap(), 120)
  save('ASK_DAILY_CAP', 'junk')
  assert.equal(ask.dailyCap(), 2000, 'a broken value is the default, never NaN')
  clear('ASK_DAILY_CAP')
  assert.equal(ask.dailyCap(), 900)
  delete process.env.ASK_DAILY_CAP
  save('ASK_FALLBACK_MODEL', 'claude-fallback-test')
  save('ASK_PRICE_INPUT_PER_MTOK', '2')
  save('ASK_PRICE_OUTPUT_PER_MTOK', '8.5')
  const env = st.aiSettingsEnv()
  assert.equal(env.ASK_PRICE_INPUT_PER_MTOK, '2')
  assert.equal(env.ASK_PRICE_OUTPUT_PER_MTOK, '8.5')
  assert.equal(env.ASK_PRICE_CACHE_READ_PER_MTOK, undefined)
  assert.equal(ask.opsSummary(1).fallbackModel, 'claude-fallback-test')
})

test('checkProvider: a refused key marks it, an accepted key clears a key problem, an unreachable provider changes nothing', async () => {
  const f = (status) => async () => ({ status })
  assert.equal((await ask.checkProvider({ fetchImpl: f(401) })).result, 'unavailable')
  assert.equal(ask.askStatus().provider, 'unavailable')
  const down = async () => {
    throw new Error('down')
  }
  assert.deepEqual(await ask.checkProvider({ fetchImpl: down }), { result: 'unknown', status: null })
  assert.equal(ask.askStatus().provider, 'unavailable')
  assert.equal((await ask.checkProvider({ fetchImpl: f(503) })).result, 'unknown')
  assert.equal((await ask.checkProvider({ fetchImpl: f(200) })).result, 'ok')
  assert.equal(ask.askStatus().provider, 'ok')
  clear('ANTHROPIC_API_KEY')
  delete process.env.ANTHROPIC_API_KEY
  assert.deepEqual(await ask.checkProvider({ fetchImpl: f(200) }), { result: 'none', status: null })
})

test('no key, and no part of one, in anything logged or stored outside its own file', () => {
  const stored = fs.readdirSync(tmp).filter((x) => fs.statSync(path.join(tmp, x)).isFile()).map((x) => fs.readFileSync(path.join(tmp, x), 'utf8'))
  const all = [...logs, ...stored, JSON.stringify(ask.askStatus()), JSON.stringify(ask.askProviderHealth())].join('\n')
  assert.ok(logs.some((l) => /provider account problem/.test(l)), 'the refusal was logged')
  for (const v of [ENVKEY, FILEKEY, FILEKEY2, 'sk-ant-', 'Kp4-Kp4-']) assert.ok(!all.includes(v))
})
