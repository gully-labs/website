import { useEffect } from 'react'
import { Toaster } from 'sonner'
import { CircleAlert, CircleCheck, Info, X } from 'lucide-react'
import { toastHostReady } from './toast'

/* The one toast host, mounted at the app root (main.tsx) on every host: site, developers, admin, docs.
   Unstyled sonner, drawn with the brand tokens: dark surface, gold accent line, mono timestamps.
   Sonner's region is an aria-live="polite" section, so screen readers hear each toast; alt+T moves
   focus to it. Its own motion is CSS transitions, which the global reduced-motion rule softens. */

const base =
  'group pointer-events-auto relative flex w-full font-sans items-start gap-3 overflow-hidden rounded-[10px] border border-line-strong bg-surface py-3 pr-12 pl-4 text-ink shadow-[0_16px_40px_rgba(0,0,0,.5)] before:absolute before:inset-y-0 before:left-0 before:w-[3px] before:bg-gold'

export default function ToastHost() {
  // Children's effects run first, so the Toaster is subscribed by the time this flushes the queue.
  useEffect(() => {
    toastHostReady(true)
    return () => toastHostReady(false)
  }, [])
  return (
    <Toaster
      theme="dark"
      position="bottom-right"
      visibleToasts={3}
      closeButton
      gap={10}
      // Above the back-to-top button (bottom right, 44 px) so the two never overlap.
      offset={{ right: 20, bottom: 76 }}
      mobileOffset={{ right: 16, left: 16, bottom: 72 }}
      containerAriaLabel="Notifications"
      icons={{
        success: <CircleCheck size={18} strokeWidth={2} className="text-green" aria-hidden />,
        error: <CircleAlert size={18} strokeWidth={2} className="text-error" aria-hidden />,
        info: <Info size={18} strokeWidth={2} className="text-gold" aria-hidden />,
        close: <X size={14} aria-hidden />,
      }}
      toastOptions={{
        unstyled: true,
        closeButtonAriaLabel: 'Dismiss notification',
        classNames: {
          toast: base,
          error: 'before:!bg-error',
          success: 'before:!bg-green',
          icon: 'mt-[1px] flex-none',
          content: 'flex min-w-0 flex-col gap-1',
          title: 'text-[14px] font-semibold leading-[1.35]',
          description: 'text-[13px] leading-[1.45] text-muted',
          closeButton:
            '!absolute !top-0 !right-0 !left-auto !inline-flex !size-11 !items-center !justify-center !rounded-btn !border-0 !bg-transparent !text-faint !transform-none hover:!bg-surface-hover hover:!text-ink',
        },
      }}
    />
  )
}
