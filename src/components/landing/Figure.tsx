import { useEffect, useRef, useState } from 'react'
import NumberFlow, { type Format } from '@number-flow/react'
import { fmtUsd } from '../../lib/stats'

/* A dollar figure that counts up from zero the first time it is on screen, then rolls to each new
   value on a refresh (NumberFlow, MIT). The format follows fmtUsd: $429.43, $6,599, $26.3K, $1.2M,
   $1.23B. NumberFlow honours prefers-reduced-motion by itself (the number simply changes). Screen
   readers get the final figure once, as text. */

function formatOf(v: number): Format {
  const a = Math.abs(v)
  const usd = { style: 'currency', currency: 'USD' } as const
  if (a >= 1e9) return { ...usd, notation: 'compact', minimumFractionDigits: 2, maximumFractionDigits: 2 }
  if (a >= 1e4) return { ...usd, notation: 'compact', minimumFractionDigits: 1, maximumFractionDigits: 1 }
  if (a >= 1e3) return { ...usd, maximumFractionDigits: 0 }
  return { ...usd, minimumFractionDigits: 2, maximumFractionDigits: 2 }
}

export function Figure({ value }: { value: number }) {
  const el = useRef<HTMLSpanElement>(null)
  const [seen, setSeen] = useState(() => typeof IntersectionObserver === 'undefined')
  useEffect(() => {
    const node = el.current
    if (seen || !node) return
    const io = new IntersectionObserver((es) => es.some((e) => e.isIntersecting) && setSeen(true), { threshold: 0.4 })
    io.observe(node)
    return () => io.disconnect()
  }, [seen])
  return (
    <span ref={el} className="inline-block">
      <span aria-hidden>
        <NumberFlow value={seen ? value : 0} format={formatOf(value)} locales="en-US" willChange />
      </span>
      <span className="sr-only">{fmtUsd(value)}</span>
    </span>
  )
}
