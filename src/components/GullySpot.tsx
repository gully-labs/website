import { useEffect, useRef, useState } from 'react'

// One Swoop spot (design/swoop-spots-2026-11-23/SPOT-RULES.md). Off unless /spots/config.js says enabled; allow-list and deny list
// are enforced by the shared kit (public/spots/spot-kit.js, byte-identical copy of gully-ops sites/_shared/spot-kit.js).
// Renders nothing until the kit says this route may carry a spot, so with the flag off the page is unchanged.
type Cfg = { enabled?: boolean; kill?: boolean; allow?: string[]; docsAllow?: string[]; siteAllow?: string[]; promos?: unknown[]; promosUrl?: string; [k: string]: unknown }
type Kit = { init: (c?: Cfg) => number; allowed: (p: string, c: Cfg) => boolean }
declare global {
  interface Window {
    GULLY_SPOTS?: Cfg
    GullySpots?: Kit
  }
}

let loading: Promise<Cfg | null> | null = null
function loadScript(src: string) {
  return new Promise<void>((ok, no) => {
    const s = document.createElement('script')
    s.src = src
    s.async = true
    s.onload = () => ok()
    s.onerror = () => no(new Error(src))
    document.head.appendChild(s)
  })
}
function boot(): Promise<Cfg | null> {
  loading ??= (async () => {
    await loadScript('/spots/config.js')
    const cfg = window.GULLY_SPOTS
    if (!cfg || cfg.enabled !== true || cfg.kill) return null
    const r = await fetch(cfg.promosUrl || '/spots/house-promos.json', { credentials: 'omit' }).then((x) => x.json()).catch(() => ({ promos: [] }))
    cfg.promos = r.promos
    if (!document.querySelector('link[data-spot-css]')) {
      const l = document.createElement('link')
      l.rel = 'stylesheet'
      l.href = '/spots/spot-kit.css'
      l.setAttribute('data-spot-css', '')
      document.head.appendChild(l)
    }
    if (!window.GullySpots) await loadScript('/spots/spot-kit.js')
    return cfg
  })().catch(() => null)
  return loading
}

export function GullySpot({ unit = 'banner', scope = 'site', delay = 0, className }: { unit?: 'banner' | 'text' | 'native'; scope?: 'site' | 'docs'; delay?: number; className?: string }) {
  const [on, setOn] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    let live = true
    let timer: ReturnType<typeof setTimeout> | undefined
    void boot().then((cfg) => {
      if (live && cfg && window.GullySpots?.allowed(location.pathname, { ...cfg, allow: scope === 'docs' ? cfg.docsAllow : cfg.siteAllow })) timer = setTimeout(() => live && setOn(true), delay)
    })
    return () => {
      live = false
      clearTimeout(timer)
    }
  }, [scope, delay])
  useEffect(() => {
    const c = window.GULLY_SPOTS
    if (on && ref.current && c) window.GullySpots?.init({ ...c, allow: scope === 'docs' ? c.docsAllow : c.siteAllow })
  }, [on, scope])
  if (!on) return null
  return <div ref={ref} data-gully-spot="" data-unit={unit} data-h={unit === 'banner' ? 90 : 96} aria-label="Sponsored" className={className} />
}
