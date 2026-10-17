import type { Project } from '../content/projects'
import { SHARE } from '../content/site'
import type { Stats } from './stats'

/* Share text and intent links. A post about Gully carries the ledger's figures at the moment it
   is composed (never a typed number); a post about a project carries its own tagline, handle and
   link. Intent links open the visitor's own X or Telegram; nothing posts on their behalf. */

export const xPost = (text: string, url: string) => `https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`
export const xFollow = (handle: string) => `https://x.com/intent/follow?screen_name=${encodeURIComponent(handle.replace(/^@/, ''))}`
export const tgShare = (text: string, url: string) => `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`

/** The post about Gully Labs, with the figures the ledger shows right now. */
export function gullyPost(data: Stats | null): string {
  const live = data ? data.venues.filter((v) => v.state === 'ok').length : null
  // No dollar figures: early totals undersell the venues in a post that outlives them (design audit P1-1).
  return `${live ?? 'Five'} live Web3 venues built by ${SHARE.handle}, measured live: launchpads, DEXes, quests and social trading, one ledger. ${SHARE.hashtags.join(' ')}`
}

/** The post about one project. */
export function projectPost(p: Project): string {
  const by = p.x ? `${p.x} by ${SHARE.handle}` : `by ${SHARE.handle}`
  return `${p.name}: ${p.tagline}. ${p.description} ${by} ${SHARE.hashtags.slice(0, 1).join(' ')}`
}
