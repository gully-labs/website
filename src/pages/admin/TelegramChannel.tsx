import { Bold, CalendarClock, Code, Eye, ExternalLink, Italic, Link2, LoaderCircle, MessageCircle, Pencil, Pin, Plus, RotateCcw, Send, Trash2, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatedNumber } from '../../components/charts/AnimatedNumber'
import { C, sparklinePreset } from '../../components/charts/chartPresets'
import { GhostChart } from '../../components/charts/GhostChart'
import { EChart } from '../../components/charts/EChart'
import { toastError, toastInfo, toastSuccess } from '../../components/ui/toast'
import { adminCall } from './payAdmin'
import { LINK_BLUE, renderTg } from './tgHtml'
import { NewTabNote } from './newTab'
import { chip, pillCls } from './ui'

/* Admin: posts to the Gully Labs News channel (@GullyLabsNews) through the bot, plus the automatic posts.
   Server: server/telegram-channel.mjs behind /api/admin/channel* (admin token). The preview renders the
   server-sanitized Telegram HTML (POST /api/admin/channel/validate) as React elements, never as innerHTML.
   "✨ Draft with Gully AI" calls the content studio's draft route (kind telegram_post) and only fills the
   composer: nothing is posted until the admin presses Post now or Schedule. */

type Status = 'draft' | 'scheduled' | 'sent' | 'failed' | 'deleted'
type Media = null | { kind: 'photo' | 'animation'; url?: string; banner?: boolean; fileId?: string }
interface Btn {
  text: string
  url: string
}
interface Post {
  id: string
  status: Status
  text: string
  media: Media
  buttons: Btn[]
  pin: boolean
  pinned?: boolean
  scheduledAt: string | null
  sentAt: string | null
  messageId: number | null
  error: string | null
  createdBy: string
  createdAt: string
  url: string | null
  length: number
  limit: number
  history: { at: string; action: string; ok: boolean; error?: string; by: string }[]
}
interface AutoType {
  enabled: boolean
  template: string
  time?: string
  day?: number
}
interface Auto {
  timezone: string
  quietHours: { enabled: boolean; start: string; end: string }
  minGapMinutes: number
  launches: AutoType
  dailyGaps: AutoType
  weeklyMovers: AutoType
  blog: AutoType
  releases: AutoType
  ghostConfigured: boolean
  pending: { type: string; key: string; at: string }[]
  blocked: 'quiet' | 'gap' | null
}
interface View {
  channel: string
  channelUrl: string | null
  enabled: boolean
  limits: { text: number; caption: number; buttons: number }
  posts: Post[]
  testChat: string | null
  linkedChats: { chatId: string; address: string; chatType: string; chatTitle: string | null }[]
  auto: Auto
}
interface Followers {
  count: number | null
  at: string | null
  error: string | null
  series: { day: string; count: number }[]
}
interface Checked {
  text: string
  length: number
  limit: number
  errors: string[]
}

const card = 'flex min-w-0 flex-col gap-5 rounded-card border border-line bg-surface p-6 max-[600px]:p-4'
const h2 = 'm-0 font-display text-[22px] font-bold uppercase'
const h3 = 'm-0 font-mono text-[11px] tracking-[1px] text-faint'
const small = 'font-mono text-[12px] text-faint'
const field = 'min-h-11 min-w-0 rounded-input border border-line-strong bg-bg px-3 text-[14px] text-ink outline-none focus:border-gold'
const ghostBtn = 'inline-flex min-h-11 items-center gap-2 rounded-btn border border-line-strong px-4 text-[14px] text-ink-2 transition-colors hover:border-gold hover:text-ink disabled:opacity-40'
const goldBtn = 'inline-flex min-h-11 items-center gap-2 rounded-btn bg-gold px-5 text-[15px] font-semibold text-bg transition-colors hover:bg-gold-hover disabled:opacity-40'
const tinyBtn = 'inline-flex min-h-11 items-center gap-1 rounded-btn border border-line-strong px-3 text-[13px] text-ink-2 hover:border-gold hover:text-ink'

