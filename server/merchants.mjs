// Gully Pay for merchants: any workspace can run its own non-custodial crypto checkout. Payers send a
// plain transfer straight to the MERCHANT's own receiving wallet on the chosen chain; Gully Labs never
// holds the funds. We read the payment back from the chain with exactly the same checks as our own
// billing (billing.mjs checkTx: exact quoted amount, the quote's chain and asset, mined inside the quote,
// the chain's confirmations, and a chainId:hash never used before ANYWHERE: our own plans and invoices
// and every merchant share one spent-hash set). A transfer to any other address, our treasury included,
// never counts for the merchant.
//
// We earn a transaction fee only (no monthly fee): merchant-fees.mjs holds the arithmetic. Fees accrue per
// confirmed payment at its quoted USD value after each workspace's lifetime free allowance; every Monday
// 00:00 UTC each merchant owing at least $1 gets a fee statement, which is a normal Gully Labs invoice
// (invoices.mjs) paid through the normal Gully Pay checkout into GULLY_TREASURY_ADDRESS. Unpaid 7 days after
// issue, the merchant's checkouts pause (new quotes and new link checkouts are refused; a quote already
// given can still be verified, the money having gone to the merchant). Warnings at issue, day 5 and day 7
// (activity events, plus Telegram when the owner linked a chat). Paying the statement resumes checkout at
// once: the pause is derived from the statement invoices' state on every read, never stored.
//
// Fee at payment time: a stablecoin quote on a chain with Request Network's ERC20FeeProxy (payments.mjs
// withFeeSplit) carries a split, so a wallet payment sends the store its share and Gully Labs' fee to
// GULLY_TREASURY_ADDRESS in one transaction. The fee is sized like accrue(): only the part of the payment above
// the store's remaining free allowance, so a fully free payment has no split. When the proxy's event is read
// back (fee to the treasury only), the fee row records what was collected on chain (never more than accrued) and
// the weekly statement bills only the rest. A plain transfer (QR, copy and paste) or a coin payment is billed
// in full as before. Collected + billed = accrued, in micro-USD, exactly; nothing is billed twice or refunded.
//
// Storage: DATA_DIR/merchants.json (tmp + rename)
//   merchants:  { [workspace]: { profile: { name, accent, supportEmail, website, logo: { sha, type, bytes, source, fetchedAt } | null },
//                                wallets: { [chainId]: { address (EIP-55), declared: 'eoa'|'contract', kind: 'eoa'|'eoa-7702'|'contract'|'undeployed',
//                                                        enabled, status: 'ok'|'not-deployed', checkedAt } },
//                                webhook: { url, secret, createdAt, rotatedAt } | null, terms: { version, acceptedAt, acceptedBy } | null,
//                                invoiceSeq, createdAt, updatedAt } }
//   links:      [{ id: 'ml_…', ws, title, description, amount: fixed|open, assets, active, expiresAt, maxUses, paidUses, lastPaidAt, views, createdAt, updatedAt }]
//   invoices:   [{ id: 'mi_…', ws, number, title, items: [{ description, quantity, unitCents }], usdCents, customer: { name, email },
//                  notes, dueAt, expiresAt, assets, linkId, views, firstViewedAt, createdAt, cancelledAt, paidAt, paymentId, expiredEventAt }]
//   quotes:     [{ id: 'q_…', kind: 'merchant', ws, invoiceId, assetId, chainId, symbol, decimals, usdCents, tag, amountRaw, minRaw,
//                  treasury: <the merchant's wallet on that chain>, price, createdAt, expiresAt, paidAt }]
//   payments:   [{ id, kind: 'merchant', ws, invoiceId, linkId, txHash, chainId, assetId, symbol, decimals, amountRaw, usdCents, price,
//                  quoteId, from, to, blockNumber, at, feeMicros, feeRaw?, collectedMicros? }]   (feeRaw: the fee the proxy took, token units)
//   fees:       [{ id, ws, paymentId, at, volumeCents, freeCents, feeableCents, bps, feeMicros, collectedMicros, onchain, statementId }]
//                  (micro-USD, exact; a statement bills feeMicros - collectedMicros, the part not collected on chain)
//   statements: [{ id: 'st_…', ws, number, periodStart, periodEnd, feeIds, feeMicros (billed), collectedMicros (of the same rows, on chain), usdCents, volumeCents, payments, invoiceId,
//                  issuedAt, dueAt, warned: { issue, day5, day7 }, paidAt }]
//   lastStatementRun: iso
//
// Portal API (developer.mjs gate: session, CSRF, workspace and role; see workspaces.mjs for who may write):
//   GET  /api/developer/merchant                        everything the Merchant tab shows
//   GET  /api/developer/merchant/stats?range=30d|90d|365d
//   GET  /api/developer/merchant/export/payments.csv
//   POST /api/developer/merchant/profile                { name, logoUrl?, accent?, supportEmail?, website? }
//   POST /api/developer/merchant/wallets                { address, type: 'eoa'|'contract', chains: number[], acceptTerms? }  -> per-chain results
//                                                       (the first one needs acceptTerms: true; the version and wallet are recorded)
//   POST /api/developer/merchant/wallets/:chainId       { enabled }  |  …/:chainId/check  |  …/:chainId/remove
//   POST /api/developer/merchant/links                  { title, description?, amount, assets?, expiresAt?, maxUses? }
//   POST /api/developer/merchant/links/:id              any create field, or { active }
//   POST /api/developer/merchant/invoices               { items, dueDate, customer?, notes?, number?, title?, assets? }
//   POST /api/developer/merchant/invoices/:id/cancel
//   POST /api/developer/merchant/webhook                { url | null } -> { secret? } shown once
//   POST /api/developer/merchant/webhook/rotate | test,  POST /api/developer/merchant/webhook/deliveries/:id/redeliver
// Public API (handlePay in invoices.mjs forwards /api/pay/m/*):
//   GET  /api/pay/m/config                              fee rate and free allowance (the docs chart reads it)
//   GET  /api/pay/m/i/:id   POST /api/pay/m/i/:id/quote { asset }   POST /api/pay/m/i/:id/verify { quoteId, txHash }
//   GET  /api/pay/m/l/:id   POST /api/pay/m/l/:id/invoice { usd?, asset? }
//   GET  /api/pay/m/logo/:sha                           the merchant's logo, fetched once when saved (never hot-linked)
// Admin API (admin.mjs forwards /api/admin/merchants*):
//   GET  /api/admin/merchants      POST /api/admin/merchants/statements/run
//
// Env: GULLY_PAY_MERCHANT_FEE_BPS (50), GULLY_PAY_MERCHANT_FREE_USD (5000), GULLY_MERCHANT_TICK_MS (600000; 0 = off, tests drive it)

import crypto from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import https from 'node:https'
import path from 'node:path'
import { recordEvent } from './activity.mjs'
import { checkWebhookForm, resolvePublic } from './alerts.mjs'
import { badHash, checkTx, externalHashUsed, hashUsed, isHash, ledger, normHash, paymentView, QUOTE_GRACE_MS, QUOTE_TTL_MS, quoteView, save as saveLedger } from './billing.mjs'
import { toCsv } from './exports.mjs'
import { clientIp, DATA_DIR, json, readJson } from './http.mjs'
import { createInvoiceRecord, invoicePaidHooks, invoiceStatus } from './invoices.mjs'
import { accrue, centsOfMicros, feeConfig, MIN_STATEMENT_CENTS, PAUSE_AFTER_DAYS, WARN_DAY, weekStart } from './merchant-fees.mjs'
import { checkEndpoint, deliveries, endpointView, enqueue, makeEndpoint, newSecret, paidEvent, redeliver, registerWebhookTarget, sendTest } from './pay-webhooks.mjs'
import { addressUrl, assetById, ASSET_IDS, CHAIN_LIST, CHAINS, checksumAddress, fmtUsd, MAX_TAG, parseUsdCents, publicAssets, quoteAmount, readFeed, rpc, withFeeSplit } from './payments.mjs'
import { treasury } from './plans.mjs'
import { isSolanaAsset } from './solana-pay.mjs'
import { getAccount, randomToken } from './store.mjs'
import { sendAccountTelegram } from './telegram.mjs'
import { canWrite, roleIn, workspaceName } from './workspaces.mjs'

const FILE = path.join(DATA_DIR, 'merchants.json')
const LOGO_DIR = path.join(DATA_DIR, 'merchant-logos')
const SITE = (process.env.GULLY_SITE_URL ?? 'https://gullylabs.xyz').replace(/\/+$/, '')
export const NON_CUSTODIAL = 'Non-custodial: payments go directly to your wallet. Gully Labs never holds your funds.'
export const PAUSED_TEXT = "This store's checkout is paused."
/** The merchant terms in force (src/pages/legal/MerchantTerms.tsx, /legal/merchant-terms). A store accepts them with its first wallet. */
export const MERCHANT_TERMS_VERSION = '2026-10-17'
export const MERCHANT_TERMS_PATH = '/legal/merchant-terms'

