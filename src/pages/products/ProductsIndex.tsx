/* /products (compact refresh, 2026-10-26): one hero (the kit logos, each opening its product page here, beside the
   live board), one compact card per product with its live state, then every Gully surface checked each minute and
   the networks Gully Pay and Gully RPC serve. Every figure is read live. */
import { Link } from 'react-router'
import { ArrowRight } from 'lucide-react'
import { Seo } from '../../components/Seo'
import { MarkLogo } from '../../components/ProductLogo'
import { ic, PRODUCTS, ProductLogo, SectionHead } from '../../console/ui'
import { LabsBoard, QuestsPanel } from '../../console/Suite'
import { HubBoard, LaunchGrid } from '../../console/Launcher'

export function ProductsIndex() {
  return (
    <div className="lcp">
      <Seo title="Products" description="Every Gully Labs product with its live state: Gully Chain, Gully Street, Gully Bridge, Gully Safe, Gully Pay, Gully RPC, HolderMaps, Gully Security, Gully AI, Gully Studio, Gully IPFS and the status page. Each supports Gully Chain." />
      <section className="hero">
        <div className="wrap">
          <div className="copy rise">
            <span className="lab cy">Gully Labs · products</span>
            <h1>
              Every product,
              <br />
              <span className="grad">one lab.</span>
            </h1>
            <p className="promise">
              <b>Every product has a free tier</b>, supports Gully Chain and bills through Gully Pay. The logos open each product&apos;s page here.
            </p>
            <ul className="plist">
              {PRODUCTS.map((p) => (
                <li key={p.key}>
                  <Link to={`/products/${p.key}`} aria-label={`${p.name}: product page`}>
                    <ProductLogo p={p} />
                    {ic(ArrowRight)}
                  </Link>
                </li>
              ))}
              <li>
                <Link to="/status" aria-label="Gully Labs status">
                  <MarkLogo label="Gully Status" decorative />
                  {ic(ArrowRight)}
                </Link>
              </li>
            </ul>
          </div>
          <HubBoard />
        </div>
      </section>
      <section aria-labelledby="prods-h">
        <div className="wrap">
          <SectionHead label="Open a product" title="Each one on its own domain" id="prods-h" />
          <LaunchGrid />
        </div>
      </section>
      <section aria-labelledby="across-h">
        <div className="wrap">
          <SectionHead label="Live now" title="Every Gully surface, checked each minute" id="across-h" />
          <div className="livegrid">
            <LabsBoard />
            <QuestsPanel />
          </div>
        </div>
      </section>
    </div>
  )
}
