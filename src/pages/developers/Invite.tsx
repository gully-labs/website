import { AlertTriangle, CheckCircle2, Clock, Loader2, MailOpen, Users, Wallet, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toastError, toastSuccess } from '../../components/ui/toast'
import { api, fmtDate, shortAddress, type InviteAccepted, type InvitePreview, type PendingInvite } from './api'
import { clearInviteHash, declinedInvites, declineInvite, ROLE_TEXT, untilText, usePortal } from './portal'
import { Skeleton } from './parts'
import { mono, panel, pillGold, pillLine, pillSm } from './styles'

/* Workspace invites (portal v2).
   - PendingInvites: invites addressed to this wallet (GET /me pendingInvites), as a banner on the
     Overview with Accept (POST /invite/accept { inviteId }) and Decline. There is no decline route, so
     Decline hides the invite in this browser until it expires.
   - InviteLanding: a link invite (#invite=<token>). Signed out it previews the invite
     (GET /invite/:token, public) with "Sign in to accept"; signed in it accepts (POST /invite/accept
     { token }), which switches the session to the workspace. Expired, revoked, used, invalid and
     wrong-wallet invites each say so plainly. */

const roleBadge = 'rounded-full border border-gold-line px-2 py-[1px] font-mono text-[11px] text-gold'

export function PendingInvites() {
  const { me, refreshAll } = usePortal()
  const [hidden, setHidden] = useState<Record<string, string>>(() => declinedInvites())
  const [busy, setBusy] = useState<string | null>(null)
  const list = (me?.pendingInvites ?? []).filter((i) => !hidden[i.id])
  if (!list.length) return null

  const accept = async (inv: PendingInvite) => {
    setBusy(inv.id)
    const r = await api<InviteAccepted>('/api/developer/invite/accept', { method: 'POST', body: { inviteId: inv.id } })
    setBusy(null)
    if (!r.ok) return toastError(`Could not join ${inv.workspace.name}`, { detail: r.error, id: `invite:${inv.id}` })
    toastSuccess(`Joined ${r.data.active.name}`, { detail: `You are ${r.data.active.role} there; the app switched to it.`, id: `invite:${inv.id}` })
    await refreshAll()
  }
  const decline = (inv: PendingInvite) => {
    declineInvite(inv.id, inv.expiresAt)
    setHidden(declinedInvites())
    toastSuccess('Invite hidden', { detail: `${inv.workspace.name} will not ask again here. It expires ${untilText(inv.expiresAt)}.`, id: `invite:${inv.id}` })
  }

  return (
    <section aria-label="Workspace invites" className="flex flex-col gap-2" data-testid="pending-invites">
      {list.map((inv) => (
        <div key={inv.id} className="flex flex-wrap items-center gap-3 rounded-card border border-gold-line bg-[rgba(217,181,99,.06)] px-4 py-3">
          <MailOpen size={18} className="shrink-0 text-gold" aria-hidden />
          <span className="flex min-w-0 flex-[1_1_260px] flex-col">
            <span className="text-[14px]">
              <b className="font-semibold">{shortAddress(inv.invitedBy)}</b> invited you to <b className="font-semibold">{inv.workspace.name}</b> as <span className={roleBadge}>{inv.role}</span>
            </span>
            <span className="text-[12px] text-dim">
              {ROLE_TEXT[inv.role]} Expires {untilText(inv.expiresAt)}.
            </span>
          </span>
          <span className="flex gap-2">
            <button type="button" onClick={() => decline(inv)} disabled={busy === inv.id} className={pillSm}>
              <X size={14} aria-hidden /> Decline
            </button>
            <button type="button" onClick={() => accept(inv)} disabled={busy === inv.id} className={pillGold}>
              {busy === inv.id ? <Loader2 size={15} className="animate-spin" aria-hidden /> : <CheckCircle2 size={15} aria-hidden />} Accept
            </button>
          </span>
        </div>
      ))}
    </section>
  )
}

type Preview = { k: 'loading' } | { k: 'invalid' } | { k: 'error'; message: string } | { k: 'ok'; p: InvitePreview }

const STATE_TEXT: Record<Exclude<InvitePreview['state'], 'open'>, { title: string; text: string }> = {
  expired: { title: 'This invite has expired', text: 'Invites last a week. Ask whoever sent it for a new link.' },
  revoked: { title: 'This invite was revoked', text: 'It was withdrawn by the workspace. Ask for a new link if you still need access.' },
  accepted: { title: 'This invite was used already', text: 'A link works once. If you joined with it, the workspace is in your workspace menu.' },
}

/**
 * The landing for `#invite=<token>`. `signedIn` false: preview and "Sign in to accept" (`connect`).
 * true: Accept, which joins and switches the console to the workspace.
 */
