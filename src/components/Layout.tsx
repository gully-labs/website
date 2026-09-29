import { useCallback, useEffect, useMemo, useState } from 'react'
import { Outlet, useLocation, useNavigationType, useSearchParams } from 'react-router'
import { MotionConfig, motion } from 'motion/react'
import type { ServiceType } from '../content/services'
import { ClosingCta } from './ClosingCta'
import { ContactContext } from './ContactContext'
import { emptyForm, type ContactForm } from './contactForm'
import { ContactModal } from './ContactModal'
import { Footer } from './Footer'
import { Header } from './Header'

const HEADER_OFFSET = 72

/** Scrolls to the top on page change, or smoothly to #hash (minus the sticky header). */
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
        behavior: el ? 'smooth' : 'instant',
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
  const [form, setForm] = useState<ContactForm>(emptyForm)
  const [sent, setSent] = useState(false)

  const openContact = useCallback(
    (preselect?: ServiceType) => {
      if (sent) setForm(emptyForm)
      if (preselect) setForm((f) => ({ ...(sent ? emptyForm : f), types: [preselect] }))
      setSent(false)
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
    <MotionConfig reducedMotion="user">
      <ContactContext.Provider value={api}>
        <div className="min-h-screen overflow-x-clip bg-bg font-sans text-ink [container-type:inline-size]">
          <a
            href="#main"
            className="sr-only z-60 rounded-btn bg-gold px-4 py-2 text-bg focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
          >
            Skip to content
          </a>
          <Header />
          <motion.main
            id="main"
            key={pathname}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.25, ease: 'easeOut' }}
          >
            <Outlet />
          </motion.main>
          <ClosingCta />
          <Footer />
          <ContactModal
            open={open}
            onClose={closeContact}
            form={form}
            setForm={setForm}
            sent={sent}
            setSent={setSent}
          />
        </div>
      </ContactContext.Provider>
    </MotionConfig>
  )
}
