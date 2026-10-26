import { ArrowRight, BadgeCheck, CalendarClock, Gauge, GitBranch, History, KeyRound, Lock, Radar, Scale, Search, ShieldCheck, Timer, Users, type LucideIcon } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router'
import { NewTabMark } from '../../components/LayoutLinks'
import { newTab } from '../../components/LayoutNav'
import { TokenLogo } from '../../components/logos/TokenLogo'
import { Seo } from '../../components/Seo'
import { eyebrow, h1 } from '../../components/ui'
import { APP_URL, DOCS_URL } from '../../site-host'
import { bandColor, fmtDate, shortAddr, useJson, type ScoreIndex as Index } from './api'
import { BandBars, WeightsRing } from './charts'

/* /score: every listed Gully Score (a contract a workspace watches and lets be listed, or one with a published
   Gully Security report), a lookup for any other contract, and the methodology in short. All read from
   GET /api/score. */

const card = 'flex min-w-0 flex-col gap-4 rounded-card border border-line bg-surface p-6 max-[600px]:p-4'
const cardTitle = 'm-0 flex items-center gap-2 font-display text-[22px] leading-none font-bold uppercase'
const rise = (i: number) => ({ animation: `gl-rise .5s ${i * 0.06}s ease both` })
const ICONS: Record<string, LucideIcon> = { verified: BadgeCheck, control: KeyRound, timelock: Timer, upgradeability: GitBranch, changes: History, liquidity: Lock, holders: Users, review: ShieldCheck, age: CalendarClock }
const input = 'h-11 min-w-0 rounded-input border border-line-strong bg-bg px-3 text-[15px] text-ink outline-none transition-colors focus:border-gold'

