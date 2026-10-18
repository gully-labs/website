import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { Bot, Loader2 } from 'lucide-react'
import type { CrossToken, DeployerHistory, HealthPartId, HolderHealth, HolderMapOk, LaunchOutcome } from '../../lib/holders'
import { ageText } from '../../lib/tracker'
import { K } from './theme'
import { useCountUp } from './count'

/* The Holder Map's side cards: the explainable health score, the deployer's record, wallets seen in other
   tokens, the live pill and "Explain this map" (Gully AI). Every figure is the server's. */

const LEVEL = {
  good: { text: 'Looks healthy', colour: K.gold },
  mixed: { text: 'Mixed signals', colour: K.pale },
  poor: { text: 'Warning signs', colour: K.warn },
} as const

/** The score as a ring that draws to its value while the figure counts up (a fade under reduced motion). */
export function ScoreRing({ score, level, size = 84 }: { score: number | null; level: HolderHealth['level']; size?: number }) {
  const r = size / 2 - 6
  const c = 2 * Math.PI * r
  const colour = level ? LEVEL[level].colour : K.dim
  const [shown, setShown] = useState(0)
  const counted = useCountUp(score, 1000)
  // Fill on mount: start empty, then animate to the score.
  useEffect(() => {
    const id = requestAnimationFrame(() => setShown(score ?? 0))
    return () => cancelAnimationFrame(id)
  }, [score])
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={score === null ? 'Score not known' : `Score ${score} out of 100`} className="flex-none">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={K.slate} strokeWidth={6} />
      {score !== null && (
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={colour}
          strokeWidth={6}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - (shown || 0) / 100)}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          className="transition-[stroke-dashoffset] duration-1000 ease-out motion-reduce:duration-150"
        />
      )}
      <text x="50%" y="50%" dominantBaseline="central" textAnchor="middle" fill={K.bone} fontFamily="'Barlow Condensed', sans-serif" fontWeight={800} fontSize={size * 0.34}>
        {counted === null ? '—' : Math.round(counted)}
      </text>
    </svg>
  )
}

export function HealthCard({ h, active, onPart, compact = false, children }: { h: HolderHealth; active: HealthPartId | null; onPart: (id: HealthPartId | null, wallets: string[]) => void; compact?: boolean; children?: React.ReactNode }) {
  // The parts fill one after another once the card is on screen (CSS: a plain change under reduced motion).
  const [filled, setFilled] = useState(false)
  const box = useRef<HTMLElement>(null)
  useEffect(() => {
    const el = box.current
    if (!el || filled) return
    const io = new IntersectionObserver((es) => es.some((e) => e.isIntersecting) && setFilled(true), { threshold: 0.15 })
    io.observe(el)
    return () => io.disconnect()
  }, [filled])
  return (
    <section ref={box} aria-label="Launch health score" className="flex flex-col gap-3 rounded-[12px] border border-line-strong p-4" style={{ background: K.night }} data-health>
      <div className="flex items-center gap-3">
        <ScoreRing score={h.score} level={h.level} size={compact ? 92 : 84} />
        <div className="flex min-w-0 flex-col gap-1">
          <span className="font-mono text-[11px] tracking-[1px] text-dim">LAUNCH HEALTH · FREE</span>
          <span className="font-display text-[22px] leading-none font-bold uppercase" style={{ color: h.level ? LEVEL[h.level].colour : K.muted }}>
            {h.level ? LEVEL[h.level].text : 'Not enough to score'}
          </span>
          <span className="text-[13px] leading-[1.45] text-muted">{h.verdict}</span>
        </div>
      </div>
      {children}
      <ul className="m-0 flex list-none flex-col gap-1 p-0" aria-label="What the score is made of">
        {h.parts.map((p, i) => {
          const on = active === p.id
          const max = p.weight
          const pctFill = p.points === null || !max ? 0 : Math.max(0, Math.min(1, p.points / max))
          return (
            <li key={p.id}>
              <button
                type="button"
                aria-pressed={on}
                onClick={() => onPart(on ? null : p.id, p.wallets)}
                className={`flex min-h-11 w-full flex-col gap-1 rounded-[8px] border px-3 py-1.5 text-left transition-colors ${on ? 'border-gold' : 'border-line hover:border-gold'}`}
                data-health-part={p.id}
              >
                <span className="flex w-full items-baseline justify-between gap-2">
                  <span className="text-[13px] font-semibold text-ink">{p.label}</span>
                  <span className="font-mono text-[11px] text-muted">{p.points === null ? 'not known' : `${p.points} / ${p.weight}`}</span>
                </span>
                <span aria-hidden className="block h-[4px] w-full overflow-hidden rounded-full" style={{ background: K.slate }}>
                  <span
                    className="block h-full rounded-full transition-[width] duration-700 ease-out"
                    style={{
                      width: filled ? `${pctFill * 100}%` : '0%',
                      transitionDelay: `${150 + i * 140}ms`,
                      background: pctFill >= 0.66 ? K.gold : pctFill >= 0.33 ? K.pale : K.warn,
                    }}
                  />
                </span>
                {(!compact || on) && (
                  <span className="animate-[gl-fade_.25s_ease_both] text-[12px] leading-[1.45] text-muted">
                    <b className="font-medium text-ink">{p.value}</b> · {p.reason}
                  </span>
                )}
                {p.wallets.length > 0 && <span className="font-mono text-[11px] text-gold">{on ? 'Shown on the map' : `Show ${p.wallets.length} on the map`}</span>}
              </button>
            </li>
          )
        })}
      </ul>
      <span className="font-mono text-[11px] leading-[1.5] text-dim">
        {h.counted} of {h.parts.length} parts known. A part that could not be read is left out of the score, never counted as good or bad.
      </span>
    </section>
  )
}


