import { Ban, Bold, CalendarClock, Check, ChevronDown, Settings2, Eye, ExternalLink, Italic, Link2, LoaderCircle, Megaphone, Pause, Play, Plus, RotateCcw, Send, Smartphone, Trash2, Users, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { AnimatedNumber } from '../../components/charts/AnimatedNumber'
import { areaPreset, axisTooltip, C, tipHtml } from '../../components/charts/chartPresets'
import { GhostChart } from '../../components/charts/GhostChart'
import { EChart } from '../../components/charts/EChart'
import { toastError, toastSuccess } from '../../components/ui/toast'
import { adminCall } from './payAdmin'
import { LINK_BLUE, renderTg } from './tgHtml'
import { NewTabNote } from './newTab'
import { Stepper } from '../developers/ui'
import { chip, pillCls } from './ui'

/* Admin: DMs to everyone who started @GullyLabsBot (server/telegram-broadcast.mjs, /api/admin/broadcasts*).
   Analytics (bot users, growth, opt-outs, blocked, the last broadcast), the owner's one BotFather step, a composer
   with a live Telegram-style preview, segments with a live audience count, a test send, schedule or send now behind
   a confirm step that shows the exact count, and the history with pause, resume, cancel, re-send to failed and
   delete for everyone (48 h). The preview renders the server-sanitized HTML as React elements, never innerHTML. */

type Media = null | { kind: 'photo' | 'animation'; url?: string; banner?: boolean }
interface Btn {
  text: string
  url: string
}
type SegKind = 'all' | 'linked' | 'unlinked' | 'alerts' | 'follows' | 'language' | 'active'
interface Segment {
  kind: SegKind
  language?: string
  days?: number
}
interface Counts {
  total: number
  pending: number
  sent: number
  failed: number
  blocked: number
  skipped: number
  cancelled: number
  deleted: number
}
interface Broadcast {
  id: string
  kind: 'manual' | 'teaser'
  status: 'scheduled' | 'sending' | 'paused' | 'sent' | 'cancelled' | 'deleting' | 'deleted'
  text: string
  media: Media
  buttons: Btn[]
  segment: Segment
  urgent: boolean
  audience: number | null
  scheduledAt: string | null
  createdAt: string
  startedAt: string | null
  finishedAt: string | null
  error: string | null
  channelPost: { id: string; url: string } | null
  counts: Counts
  opened: number
  clicks: number
  optOuts: number
  canDelete: boolean
  deleteUntil: string | null
}
interface Overview {
  enabled: boolean
  adminChat: boolean
  rate: number
  stats: { users: number; optedOut: number; blocked: number; linked: number; follows: number; growth: { day: string; added: number; total: number }[]; languages: { lang: string; count: number }[] }
  last: Broadcast | null
  nextAllowedAt: string | null
  broadcasts: Broadcast[]
  testTargets: { chatId: string; label: string }[]
}
interface Audience {
  count: number
  total: number
  optedOut: number
  blocked: number
}
interface Checked {
  text: string
  length: number
  limit: number
  errors: string[]
}
interface Recipient {
  n: number
  chat: string
  status: string
  error: string | null
  at: string | null
  deleted: boolean
  opened: boolean
}

const card = 'flex min-w-0 flex-col gap-5 rounded-card border border-line bg-surface p-6 max-[600px]:p-4'
const h2 = 'm-0 font-display text-[22px] font-bold uppercase'
const h3 = 'm-0 font-mono text-[11px] tracking-[1px] text-faint'
const small = 'font-mono text-[12px] text-faint'
const field = 'min-h-11 min-w-0 rounded-input border border-line-strong bg-bg px-3 text-[14px] text-ink outline-none focus:border-gold'
const ghostBtn = 'inline-flex min-h-11 items-center gap-2 rounded-btn border border-line-strong px-4 text-[14px] text-ink-2 transition-colors hover:border-gold hover:text-ink disabled:opacity-40'
const goldBtn = 'inline-flex min-h-11 items-center gap-2 rounded-btn bg-gold px-5 text-[15px] font-semibold text-bg transition-colors hover:bg-gold-hover disabled:opacity-40'
const tinyBtn = 'inline-flex min-h-11 items-center gap-1 rounded-btn border border-line-strong px-3 text-[13px] text-ink-2 hover:border-gold hover:text-ink disabled:opacity-40'

const SEGMENTS: { id: SegKind; label: string }[] = [
  { id: 'all', label: 'Everyone' },
  { id: 'linked', label: 'Linked accounts' },
  { id: 'unlinked', label: 'Not linked' },
  { id: 'alerts', label: 'Has alerts' },
  { id: 'follows', label: 'Follows Gully Labs News' },
  { id: 'language', label: 'Language' },
  { id: 'active', label: 'Active lately' },
]
const STATUS_STYLE: Record<Broadcast['status'], string> = {
  scheduled: 'border-gold-line text-gold',
  sending: 'border-gold text-gold',
  paused: 'border-line-strong text-muted',
  sent: 'border-success-line text-green',
  cancelled: 'border-line text-faint',
  deleting: 'border-error text-error',
  deleted: 'border-line text-faint line-through',
}
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—')
const toLocalInput = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16)
const segLabel = (s: Segment) => (s.kind === 'language' ? `Language: ${s.language}` : s.kind === 'active' ? `Active in the last ${s.days} days` : (SEGMENTS.find((x) => x.id === s.kind)?.label ?? s.kind))
const pct = (n: number, d: number) => (d ? Math.round((n / d) * 100) : 0)

