/* Owner rule (2026-10-26): every link to another origin (other Gully domains included) opens in a new tab, with
   rel="noopener noreferrer" and "(opens in a new tab)" for screen readers. Same-origin links stay in the same tab.

   Two pieces, so it is automatic everywhere (site, app, docs, admin, pay pages):
   - isExternalHref / externalProps: for components that render links (SmartLink, console Btn, nav items);
   - installExternalLinks(): a safety net over the whole document. Any <a href> to another origin that a component
     rendered without a target gets target="_blank" and rel="noopener noreferrer" set on it, and an accessible
     description pointing at one shared, visually hidden note. It never adds or removes child nodes (React owns
     those), so it cannot disturb rendering. Links with an explicit target (e.g. "_self" for a deliberate same-tab
     hand-off) and download links are left alone. */

const NOTE_ID = 'gl-new-tab-note'

/** True for an http(s) link whose origin differs from this page's. mailto:, tel:, hashes and paths are not external. */
export function isExternalHref(href: string | null | undefined, base = typeof window !== 'undefined' ? window.location.href : 'https://gullylabs.xyz/'): boolean {
  if (!href || !/^https?:\/\//i.test(href)) return false
  try {
    return new URL(href).origin !== new URL(base).origin
  } catch {
    return false
  }
}

/** Props for an <a> to `href`: a new tab and no opener when it leaves this origin, nothing otherwise. */
export function externalProps(href: string | null | undefined): { target?: '_blank'; rel?: string } {
  return isExternalHref(href) ? { target: '_blank', rel: 'noopener noreferrer' } : {}
}

function ensureNote() {
  if (document.getElementById(NOTE_ID)) return
  const n = document.createElement('span')
  n.id = NOTE_ID
  n.textContent = '(opens in a new tab)'
  n.setAttribute('style', 'position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap')
  document.body.appendChild(n)
}

function fix(a: HTMLAnchorElement) {
  if (a.hasAttribute('target') && a.target !== '_blank') return
  if (a.hasAttribute('download') || !isExternalHref(a.getAttribute('href'))) return
  if (!a.target) a.target = '_blank'
  const rel = new Set((a.rel || '').split(/\s+/).filter(Boolean))
  if (!rel.has('noopener') || !rel.has('noreferrer')) {
    rel.add('noopener')
    rel.add('noreferrer')
    a.rel = [...rel].join(' ')
  }
  // Screen readers: say it opens a new tab unless the link already does (its own text, label or hidden span).
  const said = /new tab/i.test(`${a.getAttribute('aria-label') ?? ''} ${a.textContent ?? ''}`)
  if (!said && !a.hasAttribute('aria-describedby')) a.setAttribute('aria-describedby', NOTE_ID)
}

function scan(root: ParentNode) {
  root.querySelectorAll?.('a[href]').forEach((a) => fix(a as HTMLAnchorElement))
}

let installed = false
/** Watches the document and applies the rule to every external link, now and as pages render. */
export function installExternalLinks() {
  if (installed || typeof document === 'undefined' || typeof MutationObserver === 'undefined') return
  installed = true
  const start = () => {
    ensureNote()
    scan(document)
    new MutationObserver((records) => {
      for (const r of records) {
        if (r.type === 'attributes') {
          if ((r.target as Element).tagName === 'A') fix(r.target as HTMLAnchorElement)
        } else
          r.addedNodes.forEach((n) => {
            if (n.nodeType !== 1) return
            const el = n as Element
            if (el.tagName === 'A') fix(el as HTMLAnchorElement)
            scan(el)
          })
      }
    }).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['href'] })
  }
  if (document.body) start()
  else document.addEventListener('DOMContentLoaded', start, { once: true })
}
