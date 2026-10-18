import { BellRing, Loader2, Megaphone, MessageCircle, Send } from 'lucide-react'
import { useMemo, useState } from 'react'
import { toastError, toastSuccess } from '../../../components/ui/toast'
import { api } from '../api'
import { usePoll } from '../poll'
import { useWrite } from '../portal'
import { useAlertsView } from '../helpers'
import { TelegramCard } from '../Alerts'
import { ExtLink } from '../ExtLink'
import { ErrorLine, Skeleton } from '../parts'
import { pillGold, pillSm } from '../styles'
import { LiveMarker, StackedDays } from '../vcharts'
import { docsPage, type ServiceCtx } from './links'
import { Section, ServiceHeader, type Status } from './ServiceHeader'

/* Telegram, in the app: connect the workspace's chat to the bot (the Alerts page's TelegramCard:
   one-time link, polled until the bot confirms), which alerts send there, Telegram deliveries per day
   from the alerts' own delivery logs (GET /api/developer/alerts, every minute), and the Gully Labs News
   channel, which the bot asks every user to follow. */

const NEWS = 'https://t.me/GullyLabsNews'

/** GET /api/developer/telegram: `announcements` is the linked private chat's news switch (null: a group, or no link). */
type TelegramAccount = { enabled: boolean; bot: string | null; linked: { chatType: string; chatTitle: string } | null; announcements?: boolean | null }

/**
 * Gully Labs announcements in the linked private chat, on or off: the same switch as the bot's Settings and the
 * Mini App (N-24). Alerts are never affected. Groups never get announcements, so a group link shows why.
 */
function AnnouncementsCard() {
  const info = usePoll<TelegramAccount>('/api/developer/telegram', 120_000)
  const [busy, setBusy] = useState(false)
  const [local, setLocal] = useState<boolean | null>(null)
  const write = useWrite('telegram', 'change Telegram settings')
  const d = info.data
  const on = local ?? d?.announcements ?? null
  const flip = async () => {
    if (on === null || busy) return
    setBusy(true)
    const r = await api<{ announcements: boolean }>('/api/developer/telegram/announcements', { method: 'POST', body: { on: !on } })
    setBusy(false)
    if (!r.ok) return toastError('Announcements not changed', { detail: r.status >= 500 || !r.status ? 'Try again in a minute.' : r.error })
    setLocal(r.data.announcements)
    toastSuccess(r.data.announcements ? 'Announcements on' : 'Announcements off', { detail: 'Alerts keep arriving either way.' })
  }
  return (
    <Section title="Announcements" sub="Gully Labs news in your chat with the bot">
      {!d ? (
        info.error || info.timedOut ? <p className="m-0 text-[13px] text-muted">Not readable right now.</p> : <Skeleton h={44} />
      ) : on === null ? (
        <p className="m-0 text-[13px] text-muted">{d.linked ? 'Announcements go to private chats only; this workspace is linked to a group.' : 'Link your own chat with the bot above to choose.'}</p>
      ) : (
        <div className="flex items-center justify-between gap-3">
          <span className="text-[13px] text-ink-2">{on ? 'On: you get launches and product news.' : 'Off: only your alerts arrive.'}</span>
          <button
            type="button"
            role="switch"
            aria-checked={on}
            aria-label="Gully Labs announcements in Telegram"
            disabled={busy || !write.ok}
            title={write.why}
            onClick={flip}
            className={`relative inline-flex h-11 w-[64px] flex-none items-center rounded-full border transition-colors disabled:opacity-60 ${on ? 'border-gold bg-gold' : 'border-line bg-surface-deep'}`}
          >
            {busy ? <Loader2 size={16} className="mx-auto animate-spin text-ink" aria-hidden /> : <span className={`absolute top-1/2 size-7 -translate-y-1/2 rounded-full transition-[left] duration-200 ${on ? 'left-[30px] bg-bg' : 'left-[4px] bg-faint'}`} aria-hidden />}
          </button>
        </div>
      )}
    </Section>
  )
}

