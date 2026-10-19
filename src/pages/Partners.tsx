import { useEffect, useMemo, useState } from 'react'
import { motion } from 'motion/react'
import { ArrowUpRight } from 'lucide-react'
import { CodeBlock } from '../docs/CodeBlock'
import { Seo } from '../components/Seo'
import { AnimatedNumber } from '../components/charts/AnimatedNumber'
import { MiniBars } from '../components/charts/MiniBars'
import { NF } from '../components/charts/number-formats'
import { Segmented } from '../components/ui/Segmented'
import { eyebrow } from '../components/ui'
import { audiences, benefits, FALLBACK_CHAINS, snippets, type Audience, type Chain } from '../content/ecosystem'
import { DOCS_URL } from '../site-host'
import { getJson, type CheckedLaunches, type HolderSources } from '../lib/holders'
import { ListLaunchpadForm, MapTokenForm } from './ecosystem/Forms'

/* /partners: what a launchpad, wallet, explorer or chain gets from Gully Labs, with copy-paste setup taken
   from the docs, links to those docs and the two forms (src/pages/ecosystem/Forms.tsx). Choosing who you are
   re-orders the benefits by how much they matter to you. The chart is live: how many of the newest launches
   the Holder Map has checked, per chain (GET /api/holders/launches). White-label says what it is today. */

const ease = [0.2, 0.8, 0.2, 1] as const
const STATUS_STYLE = { Live: 'border-success-line text-green', 'On request': 'border-gold-line text-gold', 'Not live yet': 'border-line-strong text-faint' } as const

function usePoll<T>(path: string, ms: number) {
  const [d, setD] = useState<T | null>(null)
  useEffect(() => {
    let alive = true
    const go = () => getJson<T>(path).then((x) => alive && x && setD(x))
    go()
    const id = ms ? setInterval(go, ms) : 0
    return () => {
      alive = false
      if (id) clearInterval(id)
    }
  }, [path, ms])
  return d
}

const DOC_LINKS = [
  ['Holder Map', 'holder-map'],
  ['Widget guide', 'widget'],
  ['SDK', 'sdk'],
  ['API keys', 'api-keys'],
] as const

