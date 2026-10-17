import { ArrowUpRight } from 'lucide-react'
import { navGroups, navLinks, socialLinks, type NavEntry } from '../content/site'
import { useContact } from './ContactContext'
import { EntryLink } from './LayoutLinks'
import { SocialIcon } from './SocialIcon'
import { Wordmark } from './Wordmark'
import { btnGold } from './ui'

/* The footer: the header's groups as columns (Products, Developers, Company, Social), "Start a
   project", and the legal lines. */

const colLabel = 'm-0 font-mono text-[11px] font-normal tracking-[1px] text-faint uppercase'
const colLink = 'group inline-flex min-h-11 items-center gap-2 bg-transparent p-0 text-left text-[14px] text-ink-2 transition-colors hover:text-gold'
const colIcon = 'flex-none text-faint transition-colors group-hover:text-gold'

function Column({ id, label, items }: { id: string; label: string; items: NavEntry[] }) {
  return (
    <nav aria-labelledby={`foot-${id}`} className="flex min-w-0 flex-col gap-2">
      <h2 id={`foot-${id}`} className={colLabel}>
        {label}
      </h2>
      <ul className="m-0 flex list-none flex-col p-0">
        {items.map((e) => (
          <li key={e.label}>
            <EntryLink e={e} className={colLink}>
              <e.icon aria-hidden size={14} strokeWidth={1.75} className={colIcon} />
              {e.label}
              {e.badge && <span className="font-mono text-[10px] tracking-[.5px] text-gold uppercase">{e.badge}</span>}
            </EntryLink>
          </li>
        ))}
      </ul>
    </nav>
  )
}

export function Footer() {
  const { openContact } = useContact()
  const [products, developers, company] = navGroups
  const [projects, pricing] = navLinks
  // Swap is a section of the stock pages, not a page of its own: the footer lists the tracker once.
  const productItems = [...products.items.filter((e) => e.label !== 'Swap'), pricing]
  const companyItems = [projects, ...company.items]

  return (
    <footer className="flex flex-col gap-10 border-t border-line bg-bg-footer px-page pt-12 pb-20">
      <div className="grid gap-10 min-[1024px]:grid-cols-[minmax(220px,300px)_1fr] min-[1024px]:gap-16">
        <div className="flex flex-col items-start gap-4">
          <Wordmark size={26} />
          <p className="m-0 text-[14px] leading-[1.55] text-dim">A blockchain development company building and releasing Web3 projects.</p>
          <button type="button" onClick={() => openContact()} className={`${btnGold} inline-flex min-h-11 items-center gap-2 px-5 text-[15px]`}>
            Start a project
            <ArrowUpRight aria-hidden size={16} strokeWidth={2} />
          </button>
        </div>
        <div className="grid grid-cols-2 gap-x-6 gap-y-8 min-[700px]:grid-cols-4">
          <Column id="products" label="Products" items={productItems} />
          <Column id="developers" label="Developers" items={developers.items} />
          <Column id="company" label="Company" items={companyItems} />
          <nav aria-labelledby="foot-social" className="flex min-w-0 flex-col gap-2">
            <h2 id="foot-social" className={colLabel}>
              Social
            </h2>
            <ul className="m-0 flex list-none flex-col p-0">
              {socialLinks.map((s) => (
                <li key={s.label}>
                  <a href={s.href} target="_blank" rel="noopener" className={colLink}>
                    <span className={colIcon}>
                      <SocialIcon name={s.label} size={14} />
                    </span>
                    {s.label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        </div>
      </div>
      <div className="flex flex-col gap-2 border-t border-line pt-6 font-mono text-[12px] leading-[1.6] text-faint min-[1024px]:flex-row min-[1024px]:items-start min-[1024px]:justify-between min-[1024px]:gap-8">
        <span className="flex-none">© 2026 GULLY LABS</span>
        <p className="m-0 max-w-[760px] min-[1024px]:text-right">
          Information only, not investment advice. Prices and gaps are read live and can be late or wrong; stock tokens are issued by third parties whose own terms apply, and may not be
          available where you live.
        </p>
      </div>
    </footer>
  )
}
