import { createElement, type ReactNode } from 'react'

/* Site-wide toasts. The toast library (sonner) is loaded on the first toast, and its host
   (toast-host.tsx) is mounted once at the app root after the page is idle, so the landing never
   pays for it up front.

   Rules for callers:
   - Toast real moments (a user action finished or failed), never a background poll.
   - Same message, same toast: the id defaults to kind + title, so a repeated action replaces the
     toast on screen instead of stacking a copy. Pass an explicit id for a running story (a payment
     going from detected to confirmed) so each step replaces the last.
   - Keep inline validation in forms; toasts are for outcomes. */

export type ToastKind = 'success' | 'error' | 'info'

export interface ToastOptions {
  /** A second line under the title. */
  detail?: ReactNode
  /** Dedupe key: a toast with the same id replaces the one on screen. */
  id?: string
  /** Milliseconds on screen; errors stay a little longer by default. */
  duration?: number
}

let lib: Promise<typeof import('sonner')> | null = null
/** Loads the toast library (also used by the host, so both share one store). */
export const loadToasts = () => (lib ??= import('sonner'))

// UTC, like every other time on the site.
const clock = () => `${new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false, timeZone: 'UTC' })} UTC`

function body(detail: ReactNode | undefined) {
  return createElement(
    'span',
    { className: 'flex flex-col gap-1' },
    detail ? createElement('span', null, detail) : null,
    createElement('time', { className: 'font-mono text-[11px] tracking-[.5px] text-faint' }, clock()),
  )
}

type Pending = () => void
let hostReady = false
let pending: Pending[] = []
let mountHost: (() => void) | null = null

/** ToastRoot registers how to mount the host early, when a toast is raised before idle. */
export function registerToastMount(fn: (() => void) | null) {
  mountHost = fn
}

/** The host calls this once its Toaster is subscribed: toasts raised before then show now. */
export function toastHostReady(ready: boolean) {
  hostReady = ready
  if (!ready) return
  const queued = pending
  pending = []
  queued.forEach((show) => show())
}

export function notify(kind: ToastKind, title: string, opts: ToastOptions = {}) {
  const id = opts.id ?? `${kind}:${title}`
  const show = () =>
    loadToasts()
      .then(({ toast }) =>
        toast[kind](title, {
          id,
          description: body(opts.detail),
          duration: opts.duration ?? (kind === 'error' ? 7000 : 4000),
        }),
      )
      .catch(() => undefined)
  if (hostReady) return void show()
  pending = [...pending.filter((p) => (p as Pending & { id?: string }).id !== id), Object.assign(show, { id })]
  mountHost?.()
}

export const toastSuccess = (title: string, opts?: ToastOptions) => notify('success', title, opts)
export const toastError = (title: string, opts?: ToastOptions) => notify('error', title, opts)
export const toastInfo = (title: string, opts?: ToastOptions) => notify('info', title, opts)

/**
 * Copies text and says so in a toast ("Address copied"). Resolves true when the copy worked.
 * A failed copy toasts too, so the person knows to select the text by hand.
 */
export async function copyWithToast(text: string, what = 'Text'): Promise<boolean> {
  try {
    if (!navigator.clipboard) throw new Error('no clipboard')
    await navigator.clipboard.writeText(text)
    toastSuccess(`${what} copied`, { id: 'copy' })
    return true
  } catch {
    toastError('Copy failed', { id: 'copy', detail: 'Your browser blocked the clipboard. Select the text and copy it by hand.' })
    return false
  }
}

/** For dashboards that used an inline { ok, text } flash: the same message as a toast. null is a no-op. */
export function flash(m: { ok: boolean; text: string } | null) {
  if (!m) return
  if (m.ok) toastSuccess(m.text)
  else toastError(m.text)
}
