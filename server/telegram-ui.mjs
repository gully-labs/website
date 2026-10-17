// The Telegram bot's views: text and inline keyboards for every screen, the compact callback-route
// encoding, the 24h sparkline and the small per-chat view state. Pure: no Bot API call and no I/O here;
// telegram.mjs reads the data, picks the view and sends or edits the message.
//
// Navigation: every screen is one message edited in place. Each button carries its whole route in
// callback_data (at most 64 bytes), so a press works even after the in-memory state has expired:
//
//   m                          main menu                  noop          the "Page x/y" label
//   stk                        chain picker               stk:rh:p2     ticker grid, page 2
//   srch:rh                    search prompt (force_reply)
//   c:rh:NVDA:g2               stock card (from: g<page> grid, t top, m24/m1 movers, s search, x elsewhere)
//   al:rh:NVDA:g2[:2[:e]]      alert stepper: threshold → direction (e either, p premium, d discount) → summary
//   alx:rh:NVDA:g2             custom threshold prompt (force_reply)
//   alk:rh:NVDA:g2:2:e         create the alert
//   top                        top gaps                   mv:24h|mv:1h  movers
//   dc:0|dc:<chainId>          DeepCore launches (0 = every chain)
//   dl:<chainId>:<40 hex>:<f>  one launch                 dla:<f>[:<cid>]  launch-alert stepper   dlk:<cid> create
//   ma[:p2]                    my alerts                  ac:<id>       one alert
//   ap|ar|am|at:<id>           pause, resume, mute 24h, test        ad:<id> delete? → adx:<id> delete
//   ai                         Gully AI prompt (force_reply)        aiq:<n> an example question
//   set                        settings      smu mute all 24h      snt:0|1 usage notices      sul → suly unlink
//   mute:<id>                  Mute 24h on an alert delivery (kept from the first bot)
// A trailing "!" opens the route as a new message instead of editing (used on Gully AI answers, so an
// answer is never overwritten by the next screen).

export const SITE = 'https://gullylabs.xyz'
export const PORTAL = 'https://app.gullylabs.xyz'
export const PORTAL_ALERTS = `${PORTAL}/#alerts`
export const PORTAL_BILLING = `${PORTAL}/#billing`
export const DEEPCORE = 'https://deepcore.fun'
export const CHAIN_NAMES = { robinhood: 'Robinhood Chain', bsc: 'BNB Chain', solana: 'Solana' }
/** Tracker chain key <-> two-letter route code. */
export const CHAIN_OF = { rh: 'robinhood', bn: 'bsc', sl: 'solana' }
export const CODE_OF = { robinhood: 'rh', bsc: 'bn', solana: 'sl' }
/** The two-letter code of a chain named in a prompt (read back after a restart). */
export const codeOfName = (name) => (name === 'BNB Chain' ? 'bn' : name === 'Solana' ? 'sl' : 'rh')
export const GRID_PAGE = 12
export const LIST_MAX = 8
export const ALERTS_PAGE = 8
export const STATE_TTL_MS = 30 * 60_000

/* ------------------------------------------------------------ formatting --- */

/** HTML-escapes text for Telegram's HTML parse mode. */
export const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
export const chainName = (k) => CHAIN_NAMES[k] ?? k
export const stockUrl = (chain, ticker) => `${SITE}/tracker/${encodeURIComponent(chain)}/${encodeURIComponent(ticker)}`
const num = (n) => typeof n === 'number' && Number.isFinite(n)
export const signed = (n, d = 2) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n).toFixed(d)}`
export const usd = (n) => (num(n) ? `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : null)
export const usd0 = (n) => (num(n) ? `$${Math.round(n).toLocaleString('en-US')}` : null)
export const shortAddr = (a) => `${String(a).slice(0, 6)}…${String(a).slice(-4)}`
export const when = (iso) => new Date(iso).toISOString().replace('T', ' ').slice(0, 16) + ' UTC'
const shortChain = (k) => (k === 'robinhood' ? 'RH' : k === 'bsc' ? 'BNB' : k === 'solana' ? 'SOL' : k)

