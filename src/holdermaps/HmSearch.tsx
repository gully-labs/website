/* HolderMaps' token search (GET /api/holders/resolve through useHolderSearch): one box for an address on any chain
   we cover or a ticker, with a live three-step stepper under it (paste, check every chain, open the map) that follows
   the search as it runs. No match is never a dead end: what was checked on each chain, in plain words. */
import { Link } from 'react-router'
import { Check, Loader2, Map as MapIcon, Radar, Search } from 'lucide-react'
import { ChainLogo } from '../components/logos/ChainLogo'
import type { ResolveChecked } from '../lib/holders'
import { useHolderSearch } from '../lib/holderResolve'
import { holderHref } from '../site-host'
import { Mascot } from './Mascot'

const STEPS = [
  { icon: Search, t: 'Paste', d: 'An address or a ticker' },
  { icon: Radar, t: 'We check', d: 'Every chain at once' },
  { icon: MapIcon, t: 'Read the map', d: 'Bubbles, clusters, charts' },
]

export function HmSearch({ compact = false, autoFocus = false }: { compact?: boolean; autoFocus?: boolean }) {
  const { q, s, go, change } = useHolderSearch()
  const step = s.k === 'busy' ? 1 : s.k === 'many' ? 2 : q.trim() ? 0 : -1
  return (
    <div className={`hm-search ${compact ? 'compact' : ''}`}>
      <form role="search" onSubmit={go} className="hm-search-box">
        <Search aria-hidden className="hm-ic lg" />
        <label htmlFor={compact ? 'hm-q2' : 'hm-q'} className="hm-sr">
          Token address or ticker
        </label>
        <input id={compact ? 'hm-q2' : 'hm-q'} value={q} onChange={(e) => change(e.target.value)} placeholder="Paste a token address or ticker" spellCheck={false} autoComplete="off" autoFocus={autoFocus} enterKeyHint="search" />
        <button type="submit" className="hm-btn" disabled={s.k === 'busy'}>
          {s.k === 'busy' ? <Loader2 aria-hidden className="hm-ic hm-spin" /> : null}
          <span>{s.k === 'busy' ? 'Mapping…' : 'Map it'}</span>
        </button>
      </form>
      {!compact && (
        <ol className="hm-steps" aria-label="How a search runs">
          {STEPS.map((st, i) => {
            const state = i < step ? 'done' : i === step ? 'on' : ''
            const I = state === 'done' ? Check : st.icon
            return (
              <li key={st.t} className={state} aria-current={i === step ? 'step' : undefined}>
                <span className="n" aria-hidden>
                  <I className="hm-ic sm" />
                </span>
                <span className="t">{st.t}</span>
                <span className="d">{st.d}</span>
                <span className="bar" aria-hidden>
                  <i />
                </span>
              </li>
            )
          })}
        </ol>
      )}
      <div aria-live="polite">
        {s.k === 'none' && <NoMatch checked={s.checked} address={s.address} />}
        {s.k === 'limit' && <p className="hm-note">That is a lot of new addresses in a minute. Wait a moment and try again; tokens already mapped open straight away.</p>}
        {s.k === 'error' && <p className="hm-note err">The search did not answer just now. Try again.</p>}
        {s.k === 'many' && (
          <ul className="hm-matches" aria-label="Pick a token" data-resolve-matches>
            {s.matches.map((m) => (
              <li key={`${m.chain}:${m.token}`}>
                <Link to={holderHref(m.path)}>
                  <ChainLogo chain={m.chain} size={16} decorative />
                  <b>{m.symbol ?? `${m.token.slice(0, 6)}…${m.token.slice(-4)}`}</b>
                  <span className="c">{m.chainName}</span>
                  <span className="k">
                    {m.kind === 'deepcore-launch' ? 'DeepCore launch' : m.kind === 'launch' ? 'Launchpad token' : m.kind === 'token' ? 'Token' : 'Stock token'}
                    {m.available === false ? ' · coming soon' : ''}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

/** Nothing found: the pointing mascot and what was checked on each chain. */
function NoMatch({ checked, address }: { checked: ResolveChecked[]; address: boolean }) {
  return (
    <div className="hm-nomatch" data-no-match>
      <Mascot pose="point" width={88} />
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
