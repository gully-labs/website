import { useState } from 'react'
import { useNavigate } from 'react-router'
import type { ResolveChecked, ResolveMatch } from './holders'

/* The Holder Map's token search, shared by /holders and the home hero: GET /api/holders/resolve finds a ticker
   or an address on every chain we cover. One match opens its map; several offer a pick; none explains why. */

export const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/
export const SOLANA_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/
export const isTokenAddress = (v: string) => EVM_ADDRESS.test(v) || SOLANA_ADDRESS.test(v)

export type ResolveState = { k: 'idle' } | { k: 'busy' } | { k: 'none'; checked: ResolveChecked[]; address: boolean } | { k: 'error' } | { k: 'limit' } | { k: 'many'; matches: ResolveMatch[] }

/** One read of /api/holders/resolve: the matches, or why there are none. */
export async function resolveToken(v: string, signal?: AbortSignal): Promise<{ k: 'ok'; matches: ResolveMatch[]; checked: ResolveChecked[] } | { k: 'limit' } | { k: 'error' }> {
  try {
    const res = await fetch(`/api/holders/resolve?q=${encodeURIComponent(v)}`, { headers: { accept: 'application/json' }, signal })
    if (res.status === 429) return { k: 'limit' }
    if (!res.ok) return { k: 'error' }
    const r = (await res.json()) as { matches: ResolveMatch[]; checked?: ResolveChecked[] }
    return { k: 'ok', matches: r.matches ?? [], checked: r.checked ?? [] }
  } catch {
    return { k: 'error' }
  }
}

/** The search's state and its submit handler (Enter or the button). */
export function useHolderSearch() {
  const nav = useNavigate()
  const [q, setQ] = useState('')
  const [s, setS] = useState<ResolveState>({ k: 'idle' })
  const go = async (e: { preventDefault(): void }) => {
    e.preventDefault()
    const v = q.trim().replace(/^\$/, '')
    if (!v) return
    setS({ k: 'busy' })
    const r = await resolveToken(v)
    if (r.k !== 'ok') return setS({ k: r.k })
    if (!r.matches.length) return setS({ k: 'none', checked: r.checked, address: isTokenAddress(v) })
    if (r.matches.length === 1) return nav(r.matches[0].path)
    setS({ k: 'many', matches: r.matches })
  }
  const change = (v: string) => {
    setQ(v)
    if (s.k !== 'busy') setS({ k: 'idle' })
  }
  return { q, s, go, change }
}
