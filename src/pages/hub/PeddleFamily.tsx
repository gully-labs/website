/* The Peddle family (owner, 2026-11-05): PeddleSwap (DEX), Peddles (launchpad) and PeddleQuest (quests) are Gully Labs
   projects, presented beside the Gully-named products on the landing and on /products. One card each: the project's own
   logo (public/venues, unchanged), what it is, its live figures from /api/stats counted up, a 30-day sparkline, a status
   chip and "Open" in a new tab. A venue that cannot be read says so; a figure it does not publish is left out. */
import { ArrowUpRight } from 'lucide-react'
import { Link } from 'react-router'
import { Count, Spark } from '../../console/ui'
import { A } from '../../terminal/kit'
import { PEDDLE_FAMILY, peddleReadings, STATUS_LABEL, type PeddleFigure, type StatsVenue } from './hubData'
import './peddle-family.css'

const fmtUsd = (v: number) => (v >= 1e9 ? `$${(v / 1e9).toFixed(2)}B` : v >= 1e6 ? `$${(v / 1e6).toFixed(2)}M` : v >= 1e4 ? `$${(v / 1e3).toFixed(1)}K` : `$${v.toLocaleString('en-US', { maximumFractionDigits: 0 })}`)

function Fig({ f, short }: { f: PeddleFigure | null; short: string }) {
  if (!f) return null
  return (
    <div className="pdl-fig">
      <Count as="b" className="num" value={f.v} fmt={fmtUsd} />
      <small title={f.label}>{short}</small>
    </div>
  )
}

export function PeddleFamily({ stats, headingId = 'pdl-h', level = 3 }: { stats: { venues?: StatsVenue[] } | null | undefined; headingId?: string; level?: 2 | 3 }) {
  const R = peddleReadings(stats)
  const H = level === 2 ? 'h2' : 'h3'
  const Name = level === 2 ? 'h3' : 'h4'
  return (
    <div className="pdl" data-testid="peddle-family" aria-labelledby={headingId} role="group">
      <header className="pdl-head">
        <H id={headingId}>
          Peddle family <span>trading and DeFi</span>
        </H>
        <p>Gully Labs projects, each on its own site. Value locked, volume and fees are read live.</p>
      </header>
      <ul className="pdl-grid">
        {PEDDLE_FAMILY.map((p) => {
          const r = R[p.key]
          const has = r.tvl || r.volume || r.fees
          return (
            <li key={p.key} className="pdl-card" style={{ ['--c' as string]: p.color }} data-peddle={p.key}>
              <div className="top">
                <img src={p.logo} alt="" width={40} height={40} loading="lazy" decoding="async" />
                <div className="nm">
                  <Name>{p.name}</Name>
                  <span className="kind">{p.kind} · Gully Labs project</span>
                </div>
                <span className="pdl-tag">{STATUS_LABEL[p.status]}</span>
              </div>
              <p className="what">{p.line}</p>
              <div className="read" data-reading={p.key} data-state={r.state}>
                {has ? (
                  <div className="figs">
                    <Fig f={r.tvl} short="TVL" />
                    <Fig f={r.volume} short={r.volume?.label.replace('volume, ', 'volume ') ?? 'volume'} />
                    <Fig f={r.fees} short={r.fees?.label.replace('fees, ', 'fees ') ?? 'fees'} />
                  </div>
                ) : (
                  <small className="why">{r.why}</small>
                )}
                {r.spark.length >= 2 && (
                  <div className="sp" aria-hidden title={`${p.name}: daily ${r.sparkOf === 'tvl' ? 'value locked' : 'volume'}, last ${r.spark.length} days`}>
                    <Spark values={r.spark} color={p.color} h={28} />
                  </div>
                )}
              </div>
              <div className="go">
                <A href={p.url} className="pdl-go" ariaLabel={`Open ${p.name} (${p.domain}, new tab)`}>
                  Open {p.domain}
                  <ArrowUpRight className="gt-ic" aria-hidden />
                </A>
                <Link to={`/projects/${p.page}`} className="pdl-more" aria-label={`${p.name} details`}>
                  Details
                </Link>
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