export default function TelegramView({ ctx }: { ctx: ServiceCtx }) {
  const { view, err, load } = useAlertsView()
  const tg = view?.telegram
  const botName = tg?.bot ?? 'GullyLabsBot'
  const bot = `https://t.me/${botName}`
  const onTg = view ? view.alerts.filter((a) => a.telegram) : []
  const days = useMemo(() => {
    if (!view) return []
    const today = new Date()
    return Array.from({ length: 14 }, (_, i) => {
      const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - (13 - i))
      const values = { ok: 0, failed: 0 }
      for (const a of view.alerts) for (const x of a.deliveries) if (x.channel === 'telegram' && !x.test && new Date(x.at).toDateString() === d.toDateString()) values[x.ok ? 'ok' : 'failed']++
      return { label: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }), values }
    })
  }, [view])
  const sent = days.reduce((t, d) => t + d.values.ok, 0)
  const failed = days.reduce((t, d) => t + d.values.failed, 0)
  const status: Status = !view ? (err ? { tone: 'down', text: 'unreadable' } : { tone: 'checking', text: 'reading…' }) : !tg?.enabled ? { tone: 'idle', text: 'bot not configured here' } : tg.linked ? { tone: 'live', text: `linked · ${tg.linked.chatTitle}` } : { tone: 'idle', text: 'not linked yet' }
  const pending = err ? 'unreadable' : '…'
  return (
    <>
      <ServiceHeader
        icon={Send}
        title="Telegram"
        desc="Gap and DeepCore launch alerts in a Telegram chat, with Mute and Open buttons; the bot also answers /gap, /top, /launches and Gully AI."
        status={status}
        docs={docsPage('plans-alerts')}
        page={{ href: bot, label: 'Open the bot' }}
        tiles={[
          { label: 'ALERTS TO TELEGRAM', value: view ? onTg.length : null, unknown: pending, note: view ? `of ${view.alerts.length} alerts` : 'in this workspace' },
          { label: 'SENT · 14D', value: view ? sent : null, unknown: pending, note: failed ? `${failed} failed` : 'delivered to the chat' },
          { label: 'LINKED CHATS', value: view ? (tg?.linked ? 1 : 0) : null, unknown: pending, note: tg?.linked ? tg.linked.chatType : 'one per workspace' },
        ]}
      />
      {err && !view && <ErrorLine onRetry={load}>Telegram could not be read just now: {err}</ErrorLine>}

      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)] items-start gap-4 max-[1100px]:grid-cols-1">
        <div className="flex min-w-0 flex-col gap-4">
          {view ? <TelegramCard info={view.telegram} reload={load} from="telegram" /> : <Skeleton h={160} />}
          <AnnouncementsCard />
          <Section title="Channel and bot" sub="the bot asks every user to follow the News channel">
            <div className="flex flex-wrap gap-2">
              <ExtLink href={NEWS} className={pillGold}>
                <Megaphone size={14} aria-hidden /> Gully Labs News
              </ExtLink>
              <ExtLink href={bot} className={pillSm}>
                <MessageCircle size={14} aria-hidden /> @{botName}
              </ExtLink>
            </div>
          </Section>
        </div>
        <Section
          title="Telegram deliveries"
          sub="per day, last 14 days · from your alerts' delivery logs"
          aside={
            <button type="button" onClick={() => ctx.go('alerts')} className={pillSm}>
              <BellRing size={14} aria-hidden /> Alerts
            </button>
          }
        >
          {!view ? (
            <Skeleton h={180} />
          ) : sent || failed ? (
            <StackedDays height={180} days={days} kinds={[{ id: 'ok', name: 'delivered', color: '#74c27b' }, { id: 'failed', name: 'failed', color: '#ff8a7a' }]} label={`Telegram deliveries over 14 days: ${sent} delivered, ${failed} failed.`} />
          ) : (
            <LiveMarker text={onTg.length ? 'Watching: deliveries chart here as alerts fire' : 'No alert sends to Telegram yet: tick Telegram on an alert'} height={180} />
          )}
          {view && onTg.length > 0 && (
            <ul className="m-0 flex list-none flex-col gap-1 p-0">
              {onTg.slice(0, 6).map((a) => (
                <li key={a.id} className="flex items-center gap-2 text-[13px] text-ink-2">
                  <span className={`size-[6px] rounded-full ${a.enabled ? 'bg-green' : 'bg-faint'}`} aria-hidden />
                  <span className="truncate">{a.name || (a.ticker ? `${a.ticker} gap` : 'DeepCore launches')}</span>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>
    </>
  )
}
