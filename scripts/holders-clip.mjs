// Finds elements in `root` whose content is cut off: text truncated by overflow (scrollWidth > clientWidth on a
// clipping element), or a box that sticks out of its clipping ancestor or the viewport.
export function clippedIn(page, root) {
  return page.evaluate((sel) => {
    const out = []
    const r = document.querySelector(sel)
    const vw = document.documentElement.clientWidth
    for (const e of r.querySelectorAll('*')) {
      if (e.closest('canvas, [data-bubble-canvas], .sr-only, [aria-hidden="true"]') || /sr-only/.test(String(e.className)) || !e.offsetParent) continue
      const cs = getComputedStyle(e)
      const name = `${e.tagName.toLowerCase()}${e.className && typeof e.className === 'string' ? '.' + e.className.split(' ').slice(0, 2).join('.') : ''} "${(e.textContent ?? '').trim().slice(0, 24)}"`
      const clipsX = cs.overflowX !== 'visible'
      if (clipsX && e.scrollWidth > e.clientWidth + 1 && e.clientWidth > 0 && !e.matches('input, ol, ul')) out.push(`overflow ${e.scrollWidth}>${e.clientWidth} ${name}`)
      if (cs.textOverflow === 'ellipsis' && e.scrollWidth > e.clientWidth + 1) out.push(`ellipsis ${e.scrollWidth}>${e.clientWidth} ${name}`)
      const b = e.getBoundingClientRect()
      if (b.width > 0 && (b.right > vw + 1 || b.left < -1)) out.push(`outside viewport ${Math.round(b.left)}..${Math.round(b.right)} of ${vw} ${name}`)
      let p = e.parentElement
      while (p && p !== r.parentElement) {
        const pc = getComputedStyle(p)
        if (pc.overflowX !== 'visible' && !p.matches('[data-bubble-canvas]')) {
          const pb = p.getBoundingClientRect()
          if (b.width > 0 && (b.right > pb.right + 1 || b.left < pb.left - 1) && !p.matches('ol, ul, table')) {
            out.push(`cut by ${p.tagName.toLowerCase()} ${Math.round(b.right - pb.right)}px ${name}`)
          }
          break
        }
        p = p.parentElement
      }
    }
    return [...new Set(out)].slice(0, 40)
  }, root)
}
