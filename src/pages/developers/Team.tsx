import { Link2, LogOut, Mail, Pencil, Trash2, UserPlus, Users, Wallet, X } from 'lucide-react'
import { useMemo, useState, type FormEvent } from 'react'
import { usePoll } from './poll'
import { InfoTip, RefreshChip } from './ui'
import { toastError, toastSuccess } from '../../components/ui/toast'
import { ago, api, fmtDate, shortAddress, type InviteCreated, type MemberRole, type Role, type TeamInvite, type TeamMember, type TeamView, type WorkspaceRef } from './api'
import { Avatar } from './Avatar'
import { CopyButton, Dialog } from './Dialog'
import { ErrorLine, Skeleton } from './parts'
import { MEMBER_ROLES, ROLE_TEXT, untilText, usePortal, useWrite } from './portal'
import { Can } from './RoleGate'
import { HBars, LiveMarker, type HBar } from './vcharts'
import { GhostCurves } from './charts'
import type { ActivityPage } from './api'
import { chip, input, mono, panel, panelTitle, pillDanger, pillGold, pillLine, pillSm, rise } from './styles'

/* The Team tab (portal v2): the workspace's name (admins and the owner rename it), its members with
   their roles (changed by a select where the signed-in role may change them), joined and last-seen
   dates, invites by wallet address or by a one-time link, open invites with revoke, and "Leave
   workspace" for members. Everything reads GET /api/developer/team; changes are the POST /team/…
   routes. The owner is members[0] and can be neither changed nor removed; only the owner can make,
   change or remove admins (the server enforces all of it). Compact layout: a one-line workspace header
   with its limits, then members beside "who changed things" and the open invites, so the whole team fits
   one screen. Both reads are polled with backoff and keep their last good answer. */

const roleBadge = (r: Role) => `rounded-full border px-2 py-[1px] font-mono text-[11px] ${r === 'owner' ? 'border-gold text-gold' : r === 'admin' ? 'border-gold-line text-gold' : 'border-line-strong text-muted'}`

/** Whether `myRole` may change or remove `m` (mirrors workspaces.mjs). */
const canManage = (myRole: Role, canTeam: boolean, m: TeamMember) => canTeam && m.role !== 'owner' && !m.you && (myRole === 'owner' || m.role !== 'admin')
/** The roles `myRole` may hand out. */
const grantable = (myRole: Role): MemberRole[] => (myRole === 'owner' ? MEMBER_ROLES : MEMBER_ROLES.filter((r) => r !== 'admin'))

