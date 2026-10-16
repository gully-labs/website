import { useState } from 'react'

type State = { k: 'idle' } | { k: 'asking' } | { k: 'sending' } | { k: 'done'; already: boolean } | { k: 'error'; message: string }

/* "Notify me" for a project still in the lab. Asks for an email, saves it to the launch list on the
   server (visible in the admin dashboard), and says "On the list" only once the server has it. */
export function NotifyMe({ slot }: { slot: string }) {
  const [state, setState] = useState<State>({ k: 'idle' })
  const [email, setEmail] = useState('')

  if (state.k === 'done')
    return (
      <span role="status" className="relative ml-auto inline-flex min-h-11 items-center rounded-btn border border-success-line bg-success-bg px-[18px] text-[14px] font-semibold text-green">
        ✓ {state.already ? 'Already on the list' : 'On the list'}
      </span>
    )

  if (state.k === 'idle')
    return (
      <button type="button" onClick={() => setState({ k: 'asking' })} className="relative ml-auto min-h-11 whitespace-nowrap rounded-btn border border-gold-line bg-transparent px-[18px] py-3 text-[14px] font-semibold text-gold transition-colors hover:border-gold">
        Notify me
      </button>
    )

  return (
    <form
      className="relative ml-auto flex w-full max-w-[420px] flex-wrap items-center gap-2"
      onSubmit={async (e) => {
        e.preventDefault()
        setState({ k: 'sending' })
        try {
          const r = await fetch('/api/notify', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, slot }) })
          const d = (await r.json().catch(() => ({}))) as { alreadyOnList?: boolean; error?: string }
          setState(r.ok ? { k: 'done', already: !!d.alreadyOnList } : { k: 'error', message: d.error ?? 'That did not go through. Try again.' })
        } catch {
          setState({ k: 'error', message: 'The server could not be reached. Try again.' })
        }
      }}
    >
      <label className="min-w-0 flex-1">
        <span className="sr-only">Email</span>
        <input
          type="email"
          required
          autoFocus
          autoComplete="email"
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="h-11 w-full rounded-input border border-line-strong bg-bg px-3 text-[14px] text-ink outline-none focus:border-gold"
        />
      </label>
      <button type="submit" disabled={state.k === 'sending'} className="min-h-11 rounded-btn bg-gold px-4 text-[14px] font-semibold text-bg transition-colors hover:bg-gold-hover disabled:opacity-60">
        {state.k === 'sending' ? 'Saving…' : 'Notify me'}
      </button>
      {state.k === 'error' && <span className="w-full text-[13px] text-error">{state.message}</span>}
      <span className="w-full font-mono text-[11px] text-faint">One email on launch day. Nothing else.</span>
    </form>
  )
}
