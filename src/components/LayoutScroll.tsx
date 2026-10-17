import { useEffect, useState } from 'react'
import { ArrowUp } from 'lucide-react'
import { useLocation } from 'react-router'
import { scrollBehavior } from './LayoutNav'

/** A round "back to top" button, shown on long pages once you are well down them. */
export function BackToTop() {
  const [show, setShow] = useState(false)
  const { pathname } = useLocation()
  useEffect(() => {
    let frame = 0
    const check = () => {
      frame = 0
      const long = document.documentElement.scrollHeight > window.innerHeight * 2.5
      setShow(long && window.scrollY > window.innerHeight * 1.2)
    }
    const queue = () => {
      if (!frame) frame = requestAnimationFrame(check)
    }
    check()
    window.addEventListener('scroll', queue, { passive: true })
    window.addEventListener('resize', queue)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('scroll', queue)
      window.removeEventListener('resize', queue)
    }
  }, [pathname])

  return (
    <button
      type="button"
      aria-label="Back to top"
      title="Back to top"
      tabIndex={show ? 0 : -1}
      aria-hidden={!show}
      onClick={() => {
        window.scrollTo({ top: 0, behavior: scrollBehavior() })
        // Keyboard users land where they went: the top of the page content.
        document.getElementById('main')?.focus({ preventScroll: true })
      }}
      className={`fixed right-5 bottom-5 z-40 inline-flex size-11 items-center justify-center rounded-full border border-line-strong bg-surface text-ink shadow-[0_10px_28px_rgba(0,0,0,.45)] transition-[opacity,transform,border-color] duration-200 hover:border-gold hover:text-gold max-[600px]:right-4 max-[600px]:bottom-4 ${show ? 'translate-y-0 opacity-100' : 'pointer-events-none translate-y-2 opacity-0'}`}
    >
      <ArrowUp aria-hidden size={18} strokeWidth={2} />
    </button>
  )
}
