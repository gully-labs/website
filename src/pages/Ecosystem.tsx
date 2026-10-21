import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router'
import { AnimatePresence, motion } from 'motion/react'
import { ArrowUpRight, Code2, Info, Plus } from 'lucide-react'
import { Seo } from '../components/Seo'
import { AnimatedNumber } from '../components/charts/AnimatedNumber'
import { MiniSpark } from '../components/charts/MiniSpark'
import { NF } from '../components/charts/number-formats'
import { ChainLogo } from '../components/logos/ChainLogo'
import { IntegrationLogo } from '../components/logos/IntegrationLogo'
import { VenueLogo } from '../components/logos/VenueLogo'
import { Segmented } from '../components/ui/Segmented'
import { btnGold, btnOutline, eyebrow } from '../components/ui'
import { projects, type Project } from '../content/projects'
import { integrationKinds, integrations, type Integration, type IntegrationKind } from '../content/ecosystem'
import { fmtDate, fmtTime, fmtUsd, sourceHost, type Venue, type VenueOk } from '../lib/stats'
import { getJson } from '../lib/holders'
import { METRIC_LABEL, sparkPoints } from '../lib/ledgerSeries'
import { useStats } from '../hooks/useStats'
import { HoldersChip } from '../components/holders/HoldersChip'

/* /ecosystem: three honest lists.
   - Our projects: every project on the site is Gully Labs' own, one card each with the figures its own API
     reports (GET /api/stats). Never added into one number; a figure a venue does not publish is "—".
     Figures read from DefiLlama say so on the card.
   - Integrates with: third-party services the shipped code really calls (src/content/ecosystem.ts). Not
     "partners": nobody on that list has agreed to anything.
   - Launchpads on the Holder Map: from GET /api/ecosystem, hidden when the server has no registry. */

const ease = [0.2, 0.8, 0.2, 1] as const
type Col = 'volume' | 'tvl' | 'fees'
const COLS: { id: Col; label: string }[] = [
  { id: 'volume', label: 'VOLUME' },
  { id: 'tvl', label: 'TVL' },
  { id: 'fees', label: 'FEES' },
]

/** A venue's figure for a column and what it is (all-time, 30 days or 24 hours); null when it publishes none. */
function figure(v: VenueOk, c: Col): { n: number | null; note: string } {
  if (c === 'tvl') return { n: v.tvlUsd, note: '' }
  if (c === 'volume') {
    if (v.volumeAllUsd !== null) return { n: v.volumeAllUsd, note: 'all-time' }
    if (v.volume30dUsd !== null && v.volume30dUsd !== undefined) return { n: v.volume30dUsd, note: '30d' }
    return { n: v.volume24hUsd, note: v.volume24hUsd === null ? '' : '24h' }
  }
  if (v.feesAllUsd !== null && v.feesAllUsd !== undefined) return { n: v.feesAllUsd, note: 'all-time' }
  return { n: v.fees24hUsd, note: v.fees24hUsd === null ? '' : '24h' }
}

/** Which figures of this venue came from DefiLlama, from the notes the server attaches to them. */
const fromLlama = (v: VenueOk) => v.notes.some((n) => /defillama/i.test(n) && !/could not be read/i.test(n))

