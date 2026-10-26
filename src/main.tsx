import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router'
import { MotionConfig } from 'motion/react'
import '@fontsource/barlow-condensed/700.css'
import '@fontsource/barlow-condensed/800.css'
import '@fontsource/hanken-grotesk/400.css'
import '@fontsource/hanken-grotesk/500.css'
import '@fontsource/hanken-grotesk/600.css'
import '@fontsource/ibm-plex-mono/400.css'
import '@fontsource/ibm-plex-mono/500.css'
import '@fontsource/poppins/500.css'
import '@fontsource/poppins/600.css'
import '@fontsource/poppins/700.css'
import './index.css'
import { ToastRoot } from './components/ui/ToastRoot'
import { reloadForNewBuild } from './lib/staleBuild'
import { initPwa } from './pwa/pwa'
import { router } from './router'

// Vite reports a code file that failed to load (usually: deleted by a deploy while this page was open).
window.addEventListener('vite:preloadError', (e) => {
  if (reloadForNewBuild()) e.preventDefault()
})

// The service worker, the install prompt and update detection (src/pwa/pwa.ts).
initPwa()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {/* Every motion component follows the OS reduced-motion setting: transforms dropped, opacity kept. */}
    <MotionConfig reducedMotion="user">
      <RouterProvider router={router} />
      {/* One toast host for every host's app (site, developers, admin, docs). */}
      <ToastRoot />
    </MotionConfig>
  </StrictMode>,
)
