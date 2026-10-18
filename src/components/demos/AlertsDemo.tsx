import { useCallback, useEffect, useRef, useState, type JSX } from 'react'
import { ExternalLink, Send, Webhook } from 'lucide-react'
import { useReducedMotion } from '../charts/chart-utils'
import { DEVELOPERS_URL, isLocalHost } from '../../site-host'
import type { Movers, Tracker, TrackerRow } from '../../lib/tracker'
import type { AlertChannels, Offer } from '../../pages/developers/api'
import { Mascot } from '../brand'

/* Landing demo: Gully Labs alerts in Telegram and by webhook.
   /gap, /top and /movers read the live tracker (/api/tracker, /api/tracker/movers) and word the answer
   the way the bot does (server/telegram.mjs): only trusted rows are ranked, thin or stale rows are said
   to be so, and a figure that could not be read is called unreadable, never 0. /alerts, "Simulate alert"
   and the webhook delivery log are example data and say so. The webhook payload and headers follow
   server/alerts.mjs. */

const SITE_HOST = 'gullylabs.xyz'
const CHAIN_NAMES: Record<string, string> = { robinhood: 'Robinhood Chain', bsc: 'BNB Chain' }
const TRUSTED = new Set(['in-line', 'drifting', 'premium', 'discount'])
const DEV_ALERTS = isLocalHost() ? '/developers#alerts' : `${DEVELOPERS_URL}/#alerts`
const EXAMPLE_WALLET = '0x0f83…e965'
const MIN_TYPING_MS = 650

type Tone = 'plain' | 'up' | 'down' | 'muted'
interface Line {
  t: string
  tone?: Tone
  mono?: boolean
  bold?: boolean
  href?: string
}
interface BotMsg {
  id: number
  who: 'bot'
  example?: boolean
  blocks: Line[][]
  btns?: { label: string; href?: string; act?: 'mute' | 'resume' }[]
}
interface UserMsg {
  id: number
  who: 'user'
  text: string
}
type Msg = BotMsg | UserMsg
type BotDraft = Omit<BotMsg, 'id' | 'who'>
type LogRow = { id: number; when: string; code: number; what: string; ms: number }

const TONE: Record<Tone, string> = { plain: 'text-ink-2', up: 'text-gold', down: 'text-tg-link', muted: 'text-tg-meta' }