const STATUS_STYLE: Record<Status, string> = {
  draft: 'border-line-strong text-muted',
  scheduled: 'border-gold-line text-gold',
  sent: 'border-success-line text-green',
  failed: 'border-error text-error',
  deleted: 'border-line text-faint line-through',
}
const AUTO_META: { id: 'launches' | 'dailyGaps' | 'weeklyMovers' | 'blog' | 'releases'; label: string; about: string; vars: string }[] = [
  { id: 'launches', label: 'DeepCore new launches', about: 'Each new launch from the DeepCore poller.', vars: '{symbol} {chain} {pools} {link}' },
  { id: 'dailyGaps', label: 'Daily widest gaps', about: 'Top 5 trusted gaps from the tracker, at a set time.', vars: '{list} {date} {link}' },
  { id: 'weeklyMovers', label: 'Weekly movers recap', about: 'Biggest 7-day on-chain price changes, once a week.', vars: '{list} {date} {link}' },
  { id: 'blog', label: 'New blog post', about: 'blog.gullylabs.xyz is checked every 10 minutes.', vars: '{title} {excerpt} {link}' },
  { id: 'releases', label: 'Product releases', about: 'New dated entries of the docs changelog.', vars: '{date} {summary} {link}' },
]
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—')
const utc = (iso: string) => new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }) + ' UTC'
const toLocalInput = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16)
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`

/** A Telegram-style dark channel bubble with its media and URL buttons. */
function Bubble({ channel, html, media, buttons, empty = 'Your post appears here as it will look in the channel.' }: { channel: string; html: string; media: Media; buttons: Btn[]; empty?: string }) {
  const img = media?.banner ? '/brand/telegram/banner.gif' : media?.url
  return (
    <div className="rounded-card border border-line bg-bg-alt p-4" aria-label="Telegram preview">
      <div className="mx-auto flex max-w-[420px] flex-col gap-1">
        <div className="overflow-hidden rounded-[14px] rounded-bl-[4px] bg-surface-hover shadow-[0_1px_0_rgba(0,0,0,.35)]">
          {media && (img ? <img src={img} alt="" className="block max-h-[260px] w-full bg-bg object-cover" onError={(e) => ((e.currentTarget.style.opacity = '0.2'))} /> : <div className="grid h-[140px] place-items-center bg-bg text-[12px] text-faint">media by file_id</div>)}
          <div className="flex flex-col gap-1 px-3 pt-2 pb-1">
            <span className="text-[13px] font-semibold" style={{ color: LINK_BLUE }}>
              Gully Labs
            </span>
            <div className="text-[14px] leading-[1.45] break-words whitespace-pre-wrap text-ink">{html ? renderTg(html) : <span className="text-faint">{empty}</span>}</div>
            <span className="self-end font-mono text-[11px] text-faint">{channel} · now</span>
          </div>
        </div>
        {buttons.map((b, i) => (
          <a key={i} href={b.url || undefined} target="_blank" rel="noopener noreferrer" className="flex min-h-11 items-center justify-center gap-1 rounded-[8px] bg-surface-hover px-3 text-center text-[13px] text-ink-2 hover:bg-line-strong">
            {b.text || 'Button'} <ExternalLink size={12} aria-hidden />
            <NewTabNote />
          </a>
        ))}
      </div>
    </div>
  )
}

/* -------------------------------------------------------------- followers --- */

function FollowersCard({ token, channel }: { token: string; channel: string }) {
  const [f, setF] = useState<Followers | null>(null)
  const load = useCallback(() => {
    adminCall<Followers>(token, '/api/admin/channel/followers').then((r) => r.ok && setF(r.data))
  }, [token])
  useEffect(() => {
    load()
    const id = setInterval(load, 60_000)
    return () => clearInterval(id)
  }, [load])
  const series = useMemo(() => f?.series ?? [], [f])
  const option = useMemo(() => sparklinePreset({ data: series.map((s) => s.count), labels: series.map((s) => s.day), color: C.gold, fmt: (v) => `${v.toLocaleString('en-US')} followers` }), [series])
  return (
    <div className="flex min-w-[240px] flex-1 items-center gap-4 rounded-input border border-line bg-bg-alt px-4 py-3">
      <div className="flex flex-col">
        <span className={h3}>FOLLOWERS · LIVE</span>
        <span className="font-display text-[30px] leading-none font-bold text-ink">{f?.count == null ? <span className="text-[16px] text-faint">{f ? 'unreadable' : '…'}</span> : <AnimatedNumber value={f.count} countUp />}</span>
        <span className={small}>{f?.error ? f.error : `${channel} · getChatMemberCount`}</span>
      </div>
      <div className="h-[56px] min-w-[120px] flex-1">
        {series.length >= 2 ? (
          <EChart option={option} height={56} label={`Daily follower counts of ${channel}: ${series.length} days, latest ${series.at(-1)?.count}.`} skeleton="line" steps={{ count: series.length }} />
        ) : (
          <GhostChart height={56} label="Draws from day two" badge={false} framed={false} />
        )}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------- composer --- */

interface Draft {
  text: string
  mediaMode: 'none' | 'url' | 'banner'
  mediaKind: 'photo' | 'animation'
  mediaUrl: string
  buttons: Btn[]
  pin: boolean
}
const EMPTY: Draft = { text: '', mediaMode: 'none', mediaKind: 'photo', mediaUrl: '', buttons: [], pin: false }
const mediaOf = (d: Draft): Media => (d.mediaMode === 'banner' ? { kind: 'animation', banner: true } : d.mediaMode === 'url' && d.mediaUrl.trim() ? { kind: d.mediaKind, url: d.mediaUrl.trim() } : null)
const draftOf = (p: Post): Draft => ({ text: p.text, mediaMode: p.media?.banner ? 'banner' : p.media?.url ? 'url' : 'none', mediaKind: p.media?.kind ?? 'photo', mediaUrl: p.media?.url ?? '', buttons: p.buttons.map((b) => ({ ...b })), pin: p.pin })

function Composer({ token, view, editing, onDone, reload }: { token: string; view: View; editing: Post | null; onDone: () => void; reload: () => void }) {
  const [d, setD] = useState<Draft>(() => (editing ? draftOf(editing) : EMPTY))
  const [checked, setChecked] = useState<Checked | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [schedAt, setSchedAt] = useState(() => toLocalInput(new Date(Date.now() + 3_600_000)))
  const [topic, setTopic] = useState('')
  const [testChat, setTestChat] = useState(view.testChat ?? view.linkedChats[0]?.chatId ?? '')
  // "Send to channel and DM users": after the post, a short "New in the channel →" DM to everyone who started the bot.
  const [dm, setDm] = useState(false)
  const [dmUrgent, setDmUrgent] = useState(false)
  const ta = useRef<HTMLTextAreaElement>(null)
  const set = (p: Partial<Draft>) => setD((x) => ({ ...x, ...p }))
  const media = mediaOf(d)
  const payload = { text: d.text, media, buttons: d.buttons, pin: d.pin }
  const key = JSON.stringify(payload)

  // The server sanitizes and counts; the preview shows exactly what Telegram will get.
  useEffect(() => {
    const id = setTimeout(() => {
      adminCall<Checked>(token, '/api/admin/channel/validate', JSON.parse(key)).then((r) => r.ok && setChecked(r.data))
    }, 250)
    return () => clearTimeout(id)
  }, [key, token])

  const wrap = (open: string, close: string, placeholder = 'text') => {
    const el = ta.current
    if (!el) return
    const { selectionStart: a, selectionEnd: b, value } = el
    const sel = value.slice(a, b) || placeholder
    const next = value.slice(0, a) + open + sel + close + value.slice(b)
    set({ text: next })
    requestAnimationFrame(() => {
      el.focus()
      el.setSelectionRange(a + open.length, a + open.length + sel.length)
    })
  }
  const addLink = () => {
    const url = window.prompt('Link (https://…)', 'https://gullylabs.xyz/')
    if (url) wrap(`<a href="${url.replace(/"/g, '%22')}">`, '</a>', 'link text')
  }

  const limit = media ? view.limits.caption : view.limits.text
  const length = checked?.length ?? d.text.length
  const errors = checked?.errors ?? []
  const canSend = !!checked && !errors.length && !busy
  const scheduleIso = schedAt ? new Date(schedAt).toISOString() : null

  const call = async (label: string, path: string, body: unknown, ok: string) => {
    setBusy(label)
    const r = await adminCall<{ post?: Post; chatTitle?: string | null }>(token, path, body)
    setBusy(null)
    if (!r.ok) {
      toastError(`${label} failed`, { detail: r.error })
      reload()
      return false
    }
    toastSuccess(ok, r.data.post?.url ? { detail: r.data.post.url } : undefined)
    reload()
    return true
  }

  /** The DM part of a post: asks for the exact audience and a confirm, or null to stop. undefined = no DM. */
  const dmFor = async (what: string): Promise<{ confirm: number; urgent: boolean } | null | undefined> => {
    if (!dm || editing) return undefined
    const a = await adminCall<{ count: number }>(token, '/api/admin/broadcasts/audience', { segment: { kind: 'all' } })
    if (!a.ok) return toastError('Could not count the bot users', { detail: a.error }), null
    if (!a.data.count) return toastError('Nobody to DM yet', { detail: 'No one who started the bot has announcements on. Untick the DM option to post only.' }), null
    if (!window.confirm(`${what} to ${view.channel} and DM exactly ${a.data.count.toLocaleString('en-US')} bot users a short "New in the channel →" note?`)) return null
    return { confirm: a.data.count, urgent: dmUrgent }
  }

  const testSend = () => call('Test send', '/api/admin/channel/test', { ...payload, chatId: testChat || undefined }, 'Test sent to your Telegram')
  const postNow = async () => {
    const withDm = await dmFor('Post this now')
    if (withDm === null) return
    if (!withDm && !window.confirm(`Post this to ${view.channel} now? Every follower will see it.`)) return
    const ok = editing && editing.status !== 'sent' ? (await call('Save', `/api/admin/channel/posts/${editing.id}`, payload, 'Saved')) && (await call('Post', `/api/admin/channel/posts/${editing.id}/post`, {}, `Posted to ${view.channel}`)) : await call('Post', '/api/admin/channel/posts', { ...payload, action: 'post', ...(withDm ? { dm: withDm } : {}) }, withDm ? `Posted to ${view.channel}, DMs going out` : `Posted to ${view.channel}`)
    if (ok) {
      setD(EMPTY)
      onDone()
    }
  }
  const schedule = async () => {
    if (!scheduleIso) return
    const withDm = await dmFor(`Schedule this for ${utc(scheduleIso)}`)
    if (withDm === null) return
    const ok = editing ? await call('Schedule', `/api/admin/channel/posts/${editing.id}`, { ...payload, scheduledAt: scheduleIso }, `Scheduled for ${utc(scheduleIso)}`) : await call('Schedule', '/api/admin/channel/posts', { ...payload, action: 'schedule', scheduledAt: scheduleIso, ...(withDm ? { dm: withDm } : {}) }, `Scheduled for ${utc(scheduleIso)}`)
    if (ok) {
      setD(EMPTY)
      onDone()
    }
  }
  const saveDraft = async () => {
    const ok = editing ? await call('Save', `/api/admin/channel/posts/${editing.id}`, payload, editing.status === 'sent' ? 'Updated in Telegram' : 'Saved') : await call('Save', '/api/admin/channel/posts', { ...payload, action: 'draft' }, 'Draft saved')
    if (ok) {
      setD(EMPTY)
      onDone()
    }
  }
  const aiDraft = async () => {
    if (!topic.trim()) return toastInfo('Give Gully AI a topic first')
    setBusy('ai')
    const r = await fetch('/api/admin/ask/draft', { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ kind: 'telegram_post', topic: topic.trim() }) }).catch(() => null)
    const j = r ? await r.json().catch(() => null) : null
    setBusy(null)
    if (!r?.ok) return toastError('Gully AI could not draft this', { detail: j?.error ?? 'The server could not be reached.' })
    const text = String(j.markdown ?? '').replace(/\n*Sources:[^\n]*$/i, '').replace(/\s*\[\d{1,2}\]/g, '').trim()
    set({ text })
    toastSuccess('Draft ready: edit it, then post', { detail: j.warnings?.length ? j.warnings.join(' ') : 'Nothing is posted until you press Post now or Schedule.' })
  }

  const sentEdit = editing?.status === 'sent'
  return (
    <div className="grid grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] gap-6 max-[1023px]:grid-cols-1">
      <div className="flex min-w-0 flex-col gap-4">
        {editing && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-input border border-gold-line px-3 py-2 text-[13px] text-gold">
            <span>{sentEdit ? 'Editing a sent post: saving edits it in the channel.' : `Editing a ${editing.status} post.`}</span>
            <button type="button" onClick={() => (setD(EMPTY), onDone())} className={tinyBtn}>
              <X size={14} aria-hidden /> Cancel
            </button>
          </div>
        )}
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex min-w-[200px] flex-1 flex-col gap-2 text-[13px] text-ink-2">
            Gully AI topic
            <input value={topic} maxLength={300} onChange={(e) => setTopic(e.target.value)} placeholder="Telegram gap alerts are live" className={field} />
          </label>
          <button type="button" onClick={aiDraft} disabled={!!busy} className={ghostBtn}>
            {busy === 'ai' ? <LoaderCircle size={16} className="animate-spin" aria-hidden /> : <span aria-hidden>✨</span>} Draft with Gully AI
          </button>
        </div>

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
              <button type="button" onClick={() => wrap('<code>', '</code>')} className={tinyBtn} aria-label="Code">
                <Code size={14} aria-hidden />
              </button>
            </div>
            <span className={`font-mono text-[12px] ${length > limit ? 'text-error' : length > limit * 0.9 ? 'text-gold' : 'text-faint'}`} aria-live="polite">
              {length.toLocaleString('en-US')} / {limit.toLocaleString('en-US')} {media ? '(caption)' : ''}
            </span>
          </div>
          <label className="sr-only" htmlFor="tgc-text">
            Post text (Telegram HTML)
          </label>
          <textarea id="tgc-text" ref={ta} value={d.text} rows={9} onChange={(e) => set({ text: e.target.value })} placeholder={'<b>Gap alerts now reach Telegram</b>\nGet a message the moment a gap opens.'} className={`${field} py-3 font-mono text-[13px] leading-[1.55]`} />
          <span className={small}>Telegram HTML: b, i, u, s, a, code, pre, blockquote, tg-spoiler. Anything else is removed.</span>
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
              <label key={k} className={`${chip(d.mediaMode === k)} ${sentEdit ? 'pointer-events-none opacity-50' : ''}`}>
                <input type="radio" name="tgc-media" value={k} checked={d.mediaMode === k} onChange={() => set({ mediaMode: k })} className="sr-only" disabled={sentEdit} />
                {label}
              </label>
            ))}
          </div>
          {d.mediaMode === 'url' && (
            <div className="flex flex-wrap gap-2">
              <select value={d.mediaKind} onChange={(e) => set({ mediaKind: e.target.value as 'photo' | 'animation' })} className={field} aria-label="Media kind" disabled={sentEdit}>
                <option value="photo">Photo</option>
                <option value="animation">GIF / animation</option>
              </select>
              <input value={d.mediaUrl} onChange={(e) => set({ mediaUrl: e.target.value })} placeholder="https://gullylabs.xyz/social/og-image-1200x630.png" className={`${field} flex-1`} aria-label="Image or GIF URL" disabled={sentEdit} />
            </div>
          )}
        </fieldset>

        <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
          <legend className={`${h3} mb-2`}>BUTTONS (UP TO {view.limits.buttons}, HTTPS)</legend>
          {d.buttons.map((b, i) => (
            <div key={i} className="grid grid-cols-[minmax(0,.8fr)_minmax(0,1.4fr)_auto] gap-2 max-[600px]:grid-cols-[minmax(0,1fr)_auto]">
              <input value={b.text} maxLength={64} onChange={(e) => set({ buttons: d.buttons.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)) })} placeholder="Label" className={field} aria-label={`Button ${i + 1} label`} />
              <input value={b.url} onChange={(e) => set({ buttons: d.buttons.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)) })} placeholder="https://gullylabs.xyz/tracker" className={`${field} max-[600px]:order-3 max-[600px]:col-span-2`} aria-label={`Button ${i + 1} link`} />
              <button type="button" onClick={() => set({ buttons: d.buttons.filter((_, j) => j !== i) })} className={`${tinyBtn} min-h-11`} aria-label={`Remove button ${i + 1}`}>
                <X size={14} aria-hidden />
              </button>
            </div>
          ))}
          {d.buttons.length < view.limits.buttons && (
            <button type="button" onClick={() => set({ buttons: [...d.buttons, { text: '', url: 'https://' }] })} className={`${tinyBtn} self-start`}>
              <Plus size={14} aria-hidden /> Add a button row
            </button>
          )}
        </fieldset>

        <label className="inline-flex min-h-11 cursor-pointer items-center gap-3 self-start text-[14px] text-ink-2">
          <input type="checkbox" checked={d.pin} onChange={(e) => set({ pin: e.target.checked })} className="size-5 accent-[#d9b563]" />
          <Pin size={15} aria-hidden /> Pin in the channel
        </label>

        {!editing && (
          <div className="flex flex-col gap-1">
            <label className="inline-flex min-h-11 cursor-pointer items-center gap-3 self-start text-[14px] text-ink-2">
              <input type="checkbox" checked={dm} onChange={(e) => setDm(e.target.checked)} className="size-5 accent-[#d9b563]" />
              <MessageCircle size={15} aria-hidden /> Send to channel and DM users
            </label>
            {dm && (
              <div className="flex flex-col gap-1 pl-8">
                <span className={small}>Everyone who started the bot (announcements on) gets a short “📣 New in the channel →” DM linking to this post. You confirm the exact count before it goes. One broadcast a day.</span>
                <label className="inline-flex min-h-11 cursor-pointer items-center gap-3 self-start text-[13px] text-ink-2">
                  <input type="checkbox" checked={dmUrgent} onChange={(e) => setDmUrgent(e.target.checked)} className="size-5 accent-[#d9b563]" /> Urgent (skip the one-a-day limit)
                </label>
              </div>
            )}
          </div>
        )}

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
              Test chat (your linked Telegram)
              <select value={testChat} onChange={(e) => setTestChat(e.target.value)} className={field}>
                {!view.linkedChats.length && <option value="">No linked chat: link yours in the app dashboard</option>}
                {view.linkedChats.map((c) => (
                  <option key={c.chatId} value={c.chatId}>
                    {c.chatTitle ?? c.chatType} · {short(c.address)}
                  </option>
                ))}
              </select>
            </label>
            <button type="button" onClick={testSend} disabled={!canSend || !testChat} className={ghostBtn}>
              {busy === 'Test send' ? <LoaderCircle size={16} className="animate-spin" aria-hidden /> : <Eye size={16} aria-hidden />} Send test to me
            </button>
          </div>
          {!sentEdit && (
            <div className="flex flex-wrap items-end gap-2">
              <label className="flex flex-col gap-2 text-[13px] text-ink-2">
                Schedule (your local time)
                <input type="datetime-local" value={schedAt} onChange={(e) => setSchedAt(e.target.value)} className={field} />
              </label>
              <button type="button" onClick={schedule} disabled={!canSend || !scheduleIso} className={ghostBtn}>
                <CalendarClock size={16} aria-hidden /> Schedule
              </button>
              {scheduleIso && <span className={`${small} pb-3`}>= {utc(scheduleIso)}</span>}
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2">
            {!sentEdit && (
              <button type="button" onClick={postNow} disabled={!canSend || !view.enabled} className={goldBtn}>
                {busy === 'Post' ? <LoaderCircle size={16} className="animate-spin" aria-hidden /> : <Send size={16} aria-hidden />} Post now
              </button>
            )}
            <button type="button" onClick={saveDraft} disabled={!canSend} className={sentEdit ? goldBtn : ghostBtn}>
              {sentEdit ? 'Save edit in Telegram' : editing ? 'Save' : 'Save draft'}
            </button>
            {!view.enabled && <span className="text-[13px] text-error">TELEGRAM_BOT_TOKEN is not set: posting is off.</span>}
          </div>
        </div>
      </div>

      <div className="flex min-w-0 flex-col gap-2 min-[1024px]:sticky min-[1024px]:top-4 min-[1024px]:self-start">
        <span className={h3}>LIVE PREVIEW · {view.channel}</span>
        <Bubble channel={view.channel} html={checked?.text ?? ''} media={media} buttons={d.buttons.filter((b) => b.text || b.url !== 'https://')} />
      </div>
    </div>
  )
}

