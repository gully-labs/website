import { useCallback, useEffect, useState } from 'react'
import { Ban, Unlink } from 'lucide-react'
import { toastError, toastSuccess } from '../../components/ui/toast'
import { adminCall } from './payAdmin'

/* Admin: the Telegram chats linked to developer accounts (GET /api/admin/telegram), from the stored links
   and the accounts' alerts: account, chat type, title (when Telegram gave one), when it was linked, the
   alerts that deliver to Telegram and the last Telegram delivery. No chat ids, no messages. Actions: unlink
   the chat (POST /api/admin/telegram/:address/unlink, when the server offers it) and block the wallet
   (the developer-wallet block: keys stop, sessions end). Both ask first. */

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
  canUnlink?: boolean
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
  const [busy, setBusy] = useState<string | null>(null)
  const run = async (key: string, path: string, ok: string, fail: string) => {
    setBusy(key)
    const r = await adminCall(token, path, {})
    setBusy(null)
    if (r.ok) toastSuccess(ok)
    else toastError(fail, { detail: r.error })
    load()
  }
  const unlink = (c: Chat) => window.confirm(`Unlink the Telegram chat of ${c.address}? Its Telegram alerts stop until it links again.`) && run(`u:${c.address}`, `/api/admin/telegram/${c.address}/unlink`, 'Chat unlinked', 'Could not unlink the chat')
  const block = (c: Chat) => window.confirm(`Block ${c.address}? Its keys stop working, it is signed out, and its alerts stop.`) && run(`b:${c.address}`, `/api/admin/accounts/${c.address}/block`, 'Wallet blocked', 'Could not block the wallet')
  const act = 'inline-flex min-h-11 items-center gap-1 rounded-btn border border-line-strong px-3 font-mono text-[12px] text-ink-2 hover:border-error hover:text-error disabled:opacity-50'

  return (
    <section className={card} aria-labelledby="admin-tg">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="admin-tg" className={h2}>
          Telegram chats
        </h2>
        <span className={small}>{data ? `${data.enabled ? 'bot on' : 'bot off (TELEGRAM_BOT_TOKEN not set)'} · ${data.links} linked · no message content` : 'linked chats'}</span>
      </div>
      {err && <p className="m-0 font-mono text-[12px] text-error">{err}</p>}
      {!data && !err && <span className={small}>Loading…</span>}
      {data && !data.chats.length && <p className="m-0 text-[14px] text-muted">No chat is linked yet. Account owners link one from Alerts in the app (Connect Telegram).</p>}
      {data && data.chats.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] border-collapse text-[13px]">
            <thead>
              <tr className="border-b border-line text-left font-mono text-[11px] tracking-[1px] text-faint">
                <th className="py-2 pr-3 font-medium">ACCOUNT</th>
                <th className="py-2 pr-3 font-medium">CHAT</th>
                <th className="py-2 pr-3 font-medium">TITLE</th>
                <th className="py-2 pr-3 font-medium">LINKED</th>
                <th className="py-2 pr-3 font-medium">TELEGRAM ALERTS</th>
                <th className="py-2 pr-3 font-medium">LAST DELIVERY</th>
                <th className="py-2 font-medium">
                  <span className="sr-only">Actions</span>
                </th>
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
                  <td className="py-2 pr-3 whitespace-nowrap">
                    {c.lastDelivery ? (
                      <span className={c.lastDelivery.ok ? 'text-green' : 'text-error'} title={c.lastDelivery.error ?? ''}>
                        {c.lastDelivery.ok ? 'sent' : 'failed'}
                        {c.lastDelivery.test ? ' (test)' : ''} <span className="text-faint">· {when(c.lastDelivery.at)}</span>
                      </span>
                    ) : (
                      <span className="text-faint">none yet</span>
                    )}
                  </td>
                  <td className="py-1 text-right whitespace-nowrap">
                    <span className="inline-flex gap-2">
                      {data.canUnlink && (
                        <button type="button" disabled={busy !== null} onClick={() => unlink(c)} className={act}>
                          <Unlink size={14} aria-hidden /> Unlink
                        </button>
                      )}
                      <button type="button" disabled={busy !== null} onClick={() => block(c)} className={act}>
                        <Ban size={14} aria-hidden /> Block wallet
                      </button>
                    </span>
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
