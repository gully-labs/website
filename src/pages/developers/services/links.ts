import { DOCS_URL, isLocalHost, SITE_URL } from '../../../site-host'
import type { Account } from '../api'

/** A page of the main site: a path on localhost (where every app shares one host), else on gullylabs.xyz. */
export const sitePage = (path: string) => (isLocalHost() ? path : `${SITE_URL}${path}`)
export const docsPage = (slug = '') => `${DOCS_URL}${slug ? `/${slug}` : ''}`

/** What every service page gets from the dashboard. `go` opens another app page (by hash id);
    `createAlert` opens Alerts with the New gap alert dialog, preset to `chain:TICKER` when given. */
export type ServiceCtx = {
  account: Account
  go: (tab: string, section?: string | null) => void
  createAlert: (stock?: string | null) => void
}
