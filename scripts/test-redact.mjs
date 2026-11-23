import { test } from 'node:test'
import assert from 'node:assert/strict'
import { redact, scrubForModel, redactEntry } from '../server/redact.mjs'

const hex = 'ab'.repeat(32)
const addr = '0x' + 'cd'.repeat(20)
test('keeps public chain data, masks personal data', () => {
  const r = redact(`send to ${addr} tx 0x${hex} mail jane.doe@gmail.com from 203.0.113.77`)
  assert.ok(r.text.includes(addr))
  assert.ok(r.text.includes('0x' + hex))
  assert.ok(!r.text.includes('jane.doe'))
  assert.ok(r.text.includes('203.0.113.0'))
  assert.ok(r.count >= 2)
})
test('keys, tokens and urls', () => {
  const t = redact(`my private key: 0x${hex} and ${hex} Authorization Bearer abcdefghijklmnop1234 https://x.test/a?token=SECRET123&b=1 ghp_${'A'.repeat(36)} 12345678:AA${'b'.repeat(33)}`).text
  assert.ok(!t.includes(hex))
  assert.ok(!t.includes('SECRET123'))
  assert.ok(!t.includes('abcdefghijklmnop1234'))
  assert.ok(t.includes('b=1'))
  assert.ok(!t.includes('ghp_'))
})
test('phones masked, short numbers and amounts kept', () => {
  assert.ok(redact('call +1 415 555 0132 now').text.includes('[phone removed]'))
  assert.equal(redact('block 19404777 price 1,234.56').text, 'block 19404777 price 1,234.56')
})
test('model scrub blocks private keys and phrases, passes normal questions', () => {
  assert.equal(scrubForModel('what is the fee on Base?').blocked, false)
  assert.equal(scrubForModel(`my private key is 0x${hex}`).blocked, true)
  assert.equal(scrubForModel('seed phrase: ' + 'apple '.repeat(11) + 'zebra').blocked, true)
  assert.equal(scrubForModel(`tx 0x${hex} failed`).blocked, false)
  assert.ok(!scrubForModel('mail me jane@corp.io').text.includes('jane@'))
})
test('entries: secret-named fields dropped, text fields redacted', () => {
  const e = redactEntry({ question: 'hi jane@corp.io', token: 'x', channel: 'web' })
  assert.equal(e.token, undefined)
  assert.ok(!e.question.includes('jane@'))
  assert.equal(e.channel, 'web')
})