/* -------------------------------------------------------------- history --- */

function History({ token, view, onEdit, reload }: { token: string; view: View; onEdit: (p: Post) => void; reload: () => void }) {
  const [busy, setBusy] = useState<string | null>(null)
  const act = async (p: Post, action: 'delete' | 'retry' | 'post' | 'unschedule', ok: string) => {
    if (action === 'delete' && !window.confirm(p.status === 'sent' ? `Delete this post from ${view.channel}? It disappears for every follower.` : 'Delete this post?')) return
    if (action === 'post' && !window.confirm(`Post this to ${view.channel} now?`)) return
    setBusy(p.id + action)
    const r = await adminCall<{ post: Post }>(token, `/api/admin/channel/posts/${p.id}/${action}`, {})
    setBusy(null)
    if (r.ok) toastSuccess(ok)
    else toastError(`${action[0].toUpperCase() + action.slice(1)} failed`, { detail: r.error })
    reload()
  }
  const posts = view.posts.slice(0, 50)
  if (!posts.length)
    return (
      <div className="flex items-center gap-3 rounded-input border border-dashed border-line-strong px-4 py-5 text-[14px] text-muted">
        <span className="relative inline-flex size-2">
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-gold opacity-60" />
          <span className="relative inline-flex size-2 rounded-full bg-gold" />
        </span>
        No posts yet. Compose one above, or switch on an automatic post.
      </div>
    )
  return (
    <ul className="m-0 flex list-none flex-col gap-2 p-0">
      {posts.map((p) => {
        const plain = p.text.replace(/<[^>]*>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
        return (
          <li key={p.id} className="flex flex-wrap items-start justify-between gap-3 rounded-input border border-line px-4 py-3">
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className={pillCls(`tracking-[.5px] uppercase ${STATUS_STYLE[p.status]}`)}>{p.status}</span>
                {p.createdBy.startsWith('auto:') && <span className={pillCls('border-line-strong text-muted')}>auto · {p.createdBy.slice(5)}</span>}
                {p.pinned && p.status === 'sent' && <Pin size={13} className="text-gold" aria-label="pinned" />}
                {p.media && <span className={small}>{p.media.banner ? 'banner' : p.media.kind}</span>}
                <span className={small}>{p.status === 'scheduled' && p.scheduledAt ? `for ${when(p.scheduledAt)} (${utc(p.scheduledAt)})` : p.sentAt ? `sent ${when(p.sentAt)}` : `created ${when(p.createdAt)}`}</span>
              </div>
              <p className="m-0 line-clamp-2 text-[14px] break-words text-ink-2">{plain || '(media only)'}</p>
              {p.error && <p className="m-0 text-[13px] text-error">{p.error}</p>}
            </div>
            <div className="flex flex-wrap gap-1">
              {p.url && p.status === 'sent' && (
                <a href={p.url} target="_blank" rel="noopener noreferrer" className={tinyBtn}>
                  View in Telegram ↗
                  <NewTabNote />
                </a>
              )}
              {p.status !== 'deleted' && (
                <button type="button" onClick={() => onEdit(p)} className={tinyBtn}>
                  <Pencil size={13} aria-hidden /> Edit
                </button>
              )}
              {p.status === 'failed' && (
                <button type="button" onClick={() => act(p, 'retry', `Posted to ${view.channel}`)} disabled={!!busy} className={tinyBtn}>
                  <RotateCcw size={13} aria-hidden /> Retry
                </button>
              )}
              {p.status === 'draft' && (
                <button type="button" onClick={() => act(p, 'post', `Posted to ${view.channel}`)} disabled={!!busy} className={tinyBtn}>
                  <Send size={13} aria-hidden /> Post
                </button>
              )}
              {p.status === 'scheduled' && (
                <button type="button" onClick={() => act(p, 'unschedule', 'Moved back to drafts')} disabled={!!busy} className={tinyBtn}>
                  Unschedule
                </button>
              )}
              {p.status !== 'deleted' && (
                <button type="button" onClick={() => act(p, 'delete', p.status === 'sent' ? `Deleted from ${view.channel}` : 'Deleted')} disabled={!!busy} className={`${tinyBtn} hover:border-error hover:text-error`}>
                  <Trash2 size={13} aria-hidden /> Delete
                </button>
              )}
            </div>
          </li>
        )
      })}
    </ul>
  )
}

/* ----------------------------------------------------------- auto posts --- */

function AutoPanel({ token, view, reload }: { token: string; view: View; reload: () => void }) {
  const a = view.auto
  const [tz, setTz] = useState(a.timezone)
  const [gap, setGap] = useState(String(a.minGapMinutes))
  const [quiet, setQuiet] = useState(a.quietHours)
  const [tpl, setTpl] = useState<Record<string, AutoType>>(() => Object.fromEntries(AUTO_META.map((m) => [m.id, { ...a[m.id] }])))
  const [preview, setPreview] = useState<Record<string, { text: string; buttons: Btn[]; skip: string | null } | undefined>>({})
  const save = async (body: unknown, ok: string) => {
    const r = await adminCall<{ auto: Auto }>(token, '/api/admin/channel/auto', body)
    if (r.ok) toastSuccess(ok)
    else toastError('Settings not saved', { detail: r.error })
    reload()
  }
  const showPreview = async (id: string) => {
    const r = await adminCall<{ preview: { text: string; buttons: Btn[]; errors: string[] } | null; skip: string | null }>(token, `/api/admin/channel/auto/${id}/preview`, {})
    if (!r.ok) return toastError('Preview failed', { detail: r.error })
    setPreview((x) => ({ ...x, [id]: { text: r.data.preview?.text ?? '', buttons: r.data.preview?.buttons ?? [], skip: r.data.skip } }))
    toastInfo(r.data.skip ? 'Nothing to post right now' : 'Preview rendered (not sent)', r.data.skip ? { detail: r.data.skip } : undefined)
  }
  const timezones = useMemo(() => {
    const list = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.('timeZone') ?? []
    return ['UTC', ...list.filter((z) => z !== 'UTC')]
  }, [])

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3 rounded-input border border-line bg-bg-alt p-4">
        <label className="flex min-w-[180px] flex-col gap-2 text-[13px] text-ink-2">
          Timezone
          <select value={tz} onChange={(e) => setTz(e.target.value)} className={field}>
            {timezones.map((z) => (
              <option key={z}>{z}</option>
            ))}
          </select>
        </label>
        <label className="flex w-[150px] flex-col gap-2 text-[13px] text-ink-2">
          Min gap (minutes)
          <input type="number" min={0} max={1440} value={gap} onChange={(e) => setGap(e.target.value)} className={field} />
        </label>
        <label className="inline-flex min-h-11 items-center gap-2 text-[13px] text-ink-2">
          <input type="checkbox" checked={quiet.enabled} onChange={(e) => setQuiet({ ...quiet, enabled: e.target.checked })} className="size-5 accent-[#d9b563]" /> Quiet hours
        </label>
        <input type="time" value={quiet.start} onChange={(e) => setQuiet({ ...quiet, start: e.target.value })} className={field} aria-label="Quiet hours start" />
        <span className="pb-3 text-faint">to</span>
        <input type="time" value={quiet.end} onChange={(e) => setQuiet({ ...quiet, end: e.target.value })} className={field} aria-label="Quiet hours end" />
        <button type="button" onClick={() => save({ timezone: tz, minGapMinutes: Number(gap), quietHours: quiet }, 'Auto-post rules saved')} className={ghostBtn}>
          Save rules
        </button>
        <span className={`${small} basis-full`}>
          {a.blocked === 'quiet' ? 'Quiet hours now: auto posts wait.' : a.blocked === 'gap' ? 'Within the minimum gap of the last post: auto posts wait.' : 'Auto posts may go out now.'} {a.pending.length ? `${a.pending.length} queued.` : 'Nothing queued.'}
        </span>
      </div>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,420px),1fr))] gap-3">
        {AUTO_META.map((m) => {
          const c = tpl[m.id]
          const on = a[m.id].enabled
          const pv = preview[m.id]
          return (
            <div key={m.id} className="flex min-w-0 flex-col gap-3 rounded-input border border-line p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex flex-col gap-1">
                  <span className="text-[15px] font-semibold text-ink">{m.label}</span>
                  <span className="text-[13px] text-muted">{m.about}</span>
                  {m.id === 'blog' && !a.ghostConfigured && <span className="text-[12px] text-gold">GHOST_CONTENT_KEY is not set: the blog cannot be read.</span>}
                </div>
                <button type="button" role="switch" aria-checked={on} aria-label={`${m.label} auto posts`} onClick={() => save({ [m.id]: { enabled: !on } }, `${m.label}: ${on ? 'off' : 'on'}`)} className="inline-flex min-h-11 min-w-12 shrink-0 items-center justify-center bg-transparent p-0">
                  <span className={`inline-flex h-7 w-12 items-center rounded-full border transition-colors ${on ? 'border-gold bg-[rgba(217,181,99,.25)]' : 'border-line-strong bg-bg'}`}>
                    <span className={`inline-block size-5 rounded-full transition-transform ${on ? 'translate-x-[22px] bg-gold' : 'translate-x-[3px] bg-faint'}`} />
                  </span>
                </button>
              </div>
              {(m.id === 'dailyGaps' || m.id === 'weeklyMovers') && (
                <div className="flex flex-wrap gap-2">
                  {m.id === 'weeklyMovers' && (
                    <select value={c.day} onChange={(e) => setTpl({ ...tpl, [m.id]: { ...c, day: Number(e.target.value) } })} className={field} aria-label="Day">
                      {DAYS.map((d, i) => (
                        <option key={d} value={i}>
                          {d}
                        </option>
                      ))}
                    </select>
                  )}
                  <input type="time" value={c.time} onChange={(e) => setTpl({ ...tpl, [m.id]: { ...c, time: e.target.value } })} className={field} aria-label="Time" />
                  <span className={`${small} self-center`}>{a.timezone}</span>
                </div>
              )}
              <label className="flex flex-col gap-1 text-[12px] text-faint">
                Template · {m.vars}
                <textarea value={c.template} rows={4} onChange={(e) => setTpl({ ...tpl, [m.id]: { ...c, template: e.target.value } })} className={`${field} py-2 font-mono text-[12px] leading-[1.5]`} />
              </label>
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={() => save({ [m.id]: { template: c.template, ...(c.time ? { time: c.time } : {}), ...(c.day !== undefined ? { day: c.day } : {}) } }, `${m.label}: saved`)} className={tinyBtn}>
                  Save
                </button>
                <button type="button" onClick={() => showPreview(m.id)} className={tinyBtn}>
                  <Eye size={13} aria-hidden /> Preview next post
                </button>
              </div>
              {pv && (pv.skip ? <p className="m-0 text-[13px] text-muted">{pv.skip}</p> : <Bubble channel={view.channel} html={pv.text} media={null} buttons={pv.buttons} />)}
            </div>
          )
        })}
      </div>
    </div>
  )
}

