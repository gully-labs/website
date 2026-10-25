import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router'
import { securityPrimary, securityShortPath, SECURITY_URL } from '../site-host'
import { GoTo } from './GoTo'

/* The route elements for Gully Security on its own domain, gullysecurity.xyz (server/hosts.mjs, src/site-host.ts). */

/** A main-site Security page: once gullysecurity.xyz is its home (the server says so; it also answers 301 there), a
    client-side visit leaves for the same page on gullysecurity.xyz. */
export function MainSecurityPage({ children }: { children: ReactNode }) {
  const { pathname, search, hash } = useLocation()
  const short = securityPrimary() ? securityShortPath(pathname) : null
  return short ? <GoTo url={SECURITY_URL + short + search + hash} /> : children
}

/** gullysecurity.xyz: /security/... (the main site's long form) is the short path here. */
export function ToShortSecurityPath() {
  const { pathname, search, hash } = useLocation()
  return <Navigate to={(securityShortPath(pathname) ?? '/') + search + hash} replace />
}
