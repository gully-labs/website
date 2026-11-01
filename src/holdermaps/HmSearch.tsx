/* HolderMaps' token search (GET /api/holders/resolve): one box for an address or a ticker, checked on every chain at
   once, and a short stepper under it that follows the search as it runs (paste, check the chains, open the map). A
   token on several chains offers each one. No match is never a dead end: what was checked on each chain, in plain
   words. */
import { useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { Loader2, Map as MapIcon, Radar, Search } from 'lucide-react'
import { ChainLogo } from '../components/logos/ChainLogo'
import type { ResolveChecked, ResolveMatch } from '../lib/holders'
import { isTokenAddress, resolveToken } from '../lib/holderResolve'
import { holderHref } from '../site-host'
import { HmSteps, type HmStep } from './HmKit'
import { Mascot } from './Mascot'


const STEPS: HmStep[] = [
  { t: 'Paste', d: 'An address or a ticker', icon: Search },
  { t: 'We check', d: 'Every chain at once', icon: Radar },
  { t: 'Read it', d: 'Bubbles, clusters, charts', icon: MapIcon },
]

type S = { k: 'idle' } | { k: 'busy' } | { k: 'none'; checked: ResolveChecked[]; address: boolean } | { k: 'error' } | { k: 'limit' } | { k: 'many'; matches: ResolveMatch[] }

export function HmSearch({ compact = false, autoFocus = false }: { compact?: boolean; autoFocus?: boolean }) {
  const nav = useNavigate()
  const [q, setQ] = useState('')
  const [s, setS] = useState<S>({ k: 'idle' })
  const open = (path: string) => {
    const to = holderHref(path)
    if (/^https?:\/\//.test(to)) window.location.assign(to)
    else nav(to)
  }
  const go = async (e: { preventDefault(): void }) => {
    e.preventDefault()
    const v = q.trim().replace(/^\$/, '')
    if (!v) return
    setS({ k: 'busy' })
    const r = await resolveToken(v)
    if (r.k !== 'ok') return setS({ k: r.k })
    if (!r.matches.length) return setS({ k: 'none', checked: r.checked, address: isTokenAddress(v) })
    if (r.matches.length === 1) return open(r.matches[0].path)
    setS({ k: 'many', matches: r.matches })
  }
  const step = s.k === 'busy' ? 1 : s.k === 'many' ? 2 : q.trim() ? 0 : -1
  const id = compact ? 'hm-q2' : 'hm-q'
  return (
    <div className={`hm-search ${compact ? 'compact' : ''}`}>
      <form role="search" onSubmit={go} className="hm-search-box">
        <Search aria-hidden className="hm-ic" />
        <label htmlFor={id} className="hm-sr">
          Token address or ticker
        </label>
        <input id={id} value={q} onChange={(e) => {
            setQ(e.target.value)
            if (s.k !== 'busy') setS({ k: 'idle' })
          }} placeholder="Paste a token address or ticker" spellCheck={false} autoComplete="off" autoFocus={autoFocus} enterKeyHint="search" />
        <button type="submit" className="hm-btn" disabled={s.k === 'busy'}>
          {s.k === 'busy' ? <Loader2 aria-hidden className="hm-ic hm-spin" /> : null}
          <span>{s.k === 'busy' ? 'Mapping…' : 'Map it'}</span>
        </button>
      </form>
      {!compact && <HmSteps steps={STEPS} at={step} label="How a search runs" />}
      <div aria-live="polite">
        {s.k === 'none' && <NoMatch checked={s.checked} address={s.address} />}
        {s.k === 'limit' && <p className="hm-note">That is a lot of new addresses in a minute. Wait a moment and try again; tokens already mapped open straight away.</p>}
        {s.k === 'error' && <p className="hm-note err">The search did not answer just now. Try again.</p>}
        {s.k === 'many' && (
          <>
            <ul className="hm-matches" aria-label="Pick a token" data-resolve-matches>
              {s.matches.map((m) => (
                <li key={`${m.chain}:${m.token}`}>
                  <Link to={holderHref(m.path)}>
                    <ChainLogo chain={m.chain} size={16} decorative />
                    <b>{m.symbol ?? `${m.token.slice(0, 6)}…${m.token.slice(-4)}`}</b>
                    <span className="c">{m.chain === 'gully' ? 'Gully Chain' : m.chainName}</span>
                    <span className="k">
                      {m.kind === 'deepcore-launch' ? 'Launch' : m.kind === 'launch' ? 'Launchpad token' : m.kind === 'token' ? 'Token' : 'Stock token'}
                      {m.available === false ? ' · coming soon' : ''}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  )
}

/** Nothing found: the pointing mascot and what was checked on each chain. */
function NoMatch({ checked, address }: { checked: ResolveChecked[]; address: boolean }) {
  return (
    <div className="hm-nomatch" data-no-match>
      <Mascot pose="point" width={80} />
      <div>
        {!address ? (
          <p>
            That is not a token address or a ticker we follow. Paste a <code className="hm-code">0x…</code> address (any token on Gully Chain, Robinhood Chain, BNB Chain, Base or HyperEVM), a Solana mint, or a ticker such as NVDA.
          </p>
        ) : (
          <>
            <p>No token at that address. Checked {checked.length ? checked.map((c) => c.chainName).join(', ') : 'every supported chain'}:</p>
            <ul>
              {checked.map((c) => (
                <li key={c.chain}>
                  <b>{c.chainName}</b>: {c.reason ?? (c.status === 'unreadable' ? 'could not be reached just now' : 'not a token')}
                </li>
              ))}
            </ul>
            {checked.some((c) => c.status === 'unreadable') && <p>A chain that could not be reached may still hold it; try again in a minute.</p>}
          </>
        )}
      </div>
    </div>
  )
}
