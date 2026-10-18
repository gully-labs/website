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
import { AskLauncher } from './ask/AskLauncher'
import { scrollToAnchor } from '../lib/anchors'
import { prefetchPath } from '../pages/routeChunks'

// The contact modal (and the animation library it uses) loads the first time it is opened, so the
// landing never downloads it.
const ContactModal = lazy(() => import('./ContactModal').then((m) => ({ default: m.ContactModal })))

/** Scrolls to the top on page change, or to #hash (src/lib/anchors.ts: just under the sticky header, held
    there while the layout settles): smoothly, unless the visitor asked for reduced motion. */
function useScrollOnNavigate() {
  const location = useLocation()
  const navType = useNavigationType()

  useEffect(() => {
    if (navType === 'POP' && !location.hash) return
    const id = location.hash.slice(1)
    const timer = setTimeout(() => {
      if (!id || !scrollToAnchor(id, scrollBehavior())) window.scrollTo({ top: 0, behavior: 'instant' })
    }, 20)
    return () => clearTimeout(timer)
  }, [location.key, location.hash, navType])
}

/** Starts loading a page's chunk as soon as a visitor shows intent: pointer over, focus on, or a touch
    on any same-site link. By the click the chunk is usually cached, so the route skeleton barely shows. */
function usePrefetchOnIntent() {
  useEffect(() => {
    const onIntent = (e: Event) => {
      const a = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null
      if (!a || a.target === '_blank') return
      const url = new URL(a.href, window.location.href)
      if (url.origin === window.location.origin) prefetchPath(url.pathname)
    }
    document.addEventListener('pointerover', onIntent, { passive: true })
    document.addEventListener('focusin', onIntent)
    document.addEventListener('touchstart', onIntent, { passive: true })
    return () => {
      document.removeEventListener('pointerover', onIntent)
      document.removeEventListener('focusin', onIntent)
      document.removeEventListener('touchstart', onIntent)
    }
  }, [])
}

export function Layout() {
  const { pathname } = useLocation()
  const [searchParams, setSearchParams] = useSearchParams()
  useScrollOnNavigate()
  usePrefetchOnIntent()

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
          {/* The bottom-right dock: Back to top, then Gully AI (also ⌘K / Ctrl+K). Toasts stack above it (offset
              76 px, 72 px on phones); the site has no cookie bar or bottom bar for it to cover. On /ask the
              chat is the page, so only the shortcut stays. */}
          <div className="pointer-events-none fixed right-5 bottom-5 z-40 flex items-center gap-2 max-[600px]:right-4 max-[600px]:bottom-4 print:hidden" data-testid="corner-dock">
            <BackToTop />
            <AskLauncher variant="floating" hideButton={pathname === '/ask'} />
          </div>
          {everOpened && (
            <Suspense fallback={null}>
              <ContactModal open={open} onClose={closeContact} form={form} setForm={setForm} sent={sent} setSent={setSent} />
            </Suspense>
          )}
        </div>
      </ContactContext.Provider>
  )
}
