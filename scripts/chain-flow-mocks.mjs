// Fakes for the Create a chain tests (test-chain-orders.mjs, e2e-chain-flow.mjs). No real money and no outside call:
// a fake Gully ID profile endpoint, a fake Gully Pay API that opens checkout sessions, and a signed webhook sender.

import crypto from 'node:crypto'
import http from 'node:http'

export const GP = { merchantId: '11111111-1111-4111-8111-111111111111', storeId: '22222222-2222-4222-8222-222222222222', apiKey: 'rk_' + 'a'.repeat(48), secret: crypto.randomBytes(32).toString('hex') }

const listen = (server) => new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)))

/** Gully ID: GET /v1/profile answers by token. tokens: { [token]: { sub, address } }. */
export async function fakeGullyId(tokens) {
  const server = http.createServer((req, res) => {
    const t = String(req.headers.authorization ?? '').replace(/^Bearer /, '')
    const who = tokens[t]
    res.writeHead(who ? 200 : 401, { 'content-type': 'application/json' })
    res.end(JSON.stringify(who ? { sub: who.sub, client: 'gully-labs', wallet: { address: who.address } } : { error: 'no' }))
  })
  const port = await listen(server)
  return { url: `http://localhost:${port}`, close: () => server.close() }
}

/** Gully Pay: POST /checkout/hosted/:store opens a session; GET /<session> is a bare checkout page for the browser test. */
export async function fakeGullyPay() {
  const sessions = []
  const state = { failNext: false, delayMs: 0 }
  const server = http.createServer((req, res) => {
    let raw = ''
    req.on('data', (c) => (raw += c))
    req.on('end', async () => {
      const m = /^\/checkout\/hosted\/(.+)$/.exec(req.url ?? '')
      if (req.method === 'POST' && m) {
        if (state.delayMs) await new Promise((r) => setTimeout(r, state.delayMs))
        const okAuth = req.headers.authorization === `Bearer ${GP.apiKey}` && m[1] === GP.storeId
        if (!okAuth || state.failNext) {
          state.failNext = false
          res.writeHead(okAuth ? 500 : 401, { 'content-type': 'application/json' })
          return res.end('{"error":"no"}')
        }
        const b = JSON.parse(raw)
        const s = { sessionId: crypto.randomUUID(), expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(), ...b }
        sessions.push(s)
        res.writeHead(201, { 'content-type': 'application/json' })
        return res.end(JSON.stringify({ sessionId: s.sessionId, expiresAt: s.expiresAt }))
      }
      res.writeHead(200, { 'content-type': 'text/html' })
      res.end('<!doctype html><title>Gully Pay test checkout</title><h1>Gully Pay test checkout</h1>')
    })
  })
  const port = await listen(server)
  return { url: `http://localhost:${port}`, sessions, state, close: () => server.close() }
}

/** A checkout.session.* event body as Gully Pay's docs show it. */
export function sessionEvent(type, session, over = {}, eventId = crypto.randomUUID()) {
  return {
    id: eventId,
    type,
    created: new Date().toISOString(),
    data: { object: { object: 'checkout.session', id: session.sessionId, status: 'completed', storeId: GP.storeId, merchantId: GP.merchantId, amount: session.amount, currency: 'USD', clientReferenceId: session.clientReferenceId, paymentMethod: 'crypto', crypto: { chain: 'gully-chain-testnet', token: 'USDC', txHash: '0x' + 'a'.repeat(64) }, occurredAt: new Date().toISOString(), ...over } },
  }
}

export const signature = (raw, key, t = Math.floor(Date.now() / 1000)) => `t=${t},v1=${crypto.createHmac('sha256', key).update(`${t}.${raw}`).digest('hex')}`

/** Delivers an event to the webhook as Gully Pay does. `raw` and `sig` override, for tampering tests. */
export async function deliver(base, event, { key = GP.secret, t, raw = JSON.stringify(event), sig } = {}) {
  const r = await fetch(`${base}/api/chain-orders/webhook`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-gullypay-event': event.type, 'x-gullypay-event-id': event.id, 'x-gullypay-timestamped-signature': sig ?? signature(raw, key, t) }, body: raw })
  return { status: r.status, data: await r.json().catch(() => null) }
}
