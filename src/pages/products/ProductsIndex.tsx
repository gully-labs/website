/* /products, landing v3 (2026-10-26): the product logo wall (one page each), then every Gully surface checked each
   minute and the venue figures in USD. Every figure is read live. */
import { Seo } from '../../components/Seo'
import { useLive } from '../../console/live'
import '../../terminal/terminal.css'
import { PRODUCTS } from '../../terminal/catalog'
import { Dot, Panel, SecHead, TChart, UptimeGrid, useReveal } from '../../terminal/kit'
import { LogoWall } from '../../terminal/sections'
import { venueTabs } from '../../terminal/liveTabs'

export function ProductsIndex() {
  const live = useLive()
  const ref = useReveal<HTMLDivElement>()
  const ok = live.hub?.services.filter((s) => s.state === 'up').length
  return (
    <div className="lcp gt" ref={ref}>
      <Seo title="Products" description="Every Gully Labs product with its own page and live charts: Gully Chain, Gully Street, Gully Bridge, Gully Safe, Gully Pay, Gully RPC, HolderMaps, Gully Security, Gully AI, Gully Studio, Gully IPFS, Gully Quests and Gully Core. Each supports Gully Chain." />
      <section className="gt-hero gt-phero" aria-labelledby="pi-h">
        <div className="gt-wrap gt-one">
          <div className="gt-hero-copy rise">
            <span className="gt-k">
              <b>products</b> · {PRODUCTS.length} · all on or supporting Gully Chain
            </span>
            <h1 id="pi-h">
              Every product, <span className="gt-acc">one lab.</span>
            </h1>
            <p className="gt-lede">Each has its own page with live charts, features and docs. The same team builds them for other teams too.</p>
          </div>
        </div>
      </section>
      <section className="gt-sec" aria-labelledby="wall-h">
        <div className="gt-wrap">
          <SecHead n="01" label="Products" title="Pick a product" id="wall-h" />
          <LogoWall />
        </div>
      </section>
      <section className="gt-sec" aria-labelledby="up-h">
        <div className="gt-wrap gt-grid2">
          <div className="rv">
            <Panel label={`Uptime · ${live.hub?.services.length ?? 27} surfaces · last hour`} id="up-h" right={live.hub ? <Dot s={ok === live.hub.services.length ? 'up' : 'coming'} label={`${ok}/${live.hub.services.length} up`} /> : <Dot s="reading" />}>
              <UptimeGrid hub={live.hub} compact />
            </Panel>
          </div>
          <div className="rv">
            <TChart label="Venues · USD" tabs={venueTabs(live)} />
          </div>
        </div>
      </section>
    </div>
  )
}
