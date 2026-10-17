import { useCallback, useEffect, useState } from 'react'
import { adminCall } from './payAdmin'

/* Admin: the Telegram chats linked to developer accounts (GET /api/admin/telegram). Read-only, from the
   stored links and the accounts' alerts: account, chat type, title (when Telegram gave one), when it was
   linked, the alerts that deliver to Telegram and the last Telegram delivery. No chat ids, no messages. */

interface Chat {
  address: string
  chatType: 'private' | 'group'
  chatKind: string
  chatTitle: string | null
  linkedAt: string | null
  alerts: { telegram: number; enabled: number; total: number } | null
  lastDelivery: { at: string; ok: boolean; test: boolean; status: number | null; error: string | null } | null
}
interface View {
  enabled: boolean
  links: number
  chats: Chat[]
}

const card = 'flex min-w-0 flex-col gap-4 rounded-card border border-line bg-surface p-6 max-[600px]:p-4'
const h2 = 'm-0 font-display text-[22px] font-bold uppercase'
const small = 'font-mono text-[12px] text-faint'
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }) : '—')

export function TelegramChats({ token }: { token: string }) {
  const [data, setData] = useState<View | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const load = useCallback(() => {
    adminCall<View>(token, '/api/admin/telegram').then((r) => (r.ok ? (setData(r.data), setErr(null)) : setErr(r.error)))
  }, [token])
  useEffect(() => {
    load()
    const id = setInterval(load, 60_000)
    return () => clearInterval(id)
  }, [load])

  return (
    <section className={card} aria-labelledby="admin-tg">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="admin-tg" className={h2}>
          Telegram chats
        </h2>
        <span className={small}>{data ? `${data.enabled ? 'bot on' : 'bot off (TELEGRAM_BOT_TOKEN not set)'} · ${data.links} linked · read-only, no message content` : 'linked chats · read-only'}</span>
      </div>
      {err && <p className="m-0 font-mono text-[12px] text-error">{err}</p>}
      {!data && !err && <span className={small}>Loading…</span>}
      {data && !data.chats.length && <p className="m-0 text-[14px] text-muted">No chat is linked yet. Developers link one from the Alerts tab of their console (Connect Telegram).</p>}
      {data && data.chats.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse text-[13px]">
            <thead>
              <tr className="border-b border-line text-left font-mono text-[11px] tracking-[1px] text-faint">
                <th className="py-2 pr-3 font-medium">ACCOUNT</th>
                <th className="py-2 pr-3 font-medium">CHAT</th>
                <th className="py-2 pr-3 font-medium">TITLE</th>
                <th className="py-2 pr-3 font-medium">LINKED</th>
                <th className="py-2 pr-3 font-medium">TELEGRAM ALERTS</th>
                <th className="py-2 font-medium">LAST DELIVERY</th>
              </tr>
            </thead>
            <tbody className="font-mono">
              {data.chats.map((c) => (
                <tr key={c.address} className="border-b border-line last:border-b-0">
                  <td className="py-2 pr-3 text-ink-2" title={c.address}>
                    {short(c.address)}
                  </td>
                  <td className="py-2 pr-3 text-muted">{c.chatType === 'private' ? 'private' : c.chatKind === 'supergroup' ? 'group (super)' : 'group'}</td>
                  <td className="max-w-[240px] truncate py-2 pr-3 text-muted" title={c.chatTitle ?? ''}>
                    {c.chatTitle ?? '—'}
                  </td>
                  <td className="py-2 pr-3 whitespace-nowrap text-faint">{when(c.linkedAt)}</td>
                  <td className="py-2 pr-3 text-ink-2">{c.alerts ? `${c.alerts.telegram} (${c.alerts.enabled} on) of ${c.alerts.total}` : <span className="text-error">unreadable</span>}</td>
                  <td className="py-2 whitespace-nowrap">
                    {c.lastDelivery ? (
                      <span className={c.lastDelivery.ok ? 'text-green' : 'text-error'} title={c.lastDelivery.error ?? ''}>
                        {c.lastDelivery.ok ? 'sent' : 'failed'}
                        {c.lastDelivery.test ? ' (test)' : ''} <span className="text-faint">· {when(c.lastDelivery.at)}</span>
                      </span>
                    ) : (
                      <span className="text-faint">none yet</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
