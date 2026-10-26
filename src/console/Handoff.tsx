/* The hand-off for a product that lives on its own domain (2026-10-26): its own kit logo, one line, one live
   figure with its animated chart, and the signature "Open <product>" button to its domain. Used by the Gully Labs
   App (app.gullylabs.xyz) where a full feature used to be, and by the app's product hub. Every figure is read
   live (console/live.tsx); a source that cannot be read shows as unreadable, never as zero. */
import type { ReactNode } from 'react'
import { ArrowUpRight, BookOpen } from 'lucide-react'
import './console.css'
import { productFigures } from './figures'
import { LiveProvider, useLive } from './live'
import { LabsBoard, ProductLive, QuestsPanel } from './Suite'
import { Btn, Count, ProductGrid, ProductLogo, productByKey, Spark, type ProductKey } from './ui'
import { isLocalHost, SITE_URL } from '../site-host'

export interface HandoffCopy {
  /** One line: what the product does, and that it moved. */
  line: ReactNode
  /** The page on the product's domain the button opens (its home when omitted). */
  href?: string
  /** A second link, e.g. the product's docs. */
  docs?: string
  /** Shown under the card: how existing data here keeps working (optional). */
  legacy?: ReactNode
}

function HandoffCard({ k, copy }: { k: ProductKey; copy: HandoffCopy }) {
  const p = productByKey(k)
  const f = productFigures(useLive())[k]
  const host = (copy.href ?? p.url).replace(/^https:\/\//, '').replace(/\/$/, '')
  return (
    <section className="handoff card" aria-label={`${p.name} has moved to ${host}`} data-handoff={k}>
      <div>
        <span className="hlogo">
          <ProductLogo p={p} />
        </span>
        <h2>{k === 'ipfs' ? 'Gully IPFS: Gully content, pinned for good' : `${p.name} lives on its own domain now`}</h2>
        <p>{copy.line}</p>
        <div className="ctas">
          <Btn icon={ArrowUpRight} href={copy.href ?? p.url} arrow>
            Open {p.name}
          </Btn>
          {copy.docs && (
            <Btn kind="ter" icon={BookOpen} href={copy.docs}>
              Docs
            </Btn>
          )}
        </div>
      </div>
      <div className="hfig" role="group" aria-label={`${p.name}: ${f.label}, live`}>
        <span className="lab cy">Live</span>
        <div className="v">
          <Count value={f.value} fmt={f.fmt} />
          <small>{f.label}</small>
        </div>
        <Spark values={f.spark} color={f.color} h={56} />
      </div>
      {copy.legacy && <div className="legacy">{copy.legacy}</div>}
    </section>
  )
}

/** One product's hand-off, with its own live data provider (the app has no site Layout around it). */
export function ProductHandoff({ k, copy }: { k: ProductKey; copy: HandoffCopy }) {
  return (
    <LiveProvider>
      <div className="lc">
        <HandoffCard k={k} copy={copy} />
        <div style={{ marginTop: 10 }}>
          <ProductLive k={k} />
        </div>
      </div>
    </LiveProvider>
  )
}

function Cards() {
  const figs = productFigures(useLive())
  return (
    <div data-testid="product-hub">
      <ProductGrid figs={figs} hrefOf={(p) => p.app ?? p.url} statusHref={isLocalHost() ? '/status' : `${SITE_URL}/status`} />
      <div className="livegrid" style={{ marginTop: 10 }}>
        <LabsBoard />
        <QuestsPanel />
      </div>
    </div>
  )
}

/** The seven products as cards, each opening its own domain, then every Gully surface live and Gully Quests (the app's product hub). */
export function ProductHub() {
  return (
    <LiveProvider>
      <div className="lc">
        <Cards />
      </div>
    </LiveProvider>
  )
}
