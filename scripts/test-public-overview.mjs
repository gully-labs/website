// The Gully Labs App signed out (owner, 2026-11-09: every Gully app is public by default): the public Overview shows
// live status and charts of the services Gully Labs runs, from public endpoints only, beside the sign-in card; the
// account pages stay behind sign-in. Source checks (no build): npm run test:public-overview
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')
const pub = read('src/pages/developers/PublicOverview.tsx')
const dev = read('src/pages/developers/DevelopersPage.tsx')

test('signed out, the app renders the public Overview beside the sign-in card (Gully ID first, wallet under it)', () => {
  assert.ok(dev.includes("import { PublicOverview } from './PublicOverview'"))
  const out = dev.slice(dev.indexOf("session.state === 'out' &&"), dev.indexOf("session.state === 'error'"))
  assert.ok(out.includes('<PublicOverview />') && out.includes('<SignedOut '), 'both on the signed-out page')
  assert.ok(out.includes('data-testid="signed-out-home"'))
  assert.ok(dev.includes('data-testid="signed-out"') && dev.includes('data-testid="connect-wallet"') && dev.includes('<GullyIdButton onClick={gully}'), 'the sign-in card keeps its ids')
  assert.ok(dev.includes('order-first lg:order-last'), 'phones: the sign-in card first; wide screens: the overview first, the card at the side')
})

test('the public Overview reads public endpoints only and shows no account data', () => {
  const urls = [...pub.matchAll(/usePoll<[^>]*>\('([^']+)'/g)].map((m) => m[1])
  assert.deepEqual(urls.sort(), ['/api/hub', '/api/hub/live', '/api/hub/products'])
  const code = pub.replace(/\/\*[\s\S]*?\*\//g, '')
  assert.ok(!/\/api\/developer\//.test(code), 'no /api/developer read')
  assert.ok(!/account|billing|apiKey|secret/i.test(pub.replace(/\/\*[\s\S]*?\*\//g, '').replace(/Sign in to see your own keys, usage, billing and team\./, '')), 'no account words in the code')
})

test('it is live: Gully Live UI stat tiles and charts with honest empty lines, the Labs services with their state', () => {
  assert.ok(pub.includes('<LiveStat ') && (pub.match(/<LiveChart /g) || []).length >= 2)
  assert.ok(/label="SURFACES ANSWERING"[^\n]*unit="percent"/.test(pub), 'the share of surfaces answering is a Live UI percent tile (1.0.4 unit="percent": 92.3%, no sign)')
  assert.ok(/empty=\{/.test(pub) && !/empty=""/.test(pub), 'every chart names what an empty series means')
  assert.ok(pub.includes("filter((s) => s.group === 'labs')"), 'the services Gully Labs runs')
  assert.ok(pub.includes('data-testid="public-overview"') && pub.includes('data-testid="public-kpis"') && pub.includes('data-testid="public-services"'))
  assert.ok(pub.includes('rel="noopener noreferrer"') && pub.includes('(opens in a new tab)'), 'external links open in a new tab and say so')
})