export function Team() {
  const { me, role, user, refreshAll, reloadMe } = usePortal()
  const team = useWrite('team', 'manage the team')
  const tv = usePoll<TeamView>('/api/developer/team', 60_000)
  const view = tv.data
  const err = view ? null : (tv.error ?? (tv.timedOut ? 'no answer in time' : null))
  const load = () => void tv.reload()
  const [inviting, setInviting] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [leaving, setLeaving] = useState(false)
  const [removing, setRemoving] = useState<TeamMember | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  // Who has been active: actions per wallet in the newest page of the activity log.
  const ap = usePoll<ActivityPage>('/api/developer/activity', 60_000)
  const acts: Record<string, number> | null | 'error' = useMemo(() => {
    if (!ap.data) return ap.error || ap.timedOut ? 'error' : null
    const c: Record<string, number> = {}
    for (const e of ap.data.events) if (e.actor !== 'system') c[e.actor] = (c[e.actor] ?? 0) + 1
    return c
  }, [ap.data, ap.error, ap.timedOut])

  const setRole = async (m: TeamMember, next: MemberRole) => {
    if (next === m.role) return
    setBusy(`role:${m.address}`)
    const r = await api(`/api/developer/team/members/${m.address}/role`, { method: 'POST', body: { role: next } })
    setBusy(null)
    if (!r.ok) return toastError(`Could not change ${shortAddress(m.address)}'s role`, { detail: r.error })
    toastSuccess('Role changed', { detail: `${shortAddress(m.address)} is now ${next}.` })
    load()
  }
  const remove = async () => {
    if (!removing) return
    setBusy(`remove:${removing.address}`)
    const r = await api(`/api/developer/team/members/${removing.address}/remove`, { method: 'POST' })
    setBusy(null)
    if (!r.ok) return toastError(`Could not remove ${shortAddress(removing.address)}`, { detail: r.error })
    toastSuccess('Member removed', { detail: `${shortAddress(removing.address)} no longer has access.` })
    setRemoving(null)
    load()
  }
  const revoke = async (inv: TeamInvite) => {
    setBusy(`inv:${inv.id}`)
    const r = await api(`/api/developer/team/invites/${inv.id}/revoke`, { method: 'POST' })
    setBusy(null)
    if (!r.ok) return toastError('Could not revoke the invite', { detail: r.error })
    toastSuccess('Invite revoked', { detail: inv.kind === 'link' ? 'The link stopped working.' : `${shortAddress(inv.address ?? '')} can no longer accept it.` })
    load()
  }
  const leave = async () => {
    setBusy('leave')
    const r = await api<{ active: WorkspaceRef }>('/api/developer/team/leave', { method: 'POST' })
    setBusy(null)
    if (!r.ok) return toastError('Could not leave the workspace', { detail: r.error })
    toastSuccess(`You left ${view?.workspace.name ?? 'the workspace'}`, { detail: `Back in ${r.data.active.name}.` })
    setLeaving(false)
    await refreshAll()
  }

  if (err) return <ErrorLine onRetry={load}>The team could not be read: {err}</ErrorLine>
  if (!view)
    return (
      <div className="flex flex-col gap-2" aria-busy>
        <Skeleton h={88} />
        <Skeleton h={260} />
      </div>
    )

  const ws = view.workspace
  const memberCount = view.members.length
  const full = memberCount >= view.limits.maxMembers
  const invitesFull = view.invites.length >= view.limits.maxOpenInvites

  return (
    <div className="flex flex-col gap-2">
      <section className={`${panel} gap-2 p-3`} style={rise(0)} aria-labelledby="ws-title">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 flex-col gap-1">
            <h2 id="ws-title" className="m-0 flex flex-wrap items-center gap-2 font-display text-[24px] leading-none font-bold uppercase">
              <Users size={18} className="text-gold" aria-hidden />
              <span className="min-w-0 break-words">{ws.name}</span>
              <span className={roleBadge(role)}>you: {role}</span>
              <RefreshChip error={tv.error} onRetry={load} />
            </h2>
            <InfoTip summary={<>owner {shortAddress(ws.owner)} · the workspace owns keys, alerts, analytics and the plan</>}>
              Everything in the app belongs to the workspace, not to a person: API keys, gap and launch alerts, the linked Telegram chat, Gully Analytics and the plan with its payments. Members share all of it. Everyone reads everything; what they can change depends on the role.
            </InfoTip>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Can cat="team" what="rename the workspace" hide>
              <button type="button" onClick={() => setRenaming(true)} className={`${pillSm} min-h-11`}>
                <Pencil size={14} aria-hidden /> Rename
              </button>
            </Can>
            <Can cat="team" what="invite members">
              <button type="button" disabled={full || invitesFull} title={full ? `A workspace can have ${view.limits.maxMembers} members.` : invitesFull ? `${view.limits.maxOpenInvites} invites are open. Revoke one first.` : undefined} onClick={() => setInviting(true)} className={`${pillGold} min-h-11`}>
                <UserPlus size={16} aria-hidden /> Invite
              </button>
            </Can>
          </div>
        </div>
        <dl className="m-0 grid grid-cols-3 gap-2 border-t border-line pt-2">
          <Limit label="Members" used={memberCount} max={view.limits.maxMembers} />
          <Limit label="Open invites" used={view.invites.length} max={view.limits.maxOpenInvites} />
          <div className="flex flex-col gap-1">
            <dt className="text-[11px] text-dim">Invites last</dt>
            <dd className="m-0 font-mono text-[14px]">{view.limits.inviteDays} days</dd>
          </div>
        </dl>
      </section>

      <div className="grid grid-cols-1 gap-2 min-[1024px]:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
      <section className={`${panel} gap-2 p-3`} style={rise(1)} aria-labelledby="members-title">
        <div className="flex items-baseline justify-between gap-2">
          <h2 id="members-title" className={panelTitle}>
            Members
          </h2>
          <span className={mono}>{memberCount} of {view.limits.maxMembers}</span>
        </div>
        <ul className="m-0 flex list-none flex-col p-0" data-testid="member-list">
          {view.members.map((m) => {
            const mine = m.address === user
            const manage = canManage(role, team.ok, m)
            const name = mine ? (me?.profile.displayName ?? me?.profile.ens ?? null) : null
            return (
              <li key={m.address} className="flex flex-wrap items-center gap-2 border-t border-line py-2 first:border-t-0" data-member={m.address}>
                <Avatar address={m.address} src={mine ? me?.profile.avatar : null} size={30} />
                <span className="flex min-w-0 flex-[1_1_200px] flex-col">
                  <span className="flex flex-wrap items-center gap-2">
                    <b className="truncate text-[14px] font-semibold">{name ?? shortAddress(m.address)}</b>
                    {m.you && <span className="rounded-full bg-gold px-2 py-[1px] font-mono text-[11px] font-semibold text-bg">YOU</span>}
                    {name && <span className="font-mono text-[12px] text-faint">{shortAddress(m.address)}</span>}
                  </span>
                  <span className="truncate font-mono text-[11px] text-dim">
                    {m.role === 'owner' ? 'owner since' : 'joined'} {fmtDate(m.joinedAt)} · last seen {m.lastSeenAt ? ago(m.lastSeenAt) : 'not tracked yet'}
                    {m.invitedBy && ` · invited by ${shortAddress(m.invitedBy)}`}
                  </span>
                </span>
                <span className="flex items-center gap-2">
                  {manage ? (
                    <label className="flex items-center gap-2">
                      <span className="sr-only">Role of {shortAddress(m.address)}</span>
                      <select value={m.role} disabled={busy === `role:${m.address}`} onChange={(e) => setRole(m, e.target.value as MemberRole)} className={`${input} h-9 w-[130px] pr-8 font-mono text-[13px]`} data-role-select={m.address}>
                        {grantable(role).map((r) => (
                          <option key={r} value={r}>
                            {r}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : (
                    <span className={roleBadge(m.role)} title={ROLE_TEXT[m.role]}>
                      {m.role}
                    </span>
                  )}
                  {manage && (
                    <button type="button" onClick={() => setRemoving(m)} aria-label={`Remove ${shortAddress(m.address)}`} className="inline-flex size-9 relative after:absolute after:inset-x-0 after:-inset-y-[4px] items-center justify-center rounded-full border border-line-strong text-muted transition-colors hover:border-error hover:text-error">
                      <Trash2 size={14} aria-hidden />
                    </button>
                  )}
                </span>
              </li>
            )
          })}
        </ul>
        {role !== 'owner' && (
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-2">
            <span className="text-[12px] text-muted">You are a member ({role}). Your own workspace stays yours.</span>
            <button type="button" onClick={() => setLeaving(true)} className={`${pillSm} min-h-11 hover:!border-error hover:!text-error`}>
              <LogOut size={14} aria-hidden /> Leave workspace
            </button>
          </div>
        )}
      </section>

      <div className="flex min-w-0 flex-col gap-2">
      <section className={`${panel} gap-2 p-3`} style={rise(2)} aria-labelledby="team-act-title" data-testid="team-activity-chart">
        <div className="flex flex-col gap-[2px]">
          <h2 id="team-act-title" className={panelTitle}>
            Who changed things
          </h2>
          <span className={mono}>actions per member, latest 50 events of the activity log</span>
        </div>
        {acts === null ? (
          <Skeleton h={96} />
        ) : acts === 'error' ? (
          <LiveMarker text="Activity counts: not available right now" />
        ) : !Object.keys(acts).length ? (
          <GhostCurves height={120} title="Member activity will draw here">
            <span className="max-w-[460px] text-[13px] text-muted">Key, alert, billing and team changes count here per member.</span>
          </GhostCurves>
        ) : (
          <HBars
            label={`Actions per member: ${Object.entries(acts).map(([a, n]) => `${shortAddress(a)} ${n}`).join(', ')}.`}
            rows={view.members
              .map((m): HBar => ({ name: m.you ? `you (${shortAddress(m.address)})` : shortAddress(m.address), value: acts[m.address] ?? 0, color: m.role === 'owner' ? '#d9b563' : m.role === 'admin' ? '#f2d58a' : '#5aa9e6', note: m.role }))
              .concat(Object.keys(acts).filter((a) => !view.members.some((m) => m.address === a)).map((a) => ({ name: `${shortAddress(a)} (former)`, value: acts[a], color: '#8a94a1', note: 'no longer a member' })))
              .sort((a, b) => b.value - a.value)}
          />
        )}
      </section>

      <section className={`${panel} gap-2 p-3`} style={rise(3)} aria-labelledby="invites-title">
        <div className="flex items-baseline justify-between gap-2">
          <h2 id="invites-title" className={`${panelTitle} flex items-center gap-2`}>
            <Mail size={15} className="text-gold" aria-hidden /> Open invites
          </h2>
          <span className={mono}>
            {view.invites.length} of {view.limits.maxOpenInvites}
          </span>
        </div>
        {!view.invites.length ? (
          <p className="m-0 text-[13px] text-faint">No open invites. Links work once; wallet invites only for that wallet.</p>
        ) : (
          <ul className="m-0 flex list-none flex-col p-0" data-testid="invite-list">
            {view.invites.map((inv) => (
              <li key={inv.id} className="flex flex-wrap items-center gap-2 border-t border-line py-2 first:border-t-0">
                <span className="grid size-8 shrink-0 place-items-center rounded-full border border-line-strong text-gold">{inv.kind === 'link' ? <Link2 size={14} aria-hidden /> : <Wallet size={14} aria-hidden />}</span>
                <span className="flex min-w-0 flex-[1_1_180px] flex-col">
                  <span className="flex flex-wrap items-center gap-2">
                    <b className="text-[14px] font-semibold">{inv.kind === 'link' ? 'Invite link' : shortAddress(inv.address ?? '')}</b>
                    <span className={roleBadge(inv.role)}>{inv.role}</span>
                  </span>
                  <span className="truncate font-mono text-[11px] text-dim">
                    by {inv.createdBy === user ? 'you' : shortAddress(inv.createdBy)} {ago(inv.createdAt)} · expires {untilText(inv.expiresAt)}
                  </span>
                </span>
                {team.ok && (inv.role !== 'admin' || role === 'owner') && (
                  <button type="button" disabled={busy === `inv:${inv.id}`} onClick={() => revoke(inv)} className={`${pillSm} min-h-11 hover:!border-error hover:!text-error`}>
                    <X size={13} aria-hidden /> Revoke
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
      </div>
      </div>

      <InviteDialog open={inviting} onClose={() => setInviting(false)} myRole={role} days={view.limits.inviteDays} onCreated={load} />
      <RenameDialog open={renaming} onClose={() => setRenaming(false)} name={ws.name} onDone={() => {
          load()
          void reloadMe()
        }} />

      <Dialog open={!!removing} onClose={() => setRemoving(null)} title="Remove member">
        {removing && (
          <div className="flex flex-col gap-4">
            <p className="m-0 text-[15px] leading-[1.6] text-muted">
              <b className="font-mono text-ink">{shortAddress(removing.address)}</b> ({removing.role}) loses access to {ws.name} at once; their open sessions here fall back to their own workspace. Keys they created stay with the workspace.
            </p>
            <div className="flex flex-wrap justify-end gap-2">
              <button type="button" onClick={() => setRemoving(null)} className={pillLine}>
                Cancel
              </button>
              <button type="button" disabled={!!busy} onClick={remove} className={pillDanger}>
                Remove
              </button>
            </div>
          </div>
        )}
      </Dialog>
      <Dialog open={leaving} onClose={() => setLeaving(false)} title="Leave workspace">
        <div className="flex flex-col gap-4">
          <p className="m-0 text-[15px] leading-[1.6] text-muted">
            You lose access to <b className="text-ink">{ws.name}</b> and the app switches back to your own workspace. To come back you need a new invite.
          </p>
          <div className="flex flex-wrap justify-end gap-2">
            <button type="button" onClick={() => setLeaving(false)} className={pillLine}>
              Stay
            </button>
            <button type="button" disabled={busy === 'leave'} onClick={leave} className={pillDanger}>
              Leave workspace
            </button>
          </div>
        </div>
      </Dialog>
    </div>
  )
}

function Limit({ label, used, max }: { label: string; used: number; max: number }) {
  const pct = Math.min(100, (used / Math.max(1, max)) * 100)
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-[11px] text-dim">{label}</dt>
      <dd className="m-0 flex flex-col gap-[6px]">
        <span className="font-mono text-[14px]">
          {used} <span className="text-faint">/ {max}</span>
        </span>
        <span className="block h-[5px] overflow-hidden rounded-[3px] bg-grid" role="meter" aria-label={`${label}: ${used} of ${max}`} aria-valuemin={0} aria-valuemax={max} aria-valuenow={used}>
          <span className="block h-full rounded-[3px] transition-[width] duration-500" style={{ width: `${pct}%`, background: pct >= 100 ? '#ff8a7a' : '#d9b563' }} />
        </span>
      </dd>
    </div>
  )
}

function InviteDialog({ open, onClose, myRole, days, onCreated }: { open: boolean; onClose: () => void; myRole: Role; days: number; onCreated: () => void }) {
  const [mode, setMode] = useState<'address' | 'link'>('address')
  const [address, setAddress] = useState('')
  const [role, setRole] = useState<MemberRole>('developer')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [made, setMade] = useState<InviteCreated | null>(null)
  const roles = grantable(myRole)
  const valid = mode === 'link' || /^0x[0-9a-fA-F]{40}$/.test(address.trim())

  const close = () => {
    setMade(null)
    setErr(null)
    setAddress('')
    setBusy(false)
    onClose()
  }
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setErr(null)
    const r = await api<InviteCreated>('/api/developer/team/invite', { method: 'POST', body: mode === 'address' ? { address: address.trim(), role } : { role } })
    setBusy(false)
    if (!r.ok) return setErr(r.error)
    onCreated()
    if (r.data.link) {
      setMade(r.data)
      toastSuccess('Invite link created', { detail: 'Copy it now: it is shown once.' })
    } else {
      toastSuccess('Invite sent', { detail: `${shortAddress(r.data.invite.address ?? '')} sees it the next time they sign in.` })
      close()
    }
  }

  return (
    <Dialog open={open} onClose={close} title={made ? 'Your invite link' : 'Invite to the workspace'} dismissable={!made}>
      {made?.link ? (
        <div className="flex flex-col gap-4" data-testid="invite-link-once">
          <p className="m-0 text-[14px] leading-[1.6] text-muted">
            Anyone with this link can join as <b className="text-ink">{made.invite.role}</b>, once. It expires {fmtDate(made.invite.expiresAt)} ({untilText(made.invite.expiresAt)}). We keep only a hash: <b className="text-ink">this is the only time it is shown</b>.
          </p>
          <div className="flex items-stretch gap-2 max-[480px]:flex-col">
            <code className="min-w-0 flex-1 rounded-input border border-line-strong bg-bg px-3 py-3 font-mono text-[12px] break-all text-ink" data-invite-link>
              {made.link}
            </code>
            <CopyButton text={made.link} what="Invite link" label="Copy link" />
          </div>
          <div className="flex justify-end">
            <button type="button" data-autofocus onClick={close} className={pillGold}>
              I copied it
            </button>
          </div>
        </div>
      ) : (
        <form className="flex flex-col gap-4" onSubmit={submit}>
          <div role="radiogroup" aria-label="Invite by" className="flex gap-2">
            {(
              [
                ['address', 'By wallet address', Wallet],
                ['link', 'Create a link', Link2],
              ] as const
            ).map(([v, t, Icon]) => (
              <button key={v} type="button" role="radio" aria-checked={mode === v} onClick={() => setMode(v)} className={`${chip(mode === v)} flex-1`}>
                <Icon size={14} aria-hidden /> {t}
              </button>
            ))}
          </div>
          {mode === 'address' ? (
            <label className="flex flex-col gap-2 text-[14px] text-ink-2">
              Wallet address
              <input className={`${input} font-mono text-[13px]`} value={address} onChange={(e) => setAddress(e.target.value)} placeholder="0x…" autoComplete="off" spellCheck={false} autoCapitalize="off" required name="invite-address" />
              <span className="text-[12px] text-faint">They accept it in the app after signing in with that wallet.</span>
            </label>
          ) : (
            <p className="m-0 text-[13px] leading-[1.55] text-muted">A one-time link anyone can use to join. Send it privately; it expires in {days} days.</p>
          )}
          <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
            <legend className="mb-2 text-[14px] text-ink-2">Role</legend>
            {roles.map((r) => (
              <label key={r} className={`flex min-h-11 cursor-pointer items-start gap-3 rounded-[10px] border px-3 py-2 transition-colors ${role === r ? 'border-gold-line bg-[rgba(217,181,99,.06)]' : 'border-line hover:border-line-strong'}`}>
                <input type="radio" name="invite-role" value={r} checked={role === r} onChange={() => setRole(r)} className="mt-[5px] accent-[#d9b563]" />
                <span className="flex flex-col">
                  <b className="text-[14px] font-semibold capitalize">{r}</b>
                  <span className="text-[12px] text-dim">{ROLE_TEXT[r]}</span>
                </span>
              </label>
            ))}
            {myRole !== 'owner' && <span className="text-[12px] text-faint">Only the owner can invite admins.</span>}
          </fieldset>
          {err && <ErrorLine>{err}</ErrorLine>}
          <div className="flex flex-wrap justify-end gap-2">
            <button type="button" onClick={close} className={pillLine}>
              Cancel
            </button>
            <button type="submit" disabled={busy || !valid} className={pillGold}>
              {mode === 'link' ? 'Create link' : 'Send invite'}
            </button>
          </div>
        </form>
      )}
    </Dialog>
  )
}

function RenameDialog({ open, onClose, name, onDone }: { open: boolean; onClose: () => void; name: string; onDone: () => void }) {
  const [value, setValue] = useState(name)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [shown, setShown] = useState(open)
  // Start from the current name each time the dialog opens.
  if (open !== shown) {
    setShown(open)
    if (open) {
      setValue(name)
      setErr(null)
    }
  }
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setErr(null)
    const r = await api<{ workspace: WorkspaceRef }>('/api/developer/workspace/name', { method: 'POST', body: { name: value } })
    setBusy(false)
    if (!r.ok) return setErr(r.error)
    toastSuccess('Workspace renamed', { detail: r.data.workspace.name })
    onDone()
    onClose()
  }
  return (
    <Dialog open={open} onClose={onClose} title="Rename workspace">
      <form className="flex flex-col gap-4" onSubmit={submit}>
        <label className="flex flex-col gap-2 text-[14px] text-ink-2">
          Name
          <input className={input} value={value} onChange={(e) => setValue(e.target.value)} maxLength={40} required name="workspace-name" />
          <span className="text-[12px] text-faint">Every member sees it in their workspace menu and on invites.</span>
        </label>
        {err && <ErrorLine>{err}</ErrorLine>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className={pillLine}>
            Cancel
          </button>
          <button type="submit" disabled={busy || !value.trim()} className={pillGold}>
            Save name
          </button>
        </div>
      </form>
    </Dialog>
  )
}
