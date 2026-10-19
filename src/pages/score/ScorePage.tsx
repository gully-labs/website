import { ArrowLeft, BadgeCheck, CalendarClock, CircleSlash, Code2, Copy, GitBranch, History, KeyRound, ListChecks, Lock, Scale, ShieldCheck, Timer, Users, type LucideIcon } from 'lucide-react'
import { useEffect } from 'react'
import { Link, useParams } from 'react-router'
import { NewTabMark } from '../../components/LayoutLinks'
import { newTab } from '../../components/LayoutNav'
import { TokenLogo } from '../../components/logos/TokenLogo'
import { Seo } from '../../components/Seo'
import { copyWithToast } from '../../components/ui/toast'
import { eyebrow, h1 } from '../../components/ui'
import { DOCS_URL } from '../../site-host'
import { track } from '../../lib/track'
import { fmtDate, partColor, shortAddr, sourceWords, useJson, type ScoreComponent, type ScoreResult } from './api'
import { ComponentBars, ScoreHistory, ScoreRing } from './charts'

/* One contract's Gully Score: every component with its weight, points, plain reason, source and evidence links,
   the score's history and change log, the badge and widget to embed, and the methodology. All of it is read
   from GET /api/score/:chain/:address; nothing here is typed in. */

const card = 'flex min-w-0 flex-col gap-4 rounded-card border border-line bg-surface p-6 max-[600px]:p-4'
const cardTitle = 'm-0 flex items-center gap-2 font-display text-[22px] leading-none font-bold uppercase'
const rise = (i: number) => ({ animation: `gl-rise .5s ${i * 0.06}s ease both` })
const ICONS: Record<string, LucideIcon> = { verified: BadgeCheck, control: KeyRound, timelock: Timer, upgradeability: GitBranch, changes: History, liquidity: Lock, holders: Users, review: ShieldCheck, age: CalendarClock }
const SITE = 'https://gullylabs.xyz'

function Component({ c, i }: { c: ScoreComponent; i: number }) {
  const Icon = ICONS[c.id] ?? Scale
  return (
    <li className="flex min-w-0 flex-col gap-2 border-t border-line py-4 first:border-t-0 first:pt-0" style={rise(i)}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Icon aria-hidden size={17} className={c.available ? 'text-gold' : 'text-faint'} />
        <span className="text-[15px] font-semibold text-ink">{c.label}</span>
        <span className="font-mono text-[11px] text-faint">WEIGHT {c.weight}</span>
        <span className="ml-auto flex items-center gap-2">
          <span className="font-mono text-[12px] text-ink-2">{c.value}</span>
          {c.available ? (
            <span className="rounded-full border px-2 py-[2px] font-mono text-[12px]" style={{ color: partColor(c.score), borderColor: partColor(c.score) }}>
              {c.score}/100
            </span>
          ) : null}
        </span>
      </div>
      <p className="m-0 text-[14px] leading-[1.55] text-muted">{c.reason}</p>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[11px] text-faint">
        <span title={`Exact source: ${c.source}`} className="cursor-help underline decoration-dotted underline-offset-4">
          {sourceWords(c)}
        </span>
        {c.evidence.map((e) => (
          <a key={e.url} href={e.url} {...newTab} className="inline-flex items-center gap-1 text-gold underline-offset-4 hover:underline">
            {e.label}
            <NewTabMark size={11} className="flex-none text-gold" />
          </a>
        ))}
      </div>
    </li>
  )
}

/** The parts that could not be read, in one line instead of a row each. */
function Unavailable({ parts }: { parts: ScoreComponent[] }) {
  if (!parts.length) return null
  return (
    <li className="flex min-w-0 items-start gap-3 border-t border-line pt-4 text-[14px] leading-[1.55] text-muted" title={parts.map((p) => `${p.label}: ${p.reason}`).join(' · ')}>
      <CircleSlash aria-hidden size={17} className="mt-[2px] flex-none text-faint" />
      <span>
        <b className="font-semibold text-ink-2">Not counted, no data to read:</b> {parts.map((p) => p.label).join(', ')}. Left out of the score, never counted as zero.
      </span>
    </li>
  )
}

function Snippet({ label, code }: { label: string; code: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <span className="flex items-center justify-between gap-2 font-mono text-[11px] tracking-[1px] text-faint">
        {label}
        <button type="button" onClick={() => void copyWithToast(code, label)} className="inline-flex min-h-11 items-center gap-2 rounded-btn border border-line-strong px-3 text-[12px] text-ink-2 hover:border-gold hover:text-ink min-[860px]:min-h-8">
          <Copy aria-hidden size={13} /> Copy
        </button>
      </span>
      <pre className="m-0 overflow-x-auto rounded-[8px] border border-line bg-surface-deep p-3 font-mono text-[12px] leading-[1.6] whitespace-pre text-ink-2">{code}</pre>
    </div>
  )
}

