import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { ScanSearch } from 'lucide-react'
import { ChainLogo } from '../logos/ChainLogo'
import { TokenLogo } from '../logos/TokenLogo'
import { ageText } from '../../lib/tracker'
import { holdersPagePath } from '../../lib/holders'

/* The latest DeepCore launches (GET /api/deepcore/launches, the poller's cache in deepcore.mjs), each with
   a link to its Holder Map. On the site the links stay in the tab; in the app (another host) they open the
   site in a new tab. */

type Launch = {
  chainId: number
  chainKey: string
  chainName: string
  token: string
  symbol: string | null
  createdAt: string
  locked: boolean | null
}
type Body = {
  state: 'ok' | 'stale' | 'unreadable'
  asOf: string | null
  launches: Launch[]
}

export function LaunchHolders({ external = false, limit = 8 }: { external?: boolean; limit?: number }) {
  const [s, setS] = useState<{ k: 'loading' } | { k: 'error' } | { k: 'ok'; data: Body }>({ k: 'loading' })
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    let alive = true
    const go = () =>
      fetch('/api/deepcore/launches')
        .then((r) => (r.ok ? (r.json() as Promise<Body>) : Promise.reject(new Error(String(r.status)))))
        .then(
          (data) => {
            if (!alive) return
            setS({ k: 'ok', data })
            setNow(Date.now())
          },
          () => alive && setS((p) => (p.k === 'ok' ? p : { k: 'error' })),
        )
    go()
    const id = setInterval(go, 90_000)
    return () => {
      alive = false
      clearInterval(id)
    }
  }, [])

  const live = (
    <span className="relative inline-flex size-2.5 flex-none" aria-hidden>
      <span className="absolute inset-0 animate-[gl-live-pulse_2s_ease-out_infinite] rounded-full bg-gold" />
      <span className="relative size-2.5 rounded-full bg-gold" />
    </span>
  )
  if (s.k === 'loading')
    return (
      <div role="status" aria-label="Reading DeepCore launches" className="flex flex-col gap-2">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-11 animate-[gl-skeleton_1.4s_ease-in-out_infinite] rounded-[8px] bg-surface-deep" />
        ))}
      </div>
    )
  if (s.k === 'error' || s.data.state === 'unreadable') return <p className="m-0 flex items-center gap-2 font-mono text-[12px] text-faint">{live} DeepCore’s launch list could not be read just now; it is retried every minute or two.</p>
  const list = s.data.launches.slice(0, limit)
  return (
    <div className="flex flex-col gap-2" data-launch-holders>
      <span className="flex items-center gap-2 font-mono text-[11px] tracking-[1px] text-faint">
        {live} LIVE FROM DEEPCORE · {s.data.state === 'stale' ? `LAST READ ${ageText(s.data.asOf, now).toUpperCase()}` : `${list.length} LATEST`}
      </span>
      {!list.length && <p className="m-0 text-[13px] text-muted">No launches yet.</p>}
      <ul className="m-0 flex list-none flex-col gap-1 p-0">
        {list.map((l) => {
          const path = holdersPagePath(l.chainKey, l.token)
          const body = (
            <>
              <TokenLogo symbol={l.symbol ?? 'token'} chain={l.chainKey} address={l.token} size={24} decorative />
              <span className="min-w-0 flex-1 truncate font-semibold text-ink">{l.symbol ?? `${l.token.slice(0, 6)}…${l.token.slice(-4)}`}</span>
              <span className="hidden flex-none items-center gap-1 font-mono text-[11px] text-faint min-[420px]:inline-flex">
                <ChainLogo chain={l.chainKey} size={14} decorative /> {l.chainName}
              </span>
              <span className="flex-none font-mono text-[11px] text-faint">
                {l.locked === true ? '🔒' : ''} {ageText(l.createdAt, now)}
              </span>
              <span data-holders-chip className="inline-flex h-8 flex-none items-center gap-1 rounded-btn border border-gold-line px-2 font-mono text-[12px] text-gold">
                <ScanSearch aria-hidden size={14} />
                Holders {external ? '↗' : '→'}
              </span>
            </>
          )
          const cls = 'flex min-h-11 items-center gap-3 rounded-[8px] border border-line px-3 text-[14px] transition-colors hover:border-gold'
          return (
            <li key={`${l.chainId}:${l.token}`}>
              {external ? (
                <a href={`https://gullylabs.xyz${path}`} target="_blank" rel="noopener noreferrer" className={cls}>
                  {body}
                  <span className="sr-only"> (opens in a new tab)</span>
                </a>
              ) : (
                <Link to={path} className={cls}>
                  {body}
                </Link>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
