import { lazy, Suspense, useEffect, useState } from 'react'
import { loadToasts, registerToastMount } from './toast'

const ToastHost = lazy(() => loadToasts().then(() => import('./toast-host')))

/** Mounts the toast host once the page is idle, or at once when a toast is raised first. */
export function ToastRoot() {
  const [ready, setReady] = useState(false)
  useEffect(() => {
    const go = () => setReady(true)
    registerToastMount(go)
    // Safari before 18 has no requestIdleCallback.
    const idle = 'requestIdleCallback' in window
    const id = idle ? window.requestIdleCallback(go, { timeout: 3000 }) : window.setTimeout(go, 1500)
    return () => {
      registerToastMount(null)
      if (idle) window.cancelIdleCallback(id)
      else clearTimeout(id)
    }
  }, [])
  return ready ? (
    <Suspense fallback={null}>
      <ToastHost />
    </Suspense>
  ) : null
}