/** "just now", "4m ago", "2h ago", "3d ago". */
export function ago(iso, now = Date.now()) {
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return null
  const s = Math.max(0, Math.round((now - t) / 1000))
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86_400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86_400)}d ago`
}

/* -------------------------------------------------------------- buttons --- */

export const btn = (text, data) => ({ text, callback_data: data })
export const ubtn = (text, url) => ({ text, url })
/** The [⬅ Back] [🏠 Menu] row every screen ends with. */
export const nav = (back) => [btn('⬅ Back', back), btn('🏠 Menu', 'm')]
const rows = (list, per) => {
  const out = []
  for (let i = 0; i < list.length; i += per) out.push(list.slice(i, i + per))
  return out
}

/** Every callback_data in a keyboard (tests check each is at most 64 bytes). */
export const callbackDataOf = (kb) => (kb ?? []).flat().map((b) => b.callback_data).filter((d) => d !== undefined)

/* ------------------------------------------------------------ main menu --- */

export const MENU_KEYBOARD = [
  [btn('📈 Stocks', 'stk'), btn('🔥 Top gaps', 'top')],
  [btn('🚀 Movers', 'mv:24h'), btn('🛰 DeepCore launches', 'dc:0')],
  [btn('🔔 My alerts', 'ma'), btn('🤖 Gully AI', 'ai')],
  [ubtn('💼 Developer portal ↗', PORTAL), btn('⚙️ Settings', 'set')],
]

/** The /start banner caption. `n` is the tracker's live count of stock tokens, or null when unreadable. */
export function menuCaption(n) {
  const count = num(n) && n > 0 ? `${n} stock tokens` : 'Stock tokens'
  return [
    '<b>Gully Labs</b> · stock tokens vs their fair price, live.',
    `📈 ${count} on Robinhood Chain, BNB Chain and Solana · 🔔 gap alerts right here · 🤖 Gully AI answers.`,
    '',
    '<i>Information only, not investment advice.</i>',
  ].join('\n')
}

/** The menu as a text screen (Menu pressed anywhere but on the banner). */
export const menuView = (n) => ({ text: `${menuCaption(n)}\n\nPick a screen below.`, keyboard: MENU_KEYBOARD })

export function helpView(linked) {
  const text = [
    '<b>Gully Labs bot</b>',
    'The gap between a tokenised stock’s on-chain price and its Chainlink fair price, from the Gully Labs tracker. Everything is behind the buttons below; typed commands still work:',
    '',
    '/gap NVDA · one stock (add <code>bsc</code>, <code>robinhood</code> or <code>solana</code>)',
    '/top · widest trusted gaps now',
    '/movers · biggest gap moves',
    '/launches · latest DeepCore launches',
    '/ask · a question for Gully AI',
    ...(linked ? ['/alerts · your alerts', '/stop · unlink this chat'] : ['Alerts: link your wallet in the developer portal, Alerts tab, Connect Telegram.']),
    '',
    '<i>Information only, not investment advice.</i>',
  ].join('\n')
  return { text, keyboard: MENU_KEYBOARD }
}

export const expiredView = () => ({ text: '<b>This menu expired</b>, here’s a fresh one.', keyboard: MENU_KEYBOARD })

/* --------------------------------------------------------------- status --- */

/** The card's status emoji and, for ⚪, why the gap is not counted. */
export function statusOf(r) {
  if (!r) return { emoji: '⚪', label: 'no reading', reason: 'The tracker has no reading for this stock right now.' }
  if (r.status === 'feed-unreadable') return { emoji: '⚪', label: 'unreadable', reason: 'The fair price (Chainlink feed) could not be read just now.' }
  if (r.status === 'pool-unreadable') return { emoji: '⚪', label: 'unreadable', reason: 'The pool could not be read just now.' }
  if (r.status === 'no-pool') return { emoji: '⚪', label: 'no pool', reason: 'No pool was found for this token.' }
  if (r.status === 'unverified') return { emoji: '⚪', label: 'unverified', reason: `Unverified: ${r.untrustedReason ?? 'the on-chain price could not be confirmed.'}` }
  if (!num(r.gapPct)) return { emoji: '⚪', label: 'unreadable', reason: 'The gap could not be read just now.' }
  if (r.status === 'thin') return { emoji: '⚪', label: 'thin', reason: 'The pool is too thin for the tracker to flag this gap.' }
  if (r.poolStale) return { emoji: '⚪', label: 'stale', reason: 'The pool read is stale; this gap is not current.' }
  if (r.status === 'in-line') return { emoji: '🟢', label: 'in line', reason: null }
  if (r.status === 'drifting') return { emoji: '🟡', label: 'drifting', reason: null }
  if (r.status === 'premium' || r.status === 'discount') return { emoji: '🔴', label: r.status, reason: null }
  return { emoji: '⚪', label: String(r.status ?? 'unknown'), reason: null }
}

/** Ranked like /top: a trusted status, a readable gap, a fresh read and an open feed session. */
const TRUSTED = new Set(['in-line', 'drifting', 'premium', 'discount'])
export const trustedNow = (r) => TRUSTED.has(r.status) && num(r.gapPct) && !r.poolStale && r.sessionOpen !== false

/* ------------------------------------------------------------ sparkline --- */

const BLOCKS = '▁▂▃▄▅▆▇█'

/**
 * A 24-hour sparkline of the gap from tracker history points [unixSeconds, gapPct, onchain, fair].
 * One character per hour (24); an hour with no snapshot is a space. Null below two readable points.
 */
export function sparkline(points, now = Date.now(), hours = 24) {
  const from = now / 1000 - hours * 3600
  const pts = (points ?? []).filter((p) => Array.isArray(p) && p[0] >= from && num(p[1]))
  if (pts.length < 2) return null
  const buckets = Array.from({ length: hours }, () => [])
  for (const p of pts) buckets[Math.min(hours - 1, Math.max(0, Math.floor((p[0] - from) / 3600)))].push(p[1])
  const vals = buckets.map((b) => (b.length ? b[b.length - 1] : null))
  const all = pts.map((p) => p[1])
  const min = Math.min(...all)
  const max = Math.max(...all)
  const span = max - min
  const line = vals.map((v) => (v === null ? ' ' : span < 1e-9 ? BLOCKS[3] : BLOCKS[Math.round(((v - min) / span) * 7)])).join('')
  // Trim leading hours with no data, so a young series starts at its first point.
  return { line: line.replace(/^ +/, ''), min, max, points: pts.length }
}

/* --------------------------------------------------------------- stocks --- */

export const fromOk = (f) => /^(g\d{1,2}|t|m24|m1|s|x)$/.test(f)
/** Where a stock card's Back goes, from its origin code. */
export function cardBack(cc, from) {
  if (/^g\d+$/.test(from)) return `stk:${cc}:p${from.slice(1)}`
  if (from === 't') return 'top'
  if (from === 'm24') return 'mv:24h'
  if (from === 'm1') return 'mv:1h'
  if (from === 's') return `stk:${cc}:p1`
  return 'm'
}

export function chainPickerView(stocks, rowsOk) {
  const count = (k) => stocks.filter((s) => s.chain === k).length
  const text = ['<b>📈 Stocks</b>', 'Pick a chain to see its stock tokens and their gap to the fair price.', ...(rowsOk ? [] : ['', '<i>The tracker could not be read just now; status colours are missing.</i>'])].join('\n')
  return { text, keyboard: [[btn(`Robinhood Chain · ${count('robinhood')}`, 'stk:rh:p1'), btn(`BNB Chain · ${count('bsc')}`, 'stk:bn:p1')], [btn(`Solana · ${count('solana')}`, 'stk:sl:p1')], nav('m')] }
}

/** The ticker grid: 3 per row, alphabetical, GRID_PAGE per page, status colour from the live rows. */
export function gridView(cc, page, stocks, rowsList) {
  const chain = CHAIN_OF[cc]
  const list = stocks.filter((s) => s.chain === chain).sort((a, b) => a.ticker.localeCompare(b.ticker))
  const pages = Math.max(1, Math.ceil(list.length / GRID_PAGE))
  const p = Math.min(Math.max(1, page), pages)
  const shown = list.slice((p - 1) * GRID_PAGE, p * GRID_PAGE)
  const byTicker = new Map((rowsList ?? []).filter((r) => r.chain === chain).map((r) => [r.ticker, r]))
  const keys = shown.map((s) => btn(`${rowsList ? statusOf(byTicker.get(s.ticker)).emoji + ' ' : ''}${s.ticker}`, `c:${cc}:${s.ticker}:g${p}`))
  const text = [
    `<b>📈 ${esc(chainName(chain))}</b> · ${list.length} stock tokens`,
    rowsList ? '🟢 in line · 🟡 drifting · 🔴 premium or discount · ⚪ thin, stale or unverified' : '<i>The tracker could not be read just now; tap a ticker to try again.</i>',
    'Tap a ticker for its card.',
  ].join('\n')
  const pager = pages > 1 ? [[btn('◀', `stk:${cc}:p${p === 1 ? pages : p - 1}`), btn(`Page ${p}/${pages}`, 'noop'), btn('▶', `stk:${cc}:p${p === pages ? 1 : p + 1}`)]] : []
  return { text, keyboard: [...rows(keys, 3), ...pager, [btn('🔍 Search', `srch:${cc}`)], nav('stk')] }
}

export const searchPrompt = (cc) => `🔍 Search ${chainName(CHAIN_OF[cc])}: type a ticker or a company name, e.g. NVDA.`
export const SEARCH_PROMPT_RE = /^🔍 Search (Robinhood Chain|BNB Chain|Solana):/

/** Search: an exact ticker opens its card (caller); otherwise matches on ticker or name. */
export function searchMatches(cc, query, stocks) {
  const chain = CHAIN_OF[cc]
  const q = String(query).trim().replace(/^\$/, '').toUpperCase().slice(0, 40)
  const list = stocks.filter((s) => s.chain === chain)
  const exact = list.find((s) => s.ticker === q)
  if (exact) return { exact, list: [exact] }
  const hits = list.filter((s) => q && (s.ticker.startsWith(q) || s.ticker.includes(q) || String(s.name ?? '').toUpperCase().includes(q))).sort((a, b) => a.ticker.localeCompare(b.ticker))
  return { exact: null, list: hits.slice(0, GRID_PAGE) }
}

export function searchResultsView(cc, query, hits) {
  const chain = chainName(CHAIN_OF[cc])
  if (!hits.length) return { text: `No stock token on ${esc(chain)} matches “${esc(query)}”.`, keyboard: [[btn('🔍 Search again', `srch:${cc}`)], nav(`stk:${cc}:p1`)] }
  return { text: `<b>🔍 ${esc(chain)}</b> · ${hits.length} match${hits.length === 1 ? '' : 'es'} for “${esc(query)}”`, keyboard: [...rows(hits.map((s) => btn(s.ticker, `c:${cc}:${s.ticker}:s`)), 3), [btn('🔍 Search again', `srch:${cc}`)], nav(`stk:${cc}:p1`)] }
}

/** The stock card. `spark` is sparkline()'s result or null; `now` for "updated Xm ago". */
export function cardView({ cc, ticker, from, row, name, spark, now = Date.now() }) {
  const chain = CHAIN_OF[cc]
  const st = statusOf(row)
  const lines = [`${st.emoji} <b>${esc(ticker)}</b> · ${esc(chainName(chain))}`]
  if (name ?? row?.name) lines.push(`<i>${esc(name ?? row.name)}</i>`)
  lines.push('')
  if (!row) lines.push(esc(st.reason))
  else {
    if (num(row.gapPct) && row.status !== 'unverified') lines.push(`Gap <b>${esc(signed(row.gapPct))}%</b> · ${esc(st.label)}`)
    else lines.push(`Gap <b>unreadable</b> · ${esc(st.label)}`)
    lines.push(`On chain ${esc(usd(row.onchain) ?? 'unreadable')} · fair ${esc(usd(row.fair) ?? 'unreadable')}`)
    const liq = usd0(row.pool?.liquidityUsd)
    lines.push(liq ? `Pool liquidity ${esc(liq)}` : 'Pool liquidity not reported')
    if (st.reason) lines.push(`⚪ ${esc(st.reason)}`)
    if (row.sessionOpen === false) lines.push('🌙 The feed session is closed: the gap is against the last session’s price.')
    else if (row.sessionOpen === true) lines.push(`☀️ Feed session open${row.sessionName ? ` (${esc(row.sessionName)})` : ''}.`)
    else lines.push('Feed session not reported.')
  }
  lines.push('')
  if (spark) {
    lines.push(`24h gap <code>${esc(spark.line)}</code>`)
    lines.push(`low ${esc(signed(spark.min))}% · high ${esc(signed(spark.max))}%`)
  } else lines.push('<i>24h gap: not enough history yet.</i>')
  const at = row?.asOf ?? row?.onchainAt ?? null
  const a = at ? ago(at, now) : null
  lines.push(`<i>${a ? `Updated ${esc(a)}` : 'Update time not reported'} · information only, not investment advice.</i>`)
  return {
    text: lines.join('\n'),
    keyboard: [[btn('🔔 Alert me', `al:${cc}:${ticker}:${from}`), btn('🔄 Refresh', `c:${cc}:${ticker}:${from}`)], [ubtn('🌐 Open page ↗', stockUrl(chain, ticker)), ...nav(cardBack(cc, from))]],
  }
}

/** /gap TICKER on both chains: pick one. */
export function bothChainsView(ticker, found) {
  return {
    text: `<b>${esc(ticker)}</b> trades on ${found.length} chains. Pick one.`,
    keyboard: [...found.map(({ chain, row }) => [btn(`${statusOf(row).emoji} ${ticker} · ${chainName(chain)}${row && num(row.gapPct) && row.status !== 'unverified' ? ` ${signed(row.gapPct)}%` : ''}`, `c:${CODE_OF[chain]}:${ticker}:x`)]), nav('stk')],
  }
}

/* --------------------------------------------------------------- alerts --- */

export const linkNeededView = (back, what = 'Alerts') => ({
  text: [`<b>🔔 ${esc(what)} need a linked account</b>`, 'Link this chat to your wallet once: open the developer portal, Alerts tab, press <b>Connect Telegram</b> and follow the link back here. Then alerts are one tap away.'].join('\n'),
  keyboard: [[ubtn('🔗 Link wallet ↗', PORTAL_ALERTS)], nav(back)],
})

export const DIRS = { e: 'Either way', p: 'Premium', d: 'Discount' }
const pctText = (p) => String(Number(p))

/** The condition the stepper's choice becomes (alerts.mjs supports |gap| ≥ X%, or a status flag). */
export function conditionFor(pct, dir, flagPct) {
  if (dir === 'p') return { condition: { type: 'status', status: 'premium' }, text: `the tracker flags a premium (gap of +${flagPct}% or more)` }
  if (dir === 'd') return { condition: { type: 'status', status: 'discount' }, text: `the tracker flags a discount (gap of −${flagPct}% or more)` }
  return { condition: { type: 'gap', pct: Number(pct) }, text: `the gap reaches ±${pctText(pct)}% either way` }
}

export function alertStep1View(cc, ticker, from) {
  const base = `al:${cc}:${ticker}:${from}`
  return {
    text: [`<b>🔔 Alert for ${esc(ticker)}</b> · ${esc(chainName(CHAIN_OF[cc]))}`, 'Step 1 of 3 · How wide a gap to the fair price?'].join('\n'),
    keyboard: [[btn('±1%', `${base}:1`), btn('±2%', `${base}:2`), btn('±3%', `${base}:3`), btn('✏️ Custom', `alx:${cc}:${ticker}:${from}`)], nav(`c:${cc}:${ticker}:${from}`)],
  }
}

export function alertStep2View(cc, ticker, from, pct, flagPct) {
  const base = `al:${cc}:${ticker}:${from}:${pctText(pct)}`
  return {
    text: [
      `<b>🔔 Alert for ${esc(ticker)}</b> · ±${esc(pctText(pct))}%`,
      'Step 2 of 3 · Which direction?',
      `<i>Premium and Discount follow the tracker’s own flag (±${flagPct}%); a one-sided custom threshold is not available yet.</i>`,
    ].join('\n'),
    keyboard: [[btn('Either way', `${base}:e`), btn('Premium', `${base}:p`), btn('Discount', `${base}:d`)], nav(`al:${cc}:${ticker}:${from}`)],
  }
}

export function alertStep3View(cc, ticker, from, pct, dir, flagPct) {
  const c = conditionFor(pct, dir, flagPct)
  return {
    text: [`<b>🔔 Alert for ${esc(ticker)}</b> · ${esc(chainName(CHAIN_OF[cc]))}`, 'Step 3 of 3 · Check and create', '', `Fires when ${esc(c.text)}.`, 'Delivered to this chat, at most once every 30 minutes, with a Mute 24h button.'].join('\n'),
    keyboard: [[btn('✅ Create', `alk:${cc}:${ticker}:${from}:${pctText(pct)}:${dir}`), btn('⬅ Back', `al:${cc}:${ticker}:${from}:${pctText(pct)}`)], [btn('🏠 Menu', 'm')]],
  }
}

export const customPctPrompt = (cc, ticker) => `✏️ Custom threshold for ${ticker} on ${chainName(CHAIN_OF[cc])}: type a percentage from 0.1 to 100, e.g. 1.5.`
export const CUSTOM_PROMPT_RE = /^✏️ Custom threshold for ([A-Z.]{1,8}) on (Robinhood Chain|BNB Chain|Solana):/

/** After a create: success, the plan limit (with Upgrade) or the alerts module's error. */
export function createdView({ ok, status, error, back, what }) {
  if (ok) return { text: [`<b>✅ Alert created</b>`, esc(what), 'Deliveries arrive in this chat. Manage it in 🔔 My alerts.'].join('\n'), keyboard: [[btn('🔔 My alerts', 'ma')], nav(back)] }
  if (status === 403) return { text: [`<b>Plan limit reached</b>`, esc(error)].join('\n'), keyboard: [[ubtn('⬆ Upgrade ↗', PORTAL_BILLING), btn('🔔 My alerts', 'ma')], nav(back)] }
  return { text: [`<b>The alert was not created</b>`, esc(error ?? 'Something went wrong. Try again in a minute.')].join('\n'), keyboard: [nav(back)] }
}

/* ------------------------------------------------------------ top gaps --- */

export function topView(rowsList) {
  if (!rowsList) return { text: '<b>🔥 Top gaps</b>\nThe tracker could not be read just now. Try again in a minute.', keyboard: [[btn('🔄 Refresh', 'top')], nav('m')] }
  const ok = rowsList.filter(trustedNow).sort((a, b) => Math.abs(b.gapPct) - Math.abs(a.gapPct)).slice(0, LIST_MAX)
  const closed = rowsList.filter((r) => r.sessionOpen === false).length
  const closedText = closed ? `\n<i>${closed === 1 ? '1 stock is' : `${closed} stocks are`} outside the feed session and not ranked.</i>` : ''
  if (!ok.length) return { text: `<b>🔥 Top gaps</b>\nNo stock has a trusted gap right now (a readable feed and pool, a deep enough pool, a fresh read and an open feed session).${closedText}`, keyboard: [[btn('🔄 Refresh', 'top')], nav('m')] }
  const keys = ok.map((r, i) => [btn(`${i + 1}. ${statusOf(r).emoji} ${r.ticker} · ${shortChain(r.chain)}  ${signed(r.gapPct)}%`, `c:${CODE_OF[r.chain]}:${r.ticker}:t`)])
  return { text: `<b>🔥 Top gaps now</b>\nThe widest trusted gaps to the fair price. Tap one for its card.${closedText}`, keyboard: [...keys, [btn('🔄 Refresh', 'top')], nav('m')] }
}

/* -------------------------------------------------------------- movers --- */

export function moversView(m, win) {
  const toggles = [btn(win === '24h' ? '• 24h •' : '24h', 'mv:24h'), btn(win === '1h' ? '• 1h •' : '1h', 'mv:1h'), btn('🔄 Refresh', `mv:${win}`)]
  const list = Array.isArray(m?.byGap) ? m.byGap.slice(0, LIST_MAX) : null
  const head = `<b>🚀 Movers · ${win}</b>`
  if (!list) return { text: `${head}\nMovers could not be read just now. Try again in a minute.`, keyboard: [toggles, nav('m')] }
  if (!list.length) return { text: `${head}\n${esc(m.note ?? `Not enough snapshots yet to compare with ${win} ago.`)}`, keyboard: [toggles, nav('m')] }
  const from = win === '1h' ? 'm1' : 'm24'
  const keys = list.map((e, i) => [btn(`${i + 1}. ${e.ticker} · ${shortChain(e.chain)}  ${signed(e.gapChangePp)} pp → ${signed(e.gapNow)}%`, `c:${CODE_OF[e.chain] ?? 'rh'}:${e.ticker}:${from}`)])
  return { text: `${head}\nThe biggest changes in the gap over ${win} (percentage points), and the gap now. Tap one for its card.`, keyboard: [...keys, toggles, nav('m')] }
}

/* ------------------------------------------------------------- DeepCore --- */

/** One DeepCore launch, in the bot's style: token, chain, time, pools and locks as DeepCore states them. */
export function launchBlock(l) {
  const head = `<b>${esc(l.symbol ?? shortAddr(l.token))}</b> · ${esc(l.chainName)} · ${esc(when(l.createdAt))}`
  const legs = (l.pools ?? l.legs ?? []).map((g) => {
    const lock = g.locked === true ? `liquidity locked${g.lockId ? ` (lock #${esc(g.lockId)})` : ''}` : g.locked === false ? 'no liquidity lock' : 'lock not reported'
    return `${esc(g.kind ?? 'Pool')} pool vs ${esc(g.quote ?? '?')} · ${lock}`
  })
  return [head, legs.length ? legs.join('\n') : 'Pool not reported', `<a href="${esc(l.links.token)}">${esc(`deepcore.fun/tokens/${shortAddr(l.token)}`)}</a> · <a href="${esc(l.links.swap)}">swap on DeepCore</a>`].join('\n')
}

const hhmm = (iso) => new Date(iso).toISOString().slice(5, 16).replace('T', ' ')

export function launchesView(r, filter, chains) {
  const f = Number(filter) || 0
  const filters = rows([btn(f === 0 ? '• All •' : 'All', 'dc:0'), ...Object.entries(chains).map(([id, c]) => btn(Number(id) === f ? `• ${c.name} •` : c.name, `dc:${id}`))], 3)
  const tail = [[btn('🔔 Alert me on new launches', `dla:${f}`)], [btn('🔄 Refresh', `dc:${f}`), ...nav('m')]]
  const where = f ? ` on ${esc(chains[f]?.name ?? f)}` : ''
  const head = `<b>🛰 DeepCore launches${where}</b>`
  if (!r || r.state === 'unreadable') return { text: `${head}\nDeepCore’s launches could not be read just now. Try again in a minute.`, keyboard: [...filters, ...tail] }
  const notes = []
  if (r.state === 'stale') notes.push(`<i>DeepCore could not be read just now; this is the list as of ${esc(when(r.asOf))}.</i>`)
  const unread = (r.chains ?? []).filter((c) => c.status !== 'ok' && (!f || c.chainId === f)).map((c) => esc(c.name))
  if (unread.length) notes.push(`<i>DeepCore could not read ${unread.join(', ')}; launches there may be missing.</i>`)
  if (!r.launches.length) return { text: [`${head}`, `No launches on DeepCore${where} yet.`, ...notes].join('\n'), keyboard: [...filters, ...tail] }
  const keys = r.launches.slice(0, LIST_MAX).map((l) => [btn(`${l.symbol ?? shortAddr(l.token)} · ${l.chainName} · ${hhmm(l.createdAt)}`.slice(0, 60), `dl:${l.chainId}:${String(l.token).slice(2).toLowerCase()}:${f}`)])
  return { text: [head, 'The newest tokens launched on deepcore.fun. Tap one for its pools and locks.', ...notes, `<i>Read from api.deepcore.fun${r.asOf ? ` at ${esc(when(r.asOf))}` : ''}. Information only.</i>`].join('\n'), keyboard: [...keys, ...filters, ...tail] }
}

export function launchCardView(l, filter) {
  if (!l) return { text: '<b>🛰 Launch</b>\nThis launch is no longer in DeepCore’s latest list.', keyboard: [[ubtn('🌐 Open DeepCore ↗', DEEPCORE)], nav(`dc:${filter}`)] }
  return { text: `🛰 ${launchBlock(l)}\n\n<i>Information only, not investment advice.</i>`, keyboard: [[ubtn('🌐 Open on DeepCore ↗', l.links.token)], [btn('🔔 Alert me on new launches', `dla:${filter}`)], nav(`dc:${filter}`)] }
}

export function launchAlertStep1View(filter, chains) {
  return {
    text: '<b>🔔 New-launch alert</b>\nStep 1 of 2 · Which chain? Every new DeepCore launch there arrives in this chat.',
    keyboard: [...rows([btn('Any chain', `dla:${filter}:0`), ...Object.entries(chains).map(([id, c]) => btn(c.name, `dla:${filter}:${id}`))], 3), nav(`dc:${filter}`)],
  }
}

export function launchAlertStep2View(filter, cid, chains) {
  const where = cid ? chains[cid]?.name ?? `chain ${cid}` : 'any chain'
  return {
    text: ['<b>🔔 New-launch alert</b>', 'Step 2 of 2 · Check and create', '', `Fires on every new DeepCore launch on ${esc(where)}. Launches within 5 minutes of the last message arrive together.`].join('\n'),
    keyboard: [[btn('✅ Create', `dlk:${cid}`), btn('⬅ Back', `dla:${filter}`)], [btn('🏠 Menu', 'm')]],
  }
}

/* ------------------------------------------------------------ my alerts --- */

const alertLabel = (a, chains) => a.name || (a.kind === 'deepcore-launch' ? `DeepCore launches${a.condition?.chainId ? ` · ${chains[a.condition.chainId]?.name ?? a.condition.chainId}` : ''}` : a.ticker ? `${a.ticker} · ${chainName(a.chain)}` : 'Any stock')
export function alertState(a, now = Date.now()) {
  if (!a.coveredByPlan) return { emoji: '⚠️', text: 'not in your plan' }
  if (!a.enabled) return { emoji: '⏸', text: 'paused' }
  if (a.mutedUntil && Date.parse(a.mutedUntil) > now) return { emoji: '🔕', text: `muted until ${when(a.mutedUntil)}` }
  if (a.kind !== 'deepcore-launch' && !a.armed) return { emoji: '🟠', text: 'fired, waits to re-arm' }
  return { emoji: '🟢', text: 'watching' }
}
export const conditionWords = (c, chains) => (c.type === 'deepcore-launch' ? `new DeepCore launch on ${c.chainId ? (chains[c.chainId]?.name ?? `chain ${c.chainId}`) : 'any chain'}` : c.type === 'gap' ? `gap of ${c.pct}% or more either way` : c.status === 'either' ? 'status premium or discount' : `status ${c.status}`)

export function myAlertsView(data, page, chains, now = Date.now()) {
  const list = data.alerts
  const lim = data.limits
  const head = `<b>🔔 My alerts</b> · ${list.length} of ${lim.max} on ${esc(lim.planName)}`
  if (!list.length) return { text: `${head}\nNo alerts yet. Open a stock card and press 🔔 Alert me, or alert on new DeepCore launches.`, keyboard: [[btn('📈 Stocks', 'stk'), btn('🛰 Launches', 'dc:0')], nav('m')] }
  const pages = Math.max(1, Math.ceil(list.length / ALERTS_PAGE))
  const p = Math.min(Math.max(1, page), pages)
  const shown = list.slice((p - 1) * ALERTS_PAGE, p * ALERTS_PAGE)
  const keys = shown.map((a) => [btn(`${alertState(a, now).emoji} ${alertLabel(a, chains)}`.slice(0, 60), `ac:${a.id}`)])
  const pager = pages > 1 ? [[btn('◀', `ma:p${p === 1 ? pages : p - 1}`), btn(`Page ${p}/${pages}`, 'noop'), btn('▶', `ma:p${p === pages ? 1 : p + 1}`)]] : []
  const over = list.length > lim.max ? `\n<i>Only the oldest ${lim.max} run on your plan.</i>` : ''
  return { text: `${head}\n🟢 watching · 🟠 fired · 🔕 muted · ⏸ paused${over}\nTap an alert to pause, mute, test or delete it.`, keyboard: [...keys, ...pager, [ubtn('💼 Manage in portal ↗', PORTAL_ALERTS)], nav('m')] }
}

export function alertCardView(a, chains, now = Date.now()) {
  const st = alertState(a, now)
  const last = a.deliveries?.[0]
  const lines = [
    `${st.emoji} <b>${esc(alertLabel(a, chains))}</b>`,
    `When: ${esc(conditionWords(a.condition, chains))}`,
    `State: ${esc(st.text)}`,
    `Delivery: ${[a.telegram ? 'Telegram' : null, a.webhook ? 'webhook' : null].filter(Boolean).join(' + ') || 'none'}`,
    `Last fired: ${a.lastFiredAt ? esc(when(a.lastFiredAt)) : 'never'}`,
    ...(last ? [`Last delivery: ${last.ok ? '✅' : '❌'} ${esc(last.channel)}${last.test ? ' (test)' : ''} · ${esc(when(last.at))}${last.ok ? '' : ` · ${esc(last.error ?? 'failed')}`}`] : []),
  ]
  const toggle = a.enabled ? btn('⏸ Pause', `ap:${a.id}`) : btn('▶ Resume', `ar:${a.id}`)
  return { text: lines.join('\n'), keyboard: [[toggle, btn('🔕 Mute 24h', `am:${a.id}`)], [btn('🧪 Test', `at:${a.id}`), btn('🗑 Delete', `ad:${a.id}`)], nav('ma')] }
}

export const deleteConfirmView = (a, chains) => ({
  text: `<b>🗑 Delete “${esc(alertLabel(a, chains))}”?</b>\nThis cannot be undone; deliveries stop at once.`,
  keyboard: [[btn('🗑 Yes, delete', `adx:${a.id}`), btn('⬅ Back', `ac:${a.id}`)], [btn('🏠 Menu', 'm')]],
})

/* ------------------------------------------------------------ Gully AI --- */

export const AI_PROMPT = '🤖 Ask Gully AI: type your question about Gully Labs, the tracker, alerts or plans.'
export const AI_PROMPT_RE = /^🤖 Ask Gully AI:/
export const AI_EXAMPLES = ['How do gap alerts work?', 'What does the gap measure?', 'What do the plans include?']

export function aiIntroView() {
  return {
    text: ['<b>🤖 Gully AI</b>', 'Answers from the Gully Labs docs, with sources. Type your question in the reply box below, or tap an example.', '', '<i>Information only, not investment advice.</i>'].join('\n'),
    keyboard: [...AI_EXAMPLES.map((q, i) => [btn(`❓ ${q}`, `aiq:${i}`)]), nav('m')],
  }
}

/** Gully AI's answer: text plus up to 3 source buttons. */
export function aiAnswerView(r) {
  if (!r.ok) return { text: `<b>🤖 Gully AI</b>\n${esc(r.error)}`, keyboard: [[btn('💬 Ask another', 'ai!'), btn('🏠 Menu', 'm!')]] }
  const body = esc(String(r.answer).replace(/\*\*([^*]+)\*\*/g, '$1'))
  const sources = (r.citations ?? []).filter((c) => /^https:\/\//.test(String(c.url))).slice(0, 3)
  return {
    text: `<b>🤖 Gully AI</b>\n${body}${sources.length ? `\n\n<b>Sources</b>\n${sources.map((c) => `[${c.n}] ${esc(c.title)}`).join('\n')}` : ''}\n\n<i>Information only, not investment advice.</i>`,
    keyboard: [...sources.map((c) => [ubtn(`📄 [${c.n}] ${String(c.title).slice(0, 48)} ↗`, c.url)]), [btn('💬 Ask another', 'ai!'), btn('🏠 Menu', 'm!')]],
  }
}

/* ------------------------------------------------------------ settings --- */

export function settingsView({ link, workspace, notify, alertsCount, isLinker }) {
  if (!link) return { text: '<b>⚙️ Settings</b>\nThis chat is not linked to a wallet. Link it in the developer portal (Alerts tab, Connect Telegram) to get alerts here.', keyboard: [[ubtn('🔗 Link wallet ↗', PORTAL_ALERTS)], nav('m')] }
  const lines = [
    '<b>⚙️ Settings</b>',
    `Wallet: <code>${esc(shortAddr(link.address))}</code>`,
    ...(workspace ? [`Workspace: ${esc(workspace)}`] : []),
    `Chat: ${link.chatType === 'private' ? 'this private chat' : `group “${esc(link.chatTitle)}”${isLinker ? ' (linked by you)' : ''}`}`,
    `Alerts: ${alertsCount === null ? 'unreadable' : alertsCount}`,
    ...(notify ? [`Usage notices: ${notify.telegramUsage ? 'on' : 'off'}`] : []),
  ]
  return {
    text: lines.join('\n'),
    keyboard: [
      [btn('🔕 Mute all 24h', 'smu')],
      ...(notify ? [[btn(notify.telegramUsage ? '📣 Usage notices: on → off' : '📣 Usage notices: off → on', `snt:${notify.telegramUsage ? 0 : 1}`)]] : []),
      [btn('🔓 Unlink', 'sul')],
      nav('m'),
    ],
  }
}

export const unlinkConfirmView = (link) => ({
  text: `<b>🔓 Unlink this chat from ${esc(shortAddr(link.address))}?</b>\nAlerts stop arriving here. You can link again from the developer portal at any time.`,
  keyboard: [[btn('🔓 Yes, unlink', 'suly'), btn('⬅ Back', 'set')], [btn('🏠 Menu', 'm')]],
})

/* ----------------------------------------------------- alert deliveries --- */

/**
 * One alert delivery as a compact card: status emoji, ticker, chain, gap, prices and liquidity, with
 * [🌐 Open ↗] [🔕 Mute 24h] [📈 Card] (Card opens the stock card in place). Launch alerts list the
 * launches with Open on DeepCore buttons. A test is plain text.
 * @param {{ alertId: string, name: string | null, conditionText: string, events: object[], test: boolean }} a
 */
export function deliveryView(a) {
  const title = `<b>Gully Labs alert</b>${a.name ? ` “${esc(a.name)}”` : ''}`
  const mute = btn('🔕 Mute 24h', `mute:${a.alertId}`.slice(0, 64))
  if (a.test) return { text: `🧪 ${title}\nTest message (${esc(a.conditionText)}). Deliveries for this alert reach this chat.`, keyboard: null }
  if (a.events.some((e) => e.kind === 'deepcore.launch')) {
    const shown = a.events.slice(0, 5)
    const text = `🛰 ${title}\n${esc(a.conditionText)}\n\n${shown.map(launchBlock).join('\n\n')}${a.events.length > shown.length ? `\n…and ${a.events.length - shown.length} more on deepcore.fun` : ''}`
    const open = shown.slice(0, 3).map((e) => ubtn(`🌐 Open ${e.symbol ?? 'token'} on DeepCore ↗`.slice(0, 48), e.links.token))
    return { text, keyboard: [...(open.length ? [open] : []), [mute]] }
  }
  const shown = a.events.slice(0, 5)
  const blocks = shown.map((e) => {
    const st = statusOf({ status: e.status, gapPct: e.gapPct })
    const on = usd(e.onchain)
    const fair = usd(e.fair)
    const liq = usd0(e.poolLiquidityUsd)
    return [`${st.emoji} <b>${esc(e.ticker)}</b> · ${esc(e.chainName ?? chainName(e.chain))} · gap <b>${esc(signed(e.gapPct))}%</b> (${esc(e.status)})`, `${on && fair ? `On chain ${esc(on)} · fair ${esc(fair)} · ` : ''}${liq ? `pool ${esc(liq)}` : 'pool liquidity not reported'}`].join('\n')
  })
  const more = a.events.length > shown.length ? `\n…and ${a.events.length - shown.length} more on ${SITE}/tracker` : ''
  const card = (e) => `c:${CODE_OF[e.chain] ?? 'rh'}:${e.ticker}:x`
  const keyboard =
    shown.length === 1
      ? [[ubtn('🌐 Open ↗', stockUrl(shown[0].chain, shown[0].ticker)), mute, btn('📈 Card', card(shown[0]))]]
      : [shown.slice(0, 3).map((e) => ubtn(`🌐 ${e.ticker} ↗`, stockUrl(e.chain, e.ticker))), shown.slice(0, 3).map((e) => btn(`📈 ${e.ticker}`, card(e))), [mute]]
  return { text: `${title}\n${esc(a.conditionText)}\n\n${blocks.join('\n\n')}${more}`, keyboard }
}

/* --------------------------------------------------------------- state --- */

const states = new Map() // chatId -> { at, ...fields }

/** The chat's view state (null after STATE_TTL_MS without use). */
export function getState(chatId, now = Date.now()) {
  const s = states.get(String(chatId))
  if (!s) return null
  if (now - s.at > STATE_TTL_MS) {
    states.delete(String(chatId))
    return null
  }
  return s
}
export function setState(chatId, patch, now = Date.now()) {
  const s = { ...(getState(chatId, now) ?? {}), ...patch, at: now }
  states.set(String(chatId), s)
  return s
}
export function sweepStates(now = Date.now()) {
  for (const [k, s] of states) if (now - s.at > STATE_TTL_MS) states.delete(k)
}
/** Test hook: forget every chat's state (as after a restart or the TTL). */
export const clearStatesForTest = () => states.clear()
