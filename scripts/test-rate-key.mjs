import test from 'node:test'
import assert from 'node:assert/strict'
import { rateKey } from '../server/http.mjs'

test('IPv4 is kept, IPv6 buckets on the /64', () => {
  assert.equal(rateKey('203.0.113.9'), '203.0.113.9')
  assert.equal(rateKey('::ffff:203.0.113.9'), '203.0.113.9')
  const a = rateKey('2001:db8:1:2:aaaa:bbbb:cccc:dddd')
  assert.equal(a, '2001:0db8:0001:0002::/64')
  assert.equal(rateKey('2001:db8:1:2::1'), a)
  assert.equal(rateKey('2001:DB8:1:2:ffff:ffff:ffff:ffff'), a)
  assert.notEqual(rateKey('2001:db8:1:3::1'), a)
  assert.equal(rateKey('unknown'), 'unknown')
})