export function Partners() {
  const [who, setWho] = useState<Audience>('launchpads')
  const [snip, setSnip] = useState(snippets[0].id)
  const launches = usePoll<CheckedLaunches>('/api/holders/launches', 30_000)
  const sources = usePoll<HolderSources>('/api/holders/sources', 0)
  const eco = usePoll<{ chains: Chain[] }>('/api/ecosystem', 0)
  const chains = eco?.chains?.length ? eco.chains : FALLBACK_CHAINS

  const ordered = useMemo(() => {
    const rank = (b: (typeof benefits)[number]) => {
      const i = b.for.indexOf(who)
      return i === -1 ? 99 : i
    }
    return [...benefits].sort((a, b) => rank(a) - rank(b))
  }, [who])

  const byChain = useMemo(() => {
    const m = new Map<string, number>()
    for (const l of launches?.launches ?? []) m.set(l.chainName, (m.get(l.chainName) ?? 0) + 1)
    return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([label, value]) => ({ label, value }))
  }, [launches])
  const checked = launches?.launches.filter((l) => l.state === 'checked').length ?? null
  const chainsWithLaunches = sources ? sources.chains.filter((c) => c.launches).length : null
  const chainsWithStocks = sources ? sources.chains.filter((c) => c.stocks).length : null
  const current = snippets.find((s) => s.id === snip) ?? snippets[0]
  const aud = audiences.find((a) => a.id === who)!

  return (
    <div className="flex flex-col gap-14 px-page pt-10 pb-24">
      <Seo
        title="Partners: Holder Map, SDK and webhooks for launchpads, wallets, explorers and chains"
        description="What launchpads, wallets, explorers and chains get from Gully Labs: the embeddable Holder Map, the Gully Score badge, the SDK, launch webhooks, Gully Pay and Chain Kit, with copy-paste setup and a form to list your launchpad."
      />
      <section className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,420px),1fr))] items-start gap-8">
        <div className="flex min-w-0 flex-col gap-4">
          <span className={eyebrow}>PARTNERS · GULLY LABS</span>
          <h1 className="heading-1">Build on the Holder Map</h1>
          <p className="m-0 max-w-[620px] text-[18px] leading-[1.6] text-muted">
            For launchpads, wallets, explorers and chains: show who holds a token, check every new launch, and get the setup in a few lines. Everything here exists in code today; what does not yet says so.
          </p>
          <Segmented<Audience> label="I run a" value={who} onChange={setWho} options={audiences.map((a) => ({ id: a.id, label: a.label.toUpperCase() }))} className="max-w-full overflow-x-auto" />
          <motion.p key={who} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25, ease }} className="m-0 text-[15px] text-ink-2" aria-live="polite">
            {aud.blurb}
          </motion.p>
        </div>
        <div className="card card-pad flex min-w-0 flex-col gap-4" aria-labelledby="pt-live">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id="pt-live" className="heading-4">
              Live on the Holder Map
            </h2>
            <span className="flex items-center gap-2 font-mono text-[11px] tracking-[1px] text-dim">
              <span className="relative inline-flex size-2.5" aria-hidden>
                <span className="absolute inset-0 animate-[gl-live-pulse_2s_ease-out_infinite] rounded-full bg-gold" />
                <span className="relative size-2.5 rounded-full bg-gold" />
              </span>
              LIVE
            </span>
          </div>
          <dl className="m-0 grid grid-cols-3 gap-3">
            {[
              ['Launches checked', checked],
              ['Chains with launches', chainsWithLaunches],
              ['Chains with stocks', chainsWithStocks],
            ].map(([t, n]) => (
              <div key={t as string} className="flex min-w-0 flex-col gap-1">
                <dt className="font-mono text-[11px] tracking-[1px] text-faint">{(t as string).toUpperCase()}</dt>
                <dd className="m-0 font-display text-[32px] leading-none font-bold">
                  <AnimatedNumber value={n as number | null} format={NF.int} countUp />
                </dd>
              </div>
            ))}
          </dl>
          <MiniBars
            bars={byChain}
            orientation="rows"
            label="Newest launches in the feed, by chain"
            fmt={(v) => `${v} launch${v === 1 ? '' : 'es'}`}
            emptyLabel={launches ? 'No launches in the feed right now' : 'Reading the launch feed…'}
          />
        </div>
      </section>

      <section aria-labelledby="pt-get" className="flex flex-col gap-5">
        <h2 id="pt-get" className="heading-2">
          What you get
        </h2>
        <motion.ul layout className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(min(100%,300px),1fr))] gap-3 p-0">
          {ordered.map((b) => {
            const mine = b.for.includes(who)
            return (
              <motion.li
                layout
                transition={{ layout: { duration: 0.35, ease } }}
                key={b.id}
                className={`card flex min-w-0 flex-col gap-2 p-4 transition-opacity ${mine ? '' : 'opacity-60'}`}
                data-benefit={b.id}
              >
                <div className="flex items-start justify-between gap-2">
                  <h3 className="m-0 font-display text-[20px] leading-tight font-bold uppercase">{b.title}</h3>
                  <span className={`flex-none rounded-full border px-2 py-0.5 font-mono text-[11px] tracking-[1px] ${STATUS_STYLE[b.status]}`}>{b.status.toUpperCase()}</span>
                </div>
                <p className="m-0 text-[13px] leading-[1.55] text-muted">{b.text}</p>
                {b.docs && (
                  <a href={b.docs.href} target="_blank" rel="noopener noreferrer" className="mt-auto inline-flex min-h-11 items-center gap-1 font-mono text-[12px] text-gold hover:text-gold-hover">
                    {b.docs.label}
                    <ArrowUpRight size={13} aria-hidden />
                  </a>
                )}
              </motion.li>
            )
          })}
        </motion.ul>
      </section>

      <section aria-labelledby="pt-setup" className="flex flex-col gap-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="flex flex-col gap-2">
            <h2 id="pt-setup" className="heading-2">
              Set up in minutes
            </h2>
            <p className="m-0 text-[14px] text-muted">Copy, replace the 0x… with your token, done. These are the snippets from the docs.</p>
          </div>
          <Segmented<string> label="Snippet" value={snip} onChange={setSnip} options={snippets.map((s) => ({ id: s.id, label: s.label.toUpperCase() }))} className="max-w-full overflow-x-auto" />
        </div>
        <CodeBlock key={current.id} lang={current.lang} caption={current.caption} code={current.code} />
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-[11px] tracking-[1px] text-faint">DOCS</span>
          {DOC_LINKS.map(([l, slug]) => (
            <a key={slug} href={`${DOCS_URL}/${slug}`} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center gap-1 rounded-full border border-line-strong px-4 font-mono text-[12px] text-ink-2 transition-colors hover:border-gold hover:text-ink">
              {l}
              <ArrowUpRight size={13} aria-hidden />
            </a>
          ))}
        </div>
      </section>

      <section aria-labelledby="pt-forms" className="flex flex-col gap-5">
        <h2 id="pt-forms" className="heading-2">
          Get listed, get mapped
        </h2>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,420px),1fr))] items-start gap-5">
          <ListLaunchpadForm chains={chains} />
          <MapTokenForm chains={chains} />
        </div>
      </section>
    </div>
  )
}
