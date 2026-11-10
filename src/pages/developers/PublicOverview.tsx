import { Activity, ArrowUpRight } from 'lucide-react'
import { LiveChart, LiveStat, type LivePoint, type LiveUnit } from '../../components/live/GlLive'
import { hubState, type HubBody } from '../../console/live'
import { SITE_URL } from '../../site-host'
import type { HubProducts } from '../../terminal/kit'
import type { HubLive } from '../hub/hubData'
import { ExtLink } from './ExtLink'
import { usePoll } from './poll'
import { mono, panel, panelTitle } from './styles'

/* The public Overview of the Gully Labs App (owner, 2026-11-09: every Gully app is public by default; read views work
   signed out, the wallet or Gully ID is asked at the action). Signed out, app.gullylabs.xyz shows what is public about
   the services Gully Labs runs, read from the same public endpoints the landing uses and nothing else:
     /api/hub           every Gully surface probed each minute (state, response time), the Gully Chain head
     /api/hub/products  Gully Chain transactions per hour, holder maps opened per day, security scans per day
     /api/hub/live      Gully ID sign-ins per hour (public stats)
   No account data: Keys, Billing, Team, Settings and every /api/developer/* read stay behind sign-in (Dashboard.tsx).
   Live UI: gl-stat tiles that count up and gl-chart bars that never draw an empty frame (GlLive.tsx). */

const PT = 'America/Los_Angeles'
const hourMs = (t: string | number) => (typeof t === 'number' ? (t < 1e12 ? t * 1000 : t) : Date.parse(t))
const fmt = (n: number) => n.toLocaleString('en-US')
const DOT: Record<ReturnType<typeof hubState>, string> = { up: 'bg-green', down: 'bg-error', coming: 'bg-faint', reading: 'bg-line-strong' }
const WORD: Record<ReturnType<typeof hubState>, string> = { up: 'answering', down: 'not answering', coming: 'coming online', reading: 'reading' }