export function ScorePage() {
  const { chain = '', address = '' } = useParams()
  const addr = address.toLowerCase()
  const valid = /^[a-z]+$/.test(chain) && /^0x[0-9a-f]{40}$/.test(addr)
  const [s, retry] = useJson<ScoreResult>(valid ? `/api/score/${chain}/${addr}` : null, 60_000)
  // Once per contract opened (the chain only: the address is never sent).
  useEffect(() => {
    if (valid) track('score-viewed', { chain })
  }, [valid, chain, addr])
  const r = s.state === 'ok' ? s.data : null
  const title = r ? `${r.name ?? shortAddr(r.address)}${r.symbol ? ` (${r.symbol})` : ''}` : shortAddr(addr || '0x0000000000')
  const page = `${SITE}/score/${chain}/${addr}`
  const badge = `<a href="${page}" target="_blank" rel="noopener noreferrer"><img src="${page}/badge.svg" alt="Gully Score" width="260" height="48"></a>`
  const widget = `<div data-gully-score data-chain="${chain}" data-address="${addr}"></div>\n<script src="${SITE}/widget.js" async></script>`

  if (!valid)
    return (
      <section className="px-page pt-[72px] pb-24">
        <Seo title="Gully Score" description="That is not a contract address." noindex />
        <p className="text-muted">That is not a chain and contract address. Scores live at /score/&lt;chain&gt;/&lt;0x address&gt;.</p>
        <Link to="/score" className="text-gold underline underline-offset-4">
          All scores
        </Link>
      </section>
    )

  return (
    <>
      <Seo title={r ? `${title} Gully Score on ${r.chainName}` : 'Gully Score'} description={r ? `${title} on ${r.chainName} scores ${r.score ?? 'N/A'} on the Gully Score, from public evidence only.` : 'A contract’s Gully Score, from public evidence only.'} noindex={!!r && !r.listed} />
      <section className="relative overflow-clip px-page pt-[56px] pb-10 max-[600px]:pt-8">
        <div aria-hidden className="pointer-events-none absolute -top-40 right-[-10%] size-[620px] animate-glow rounded-full bg-[radial-gradient(circle,rgba(217,181,99,.12),transparent_62%)]" />
        <div className="relative flex flex-col gap-6">
          <Link to="/score" className="inline-flex min-h-11 w-fit items-center gap-2 font-mono text-[12px] text-dim hover:text-ink" style={rise(0)}>
            <ArrowLeft aria-hidden size={14} /> All scores
          </Link>
          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-8 max-[860px]:grid-cols-1">
            <div className="flex min-w-0 flex-col gap-4">
              <span className={eyebrow} style={rise(1)}>
                GULLY SCORE · {(r?.chainName ?? chain).toUpperCase()}
              </span>
              <h1 className={`${h1} flex items-center gap-4 break-words`} style={rise(2)}>
                {r && <TokenLogo symbol={r.symbol ?? title} chain={r.chainKey} address={r.address} size={40} decorative />}
                <span className="min-w-0">{title}</span>
              </h1>
              <div className="flex flex-wrap items-center gap-3 font-mono text-[12px] text-ink-2" style={rise(3)}>
                <code title={addr} className="break-all">
                  {addr}
                </code>
                <button type="button" onClick={() => void copyWithToast(addr, 'Address')} aria-label="Copy the address" className="inline-flex size-11 items-center justify-center rounded-btn border border-line-strong text-muted hover:border-gold hover:text-gold min-[860px]:size-8">
                  <Copy aria-hidden size={13} />
                </button>
                {r?.links.explorer && (
                  <a href={r.links.explorer} {...newTab} className="inline-flex min-h-11 items-center gap-1 text-gold underline-offset-4 hover:underline">
                    Explorer <NewTabMark size={12} className="flex-none text-gold" />
                  </a>
                )}
              </div>
              {s.state === 'loading' && <p className="m-0 text-[15px] text-muted">Reading the contract and its public records. A first score takes a few seconds.</p>}
              {s.state === 'error' && (
                <p role="alert" className="m-0 flex flex-wrap items-center gap-3 text-[15px] text-error">
                  {s.error}
                  <button type="button" onClick={retry} className="inline-flex min-h-11 items-center font-mono text-[12px] text-ink-2 underline underline-offset-4">
                    Retry
                  </button>
                </p>
              )}
              {r && (
                <p className="m-0 max-w-[640px] text-[16px] leading-[1.6] text-muted" style={rise(4)}>
                  {r.score === null
                    ? `Only ${r.coverage.weight} of the 100 weight points could be read, below the ${r.methodology.minCoverage} needed for a score. Each part below says what is missing and why.`
                    : `Scored from ${r.coverage.components} of ${r.coverage.of} components, covering ${r.coverage.weight} of the 100 weight points. Parts that could not be read are shown and left out, never counted as zero.`}{' '}
                  Read on {fmtDate(r.computedAt)}
                  {r.stale ? ' (an older reading; a fresh one is on its way)' : ''}.
                </p>
              )}
            </div>
            <div className="flex w-[260px] justify-center max-[860px]:w-full">{r ? <ScoreRing score={r.score} grade={r.grade} /> : <ScoreRing score={null} grade={null} />}</div>
          </div>
        </div>
      </section>

      {r && (
        <div className="grid grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] items-start gap-6 px-page pb-24 max-[1100px]:grid-cols-1">
          <section className={card} aria-labelledby="parts" style={rise(5)}>
            <h2 id="parts" className={cardTitle}>
              <ListChecks aria-hidden size={20} className="text-gold" /> What goes into it
            </h2>
            <ol className="m-0 flex list-none flex-col p-0">
              {r.components.filter((c) => c.available).map((c, i) => (
                <Component key={c.id} c={c} i={i} />
              ))}
              <Unavailable parts={r.components.filter((c) => !c.available)} />
            </ol>
          </section>

          <div className="flex min-w-0 flex-col gap-6">
            <section className={card} aria-labelledby="points" style={rise(6)}>
              <h2 id="points" className={cardTitle}>
                <Scale aria-hidden size={20} className="text-gold" /> Points per part
              </h2>
              <ComponentBars parts={r.components.filter((c) => c.available)} />
            </section>
            <section className={card} aria-labelledby="history" style={rise(7)}>
              <h2 id="history" className={cardTitle}>
                <History aria-hidden size={20} className="text-gold" /> History
              </h2>
              <ScoreHistory points={r.history} />
              <h3 className="m-0 font-display text-h4 font-bold uppercase">Change log</h3>
              <ul className="m-0 flex max-h-[280px] list-none flex-col gap-3 overflow-y-auto p-0">
                {[...r.changes].reverse().map((c, i) => (
                  <li key={`${c.at}-${c.id}-${i}`} className="flex flex-col gap-1 text-[13px]">
                    <span className="flex flex-wrap items-center gap-2 font-mono text-[11px] text-faint">
                      {fmtDate(c.at)} · {c.label}
                      {c.id && (
                        <span className="text-ink-2">
                          {c.from ?? 'n/a'} → {c.to ?? 'n/a'}
                        </span>
                      )}
                    </span>
                    <span className="text-muted">{c.note}</span>
                  </li>
                ))}
              </ul>
            </section>
            <section className={card} aria-labelledby="embed" style={rise(8)}>
              <h2 id="embed" className={cardTitle}>
                <Code2 aria-hidden size={20} className="text-gold" /> Embed
              </h2>
              <a href={page} {...newTab} className="inline-flex min-h-11 w-fit items-center" aria-label="The Gully Score badge (opens in a new tab)">
                <img src={`/score/${r.chainKey}/${r.address}/badge.svg`} alt={r.score === null ? 'Gully Score: not enough data' : `Gully Score ${r.score}`} width={260} height={48} />
              </a>
              <Snippet label="BADGE" code={badge} />
              <Snippet label="LIVE WIDGET" code={widget} />
            </section>
          </div>

          <section className={`${card} min-[1101px]:col-span-2`} aria-labelledby="method" style={rise(9)}>
            <h2 id="method" className={cardTitle}>
              <ShieldCheck aria-hidden size={20} className="text-gold" /> How it is worked out
            </h2>
            <ul className="m-0 flex list-disc flex-col gap-2 pl-5 text-[14px] leading-[1.6] text-muted">
              {r.methodology.rules.map((x) => (
                <li key={x}>{x}</li>
              ))}
            </ul>
            <a href={`${DOCS_URL}/gully-score`} {...newTab} className="inline-flex min-h-11 w-fit items-center gap-1 text-[14px] text-gold underline-offset-4 hover:underline">
              The full methodology <NewTabMark size={12} className="flex-none text-gold" />
            </a>
          </section>
        </div>
      )}
    </>
  )
}
