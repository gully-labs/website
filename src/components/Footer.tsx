import { Link } from 'react-router'
import { projects } from '../content/projects'
import { navItems, socialLinks } from '../content/site'
import { useContact } from './ContactContext'
import { Wordmark } from './Wordmark'

const colLabel = 'font-mono text-[11px] tracking-[1px] text-faint'
const colLink = 'bg-transparent p-0 text-[15px] text-ink-2 transition-colors hover:text-gold'

export function Footer() {
  const { openContact } = useContact()

  return (
    <footer className="flex flex-col gap-12 border-t border-line bg-bg-footer px-page pt-14 pb-8">
      <div className="flex flex-wrap justify-between gap-12">
        <div className="flex max-w-[320px] flex-col gap-3">
          <Wordmark size={28} />
          <span className="text-[15px] leading-[1.55] text-dim">
            A blockchain development company building and releasing Web3 projects.
          </span>
        </div>
        <div className="flex flex-wrap gap-16">
          <nav aria-label="Site" className="flex flex-col items-start gap-3">
            <span className={colLabel}>SITE</span>
            {navItems.map((n) => (
              <Link key={n.label} to={n.to} className={colLink}>
                {n.label}
              </Link>
            ))}
            <button type="button" onClick={() => openContact()} className={colLink}>
              Contact
            </button>
          </nav>
          <nav aria-label="Projects" className="flex flex-col items-start gap-3">
            <span className={colLabel}>PROJECTS</span>
            {projects.map((p) => (
              <Link key={p.slug} to={`/projects/${p.slug}`} className={colLink}>
                {p.name}
              </Link>
            ))}
          </nav>
          <nav aria-label="Social" className="flex flex-col items-start gap-3">
            <span className={colLabel}>SOCIAL</span>
            {socialLinks.map((s) => (
              <a key={s.label} href={s.href} target="_blank" rel="noopener" className={colLink}>
                {s.label}
              </a>
            ))}
          </nav>
        </div>
      </div>
      <div className="flex flex-wrap justify-between gap-4 border-t border-line pt-6 font-mono text-[12px] text-faint">
        <span>© 2026 GULLY LABS</span>
        <button
          type="button"
          onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
          className="bg-transparent p-0 font-mono text-[12px] text-faint transition-colors hover:text-ink"
        >
          BACK TO TOP ↑
        </button>
      </div>
    </footer>
  )
}
