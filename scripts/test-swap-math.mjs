// Swap card maths (src/components/swap/swapMath.ts; node strips the types). Run: npm run test:swap-math
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { impactBlocks, impactLevel, parseSlippage, pctAmount, SOL_RESERVE, swapCta, toInput, toRaw } from '../src/components/swap/swapMath.ts'

test('25/50/75/Max with decimals, floored', () => {
  const usdc = toRaw('10.000003', 6)
  assert.equal(toInput(pctAmount(usdc, 25), 6), '2.5')
  assert.equal(toInput(pctAmount(usdc, 50), 6), '5.000001')
  assert.equal(toInput(pctAmount(usdc, 75), 6), '7.500002')
  assert.equal(toInput(pctAmount(usdc, 100), 6), '10.000003')
  const x = toRaw('1.23456789', 8)
  assert.equal(toInput(pctAmount(x, 75), 8), '0.92592591')
})

test('Max keeps SOL for fees and rent, never negative', () => {
  const sol = toRaw('0.5', 9)
  assert.equal(toInput(pctAmount(sol, 100, SOL_RESERVE), 9), '0.49')
  assert.equal(toInput(pctAmount(sol, 25, SOL_RESERVE), 9), '0.125')
  assert.equal(pctAmount(toRaw('0.005', 9), 100, SOL_RESERVE), 0n)
  assert.equal(toInput(pctAmount(toRaw('0.012', 9), 75, SOL_RESERVE), 9), '0.002')
})

test('raw <-> input text', () => {
  assert.equal(toRaw('1.5', 9), 1_500_000_000n)
  assert.equal(toRaw('1.1234567', 6), null)
  assert.equal(toRaw('0', 6), null)
  assert.equal(toInput(1n, 9), '0.000000001')
})

test('price impact levels and the 15 % block', () => {
  assert.equal(impactLevel(null), 'unknown')
  assert.equal(impactLevel(0.5), 'low')
  assert.equal(impactLevel(1), 'warn')
  assert.equal(impactLevel(5), 'high')
  assert.equal(impactLevel(15), 'blocked')
  assert.equal(impactBlocks(20, false), true)
  assert.equal(impactBlocks(20, true), false)
})

test('slippage parsing, capped at the proxy limit (5 %)', () => {
  assert.equal(parseSlippage('0.3'), 30)
  assert.equal(parseSlippage('2.5%'), 250)
  assert.equal(parseSlippage('5'), 500)
  assert.equal(parseSlippage('5.1'), null)
  assert.equal(parseSlippage('0'), null)
})

test('main button order', () => {
  const ok = { connected: true, hasAmount: true, insufficient: false, symbolIn: 'USDC', quote: 'ok', impactPct: 0.2, expert: false, busy: false, side: 'buy' }
  assert.equal(swapCta({ ...ok, connected: false }).action, 'connect')
  assert.equal(swapCta({ ...ok, hasAmount: false }).label, 'Enter an amount')
  assert.equal(swapCta({ ...ok, insufficient: true }).label, 'Insufficient USDC balance')
  assert.equal(swapCta({ ...ok, quote: 'loading' }).disabled, true)
  assert.equal(swapCta({ ...ok, impactPct: 16 }).label, 'Price impact too high')
  assert.deepEqual(swapCta({ ...ok, impactPct: 16, expert: true }), { label: 'Buy anyway', disabled: false, action: 'swap', tone: 'danger' })
  assert.equal(swapCta({ ...ok, side: 'sell' }).label, 'Review sell')
})

test('quote proxy: the requested slippage is 1 to 500 bps, else the 50 bps default', async () => {
  const { slippageFrom, SLIPPAGE_BPS } = await import('../server/jupiter.mjs')
  assert.equal(slippageFrom('30'), 30)
  assert.equal(slippageFrom('500'), 500)
  assert.equal(slippageFrom('501'), SLIPPAGE_BPS)
  assert.equal(slippageFrom('0'), SLIPPAGE_BPS)
  assert.equal(slippageFrom('2.5'), SLIPPAGE_BPS)
  assert.equal(slippageFrom(null), SLIPPAGE_BPS)
})
