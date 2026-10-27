/* The live ticker strip under the HolderMaps top bar: today's most scanned maps (GET /api/holders/top), moving; still
   and scrollable under reduced motion. Used by the landing and the 404. */
import { Link } from 'react-router'
import { ChainLogo } from '../components/logos/ChainLogo'
import type { TopScanned } from '../lib/holders'
import { holderHref } from '../site-host'
import { CHAIN_NAMES, fmtInt } from './insights'

/** The live ticker strip under the top bar: today's most scanned maps, moving. */
export function Tape({ items, state }: { items: TopScanned['items'] | null; state: 'loading' | 'error' | 'ok' }) {
  const body =
    state === 'error' ? (
      <span className="hmt-tape-msg">Today’s scans could not be read just now · retrying every minute</span>
    ) : !items ? (
      <span className="hmt-tape-msg">reading today’s scans…</span>
    ) : !items.length ? (
      <span className="hmt-tape-msg" data-testid="hm-strip-empty">
        No maps opened yet today. Paste a token below and yours is the first.
      </span>
    ) : null
  const row = (dup: boolean) => (
    <ul className="hmt-tape-row" aria-hidden={dup || undefined}>
      {(items ?? []).map((x) => (
        <li key={`${x.chain}:${x.token}`}>
          <Link to={holderHref(x.path)} tabIndex={dup ? -1 : undefined}>
            <ChainLogo chain={x.chain} size={14} decorative />
            <b>{x.symbol ?? `${x.token.slice(0, 6)}…`}</b>
            <span>{x.chain === 'gully' ? 'Gully Chain' : (CHAIN_NAMES[x.chain] ?? x.chain)}</span>
            <em>
              {fmtInt(x.scans)} {x.scans === 1 ? 'scan' : 'scans'}
            </em>
          </Link>
        </li>
      ))}
    </ul>
  )
  const few = (items?.length ?? 0) < 5
  return (
    <section className="hmt-tape" aria-label="Recently mapped today">
      <span className="hmt-tape-lb">
        <i className="hm-dot" aria-hidden /> Recently mapped
      </span>
      <div className={`hmt-tape-v ${few ? 'few' : ''}`}>
        {body ?? (
          <>
            {row(false)}
            {!few && row(true)}
          </>
        )}
      </div>
    </section>
  )
}

