import { Check, Copy } from 'lucide-react'
import { useMemo, useState } from 'react'
import { copyWithToast } from '../components/ui/toast'
import { track } from '../lib/track'
import { TINT, tint, type Lang } from './tint'

const LABEL: Record<Lang, string> = { json: 'JSON', js: 'JavaScript', html: 'HTML', bash: 'Shell', text: 'Text' }

/** A code block with tinting, a language label, an optional caption and a copy button. */
export function CodeBlock({ code, lang, caption, wrap = false }: { code: string; lang: Lang; caption?: string; wrap?: boolean }) {
  const tokens = useMemo(() => tint(code, lang), [code, lang])
  const [copied, setCopied] = useState(false)
  const copy = () => {
    copyWithToast(code, lang === 'bash' ? 'Command' : 'Snippet').then((ok) => {
      if (!ok) return
      // The widget builder on the main site (/widget) uses this block too: its copies are the snippet event.
      const page = typeof location !== 'undefined' ? location.pathname : ''
      if (page === '/widget') track('widget-snippet-copy', { lang })
      else track('code-copy', { lang, page })
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    })
  }
  return (
    <figure className="m-0 flex min-w-0 flex-col overflow-hidden rounded-panel border border-line bg-surface-deep">
      <div className="flex items-center justify-between gap-3 border-b border-line pr-1 pl-4">
        <span className="truncate font-mono text-[11px] tracking-[1px] text-faint">{caption ?? LABEL[lang]}</span>
        <button
          type="button"
          onClick={copy}
          aria-label={copied ? 'Copied' : 'Copy code'}
          className={`inline-flex min-h-11 shrink-0 items-center gap-[6px] rounded-btn px-3 font-mono text-[11px] transition-colors ${copied ? 'text-green' : 'text-muted hover:bg-surface-hover hover:text-ink'}`}
        >
          {copied ? <Check size={13} aria-hidden /> : <Copy size={13} aria-hidden />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre className={`m-0 overflow-x-auto px-4 py-[14px] font-mono text-[12.5px] leading-[1.65] ${wrap ? 'break-all whitespace-pre-wrap' : ''}`}>
        <code>
          {tokens.map((t, i) => (
            <span key={i} style={{ color: TINT[t.k] }}>
              {t.v}
            </span>
          ))}
        </code>
      </pre>
    </figure>
  )
}
