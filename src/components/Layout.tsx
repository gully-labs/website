import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { Outlet, useLocation, useNavigationType, useSearchParams } from 'react-router'
import type { ServiceType } from '../content/services'
import { ClosingCta } from './ClosingCta'
import { ContactContext } from './ContactContext'
import { emptyForm, type ContactForm } from './contactForm'
import { Footer } from './Footer'
import { Header } from './Header'
import { scrollBehavior } from './LayoutNav'
import { BackToTop } from './LayoutScroll'

// The contact modal (and the animation library it uses) loads the first time it is opened, so the
// landing never downloads it.
const ContactModal = lazy(() => import('./ContactModal').then((m) => ({ default: m.ContactModal })))

const HEADER_OFFSET = 72

/** Scrolls to the top on page change, or to #hash (minus the sticky header): smoothly, unless the
    visitor asked for reduced motion. */
function useScrollOnNavigate() {
  const location = useLocation()
  const navType = useNavigationType()

  useEffect(() => {
    if (navType === 'POP' && !location.hash) return
    const id = location.hash.slice(1)
    const timer = setTimeout(() => {
      const el = id ? document.getElementById(id) : null
      window.scrollTo({
        top: el ? el.getBoundingClientRect().top + window.scrollY - HEADER_OFFSET : 0,
        behavior: el ? scrollBehavior() : 'instant',
      })
    }, 20)
    return () => clearTimeout(timer)
  }, [location.key, location.hash, navType])
}

export function Layout() {
  const { pathname } = useLocation()
  const [searchParams, setSearchParams] = useSearchParams()
  useScrollOnNavigate()

  // The modal can also be opened with ?contact=1.
  const [open, setOpen] = useState(() => searchParams.get('contact') === '1')
  // Mounted from the first open onwards, so its close animation can still play.
  const [everOpened, setEverOpened] = useState(open)
  const [form, setForm] = useState<ContactForm>(emptyForm)
  const [sent, setSent] = useState(false)

  const openContact = useCallback(
    (preselect?: ServiceType) => {
      if (sent) setForm(emptyForm)
      if (preselect) setForm((f) => ({ ...(sent ? emptyForm : f), types: [preselect] }))
      setSent(false)
      setEverOpened(true)
      setOpen(true)
    },
    [sent],
  )

  const closeContact = useCallback(() => {
    setOpen(false)
    if (searchParams.has('contact')) {
      searchParams.delete('contact')
      setSearchParams(searchParams, { replace: true })
    }
  }, [searchParams, setSearchParams])

  const api = useMemo(() => ({ openContact }), [openContact])

  return (
    <ContactContext.Provider value={api}>
        <div className="min-h-screen overflow-x-clip bg-bg font-sans text-ink [container-type:inline-size]">
          <a
            href="#main"
            className="sr-only z-60 rounded-btn bg-gold px-4 py-2 text-bg focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
          >
            Skip to content
          </a>
          <Header />
          <main id="main" key={pathname} tabIndex={-1} className="animate-[gl-fade_.25s_ease-out_both] outline-none">
            <Outlet />
          </main>
          <ClosingCta />
          <Footer />
          <BackToTop />
          {everOpened && (
            <Suspense fallback={null}>
              <ContactModal open={open} onClose={closeContact} form={form} setForm={setForm} sent={sent} setSent={setSent} />
            </Suspense>
          )}
        </div>
      </ContactContext.Provider>
  )
}
