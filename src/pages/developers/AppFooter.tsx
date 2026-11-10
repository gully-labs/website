import { BadgeFooterRow } from '../../components/PoweredByBadge'
import { SITE_URL } from '../../site-host'
import { ExtLink } from './ExtLink'

/** The Gully Labs App's footer, the same signed in (AppShell) and signed out (DevelopersPage: the sign-in card beside
    the public Overview, the invite landing, loading and error states). The legal row (Terms, Privacy, Legal on
    gullylabs.xyz, each in a new tab; the pre-rendered shell carries the same three links) and the "Powered by Gully
    Labs" badge row (owner rule 2026-10-26). Before 2026-11-10 only the signed-in shell had the legal row, so a
    signed-out visitor's rendered footer had none of the three links. */
export function AppFooter({ className = '' }: { className?: string }) {
  return (
    <footer className={`border-t border-line px-6 py-4 max-[480px]:px-4 print:hidden ${className}`} data-testid="app-footer">
      <nav aria-label="Legal" className="flex flex-wrap items-center gap-x-4 font-mono text-[12px] text-muted" data-testid="footer-legal">
        <ExtLink href={`${SITE_URL}/terms`} arrow={false} className="inline-flex min-h-11 items-center hover:text-ink">
          Terms
        </ExtLink>
        <ExtLink href={`${SITE_URL}/privacy`} arrow={false} className="inline-flex min-h-11 items-center hover:text-ink">
          Privacy
        </ExtLink>
        <ExtLink href={`${SITE_URL}/legal`} arrow={false} className="inline-flex min-h-11 items-center hover:text-ink">
          Legal
        </ExtLink>
      </nav>
      <BadgeFooterRow />
    </footer>
  )
}
