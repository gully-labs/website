import { useSyncExternalStore } from 'react'
import { INSTALL_DISMISS_KEY, installCardMode, isIosSafari, swEligible } from '../../server/pwa.mjs'

/* The browser half of the PWA: registers the service worker (public rules in server/pwa.mjs), keeps the install prompt
   the browser offers (beforeinstallprompt fires once, early, so it is captured at startup) and watches for a new worker
   that is waiting. The cards in src/components/pwa/PwaCards.tsx read this store. */

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice?: Promise<{ outcome: string }>
}

interface PwaState {
  /** The browser's install prompt, once it offered it. */
  prompt: InstallPromptEvent | null
  /** A new worker is installed and waiting for the page's go-ahead. */
  waiting: ServiceWorker | null
  /** The app was installed during this visit. */
  installed: boolean
  /** Bumped when the stored dismissal changes. */
  dismissals: number
}

let state: PwaState = { prompt: null, waiting: null, installed: false, dismissals: 0 }
const listeners = new Set<() => void>()
const set = (patch: Partial<PwaState>) => {
  state = { ...state, ...patch }
  listeners.forEach((l) => l())
}
const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => listeners.delete(l)
}

export const standalone = () => {
  try {
    return window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true
  } catch {
    return false
  }
}

const readDismissed = () => {
  try {
    return localStorage.getItem(INSTALL_DISMISS_KEY)
  } catch {
    return null
  }
}

/** Remember "not now" for 30 days (the install card's X). */
export function dismissInstall() {
  try {
    localStorage.setItem(INSTALL_DISMISS_KEY, String(Date.now()))
  } catch {
    /* storage blocked: the card still closes for this visit */
  }
  set({ dismissals: state.dismissals + 1, prompt: null })
}

/** Shows the browser's own install dialog. */
export async function promptInstall() {
  const p = state.prompt
  if (!p) return
  set({ prompt: null })
  try {
    await p.prompt()
    const choice = await p.userChoice
    if (choice && choice.outcome === 'dismissed') dismissInstall()
  } catch {
    /* the dialog was already used or closed */
  }
}

let reloading = false
/** Tells the waiting worker to take over, then reloads once when it does. */
export function applyUpdate() {
  const w = state.waiting
  if (!w) return
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading) return
    reloading = true
    window.location.reload()
  })
  w.postMessage({ type: 'SKIP_WAITING' })
}

function watchRegistration(reg: ServiceWorkerRegistration) {
  const waitingNow = () => {
    // A waiting worker while another one controls the page is an update; with no controller it is the first install.
    if (reg.waiting && navigator.serviceWorker.controller) set({ waiting: reg.waiting })
  }
  waitingNow()
  reg.addEventListener('updatefound', () => {
    const w = reg.installing
    w?.addEventListener('statechange', () => {
      if (w.state === 'installed') waitingNow()
    })
  })
  // A page left open for days checks for a new build when it comes back, and hourly.
  const check = () => void reg.update().catch(() => undefined)
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && check())
  window.setInterval(check, 3_600_000)
}

let started = false
/** Called once from main.tsx. */
export function initPwa() {
  if (started || typeof window === 'undefined') return
  started = true
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault()
    set({ prompt: e as InstallPromptEvent })
  })
  window.addEventListener('appinstalled', () => set({ installed: true, prompt: null }))
  // Production builds only (dev has no dist/sw.js), and never on admin, Gully Pay checkouts, the Mini App or the embed.
  if (!import.meta.env.PROD || !('serviceWorker' in navigator) || !swEligible(window.location.hostname, window.location.pathname)) return
  const register = () => navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' }).then(watchRegistration, () => undefined)
  if (document.readyState === 'complete') register()
  else window.addEventListener('load', register, { once: true })
}

export type InstallMode = 'prompt' | 'ios' | null

/** What the install card should show right now. */
export function useInstallMode(): InstallMode {
  const s = useSyncExternalStore(subscribe, () => state)
  void s.dismissals
  if (s.installed) return null
  return installCardMode({
    standalone: standalone(),
    dismissedRaw: readDismissed(),
    hasPrompt: !!s.prompt,
    ios: isIosSafari(navigator.userAgent, navigator.platform, navigator.maxTouchPoints),
  })
}

export const useUpdateReady = () => !!useSyncExternalStore(subscribe, () => state).waiting