export function ScoreIndex() {
  const [s, retry] = useJson<Index>('/api/score', 60_000)
  const navigate = useNavigate()
  const [chain, setChain] = useState('base')
  const [addr, setAddr] = useState('')
  const [bad, setBad] = useState(false)
  const data = s.state === 'ok' ? s.data : null

  const lookup = (e: FormEvent) => {
    e.preventDefault()
    const a = addr.trim().toLowerCase()
    if (!/^0x[0-9a-f]{40}$/.test(a)) return setBad(true)
    setBad(false)
    navigate(`/score/${chain}/${a}`)
  }

  return (
    <>
      <Seo title="Gully Score" description="Transparent contract scores from public evidence only: verified code, who controls it, upgrades, delays, recent privileged changes, locks and holders. Nobody can pay to change a score." />
      <section className="relative overflow-clip px-page pt-[72px] pb-12 max-[600px]:pt-10">
        <div aria-hidden className="pointer-events-none absolute -top-40 right-[-10%] size-[620px] animate-glow rounded-full bg-[radial-gradient(circle,rgba(0,210,255,.12),transparent_62%)]" />
        <div className="relative flex max-w-[900px] flex-col gap-6">
          <span className={`${eyebrow} flex items-center gap-2`} style={rise(0)}>
            <Gauge aria-hidden size={15} /> SECURITY · GULLY SCORE
          </span>
          <h1 className={h1} style={rise(1)}>
            Scores you can <span className="text-gold">check</span>
          </h1>
          <p className="m-0 max-w-[700px] text-[18px] leading-[1.6] text-muted" style={rise(2)}>
            A 0 to 100 reading of how a contract is controlled and how it has behaved. Every part is shown with its weight, its source and a link to the evidence. Missing data is left out, never counted as zero, and nobody can pay to change a score.
          </p>
          <form onSubmit={lookup} className="flex flex-wrap items-center gap-2" style={rise(3)} aria-label="Look up a contract">
            <label className="sr-only" htmlFor="score-chain">
              Chain
            </label>
            <select id="score-chain" value={chain} onChange={(e) => setChain(e.target.value)} className={`${input} w-[160px]`}>
              {(data?.chains ?? [{ key: 'base', name: 'Base', id: 8453 }]).map((c) => (
                <option key={c.key} value={c.key}>
                  {c.name}
                </option>
              ))}
            </select>
            <label className="sr-only" htmlFor="score-address">
              Contract address
            </label>
            <input id="score-address" value={addr} onChange={(e) => setAddr(e.target.value)} placeholder="0x… contract address" spellCheck={false} autoComplete="off" className={`${input} flex-1 basis-[280px] font-mono text-[13px]`} aria-invalid={bad} aria-describedby={bad ? 'score-bad' : undefined} />
            <button type="submit" className="inline-flex min-h-11 items-center gap-2 rounded-btn bg-gold px-5 font-semibold text-bg hover:bg-gold-hover">
              <Search aria-hidden size={16} /> Score it
            </button>
          </form>
          {bad && (
            <p id="score-bad" role="alert" className="m-0 text-[14px] text-error">
              Paste a contract address: 0x followed by 40 letters and digits.
            </p>
          )}
        </div>
      </section>

      <div className="grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] items-start gap-6 px-page pb-24 max-[1100px]:grid-cols-1">
        <section className={card} aria-labelledby="listed" style={rise(4)}>
          <h2 id="listed" className={cardTitle}>
            <Radar aria-hidden size={20} className="text-gold" /> Listed scores
          </h2>
          {s.state === 'loading' && <p className="m-0 text-muted">Reading the scores…</p>}
          {s.state === 'error' && (
            <p role="alert" className="m-0 flex items-center gap-3 text-error">
              {s.error}
              <button type="button" onClick={retry} className="inline-flex min-h-11 items-center font-mono text-[12px] text-ink-2 underline underline-offset-4">
                Retry
              </button>
            </p>
          )}
          {data && data.scores.length === 0 && (
            <div className="relative flex flex-col items-center gap-3 overflow-hidden rounded-input border border-dashed border-line-strong px-6 py-10 text-center" data-empty>
              <span aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-px bg-[linear-gradient(90deg,transparent,rgba(0,210,255,.45),transparent)]" style={{ animation: 'gl-scan 3.6s linear infinite' }} />
              <span className="relative grid size-14 place-items-center">
                <span aria-hidden className="absolute inset-0 rounded-full border border-gold-line" style={{ animation: 'gl-live-pulse 2.6s ease-out infinite' }} />
                <Gauge aria-hidden size={22} className="relative text-gold" />
              </span>
              <span className="font-display text-[22px] font-bold uppercase">Nothing listed yet</span>
              <span className="max-w-[460px] text-[14px] text-muted">A contract is listed once a workspace watching it with Gully Security monitoring allows it, or Gully Security publishes a report on it. Any contract can still be scored with the lookup above.</span>
            </div>
          )}
          {data && data.scores.length > 0 && (
            <>
              <BandBars rows={data.scores} />
              <ol className="m-0 flex list-none flex-col p-0">
                {data.scores.map((r, i) => (
                  <li key={`${r.chainKey}:${r.address}`} className="border-t border-line first:border-t-0" style={rise(i % 12)}>
                    <Link to={`/score/${r.chainKey}/${r.address}`} className="grid min-h-11 grid-cols-[minmax(0,1fr)_auto] items-center gap-4 py-3 hover:bg-surface-hover">
                      <span className="flex min-w-0 items-center gap-3">
                        <TokenLogo symbol={r.symbol ?? r.name ?? 'token'} chain={r.chainKey} address={r.address} size={24} decorative />
                        <span className="flex min-w-0 flex-col">
                        <span className="truncate text-[15px] font-semibold text-ink">
                          {r.name ?? shortAddr(r.address)}
                          {r.symbol ? <span className="ml-2 font-mono text-[12px] font-normal text-faint">{r.symbol}</span> : null}
                        </span>
                        <span className="font-mono text-[11px] text-faint">
                          {r.chainName} · {shortAddr(r.address)} · {r.coverage.components}/{r.coverage.of} parts · {fmtDate(r.computedAt)}
                        </span>
                        </span>
                      </span>
                      <span className="flex items-center gap-3">
                        {r.change !== null && r.change !== 0 && <span className={`font-mono text-[11px] ${r.change > 0 ? 'text-green' : 'text-error'}`}>{r.change > 0 ? `▲${r.change}` : `▼${-r.change}`}</span>}
                        <span className="w-[58px] rounded-full border px-2 py-[2px] text-center font-mono text-[13px]" style={{ color: bandColor(r.score), borderColor: bandColor(r.score) }}>
                          {r.score ?? 'N/A'}
                        </span>
                        <ArrowRight aria-hidden size={14} className="text-faint" />
                      </span>
                    </Link>
                  </li>
                ))}
              </ol>
            </>
          )}
        </section>

        <section className={card} aria-labelledby="how" style={rise(5)}>
          <h2 id="how" className={cardTitle}>
            <Scale aria-hidden size={20} className="text-gold" /> What goes in
          </h2>
          {s.state === 'loading' && <div role="status" aria-label="Reading the methodology" className="h-[200px] animate-[gl-skeleton_1.4s_ease-in-out_infinite] rounded-input bg-surface-deep" />}
          {s.state === 'error' && <p className="m-0 text-[14px] text-muted">The methodology could not be read just now. It is also in the docs below.</p>}
          {data && (
            <>
              <div className="flex justify-center">
                <WeightsRing parts={data.methodology.components} />
              </div>
              <ul className="m-0 flex list-none flex-col gap-3 p-0">
                {data.methodology.components.map((c) => {
                  const Icon = ICONS[c.id] ?? Scale
                  return (
                    <li key={c.id} className="flex items-start gap-3">
                      <Icon aria-hidden size={16} className="mt-[2px] flex-none text-gold" />
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="flex items-center justify-between gap-2 text-[14px] font-semibold text-ink">
                          {c.label}
                          <span className="font-mono text-[11px] font-normal text-faint">{c.weight}</span>
                        </span>
                        <span className="text-[13px] text-muted">{c.what}</span>
                        <span aria-hidden className="mt-1 h-[3px] rounded-full bg-gold/70" style={{ width: `${c.weight * 4}%`, animation: 'gl-rise .6s ease both' }} />
                      </span>
                    </li>
                  )
                })}
              </ul>
              <ul className="m-0 flex list-disc flex-col gap-2 pl-5 text-[13px] leading-[1.55] text-muted">
                {data.methodology.rules.map((x) => (
                  <li key={x}>{x}</li>
                ))}
              </ul>
            </>
          )}
          <div className="flex flex-wrap gap-4 text-[14px]">
            <a href={`${DOCS_URL}/gully-score`} {...newTab} className="inline-flex min-h-11 items-center gap-1 text-gold underline-offset-4 hover:underline">
              Full methodology <NewTabMark size={12} className="flex-none text-gold" />
            </a>
            <a href={`${APP_URL}/#security-monitors`} {...newTab} className="inline-flex min-h-11 items-center gap-1 text-gold underline-offset-4 hover:underline">
              Watch a contract <NewTabMark size={12} className="flex-none text-gold" />
            </a>
          </div>
        </section>
      </div>
    </>
  )
}
