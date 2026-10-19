import { LoaderCircle, Radar, Send } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { toastError, toastSuccess } from '../../components/ui/toast'
import { adminCall } from './payAdmin'
import { renderTg } from './tgHtml'
import { pillCls } from './ui'

/* Admin: the daily Launch radar for the News channel (server/launch-radar.mjs, /api/admin/channel/radar).
   Shows today's draft as the channel will show it, makes or refreshes it from the Holder Map's measured facts,
   and posts it only on the admin's click (the scheduled job only drafts unless TELEGRAM_RADAR_AUTOPOST=1). */

interface Post {
  id: string
  status: string
  text: string
  url: string | null
  length: number
  limit: number
}
interface State {
  autopost: boolean
  draftsEnabled: boolean
  time: string
  today: Post | null
}

const card = 'flex min-w-0 flex-col gap-4 rounded-card border border-line bg-surface p-6 max-[600px]:p-4'
const btn = 'inline-flex min-h-11 items-center gap-2 rounded-btn border border-line-strong px-3 text-[13px] text-ink-2 transition-colors hover:border-gold hover:text-ink disabled:opacity-50'

export function LaunchRadar({ token }: { token: string }) {
  const [state, setState] = useState<State | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState<'draft' | 'post' | null>(null)
  const load = useCallback(() => {
    adminCall<State>(token, '/api/admin/channel/radar').then((r) => (r.ok ? (setState(r.data), setErr(null)) : setErr(r.error)))
  }, [token])
  useEffect(() => {
    load()
  }, [load])

  async function run(action: 'draft' | 'post') {
    if (action === 'post' && !window.confirm('Post today’s Launch radar to the News channel now? Every follower will see it.')) return
    setBusy(action)
    const r = await adminCall<{ post: Post }>(token, '/api/admin/channel/radar', { action })
    setBusy(null)
    if (!r.ok) return toastError(action === 'draft' ? 'Could not draft the radar' : 'Could not post the radar', { detail: r.error })
    toastSuccess(action === 'draft' ? 'Radar draft ready' : 'Radar posted', r.data.post?.url ? { detail: r.data.post.url } : undefined)
    load()
  }

  const t = state?.today ?? null
  const sent = t?.status === 'sent'
  return (
    <section className={card} aria-labelledby="admin-tg-radar">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 id="admin-tg-radar" className="m-0 flex items-center gap-2 font-display text-[22px] font-bold uppercase">
            <Radar size={20} aria-hidden /> Launch radar
          </h2>
          <span className="font-mono text-[12px] text-faint">
            {state ? `Daily draft at ${state.time} UTC · ${state.draftsEnabled ? 'drafts on' : 'drafts off'} · ` : ''}
            {state?.autopost ? 'auto-post ON' : 'auto-post off: you approve every post'}
          </span>
        </div>
        {t && <span className={pillCls(sent ? 'border-up/40 text-up' : 'border-line-strong text-ink-2')}>{t.status}</span>}
      </div>
      {err && <p className="m-0 text-[13px] text-down">{err}</p>}
      {!state && !err && <LoaderCircle size={16} className="animate-spin text-faint" aria-label="Loading" />}
      {state && !t && <p className="m-0 text-[13px] text-ink-2">No radar for today yet. It is drafted from launches whose Holder Map is already built.</p>}
      {t && (
        <div className="whitespace-pre-wrap break-words rounded-card border border-line bg-bg p-4 text-[14px] leading-[1.5] text-ink">
          {renderTg(t.text)}
          <div className="mt-2 font-mono text-[11px] text-faint">
            {t.length}/{t.limit} characters
          </div>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <button type="button" className={btn} disabled={!state || busy !== null || sent} onClick={() => run('draft')}>
          {busy === 'draft' ? <LoaderCircle size={14} className="animate-spin" aria-hidden /> : <Radar size={14} aria-hidden />}
          {t ? 'Refresh draft' : 'Make today’s draft'}
        </button>
        <button type="button" className={btn} disabled={!state || busy !== null || sent} onClick={() => run('post')}>
          {busy === 'post' ? <LoaderCircle size={14} className="animate-spin" aria-hidden /> : <Send size={14} aria-hidden />}
          Approve and post
        </button>
        {t?.url && (
          <a className={btn} href={t.url} target="_blank" rel="noreferrer noopener">
            View in channel
          </a>
        )}
      </div>
      <p className="m-0 text-[12px] text-faint">Measured facts only, with a “signals, not verdicts” note. Refreshing replaces the draft text.</p>
    </section>
  )
}
