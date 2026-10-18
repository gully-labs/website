import { useParams } from 'react-router'
import { Mascot } from '../components/brand'
import { HolderMap } from '../components/holders/HolderMap'
import { holdersPagePath } from '../lib/holders'

/* /embed/holders/:chain/:token: the Holder Map for other sites (widget.js data-gully-widget="holders" frames
   it). No site chrome; trades and shares open gullylabs.xyz in a new tab. The credit always shows: a
   white-label embed is reserved for a plan (plans.mjs HOLDER_MAP whiteLabel) and not built yet. */

export function EmbedHolders() {
  const { chain = '', token = '' } = useParams()
  const page = `https://gullylabs.xyz${holdersPagePath(chain, token)}`
  return (
    <main className="min-h-[100svh] bg-bg p-2 text-ink">
      <HolderMap chain={chain} token={token} embed compact />
      <a href={page} target="_blank" rel="noopener noreferrer" className="mt-2 flex min-h-11 items-center justify-center gap-2 font-mono text-[11px] tracking-[1px] text-muted hover:text-gold-hover" data-credit>
        <Mascot size={18} decorative /> Powered by Gully Labs ↗
      </a>
    </main>
  )
}
