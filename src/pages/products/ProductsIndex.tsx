/* /products: the six Gully products, each with one live figure, plus the network chart and the stepper. */
import { Link } from 'react-router'
import { ArrowRight, Zap } from 'lucide-react'
import { Seo } from '../../components/Seo'
import { productFigures } from '../../console/figures'
import { useLive } from '../../console/live'
import { Btn, BUILD_STEPS, ic, PRODUCTS, ProductCard, ProductLogo, SectionHead, Stepper } from '../../console/ui'
import { APP_URL } from '../../site-host'
import { NetworkCard } from '../Home'

export function ProductsIndex() {
  const live = useLive()
  const figs = productFigures(live)
  return (
    <div className="lcp">
      <Seo title="Products" description="Gully Chain, Gully Pay, Gully RPC, HolderMaps, Gully Security and Gully Studio: six Gully Labs products, each with one live figure." />
      <section className="hero">
        <div className="wrap">
          <div className="copy rise">
            <span className="lab cy">Gully Labs · products</span>
            <h1>
              Six products,
              <br />
              <span className="grad">one lab.</span>
            </h1>
            <p className="promise">
              A chain, payments, RPC, holder maps, security and games. <b>Every product has a free tier</b>, supports Gully Chain and bills through Gully Pay.
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
            </ul>
          </div>
          <NetworkCard />
        </div>
      </section>
      <section aria-labelledby="prods-h">
        <div className="wrap">
          <SectionHead label="Open a product" title="Each one on its own domain" id="prods-h">
            Cards open the product itself; the names above open its page here.
          </SectionHead>
          <div className="prods">
            {PRODUCTS.map((p) => (
              <ProductCard key={p.key} p={p} f={figs[p.key]} />
            ))}
          </div>
        </div>
      </section>
      <section aria-labelledby="build-h">
        <div className="wrap">
          <SectionHead label="Build with Gully" title="Three steps, no jargon" id="build-h" />
          <Stepper
            steps={BUILD_STEPS}
            cta={
              <Btn size="sm" icon={Zap} href={APP_URL} arrow>
                Open the app
              </Btn>
            }
          />
        </div>
      </section>
    </div>
  )
}
