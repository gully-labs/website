import { useEffect, useState } from 'react'
import { Link, useInRouterContext } from 'react-router'
import { ScanSearch } from 'lucide-react'
import { isTokenAddress, resolveToken } from '../../lib/holderResolve'
import type { ResolveMatch } from '../../lib/holders'
import { SITE_URL } from '../../site-host'
import { newTab } from '../LayoutNav'
import { ASK_CLOSE_EVENT } from './openAsk'

/* The first result in Gully AI (⌘K): when the typed text is a 0x address, a Solana mint or a ticker the Holder
   Map follows, "Open Holder Map for …" comes before asking the AI. It uses the same GET /api/holders/resolve as
   the /holders search (debounced, so it asks only once typing pauses). Anything else shows nothing. */

const TICKER = /^\$?[A-Za-z][A-Za-z0-9]{1,9}$/
/** Whether the text could be a token: an address, a mint, or a ticker (lowercase words need a $). */
const looksLikeToken = (t: string) => isTokenAddress(t) || (TICKER.test(t) && (t.startsWith('$') || t === t.toUpperCase()))

function useHits(text: string) {
  const [hits, setHits] = useState<{ for: string; matches: ResolveMatch[] } | null>(null)
  const t = text.trim().replace(/^\$/, '')
  const want = looksLikeToken(text.trim())
  useEffect(() => {
    if (!want) return
    const ac = new AbortController()
    const id = setTimeout(() => {
      resolveToken(t, ac.signal).then((r) => {
        if (!ac.signal.aborted) setHits({ for: t, matches: r.k === 'ok' ? r.matches.slice(0, 3) : [] })
      })
    }, 300)
    return () => {
      clearTimeout(id)
      ac.abort()
    }
  }, [t, want])
  return want && hits?.for === t ? hits.matches : []
}

export function HolderMapHit({ text }: { text: string }) {
  const matches = useHits(text)
  const inRouter = useInRouterContext()
  if (!matches.length) return null
  return (
    <ul className="m-0 flex list-none flex-col gap-1 p-0" aria-label="Open the Holder Map" data-holder-hit>
      {matches.map((m) => {
        const cls = 'flex min-h-11 items-center gap-2 rounded-card border border-gold-line bg-gold/8 px-3 text-[14px] text-ink transition-colors hover:border-gold hover:text-ink'
        const body = (
          <>
            <ScanSearch aria-hidden size={16} className="flex-none text-gold" />
            <span className="min-w-0 truncate">
              Open Holder Map for <b className="font-semibold">{m.symbol ? `$${m.symbol}` : `${m.token.slice(0, 6)}…${m.token.slice(-4)}`}</b> on {m.chainName}
            </span>
            <span aria-hidden className="ml-auto flex-none text-gold">
              →
            </span>
          </>
        )
        return (
          <li key={`${m.chain}:${m.token}`}>
            {inRouter ? (
              <Link to={m.path} className={cls} onClick={() => window.dispatchEvent(new Event(ASK_CLOSE_EVENT))}>
                {body}
              </Link>
            ) : (
              <a href={`${SITE_URL}${m.path}`} {...newTab} className={cls}>
                {body}
                <span className="sr-only"> (opens in a new tab)</span>
              </a>
            )}
          </li>
        )
      })}
    </ul>
  )
}
