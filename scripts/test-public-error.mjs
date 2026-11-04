// publicError (server/http.mjs): upstream errors sent to browsers carry no URL, key, host, IP or path.
// Leak sweep 2026-11-02: /api/tracker*, /api/stats, /api/peddles/onchain and the Safe deploy RPC fault used to answer
// with String(err.message), and viem puts the full RPC URL (with any provider key in it) into its messages.
//   npm run test:public-error
import test from 'node:test'
import assert from 'node:assert/strict'
import { publicError } from '../server/http.mjs'

const FALLBACK = 'An upstream data source is unavailable right now. Try again shortly.'
const quiet = (fn) => {
  const e = console.error
  console.error = () => {}
  try {
    return fn()
  } finally {
    console.error = e
  }
}
const pe = (err, fb) => quiet(() => publicError(err, fb))

test('a viem HTTP error with the RPC URL and key never reaches the client', () => {
  const err = new Error('HTTP request failed.\n\nStatus: 401\nURL: https://lb.drpc.org/ogrpc?network=base&dkey=AbCdEf0123456789AbCdEf0123456789\nRequest body: {}')
  err.shortMessage = 'HTTP request failed.'
  const out = pe(err)
  assert.equal(out, 'HTTP request failed.')
  assert.doesNotMatch(out, /drpc|dkey|https?:/)
})

test('URLs, IPs, host:port, paths, long tokens and errno details fall back to the generic text', () => {
  for (const m of [
    'fetch failed: https://api.peddleswap.xyz/v1/stats?key=1',
    'connect ECONNREFUSED 10.0.0.12:8545',
    'getaddrinfo ENOTFOUND indexer.internal',
    'upstream indexer.gullychain.xyz:42069 timed out',
    "ENOENT: no such file or directory, open '/srv/data/tracker-history.json'",
    'bad token ' + ['sk', 'live', 'Z'.repeat(28) + '9'.repeat(6)].join('_'), // built at run time: a fake, not a key
    'socket hang up from fe80::1:2:3',
    'user@host refused',
    'x'.repeat(161),
  ]) {
    assert.equal(pe(new Error(m)), FALLBACK, m)
  }
})

test('a short plain message passes, and the caller can choose the fallback', () => {
  assert.equal(pe(new Error('Stats are rebuilding')), 'Stats are rebuilding')
  assert.equal(pe('HTTP 503'), 'HTTP 503')
  assert.equal(pe(new Error('connect ETIMEDOUT 1.2.3.4:443'), 'The chain RPC did not answer. Try again shortly.'), 'The chain RPC did not answer. Try again shortly.')
  assert.equal(pe(undefined), FALLBACK)
})
