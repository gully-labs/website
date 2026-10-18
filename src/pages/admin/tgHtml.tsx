import { Fragment, type ReactNode } from 'react'
import { NewTabNote } from './newTab'

/* Telegram HTML (the sanitized subset the server sends: b, i, u, s, a, code, pre, blockquote, tg-spoiler) as React
   elements for the admin previews (channel posts, bot broadcasts). Never innerHTML. */

export const LINK_BLUE = '#5aa9e6' // chart palette blue: Telegram-style links in the preview

const decode = (s: string) =>
  s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, '&')

/** Renders sanitized Telegram HTML (b, i, u, s, a, code, pre, blockquote, tg-spoiler) as React nodes. */
export function renderTg(html: string): ReactNode[] {
  type Node = { tag: string; href?: string; kids: ReactNode[] }
  const root: Node = { tag: 'root', kids: [] }
  const stack: Node[] = [root]
  let key = 0
  for (const part of html.split(/(<\/?[a-z-]+(?:\s+href="[^"]*")?>)/)) {
    if (!part) continue
    const open = part.match(/^<([a-z-]+)(?:\s+href="([^"]*)")?>$/)
    const close = part.match(/^<\/([a-z-]+)>$/)
    if (open) {
      const n: Node = { tag: open[1], href: open[2] ? decode(open[2]) : undefined, kids: [] }
      stack.push(n)
    } else if (close && stack.length > 1) {
      const n = stack.pop()!
      const k = key++
      const kids = n.kids
      const el =
        n.tag === 'b' ? <strong key={k}>{kids}</strong>
        : n.tag === 'i' ? <em key={k}>{kids}</em>
        : n.tag === 'u' ? <u key={k}>{kids}</u>
        : n.tag === 's' ? <s key={k}>{kids}</s>
        : n.tag === 'code' ? <code key={k} className="rounded-[3px] bg-bg px-1 font-mono text-[13px]">{kids}</code>
        : n.tag === 'pre' ? <pre key={k} className="m-0 my-1 overflow-x-auto rounded-input bg-bg p-2 font-mono text-[13px] whitespace-pre-wrap">{kids}</pre>
        : n.tag === 'blockquote' ? <blockquote key={k} className="m-0 my-1 border-l-2 pl-2" style={{ borderColor: LINK_BLUE }}>{kids}</blockquote>
        : n.tag === 'tg-spoiler' ? <span key={k} className="rounded-[3px] bg-line-strong text-transparent transition-colors hover:text-ink" title="Spoiler">{kids}</span>
        : n.tag === 'a' ? <a key={k} href={n.href} target="_blank" rel="noopener noreferrer" style={{ color: LINK_BLUE }} className="underline-offset-2 hover:underline">{kids}<NewTabNote /></a>
        : <Fragment key={k}>{kids}</Fragment>
      stack.at(-1)!.kids.push(el)
    } else stack.at(-1)!.kids.push(decode(part))
  }
  while (stack.length > 1) {
    const n = stack.pop()!
    stack.at(-1)!.kids.push(<Fragment key={key++}>{n.kids}</Fragment>)
  }
  return root.kids
}