const OUTCOME: Record<LaunchOutcome, { text: string; colour: string }> = {
  trading: { text: 'Still trading', colour: K.gold },
  'liquidity-pulled': { text: 'Liquidity pulled', colour: K.warn },
  'deployer-sold': { text: 'Deployer sold', colour: K.warn },
  unknown: { text: 'Unknown', colour: K.dim },
}

export function DeployerHistoryCard({ d, now }: { d: DeployerHistory; now: number }) {
  return (
    <section aria-label="The deployer's other launches" className="flex flex-col gap-2 rounded-[12px] border border-line-strong p-4" style={{ background: K.night }} data-deployer-history>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-mono text-[11px] tracking-[1px] text-dim">THE DEPLOYER’S RECORD</span>
        {d.serial && (
          <span className="rounded-full border px-2 py-[1px] font-mono text-[11px]" style={{ borderColor: K.warn, color: K.warn }}>
            Serial launcher
          </span>
        )}
      </div>
      {!d.checked ? (
        <p className="m-0 text-[13px] text-muted">{d.reason ?? 'Not checked yet.'}</p>
      ) : !d.launches.length ? (
        <p className="m-0 text-[13px] text-muted">No other launches by this deployer on DeepCore.</p>
      ) : (
        <>
          <p className="m-0 text-[13px] text-muted">
            {d.total} other launch{d.total === 1 ? '' : 'es'} by this deployer on DeepCore.
          </p>
          <ul className="m-0 flex list-none flex-col gap-1 p-0">
            {d.launches.slice(0, 8).map((l) => (
              <li key={`${l.chainKey}:${l.token}`}>
                <Link to={l.path} className="flex min-h-11 items-center gap-2 rounded-[8px] border border-line px-2 text-[13px] hover:border-gold" title={l.note}>
                  <span className="min-w-0 flex-1 truncate font-semibold text-ink">{l.symbol ?? `${l.token.slice(0, 6)}…${l.token.slice(-4)}`}</span>
                  <span className="flex-none font-mono text-[11px] text-dim">{ageText(l.createdAt, now)}</span>
                  <span
                    className="flex-none rounded-full border px-2 py-[1px] font-mono text-[11px]"
                    style={{
                      borderColor: OUTCOME[l.outcome].colour,
                      color: OUTCOME[l.outcome].colour,
                    }}
                  >
                    {OUTCOME[l.outcome].text}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  )
}

export function CrossTokenCard({ x }: { x: CrossToken }) {
  return (
    <section aria-label="The same wallets in other tokens" className="flex flex-col gap-2 rounded-[12px] border border-line-strong p-4" style={{ background: K.night }} data-cross-token>
      <span className="font-mono text-[11px] tracking-[1px] text-dim">SAME WALLETS ELSEWHERE</span>
      <p className="m-0 text-[13px] leading-[1.5] text-ink">{x.line}</p>
      {x.tokens.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {x.tokens.slice(0, 10).map((t) => (
            <Link key={`${t.chainKey}:${t.token}`} to={t.path} className="inline-flex min-h-11 items-center gap-1 rounded-full border border-line-strong px-3 font-mono text-[12px] text-gold-hover hover:border-gold">
              {t.symbol ?? `${t.token.slice(0, 6)}…`} <span className="text-dim">· {t.wallets}</span>
            </Link>
          ))}
        </div>
      )}
      <span className="font-mono text-[11px] text-dim">
        Checked {x.checkedWallets} wallets of cluster {x.cluster.toUpperCase()}.
      </span>
    </section>
  )
}

export function LivePill({ on, paused, lastAt, gated, now, beat = 0 }: { on: boolean; paused: boolean; lastAt: string | null; gated: boolean; now: number; beat?: number }) {
  if (paused)
    return (
      <span className="inline-flex min-h-8 items-center gap-2 rounded-full border border-line-strong px-3 font-mono text-[11px] text-muted" data-live="paused">
        Live view paused{gated ? ' · Pro keeps it running' : ''}
      </span>
    )
  if (!on) return null
  return (
    <span className="relative inline-flex min-h-8 items-center gap-2 rounded-full border px-3 font-mono text-[11px]" style={{ borderColor: K.gold, color: K.pale }} data-live="on" data-live-beat={beat} aria-live="polite">
      {/* Each live answer with news sends one ring out from the pill (a gold flash on the text under reduced motion). */}
      <span key={`ring-${beat}`} aria-hidden className="pointer-events-none absolute inset-0 animate-[gl-pill-ping_1.1s_ease-out_1_both] rounded-full border" style={{ borderColor: K.gold }} />
      <span className="relative inline-flex size-2" aria-hidden>
        <span className="absolute inset-0 animate-[gl-live-pulse_2s_ease-out_infinite] rounded-full" style={{ background: K.gold }} />
        <span className="relative size-2 rounded-full" style={{ background: K.gold }} />
      </span>
      <span key={`t-${beat}`} className={beat ? 'animate-[gl-count-flash_.9s_ease-out_1]' : undefined}>
        LIVE{lastAt ? ` · ${ageText(lastAt, now)}` : ''}
      </span>
    </span>
  )
}

/** "Explain this map": Gully AI reads this map (server side) and answers in plain English. */
export function AskExplain({ m }: { m: HolderMapOk }) {
  const [s, setS] = useState<
    | { k: 'idle' }
    | { k: 'busy' }
    | {
        k: 'ok'
        answer: string
        citations: { n: number; title: string; url: string }[]
      }
    | { k: 'error'; text: string }
  >({ k: 'idle' })
  const ask = async () => {
    setS({ k: 'busy' })
    const r = await fetch('/api/ask', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-requested-with': 'gully',
        accept: 'application/json',
      },
      body: JSON.stringify({
        question: 'Explain this holder map in plain English.',
        holders: { chain: m.chain.key, token: m.token.address },
      }),
    }).catch(() => null)
    if (!r)
      return setS({
        k: 'error',
        text: 'The server could not be reached. Try again.',
      })
    if (r.status === 503) return setS({ k: 'error', text: 'Gully AI isn’t available right now.' })
    const d = await r.json().catch(() => null)
    if (!r.ok || !d?.answer)
      return setS({
        k: 'error',
        text: d?.error ?? 'Gully AI could not answer just now.',
      })
    setS({
      k: 'ok',
      answer: String(d.answer),
      citations: Array.isArray(d.citations) ? d.citations.filter((c: { url?: string }) => /^https:\/\//.test(String(c.url))).slice(0, 3) : [],
    })
  }
  return (
    <section aria-label="Gully AI" className="flex flex-col gap-2" data-ask>
      <button type="button" onClick={ask} disabled={s.k === 'busy'} className="inline-flex min-h-11 items-center gap-2 self-start rounded-btn border border-gold px-4 font-mono text-[12px] text-gold-hover disabled:opacity-60">
        {s.k === 'busy' ? <Loader2 size={14} aria-hidden className="animate-spin motion-reduce:animate-none" /> : <Bot size={14} aria-hidden />} Explain this map
      </button>
      {s.k === 'error' && (
        <p role="status" className="m-0 text-[13px] text-error">
          {s.text}
        </p>
      )}
      {s.k === 'ok' && (
        <div className="flex flex-col gap-2 rounded-[10px] border border-line px-3 py-2 animate-[gl-fade_.3s_ease_both]" role="status">
          <p className="m-0 text-[14px] leading-[1.6] whitespace-pre-line text-ink">{s.answer.replace(/\*\*([^*]+)\*\*/g, '$1')}</p>
          {s.citations.length > 0 && (
            <ul className="m-0 flex list-none flex-wrap gap-2 p-0 font-mono text-[11px]">
              {s.citations.map((c) => (
                <li key={c.n}>
                  <a href={c.url} target="_blank" rel="noopener noreferrer" className="text-gold hover:underline">
                    [{c.n}] {c.title} ↗
                  </a>
                </li>
              ))}
            </ul>
          )}
          <span className="font-mono text-[11px] text-dim">Gully AI · information only, not advice.</span>
        </div>
      )}
    </section>
  )
}
