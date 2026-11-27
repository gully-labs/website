import { Sun } from 'lucide-react'
import { useEffect, useState } from 'react'

/* -------------------------------------------------------------------- theme toggle --- */

/** Dark -> Light -> System, the same control as the server-drawn pages (/landing/fx.js handles the click and saves the
    choice). Shown on the main site only (html.gl-main); 44 px. */
export function ThemeToggle({ className }: { className?: string }) {
  const [word, setWord] = useState('System')
  useEffect(() => {
    const read = () => { const t = document.documentElement.getAttribute('data-theme'); setWord(t === 'dark' ? 'Dark' : t === 'light' ? 'Light' : 'System') }
    read()
    const mo = new MutationObserver(read)
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    return () => mo.disconnect()
  }, [])
  if (typeof document !== 'undefined' && !document.documentElement.classList.contains('gl-main')) return null
  return (
    <button type="button" data-theme-toggle aria-label={`Theme: ${word}. Change theme`} className={className ?? 'inline-flex min-h-11 min-w-11 items-center justify-center gap-1.5 rounded-btn border border-line-strong bg-transparent px-3 text-[13px] font-semibold text-muted hover:text-ink'}>
      <Sun aria-hidden size={16} />
      <span className="max-[1279px]:hidden gid-t">{word}</span>
    </button>
  )
}