/** The services Gully Labs itself runs, in the hub's order (group "labs"), one row each with its live state. */
function Services({ hub }: { hub: HubBody | null }) {
  const rows = (hub?.services ?? []).filter((s) => s.group === 'labs')
  return (
    <section className={panel} aria-labelledby="pub-services">
      <div className="flex items-center justify-between gap-3">
        <h2 id="pub-services" className={panelTitle}>
          Gully Labs services
        </h2>
        <ExtLink href={`${SITE_URL}/status`} className={`${mono} inline-flex min-h-11 items-center gap-1 text-faint hover:text-ink`}>
          every surface
        </ExtLink>
      </div>
      {!hub && <p className={`m-0 ${mono}`}>Reading the live status…</p>}
      {hub && (
        <ul className="m-0 grid list-none gap-1 p-0 sm:grid-cols-2" data-testid="public-services">
          {rows.map((s) => {
            const st = hubState(s)
            return (
              <li key={s.key} className="m-0">
                <a href={s.url} target="_blank" rel="noopener noreferrer" className="flex min-h-11 items-center gap-3 rounded-[10px] px-2 text-[14px] text-ink hover:bg-surface-hover">
                  <span className={`inline-block h-[8px] w-[8px] shrink-0 rounded-full ${DOT[st]}`} aria-hidden />
                  <span className="min-w-0 flex-1 truncate">{s.name}</span>
                  <span className={`${mono} shrink-0`}>{st === 'up' && typeof s.ms === 'number' ? `${fmt(s.ms)} ms` : WORD[st]}</span>
                  <ArrowUpRight size={14} className="shrink-0 text-faint" aria-hidden />
                  <span className="sr-only">(opens in a new tab)</span>
                </a>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

function Tile({ label, value, note, spark, loading, unit = 'plain' }: { label: string; value: number | null; note: string; spark?: number[]; loading: boolean; unit?: LiveUnit }) {
  return (
    <div className={`${panel} gap-1`}>
      <span className={mono}>{label}</span>
      <LiveStat value={value} unit={unit} spark={spark} live loading={loading} bare />
      <span className="text-[12px] leading-[1.4] text-faint">{note}</span>
    </div>
  )
}

export function PublicOverview() {
  const hub = usePoll<HubBody>('/api/hub', 60_000)
  const prod = usePoll<HubProducts>('/api/hub/products', 60_000)
  const live = usePoll<HubLive>('/api/hub/live', 60_000)
  const svcs = (hub.data?.services ?? []).filter((s) => s.state !== 'coming')
  const up = hub.data ? svcs.filter((s) => hubState(s) === 'up').length : null
  const head = live.data?.head?.block ?? hub.data?.chain?.head ?? null
  const chainHourly = prod.data?.chain?.hourly ?? []
  const txs: LivePoint[] = chainHourly.map((h) => [hourMs(h.t), h.txs ?? 0] as LivePoint).filter(([t]) => Number.isFinite(t))
  const signins: LivePoint[] = (live.data?.id?.hourly ?? []).map((h) => [hourMs(h.hour), h.n] as LivePoint).filter(([t]) => Number.isFinite(t))
  const maps = prod.data?.holders ?? null
  const scans = prod.data?.security ?? null
  const loading = { hub: !hub.data && !hub.error && !hub.timedOut, prod: !prod.data && !prod.error && !prod.timedOut, live: !live.data && !live.error && !live.timedOut }
  return (
    <div className="flex min-w-0 flex-col gap-4" data-testid="public-overview">
      <div>
        <span className={mono}>GULLY LABS APP · PUBLIC OVERVIEW</span>
        <h1 className="m-0 mt-1 text-[24px] leading-[1.15] font-bold text-ink">What is running right now</h1>
        <p className="m-0 mt-1 max-w-[560px] text-[14px] leading-[1.5] text-muted">
          Every figure is read live from the Gully Labs services; a source that cannot be read says so. Sign in to see your own keys, usage, billing and team.
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" data-testid="public-kpis">
        <Tile label="SURFACES ANSWERING" value={up !== null && svcs.length ? Math.round((up / svcs.length) * 1000) / 10 : null} unit="percent" note={hub.data ? `${up} of ${svcs.length} surfaces, checked each minute` : hub.error ? 'Status unreadable right now' : 'Reading…'} loading={loading.hub} />
        <Tile label="GULLY CHAIN BLOCK" value={head} note="latest block, chain 485590 (testnet)" spark={chainHourly.slice(-12).map((h) => h.txs ?? 0)} loading={loading.live && loading.hub} />
        <Tile label="GULLY ID SIGN-INS" value={live.data?.id?.signins24h ?? null} note={live.data?.id ? 'last 24 hours, every app' : live.error ? 'Gully ID stats unreadable right now' : 'Reading…'} spark={(live.data?.id?.hourly ?? []).slice(-12).map((h) => h.n)} loading={loading.live} />
        <Tile label="HOLDER MAPS TODAY" value={maps ? maps.today : null} note={maps ? `${fmt(maps.tokens)} tokens mapped today` : prod.error ? 'Map counter unreadable right now' : 'Reading…'} spark={maps?.daily.slice(-12).map((d) => d.maps)} loading={loading.prod} />
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        <section className={panel} aria-labelledby="pub-chain">
          <h2 id="pub-chain" className={panelTitle}>
            Gully Chain transactions per hour
          </h2>
          <LiveChart series={txs} kind="bars" unit="plain" height={160} empty={prod.error ? 'The indexer did not answer' : 'No transactions in the last 24 hours'} loading={loading.prod} label="Gully Chain testnet transactions per hour, last 24 hours (Pacific time)" />
          <span className={mono}>indexer.gullychain.xyz · hours in {PT === 'America/Los_Angeles' ? 'PT' : PT}</span>
        </section>
        <section className={panel} aria-labelledby="pub-id">
          <h2 id="pub-id" className={panelTitle}>
            Gully ID sign-ins per hour
          </h2>
          <LiveChart series={signins} kind="bars" unit="plain" height={160} empty={live.error ? 'Gully ID stats did not answer' : 'No sign-ins in the last 24 hours'} loading={loading.live} label="Gully ID sign-ins per hour, last 24 hours (Pacific time)" />
          <span className={mono}>gullyid.xyz/v1/stats/public · hours in PT</span>
        </section>
      </div>
      <Services hub={hub.data} />
      {scans && (
        <p className={`m-0 ${mono}`}>
          <Activity size={12} className="mr-1 inline" aria-hidden />
          {fmt(scans.daily.reduce((s, d) => s + d.scans, 0))} security scans in the last {scans.daily.length} days · {fmt(scans.published)} published reports
        </p>
      )}
      <p className="m-0 text-[13px] leading-[1.5] text-muted">
        The other Gully products live in their own apps:{' '}
        <ExtLink href={`${SITE_URL}/products`} className="text-ink underline underline-offset-2 hover:text-gold">
          every product
        </ExtLink>
        .
      </p>
    </div>
  )
}
