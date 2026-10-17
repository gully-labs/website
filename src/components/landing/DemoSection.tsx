import { Suspense, useEffect, useRef, useState, type ComponentType, type LazyExoticComponent, type ReactNode } from 'react'
import { Link } from 'react-router'
import { ArrowUpRight } from 'lucide-react'

/* One numbered product section of the landing, with its live demo underneath. The demo's code is a
   lazy chunk, fetched only when the section comes near the viewport; it is unmounted again once the
   section is far away, so a demo's timers never run off-screen. While unmounted (or loading) a
   skeleton keeps the last measured height, so nothing above the reader shifts. */

const NEAR = '400px 0px'
const FAR = '1400px 0px'

/** true once the element is within NEAR of the viewport, false again once it is beyond FAR. */
function useNearViewport(ref: React.RefObject<HTMLElement | null>): boolean {
  // Without IntersectionObserver (very old browsers) every demo simply mounts.
  const [near, setNear] = useState(() => typeof IntersectionObserver === 'undefined')
  useEffect(() => {
    const el = ref.current
    if (!el || typeof IntersectionObserver === 'undefined') return
    const enter = new IntersectionObserver((es) => es.some((e) => e.isIntersecting) && setNear(true), { rootMargin: NEAR })
    const leave = new IntersectionObserver((es) => es.every((e) => !e.isIntersecting) && setNear(false), { rootMargin: FAR })
    enter.observe(el)
    leave.observe(el)
    return () => {
      enter.disconnect()
      leave.disconnect()
    }
  }, [ref])
  return near
}

export interface DemoSectionProps {
  id: string
  n: string
  kicker: string
  title: string
  body: ReactNode
  tags: string[]
  cta: { label: string; to?: string; href?: string; onClick?: () => void }
  alt?: boolean
  /** The demo's height on a wide screen; the skeleton takes it until the demo has been measured. */
  height: number
  Demo: LazyExoticComponent<ComponentType>
}

export function DemoSection({ id, n, kicker, title, body, tags, cta, alt, height, Demo }: DemoSectionProps) {
  const box = useRef<HTMLDivElement>(null)
  const near = useNearViewport(box)
  const [measured, setMeasured] = useState<number | null>(null)

  // Remember the demo's real height while it is mounted, for the skeleton that stands in for it later.
  useEffect(() => {
    const el = box.current
    if (!el || !near || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => {
      const h = el.firstElementChild?.getBoundingClientRect().height
      if (h && h > 80) setMeasured(Math.round(h))
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [near])

  const skeleton = (
    <div
      aria-hidden
      className="animate-pulse rounded-card border border-line bg-surface"
      style={{ height: measured ?? height, maxHeight: measured ? undefined : 'calc(100vh + 400px)' }}
    />
  )
  const ctaCls = 'inline-flex min-h-11 items-center gap-2 rounded-btn bg-gold px-4 text-[14px] font-semibold text-bg transition-colors hover:bg-gold-hover hover:text-bg'
  const ctaInner = (
    <>
      {cta.label}
      <ArrowUpRight aria-hidden size={15} />
    </>
  )

  return (
    <section id={id} aria-labelledby={`${id}-title`} className={`scroll-mt-20 border-t border-line ${alt ? 'bg-bg-alt' : ''}`}>
      <div className="flex flex-col gap-5 px-page py-12">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="flex min-w-0 flex-[1_1_420px] flex-col gap-[6px]">
            <span className="font-mono text-[11px] tracking-[1.5px] text-gold">
              {n} · {kicker}
            </span>
            <h2 id={`${id}-title`} className="m-0 font-display text-[40px] leading-none font-extrabold uppercase max-[599px]:text-[34px]">
              {title}
            </h2>
            <p className="m-0 max-w-[560px] text-[14px] leading-[1.5] text-muted">{body}</p>
          </div>
          <div className="flex flex-[0_1_auto] flex-col items-start gap-2">
            <span className="flex flex-wrap gap-[6px]">
              {tags.map((t) => (
                <span key={t} className="rounded-full border border-line-strong px-[9px] py-[3px] text-[12px] text-ink-2">
                  {t}
                </span>
              ))}
            </span>
            {cta.to ? (
              <Link to={cta.to} className={ctaCls}>
                {ctaInner}
              </Link>
            ) : cta.href ? (
              <a href={cta.href} className={ctaCls}>
                {ctaInner}
              </a>
            ) : (
              <button type="button" onClick={cta.onClick} className={ctaCls}>
                {ctaInner}
              </button>
            )}
          </div>
        </div>
        <div ref={box} className="min-w-0">
          {near ? (
            <Suspense fallback={skeleton}>
              <Demo />
            </Suspense>
          ) : (
            skeleton
          )}
        </div>
      </div>
    </section>
  )
}
