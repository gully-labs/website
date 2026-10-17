import { createContext, useContext } from 'react'
import type { Me, MemberRole, Role } from './api'

/* The signed-in console's shared state (portal v2): who is signed in (GET /me), the active workspace
   and the wallet's role in it. Every tab reads its write permissions from here, so buttons a role
   cannot use are hidden or disabled with a reason. The server enforces the same table
   (server/workspaces.mjs, WRITES); this only keeps the UI honest. */

/** What a POST changes, as the server groups it (workspaces.mjs categoryOf). */
export type WriteCategory = 'keys' | 'alerts' | 'telegram' | 'analytics' | 'billing' | 'company' | 'team' | 'admin' | 'owner'

/** The write categories each role holds (mirrors workspaces.mjs WRITES). */
export const WRITES: Record<Role, WriteCategory[]> = {
  viewer: [],
  developer: ['keys', 'alerts', 'telegram', 'analytics'],
  billing: ['billing', 'company'],
  admin: ['keys', 'alerts', 'telegram', 'analytics', 'billing', 'company', 'team', 'admin'],
  owner: ['keys', 'alerts', 'telegram', 'analytics', 'billing', 'company', 'team', 'admin', 'owner'],
}

export const ROLE_TEXT: Record<Role, string> = {
  owner: 'Owns the workspace: everything, including admins and the plan.',
  admin: 'Everything except changing other admins: keys, alerts, billing, team.',
  developer: 'Keys, alerts, Telegram and Gully Analytics sites. No billing or team.',
  billing: 'Plans, payments and company details. Reads everything else.',
  viewer: 'Reads everything, changes nothing.',
}

export const MEMBER_ROLES: MemberRole[] = ['admin', 'developer', 'billing', 'viewer']

export interface Portal {
  me: Me | null
  /** The signed-in wallet (lower-case). */
  user: string
  /** The role in the active workspace; 'owner' when /me could not be read (the server still checks). */
  role: Role
  reloadMe: () => Promise<void>
  /** Switches the session's workspace and reloads everything. */
  switchTo: (id: string) => Promise<boolean>
  /** Called after a change that affects the whole console (joined, left, renamed). */
  refreshAll: () => Promise<void>
}

export const PortalContext = createContext<Portal>({
  me: null,
  user: '',
  role: 'owner',
  reloadMe: async () => undefined,
  switchTo: async () => false,
  refreshAll: async () => undefined,
})

export const usePortal = () => useContext(PortalContext)

/** Whether the current role may make writes of `cat`, and the reason shown when it may not. */
export function useWrite(cat: WriteCategory, what: string): { ok: boolean; why: string | undefined } {
  const { role } = usePortal()
  const ok = WRITES[role]?.includes(cat) ?? false
  return { ok, why: ok ? undefined : `Your role (${role}) can't ${what}.` }
}

/** Invites the user declined here (there is no decline route): hidden locally until they expire. */
const DECLINED = 'gully:declined-invites'
export function declinedInvites(): Record<string, string> {
  try {
    const raw = JSON.parse(localStorage.getItem(DECLINED) ?? '{}') as Record<string, string>
    const now = Date.now()
    return Object.fromEntries(Object.entries(raw).filter(([, until]) => Date.parse(until) > now))
  } catch {
    return {}
  }
}
export function declineInvite(id: string, until: string) {
  try {
    localStorage.setItem(DECLINED, JSON.stringify({ ...declinedInvites(), [id]: until }))
  } catch {
    /* private mode: it shows again next visit */
  }
}

/** The invite token in `#invite=<token>`, or null. */
export function inviteTokenFromHash(): string | null {
  const m = window.location.hash.match(/^#invite=([A-Za-z0-9_-]{20,64})$/)
  return m ? m[1] : null
}

export function clearInviteHash() {
  if (window.location.hash.startsWith('#invite=')) history.replaceState(null, '', window.location.pathname + window.location.search)
}

/** Plain-words date + time. */
export const fmtDateTime = (iso: string | null) => (iso ? new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—')

/** "in 6 days", "in 3h", "expired". */
export function untilText(iso: string): string {
  const s = Math.round((Date.parse(iso) - Date.now()) / 1000)
  if (s <= 0) return 'expired'
  if (s < 3600) return `in ${Math.max(1, Math.round(s / 60))}m`
  if (s < 86_400) return `in ${Math.round(s / 3600)}h`
  const d = Math.round(s / 86_400)
  return `in ${d} day${d === 1 ? '' : 's'}`
}
