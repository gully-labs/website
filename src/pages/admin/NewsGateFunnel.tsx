import { LoaderCircle, Pin, Send } from 'lucide-react'
import { useEffect, useState } from 'react'
import { AnimatedNumber } from '../../components/charts/AnimatedNumber'
import { useReducedMotion } from '../../components/charts/chart-utils'
import { toastError, toastSuccess } from '../../components/ui/toast'
import { adminCall } from './payAdmin'
import { renderTg } from './tgHtml'
import { ctl } from './ui'

/* Admin: the News gate funnel (GET /api/admin/channel/gate, server/telegram-channel.mjs) as an animated funnel
   (join screen shown -> joined the channel -> used the bot), and the "Start here" post for the channel.
   "Post Start here" first asks the server for a DRAFT (POST /api/admin/channel/welcome, action draft), shows
   it as the channel will, and only posts it (POST /api/admin/channel/posts/:id/post) after the admin confirms. */

interface Gate {
  freeActionUsers: number
  shown: number
  joined: number
  used: number
  joinRate: number | null
}
interface Draft {
  id: string
  status: string
  text: string
  url: string | null
}

const card = 'flex min-w-0 flex-col gap-4 rounded-card border border-line bg-surface p-6 max-[600px]:p-4'
const h2 = 'm-0 font-display text-[22px] font-bold uppercase'
const small = 'font-mono text-[12px] text-faint'

export function NewsGateFunnel({ token }: { token: string }) {
  const [gate, setGate] = useState<{ gate: Gate; freeActions: number } | null>(null)
  const [error, setError] = useState('')
  const [grown, setGrown] = useState(false)
  const [busy, setBusy] = useState(false)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [note, setNote] = useState('')
  const still = useReducedMotion()

  // First load: state is set only in the promise callback, never synchronously inside the effect.
  useEffect(() => {
    let live = true
    adminCall<{ gate: Gate; freeActions: number }>(token, '/api/admin/channel/gate').then((r) => {
      if (!live) return
      if (r.ok) {
        setGate(r.data)
        setError('')
      } else setError(r.error)
    })
    return () => {
      live = false
    }
  }, [token])
  // The bars grow from zero the first time data arrives.
  useEffect(() => {
    if (!gate) return
    const id = requestAnimationFrame(() => setGrown(true))
    return () => cancelAnimationFrame(id)
  }, [gate])

  const prepare = async () => {
    setBusy(true)
    setNote('')
    const r = await adminCall<{ post: Draft }>(token, '/api/admin/channel/welcome', { action: 'draft' })
    setBusy(false)
    if (r.ok) setDraft(r.data.post)
    else setNote(r.error)
  }
  const confirm = async () => {
    if (!draft) return
    setBusy(true)
    const r = await adminCall<{ post: Draft }>(token, `/api/admin/channel/posts/${draft.id}/post`, {})
    setBusy(false)
    if (r.ok) {
      toastSuccess('Start here is in the channel.')
      setDraft(null)
      setNote(r.data.post?.url ? `Posted: ${r.data.post.url}` : 'Posted.')
    } else toastError(r.error)
  }

  const g = gate?.gate
  const steps: { label: string; hint: string; value: number; prev: number | null }[] = g
    ? [
        { label: 'Saw the join screen', hint: 'asked to follow @GullyLabsNews', value: g.shown, prev: null },
        { label: 'Joined the channel', hint: 'followed after seeing it', value: g.joined, prev: g.shown },
        { label: 'Used the bot', hint: 'ran a command after joining', value: g.used, prev: g.joined },
      ]
    : []
  const top = Math.max(1, g?.shown ?? 1)

  return (
    <section className={card} aria-labelledby="admin-gate">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="admin-gate" className={h2}>
          News gate funnel
        </h2>
        <span className={small}>{gate ? `${gate.freeActions} free action${gate.freeActions === 1 ? '' : 's'} before the gate · ${g?.freeActionUsers ?? 0} users used one` : 'join screen to first command'}</span>
      </div>
      {error && (
        <p role="alert" className="m-0 text-[14px] text-red">
          {error}
        </p>
      )}
      {!g && !error && <p className={small}>Loading…</p>}
      {g && (
        <ol className="m-0 flex list-none flex-col gap-3 p-0" aria-label="News gate funnel">
          {steps.map((s, i) => {
            const rate = s.prev ? Math.round((s.value / s.prev) * 1000) / 10 : null
            return (
              <li key={s.label} className="grid grid-cols-[minmax(0,180px)_1fr] items-center gap-4 max-[640px]:grid-cols-1 max-[640px]:gap-1">
                <div className="flex flex-col">
                  <span className="text-[14px] text-ink">{s.label}</span>
                  <span className={small}>{s.hint}</span>
                </div>
                <div className="flex items-center gap-3">
                  <div className="h-7 min-w-0 flex-1 overflow-hidden rounded-sm bg-surface-deep">
                    <div
                      className="h-full rounded-sm bg-gold"
                      style={{
                        width: grown ? `${Math.max(s.value ? 2 : 0, (s.value / top) * 100)}%` : '0%',
                        opacity: 1 - i * 0.22,
                        transition: still ? 'none' : `width 900ms cubic-bezier(.2,.8,.2,1) ${i * 140}ms`,
                      }}
                    />
                  </div>
                  <span className="w-[120px] shrink-0 text-right font-mono text-[13px] text-ink">
                    <AnimatedNumber value={s.value} countUp />
                    {rate !== null && <span className="ml-2 text-faint">{rate}%</span>}
                  </span>
                </div>
              </li>
            )
          })}
        </ol>
      )}
      {g && (
        <p className={small}>
          {g.joinRate === null ? 'Join rate: not enough data yet.' : `Join rate ${g.joinRate}% of those who saw the screen.`}
        </p>
      )}

      <div className="flex flex-col gap-3 border-t border-line pt-4">
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" className={ctl} onClick={prepare} disabled={busy || !!draft}>
            {busy && !draft ? <LoaderCircle size={14} className="animate-spin" aria-hidden /> : <Pin size={14} aria-hidden />}
            Post Start here
          </button>
          <span className={small}>The pinned welcome post: banner and links to the bot, the Mini App and the tracker. One per channel.</span>
        </div>
        {note && (
          <p role="status" className="m-0 text-[13.5px] text-ink-2">
            {note}
          </p>
        )}
        {draft && (
          <div className="flex flex-col gap-3 rounded-lg border border-gold-line bg-[rgba(0,210,255,.05)] p-4" role="group" aria-label="Confirm the Start here post">
            <span className="font-mono text-[11px] tracking-[1px] text-gold">PREVIEW: THIS GOES TO THE PUBLIC CHANNEL</span>
            <div className="text-[14px] leading-[1.6] whitespace-pre-wrap text-ink-2">{renderTg(draft.text)}</div>
            <div className="flex flex-wrap gap-2">
              <button type="button" className={ctl} onClick={confirm} disabled={busy}>
                {busy ? <LoaderCircle size={14} className="animate-spin" aria-hidden /> : <Send size={14} aria-hidden />}
                Confirm and post to the channel
              </button>
              <button type="button" className={ctl} onClick={() => setDraft(null)} disabled={busy}>
                Cancel
              </button>
            </div>
            <span className={small}>Cancel keeps the draft in the channel post list; it is not sent.</span>
          </div>
        )}
      </div>
    </section>
  )
}
