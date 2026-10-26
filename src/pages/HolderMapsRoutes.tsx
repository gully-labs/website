import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router'
import { HolderMapOpened } from '../lib/routeEvents'
import { holderInternalPath, holderMapsPrimary, holderShortPath, HOLDERMAPS_URL } from '../site-host'
import { GoTo } from './GoTo'
import { HmNotFoundRoute, HmTokenRoute } from './LazyRoutes'

/* The route elements for the Holder Map on its own domain, holdermaps.xyz (server/hosts.mjs, src/site-host.ts). */

/** A main-site Holder Map page: once holdermaps.xyz is its home (the server says so; it also answers 301 there), a
    client-side visit leaves for the same page on holdermaps.xyz. */
export function MainHolderPage({ children }: { children: ReactNode }) {
  const { pathname, search, hash } = useLocation()
  const short = holderMapsPrimary() ? holderShortPath(pathname) : null
  return short ? <GoTo url={HOLDERMAPS_URL + short + search + hash} /> : children
}

/** holdermaps.xyz: /holders/... (the main site's long form) is the short path here. */
export function ToShortHolderPath() {
  const { pathname, search, hash } = useLocation()
  return <Navigate to={(holderShortPath(pathname) ?? '/') + search + hash} replace />
}

/** holdermaps.xyz/<chain>/<token>: HolderMaps' token page when the chain is one the Holder Map covers, else its 404
    (the server answers such a path 404 too; a path that is a gullylabs.xyz page never reaches the app here, the server
    301s it there). */
export function HolderMapsTokenPage() {
  const { pathname } = useLocation()
  return holderInternalPath(pathname) ? (
    <HolderMapOpened from="holders-page">
      <HmTokenRoute />
    </HolderMapOpened>
  ) : (
    <HmNotFoundRoute />
  )
}