/* ----------------------------------------------------------------- root --- */

export function TelegramChannel({ token }: { token: string }) {
  const [view, setView] = useState<View | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [editing, setEditing] = useState<Post | null>(null)
  const [composerKey, setComposerKey] = useState(0)
  const top = useRef<HTMLDivElement>(null)
  const load = useCallback(() => {
    adminCall<View>(token, '/api/admin/channel').then((r) => (r.ok ? (setView(r.data), setErr(null)) : setErr(r.error)))
  }, [token])
  useEffect(() => {
    load()
    const id = setInterval(load, 30_000)
    return () => clearInterval(id)
  }, [load])

  return (
    <section className={card} aria-labelledby="admin-tg-channel">
      <div className="flex flex-wrap items-start justify-between gap-4" ref={top}>
        <div className="flex flex-col gap-1">
          <h2 id="admin-tg-channel" className={h2}>
            Telegram channel
          </h2>
          <span className={small}>
            {view ? (
              <>
                posts to{' '}
                {view.channelUrl ? (
                  <a href={view.channelUrl} target="_blank" rel="noopener noreferrer" className="text-gold hover:underline">
                    {view.channel} ↗
                    <NewTabNote />
                  </a>
                ) : (
                  view.channel
                )}{' '}
                as the bot · {view.enabled ? 'bot on' : 'bot off'}
              </>
            ) : (
              'compose, preview, test, schedule and post'
            )}
          </span>
        </div>
        {view && <FollowersCard token={token} channel={view.channel} />}
      </div>
      {err && <p className="m-0 font-mono text-[12px] text-error">{err}</p>}
      {!view && !err && <span className={small}>Loading…</span>}
      {view && (
        <>
          <Composer
            key={composerKey}
            token={token}
            view={view}
            editing={editing}
            reload={load}
            onDone={() => {
              setEditing(null)
              setComposerKey((k) => k + 1)
            }}
          />
          <div className="flex flex-col gap-3 border-t border-line pt-5">
            <h3 className={h3}>HISTORY</h3>
            <History
              token={token}
              view={view}
              reload={load}
              onEdit={(p) => {
                setEditing(p)
                setComposerKey((k) => k + 1)
                top.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
              }}
            />
          </div>
          <div className="flex flex-col gap-3 border-t border-line pt-5">
            <h3 className={h3}>AUTOMATIC POSTS · ALL OFF UNTIL SWITCHED ON</h3>
            <AutoPanel key={JSON.stringify(view.auto.timezone + view.auto.minGapMinutes + JSON.stringify(view.auto.quietHours))} token={token} view={view} reload={load} />
          </div>
        </>
      )}
    </section>
  )
}
