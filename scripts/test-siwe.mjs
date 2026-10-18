// End-to-end test of wallet sign-in (SIWE) and self-serve API keys against a running server.
//
//   npm run build
//   DATA_DIR=/tmp/gully-test ADMIN_TOKEN=<24+ chars> PORT=8797 node server/server.mjs
//   ADMIN_TOKEN=<same> node scripts/test-siwe.mjs [http://localhost:8797]
//
// Uses a fresh random private key each run (viem, a devDependency), so it never touches a real wallet.
// Also checks the server's vendored secp256k1/keccak against viem on random signatures.

import { createSiweMessage } from 'viem/siwe'
import { concat, encodeAbiParameters, encodeDeployData, encodeFunctionData, erc6492SignatureValidatorByteCode, hashMessage, parseAbi, toHex } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { contractCheckCall, hashPersonalMessage, parseSiwe, recoverAddress } from '../server/siwe.mjs'
import { hostRequest, hostSignIn, makeClient } from './test-helpers.mjs'

const BASE = process.argv[2] ?? 'http://localhost:8797'
const ADMIN = process.env.ADMIN_TOKEN
let passed = 0
let failed = 0

function check(name, cond, extra = '') {
  if (cond) passed++
  else failed++
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? `  (${extra})` : ''}`)
}

/* ------------------------------------------------- crypto, offline --- */

{
  let ok = true
  for (let i = 0; i < 40; i++) {
    const acct = privateKeyToAccount(generatePrivateKey())
    const msg = `hello ${i} ✓ ${Math.random()}`
    const sig = await acct.signMessage({ message: msg })
    if (toHex(hashPersonalMessage(msg)) !== hashMessage(msg)) ok = false
    if (recoverAddress(hashPersonalMessage(msg), sig) !== acct.address.toLowerCase()) ok = false
  }
  check('vendored keccak + secp256k1 recover agree with viem on 40 random signatures', ok)
  const acct = privateKeyToAccount(generatePrivateKey())
  const sig = await acct.signMessage({ message: 'x' })
  const tampered = sig.slice(0, 10) + (sig[10] === 'a' ? 'b' : 'a') + sig.slice(11)
  check('tampered signature does not recover the signer', recoverAddress(hashPersonalMessage('x'), tampered) !== acct.address.toLowerCase())

  // EIP-1271 and ERC-6492 calldata match viem's encoders.
  const addr = acct.address.toLowerCase()
  const digest = hashPersonalMessage('x')
  const c1271 = contractCheckCall(addr, digest, sig)
  const v1271 = encodeFunctionData({ abi: parseAbi(['function isValidSignature(bytes32 hash, bytes signature) view returns (bytes4)']), functionName: 'isValidSignature', args: [toHex(digest), sig] })
  check('EIP-1271 calldata matches viem', c1271.kind === '1271' && c1271.call.data === v1271)
  const wrapped = concat([encodeAbiParameters([{ type: 'address' }, { type: 'bytes' }, { type: 'bytes' }], ['0x0000000000000000000000000000000000000001', '0xdeadbeef', sig]), '0x6492649264926492649264926492649264926492649264926492649264926492'])
  const c6492 = contractCheckCall(addr, digest, wrapped)
  const v6492 = encodeDeployData({ abi: parseAbi(['constructor(address _signer, bytes32 _hash, bytes _signature)']), bytecode: erc6492SignatureValidatorByteCode, args: [addr, toHex(digest), wrapped] })
  check('ERC-6492 validator calldata matches viem', c6492.kind === '6492' && c6492.call.data === v6492)

  const m = createSiweMessage({ domain: 'example.com', address: acct.address, uri: 'https://example.com', version: '1', chainId: 8453, nonce: 'abcdef0123456789', issuedAt: new Date(), statement: 'Sign in.' })
  const p = parseSiwe(m)
  check('parses a viem-built SIWE message', p?.domain === 'example.com' && p.chainId === 8453 && p.nonce === 'abcdef0123456789')
  const noStatement = createSiweMessage({ domain: 'example.com', address: acct.address, uri: 'https://example.com', version: '1', chainId: 1, nonce: 'abcdef0123456789', issuedAt: new Date() })
  check('parses a SIWE message without a statement', parseSiwe(noStatement)?.chainId === 1)
}

/* ----------------------------------------------------- end to end --- */

// The HTTP client and SIWE message builder are shared with test-paid.mjs (test-helpers.mjs).
const client = makeClient(BASE)
const { call, post } = client

const account = privateKeyToAccount(generatePrivateKey())
const stranger = privateKeyToAccount(generatePrivateKey())
const message = (overrides = {}) => client.siweMessage(account, overrides)

{
  const n = await call('/api/developer/nonce')
  check('nonce is issued', n.status === 200 && /^[a-f0-9]{32}$/.test(n.data?.nonce ?? ''))

  const m1 = await message()
  const s1 = await account.signMessage({ message: m1 })
  const noHeader = await call('/api/developer/siwe', { method: 'POST', body: { message: m1, signature: s1 } })
  check('sign-in without X-Requested-With is refused', noHeader.status === 403)
  const foreign = await post('/api/developer/siwe', { message: m1, signature: s1 }, { headers: { origin: 'https://evil.example' } })
  check('sign-in from a foreign Origin is refused', foreign.status === 403)

  const m2 = await message()
  const bad = await post('/api/developer/siwe', { message: m2, signature: await stranger.signMessage({ message: m2 }) })
  check('a signature from another wallet is refused', bad.status === 401, bad.data?.error)

  const m3 = await message({ domain: 'evil.example', uri: 'https://evil.example' })
  const wrong = await post('/api/developer/siwe', { message: m3, signature: await account.signMessage({ message: m3 }) })
  check('a message for another domain is refused', wrong.status === 401, wrong.data?.error)

  const m4 = await message({ uri: 'https://evil.example/login' })
  const wrongUri = await post('/api/developer/siwe', { message: m4, signature: await account.signMessage({ message: m4 }) })
  check('a message whose URI is another site is refused', wrongUri.status === 401, wrongUri.data?.error)

  const m5 = await message({ nonce: 'notissued00000000' })
  const unknownNonce = await post('/api/developer/siwe', { message: m5, signature: await account.signMessage({ message: m5 }) })
  check('a nonce the server never issued is refused', unknownNonce.status === 401, unknownNonce.data?.error)

  const m6 = await message({ expirationTime: new Date(Date.now() - 1000) })
  const expired = await post('/api/developer/siwe', { message: m6, signature: await account.signMessage({ message: m6 }) })
  check('an expired message is refused', expired.status === 401, expired.data?.error)

  const ok = await post('/api/developer/siwe', { message: m1, signature: s1 })
  const setCookie = ok.headers.get('set-cookie') ?? ''
  check('a good signature signs in', ok.status === 200 && ok.data?.address === account.address.toLowerCase())
  check('session cookie is HttpOnly and SameSite=Lax', /HttpOnly/.test(setCookie) && /SameSite=Lax/.test(setCookie) && /Max-Age=2592000/.test(setCookie))
  client.cookie = setCookie.split(';')[0]

  const replay = await post('/api/developer/siwe', { message: m1, signature: s1 }, { useCookie: false })
  check('a reused nonce is refused', replay.status === 401, replay.data?.error)

  const acc = await call('/api/developer/account')
  check('account is readable with the session', acc.status === 200 && acc.data?.address === account.address.toLowerCase() && acc.data.keys.length === 0)
  check('account without the cookie is 401', (await call('/api/developer/account', { useCookie: false })).status === 401)

  const created = await post('/api/developer/keys', { name: 'Test bot' })
  check('a key is created instantly', created.status === 201 && /^gl_live_/.test(created.data?.secret ?? ''), created.data?.error)
  const secret = created.data?.secret
  const keyId = created.data?.key?.id
  check('the key list shows the prefix, never the secret', !JSON.stringify((await call('/api/developer/account')).data).includes(secret))
  check('creating a key cross-site is refused', (await call('/api/developer/keys', { method: 'POST', body: { name: 'x' } })).status === 403)
  check('a bad key name is refused', (await post('/api/developer/keys', { name: '<script>' })).status === 400)

  let ok200 = 0
  let limitHeader = null
  for (let i = 0; i < 3; i++) {
    const r = await call(i ? '/api/tracker/history?chain=robinhood&ticker=NVDA' : '/api/tracker', { auth: secret, useCookie: false })
    if (r.status === 200) ok200++
    limitHeader ??= r.headers.get('x-ratelimit-limit')
  }
  check('the key calls the tracker API', ok200 >= 2, `${ok200}/3 answered 200`)
  check('keyed requests get the 600/min limit', limitHeader === '600', `X-RateLimit-Limit ${limitHeader}`)
  check('an unknown key is 401', (await call('/api/tracker', { auth: 'gl_live_nope', useCookie: false })).status === 401)

  const usage = await call('/api/developer/usage?range=24h')
  check('usage is recorded per key', usage.status === 200 && usage.data.today.total >= 3 && usage.data.points.at(-1).keys[keyId] >= 3, `today ${usage.data?.today?.total}`)
  check('usage ranges have the right number of buckets', (await call('/api/developer/usage?range=7d')).data.points.length === 168 && (await call('/api/developer/usage?range=30d')).data.points.length === 30)
  const recent = await call('/api/developer/requests')
  check('recent requests list the calls', recent.status === 200 && recent.data.requests.length >= 3 && recent.data.requests[0].path.startsWith('/api/tracker'), `${recent.data?.requests?.length} rows`)

  const renamed = await post(`/api/developer/keys/${keyId}/rename`, { name: 'Renamed bot' })
  check('a key is renamed', renamed.status === 200 && renamed.data.key.name === 'Renamed bot')

  const rotated = await post(`/api/developer/keys/${keyId}/rotate`)
  const secret2 = rotated.data?.secret
  check('rotation returns a new secret, same key id', rotated.status === 200 && secret2 && secret2 !== secret && rotated.data.key.id === keyId)
  check('the old secret stops working after rotation', (await call('/api/tracker/history?chain=robinhood&ticker=NVDA', { auth: secret, useCookie: false })).status === 401)
  check('the new secret works', (await call('/api/tracker/history?chain=robinhood&ticker=NVDA', { auth: secret2, useCookie: false })).status === 200)

  const revoked = await post(`/api/developer/keys/${keyId}/revoke`)
  check('a key is revoked', revoked.status === 200 && revoked.data.key.revokedAt)
  check('a revoked key is 401', (await call('/api/tracker/history?chain=robinhood&ticker=NVDA', { auth: secret2, useCookie: false })).status === 401)

  const extra = []
  for (let i = 0; i < 5; i++) extra.push(await post('/api/developer/keys', { name: `Key ${i}` }))
  check('five live keys can be created', extra.every((r) => r.status === 201))
  const sixth = await post('/api/developer/keys', { name: 'One too many' })
  check('a sixth live key is refused', sixth.status === 409, sixth.data?.error)

  if (ADMIN) {
    const admin = (path, method = 'GET') => fetch(BASE + path, { method, headers: { authorization: `Bearer ${ADMIN}` } }).then(async (r) => ({ status: r.status, data: await r.json().catch(() => null) }))
    const list = await admin('/api/admin/developers')
    const me = list.data?.accounts?.find((a) => a.address === account.address.toLowerCase())
    check('admin lists the wallet with its key count', me?.liveKeys === 5)
    const liveSecret = extra[0].data.secret
    const blocked = await admin(`/api/admin/accounts/${account.address.toLowerCase()}/block`, 'POST')
    check('admin blocks the wallet', blocked.status === 200 && blocked.data.blocked === true)
    check("a blocked wallet's keys stop working", (await call('/api/tracker/history?chain=robinhood&ticker=NVDA', { auth: liveSecret, useCookie: false })).status === 401)
    check('a blocked wallet is signed out', (await call('/api/developer/account')).status === 401)
    const mb = await message()
    check('a blocked wallet cannot sign in', (await post('/api/developer/siwe', { message: mb, signature: await account.signMessage({ message: mb }) }, { useCookie: false })).status === 403)
    await admin(`/api/admin/accounts/${account.address.toLowerCase()}/unblock`, 'POST')
    check('unblocking restores the keys', (await call('/api/tracker/history?chain=robinhood&ticker=NVDA', { auth: liveSecret, useCookie: false })).status === 200)
    const k2 = extra[1].data.key.id
    await admin(`/api/admin/keys/${k2}/revoke`, 'POST')
    check('admin revokes a single key', (await call('/api/tracker/history?chain=robinhood&ticker=NVDA', { auth: extra[1].data.secret, useCookie: false })).status === 401)
    const m7 = await message()
    const again = await post('/api/developer/siwe', { message: m7, signature: await account.signMessage({ message: m7 }) }, { useCookie: false })
    client.cookie = (again.headers.get('set-cookie') ?? '').split(';')[0]
  } else console.log('SKIP  admin checks (set ADMIN_TOKEN to the server token)')

  const out = await post('/api/developer/logout')
  check('logout clears the cookie', out.status === 200 && /Max-Age=0/.test(out.headers.get('set-cookie') ?? ''))
  check('the session is gone after logout', (await call('/api/developer/account')).status === 401)
}

/* ---------------------------------------- SIWE domain per host (the app only) --- */

// The app (app.gullylabs.xyz) accepts SIWE for its own domain only and sets a __Host- session cookie. The
// retired developers.* host accepts none.
for (const host of ['app.gullylabs.xyz']) {
  const w = privateKeyToAccount(generatePrivateKey())
  const ok = await hostSignIn(BASE, host, w)
  const cookie = String(ok.headers['set-cookie'] ?? '')
  check(`${host}: SIWE for its own domain signs in`, ok.status === 200 && ok.data?.address === w.address.toLowerCase(), ok.data?.error)
  check(`${host}: the session cookie is __Host-, Secure, host-only`, /^__Host-gl_dev=/.test(cookie) && /; Secure/.test(cookie) && /Path=\//.test(cookie) && !/Domain=/i.test(cookie), cookie.replace(/=[^;]+/, '=…'))
  const acc = await hostRequest(BASE, host, '/api/developer/account', { headers: { cookie: cookie.split(';')[0] } })
  check(`${host}: the session reads the account there`, acc.status === 200 && acc.data?.address === w.address.toLowerCase())
  const other = 'developers.gullylabs.xyz'
  const cross = await hostSignIn(BASE, host, w, { domain: other })
  check(`${host}: a message signed for ${other} is refused`, cross.status === 401, cross.data?.error)
}
{
  const w = privateKeyToAccount(generatePrivateKey())
  const main = await hostSignIn(BASE, 'gullylabs.xyz', w)
  check('the main site refuses sign-in and names the app', main.status === 400 && /app\.gullylabs\.xyz/.test(main.data?.error ?? ''), main.data?.error)
}

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
