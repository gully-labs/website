import type { ReactNode } from 'react'
import { pillClass, type PillTone } from './pill'

export type { PillTone } from './pill'

/* The kit's one status pill (design audit X4): 22 px tall, mono 11 px, a tinted fill with a hairline
   border in the same colour, and an optional dot that blinks for live states (held still under reduced
   motion by index.css). Not interactive: a pill that does something is a button, not a pill. */

export function StatusPill({ tone = 'neutral', dot = tone === 'live', children, title, className = '' }: { tone?: PillTone; dot?: boolean; children: ReactNode; title?: string; className?: string }) {
  return (
    <span className={`${pillClass(tone)} ${className}`} title={title} data-pill={tone}>
      {dot && <i aria-hidden className="size-[6px] shrink-0 rounded-full bg-current" style={tone === 'live' ? { animation: 'gl-blink 1.6s ease-in-out infinite' } : undefined} />}
      {children}
    </span>
  )
}
