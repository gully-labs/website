import { useEffect, useState } from 'react'
import { useParams, useSearchParams } from 'react-router'
import { Mascot } from '../components/brand'
import { HolderMap } from '../components/holders/HolderMap'
import { holdersPagePath } from '../lib/holders'

/* /embed/holders/:chain/:token: the Holder Map for other sites (widget.js data-gully-widget="holders" frames
   it). No site chrome; trades and shares open gullylabs.xyz in a new tab. The credit shows unless the server
   says otherwise: ?key= (a signed embed key) is checked at /api/holders/embed-config, which reads the plan live
   (plans.mjs HOLDER_MAP whiteLabel). Only a whiteLabel answer hides the mark or applies theme/accent; nothing
   in the URL alone can. */

type Config = { whiteLabel: boolean; theme: { mode: 'light' | 'dark'; accent: string | null } | null }

export function EmbedHolders() {
  const { chain = '', token = '' } = useParams()
  const [sp] = useSearchParams()
  const key = sp.get('key') ?? ''
  const [cfg, setCfg] = useState<Config | null>(key ? null : { whiteLabel: false, theme: null })
  useEffect(() => {
    if (!key) return
    const q = new URLSearchParams({ key, theme: sp.get('theme') ?? '', accent: sp.get('accent') ?? '' })
    let live = true
    fetch(`/api/holders/embed-config?${q}`)
      .then((r) => r.json())
      .then((c: Config) => live && setCfg(c))
      .catch(() => live && setCfg({ whiteLabel: false, theme: null }))
    return () => {
      live = false
    }
  }, [key, sp])
  const page = `https://gullylabs.xyz${holdersPagePath(chain, token)}`
  const white = cfg?.whiteLabel === true
  const theme = white ? cfg?.theme : null
  const style = theme ? ({ ...(theme.accent ? { '--color-gold': theme.accent, '--color-gold-hover': theme.accent } : {}), colorScheme: theme.mode } as React.CSSProperties) : undefined
  return (
    <main className="min-h-[100svh] bg-bg p-2 text-ink" data-theme={theme?.mode} data-white-label={white ? 'true' : undefined} style={style}>
      {cfg && <HolderMap chain={chain} token={token} embed compact />}
      {cfg && !white && (
        <a href={page} target="_blank" rel="noopener noreferrer" className="mt-2 flex min-h-11 items-center justify-center gap-2 font-mono text-[11px] tracking-[1px] text-muted hover:text-gold-hover" data-credit>
          <Mascot size={18} decorative /> Powered by Gully Labs ↗
        </a>
      )}
    </main>
  )
}