const chainName = (k: string) => CHAIN_NAMES[k] ?? k
const stockPath = (chain: string, ticker: string) => `/tracker/${encodeURIComponent(chain)}/${encodeURIComponent(ticker)}`
const signed = (n: number, d = 2) => `${n > 0 ? '+' : ''}${n.toFixed(d)}`
const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n)
const usd = (n: unknown) => (finite(n) ? `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : null)
const usd0 = (n: unknown) => (finite(n) ? `$${Math.round(n).toLocaleString('en-US')}` : null)
const toneOf = (n: number): Tone => (n > 0 ? 'up' : n < 0 ? 'down' : 'plain')
/** The clock, read only from event handlers. */
const now = () => Date.now()
const utc = (ms: number) => new Date(ms).toISOString().replace('T', ' ').slice(0, 16) + ' UTC'

type Row = TrackerRow & { sessionOpen: boolean | null }

async function readRows(): Promise<Row[]> {
  const r = await fetch('/api/tracker', { headers: { accept: 'application/json' } })
  if (!r.ok) throw new Error(String(r.status))
  const body = (await r.json()) as Tracker
  const open = Object.fromEntries((body?.chains ?? []).map((c) => [c.key, c.sessionOpen]))
  return (body?.rows ?? []).map((row) => ({ ...row, sessionOpen: open[row.chain] ?? null }))
}

const UNREAD_TRACKER: BotDraft = { blocks: [[{ t: 'The tracker could not be read just now. Try again in a minute.' }]] }

/** One stock row, worded like rowText() in server/telegram.mjs. */
function rowBlock(r: Row): Line[] {
  const head: Line = { t: `${r.ticker} · ${chainName(r.chain)}`, bold: true }
  const link: Line = { t: `Open ${r.ticker}`, href: stockPath(r.chain, r.ticker) }
  const fair = usd(r.fair)
  const on = usd(r.onchain)
  const liq = usd0(r.pool?.liquidityUsd)
  let body: Line[]
  if (r.status === 'feed-unreadable') body = [{ t: 'The fair price (Chainlink feed) could not be read just now.' }]
  else if (r.status === 'pool-unreadable') body = [{ t: `The pool could not be read just now.${fair ? ` Fair ${fair}.` : ''}` }]
  else if (r.status === 'no-pool') body = [{ t: `No pool found for this token.${fair ? ` Fair ${fair}.` : ''}` }]
  else if (!finite(r.gapPct)) body = [{ t: 'The gap could not be read just now.' }]
  else {
    body = [
      { t: `Gap ${signed(r.gapPct)}% (${r.status})`, tone: toneOf(r.gapPct), mono: true, bold: true },
      { t: `On chain ${on ?? 'unreadable'} · fair ${fair ?? 'unreadable'}`, mono: true },
      { t: liq ? `Pool liquidity ${liq}` : 'Pool liquidity not reported', mono: true, tone: 'muted' },
    ]
    if (r.status === 'thin') body.push({ t: 'The pool is too thin for the tracker to flag this gap.', tone: 'muted' })
    if (r.poolStale) body.push({ t: 'The pool read is stale; this gap is not current.', tone: 'muted' })
    if (r.sessionOpen === false) body.push({ t: 'The feed session is closed: the gap is against the last session’s price.', tone: 'muted' })
  }
  return [head, ...body, link]
}

async function cmdGap(ticker: string): Promise<BotDraft> {
  let rows: Row[]
  try {
    rows = await readRows()
  } catch {
    return UNREAD_TRACKER
  }
  const mine = rows.filter((r) => r.ticker === ticker)
  if (!mine.length) return { blocks: [[{ t: `The tracker has no row for ${ticker} right now. Try again in a minute.` }]] }
  return { blocks: mine.map(rowBlock) }
}

const trustedNow = (r: Row) => TRUSTED.has(r.status) && finite(r.gapPct) && !r.poolStale && r.sessionOpen !== false

async function cmdTop(): Promise<BotDraft> {
  let rows: Row[]
  try {
    rows = await readRows()
  } catch {
    return UNREAD_TRACKER
  }
  const ok = rows.filter(trustedNow).sort((a, b) => Math.abs(b.gapPct as number) - Math.abs(a.gapPct as number)).slice(0, 5)
  const closed = rows.filter((r) => r.sessionOpen === false).length
  const closedText = closed === 1 ? '1 stock is outside its feed session' : `${closed} stocks are outside their feed session`
  const trackerLink: Line = { t: `${SITE_HOST}/tracker`, href: '/tracker' }
  if (!ok.length)
    return {
      blocks: [[{ t: `No stock has a trusted gap right now (a readable feed and pool, a pool deep enough to count, a fresh read and an open feed session).${closed ? ` ${closedText}.` : ''}` }, trackerLink]],
    }
  const lines: Line[] = ok.map((r, i) => {
    const g = r.gapPct as number
    const liq = r.pool?.liquidityUsd ? `, pool ${usd0(r.pool.liquidityUsd)}` : ''
    return { t: `${i + 1}. ${r.ticker} · ${chainName(r.chain)}: ${signed(g)}% (${r.status})${liq}`, tone: toneOf(g), mono: true, href: stockPath(r.chain, r.ticker) }
  })
  return {
    blocks: [[{ t: 'Widest trusted gaps now', bold: true }, ...lines, ...(closed ? [{ t: `${closedText} and not ranked.`, tone: 'muted' as Tone }] : []), trackerLink]],
  }
}

async function cmdMovers(): Promise<BotDraft> {
  const failed: BotDraft = { blocks: [[{ t: 'Movers could not be read just now. Try again in a minute.' }]] }
  let m: Movers
  try {
    const r = await fetch('/api/tracker/movers?window=24h', { headers: { accept: 'application/json' } })
    if (!r.ok) return failed
    m = (await r.json()) as Movers
  } catch {
    return failed
  }
  const list = Array.isArray(m?.byGap) ? m.byGap.slice(0, 5) : null
  if (!list) return failed
  if (!list.length) return { blocks: [[{ t: m.note ?? 'Not enough snapshots yet to compare with 24 hours ago.' }]] }
  const lines: Line[] = list
    .filter((e) => finite(e.gapChangePp) && finite(e.gapNow))
    .map((e, i) => ({ t: `${i + 1}. ${e.ticker} · ${chainName(e.chain)}: gap ${signed(e.gapChangePp)} pp in 24h, now ${signed(e.gapNow)}%`, tone: toneOf(e.gapChangePp), mono: true, href: stockPath(e.chain, e.ticker) }))
  return { blocks: [[{ t: 'Biggest gap moves, 24 hours', bold: true }, ...lines, { t: `${SITE_HOST}/tracker`, href: '/tracker' }]] }
}

/* ---------------------------------------------------------- example data --- */

const EX_ALERT = { name: 'NVDA wide', condition: 'gap of 2% or more either way', chain: 'robinhood', ticker: 'NVDA', gapPct: 2.41, onchain: 186.41, fair: 182.02, liq: 4_200_000, status: 'premium' }

const exampleAlert = (): BotDraft => ({
  example: true,
  blocks: [
    [
      { t: `Gully Labs alert “${EX_ALERT.name}”`, bold: true },
      { t: EX_ALERT.condition, tone: 'muted' },
    ],
    [
      { t: `${EX_ALERT.ticker} · ${chainName(EX_ALERT.chain)}`, bold: true },
      { t: `Gap ${signed(EX_ALERT.gapPct)}% vs fair (${EX_ALERT.status})`, tone: 'up', mono: true, bold: true },
      { t: `On chain ${usd(EX_ALERT.onchain)} · fair ${usd(EX_ALERT.fair)}`, mono: true },
      { t: `Pool liquidity ${usd0(EX_ALERT.liq)}`, mono: true, tone: 'muted' },
      { t: `${SITE_HOST}/tracker/${EX_ALERT.chain}/${EX_ALERT.ticker}`, href: stockPath(EX_ALERT.chain, EX_ALERT.ticker) },
    ],
  ],
  btns: [{ label: `Open ${EX_ALERT.ticker}`, href: stockPath(EX_ALERT.chain, EX_ALERT.ticker) }, { label: 'Mute 24h', act: 'mute' }],
})

const exampleAlerts = (mutedUntil: number | null): BotDraft => ({
  example: true,
  blocks: [
    [
      { t: `Alerts on ${EXAMPLE_WALLET}`, bold: true },
      { t: `• ${EX_ALERT.name}: ${EX_ALERT.condition} · ${mutedUntil ? `muted until ${utc(mutedUntil)}` : 'watching'}` },
      { t: '• TSLA discount: status discount · fired, waits to re-arm' },
    ],
  ],
})

const WEBHOOK_TEXT = `POST https://your.app/hooks/gully
Content-Type: application/json
User-Agent: GullyLabs-Alerts/1 (+https://docs.gullylabs.xyz/plans-alerts)
X-Gully-Timestamp: 1792230067
X-Gully-Signature: sha256=<HMAC-SHA256(secret, "<timestamp>.<raw body>")>

{
  "id": "dlv_8Jq2vT0aWm4k",
  "type": "alert.triggered",
  "createdAt": "2026-10-17T09:41:07.000Z",
  "alert": {
    "id": "a7Kp3sQx9Lm2",
    "name": "NVDA wide",
    "target": { "chain": "robinhood", "ticker": "NVDA" },
    "condition": { "type": "gap", "pct": 2 }
  },
  "events": [{
    "chain": "robinhood",
    "chainName": "Robinhood Chain",
    "ticker": "NVDA",
    "name": "NVIDIA",
    "status": "premium",
    "gapPct": 2.41,
    "fair": 182.02,
    "onchain": 186.41,
    "poolLiquidityUsd": 4200000,
    "feedUpdatedAt": "2026-10-17T09:40:12.000Z",
    "snapshotAt": "2026-10-17T09:41:07.000Z"
  }]
}`

const hashN = (s: string) => {
  let h = 7
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 2147483647
  return h
}

const INITIAL: Msg[] = [
  {
    id: 0,
    who: 'bot',
    example: true,
    blocks: [[{ t: `Linked to ${EXAMPLE_WALLET}. Alerts with Telegram delivery arrive here.` }, { t: '/alerts lists them · /stop unlinks.', tone: 'muted' }]],
  },
]

const INITIAL_LOG: LogRow[] = [
  { id: -1, when: '09:41:07', code: 200, what: 'alert.triggered · NVDA wide', ms: 182 },
  { id: -2, when: '08:12:55', code: 200, what: 'alert.triggered · TSLA discount', ms: 211 },
]

const COMMANDS: { label: string; run: 'gap' | 'top' | 'movers' | 'alerts' | 'simulate' }[] = [
  { label: '/gap NVDA', run: 'gap' },
  { label: '/top', run: 'top' },
  { label: '/movers', run: 'movers' },
  { label: '/alerts', run: 'alerts' },
  { label: 'Simulate alert', run: 'simulate' },
]

/* ------------------------------------------------------------------ view --- */

export default function AlertsDemo(): JSX.Element {
  const reduced = useReducedMotion()
  const [chan, setChan] = useState<'telegram' | 'webhook'>('telegram')
  const [msgs, setMsgs] = useState<Msg[]>(INITIAL)
  const [typing, setTyping] = useState(false)
  const [busy, setBusy] = useState(false)
  const [mutedUntil, setMutedUntil] = useState<number | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [log, setLog] = useState<LogRow[]>(INITIAL_LOG)
  const [channels, setChannels] = useState<AlertChannels | null>(null)
  const [alertLimits, setAlertLimits] = useState<{ name: string; alerts: number }[] | null>(null)
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>())
  const alive = useRef(true)
  const nextId = useRef(1)
  const chatRef = useRef<HTMLDivElement>(null)

  const later = useCallback((fn: () => void, ms: number) => {
    const id = setTimeout(() => {
      timers.current.delete(id)
      if (alive.current) fn()
    }, ms)
    timers.current.add(id)
  }, [])

  useEffect(() => {
    alive.current = true
    const set = timers.current
    fetch('/api/alerts/channels')
      .then((r) => (r.ok ? (r.json() as Promise<AlertChannels>) : null))
      .then((c) => alive.current && c && setChannels(c))
      .catch(() => undefined)
    fetch('/api/plans')
      .then((r) => (r.ok ? (r.json() as Promise<Offer>) : null))
      .then((o) => alive.current && o?.plans && setAlertLimits(o.plans.map((p) => ({ name: p.name, alerts: p.alerts }))))
      .catch(() => undefined)
    return () => {
      alive.current = false
      for (const id of set) clearTimeout(id)
      set.clear()
    }
  }, [])

  useEffect(() => {
    const el = chatRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [msgs, typing])

  const push = (m: Omit<UserMsg, 'id'> | BotDraft) => {
    const id = nextId.current++
    const full = ('who' in m ? { ...m, id } : { ...m, who: 'bot', id }) as Msg
    setMsgs((list) => [...list, full].slice(-6))
  }

  const reply = async (userText: string | null, make: () => BotDraft | Promise<BotDraft>) => {
    if (busy) return
    setBusy(true)
    if (userText) push({ who: 'user', text: userText })
    setTyping(true)
    const t0 = now()
    const draft = await make()
    if (!alive.current) return
    later(
      () => {
        setTyping(false)
        push(draft)
        setBusy(false)
      },
      reduced ? 0 : Math.max(0, MIN_TYPING_MS - (now() - t0)),
    )
  }

  const showToast = (text: string) => {
    setToast(text)
    later(() => setToast((t) => (t === text ? null : t)), 3200)
  }

  const runCommand = (c: (typeof COMMANDS)[number]) => {
    if (c.run === 'gap') return reply('/gap NVDA', () => cmdGap('NVDA'))
    if (c.run === 'top') return reply('/top', cmdTop)
    if (c.run === 'movers') return reply('/movers', cmdMovers)
    if (c.run === 'alerts') return reply('/alerts', () => exampleAlerts(mutedUntil))
    if (mutedUntil && mutedUntil > now()) {
      showToast(`“${EX_ALERT.name}” is muted until ${utc(mutedUntil)}: it neither fires nor re-arms.`)
      return
    }
    return reply(null, exampleAlert)
  }

  const act = (a: 'mute' | 'resume') => {
    if (a === 'mute') {
      const until = now() + 24 * 3_600_000
      setMutedUntil(until)
      showToast(`Muted until ${utc(until)}. Resume it any time in the dashboard.`)
    } else {
      setMutedUntil(null)
      showToast(`“${EX_ALERT.name}” resumed.`)
    }
  }

  const sendHook = () => {
    const id = nextId.current++
    const n = log.filter((l) => l.id > 0).length + 1
    const at = new Date(now())
    setLog((l) => [{ id, when: at.toISOString().slice(11, 19), code: 200, what: `alert.test #${n}`, ms: 140 + (hashN(`d${n}`) % 120) }, ...l].slice(0, 5))
  }

  const tgOff = channels?.telegram && !channels.telegram.enabled
  const botName = channels?.telegram?.enabled && channels.telegram.bot ? `@${channels.telegram.bot}` : 'Gully Labs bot'
  const limitsText = alertLimits?.length ? alertLimits.map((p, i) => `${p.alerts.toLocaleString('en-US')} ${i === 0 ? `alert${p.alerts === 1 ? '' : 's'} ${p.name.toLowerCase()}` : `on ${p.name}`}`).join(' · ') : null

  const tabBtn = (id: 'telegram' | 'webhook', label: string, Icon: typeof Send) => (
    <button
      type="button"
      role="tab"
      id={`alerts-demo-tab-${id}`}
      aria-selected={chan === id}
      aria-controls={`alerts-demo-panel-${id}`}
      onClick={() => setChan(id)}
      className={`inline-flex min-h-11 items-center gap-2 rounded-[6px] px-4 text-[13px] transition-colors ${chan === id ? 'bg-gold font-semibold text-bg' : 'text-muted hover:text-ink'}`}
    >
      <Icon size={14} aria-hidden /> {label}
    </button>
  )

  return (
    <div className="flex w-full flex-wrap overflow-hidden lg:flex-nowrap rounded-card border border-line bg-surface text-[13px] leading-[1.45] text-ink lg:h-[560px]">
      {/* Left: what it is, the channel switch, the commands */}
      <div className="flex min-w-0 flex-[1_1_300px] flex-col gap-3 border-line p-4 max-lg:border-b lg:overflow-y-auto lg:border-r">
        <div className="flex flex-col gap-0.5">
          <span className="font-mono text-[11px] tracking-[1px] text-gold">ALERTS · TRY IT</span>
          <b className="font-display text-[22px] leading-[1.05] font-bold uppercase">Gap alerts where you already are</b>
        </div>
        <div role="tablist" aria-label="Channel" className="flex w-fit gap-0.5 rounded-[8px] border border-line p-0.5">
          {tabBtn('telegram', 'Telegram', Send)}
          {tabBtn('webhook', 'Webhook', Webhook)}
        </div>
        {chan === 'telegram' ? (
          <>
            <span className="text-[12px] text-muted">Tap a command. /gap, /top and /movers read the live tracker, worded the way the bot does.</span>
            <div className="flex flex-wrap gap-1.5">
              {COMMANDS.map((c) => (
                <button
                  key={c.label}
                  type="button"
                  disabled={busy}
                  onClick={() => runCommand(c)}
                  className={`min-h-11 rounded-full border px-2.5 font-mono text-[12px] transition-colors disabled:opacity-60 ${c.run === 'simulate' ? 'border-gold-line text-gold hover:border-gold' : 'border-line-strong text-ink-2 hover:border-line-hover hover:text-ink'}`}
                >
                  {c.label}
                </button>
              ))}
            </div>
            <span className="text-[11px] text-faint">/alerts and Simulate alert use example data.</span>
          </>
        ) : (
          <>
            <span className="text-[12px] text-muted">Every alert can also POST a signed JSON body to your URL. Check X-Gully-Signature with the alert&apos;s secret.</span>
            <button type="button" onClick={sendHook} className="min-h-11 w-fit rounded-[8px] bg-gold px-4 font-semibold text-bg transition-colors hover:bg-gold-hover">
              Send a test delivery
            </button>
            <span className="text-[11px] text-faint">Demo: nothing is sent; the log below is example data.</span>
          </>
        )}
        {tgOff && (
          <p role="status" className="m-0 rounded-[8px] border border-line-strong bg-surface-deep px-3 py-1.5 text-[12px] text-muted">
            Telegram is not configured on this server yet; webhooks work.
          </p>
        )}
        <ul className="m-0 mt-auto flex list-none flex-col gap-1 p-0 text-[12px] text-muted">
          <li>Link a chat or group with a one-time code; Open and Mute 24h on every alert</li>
          {limitsText && <li>{limitsText}</li>}
          <li>
            <a href={DEV_ALERTS} className="inline-flex min-h-11 items-center gap-1.5 text-ink-2 underline-offset-4 hover:text-gold hover:underline">
              Connect it in the developer portal, Alerts tab <ExternalLink size={12} aria-hidden />
            </a>
          </li>
        </ul>
      </div>

      {/* Right: the chat, or the webhook */}
      <div className="flex min-h-[440px] min-w-0 flex-[999_1_520px] bg-bg p-3.5 lg:min-h-0">
        {chan === 'telegram' ? (
          <div
            role="tabpanel"
            id="alerts-demo-panel-telegram"
            aria-labelledby="alerts-demo-tab-telegram"
            className="relative flex min-w-0 flex-1 flex-col overflow-hidden rounded-card border border-line bg-tg-bg"
          >
            <div className="flex items-center gap-2.5 bg-tg-head px-3.5 py-2.5">
              <Mascot size={34} decorative />
              <span className="flex flex-col leading-[1.2]">
                <b className="font-semibold">Gully Labs</b>
                <span className="text-[11px] text-tg-meta">{typing ? 'typing…' : botName}</span>
              </span>
            </div>
            {toast && (
              <div role="status" className="absolute top-14 left-1/2 z-10 w-[min(90%,420px)] -translate-x-1/2 rounded-panel bg-[rgba(0,0,0,.82)] px-3.5 py-2.5 text-center text-[12px] text-ink">
                {toast}
              </div>
            )}
            <div ref={chatRef} aria-live="polite" className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-3.5">
              <div className="mt-auto" />
              {msgs.map((m) =>
                m.who === 'user' ? (
                  <div key={m.id} className="max-w-[70%] self-end rounded-[12px_12px_4px_12px] bg-tg-out px-3 py-2 font-mono text-[12px]">
                    {m.text}
                  </div>
                ) : (
                  <BotBubble key={m.id} m={m} muted={!!mutedUntil} act={act} />
                ),
              )}
              {typing && <div className="self-start rounded-card bg-tg-in px-3 py-2 text-[12px] text-tg-meta">Gully Labs is typing…</div>}
            </div>
          </div>
        ) : (
          <div role="tabpanel" id="alerts-demo-panel-webhook" aria-labelledby="alerts-demo-tab-webhook" className="flex min-w-0 flex-1 flex-col gap-2.5">
            <pre
              tabIndex={0}
              aria-label="Example webhook delivery"
              className="m-0 min-h-0 flex-1 overflow-auto rounded-[10px] border border-line bg-surface-deep p-3.5 font-mono text-[11.5px] leading-[1.55] text-ink-2 max-lg:max-h-[300px]"
            >
              {WEBHOOK_TEXT}
            </pre>
            <div className="overflow-hidden rounded-[10px] border border-line">
              <div className="flex justify-between bg-surface px-3 py-2 font-mono text-[11px] tracking-[1px] text-faint">
                <span>DELIVERY LOG</span>
                <span>EXAMPLE</span>
              </div>
              <ul className="m-0 list-none p-0" aria-live="polite">
                {log.map((d) => (
                  <li key={d.id} className="grid grid-cols-[64px_36px_minmax(0,1fr)_56px] gap-2.5 border-t border-line px-3 py-2 font-mono text-[12px]">
                    <span className="text-dim">{d.when}</span>
                    <span className="text-green">{d.code}</span>
                    <span className="truncate">{d.what}</span>
                    <span className="text-right text-dim">{d.ms} ms</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function BotBubble({ m, muted, act }: { m: BotMsg; muted: boolean; act: (a: 'mute' | 'resume') => void }) {
  return (
    <div className="flex max-w-[88%] flex-col gap-1 self-start">
      <div className="flex flex-col gap-2 rounded-[12px_12px_12px_4px] bg-tg-in px-3 py-2.5">
        {m.blocks.map((b, bi) => (
          <div key={bi} className="flex flex-col gap-[3px]">
            {b.map((l, li) =>
              l.href ? (
                <a key={li} href={l.href} className={`text-[12px] break-words underline-offset-2 hover:underline ${l.tone && l.tone !== 'plain' ? TONE[l.tone] : 'text-tg-link'} ${l.mono ? 'font-mono' : ''}`}>
                  {l.t}
                </a>
              ) : (
                <span key={li} className={`break-words ${li === 0 && l.bold ? 'text-[13px] font-semibold text-ink' : `text-[12px] ${TONE[l.tone ?? 'plain']} ${l.bold ? 'font-semibold' : ''}`} ${l.mono ? 'font-mono' : ''}`}>
                  {l.t}
                </span>
              ),
            )}
          </div>
        ))}
        {m.example && <span className="self-end font-mono text-[11px] tracking-[.5px] text-tg-meta uppercase">Example</span>}
      </div>
      {m.btns?.length ? (
        <div className="flex gap-1">
          {m.btns.map((b) =>
            b.href ? (
              <a key={b.label} href={b.href} className="grid min-h-11 flex-1 place-items-center rounded-tile bg-tg-btn px-3 text-[12px] text-ink hover:bg-tg-btn-hover">
                {b.label}
              </a>
            ) : (
              <button
                key={b.label}
                type="button"
                aria-pressed={b.act === 'mute' ? muted : undefined}
                onClick={() => act(b.act === 'mute' && muted ? 'resume' : (b.act ?? 'mute'))}
                className="min-h-11 flex-1 rounded-tile bg-tg-btn px-3 text-[12px] text-ink hover:bg-tg-btn-hover"
              >
                {b.act === 'mute' && muted ? 'Muted · resume' : b.label}
              </button>
            ),
          )}
        </div>
      ) : null}
    </div>
  )
}
