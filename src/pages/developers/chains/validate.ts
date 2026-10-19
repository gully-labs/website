import { isAddress, type Address } from 'viem'

/* The wizard's input checks, in one place (the server repeats them: server/chains-launch.mjs readLaunch). */

export const NAME_RE = /^[\p{L}\p{N} ._-]{3,40}$/u
export const MAX_ADDRESSES = 8
const RAW_KEY_RE = /^(0x)?[0-9a-fA-F]{64}$/

export const nameError = (v: string): string | null => (NAME_RE.test(v.trim()) ? null : 'Use 3 to 40 letters, digits, spaces, dots, dashes or underscores.')

/** The chain id's own checks (the uniqueness check is a server call). */
export function chainIdError(v: string): string | null {
  const s = v.trim()
  if (!/^\d{1,16}$/.test(s)) return 'A chain id is a whole number, for example 412346.'
  const n = Number(s)
  if (!Number.isSafeInteger(n) || n < 1 || n > 4_503_599_627_370_495) return 'A chain id is a whole number from 1 up to 4503599627370495.'
  return null
}

export const addressError = (v: string): string | null => {
  const s = v.trim()
  if (RAW_KEY_RE.test(s)) return 'That looks like a private key, not an address. Never paste a key here.'
  return isAddress(s) ? null : 'Not a valid 0x address (40 hex digits; a mixed-case address must have the right checksum).'
}

/** A list typed one address per line (commas and spaces also split). { list } or { error }. */
export function addressListOf(text: string, label: string): { list: Address[]; error: null } | { list: null; error: string } {
  const parts = text.split(/[\s,;]+/).filter(Boolean)
  if (parts.length === 0) return { list: null, error: `Give at least one ${label} address.` }
  if (parts.length > MAX_ADDRESSES) return { list: null, error: `At most ${MAX_ADDRESSES} ${label} addresses.` }
  const out: Address[] = []
  for (const p of parts) {
    const e = addressError(p)
    if (e) return { list: null, error: `${p.slice(0, 14)}${p.length > 14 ? '…' : ''}: ${e}` }
    if (/^0x0{40}$/i.test(p)) return { list: null, error: `The zero address can't be a ${label}.` }
    if (!out.some((x) => x.toLowerCase() === p.toLowerCase())) out.push(p as Address)
  }
  return { list: out, error: null }
}
