import { useEffect, useRef, useState } from 'react'

/* Solana Pay: every quote on Solana carries a unique reference key, and a wallet paying from the QR code
   adds it to the transfer. This watches for it (GET /api/solana/pay/find, every few seconds while the
   quote can still be paid) and hands the first signature it sees to the page's usual check, so a phone
   payment confirms without pasting anything. Small and dependency-free. */

export function SolanaReferenceWatch({ quoteId, reference, active, onFound }: { quoteId: string; reference: string | null | undefined; active: boolean; onFound: (signature: string) => void }) {
  const [state, setState] = useState<'watching' | 'error' | 'found'>('watching')
  const seen = useRef(new Set<string>())
  const found = useRef(onFound)
  useEffect(() => {
    found.current = onFound
  }, [onFound])

  useEffect(() => {
    if (!active || !reference) return
    let live = true
    let timer: ReturnType<typeof setTimeout> | undefined
    const tick = async () => {
      try {
        const r = await fetch(`/api/solana/pay/find?quote=${encodeURIComponent(quoteId)}`, { cache: 'no-store' })
        const j = (await r.json().catch(() => null)) as { signatures?: { signature: string }[] } | null
        if (!live) return
        if (!r.ok || !j) setState('error')
        else {
          const fresh = (j.signatures ?? []).map((s) => s.signature).find((s) => !seen.current.has(s))
          if (fresh) {
            seen.current.add(fresh)
            setState('found')
            found.current(fresh)
            return
          }
          setState('watching')
        }
      } catch {
        if (live) setState('error')
      }
      if (live) timer = setTimeout(tick, 5_000)
    }
    timer = setTimeout(tick, 1_500)
    return () => {
      live = false
      clearTimeout(timer)
    }
  }, [quoteId, reference, active])

  if (!reference) return null
  return (
    <p className="m-0 inline-flex flex-wrap items-center gap-2 font-mono text-[11.5px] leading-[1.5] text-faint" role="status" aria-live="polite">
      <span className="relative inline-flex size-2">
        {active && state === 'watching' && <span className="absolute inline-flex size-full animate-ping rounded-full bg-gold opacity-60" />}
        <span className={`relative inline-flex size-2 rounded-full ${state === 'error' ? 'bg-error' : state === 'found' ? 'bg-green' : 'bg-gold'}`} />
      </span>
      {state === 'found'
        ? 'Payment seen on Solana: checking it now.'
        : state === 'error'
          ? 'Solana could not be read just now; still watching.'
          : active
            ? `Watching Solana for this payment (Solana Pay reference ${reference.slice(0, 4)}…${reference.slice(-4)}).`
            : 'Paused while a payment is being checked.'}
    </p>
  )
}
