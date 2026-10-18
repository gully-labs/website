// CSV exports for the app dashboard v2 (signed-in, read-only, scoped to the active workspace):
//   GET /api/developer/export/usage.csv?range=24h|7d|30d   per bucket and key: time, key, total, ok, client_err, limited, server_err
//   GET /api/developer/export/payments.csv                 the workspace owner's payments from the billing ledger
// Every cell is escaped: quoted when it holds a comma, quote or line break, and a text value starting
// with = + - @ (or a tab / carriage return) gets a leading ' so a spreadsheet does not run it as a formula.

import { usageRows } from './access.mjs'
import { ledger, paymentView } from './billing.mjs'
import { keysOf } from './store.mjs'

/** One CSV cell. Numbers are written as they are; text is formula-guarded and quoted when needed. */
export function csvCell(v) {
  if (v === null || v === undefined) return ''
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : ''
  if (typeof v === 'boolean') return v ? 'true' : 'false'
  let s = String(v)
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`
  if (/[",\r\n]/.test(s) || s !== s.trim()) s = `"${s.replace(/"/g, '""')}"`
  return s
}

export const csvLine = (cells) => cells.map(csvCell).join(',')
export const toCsv = (header, rows) => [csvLine(header), ...rows.map(csvLine)].join('\r\n') + '\r\n'

function sendCsv(res, filename, body) {
  res.writeHead(200, {
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  })
  res.end(body)
  return true
}

const RANGES = ['24h', '7d', '30d']
const today = () => new Date().toISOString().slice(0, 10)

/** The export routes; developer.mjs has checked the session and resolved ctx.workspace. */
export function handleExport(req, res, url, ctx) {
  if (req.method !== 'GET') {
    res.writeHead(405, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
    res.end(JSON.stringify({ error: 'GET only' }))
    return true
  }
  const ws = ctx.workspace
  if (url.pathname === '/api/developer/export/usage.csv') {
    const range = RANGES.includes(url.searchParams.get('range')) ? url.searchParams.get('range') : '24h'
    const keys = keysOf(ws)
    const names = Object.fromEntries(keys.map((k) => [k.id, k.name ?? k.project ?? k.prefix]))
    const rows = usageRows(keys.map((k) => k.id), range).map((r) => [r.t, names[r.keyId] ?? r.keyId, r.total, r.ok, r.client, r.limited, r.server])
    return sendCsv(res, `gully-usage-${range}-${today()}.csv`, toCsv(['time', 'key', 'total', 'ok', 'client_err', 'limited', 'server_err'], rows))
  }
  if (url.pathname === '/api/developer/export/payments.csv') {
    const rows = ledger()
      .payments.filter((p) => p.address === ws)
      .map(paymentView)
      .sort((a, b) => String(a.at).localeCompare(String(b.at)))
      .map((p) => [p.at, p.kind, p.plan, p.usd, p.amount, p.symbol, p.chain, p.txHash, p.from, p.periodStart, p.expiresAt, p.txUrl])
    return sendCsv(res, `gully-payments-${today()}.csv`, toCsv(['date', 'kind', 'plan', 'usd', 'amount', 'asset', 'chain', 'tx_hash', 'from', 'period_start', 'expires_at', 'explorer_url'], rows))
  }
  res.writeHead(404, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
  res.end(JSON.stringify({ error: 'not found' }))
  return true
}