function ProjectCard({ p, venue, loading, col }: { p: Project; venue: Venue | undefined; loading: boolean; col: Col }) {
  const ok = venue?.state === 'ok' ? venue : null
  // The series is the one for the sorted column (volume, TVL or fees), from the venue's API or DefiLlama.
  const spark = ok ? sparkPoints(ok, col) : null
  const pts = (spark?.points ?? []).slice(-30)
  return (
    <motion.article
      initial={{ opacity: 0, y: 14 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-40px' }}
      transition={{ duration: 0.45, ease }}
      whileHover={{ y: -3 }}
      className="card card-pad flex min-w-0 flex-col gap-4 transition-colors hover:border-line-hover"
      style={{ borderTop: `2px solid ${p.accent}` }}
      data-project={p.slug}
    >
      <div className="flex items-center gap-3">
        <VenueLogo venue={p.key} name={p.name} size={40} />
        <div className="flex min-w-0 flex-1 flex-col">
          <h3 className="m-0 break-words font-display text-[22px] leading-none font-bold uppercase">{p.name}</h3>
          <span className="font-mono text-[11px] tracking-[1px] text-faint">{p.tag.toUpperCase()}</span>
        </div>
        <span className={`flex-none rounded-full border px-2.5 py-0.5 font-mono text-[11px] ${!loading && !ok ? 'border-error-line text-error' : 'border-line-strong text-ink-2'}`}>{!loading && !ok ? 'UNREADABLE' : p.status}</span>
      </div>
      <p className="m-0 text-[14px] leading-[1.55] text-muted">{p.tagline}. {p.description}</p>
      <div className="flex flex-wrap items-center gap-2" aria-label={`${p.name} chains`}>
        {p.chains.map((c) => (
          <span key={c} className="inline-flex items-center gap-1.5 rounded-full border border-line px-2 py-0.5 font-mono text-[11px] text-muted">
            <ChainLogo chain={c} size={14} decorative />
            {c}
          </span>
        ))}
      </div>
      <dl className="m-0 grid grid-cols-3 gap-2">
        {COLS.map((c) => {
          const f = ok ? figure(ok, c.id) : null
          return (
            <div key={c.id} className="flex min-w-0 flex-col gap-1">
              <dt className={`font-mono text-[11px] tracking-[1px] ${col === c.id ? 'text-gold' : 'text-faint'}`}>{c.label}</dt>
              <dd className="m-0 font-mono text-[14px] leading-[1.3] break-words">
                {loading ? (
                  <span className="text-dim">…</span>
                ) : !ok ? (
                  <span className="text-dim" title="This venue could not be read">—</span>
                ) : f && f.n !== null ? (
                  <>
                    <AnimatedNumber value={f.n} format={NF.compactUsd} countUp />
                    {f.note && <span className="ml-1 text-[11px] text-faint">{f.note}</span>}
                  </>
                ) : (
                  <span className="text-dim" title="This venue does not publish this figure">
                    —
                  </span>
                )}
              </dd>
            </div>
          )
        })}
      </dl>
      {pts.length >= 2 ? (
        <MiniSpark data={pts.map((d) => d.v)} xs={pts.map((d) => d.t)} labels={pts.map((d) => new Date(d.t * (d.t > 1e11 ? 1 : 1000)).toISOString().slice(0, 10))} label={`${p.name} daily ${METRIC_LABEL[spark?.metric ?? 'volume'].toLowerCase()}, last ${pts.length} days`} fmt={fmtUsd} color={p.accent} height={44} />
      ) : (
        <span className="flex h-11 items-center font-mono text-[11px] text-faint">{loading ? 'reading…' : ok ? 'no daily series published' : 'daily series unreadable'}</span>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2 font-mono text-[11px] text-faint">
        <span>
          {ok ? (
            <>
              Source: {sourceHost(ok.source.url)}
              {fromLlama(ok) && <span className="ml-1.5 rounded-full border border-gold-line px-1.5 py-px text-gold">incl. DefiLlama</span>}
              {' · '}
              <span title={ok.source.readAt}>read {fmtTime(ok.source.readAt)}</span>
              {ok.volumeAllSince && col === 'volume' ? <> · since {fmtDate(ok.volumeAllSince)}</> : null}
            </>
          ) : (
            'Source: its own public API'
          )}
        </span>
      </div>
      <div className="mt-auto flex flex-wrap gap-2">
        <Link to={`/projects/${p.slug}`} className={`${btnOutline} inline-flex min-h-11 items-center px-4 text-[13px]`}>
          Details
        </Link>
        <a href={p.url} target="_blank" rel="noopener noreferrer" className={`${btnOutline} inline-flex min-h-11 items-center gap-1 px-4 text-[13px]`}>
          Open {p.url.replace(/^https:\/\//, '').replace(/\/$/, '')}
          <ArrowUpRight size={14} aria-hidden />
        </a>
      </div>
    </motion.article>
  )
}

/** One integration: its logo, name and a line of use; the file that proves it is behind "In code". */
function IntegrationTile({ i, n }: { i: Integration; n: number }) {
  const [open, setOpen] = useState(false)
  return (
    <motion.li
      initial={{ opacity: 0, y: 10 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-30px' }}
      transition={{ duration: 0.35, ease, delay: Math.min(n, 5) * 0.04 }}
      whileHover={{ y: -3 }}
      data-integration={i.id}
      className="card flex min-w-0 flex-col transition-colors focus-within:border-gold hover:border-gold"
    >
      <a href={i.href} target="_blank" rel="noopener noreferrer" className="flex min-w-0 flex-1 flex-col gap-2.5 rounded-t-lg p-3.5 pb-2">
        <IntegrationLogo id={i.id} name={i.name} size={40} />
        <span className="inline-flex items-center gap-1 font-display text-[18px] leading-tight font-bold text-ink uppercase">
          {i.name}
          <ArrowUpRight size={14} aria-hidden className="flex-none text-faint" />
          <span className="sr-only">(opens in a new tab)</span>
        </span>
        <span className="text-[13px] leading-[1.5] text-muted">{i.use}</span>
      </a>
      <div className="flex flex-col px-3.5 pb-2.5">
        <button type="button" aria-expanded={open} onClick={() => setOpen((v) => !v)} className="inline-flex min-h-8 w-fit items-center gap-1 rounded-btn font-mono text-[11px] text-faint transition-colors hover:text-gold">
          <Code2 size={13} aria-hidden />
          In code
        </button>
        <AnimatePresence initial={false}>
          {open && (
            <motion.code initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2, ease }} className="block overflow-hidden font-mono text-[11px] break-all text-ink-2">
              {i.where}
            </motion.code>
          )}
        </AnimatePresence>
      </div>
    </motion.li>
  )
}

interface LaunchpadsDoc {
  chains: { key: string; name: string }[]
  launchpads: { id: string | null; name: string | null; url: string | null; chains: string[] }[] | null
}

export function Ecosystem() {
  const stats = useStats()
  const [col, setCol] = useState<Col>('volume')
  const [kind, setKind] = useState<IntegrationKind | 'All'>('All')
  const [pads, setPads] = useState<LaunchpadsDoc['launchpads']>(null)
  useEffect(() => {
    let alive = true
    getJson<LaunchpadsDoc>('/api/ecosystem').then((d) => alive && setPads(d?.launchpads ?? null))
    return () => {
      alive = false
    }
  }, [])

  const rows = useMemo(() => {
    const venueOf = (key: string) => (stats.k === 'ok' ? stats.data.venues.find((v) => v.key === key) : undefined)
    return projects.map((p) => ({ p, venue: venueOf(p.key) }))
  }, [stats])
  // Grouped by category in the order of integrationKinds; one group when a kind is chosen.
  const groups = useMemo(() => integrationKinds.filter((k) => kind === 'All' || k === kind).map((k) => ({ kind: k, items: integrations.filter((i) => i.kind === k) })), [kind])
  const padChains = useMemo(() => new Set((pads ?? []).flatMap((l) => l.chains)).size, [pads])

  return (
    <div className="flex flex-col gap-14 px-page pt-10 pb-24">
      <Seo
        title="Ecosystem: our projects and what we integrate with"
        description="Every Gully Labs project with its own live numbers, the third-party services the code integrates with, and the launchpads on the Holder Map."
      />
      <section className="flex flex-col gap-4">
        <span className={eyebrow}>ECOSYSTEM · GULLY LABS</span>
        <h1 className="heading-1">What we build, what we use</h1>
        <p className="m-0 max-w-[720px] text-[18px] leading-[1.6] text-muted">
          Every project below is Gully Labs’ own. Each shows what its own API reports, on its own line, never added together. The services further down are ones our code calls today; none of them is a partner.
        </p>
        <nav aria-label="On this page" className="flex flex-wrap gap-2">
          {[
            ['#projects', 'Our projects'],
            ['#integrates', 'Integrates with'],
            ...(pads?.length ? [['#launchpads', 'Launchpads on the Holder Map']] : []),
          ].map(([h, l]) => (
            <a key={h} href={h} className="inline-flex min-h-11 items-center rounded-full border border-line-strong px-4 font-mono text-[12px] text-ink-2 transition-colors hover:border-gold hover:text-ink">
              {l}
            </a>
          ))}
          <Link to="/partners" className="inline-flex min-h-11 items-center rounded-full border border-gold-line px-4 font-mono text-[12px] text-gold transition-colors hover:border-gold">
            Build with us →
          </Link>
        </nav>
      </section>

      <section id="projects" aria-labelledby="eco-projects" className="flex scroll-mt-24 flex-col gap-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="flex flex-col gap-2">
            <h2 id="eco-projects" className="heading-2">
              Our projects
            </h2>
            <p className="m-0 text-[14px] text-muted">Live from each project’s own API{stats.k === 'ok' ? `, read ${fmtTime(stats.data.generatedAt)}` : ''}. A figure a project does not publish is “—”.</p>
          </div>
          <Segmented<Col> label="Highlight a figure" value={col} onChange={setCol} options={COLS.map((c) => ({ id: c.id, label: c.label }))} />
        </div>
        {stats.k === 'error' && (
          <p role="alert" className="m-0 rounded-input border border-line-strong bg-surface px-4 py-3 text-[14px] text-ink-2">
            The live figures could not be read just now. The projects are listed without numbers; this page retries every minute.
          </p>
        )}
        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,320px),1fr))] gap-4">
          {rows.map(({ p, venue }) => (
            <ProjectCard key={p.slug} p={p} venue={venue} loading={stats.k === 'loading'} col={col} />
          ))}
        </div>
      </section>

      <section id="integrates" aria-labelledby="eco-int" className="flex scroll-mt-24 flex-col gap-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="flex flex-col gap-2">
            <h2 id="eco-int" className="heading-2">
              Integrates with
            </h2>
            <p className="m-0 max-w-[680px] text-[14px] text-muted">Third-party services our shipped code calls today. A list of what we use, not of who endorses us.</p>
          </div>
          <Segmented<IntegrationKind | 'All'>
            label="Filter by kind"
            value={kind}
            onChange={setKind}
            options={[{ id: 'All', label: `ALL ${integrations.length}` }, ...integrationKinds.map((k) => ({ id: k, label: `${k.toUpperCase()} ${integrations.filter((i) => i.kind === k).length}` }))]}
            className="max-w-full overflow-x-auto"
          />
        </div>
        <details className="group w-fit max-w-full rounded-input border border-line px-3 py-2 text-[13px] text-muted open:border-line-strong">
          <summary className="inline-flex min-h-6 cursor-pointer list-none items-center gap-1.5 font-mono text-[12px] text-ink-2 marker:hidden hover:text-gold [&::-webkit-details-marker]:hidden">
            <Info size={14} aria-hidden />
            How we verified this
          </summary>
          <p className="m-0 mt-2 max-w-[640px] leading-[1.55]">
            Every entry is a call in code we ship; open “In code” on a tile to see the file that makes it. Plans are not listed. Each logo is the company’s own mark, used only to name the service; it does not mean they endorse us.
          </p>
        </details>
        <div className="flex flex-col gap-7">
          {groups.map((g) => (
            <div key={g.kind} className="flex flex-col gap-3" data-kind={g.kind}>
              <h3 className="m-0 flex items-center gap-2 font-mono text-[12px] tracking-[1px] text-faint">
                {g.kind.toUpperCase()}
                <span className="rounded-full border border-line px-2 py-px text-[11px] text-muted">{g.items.length}</span>
                <span aria-hidden className="h-px flex-1 bg-line" />
              </h3>
              <ul className="m-0 grid list-none grid-cols-2 gap-3 p-0 md:grid-cols-3 xl:grid-cols-5">
                {g.items.map((i, n) => (
                  <IntegrationTile key={i.id} i={i} n={n} />
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      {pads && pads.length > 0 && (
        <section id="launchpads" aria-labelledby="eco-pads" className="flex scroll-mt-24 flex-col gap-5">
          <div className="flex flex-col gap-2">
            <h2 id="eco-pads" className="heading-2">
              Launchpads on the Holder Map
            </h2>
            <p className="m-0 max-w-[680px] text-[14px] text-muted">Launchpads whose new tokens get a map and a launch check. Listed by an admin after review; there is no automatic listing.</p>
            <p className="m-0 font-mono text-[12px] text-faint" data-pads-count="">
              {pads.length} {pads.length === 1 ? 'launchpad' : 'launchpads'} live on {padChains} {padChains === 1 ? 'chain' : 'chains'}
            </p>
          </div>
          <ul className="m-0 grid list-none grid-cols-1 gap-3 p-0 sm:grid-cols-2 xl:grid-cols-3">
            {pads.map((l, n) => (
              <motion.li
                key={l.id ?? l.name}
                initial={{ opacity: 0, y: 12 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: '-40px' }}
                transition={{ duration: 0.4, ease, delay: n * 0.05 }}
                whileHover={{ y: -3 }}
                data-launchpad={l.id ?? l.name}
                className="card flex min-w-0 flex-col gap-4 p-4 transition-colors focus-within:border-gold hover:border-gold"
              >
                <div className="flex items-center gap-3">
                  <VenueLogo venue={l.id ?? ''} name={l.name ?? 'Launchpad'} size={48} />
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <h3 className="m-0 truncate font-display text-[22px] leading-none font-bold uppercase">{l.name}</h3>
                    {l.url && <span className="truncate font-mono text-[11px] text-faint">{l.url.replace(/^https:\/\//, '').replace(/\/$/, '')}</span>}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2" aria-label={`${l.name} chains`}>
                  {l.chains.map((c) => (
                    <span key={c} className="inline-flex items-center gap-1.5 rounded-full border border-line px-2 py-0.5 font-mono text-[11px] text-muted">
                      <ChainLogo chain={c} size={14} decorative />
                      {c}
                    </span>
                  ))}
                </div>
                <div className="mt-auto flex flex-wrap items-center gap-2">
                  {l.url && (
                    <a href={l.url} target="_blank" rel="noopener noreferrer" className={`${btnOutline} inline-flex min-h-11 w-fit items-center gap-1 px-4 text-[13px]`}>
                      Visit
                      <ArrowUpRight size={14} aria-hidden />
                    </a>
                  )}
                  <HoldersChip symbol={l.name} className="!h-11 px-3 text-[13px]" />
                </div>
              </motion.li>
            ))}
            <motion.li
              initial={{ opacity: 0, y: 12 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '-40px' }}
              transition={{ duration: 0.4, ease, delay: pads.length * 0.05 }}
              whileHover={{ y: -3 }}
              className="flex min-w-0"
            >
              <Link to="/partners#list-your-launchpad" className="flex min-h-[150px] w-full flex-col items-start justify-center gap-2 rounded-lg border border-dashed border-line-strong p-4 transition-colors hover:border-gold hover:bg-surface">
                <span className="inline-flex size-12 items-center justify-center rounded-lg border border-dashed border-line-strong text-gold">
                  <Plus size={20} aria-hidden />
                </span>
                <span className="font-display text-[20px] leading-none font-bold text-ink uppercase">Your launchpad here →</span>
                <span className="text-[13px] text-muted">Ask to be listed; a person reviews every request.</span>
              </Link>
            </motion.li>
          </ul>
        </section>
      )}

      <section className="card card-pad flex flex-wrap items-center justify-between gap-4">
        <div className="flex max-w-[640px] flex-col gap-1">
          <h2 className="heading-3">Run a launchpad, wallet, explorer or chain?</h2>
          <p className="m-0 text-[14px] text-muted">See what you get, copy the setup, and ask to be listed.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link to="/partners" className={`${btnGold} inline-flex min-h-11 items-center px-5 text-[14px]`}>
            See the partner page
          </Link>
          <Link to="/partners#list-your-launchpad" className={`${btnOutline} inline-flex min-h-11 items-center px-5 text-[14px]`}>
            List your launchpad
          </Link>
        </div>
      </section>
    </div>
  )
}
