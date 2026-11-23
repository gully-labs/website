import test from 'node:test'
import assert from 'node:assert/strict'
import { publicOrigin } from '../server/ipfs-pins.mjs'

test('public origins pass, internal ones are dropped', () => {
  for (const o of ['/ip4/8.8.8.8/tcp/4001', '/dns4/node.example.com/tcp/4001', '/ip6/2606:4700::1/tcp/4001']) assert.equal(publicOrigin(o), true, o)
  for (const o of ['/ip4/10.0.0.1/tcp/1', '/ip4/100.64.1.1/tcp/1', '/ip4/172.20.0.2/tcp/1', '/ip4/192.168.1.1/tcp/1', '/ip4/127.0.0.1/tcp/1', '/ip4/169.254.169.254/tcp/80',
    '/dns4/gully-ipfs/tcp/5001', '/dns/foo.internal/tcp/1', '/dns4/localhost/tcp/1', '/dns4/127.0.0.1/tcp/1', '/ip6/::1/tcp/1', '/ip6/::ffff:127.0.0.1/tcp/1', '/ip6/fd00::1/tcp/1']) assert.equal(publicOrigin(o), false, o)
})