const INVOICE_RE = /^mi_[A-Za-z0-9_-]{22}$/
const LINK_RE = /^ml_[A-Za-z0-9_-]{16}$/
const ADDR_RE = /^0x[0-9a-fA-F]{40}$/
const EMAIL_RE = /^[^@\s<>"]{1,64}@[^@\s<>"]{1,190}\.[^@\s<>"]{2,24}$/
const NUMBER_RE = /^[A-Za-z0-9][A-Za-z0-9 ._/#-]{0,31}$/
const HEX_RE = /^#[0-9a-fA-F]{6}$/
const MAX_TITLE = 120
const MAX_TEXT = 1_000
const MAX_ITEMS = 50
const MAX_CENTS = 100_000_000n * 100n
/** A link's checkout (one invoice per payer) stays open this long, like Gully Labs' own links. */
export const LINK_INVOICE_TTL_MS = 60 * 60_000
/** An invoice stays payable this long after its due date (overdue in between), then expires. */
export const OVERDUE_GRACE_DAYS = 30
const QUOTE_RETAIN_MS = 7 * 86_400_000
const LOGO_MAX_BYTES = 256 * 1024
const EXPIRED_LOOKBACK_MS = 24 * 3_600_000
const DAY = 86_400_000
// Stores take the EVM chains for now (their receiving wallets are EVM addresses); Solana stays Gully Labs' own.
const STORE_ASSET_IDS = ASSET_IDS.filter((id) => !isSolanaAsset(assetById(id)))
const STORE_CHAIN_IDS = new Set(CHAIN_LIST.map((c) => c.id))
const storeAssets = () => publicAssets().filter((a) => STORE_CHAIN_IDS.has(a.chainId))

/* ---------------------------------------------------------------- store --- */

let db
try {
  db = JSON.parse(fs.readFileSync(FILE, 'utf8'))
  if (!db || typeof db !== 'object' || Array.isArray(db)) db = {}
} catch {
  db = {}
}
db.merchants ??= {}
db.links ??= []
db.invoices ??= []
db.quotes ??= []
db.payments ??= []
db.fees ??= []
db.statements ??= []
db.lastStatementRun ??= null

function save() {
  fs.mkdirSync(path.dirname(FILE), { recursive: true })
  fs.writeFileSync(FILE + '.tmp', JSON.stringify(db))
  fs.renameSync(FILE + '.tmp', FILE)
}
// Page views (conversion) are saved a moment later, so a busy checkout does not write on every read.
let saveTimer = null
const saveSoon = () => {
  saveTimer ??= setTimeout(() => {
    saveTimer = null
    try {
      save()
    } catch (e) {
      console.error('merchants save:', e?.message ?? e)
    }
  }, 2_000)
  saveTimer.unref?.()
}

/** Test hook: the stored data, as on disk. */
export const merchantsDbForTest = () => db

const usedKey = (chainId, hash) => `${chainId}:${hash}`
// One transaction pays for one thing, across merchants and our own billing (billing.mjs reads this too).
externalHashUsed.push((chainId, hash) => db.payments.some((p) => usedKey(p.chainId, p.txHash) === usedKey(chainId, hash)))
// Merchant webhook deliveries go through pay-webhooks.mjs's queue, signed with the workspace's own secret.
registerWebhookTarget('merchant', (ws) => db.merchants[ws]?.webhook ?? null)

function merchantOf(ws) {
  let m = db.merchants[ws]
  if (!m) {
    const now = new Date().toISOString()
    m = db.merchants[ws] = { profile: { name: null, accent: null, supportEmail: null, website: null, logo: null }, wallets: {}, webhook: null, invoiceSeq: 0, createdAt: now, updatedAt: now }
  }
  return m
}
const peek = (ws) => db.merchants[ws] ?? null

/* -------------------------------------------------------------- helpers --- */

const hits = new Map()
function allow(bucket, who, max, ms) {
  const k = `${bucket}:${who}`
  const now = Date.now()
  const list = (hits.get(k) ?? []).filter((t) => now - t < ms)
  if (list.length >= max) return hits.set(k, list), false
  list.push(now)
  hits.set(k, list)
  return true
}
setInterval(() => {
  const now = Date.now()
  for (const [k, list] of hits) if (!list.some((t) => now - t < 3_600_000)) hits.delete(k)
}, 600_000).unref?.()

const bad = (error) => ({ ok: false, status: 400, error })
const centsOk = (c) => c != null && c <= MAX_CENTS
const usdNum = (cents) => Number(BigInt(cents)) / 100
const sum = (list, f) => list.reduce((a, x) => a + BigInt(f(x)), 0n)
/** A workspace's lifetime volume so far (cents): the priorCents of its next payment's fee. */
const volumeOf = (ws) => sum(db.payments.filter((x) => x.ws === ws), (x) => x.usdCents)
/** Micro-USD to a stablecoin's base units and back, at 1:1 (store stablecoins have 6 or 18 decimals: exact). */
const microsToRaw = (m, d) => (d >= 6 ? BigInt(m) * 10n ** BigInt(d - 6) : BigInt(m) / 10n ** BigInt(6 - d))
const rawToMicros = (r, d) => (d >= 6 ? BigInt(r) / 10n ** BigInt(d - 6) : BigInt(r) * 10n ** BigInt(6 - d))
/** What a fee row still bills: its accrued fee less what the fee proxy collected on chain (never below 0). */
const collectedOf = (f) => BigInt(f.collectedMicros ?? '0')
const billableOf = (f) => {
  const b = BigInt(f.feeMicros) - collectedOf(f)
  return b > 0n ? b : 0n
}

/** Error copy from the shared payment checks, worded for a store's payer instead of Gully Labs' own. */
const forStore = (msg) =>
  String(msg ?? '')
    .replace(/not to the Gully Labs treasury address/g, "not to this store's wallet")
    .replace(/the Gully Labs treasury/g, "this store's wallet")
    .replace(/to the treasury/g, "to this store's wallet")
    .replace(/Write to hello@gullylabs\.xyz with the hash( to settle the difference)?/g, 'Contact the store with the transaction hash')
    .replace(/write to hello@gullylabs\.xyz with the hash/g, 'contact the store with the transaction hash')
    .replace(/your checkout/g, 'this checkout')

/* -------------------------------------------------------- the fee state --- */

/** Statement state from its Gully Labs invoice: paid, waived (an admin cancelled it), overdue or open. */
function statementState(st, now = Date.now()) {
  const inv = ledger().invoices.find((i) => i.id === st.invoiceId)
  if (st.paidAt || inv?.paymentId) return 'paid'
  if (inv?.cancelledAt) return 'waived'
  return now >= Date.parse(st.dueAt) ? 'overdue' : 'open'
}

/** Whether a workspace's checkouts are paused, and why. Derived on every read: paying resumes at once. */
export function pauseOf(ws, now = Date.now()) {
  const overdue = db.statements.filter((s) => s.ws === ws && statementState(s, now) === 'overdue')
  if (!overdue.length) return { paused: false, statements: [] }
  return { paused: true, since: overdue.map((s) => s.dueAt).sort()[0], statements: overdue.map((s) => s.id), usdCents: String(sum(overdue, (s) => s.usdCents)) }
}

function feesView(ws, now = Date.now()) {
  const cfg = feeConfig()
  const pays = db.payments.filter((p) => p.ws === ws)
  const lifetime = sum(pays, (p) => p.usdCents)
  const fees = db.fees.filter((f) => f.ws === ws)
  const unbilled = fees.filter((f) => !f.statementId)
  const issued = db.statements.filter((s) => s.ws === ws)
  const statements = db.statements
    .filter((s) => s.ws === ws)
    .map((s) => statementView(s, now))
    .reverse()
  const outstanding = statements.filter((s) => s.state === 'open' || s.state === 'overdue')
  const pause = pauseOf(ws, now)
  return {
    bps: cfg.bps,
    ratePct: cfg.bps / 100,
    freeUsd: usdNum(cfg.freeCents),
    lifetimeUsd: usdNum(lifetime),
    freeLeftUsd: usdNum(lifetime >= cfg.freeCents ? 0n : cfg.freeCents - lifetime),
    accruedUsd: usdNum(centsOfMicros(sum(fees, (f) => f.feeMicros))),
    // Accrued = collected on chain (fee proxy, at payment time) + billed (weekly statements) + not billed yet.
    collectedUsd: usdNum(centsOfMicros(sum(fees, collectedOf))),
    collectedPayments: fees.filter((f) => f.onchain).length,
    billedUsd: usdNum(sum(issued, (s) => s.usdCents)),
    unbilledUsd: usdNum(centsOfMicros(sum(unbilled, billableOf))),
    outstandingUsd: usdNum(sum(outstanding, (s) => s.usdCents)),
    paidUsd: usdNum(sum(statements.filter((s) => s.state === 'paid'), (s) => s.usdCents)),
    minStatementUsd: usdNum(MIN_STATEMENT_CENTS),
    pauseAfterDays: PAUSE_AFTER_DAYS,
    nextStatementAt: new Date(weekStart(now) + 7 * DAY).toISOString(),
    paused: pause.paused,
    pausedSince: pause.since ?? null,
    statements,
  }
}

function statementView(s, now = Date.now()) {
  const state = statementState(s, now)
  return { id: s.id, number: s.number, periodStart: s.periodStart, periodEnd: s.periodEnd, usd: fmtUsd(s.usdCents), usdCents: s.usdCents, volumeUsd: usdNum(s.volumeCents), payments: s.payments, invoiceId: s.invoiceId, payPath: `/pay/${s.invoiceId}`, issuedAt: s.issuedAt, dueAt: s.dueAt, paidAt: s.paidAt ?? null, state }
}

/* -------------------------------------------------------------- wallets --- */

/**
 * Checks one receiving wallet on one chain: EIP-55 checksum, not zero, not our own treasury, and what is
 * deployed there. A contract wallet (Safe, smart account) must be deployed on THAT chain before it can take
 * payments: a counterfactual address with no code can lose funds. An address that is a contract on another
 * of our chains but has no code here is refused the same way, whatever the merchant declared.
 */
export async function inspectWallet(chainId, raw, declared) {
  const c = STORE_CHAIN_IDS.has(chainId) ? CHAINS[chainId] : null
  if (!c) return bad(`Choose a chain: ${CHAIN_LIST.map((x) => `${x.id} (${x.name})`).join(', ')}.`)
  let a = String(raw ?? '').trim()
  if (!ADDR_RE.test(a)) return bad('That is not an EVM address (0x followed by 40 hex characters).')
  const body = a.slice(2)
  // All one case carries no checksum (many wallets and explorers copy it that way): accept it and store the
  // EIP-55 form. Mixed case must match its checksum exactly, which catches a mistyped character.
  const oneCase = body === body.toLowerCase() || body === body.toUpperCase()
  let sum
  try {
    sum = checksumAddress(a)
  } catch {
    return bad('That is not an EVM address.')
  }
  if (oneCase) a = sum
  else if (sum !== a) return bad('The EIP-55 checksum of this address does not match: one character is probably wrong. Copy it again from your wallet.')
  const lower = a.toLowerCase()
  if (/^0x0{40}$/.test(lower)) return bad('The zero address cannot receive payments.')
  if (lower === treasury()) return bad("That is Gully Labs' own treasury. Payments to it never count for a store: use a wallet you control.")
  if (declared !== 'eoa' && declared !== 'contract') return bad('type must be "eoa" (a normal wallet) or "contract" (a Safe or another smart account).')
  let code
  try {
    code = await rpc(chainId, 'eth_getCode', [lower, 'latest'])
  } catch (e) {
    return { ok: false, status: 502, error: `${c.name} could not be read just now (${String(e?.message ?? e)}). Try again in a minute.` }
  }
  if (typeof code !== 'string' || !/^0x[0-9a-fA-F]*$/.test(code)) return { ok: false, status: 502, error: `${c.name}'s node gave an unreadable answer. Try again in a minute.` }
  const has = code.length > 2
  if (has) {
    const delegated = /^0xef0100[0-9a-fA-F]{40}$/i.test(code)
    return { ok: true, address: sum, kind: delegated ? 'eoa-7702' : 'contract', status: 'ok', deployed: true }
  }
  // No code here. A contract elsewhere (or a declared contract) is not deployed on this chain yet.
  const others = await Promise.all(CHAIN_LIST.filter((x) => x.id !== chainId).map((x) => rpc(x.id, 'eth_getCode', [lower, 'latest']).then((v) => (typeof v === 'string' && v.length > 2 && !/^0xef0100/i.test(v) ? x : null), () => null)))
  const elsewhere = others.find(Boolean)
  if (declared === 'contract' || elsewhere) {
    const where = elsewhere ? ` It is a contract on ${elsewhere.name}, but` : ''
    return { ok: true, address: sum, kind: 'undeployed', status: 'not-deployed', deployed: false, error: `${where} no contract is deployed at this address on ${c.name}.`.trim() + ` Deploy your Safe or smart account on ${c.name} first, then check again: a payment to an undeployed contract address can be lost.` }
  }
  return { ok: true, address: sum, kind: 'eoa', status: 'ok', deployed: true }
}

function walletView(chainId, w) {
  const c = CHAINS[chainId]
  return { chainId: Number(chainId), chain: c?.name ?? String(chainId), chainKey: c?.key ?? null, address: w.address, declared: w.declared, kind: w.kind, enabled: !!w.enabled, status: w.status, checkedAt: w.checkedAt, explorerUrl: c ? addressUrl(Number(chainId), w.address) : null }
}

/** The merchant's wallet that receives on a chain right now (lower-case), or null. */
const recipientOn = (ws, chainId) => {
  const w = peek(ws)?.wallets?.[chainId]
  return w && w.enabled && w.status === 'ok' ? w.address.toLowerCase() : null
}

/* ------------------------------------------------------------- branding --- */

const MAGIC = [
  ['image/png', (b) => b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47],
  ['image/jpeg', (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff],
  ['image/gif', (b) => b.length > 6 && b.subarray(0, 4).toString('latin1') === 'GIF8'],
  ['image/webp', (b) => b.length > 12 && b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP'],
]

/**
 * Fetches a logo once (https, public addresses only and pinned to the checked one, 5 s, no redirects, at
 * most 256 KB, PNG/JPEG/GIF/WebP by their bytes; no SVG). Checkouts serve our copy, never the merchant's URL.
 */
export async function fetchLogo(raw) {
  if (String(raw ?? '').length > 500) return bad('The logo URL is too long (500 characters at most).')
  const form = checkWebhookForm(raw)
  if (!form.ok) return bad(form.error.replace(/webhook/gi, 'logo'))
  const target = await resolvePublic(form.url)
  if (!target.ok) return bad(target.error.replace(/webhook/gi, 'logo'))
  const u = form.url
  const lib = u.protocol === 'https:' ? https : http
  return new Promise((resolve) => {
    let done = false
    const finish = (r) => {
      if (done) return
      done = true
      clearTimeout(timer)
      resolve(r)
    }
    const req = lib.get(u, { headers: { 'user-agent': 'GullyLabs-Pay-Logo/1', accept: 'image/png,image/jpeg,image/webp,image/gif' }, lookup: (_h, opts, cb) => (opts?.all ? cb(null, [{ address: target.address, family: target.family }]) : cb(null, target.address, target.family)) }, (res) => {
      if (res.statusCode !== 200) {
        res.resume()
        return finish(bad(`The logo URL answered ${res.statusCode}${res.statusCode >= 300 && res.statusCode < 400 ? ' (redirects are not followed: give the final URL)' : ''}.`))
      }
      const declaredLen = Number(res.headers['content-length'])
      if (declaredLen > LOGO_MAX_BYTES) {
        res.destroy()
        return finish(bad(`The logo is too large: ${LOGO_MAX_BYTES / 1024} KB at most.`))
      }
      const parts = []
      let n = 0
      res.on('data', (d) => {
        n += d.length
        if (n > LOGO_MAX_BYTES) {
          res.destroy()
          finish(bad(`The logo is too large: ${LOGO_MAX_BYTES / 1024} KB at most.`))
        } else parts.push(d)
      })
      res.on('end', () => {
        const buf = Buffer.concat(parts)
        const type = MAGIC.find(([, test]) => test(buf))?.[0]
        if (!type) return finish(bad('The logo must be a PNG, JPEG, GIF or WebP image (SVG is not accepted).'))
        finish({ ok: true, buf, type })
      })
      res.on('error', () => finish(bad('The logo could not be downloaded.')))
    })
    const timer = setTimeout(() => {
      req.destroy()
      finish(bad('The logo URL took more than 5 seconds to answer.'))
    }, 5_000)
    req.on('error', (e) => finish(bad(`The logo could not be downloaded (${String(e?.message ?? e).slice(0, 120)}).`)))
  })
}

const logoPath = (logo) => (logo ? `/api/pay/m/logo/${logo.sha}` : null)

/** What a payer sees of the store. `named` is false until the merchant sets a store name: the checkout
    then says "Store" with the owner's short address instead of "<0x…>'s workspace". */
function brandOf(ws) {
  const p = peek(ws)?.profile ?? {}
  return { name: p.name || workspaceName(ws), named: !!p.name, ownerShort: `${ws.slice(0, 6)}…${ws.slice(-4)}`, logoUrl: logoPath(p.logo), accent: p.accent ?? null, supportEmail: p.supportEmail ?? null, website: p.website ?? null }
}

/** The address signed in to the portal on this request, or null (developer.mjs reads the cookie). */
async function viewerAddress(req) {
  if (!req.headers.cookie) return null
  const { sessionAddress } = await import('./developer.mjs')
  return sessionAddress(req)
}

/**
 * For a store member looking at their own checkout: the role and what to fix in the portal's Merchant
 * tab (section ids there), so a payer's dead end reads as a to-do for the owner. null for anyone else.
 */
async function viewerOf(req, ws, { inv = null, link = null } = {}) {
  const user = await viewerAddress(req)
  const role = user ? roleIn(user, ws) : null
  if (!role) return null
  const fixes = []
  const p = peek(ws)?.profile ?? {}
  const pause = pauseOf(ws)
  if (pause.paused) fixes.push({ id: 'fees', text: `Pay the overdue fee statement (${fmtUsd(pause.usdCents)} USD): checkout resumes at once.` })
  const wanted = (inv?.assets ?? link?.assets ?? STORE_ASSET_IDS).map(assetById).filter(Boolean)
  const chainsMissing = [...new Set(wanted.filter((a) => !recipientOn(ws, a.chainId)).map((a) => CHAINS[a.chainId]?.name ?? String(a.chainId)))]
  if (chainsMissing.length && chainsMissing.length === new Set(wanted.map((a) => a.chainId)).size) fixes.push({ id: 'wallets', text: `Add a receiving wallet on ${chainsMissing.join(', ')}.` })
  else if (chainsMissing.length) fixes.push({ id: 'wallets', text: `No receiving wallet yet on ${chainsMissing.join(', ')}; payers there cannot pay.` })
  if (link && !link.active) fixes.push({ id: 'links', text: 'Switch this payment link back on.' })
  if (!p.name) fixes.push({ id: 'profile', text: 'Finish your store profile: a name, a logo and a support email make this checkout yours.' })
  else if (!p.logo || !p.supportEmail) fixes.push({ id: 'profile', text: `Finish your store profile: add ${[!p.logo && 'a logo', !p.supportEmail && 'a support email'].filter(Boolean).join(' and ')}.` })
  return { role, fixes }
}

/* --------------------------------------------------------------- quotes --- */

function pruneQuotes() {
  const now = Date.now()
  const before = db.quotes.length
  db.quotes = db.quotes.filter((q) => !q.paidAt && Date.parse(q.expiresAt) + QUOTE_RETAIN_MS > now)
  return before !== db.quotes.length
}

/** A 20-minute quote to the merchant's wallet, with an amount unique among open quotes to that wallet in that asset. */
async function createQuote({ ws, invoiceId, asset, usdCents, recipient }) {
  let price = null
  if (asset.kind === 'native') {
    const f = await readFeed(asset.chainId)
    if (!f.ok) return { ...f, error: forStore(f.error) }
    price = f.price
  }
  pruneQuotes()
  const now = Date.now()
  const open = db.quotes.filter((q) => q.assetId === asset.id && q.treasury === recipient && !q.paidAt && Date.parse(q.expiresAt) + QUOTE_GRACE_MS > now)
  const tags = new Set(open.map((q) => q.tag))
  const amounts = new Set(open.map((q) => q.amountRaw))
  let pick = null
  for (let i = 0; i < 400 && !pick; i++) {
    const tag = 1 + crypto.randomInt(MAX_TAG)
    if (tags.has(tag)) continue
    const amt = quoteAmount(asset, BigInt(usdCents), tag, price)
    if (!amounts.has(String(amt.amount))) pick = { tag, ...amt }
  }
  if (!pick) return { ok: false, status: 503, error: 'Too many open quotes in this asset right now. Try another asset or try again in a few minutes.' }
  const q = { id: 'q_' + randomToken(12), kind: 'merchant', ws, invoiceId, assetId: asset.id, chainId: asset.chainId, symbol: asset.symbol, decimals: asset.decimals, usdCents: String(usdCents), tag: pick.tag, amountRaw: String(pick.amount), minRaw: String(pick.amount), treasury: recipient, price, createdAt: new Date(now).toISOString(), expiresAt: new Date(now + QUOTE_TTL_MS).toISOString(), paidAt: null }
  // A stablecoin on a chain with the fee proxy: Gully Labs' fee is taken in the same transaction (quoteView's
  // split, which the wallet path uses). Sized exactly like accrue() with the store's volume so far, so it covers
  // only the part above the remaining free allowance; nothing while the whole payment is still free. withFeeSplit
  // leaves coins, chains without a proxy, a zero fee and a missing treasury as a plain transfer.
  if (asset.kind === 'token') {
    const cfg = feeConfig()
    const due = accrue({ priorCents: volumeOf(ws), cents: BigInt(usdCents) }, cfg)
    if (due.feeMicros > 0n) withFeeSplit(q, { bps: cfg.bps, feeTo: treasury(), feeRaw: microsToRaw(due.feeMicros, asset.decimals) })
  }
  db.quotes.push(q)
  save()
  return { ok: true, quote: q }
}

/* ------------------------------------------------------------- invoices --- */

const findInvoice = (id) => (INVOICE_RE.test(String(id)) ? (db.invoices.find((i) => i.id === id) ?? null) : null)
const findLink = (id) => (LINK_RE.test(String(id)) ? (db.links.find((l) => l.id === id) ?? null) : null)
const findPayment = (id) => (id ? (db.payments.find((p) => p.id === id) ?? null) : null)

function invoiceState(inv, now = Date.now()) {
  return invoiceStatus(inv, now)
}
const overdue = (inv, now = Date.now()) => invoiceState(inv, now) === 'open' && !!inv.dueAt && now > Date.parse(inv.dueAt)

/** The assets an invoice can be paid in right now: its own list, on chains where the store has a wallet. */
const payableAssets = (inv) => storeAssets().filter((a) => inv.assets.includes(a.id) && recipientOn(inv.ws, a.chainId))

function checkoutState(ws, inv) {
  const owner = getAccount(ws)
  if (!owner || owner.blocked) return { enabled: false, treasury: null, reason: 'This store is not available.' }
  if (pauseOf(ws).paused) return { enabled: false, treasury: null, paused: true, reason: `${PAUSED_TEXT} Contact the store to pay another way.` }
  if (inv && !payableAssets(inv).length) return { enabled: false, treasury: null, reason: 'This store has not set a receiving wallet for these assets yet.' }
  return { enabled: true, treasury: null }
}

/** What anyone with the link sees: no customer email, no internal ids beyond the invoice's own. */
export function publicMerchantInvoice(inv) {
  const status = invoiceState(inv)
  const p = findPayment(inv.paymentId)
  const assets = payableAssets(inv)
  return {
    id: inv.id,
    number: inv.number,
    title: inv.title,
    note: inv.notes || null,
    items: inv.items.map((i) => ({ description: i.description, quantity: i.quantity, unitUsd: fmtUsd(i.unitCents), totalUsd: fmtUsd(BigInt(i.unitCents) * BigInt(i.quantity)) })),
    customer: inv.customer?.name ? { name: inv.customer.name } : null,
    usd: fmtUsd(inv.usdCents),
    usdCents: inv.usdCents,
    status,
    overdue: overdue(inv),
    dueAt: inv.dueAt ?? null,
    assets: status === 'paid' ? storeAssets().filter((a) => inv.assets.includes(a.id)) : assets,
    recipients: Object.fromEntries(assets.map((a) => [a.chainId, checksumAddress(recipientOn(inv.ws, a.chainId))])),
    createdAt: inv.createdAt,
    expiresAt: inv.expiresAt,
    paidAt: inv.paidAt ?? null,
    cancelledAt: inv.cancelledAt ?? null,
    payment: p ? paymentView(p) : null,
    linkId: inv.linkId ?? null,
    merchant: brandOf(inv.ws),
    nonCustodial: NON_CUSTODIAL,
    checkout: checkoutState(inv.ws, inv),
  }
}

function invoiceAdminView(inv) {
  return { ...publicMerchantInvoice(inv), customer: inv.customer ?? null, views: inv.views ?? 0, path: `/pay/m/${inv.id}`, items: inv.items.map((i) => ({ description: i.description, quantity: i.quantity, unitUsd: fmtUsd(i.unitCents), totalUsd: fmtUsd(BigInt(i.unitCents) * BigInt(i.quantity)) })) }
}

function parseAssets(raw) {
  const list = raw == null ? STORE_ASSET_IDS : Array.isArray(raw) ? [...new Set(raw.map(String))] : null
  if (!list || !list.length || list.some((x) => !STORE_ASSET_IDS.includes(x))) return null
  return STORE_ASSET_IDS.filter((x) => list.includes(x))
}

/** body: { items: [{ description, quantity, unitUsd }], dueDate: 'YYYY-MM-DD', customer?: { name?, email? }, notes?, number?, title?, assets? } */
function parseInvoice(ws, body) {
  const m = merchantOf(ws)
  if (!Array.isArray(body?.items) || !body.items.length || body.items.length > MAX_ITEMS) return bad(`Add 1 to ${MAX_ITEMS} line items.`)
  const items = []
  for (const [i, it] of body.items.entries()) {
    const description = typeof it?.description === 'string' ? it.description.trim() : ''
    if (!description || description.length > MAX_TITLE) return bad(`Line ${i + 1}: describe it in 1 to ${MAX_TITLE} characters.`)
    const quantity = it?.quantity == null || it.quantity === '' ? 1 : Number(it.quantity)
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 10_000) return bad(`Line ${i + 1}: the quantity must be a whole number from 1 to 10000.`)
    const unit = parseUsdCents(it?.unitUsd)
    if (!centsOk(unit)) return bad(`Line ${i + 1}: the unit price must be a positive dollar amount with at most two decimals.`)
    items.push({ description, quantity, unitCents: String(unit) })
  }
  const total = items.reduce((a, i) => a + BigInt(i.unitCents) * BigInt(i.quantity), 0n)
  if (!centsOk(total)) return bad('The invoice total is too large.')
  const d = String(body?.dueDate ?? '')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || !Number.isFinite(Date.parse(`${d}T23:59:59Z`))) return bad('dueDate must be a date, YYYY-MM-DD.')
  const due = Date.parse(`${d}T23:59:59.999Z`)
  if (due < Date.now()) return bad('The due date must be today or later.')
  if (due > Date.now() + 366 * DAY) return bad('The due date can be at most a year away.')
  const name = typeof body?.customer?.name === 'string' ? body.customer.name.trim() : ''
  const email = typeof body?.customer?.email === 'string' ? body.customer.email.trim().toLowerCase() : ''
  if (name.length > 80) return bad("The customer's name can be at most 80 characters.")
  if (email && !EMAIL_RE.test(email)) return bad("The customer's email is not a valid address.")
  const notes = typeof body?.notes === 'string' ? body.notes.trim() : ''
  if (notes.length > MAX_TEXT) return bad(`Notes can be at most ${MAX_TEXT} characters.`)
  let number = typeof body?.number === 'string' ? body.number.trim() : ''
  if (number) {
    if (!NUMBER_RE.test(number)) return bad('The invoice number may have up to 32 letters, digits, spaces and . _ / # -')
    if (db.invoices.some((i) => i.ws === ws && i.number === number)) return { ok: false, status: 409, error: `Invoice number ${number} is used already.` }
  } else {
    do number = `INV-${String(++m.invoiceSeq).padStart(4, '0')}`
    while (db.invoices.some((i) => i.ws === ws && i.number === number))
  }
  const title = typeof body?.title === 'string' && body.title.trim() ? body.title.trim() : items.length === 1 ? items[0].description : `Invoice ${number}`
  if (title.length > MAX_TITLE) return bad(`The title can be at most ${MAX_TITLE} characters.`)
  const assets = parseAssets(body?.assets)
  if (!assets) return bad(`assets must be a non-empty list of: ${STORE_ASSET_IDS.join(', ')}.`)
  return { ok: true, fields: { number, title, items, usdCents: String(total), customer: name || email ? { name: name || null, email: email || null } : null, notes, dueAt: new Date(due).toISOString(), expiresAt: new Date(due + OVERDUE_GRACE_DAYS * DAY).toISOString(), assets } }
}

function newInvoice(ws, fields, linkId = null) {
  const inv = { id: 'mi_' + randomToken(16), ws, ...fields, linkId, views: 0, firstViewedAt: null, createdAt: new Date().toISOString(), cancelledAt: null, paidAt: null, paymentId: null }
  db.invoices.push(inv)
  return inv
}

/* ---------------------------------------------------------------- links --- */

function linkState(l, now = Date.now()) {
  if (!l.active) return 'inactive'
  if (l.expiresAt && Date.parse(l.expiresAt) <= now) return 'expired'
  if (l.maxUses != null && (l.paidUses ?? 0) >= l.maxUses) return 'used-up'
  return 'active'
}
const LINK_STATE_TEXT = {
  inactive: 'This payment link is switched off and takes no payments.',
  expired: 'This payment link has expired and takes no more payments.',
  'used-up': 'This payment link has been used as many times as it allows and takes no more payments.',
}
const amountView = (a) => (a.type === 'fixed' ? { type: 'fixed', usd: fmtUsd(a.usdCents), usdCents: a.usdCents } : { type: 'open', min: fmtUsd(a.minCents), max: fmtUsd(a.maxCents), minCents: a.minCents, maxCents: a.maxCents })

export function publicMerchantLink(l) {
  const state = linkState(l)
  const assets = storeAssets().filter((a) => l.assets.includes(a.id) && recipientOn(l.ws, a.chainId))
  const co = checkoutState(l.ws, null)
  return {
    id: l.id,
    title: l.title,
    description: l.description || null,
    amount: amountView(l.amount),
    assets,
    state,
    stateText: LINK_STATE_TEXT[state] ?? null,
    expiresAt: l.expiresAt,
    merchant: brandOf(l.ws),
    nonCustodial: NON_CUSTODIAL,
    checkout: co.enabled && !assets.length ? { enabled: false, treasury: null, reason: 'This store has not set a receiving wallet for these assets yet.' } : co,
  }
}

function linkAdminView(l) {
  const inv = db.invoices.filter((i) => i.linkId === l.id)
  const paid = inv.filter((i) => i.paymentId)
  return { ...publicMerchantLink(l), active: l.active, maxUses: l.maxUses, paidUses: l.paidUses ?? 0, lastPaidAt: l.lastPaidAt ?? null, views: l.views ?? 0, createdAt: l.createdAt, updatedAt: l.updatedAt, path: `/pay/m/l/${l.id}`, stats: { checkouts: inv.length, paid: paid.length, paidUsd: fmtUsd(sum(paid, (i) => i.usdCents)) } }
}

function parseLink(body, prev = null) {
  const has = (k) => body != null && Object.prototype.hasOwnProperty.call(body, k) && body[k] !== undefined
  const f = {}
  if (!prev || has('title')) {
    const title = typeof body?.title === 'string' ? body.title.trim() : ''
    if (!title || title.length > MAX_TITLE) return bad(`Give the link a title of 1 to ${MAX_TITLE} characters.`)
    f.title = title
  }
  if (!prev || has('description')) {
    const d = body?.description == null ? '' : typeof body.description === 'string' ? body.description.trim() : null
    if (d == null || d.length > MAX_TEXT) return bad(`The description can be at most ${MAX_TEXT} characters.`)
    f.description = d
  }
  if (!prev || has('amount')) {
    const a = body?.amount
    if (a?.type === 'fixed') {
      const c = parseUsdCents(a.usd)
      if (!centsOk(c)) return bad('A fixed amount must be a positive dollar amount with at most two decimals, e.g. 49 or 249.99.')
      f.amount = { type: 'fixed', usdCents: String(c) }
    } else if (a?.type === 'open') {
      const min = parseUsdCents(a.min)
      const max = parseUsdCents(a.max)
      if (!centsOk(min) || !centsOk(max)) return bad('An open amount needs a minimum and a maximum in dollars, each positive with at most two decimals.')
      if (min > max) return bad('The minimum must not be above the maximum.')
      f.amount = { type: 'open', minCents: String(min), maxCents: String(max) }
    } else return bad('amount must be { type: "fixed", usd } or { type: "open", min, max }.')
  }
  if (!prev || has('assets')) {
    const list = parseAssets(body?.assets)
    if (!list) return bad(`assets must be a non-empty list of: ${STORE_ASSET_IDS.join(', ')}.`)
    f.assets = list
  }
  if (!prev || has('expiresAt')) {
    const e = body?.expiresAt
    if (e == null || e === '') f.expiresAt = null
    else {
      const t = Date.parse(String(e))
      if (!Number.isFinite(t)) return bad('expiresAt must be a date and time (ISO 8601), or null for no expiry.')
      if (t <= Date.now()) return bad('expiresAt must be in the future.')
      if (t > Date.now() + 5 * 366 * DAY) return bad('expiresAt can be at most five years away.')
      f.expiresAt = new Date(t).toISOString()
    }
  }
  if (!prev || has('maxUses')) {
    const m = body?.maxUses
    if (m == null || m === '') f.maxUses = null
    else {
      const n = Number(m)
      if (!Number.isInteger(n) || n < 1 || n > 1_000_000) return bad('maxUses must be a whole number from 1 to 1000000, or null for no limit.')
      f.maxUses = n
    }
  }
  if (!prev || has('active')) {
    if (prev && typeof body.active !== 'boolean') return bad('active must be true or false.')
    f.active = prev ? body.active : body?.active !== false
  }
  return { ok: true, fields: f }
}

/* ------------------------------------------------------------- webhooks --- */

const brief = (inv) => ({ id: inv.id, number: inv.number, title: inv.title, usd: fmtUsd(inv.usdCents), usdCents: inv.usdCents, status: invoiceState(inv), url: `${SITE}/pay/m/${inv.id}`, linkId: inv.linkId ?? null, customer: inv.customer ?? null, createdAt: inv.createdAt, dueAt: inv.dueAt ?? null, expiresAt: inv.expiresAt, paidAt: inv.paidAt ?? null, cancelledAt: inv.cancelledAt ?? null })
const linkBrief = (id) => {
  const l = id ? db.links.find((x) => x.id === id) : null
  return l ? { id: l.id, title: l.title, url: `${SITE}/pay/m/l/${l.id}` } : null
}
const targetsOf = (ws) => {
  const w = peek(ws)?.webhook
  return w ? [{ target: 'merchant', targetId: ws, url: w.url }] : []
}

function emit(type, inv, payment = null, confirmations = null) {
  const targets = targetsOf(inv.ws)
  if (!targets.length) return 0
  const store = { name: brandOf(inv.ws).name }
  let event
  if (type === 'invoice.paid') {
    // The payment block is pay-webhooks.mjs's own (paidEvent); the invoice and link are the store's.
    event = paidEvent(inv, payment, confirmations)
    event.data = { store, invoice: brief(inv), link: linkBrief(inv.linkId), payment: event.data.payment }
  } else event = { id: `evt_${randomToken(12)}`, type, createdAt: new Date().toISOString(), data: { store, invoice: brief(inv), link: linkBrief(inv.linkId) } }
  try {
    return enqueue(event, inv, targets)
  } catch (e) {
    console.error(`${type} merchant webhook:`, e?.message ?? e)
    return 0
  }
}

/* ------------------------------------------------------------- payments --- */

async function quoteFor(inv, assetId) {
  const s = invoiceState(inv)
  if (s !== 'open') return { ok: false, status: 409, error: s === 'paid' ? 'This invoice is paid already.' : s === 'cancelled' ? 'This invoice was cancelled by the store.' : 'This invoice has expired. Ask the store for a new one.' }
  const co = checkoutState(inv.ws, inv)
  if (!co.enabled) return { ok: false, status: co.paused ? 423 : 409, error: co.reason, ...(co.paused ? { paused: true } : {}) }
  const asset = assetById(assetId)
  if (!asset || !inv.assets.includes(asset.id)) return { ok: false, status: 400, error: 'This invoice cannot be paid in that asset.' }
  const recipient = recipientOn(inv.ws, asset.chainId)
  if (!recipient) return { ok: false, status: 409, error: `This store takes no payments on ${CHAINS[asset.chainId].name} right now.` }
  const live = db.quotes.find((q) => q.invoiceId === inv.id && q.assetId === asset.id && q.treasury === recipient && !q.paidAt && Date.parse(q.expiresAt) - Date.now() > 5 * 60_000)
  if (live) return { ok: true, quote: live }
  if (db.quotes.filter((q) => q.invoiceId === inv.id && Date.parse(q.expiresAt) > Date.now()).length >= 30) return { ok: false, status: 429, error: 'Too many open quotes for this invoice. Use one you have, or try again in 20 minutes.' }
  return createQuote({ ws: inv.ws, invoiceId: inv.id, asset, usdCents: BigInt(inv.usdCents), recipient })
}

/** Records a confirmed payment for a merchant invoice and accrues its fee. */
function recordMerchantPayment(inv, quote, match, read, asset, txHash) {
  const now = new Date().toISOString()
  const p = { id: randomToken(9), kind: 'merchant', ws: inv.ws, invoiceId: inv.id, linkId: inv.linkId ?? null, txHash, chainId: asset.chainId, assetId: asset.id, symbol: asset.symbol, decimals: asset.decimals, amountRaw: String(match.value), usdCents: quote.usdCents, price: quote.price ?? null, quoteId: quote.id, from: match.from, to: quote.treasury, blockNumber: read.blockNumber, at: now, feeMicros: '0' }
  const fee = accrue({ priorCents: volumeOf(inv.ws), cents: BigInt(p.usdCents) })
  p.feeMicros = String(fee.feeMicros)
  // Paid through the fee proxy (match.fee: its fee leg went to our treasury, payments.mjs creditFeeProxy): that
  // much of this payment's fee is collected already. It counts up to the fee accrued here and no further, so
  // the statement bills accrued - collected exactly; anything above (the volume or the rate changed since the
  // quote) is kept as paid on chain, never refunded and never billed again.
  const onchain = match.fee != null && BigInt(match.fee) > 0n
  const onchainMicros = onchain ? rawToMicros(match.fee, asset.decimals) : 0n
  const collected = onchainMicros < fee.feeMicros ? onchainMicros : fee.feeMicros
  if (onchain) Object.assign(p, { feeRaw: String(match.fee), collectedMicros: String(collected) })
  db.payments.push(p)
  db.fees.push({ id: randomToken(9), ws: inv.ws, paymentId: p.id, at: now, volumeCents: p.usdCents, freeCents: String(fee.freeCents), feeableCents: String(fee.feeableCents), bps: fee.bps, feeMicros: String(fee.feeMicros), collectedMicros: String(collected), onchain, statementId: null })
  quote.paidAt = now
  inv.paymentId = p.id
  inv.paidAt = now
  const link = inv.linkId ? db.links.find((l) => l.id === inv.linkId) : null
  if (link) {
    link.paidUses = (link.paidUses ?? 0) + 1
    link.lastPaidAt = now
  }
  pruneQuotes()
  save()
  return p
}

async function verifyFor(inv, quoteId, txHashIn) {
  const s = invoiceState(inv)
  if (s === 'paid') return { ok: false, status: 409, error: 'This invoice is paid already.' }
  if (s === 'cancelled') return { ok: false, status: 409, error: 'This invoice was cancelled by the store. Contact the store if you paid it.' }
  const quote = db.quotes.find((q) => q.id === String(quoteId ?? '')) ?? null
  if (!quote || quote.invoiceId !== inv.id) return { ok: false, status: 404, error: 'No such quote for this invoice. Get a new quote.' }
  const txHash = normHash(txHashIn)
  if (!isHash(txHash)) return badHash
  // A quote given before a pause can still be verified: the payment went to the merchant's own wallet.
  const asset = assetById(quote.assetId)
  const r = await checkTx({
    quote,
    asset,
    txHash,
    signer: null,
    minRaw: quote.amountRaw,
    label: 'this invoice',
    recipient: quote.treasury,
    run: async ({ match, read }) => {
      if (invoiceState(inv) === 'paid' || inv.cancelledAt) return { ok: false, status: 409, error: 'This invoice is no longer open.' }
      if (hashUsed(asset.chainId, txHash)) return { ok: false, status: 409, error: 'This transaction has already been used for a payment.' }
      // Through the fee proxy the total matches, but a fee above the quoted one would have come out of the store's share.
      if (match.fee != null && BigInt(match.fee) > BigInt(quote.feeRaw ?? '0')) return { ok: false, status: 422, error: 'This payment sent more to the Gully Pay fee and less to the store than its quote, so it cannot be matched to it. Contact the store with the transaction hash.' }
      const p = recordMerchantPayment(inv, quote, match, read, asset, txHash)
      try {
        recordEvent(inv.ws, { actor: 'system', action: 'merchant.payment', target: inv.number, detail: { usd: fmtUsd(p.usdCents), chain: CHAINS[p.chainId].name, symbol: p.symbol, invoiceId: inv.id } })
      } catch {
        /* the log is best effort */
      }
      emit('invoice.paid', inv, p, read.confirmations)
      return { ok: true }
    },
  })
  return r.ok ? r : { ...r, error: forStore(r.error) }
}

/* ------------------------------------------------------------ statements --- */

let notifier = (ws, text) => sendAccountTelegram(ws, text)
/** Test hook: where statement warnings go instead of Telegram. */
export const setMerchantNotifierForTest = (fn) => (notifier = fn)

function warn(st, kind, now = Date.now()) {
  st.warned ??= {}
  if (st.warned[kind]) return false
  st.warned[kind] = new Date(now).toISOString()
  const usd = fmtUsd(st.usdCents)
  const due = new Date(st.dueAt).toUTCString().slice(0, 16)
  const text = {
    issue: `Your Gully Pay fee statement ${st.number} is ready: $${usd} for the week. Pay it within ${PAUSE_AFTER_DAYS} days (by ${due}) to keep your checkout running: ${SITE}/pay/${st.invoiceId}`,
    day5: `Reminder: Gully Pay fee statement ${st.number} ($${usd}) is unpaid. Your checkout pauses on ${due} unless it is paid: ${SITE}/pay/${st.invoiceId}`,
    day7: `Your store's checkout is paused: Gully Pay fee statement ${st.number} ($${usd}) is ${PAUSE_AFTER_DAYS} days unpaid. Paying it resumes checkout at once: ${SITE}/pay/${st.invoiceId}`,
    resumed: `Thank you: fee statement ${st.number} is paid and your store's checkout is running.`,
  }[kind]
  const action = { issue: 'merchant.fee_statement', day5: 'merchant.fee_reminder', day7: 'merchant.checkout_paused', resumed: 'merchant.fee_paid' }[kind]
  try {
    recordEvent(st.ws, { actor: 'system', action, target: st.number, detail: { usd, invoiceId: st.invoiceId, dueAt: st.dueAt } })
  } catch {
    /* best effort */
  }
  try {
    Promise.resolve(notifier(st.ws, text)).catch(() => {})
  } catch {
    /* a notice is best effort */
  }
  return true
}

/**
 * Issues a fee statement to every merchant whose fees not yet billed (up to `cutoff`) come to at least
 * $1, as a Gully Labs invoice payable into the treasury. Smaller balances roll into the next week.
 */
export function issueStatements(cutoff = Date.now()) {
  const byWs = new Map()
  // A fee collected in full on chain (fee proxy) has nothing left to bill and never appears on a statement.
  for (const f of db.fees) if (!f.statementId && Date.parse(f.at) <= cutoff && billableOf(f) > 0n) byWs.set(f.ws, [...(byWs.get(f.ws) ?? []), f])
  const issued = []
  const now = Date.now()
  for (const [ws, fees] of byWs) {
    const micros = sum(fees, billableOf)
    const cents = centsOfMicros(micros)
    const collected = sum(fees, collectedOf)
    if (cents < MIN_STATEMENT_CENTS) continue
    const volume = sum(fees, (f) => f.volumeCents)
    const day = new Date(cutoff).toISOString().slice(0, 10)
    const number = `GPF-${day.replace(/-/g, '')}-${String(db.statements.length + 1).padStart(4, '0')}`
    const name = brandOf(ws).name.slice(0, 60)
    const inv = createInvoiceRecord({
      title: `Gully Pay fees: ${name}`,
      note: `Fee statement ${number}, for payments up to ${day}: ${fees.length} payment${fees.length === 1 ? '' : 's'}, ${fmtUsd(volume)} USD of volume, ${feeConfig().bps / 100}% after the free allowance${collected > 0n ? `, less ${fmtUsd(centsOfMicros(collected))} USD already collected on chain at payment time` : ''}. Due within ${PAUSE_AFTER_DAYS} days; unpaid after that, the store's checkout pauses until it is paid.`,
      usdCents: cents,
      assets: ASSET_IDS,
      ttlMs: 365 * DAY,
    })
    inv.merchantStatement = { ws, number }
    saveLedger()
    const st = { id: 'st_' + randomToken(9), ws, number, periodStart: fees.map((f) => f.at).sort()[0], periodEnd: new Date(cutoff).toISOString(), feeIds: fees.map((f) => f.id), feeMicros: String(micros), collectedMicros: String(collected), usdCents: String(cents), volumeCents: String(volume), payments: fees.length, invoiceId: inv.id, issuedAt: new Date(now).toISOString(), dueAt: new Date(now + PAUSE_AFTER_DAYS * DAY).toISOString(), warned: {}, paidAt: null }
    for (const f of fees) f.statementId = st.id
    db.statements.push(st)
    warn(st, 'issue', now)
    issued.push(statementView(st))
  }
  db.lastStatementRun = new Date(cutoff).toISOString()
  save()
  return issued
}

/** Day-5 and day-7 warnings, and the weekly run when a Monday 00:00 UTC has passed since the last one. */
export function merchantTick(now = Date.now()) {
  const monday = weekStart(now)
  if (!db.lastStatementRun) {
    db.lastStatementRun = new Date(monday).toISOString()
    save()
  } else if (Date.parse(db.lastStatementRun) < monday) issueStatements(monday)
  let changed = false
  for (const st of db.statements) {
    const state = statementState(st, now)
    if (state !== 'open' && state !== 'overdue') continue
    if (now >= Date.parse(st.issuedAt) + WARN_DAY * DAY && !st.warned?.day5) changed = warn(st, 'day5', now) || changed
    if (state === 'overdue' && !st.warned?.day7) changed = warn(st, 'day7', now) || changed
  }
  // invoice.expired for store invoices that ran out without a payment.
  for (const inv of db.invoices) {
    if (inv.paymentId || inv.cancelledAt || inv.expiredEventAt) continue
    const exp = Date.parse(inv.expiresAt)
    if (exp > now) continue
    inv.expiredEventAt = new Date(now).toISOString()
    changed = true
    if (now - exp <= EXPIRED_LOOKBACK_MS) emit('invoice.expired', inv)
  }
  if (changed) save()
}

// A paid statement resumes checkout at once (pauseOf reads the invoice); this records it and says so.
invoicePaidHooks.push((inv) => {
  if (!inv.merchantStatement) return
  const st = db.statements.find((s) => s.invoiceId === inv.id)
  if (!st || st.paidAt) return
  st.paidAt = inv.paidAt ?? new Date().toISOString()
  warn(st, 'resumed')
  save()
})

const tickMs = Number(process.env.GULLY_MERCHANT_TICK_MS ?? 600_000)
if (tickMs > 0) {
  setInterval(() => {
    try {
      merchantTick()
    } catch (e) {
      console.error('merchants tick:', e?.message ?? e)
    }
  }, tickMs).unref?.()
  setTimeout(() => {
    try {
      merchantTick()
    } catch (e) {
      console.error('merchants tick:', e?.message ?? e)
    }
  }, 5_000).unref?.()
}

/* ------------------------------------------------------------- the stats --- */

const RANGES = { '30d': 30, '90d': 90, '365d': 365 }

/** Payments dashboard: daily volume by chain and by asset, count, average ticket, conversion, top links. */
export function statsOf(ws, range = '30d', now = Date.now()) {
  const days = RANGES[range] ?? 30
  const start = Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth(), new Date(now).getUTCDate()) - (days - 1) * DAY
  const pays = db.payments.filter((p) => p.ws === ws && Date.parse(p.at) >= start)
  const dates = Array.from({ length: days }, (_, i) => new Date(start + i * DAY).toISOString().slice(0, 10))
  const idx = new Map(dates.map((d, i) => [d, i]))
  const chains = {}
  const assets = {}
  const count = Array(days).fill(0)
  for (const p of pays) {
    const i = idx.get(p.at.slice(0, 10))
    if (i == null) continue
    const usd = usdNum(p.usdCents)
    const cn = CHAINS[p.chainId]?.name ?? String(p.chainId)
    ;(chains[cn] ??= Array(days).fill(0))[i] += usd
    const an = `${p.symbol} · ${cn}`
    ;(assets[an] ??= Array(days).fill(0))[i] += usd
    count[i]++
  }
  const round = (arr) => arr.map((v) => Math.round(v * 100) / 100)
  const volume = sum(pays, (p) => p.usdCents)
  // Conversion: checkouts opened (a store invoice viewed at least once, or a link checkout started) -> paid.
  const invs = db.invoices.filter((i) => i.ws === ws && Date.parse(i.createdAt) >= start)
  const opened = invs.filter((i) => i.linkId || i.paymentId || (i.views ?? 0) > 0)
  const paid = opened.filter((i) => i.paymentId)
  const links = db.links
    .filter((l) => l.ws === ws)
    .map((l) => {
      const lp = pays.filter((p) => p.linkId === l.id)
      return { id: l.id, title: l.title, views: l.views ?? 0, checkouts: invs.filter((i) => i.linkId === l.id).length, paid: lp.length, volumeUsd: usdNum(sum(lp, (p) => p.usdCents)) }
    })
    .filter((l) => l.paid || l.views || l.checkouts)
    .sort((a, b) => b.volumeUsd - a.volumeUsd || b.paid - a.paid)
    .slice(0, 8)
  return {
    range,
    days,
    dates,
    byChain: Object.entries(chains).map(([name, data]) => ({ name, data: round(data) })),
    byAsset: Object.entries(assets).map(([name, data]) => ({ name, data: round(data) })),
    count,
    totals: { payments: pays.length, volumeUsd: usdNum(volume), avgTicketUsd: pays.length ? usdNum(volume / BigInt(pays.length)) : null, opened: opened.length, paid: paid.length, conversion: opened.length ? paid.length / opened.length : null },
    topLinks: links,
    updatedAt: new Date(now).toISOString(),
  }
}

/* ------------------------------------------------------------ portal API --- */

function merchantView(ws, role) {
  const m = peek(ws)
  const wallets = Object.entries(m?.wallets ?? {})
    .map(([id, w]) => walletView(id, w))
    .sort((a, b) => CHAIN_LIST.findIndex((c) => c.id === a.chainId) - CHAIN_LIST.findIndex((c) => c.id === b.chainId))
  return {
    role,
    can: { manage: canWrite(role, '/api/developer/merchant/profile'), links: canWrite(role, '/api/developer/merchant/links'), webhooks: canWrite(role, '/api/developer/merchant/webhook') },
    nonCustodial: NON_CUSTODIAL,
    terms: { version: MERCHANT_TERMS_VERSION, path: MERCHANT_TERMS_PATH, accepted: m?.terms ?? null, current: m?.terms?.version === MERCHANT_TERMS_VERSION },
    profile: { name: m?.profile?.name ?? null, displayName: brandOf(ws).name, logoUrl: logoPath(m?.profile?.logo), logoSource: m?.profile?.logo?.source ?? null, accent: m?.profile?.accent ?? null, supportEmail: m?.profile?.supportEmail ?? null, website: m?.profile?.website ?? null },
    wallets,
    ready: wallets.some((w) => w.enabled && w.status === 'ok'),
    chains: CHAIN_LIST.map((c) => ({ id: c.id, name: c.name, key: c.key, explorer: c.explorer })),
    assets: storeAssets(),
    links: db.links
      .filter((l) => l.ws === ws)
      .reverse()
      .map(linkAdminView),
    invoices: db.invoices
      .filter((i) => i.ws === ws && !i.linkId)
      .slice(-200)
      .reverse()
      .map(invoiceAdminView),
    payments: db.payments
      .filter((p) => p.ws === ws)
      .slice(-50)
      .reverse()
      .map((p) => ({ ...paymentView(p), invoiceNumber: db.invoices.find((i) => i.id === p.invoiceId)?.number ?? null, linkId: p.linkId, feeUsd: usdNum(centsOfMicros(BigInt(p.feeMicros ?? '0'))), feeCollectedUsd: usdNum(centsOfMicros(BigInt(p.collectedMicros ?? '0'))) })),
    webhook: endpointView(m?.webhook ?? null),
    deliveries: deliveries({ target: 'merchant', targetId: ws, limit: 50 }),
    fees: feesView(ws),
    checkoutOpen: !pauseOf(ws).paused,
  }
}

async function setProfile(ws, body) {
  const m = merchantOf(ws)
  const has = (k) => body != null && Object.prototype.hasOwnProperty.call(body, k)
  const next = { ...m.profile }
  if (has('name')) {
    const name = typeof body.name === 'string' ? body.name.trim().replace(/\s+/g, ' ') : ''
    if (!name || name.length > 60 || /[<>]/.test(name)) return bad('Name the store: 1 to 60 characters.')
    next.name = name
  }
  if (has('accent')) {
    const a = body.accent == null || body.accent === '' ? null : String(body.accent).trim()
    if (a && !HEX_RE.test(a)) return bad('The accent colour must be a hex colour like #e8c060.')
    next.accent = a ? a.toLowerCase() : null
  }
  if (has('supportEmail')) {
    const e = body.supportEmail == null || body.supportEmail === '' ? null : String(body.supportEmail).trim().toLowerCase()
    if (e && !EMAIL_RE.test(e)) return bad('The support email is not a valid address.')
    next.supportEmail = e
  }
  if (has('website')) {
    const w = body.website == null || body.website === '' ? null : String(body.website).trim()
    if (w) {
      let u
      try {
        u = new URL(w)
      } catch {
        return bad('The website must be a full https:// URL.')
      }
      if (u.protocol !== 'https:' || u.username || u.password || w.length > 200) return bad('The website must be a full https:// URL of at most 200 characters.')
      next.website = u.toString()
    } else next.website = null
  }
  if (has('logoUrl')) {
    const raw = body.logoUrl == null ? '' : String(body.logoUrl).trim()
    if (!raw) next.logo = null
    else if (raw !== m.profile.logo?.source) {
      const r = await fetchLogo(raw)
      if (!r.ok) return r
      const sha = crypto.createHash('sha256').update(r.buf).digest('hex').slice(0, 32)
      fs.mkdirSync(LOGO_DIR, { recursive: true })
      fs.writeFileSync(path.join(LOGO_DIR, `${sha}.img`), r.buf)
      next.logo = { sha, type: r.type, bytes: r.buf.length, source: raw, fetchedAt: new Date().toISOString() }
    }
  }
  m.profile = next
  m.updatedAt = new Date().toISOString()
  save()
  return { ok: true }
}

async function setWallets(ws, body, user) {
  const accepted = peek(ws)?.terms
  if (!accepted && body?.acceptTerms !== true) return { ok: false, status: 400, code: 'terms', error: `Accept the Gully Pay merchant terms (${SITE}${MERCHANT_TERMS_PATH}) to set up your store: send acceptTerms: true.` }
  const declared = String(body?.type ?? '')
  const list = Array.isArray(body?.chains) ? [...new Set(body.chains.map(Number))] : body?.chainId != null ? [Number(body.chainId)] : []
  if (!list.length || list.some((id) => !STORE_CHAIN_IDS.has(id))) return bad(`chains must list one or more of: ${CHAIN_LIST.map((c) => c.id).join(', ')}.`)
  const results = []
  for (const id of list) {
    const r = await inspectWallet(id, body?.address, declared)
    if (!r.ok) {
      if (r.status === 400) return r // a bad address is wrong on every chain
      results.push({ chainId: id, ok: false, error: r.error })
      continue
    }
    const m = merchantOf(ws)
    m.wallets[id] = { address: r.address, declared, kind: r.kind, enabled: r.deployed && body?.enabled !== false, status: r.status, checkedAt: new Date().toISOString() }
    results.push({ chainId: id, ok: r.deployed, error: r.deployed ? null : r.error, wallet: walletView(id, m.wallets[id]) })
  }
  const merchant = merchantOf(ws)
  merchant.updatedAt = new Date().toISOString()
  const acceptedNow = !merchant.terms && body?.acceptTerms === true
  if (acceptedNow) merchant.terms = { version: MERCHANT_TERMS_VERSION, acceptedAt: merchant.updatedAt, acceptedBy: user }
  save()
  const refused = results.filter((x) => !x.ok)
  return { ok: true, acceptedNow, status: refused.length === results.length ? 422 : 200, results, error: refused.length ? refused.map((x) => `${CHAINS[x.chainId].name}: ${x.error}`).join(' ') : null }
}

async function walletAction(ws, chainId, action, body) {
  const m = peek(ws)
  const w = m?.wallets?.[chainId]
  if (!w) return { ok: false, status: 404, error: 'No wallet is set on that chain.' }
  if (action === 'remove') {
    delete m.wallets[chainId]
    save()
    return { ok: true }
  }
  if (action === 'set' && body?.enabled === false) {
    w.enabled = false
    save()
    return { ok: true, wallet: walletView(chainId, w) }
  }
  if (action === 'set' && body?.enabled !== true) return bad('Send { enabled: true | false }.')
  // Enabling, or checking again (after deploying a Safe, say): read the chain again first.
  const r = await inspectWallet(Number(chainId), w.address, w.declared)
  if (!r.ok) return r
  Object.assign(w, { kind: r.kind, status: r.status, checkedAt: new Date().toISOString(), enabled: r.deployed })
  save()
  return r.deployed ? { ok: true, wallet: walletView(chainId, w) } : { ok: false, status: 422, error: r.error, wallet: walletView(chainId, w) }
}

function sendCsv(res, filename, body) {
  res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${filename}"`, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' })
  res.end(body)
  return true
}

export function paymentsCsv(ws) {
  // fee_usd is the fee accrued on the payment; of it, fee_collected_onchain_usd was taken at payment time
  // through the fee proxy and fee_billed_usd goes on (or went on) a weekly statement. Cents per row, rounded half
  // up; a statement rounds its sum once, so per-row cents can differ from it by a cent.
  const rows = db.payments
    .filter((p) => p.ws === ws)
    .map((p) => {
      const v = paymentView(p)
      const inv = db.invoices.find((i) => i.id === p.invoiceId)
      const f = db.fees.find((x) => x.paymentId === p.id)
      const accrued = BigInt(p.feeMicros ?? '0')
      const collected = f ? collectedOf(f) : 0n
      const billed = f ? billableOf(f) : accrued
      return [v.at, inv?.number ?? '', inv?.title ?? '', p.linkId ?? '', v.usd, v.amount, v.symbol, v.chain, v.txHash, v.from, v.to, fmtUsd(centsOfMicros(accrued)), v.txUrl, fmtUsd(centsOfMicros(collected)), fmtUsd(centsOfMicros(billed))]
    })
  return toCsv(['date', 'invoice', 'title', 'link', 'usd', 'amount', 'asset', 'chain', 'tx_hash', 'from', 'to', 'fee_usd', 'explorer_url', 'fee_collected_onchain_usd', 'fee_billed_usd'], rows)
}

const reply = (res, r, okBody) => (r.ok ? json(res, r.status && r.status !== 200 ? r.status : 200, okBody) : json(res, r.status ?? 400, { error: r.error, ...(r.wallet ? { wallet: r.wallet } : {}) }), true)

/**
 * /api/developer/merchant*. developer.mjs has checked the session, CSRF and the role (canWrite), and
 * passes ctx = { user, workspace, role }.
 */
export async function handleMerchant(req, res, url, ctx) {
  const p = url.pathname
  const post = req.method === 'POST'
  const { workspace: ws, role, user } = ctx
  const ev = (action, target = null, detail = null) => {
    try {
      recordEvent(ws, { actor: user, action, target, detail })
    } catch {
      /* best effort */
    }
  }

  if (!post) {
    if (p === '/api/developer/merchant') return json(res, 200, merchantView(ws, role)), true
    if (p === '/api/developer/merchant/stats') return json(res, 200, statsOf(ws, url.searchParams.get('range') ?? '30d')), true
    if (p === '/api/developer/merchant/export/payments.csv') return sendCsv(res, `gully-pay-store-payments-${new Date().toISOString().slice(0, 10)}.csv`, paymentsCsv(ws))
    return json(res, 404, { error: 'not found' }), true
  }
  if (!allow('merchant-write', ws, 300, 3_600_000)) return json(res, 429, { error: 'Too many changes in the last hour. Try again later.' }), true
  const body = await readJson(req, 40_000)

  if (p === '/api/developer/merchant/profile') {
    const r = await setProfile(ws, body ?? {})
    if (r.ok) ev('merchant.profile', merchantOf(ws).profile.name)
    return reply(res, r, merchantView(ws, role))
  }
  if (p === '/api/developer/merchant/wallets') {
    if (!allow('merchant-wallet', ws, 60, 3_600_000)) return json(res, 429, { error: 'Too many wallet checks in the last hour.' }), true
    const r = await setWallets(ws, body ?? {}, user)
    if (!r.ok) return json(res, r.status, { error: r.error, ...(r.code ? { code: r.code } : {}) }), true
    if (r.acceptedNow) ev('merchant.terms_accepted', MERCHANT_TERMS_VERSION)
    ev('merchant.wallets', String(body?.address ?? '').slice(0, 42), { chains: r.results.map((x) => x.chainId), refused: r.results.filter((x) => !x.ok).map((x) => x.chainId) })
    return json(res, r.status, { results: r.results, error: r.error, merchant: merchantView(ws, role) }), true
  }
  let m = p.match(/^\/api\/developer\/merchant\/wallets\/(\d{1,6})(?:\/(check|remove))?$/)
  if (m) {
    const r = await walletAction(ws, m[1], m[2] ?? 'set', body ?? {})
    if (r.ok) ev('merchant.wallet', CHAINS[m[1]]?.name ?? m[1], { action: m[2] ?? (body?.enabled ? 'enable' : 'disable') })
    return reply(res, r, { wallet: r.wallet ?? null, merchant: merchantView(ws, role) })
  }

  if (p === '/api/developer/merchant/links') {
    const r = parseLink(body ?? {})
    if (!r.ok) return json(res, r.status, { error: r.error }), true
    if (db.links.filter((l) => l.ws === ws).length >= 500) return json(res, 409, { error: 'A store can have 500 links. Switch off or reuse one.' }), true
    const now = new Date().toISOString()
    const l = { id: 'ml_' + randomToken(12), ws, ...r.fields, paidUses: 0, lastPaidAt: null, views: 0, createdAt: now, updatedAt: now }
    db.links.push(l)
    save()
    ev('merchant.link_created', l.title, { linkId: l.id })
    return json(res, 201, { link: linkAdminView(l) }), true
  }
  m = p.match(/^\/api\/developer\/merchant\/links\/(ml_[\w-]{16})$/)
  if (m) {
    const l = findLink(m[1])
    if (!l || l.ws !== ws) return json(res, 404, { error: 'No such link in this store.' }), true
    const r = parseLink(body ?? {}, l)
    if (!r.ok) return json(res, r.status, { error: r.error }), true
    Object.assign(l, r.fields, { updatedAt: new Date().toISOString() })
    save()
    ev('merchant.link_updated', l.title, { linkId: l.id, active: l.active })
    return json(res, 200, { link: linkAdminView(l) }), true
  }

  if (p === '/api/developer/merchant/invoices') {
    if (db.invoices.filter((i) => i.ws === ws && !i.linkId && Date.parse(i.createdAt) > Date.now() - DAY).length >= 500) return json(res, 429, { error: 'A store can make 500 invoices a day.' }), true
    const r = parseInvoice(ws, body ?? {})
    if (!r.ok) return json(res, r.status, { error: r.error }), true
    const inv = newInvoice(ws, r.fields)
    save()
    ev('merchant.invoice_created', inv.number, { invoiceId: inv.id, usd: fmtUsd(inv.usdCents) })
    return json(res, 201, { invoice: invoiceAdminView(inv) }), true
  }
  m = p.match(/^\/api\/developer\/merchant\/invoices\/(mi_[\w-]{22})\/cancel$/)
  if (m) {
    const inv = findInvoice(m[1])
    if (!inv || inv.ws !== ws) return json(res, 404, { error: 'No such invoice in this store.' }), true
    const s = invoiceState(inv)
    if (s === 'paid') return json(res, 409, { error: 'This invoice is paid; it cannot be cancelled.' }), true
    if (s === 'cancelled') return json(res, 409, { error: 'Already cancelled.' }), true
    inv.cancelledAt = new Date().toISOString()
    save()
    emit('invoice.cancelled', inv)
    ev('merchant.invoice_cancelled', inv.number, { invoiceId: inv.id })
    return json(res, 200, { invoice: invoiceAdminView(inv) }), true
  }

  if (p === '/api/developer/merchant/webhook') {
    const merchant = merchantOf(ws)
    const raw = body?.url
    if (raw === null || raw === '' || raw === undefined) {
      merchant.webhook = null
      save()
      ev('merchant.webhook_removed')
      return json(res, 200, { webhook: null, secret: null }), true
    }
    const c = await checkEndpoint(raw)
    if (!c.ok) return json(res, 400, { error: c.error }), true
    merchant.webhook = makeEndpoint(c.url)
    save()
    ev('merchant.webhook_set', c.url)
    return json(res, 200, { webhook: endpointView(merchant.webhook), secret: merchant.webhook.secret }), true
  }
  if (p === '/api/developer/merchant/webhook/rotate') {
    const w = peek(ws)?.webhook
    if (!w) return json(res, 409, { error: 'No webhook is set.' }), true
    w.secret = newSecret()
    w.rotatedAt = new Date().toISOString()
    save()
    ev('merchant.webhook_rotated')
    return json(res, 200, { webhook: endpointView(w), secret: w.secret }), true
  }
  if (p === '/api/developer/merchant/webhook/test') {
    if (!allow('merchant-hooktest', ws, 20, 3_600_000)) return json(res, 429, { error: 'Too many test events in the last hour.' }), true
    const r = await sendTest({ target: 'merchant', targetId: ws })
    return r.ok ? json(res, 200, { delivery: r.delivery }) : json(res, r.status, { error: r.error }), true
  }
  m = p.match(/^\/api\/developer\/merchant\/webhook\/deliveries\/(whd_[\w-]{12})\/redeliver$/)
  if (m) {
    if (!deliveries({ target: 'merchant', targetId: ws, limit: 100_000 }).some((d) => d.id === m[1])) return json(res, 404, { error: 'No such delivery for this store.' }), true
    const r = await redeliver(m[1])
    return r.ok ? json(res, 200, { delivery: r.delivery }) : json(res, r.status, { error: r.error }), true
  }

  return json(res, 404, { error: 'not found' }), true
}

/* ------------------------------------------------------------ public API --- */

function serveLogo(res, sha) {
  if (!/^[0-9a-f]{32}$/.test(sha)) return json(res, 404, { error: 'not found' }), true
  const logo = Object.values(db.merchants).find((m) => m.profile?.logo?.sha === sha)?.profile.logo
  let buf
  try {
    buf = logo ? fs.readFileSync(path.join(LOGO_DIR, `${sha}.img`)) : null
  } catch {
    buf = null
  }
  if (!buf) return json(res, 404, { error: 'not found' }), true
  res.writeHead(200, { 'Content-Type': logo.type, 'Content-Length': buf.length, 'Cache-Control': 'public, max-age=86400, immutable', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'" })
  res.end(buf)
  return true
}

/** Handles /api/pay/m/*. Returns true when it answered. */
export async function handleMerchantPay(req, res, url) {
  const p = url.pathname
  const ip = clientIp(req)
  if (p === '/api/pay/m/config') {
    const c = feeConfig()
    return json(res, 200, { feeBps: c.bps, feePct: c.bps / 100, freeUsd: usdNum(c.freeCents), minStatementUsd: usdNum(MIN_STATEMENT_CENTS), pauseAfterDays: PAUSE_AFTER_DAYS, chains: CHAIN_LIST.map((x) => ({ id: x.id, name: x.name })), assets: STORE_ASSET_IDS }, { 'Cache-Control': 'public, max-age=60' }), true
  }
  let m = p.match(/^\/api\/pay\/m\/logo\/([^/]+)$/)
  if (m) return req.method === 'GET' ? serveLogo(res, m[1]) : (json(res, 405, { error: 'GET only' }), true)

  m = p.match(/^\/api\/pay\/m\/l\/([^/]+)(?:\/(invoice))?$/)
  if (m) {
    const l = findLink(m[1])
    if (!m[2]) {
      if (req.method !== 'GET') return json(res, 405, { error: 'GET only' }), true
      if (!allow('m-read', ip, 600, 3_600_000)) return json(res, 429, { error: 'Too many requests. Try again later.' }), true
      if (!l) return json(res, 404, { error: 'No such payment link. Check the link you were given.' }), true
      if (allow('m-view', `${ip}:${l.id}`, 1, 30 * 60_000)) {
        l.views = (l.views ?? 0) + 1
        saveSoon()
      }
      return json(res, 200, { link: publicMerchantLink(l), viewer: await viewerOf(req, l.ws, { link: l }) }, { 'X-Robots-Tag': 'noindex' }), true
    }
    if (req.method !== 'POST') return json(res, 405, { error: 'POST only' }), true
    if (req.headers['x-requested-with'] !== 'gully') return json(res, 403, { error: 'Cross-site request refused.' }), true
    if (!l) return json(res, 404, { error: 'No such payment link. Check the link you were given.' }), true
    const body = await readJson(req, 1_000)
    const state = linkState(l)
    if (state !== 'active') return json(res, 409, { error: LINK_STATE_TEXT[state], state }), true
    const co = checkoutState(l.ws, null)
    if (!co.enabled) return json(res, co.paused ? 423 : 409, { error: co.reason, ...(co.paused ? { paused: true } : {}) }), true
    if (!allow('m-invoice', ip, 10, 3_600_000)) return json(res, 429, { error: 'Too many checkouts started from this address in the last hour. Try again later.' }), true
    let cents
    if (l.amount.type === 'fixed') cents = BigInt(l.amount.usdCents)
    else {
      cents = parseUsdCents(body?.usd)
      const min = BigInt(l.amount.minCents)
      const max = BigInt(l.amount.maxCents)
      if (cents == null || cents < min || cents > max) return json(res, 400, { error: `Enter an amount in dollars, with at most two decimals, from ${fmtUsd(min)} to ${fmtUsd(max)}.` }), true
    }
    const asset = body?.asset == null || body.asset === '' ? null : String(body.asset)
    if (asset && !l.assets.includes(asset)) return json(res, 400, { error: 'This link cannot be paid in that asset.' }), true
    if (!l.assets.some((a) => recipientOn(l.ws, assetById(a).chainId))) return json(res, 409, { error: 'This store has not set a receiving wallet for these assets yet.' }), true
    if (l.maxUses != null) {
      const open = db.invoices.filter((i) => i.linkId === l.id && invoiceState(i) === 'open').length
      if ((l.paidUses ?? 0) + open >= l.maxUses) return json(res, 409, { error: 'Every remaining use of this link is held by a checkout in progress. Try again within the hour.' }), true
    }
    const now = Date.now()
    const merchant = merchantOf(l.ws)
    const number = `INV-${String(++merchant.invoiceSeq).padStart(4, '0')}`
    const inv = newInvoice(l.ws, { number, title: l.title, items: [{ description: l.title, quantity: 1, unitCents: String(cents) }], usdCents: String(cents), customer: null, notes: l.description, dueAt: null, expiresAt: new Date(now + LINK_INVOICE_TTL_MS).toISOString(), assets: l.assets }, l.id)
    save()
    return json(res, 201, { invoice: publicMerchantInvoice(inv), path: `/pay/m/${inv.id}${asset ? `?asset=${encodeURIComponent(asset)}` : ''}` }), true
  }

  m = p.match(/^\/api\/pay\/m\/i\/([^/]+)(?:\/(quote|verify))?$/)
  if (!m) return json(res, 404, { error: 'not found' }), true
  const inv = findInvoice(m[1])
  if (!m[2]) {
    if (req.method !== 'GET') return json(res, 405, { error: 'GET only' }), true
    if (!allow('m-read', ip, 600, 3_600_000)) return json(res, 429, { error: 'Too many requests. Try again later.' }), true
    if (!inv) return json(res, 404, { error: 'No such invoice. Check the link you were given.' }), true
    if (allow('m-view', `${ip}:${inv.id}`, 1, 30 * 60_000)) {
      inv.views = (inv.views ?? 0) + 1
      inv.firstViewedAt ??= new Date().toISOString()
      saveSoon()
    }
    return json(res, 200, { invoice: publicMerchantInvoice(inv), viewer: await viewerOf(req, inv.ws, { inv }) }, { 'X-Robots-Tag': 'noindex' }), true
  }
  if (req.method !== 'POST') return json(res, 405, { error: 'POST only' }), true
  if (req.headers['x-requested-with'] !== 'gully') return json(res, 403, { error: 'Cross-site request refused.' }), true
  if (!inv) return json(res, 404, { error: 'No such invoice. Check the link you were given.' }), true
  const body = await readJson(req, 1_000)
  if (m[2] === 'quote') {
    if (!allow('m-quote', ip, 30, 3_600_000)) return json(res, 429, { error: 'Too many quotes asked for in the last hour. Try again later.' }), true
    const r = await quoteFor(inv, String(body?.asset ?? ''))
    return (r.ok ? json(res, 200, { quote: quoteView(r.quote) }) : json(res, r.status, { error: r.error, ...(r.paused ? { paused: true } : {}) }), true)
  }
  if (!allow('m-verify', ip, 120, 3_600_000)) return json(res, 429, { error: 'Too many payment checks in the last hour. Try again later.' }), true
  const r = await verifyFor(inv, body?.quoteId, body?.txHash)
  if (r.ok) return json(res, 200, { invoice: publicMerchantInvoice(inv) }), true
  return json(res, r.status, { error: r.error, ...(r.pending ? { pending: true, confirmations: r.confirmations, needed: r.needed } : {}) }), true
}

/* ------------------------------------------------------------- admin API --- */

export function adminMerchants(now = Date.now()) {
  const ids = new Set([...Object.keys(db.merchants), ...db.payments.map((p) => p.ws)])
  const since30 = now - 30 * DAY
  const rows = [...ids].map((ws) => {
    const m = peek(ws)
    const pays = db.payments.filter((p) => p.ws === ws)
    const fees = db.fees.filter((f) => f.ws === ws)
    const sts = db.statements.filter((s) => s.ws === ws).map((s) => statementView(s, now))
    const pick = (state) => sts.filter((s) => s.state === state)
    return {
      workspace: ws,
      name: brandOf(ws).name,
      chains: Object.entries(m?.wallets ?? {})
        .filter(([, w]) => w.enabled && w.status === 'ok')
        .map(([id]) => CHAINS[id]?.name ?? id),
      links: db.links.filter((l) => l.ws === ws).length,
      invoices: db.invoices.filter((i) => i.ws === ws && !i.linkId).length,
      payments: pays.length,
      volumeUsd: usdNum(sum(pays, (p) => p.usdCents)),
      volume30dUsd: usdNum(sum(pays.filter((p) => Date.parse(p.at) >= since30), (p) => p.usdCents)),
      feesAccruedUsd: usdNum(centsOfMicros(sum(fees, (f) => f.feeMicros))),
      feesCollectedUsd: usdNum(centsOfMicros(sum(fees, collectedOf))),
      feesUnbilledUsd: usdNum(centsOfMicros(sum(fees.filter((f) => !f.statementId), billableOf))),
      feesPaidUsd: usdNum(sum(pick('paid'), (s) => s.usdCents)),
      feesOpenUsd: usdNum(sum(pick('open'), (s) => s.usdCents)),
      feesOverdueUsd: usdNum(sum(pick('overdue'), (s) => s.usdCents)),
      feesWaivedUsd: usdNum(sum(pick('waived'), (s) => s.usdCents)),
      paused: pauseOf(ws, now).paused,
      lastPaymentAt: pays.at(-1)?.at ?? null,
      statements: sts.reverse().slice(0, 10),
    }
  })
  rows.sort((a, b) => b.volumeUsd - a.volumeUsd || a.name.localeCompare(b.name))
  const c = feeConfig()
  const total = (k) => Math.round(rows.reduce((a, r) => a + r[k], 0) * 100) / 100
  // Daily volume and fees across every store, for the admin chart (last 30 days).
  const start = Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth(), new Date(now).getUTCDate()) - 29 * DAY
  const dates = Array.from({ length: 30 }, (_, i) => new Date(start + i * DAY).toISOString().slice(0, 10))
  const volume = Array(30).fill(0)
  const fee = Array(30).fill(0)
  for (const p of db.payments) {
    const i = dates.indexOf(p.at.slice(0, 10))
    if (i < 0) continue
    volume[i] += usdNum(p.usdCents)
    fee[i] += usdNum(centsOfMicros(BigInt(p.feeMicros ?? '0')))
  }
  return {
    config: { feeBps: c.bps, freeUsd: usdNum(c.freeCents), pauseAfterDays: PAUSE_AFTER_DAYS, minStatementUsd: usdNum(MIN_STATEMENT_CENTS), lastStatementRun: db.lastStatementRun, nextStatementAt: new Date(weekStart(now) + 7 * DAY).toISOString() },
    totals: { merchants: rows.length, paused: rows.filter((r) => r.paused).length, volumeUsd: total('volumeUsd'), volume30dUsd: total('volume30dUsd'), feesAccruedUsd: total('feesAccruedUsd'), feesPaidUsd: total('feesPaidUsd'), feesOverdueUsd: total('feesOverdueUsd'), feesUnbilledUsd: total('feesUnbilledUsd') },
    series: { dates, volume: volume.map((v) => Math.round(v * 100) / 100), fees: fee.map((v) => Math.round(v * 100) / 100) },
    merchants: rows,
  }
}

/** /api/admin/merchants*; admin.mjs has checked the token. */
export function handleMerchantsAdmin(req, res, url) {
  const p = url.pathname
  if (p === '/api/admin/merchants') return req.method === 'GET' ? json(res, 200, adminMerchants()) : json(res, 405, { error: 'GET only' }), true
  if (p === '/api/admin/merchants/statements/run') {
    if (req.method !== 'POST') return json(res, 405, { error: 'POST only' }), true
    const issued = issueStatements(Date.now())
    return json(res, 200, { issued }), true
  }
  return json(res, 404, { error: 'not found' }), true
}