export function InviteLanding({ token, signedIn, connect, connecting, onDone }: { token: string; signedIn: boolean; connect?: () => void; connecting?: boolean; onDone: () => void }) {
  const [s, setS] = useState<Preview>({ k: 'loading' })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<{ text: string; code?: string } | null>(null)
  const { refreshAll, me } = usePortal()

  useEffect(() => {
    let alive = true
    api<InvitePreview>(`/api/developer/invite/${encodeURIComponent(token)}`).then((r) => {
      if (!alive) return
      setS(r.ok ? { k: 'ok', p: r.data } : r.status === 404 ? { k: 'invalid' } : { k: 'error', message: r.error })
    })
    return () => {
      alive = false
    }
  }, [token])

  const accept = async () => {
    setBusy(true)
    setErr(null)
    const r = await api<InviteAccepted>('/api/developer/invite/accept', { method: 'POST', body: { token } })
    setBusy(false)
    if (!r.ok) {
      const state = (r.body as { state?: InvitePreview['state'] } | null)?.state
      if (state && state !== 'open' && s.k === 'ok') setS({ k: 'ok', p: { ...s.p, state, valid: false } })
      return setErr({ text: r.error, code: r.code })
    }
    toastSuccess(`Joined ${r.data.active.name}`, { detail: `You are ${r.data.active.role} there; the app switched to it.`, id: 'invite-accepted' })
    clearInviteHash()
    onDone()
    await refreshAll()
  }

  const dismiss = () => {
    clearInviteHash()
    onDone()
  }

  return (
    <section className={`${panel} mx-auto w-full max-w-[560px] gap-4 border-gold-line p-6 max-[480px]:p-5`} aria-labelledby="invite-title" data-testid="invite-landing">
      <span className="flex items-center gap-2">
        <Users size={18} className="text-gold" aria-hidden />
        <span className={mono}>WORKSPACE INVITE</span>
      </span>
      {s.k === 'loading' ? (
        <div className="flex flex-col gap-3" aria-busy>
          <Skeleton h={30} w="70%" />
          <Skeleton h={18} />
          <Skeleton h={44} w={180} />
        </div>
      ) : s.k === 'invalid' ? (
        <Problem title="This invite link is not valid" text="Check that the whole link was copied. Links are case-sensitive; ask for a new one if it still fails." onClose={dismiss} />
      ) : s.k === 'error' ? (
        <Problem title="The invite could not be read" text={s.message} onClose={dismiss} />
      ) : s.p.state !== 'open' || !s.p.valid ? (
        <Problem title={s.p.state === 'open' ? 'This workspace is no longer available' : STATE_TEXT[s.p.state].title} text={s.p.state === 'open' ? 'Its owner can no longer use the app.' : STATE_TEXT[s.p.state].text} onClose={dismiss} />
      ) : (
        <>
          <h2 id="invite-title" className="m-0 font-display text-[30px] leading-[1.05] font-bold uppercase">
            Join <span className="text-gold">{s.p.workspace.name}</span>
          </h2>
          <dl className="m-0 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-[14px]">
            <dt className="text-dim">Role</dt>
            <dd className="m-0 flex flex-col gap-1">
              <span>
                <span className={roleBadge}>{s.p.role}</span>
              </span>
              <span className="text-[13px] text-muted">{ROLE_TEXT[s.p.role]}</span>
            </dd>
            <dt className="text-dim">Invited by</dt>
            <dd className="m-0 font-mono text-[13px]">{s.p.invitedBy}</dd>
            <dt className="text-dim">Expires</dt>
            <dd className="m-0 flex items-center gap-2 font-mono text-[13px]">
              <Clock size={13} className="text-faint" aria-hidden /> {fmtDate(s.p.expiresAt)} ({untilText(s.p.expiresAt)})
            </dd>
          </dl>
          {err && (
            <p className="m-0 flex items-start gap-2 rounded-[10px] border border-error-line bg-[rgba(255,138,122,.06)] px-3 py-2 text-[14px] text-error" role="alert">
              <AlertTriangle size={16} className="mt-[2px] shrink-0" aria-hidden />
              <span>
                {err.text}
                {err.code === 'wrong-wallet' && me && <span className="block text-[12px] text-muted">You are signed in as {shortAddress(me.address)}.</span>}
              </span>
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            {signedIn ? (
              <>
                <button type="button" onClick={accept} disabled={busy} className={pillGold} data-autofocus>
                  {busy ? <Loader2 size={16} className="animate-spin" aria-hidden /> : <CheckCircle2 size={16} aria-hidden />} Accept and switch
                </button>
                <button type="button" onClick={dismiss} className={pillLine}>
                  Not now
                </button>
              </>
            ) : (
              <button type="button" onClick={connect} disabled={connecting} data-focus-fallback className={`${pillGold} min-h-12 w-full text-[16px]`}>
                {connecting ? <Loader2 size={18} className="animate-spin" aria-hidden /> : <Wallet size={18} aria-hidden />} Sign in to accept
              </button>
            )}
          </div>
          {!signedIn && <span className="text-[12px] leading-[1.5] text-faint">Sign in with your wallet (a message, not a transaction). The invite stays open until it expires, so you can come back to this link.</span>}
        </>
      )}
    </section>
  )
}

function Problem({ title, text, onClose }: { title: string; text: string; onClose: () => void }) {
  return (
    <>
      <h2 id="invite-title" className="m-0 flex items-start gap-2 font-display text-[26px] leading-[1.05] font-bold uppercase" role="alert">
        <AlertTriangle size={22} className="mt-[2px] shrink-0 text-error" aria-hidden /> {title}
      </h2>
      <p className="m-0 text-[14px] leading-[1.6] text-muted">{text}</p>
      <div>
        <button type="button" onClick={onClose} className={pillLine}>
          Continue
        </button>
      </div>
    </>
  )
}

