import { useEffect, type ReactNode } from 'react'
import { useParams } from 'react-router'
import { track } from './track'

/* Route-level analytics for pages whose own files belong to someone else (the Holder Map pages): one event per
   map opened, sent from the route, never from inside the page. Labels only: the chain, launch or stock, and
   where it was opened. Never the token address or a wallet. */

/** A stock map is keyed by its ticker (NVDA, TSLAx); a launch by its contract address. */
const holderKind = (token: string) => (/^[A-Za-z0-9.]{1,12}$/.test(token) ? 'stock' : 'deepcore-launch')

export function HolderMapOpened({ from, children }: { from: 'holders-page' | 'embed'; children: ReactNode }) {
  const { chain = '', token = '' } = useParams()
  useEffect(() => {
    if (chain && token) track('holder-map-opened', { chain, kind: holderKind(token), from })
  }, [chain, token, from])
  return children
}
