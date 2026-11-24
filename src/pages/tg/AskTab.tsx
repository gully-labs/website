import { useState } from 'react'
import { tgApi } from './sdk'

/* Gully AI inside the Telegram Mini App (server/surfaces/tg-ask.mjs, flag AI_SURFACE_TGAPP). The same account as the bot's
   private chat; the credits chip shows what the credits service reports and says "soon" until it exists. Telegram rules
   for paying digital goods inside Mini Apps (Stars only) are in the SPEC; nothing here takes money. */
type Turn = { role: 'user' | 'assistant'; content: string }
export type AskChip = { state: 'free' | 'credits' | 'soon'; balance: number | null }

export function AskTab({ initData, chip }: { initData: string; chip: AskChip | null }) {
  const [q, setQ] = useState('')
  const [turns, setTurns] = useState<Turn[]>([])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const send = async () => {
    const question = q.trim()
    if (!question || busy) return
    setBusy(true)
    setErr(null)
    setQ('')
    const history = turns.slice(-6)
    setTurns((t) => [...t, { role: 'user', content: question }])
    const r = await tgApi<{ chunks: string[] }>(initData, '/api/tg/ask', { method: 'POST', body: { question, history } })
    setBusy(false)
    if (!r.ok) return setErr(r.error || 'Gully AI could not answer just now.')
    setTurns((t) => [...t, { role: 'assistant', content: r.data.chunks.join('\n\n') }])
  }
  return (
    <section aria-label="Gully AI" className="flex flex-col gap-3">
      <p className="text-[12px] text-muted">
        Credits: {chip?.state === 'credits' && chip.balance !== null ? chip.balance : chip?.state === 'free' ? 'free tier' : 'coming soon'}
      </p>
      <div aria-live="polite" className="flex flex-col gap-2">
        {turns.map((t, i) => (
          <p key={i} className={`whitespace-pre-wrap rounded-lg border border-line px-3 py-2 text-[14px] ${t.role === 'user' ? 'self-end bg-surface' : ''}`}>
            {t.content}
          </p>
        ))}
        {busy && <p className="text-[13px] text-muted">Thinking...</p>}
        {err && <p role="alert" className="text-[13px] text-red-400">{err}</p>}
      </div>
      <form onSubmit={(e) => (e.preventDefault(), void send())} className="flex gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} maxLength={500} placeholder="Ask Gully AI" aria-label="Your question" className="min-h-11 flex-1 rounded-lg border border-line bg-transparent px-3 text-[14px]" />
        <button type="submit" disabled={busy || !q.trim()} className="min-h-11 min-w-11 rounded-lg bg-gold px-4 text-[14px] text-[var(--tg-btn-text,var(--color-bg))] disabled:opacity-50">Send</button>
      </form>
      <p className="text-[11px] text-muted">AI answers can be wrong. Information only, not financial advice.</p>
    </section>
  )
}
