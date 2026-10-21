import { ArrowUpRight } from 'lucide-react'
import { track } from '../lib/track'
import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { navGroups, navLinks, socialLinks, type NavEntry } from '../content/site'
import { useContact } from './ContactContext'
import { EntryLink, NewTabMark } from './LayoutLinks'
import { newTab } from './LayoutNav'
import { SocialIcon } from './SocialIcon'
import { Wordmark } from './brand'

/* The footer, compact: the brand, one line, "Start a project" and the socials as icons on the left;
   the header's groups as three plain text columns on the right; one legal line underneath.
   Products splits in two from 1024 px. Rows are 44 px taps on phones and tighten from 700 px. */

const colLabel = 'm-0 mb-1 font-mono text-[11px] font-normal tracking-[1px] text-faint uppercase'
const colLink = 'inline-flex min-h-11 min-w-11 items-center gap-[6px] bg-transparent p-0 text-left text-[13px] text-dim transition-colors hover:text-gold min-[700px]:min-h-8'
const legalLink = 'inline-flex min-h-11 min-w-11 items-center hover:text-gold min-[700px]:min-h-8'

function Column({ id, label, items, wide, extra }: { id: string; label: string; items: NavEntry[]; wide?: boolean; extra?: ReactNode }) {
  return (
    <nav aria-labelledby={`foot-${id}`} className={`flex min-w-0 flex-col ${wide ? 'min-[1024px]:col-span-2' : ''}`}>
      {/* A label, not a heading: extra H2s on every page cluttered the outline. */}
      <p id={`foot-${id}`} className={colLabel}>
        {label}
      </p>
      <ul className={`m-0 grid list-none p-0 ${wide ? 'min-[1024px]:grid-flow-col min-[1024px]:grid-cols-2 min-[1024px]:grid-rows-[repeat(5,auto)] min-[1024px]:gap-x-6' : ''}`}>
        {items.map((e) => (
          <li key={e.label}>
            <EntryLink e={e} className={colLink}>
              {e.label}
              {e.badge && <span className="font-mono text-[11px] tracking-[.5px] text-gold uppercase">{e.badge}</span>}
              {e.newTab && <NewTabMark size={11} />}
            </EntryLink>
          </li>
        ))}
        {extra}
      </ul>
    </nav>
  )
}

export function Footer() {
  const { openContact } = useContact()
  const [products, developers, company] = navGroups
  const [projects, pricing, gullyAi] = navLinks
  // Swap is a section of the stock pages, not a page of its own: the footer lists the tracker once.
  const productItems = [...products.items.filter((e) => e.label !== 'Swap' && e.label !== 'All products'), pricing]
  // Contact is the last company entry; the Telegram chat is added right under it.
  const companyItems = [projects, ...company.items]

  return (
    <footer className="border-t border-line bg-bg-footer px-page pt-10 pb-20">
      <div className="grid gap-8 min-[1024px]:grid-cols-[minmax(220px,280px)_1fr] min-[1024px]:gap-16">
        <div className="flex flex-col items-start gap-3">
          <Wordmark height={22} />
          <p className="m-0 max-w-[280px] text-[13px] leading-[1.5] text-dim">A blockchain development company building and releasing Web3 projects.</p>
          <button
            type="button"
            onClick={() => (track('cta-click', { cta: 'start-project', from: 'footer' }), openContact())}
            className="group inline-flex min-h-11 min-w-11 items-center gap-1 bg-transparent p-0 text-[13px] font-medium text-gold transition-colors hover:text-ink min-[700px]:min-h-8"
          >
            Start a project
            <ArrowUpRight aria-hidden size={14} strokeWidth={2} className="transition-transform group-hover:translate-x-[2px] group-hover:-translate-y-[2px]" />
          </button>
          <nav aria-label="Social" className="-ml-[10px] flex flex-wrap items-center">
            {socialLinks.map((s) => (
              <a key={s.label} href={s.href} {...newTab} aria-label={s.name} title={s.name} className="grid size-11 place-items-center rounded-sm text-faint transition-colors hover:text-gold min-[700px]:size-9">
                <SocialIcon name={s.label} size={16} />
              </a>
            ))}
          </nav>
        </div>
        <div className="grid grid-cols-2 gap-x-6 gap-y-6 min-[700px]:grid-cols-3 min-[1024px]:grid-cols-4">
          <Column id="products" label="Products" items={productItems} wide />
          <Column id="developers" label={developers.label} items={[gullyAi, ...developers.items]} />
          <Column
            id="company"
            label="Company"
            items={companyItems}
            extra={
              <li>
                <a href="https://t.me/GullyLabsBot?start=contact" {...newTab} onClick={() => track('cta-click', { cta: 'chat-telegram', from: 'footer' })} className={colLink}>
                  Chat on Telegram
                  <NewTabMark size={11} />
                </a>
              </li>
            }
          />
        </div>
      </div>
      <div className="mt-8 flex flex-col gap-2 border-t border-line pt-4 font-mono text-[11px] leading-[1.6] text-faint min-[1024px]:flex-row min-[1024px]:items-center min-[1024px]:justify-between min-[1024px]:gap-8">
        <span className="flex flex-none flex-wrap items-center gap-x-4">
          <span>© 2026 GULLY LABS</span>
          <nav aria-label="Legal" className="flex flex-wrap gap-x-4">
            <Link to="/legal/terms" className={legalLink}>
              Terms
            </Link>
            <Link to="/legal/privacy" className={legalLink}>
              Privacy
            </Link>
            <Link to="/legal/merchant-terms" className={legalLink}>
              Merchant terms
            </Link>
            <Link to="/legal/scan-terms" className={legalLink}>
              Scan terms
            </Link>
          </nav>
        </span>
        <p className="m-0 max-w-[680px] min-[1024px]:text-right">
          Information only, not investment advice. Prices and gaps are read live and can be late or wrong; stock tokens are issued by third parties whose own terms apply, and may not be
          available where you live.
        </p>
      </div>
    </footer>
  )
}