/* --------------------------------------------------------------- preview --- */

/** A Telegram-style bot DM with its URL buttons and the 🔕 Stop announcements button every broadcast ends with. */
function DmBubble({ html, media, buttons }: { html: string; media: Media; buttons: Btn[] }) {
  const img = media?.banner ? '/brand/telegram/banner.gif' : media?.url
  return (
    <div className="rounded-card border border-line bg-bg-alt p-4" aria-label="Telegram preview">
      <div className="mx-auto flex max-w-[420px] flex-col gap-1">
        <div className="overflow-hidden rounded-[14px] rounded-bl-[4px] bg-surface-hover shadow-[0_1px_0_rgba(0,0,0,.35)]">
          {media && img && <img src={img} alt="" className="block max-h-[260px] w-full bg-bg object-cover" onError={(e) => (e.currentTarget.style.opacity = '0.2')} />}
          <div className="flex flex-col gap-1 px-3 pt-2 pb-1">
            <span className="text-[13px] font-semibold" style={{ color: LINK_BLUE }}>
              Gully Labs
            </span>
            <div className="text-[14px] leading-[1.45] break-words whitespace-pre-wrap text-ink">{html ? renderTg(html) : <span className="text-faint">Your message appears here as people will see it in their chat with the bot.</span>}</div>
            <span className="self-end font-mono text-[11px] text-faint">@GullyLabsBot · now</span>
          </div>
        </div>
        {buttons.map((b, i) => (
          <a key={i} href={b.url || undefined} target="_blank" rel="noopener noreferrer" className="flex min-h-11 items-center justify-center gap-1 rounded-[8px] bg-surface-hover px-3 text-center text-[13px] text-ink-2 hover:bg-line-strong">
            {b.text || 'Button'} <ExternalLink size={12} aria-hidden />
            <NewTabNote />
          </a>
        ))}
        <span className="flex min-h-11 items-center justify-center rounded-[8px] bg-surface-hover px-3 text-center text-[13px] text-ink-2">🔕 Stop announcements</span>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------- analytics --- */

function Stat({ label, value, note }: { label: string; value: number | null; note?: string }) {
  return (
    <div className="flex min-w-[140px] flex-1 flex-col gap-1 rounded-input border border-line bg-bg-alt px-4 py-3">
      <span className={h3}>{label}</span>
      <span className="font-display text-[28px] leading-none font-bold text-ink">{value === null ? <span className="text-[16px] text-faint">…</span> : <AnimatedNumber value={value} countUp />}</span>
      {note && <span className={small}>{note}</span>}
    </div>
  )
}

function Analytics({ ov }: { ov: Overview }) {
  const g = ov.stats.growth
  const option = useMemo(
    () => ({
      grid: { left: 36, right: 12, top: 12, bottom: 24 },
      xAxis: { type: 'category', data: g.map((p) => p.day.slice(5)), axisTick: { show: false }, axisLine: { lineStyle: { color: C.lineStrong } }, axisLabel: { color: C.axis, fontSize: 11, hideOverlap: true } },
      yAxis: { type: 'value', minInterval: 1, splitLine: { lineStyle: { color: C.grid } }, axisLabel: { color: C.axis, fontSize: 11 } },
      tooltip: axisTooltip((ps: { dataIndex: number }[]) => {
        const p = g[ps[0]?.dataIndex ?? -1]
        return p ? tipHtml({ title: p.day, rows: [{ name: 'bot users', value: p.total.toLocaleString('en-US'), color: C.gold }, { name: 'new that day', value: `+${p.added}` }] }) : ''
      }),
      series: [{ id: 'users', ...areaPreset({ color: C.gold }), data: g.map((p) => p.total) }],
    }),
    [g],
  )
  const last = ov.last
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-3">
        <Stat label="BOT USERS · LIVE" value={ov.stats.users} note={`${ov.stats.linked} linked · ${ov.stats.follows} follow the News channel`} />
        <Stat label="OPTED OUT" value={ov.stats.optedOut} note="no announcements; alerts still arrive" />
        <Stat label="BLOCKED THE BOT" value={ov.stats.blocked} note="skipped until they /start again" />
      </div>
      <div className="grid grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] gap-3 max-[900px]:grid-cols-1">
        <div className="flex min-w-0 flex-col gap-2 rounded-input border border-line bg-bg-alt p-4">
          <span className={h3}>GROWTH · PEOPLE WHO STARTED THE BOT</span>
          {g.length >= 2 ? (
            <EChart option={option} height={170} label={`Bot users over time: ${g.length} days, ${ov.stats.users} now.`} skeleton="line" steps={{ count: g.length }} />
          ) : (
            <GhostChart height={170} label="The growth line draws here once people have started the bot on two different days" framed={false} />
          )}
        </div>
        <div className="flex min-w-0 flex-col gap-2 rounded-input border border-line bg-bg-alt p-4">
          <span className={h3}>LAST BROADCAST</span>
          {last ? (
            <>
              <span className="line-clamp-2 text-[14px] text-ink-2">{plainOf(last.text) || '(media only)'}</span>
              <span className={small}>{when(last.startedAt)} · {segLabel(last.segment)}</span>
              <div className="grid grid-cols-3 gap-2">
                {(
                  [
                    ['DELIVERED', last.counts.sent, C.gold],
                    ['FAILED', last.counts.failed + last.counts.blocked, C.error],
                    ['OPENED LINK', last.opened, LINK_BLUE],
                  ] as const
                ).map(([k, v, color]) => (
                  <div key={k} className="flex flex-col gap-1">
                    <span className={h3}>{k}</span>
                    <span className="font-display text-[22px] leading-none font-bold" style={{ color }}>
                      <AnimatedNumber value={v} countUp />
                    </span>
                  </div>
                ))}
              </div>
              <Progress c={last.counts} />
            </>
          ) : (
            <span className="text-[13px] text-faint">No broadcast yet.</span>
          )}
        </div>
      </div>
    </div>
  )
}

const plainOf = (html: string) => html.replace(/<[^>]*>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&')

/** Delivered, failed and still-to-go as one animated bar. */
function Progress({ c }: { c: Counts }) {
  const bad = c.failed + c.blocked
  return (
    <div className="flex h-[6px] w-full overflow-hidden rounded-full bg-bg" role="img" aria-label={`${c.sent} delivered, ${bad} failed, ${c.pending} to go of ${c.total}`}>
      <div className="h-full bg-gold transition-[width] duration-700" style={{ width: `${pct(c.sent, c.total)}%` }} />
      <div className="h-full transition-[width] duration-700" style={{ width: `${pct(bad, c.total)}%`, background: C.error }} />
    </div>
  )
}

/* ------------------------------------------------------------- owner step --- */

function OwnerStep() {
  // The four BotFather steps on the shared Stepper (G61/X2): one step's instructions at a time, ticked off as the
  // owner goes; the tick is only this page's memory, nothing is saved.
  const [done, setDone] = useState<string[]>([])
  const mark = (id: string) => setDone((d) => (d.includes(id) ? d : [...d, id]))
  const body: Record<string, ReactNode> = {
    botfather: (
      <>
        Open{' '}
        <a href="https://t.me/BotFather" target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center text-gold hover:underline">
          @BotFather ↗
          <NewTabNote />
        </a>{' '}
        and send <code className="font-mono text-[13px]">/mybots</code>.
      </>
    ),
    menu: <>Pick @GullyLabsBot → Bot Settings → Configure Mini App → Enable.</>,
    url: (
      <>
        Set the URL to <code className="font-mono text-[13px]">https://gullylabs.xyz/tg</code>.
      </>
    ),
    done: <>This adds an “Open app” button to the bot’s profile. The Menu button next to the text box lists the commands (set by the server at start-up); the app also opens from “📱 Open app” in the main menu and from /app.</>,
  }
  const steps = [
    { id: 'botfather', label: 'Open BotFather', icon: <Smartphone size={14} aria-hidden /> },
    { id: 'menu', label: 'Configure Mini App', icon: <Settings2 size={14} aria-hidden /> },
    { id: 'url', label: 'Set the URL', icon: <Link2 size={14} aria-hidden /> },
    { id: 'done', label: 'Check it', icon: <Check size={14} aria-hidden /> },
  ].map((x) => ({ ...x, done: done.includes(x.id) }))
  return (
    <Stepper title="Owner step: make the Mini App the bot’s main app" steps={steps} testId="owner-stepper">
      {(id) => (
        <>
          <p className="m-0 text-[14px] text-ink-2">{body[id]}</p>
          {!done.includes(id) && (
            <button type="button" onClick={() => mark(id)} className="inline-flex min-h-11 w-fit items-center gap-2 rounded-full border border-line-strong px-4 text-[13px] text-ink-2 hover:border-gold hover:text-ink">
              <Check size={14} aria-hidden /> Done, next step
            </button>
          )}
        </>
      )}
    </Stepper>
  )
}

/* -------------------------------------------------------------- composer --- */

interface Draft {
  text: string
  mediaMode: 'none' | 'url' | 'banner'
  mediaKind: 'photo' | 'animation'
  mediaUrl: string
  buttons: Btn[]
  segment: Segment
  urgent: boolean
}
const EMPTY: Draft = { text: '', mediaMode: 'none', mediaKind: 'photo', mediaUrl: '', buttons: [], segment: { kind: 'all' }, urgent: false }
const mediaOf = (d: Draft): Media => (d.mediaMode === 'banner' ? { kind: 'animation', banner: true } : d.mediaMode === 'url' && d.mediaUrl.trim() ? { kind: d.mediaKind, url: d.mediaUrl.trim() } : null)

function Composer({ token, ov, reload }: { token: string; ov: Overview; reload: () => void }) {
  const [d, setD] = useState<Draft>(EMPTY)
  const [checked, setChecked] = useState<Checked | null>(null)
  const [audience, setAudience] = useState<Audience | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [schedAt, setSchedAt] = useState(() => toLocalInput(new Date(Date.now() + 3_600_000)))
  const [testTo, setTestTo] = useState(ov.testTargets[0]?.chatId ?? '')
  const [confirm, setConfirm] = useState<null | { action: 'send' | 'schedule'; count: number }>(null)
  const ta = useRef<HTMLTextAreaElement>(null)
  const set = (p: Partial<Draft>) => setD((x) => ({ ...x, ...p }))
  const media = mediaOf(d)
  const payload = { text: d.text, media, buttons: d.buttons }
  const key = JSON.stringify(payload)
  const segKey = JSON.stringify(d.segment)

  useEffect(() => {
    const id = setTimeout(() => {
      adminCall<Checked>(token, '/api/admin/broadcasts/validate', JSON.parse(key)).then((r) => r.ok && setChecked(r.data))
    }, 250)
    return () => clearTimeout(id)
  }, [key, token])
  useEffect(() => {
    const id = setTimeout(() => {
      adminCall<Audience>(token, '/api/admin/broadcasts/audience', { segment: JSON.parse(segKey) }).then((r) => setAudience(r.ok ? r.data : null))
    }, 200)
    return () => clearTimeout(id)
  }, [segKey, token, ov.stats.users, ov.stats.optedOut])

  const wrap = (open: string, close: string, placeholder = 'text') => {
    const el = ta.current
    if (!el) return
    const { selectionStart: a, selectionEnd: b, value } = el
    const sel = value.slice(a, b) || placeholder
    set({ text: value.slice(0, a) + open + sel + close + value.slice(b) })
    requestAnimationFrame(() => {
      el.focus()
      el.setSelectionRange(a + open.length, a + open.length + sel.length)
    })
  }
  const addLink = () => {
    const url = window.prompt('Link (https://…)', 'https://gullylabs.xyz/')
    if (url) wrap(`<a href="${url.replace(/"/g, '%22')}">`, '</a>', 'link text')
  }

  const limit = checked?.limit ?? (media ? 1024 : 4096)
  const length = checked?.length ?? d.text.length
  const errors = checked?.errors ?? []
  const canSend = !!checked && !errors.length && !busy && !!audience?.count && ov.enabled
  const scheduleIso = schedAt ? new Date(schedAt).toISOString() : null
  const blockedByDay = !!ov.nextAllowedAt && !d.urgent

  const testSend = async () => {
    setBusy('test')
    const r = await adminCall(token, '/api/admin/broadcasts/test', { ...payload, chatId: testTo || undefined })
    setBusy(null)
    if (r.ok) toastSuccess('Test sent', { detail: 'Check your Telegram.' })
    else toastError('Test failed', { detail: r.error })
  }
  const ask = async (action: 'send' | 'schedule') => {
    // The count is read again right before the confirm, so the number shown is exact.
    const r = await adminCall<Audience>(token, '/api/admin/broadcasts/audience', { segment: d.segment })
    if (!r.ok) return toastError('Could not count the audience', { detail: r.error })
    setAudience(r.data)
    if (!r.data.count) return toastError('Nobody in this audience')
    setConfirm({ action, count: r.data.count })
  }
  const go = async () => {
    if (!confirm) return
    setBusy(confirm.action)
    const r = await adminCall<{ broadcast: Broadcast }>(token, '/api/admin/broadcasts', { ...payload, segment: d.segment, urgent: d.urgent, action: confirm.action, confirm: confirm.count, ...(confirm.action === 'schedule' ? { scheduledAt: scheduleIso } : {}) })
    setBusy(null)
    setConfirm(null)
    if (!r.ok) {
      toastError(confirm.action === 'send' ? 'Not sent' : 'Not scheduled', { detail: r.error })
      return reload()
    }
    toastSuccess(confirm.action === 'send' ? `Sending to ${confirm.count.toLocaleString('en-US')} people` : `Scheduled for ${when(scheduleIso)}`)
    setD(EMPTY)
    reload()
  }

  return (
    <div className="grid grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] gap-6 max-[1023px]:grid-cols-1">
      <div className="flex min-w-0 flex-col gap-4">
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex gap-1" role="toolbar" aria-label="Formatting">
              <button type="button" onClick={() => wrap('<b>', '</b>')} className={tinyBtn} aria-label="Bold">
                <Bold size={14} aria-hidden />
              </button>
              <button type="button" onClick={() => wrap('<i>', '</i>')} className={tinyBtn} aria-label="Italic">
                <Italic size={14} aria-hidden />
              </button>
              <button type="button" onClick={addLink} className={tinyBtn} aria-label="Link">
                <Link2 size={14} aria-hidden />
              </button>
            </div>
            <span className={`font-mono text-[12px] ${length > limit ? 'text-error' : length > limit * 0.9 ? 'text-gold' : 'text-faint'}`} aria-live="polite">
              {length.toLocaleString('en-US')} / {limit.toLocaleString('en-US')} {media ? '(caption)' : ''}
            </span>
          </div>
          <label className="sr-only" htmlFor="tgb-text">
            Message text (Telegram HTML)
          </label>
          <textarea id="tgb-text" ref={ta} value={d.text} rows={7} onChange={(e) => set({ text: e.target.value })} placeholder={'<b>Gap alerts are live</b>\nGet a message the moment a gap opens.'} className={`${field} py-3 font-mono text-[13px] leading-[1.55]`} />
          <span className={small}>Same rules as channel posts: b, i, u, s, a, code, pre, blockquote, tg-spoiler. A “🔕 Stop announcements” button is always added.</span>
        </div>

        <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
          <legend className={`${h3} mb-2`}>MEDIA</legend>
          <div className="flex flex-wrap gap-2">
            {(
              [
                ['none', 'None'],
                ['url', 'Image or GIF URL'],
                ['banner', 'Gully animated banner'],
              ] as const
            ).map(([k, label]) => (
              <label key={k} className={chip(d.mediaMode === k)}>
                <input type="radio" name="tgb-media" value={k} checked={d.mediaMode === k} onChange={() => set({ mediaMode: k })} className="sr-only" />
                {label}
              </label>
            ))}
          </div>
          {d.mediaMode === 'url' && (
            <div className="flex flex-wrap gap-2">
              <select value={d.mediaKind} onChange={(e) => set({ mediaKind: e.target.value as 'photo' | 'animation' })} className={field} aria-label="Media kind">
                <option value="photo">Photo</option>
                <option value="animation">GIF / animation</option>
              </select>
              <input value={d.mediaUrl} onChange={(e) => set({ mediaUrl: e.target.value })} placeholder="https://gullylabs.xyz/social/og-image-1200x630.png" className={`${field} min-w-[200px] flex-1`} aria-label="Image or GIF URL" />
            </div>
          )}
        </fieldset>

        <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
          <legend className={`${h3} mb-2`}>BUTTONS (UP TO 3, HTTPS · OPENS ARE COUNTED)</legend>
          {d.buttons.map((b, i) => (
            <div key={i} className="grid grid-cols-[minmax(0,.8fr)_minmax(0,1.4fr)_auto] gap-2 max-[600px]:grid-cols-[minmax(0,1fr)_auto]">
              <input value={b.text} maxLength={64} onChange={(e) => set({ buttons: d.buttons.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)) })} placeholder="Label" className={field} aria-label={`Button ${i + 1} label`} />
              <input value={b.url} onChange={(e) => set({ buttons: d.buttons.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)) })} placeholder="https://gullylabs.xyz/tracker" className={`${field} max-[600px]:order-3 max-[600px]:col-span-2`} aria-label={`Button ${i + 1} link`} />
              <button type="button" onClick={() => set({ buttons: d.buttons.filter((_, j) => j !== i) })} className={`${tinyBtn} min-h-11`} aria-label={`Remove button ${i + 1}`}>
                <X size={14} aria-hidden />
              </button>
            </div>
          ))}
          {d.buttons.length < 3 && (
            <button type="button" onClick={() => set({ buttons: [...d.buttons, { text: '', url: 'https://' }] })} className={`${tinyBtn} self-start`}>
              <Plus size={14} aria-hidden /> Add a button row
            </button>
          )}
        </fieldset>

        <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
          <legend className={`${h3} mb-2`}>WHO GETS IT</legend>
          <div className="flex flex-wrap items-end gap-2">
            <label className="flex min-w-[200px] flex-1 flex-col gap-2 text-[13px] text-ink-2">
              Segment
              <select value={d.segment.kind} onChange={(e) => {
                  const kind = e.target.value as SegKind
                  set({ segment: kind === 'language' ? { kind, language: ov.stats.languages[0]?.lang ?? 'en' } : kind === 'active' ? { kind, days: 30 } : { kind } })
                }} className={field}>
                {SEGMENTS.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>
            {d.segment.kind === 'language' && (
              <label className="flex w-[160px] flex-col gap-2 text-[13px] text-ink-2">
                Language
                <select value={d.segment.language} onChange={(e) => set({ segment: { kind: 'language', language: e.target.value } })} className={field}>
                  {(ov.stats.languages.length ? ov.stats.languages : [{ lang: 'en', count: 0 }]).map((l) => (
                    <option key={l.lang} value={l.lang}>
                      {l.lang} · {l.count}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {d.segment.kind === 'active' && (
              <label className="flex w-[160px] flex-col gap-2 text-[13px] text-ink-2">
                Active in the last (days)
                <input type="number" min={1} max={365} value={d.segment.days ?? 30} onChange={(e) => set({ segment: { kind: 'active', days: Math.max(1, Math.min(365, Number(e.target.value) || 1)) } })} className={field} />
              </label>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-3 rounded-input border border-line bg-bg-alt px-4 py-3" aria-live="polite">
            <Users size={18} className="text-gold" aria-hidden />
            <span className="font-display text-[26px] leading-none font-bold text-ink">{audience ? <AnimatedNumber value={audience.count} /> : '…'}</span>
            <span className="text-[13px] text-muted">{audience ? `people get it · ${audience.optedOut} opted out and ${audience.blocked} who blocked the bot are left out` : 'counting…'}</span>
          </div>
        </fieldset>

        <label className="inline-flex min-h-11 cursor-pointer items-center gap-3 self-start text-[14px] text-ink-2">
          <input type="checkbox" checked={d.urgent} onChange={(e) => set({ urgent: e.target.checked })} className="size-5 accent-[#d9b563]" />
          Urgent (skip the one-broadcast-a-day limit)
        </label>
        {blockedByDay && <span className="text-[13px] text-gold">One broadcast a day: the next can go from {when(ov.nextAllowedAt)}, or tick Urgent.</span>}

        {errors.length > 0 && (
          <ul className="m-0 flex list-none flex-col gap-1 rounded-input border border-error/50 px-3 py-2 text-[13px] text-error" role="alert">
            {errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        )}

        <div className="flex flex-col gap-3 border-t border-line pt-4">
          <div className="flex flex-wrap items-end gap-2">
            <label className="flex min-w-[200px] flex-1 flex-col gap-2 text-[13px] text-ink-2">
              Send a test to
              <select value={testTo} onChange={(e) => setTestTo(e.target.value)} className={field}>
                {!ov.testTargets.length && <option value="">Set TELEGRAM_ADMIN_CHAT_ID or link your Telegram</option>}
                {ov.testTargets.map((x) => (
                  <option key={x.chatId} value={x.chatId}>
                    {x.label}
                  </option>
                ))}
              </select>
            </label>
            <button type="button" onClick={testSend} disabled={!checked || !!errors.length || !!busy || !testTo} className={ghostBtn}>
              {busy === 'test' ? <LoaderCircle size={16} className="animate-spin" aria-hidden /> : <Eye size={16} aria-hidden />} Send test to me
            </button>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-2 text-[13px] text-ink-2">
              Schedule (your local time)
              <input type="datetime-local" value={schedAt} onChange={(e) => setSchedAt(e.target.value)} className={field} />
            </label>
            <button type="button" onClick={() => ask('schedule')} disabled={!canSend || !scheduleIso} className={ghostBtn}>
              <CalendarClock size={16} aria-hidden /> Schedule…
            </button>
            <button type="button" onClick={() => ask('send')} disabled={!canSend || blockedByDay} className={goldBtn}>
              <Send size={16} aria-hidden /> Send now…
            </button>
          </div>
          {!ov.enabled && <span className="text-[13px] text-error">TELEGRAM_BOT_TOKEN is not set: broadcasts are off.</span>}
          {confirm && (
            <div role="alertdialog" aria-labelledby="tgb-confirm" className="flex flex-col gap-3 rounded-input border border-gold bg-[rgba(217,181,99,.08)] p-4">
              <p id="tgb-confirm" className="m-0 text-[15px] text-ink">
                {confirm.action === 'send' ? 'Send this now to' : `Schedule this for ${when(scheduleIso)} to`} <b className="text-gold">{confirm.count.toLocaleString('en-US')} people</b> ({segLabel(d.segment)})?
              </p>
              <span className={small}>Delivered at up to {ov.rate} a second. Each message ends with 🔕 Stop announcements.{confirm.action === 'schedule' ? ' The audience is counted again when it goes out.' : ''}</span>
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={go} disabled={!!busy} className={goldBtn}>
                  {busy ? <LoaderCircle size={16} className="animate-spin" aria-hidden /> : <Send size={16} aria-hidden />} Yes, {confirm.action === 'send' ? 'send' : 'schedule'} to {confirm.count.toLocaleString('en-US')}
                </button>
                <button type="button" onClick={() => setConfirm(null)} className={ghostBtn}>
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="flex min-w-0 flex-col gap-2 min-[1024px]:sticky min-[1024px]:top-4 min-[1024px]:self-start">
        <span className={h3}>LIVE PREVIEW · PRIVATE CHAT</span>
        <DmBubble html={checked?.text ?? ''} media={media} buttons={d.buttons.filter((b) => b.text || b.url !== 'https://')} />
      </div>
    </div>
  )
}

/* --------------------------------------------------------------- history --- */

function Recipients({ token, id }: { token: string; id: string }) {
  const [rows, setRows] = useState<Recipient[] | null>(null)
  const [more, setMore] = useState(0)
  useEffect(() => {
    adminCall<{ recipients: Recipient[]; more: number }>(token, `/api/admin/broadcasts/${id}`).then((r) => {
      if (r.ok) {
        setRows(r.data.recipients)
        setMore(r.data.more)
      }
    })
  }, [token, id])
  if (!rows) return <span className={small}>Loading…</span>
  if (!rows.length) return <span className={small}>No recipients.</span>
  return (
    <div className="max-h-[280px] overflow-auto rounded-input border border-line">
      <table className="w-full min-w-[420px] border-collapse text-[13px]">
        <thead>
          <tr className="border-b border-line text-left font-mono text-[11px] tracking-[1px] text-faint">
            <th className="px-3 py-2 font-medium">#</th>
            <th className="px-3 py-2 font-medium">CHAT</th>
            <th className="px-3 py-2 font-medium">STATUS</th>
            <th className="px-3 py-2 font-medium">NOTE</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.n} className="border-b border-line last:border-0">
              <td className="px-3 py-1 font-mono text-faint">{r.n}</td>
              <td className="px-3 py-1 font-mono text-ink-2">{r.chat}</td>
              <td className={`px-3 py-1 ${r.status === 'sent' ? 'text-green' : r.status === 'failed' || r.status === 'blocked' ? 'text-error' : 'text-muted'}`}>
                {r.status}
                {r.deleted ? ' · deleted' : ''}
                {r.opened ? ' · opened' : ''}
              </td>
              <td className="px-3 py-1 text-faint">{r.error ?? ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {more > 0 && <p className={`${small} m-0 px-3 py-2`}>…and {more.toLocaleString('en-US')} more</p>}
    </div>
  )
}

function History({ token, ov, reload }: { token: string; ov: Overview; reload: () => void }) {
  const [busy, setBusy] = useState<string | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const act = async (b: Broadcast, action: 'pause' | 'resume' | 'cancel' | 'resend' | 'delete', ok: string) => {
    if (action === 'delete' && !window.confirm(`Delete this broadcast for everyone? ${b.counts.sent - b.counts.deleted} delivered messages are removed from people’s chats.`)) return
    if (action === 'cancel' && !window.confirm('Cancel this broadcast? Nobody else gets it.')) return
    if (action === 'resend' && !window.confirm(`Re-send to the ${b.counts.failed} people it failed for?`)) return
    setBusy(b.id + action)
    const r = await adminCall(token, `/api/admin/broadcasts/${b.id}/${action}`, {})
    setBusy(null)
    if (r.ok) toastSuccess(ok)
    else toastError('Not done', { detail: r.error })
    reload()
  }
  const list = ov.broadcasts.slice(0, 40)
  if (!list.length)
    return (
      <div className="flex items-center gap-3 rounded-input border border-dashed border-line-strong px-4 py-5 text-[14px] text-muted">
        <span className="relative inline-flex size-2">
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-gold opacity-60" />
          <span className="relative inline-flex size-2 rounded-full bg-gold" />
        </span>
        No broadcasts yet. Compose one above.
      </div>
    )
  return (
    <ul className="m-0 flex list-none flex-col gap-2 p-0">
      {list.map((b) => (
        <li key={b.id} className="flex flex-col gap-2 rounded-input border border-line px-4 py-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className={pillCls(`tracking-[.5px] uppercase ${STATUS_STYLE[b.status]}`)}>{b.status}</span>
                {b.kind === 'teaser' && <span className={pillCls('border-line-strong text-muted')}>channel teaser</span>}
                {b.urgent && <span className={pillCls('border-error text-error')}>urgent</span>}
                <span className={small}>{b.status === 'scheduled' ? `for ${when(b.scheduledAt)}` : b.startedAt ? `sent ${when(b.startedAt)}` : `created ${when(b.createdAt)}`} · {segLabel(b.segment)}</span>
              </div>
              <p className="m-0 line-clamp-2 text-[14px] break-words text-ink-2">{plainOf(b.text) || '(media only)'}</p>
              {b.error && <p className="m-0 text-[13px] text-error">{b.error}</p>}
            </div>
            <div className="flex flex-wrap gap-1">
              {b.status === 'sending' && (
                <button type="button" onClick={() => act(b, 'pause', 'Paused')} disabled={!!busy} className={tinyBtn}>
                  <Pause size={13} aria-hidden /> Pause
                </button>
              )}
              {b.status === 'paused' && (
                <button type="button" onClick={() => act(b, 'resume', 'Sending again')} disabled={!!busy} className={tinyBtn}>
                  <Play size={13} aria-hidden /> Resume
                </button>
              )}
              {['sending', 'paused', 'scheduled'].includes(b.status) && (
                <button type="button" onClick={() => act(b, 'cancel', 'Cancelled')} disabled={!!busy} className={tinyBtn}>
                  <Ban size={13} aria-hidden /> Cancel
                </button>
              )}
              {b.counts.failed > 0 && ['sent', 'cancelled', 'paused'].includes(b.status) && (
                <button type="button" onClick={() => act(b, 'resend', 'Re-sending to failed')} disabled={!!busy} className={tinyBtn}>
                  <RotateCcw size={13} aria-hidden /> Re-send to {b.counts.failed} failed
                </button>
              )}
              {b.canDelete && (
                <button type="button" onClick={() => act(b, 'delete', 'Deleting for everyone')} disabled={!!busy} className={`${tinyBtn} hover:border-error hover:text-error`} title={b.deleteUntil ? `Possible until ${when(b.deleteUntil)}` : undefined}>
                  <Trash2 size={13} aria-hidden /> Delete for everyone
                </button>
              )}
              {b.startedAt && (
                <button type="button" onClick={() => setOpen(open === b.id ? null : b.id)} className={tinyBtn} aria-expanded={open === b.id}>
                  <ChevronDown size={13} className={open === b.id ? 'rotate-180' : ''} aria-hidden /> Recipients
                </button>
              )}
            </div>
          </div>
          {b.startedAt && (
            <>
              <Progress c={b.counts} />
              <span className={small}>
                {b.counts.sent.toLocaleString('en-US')} delivered · {b.counts.failed} failed · {b.counts.blocked} blocked · {b.counts.pending} to go · {b.opened} opened a link · {b.optOuts} stopped announcements{b.counts.deleted ? ` · ${b.counts.deleted} deleted` : ''}
              </span>
            </>
          )}
          {open === b.id && <Recipients token={token} id={b.id} />}
        </li>
      ))}
    </ul>
  )
}

/* ------------------------------------------------------------------ root --- */

export function TelegramBroadcasts({ token }: { token: string }) {
  const [ov, setOv] = useState<Overview | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const load = useCallback(() => {
    adminCall<Overview>(token, '/api/admin/broadcasts').then((r) => (r.ok ? (setOv(r.data), setErr(null)) : setErr(r.error)))
  }, [token])
  const live = !!ov?.broadcasts.some((b) => b.status === 'sending' || b.status === 'deleting')
  useEffect(() => {
    load()
    const id = setInterval(load, live ? 3_000 : 30_000)
    return () => clearInterval(id)
  }, [load, live])

  return (
    <section className={card} aria-labelledby="admin-tg-broadcasts">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h2 id="admin-tg-broadcasts" className={`${h2} inline-flex items-center gap-2`}>
            <Megaphone size={20} className="text-gold" aria-hidden /> Bot broadcasts
          </h2>
          <span className={small}>DMs to everyone who started @GullyLabsBot · {ov ? (ov.enabled ? 'bot on' : 'bot off') : 'loading'} · opted-out and blocked users are never sent</span>
        </div>
      </div>
      {err && <p className="m-0 font-mono text-[12px] text-error">{err}</p>}
      {!ov && !err && <span className={small}>Loading…</span>}
      {ov && (
        <>
          <Analytics ov={ov} />
          <OwnerStep />
          <div className="flex flex-col gap-3 border-t border-line pt-5">
            <h3 className={h3}>NEW BROADCAST</h3>
            <Composer token={token} ov={ov} reload={load} />
          </div>
          <div className="flex flex-col gap-3 border-t border-line pt-5">
            <h3 className={h3}>HISTORY</h3>
            <History token={token} ov={ov} reload={load} />
          </div>
        </>
      )}
    </section>
  )
}
