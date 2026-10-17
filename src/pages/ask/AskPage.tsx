import { AskPanel } from '../../components/ask/AskPanel'
import { Seo } from '../../components/Seo'
import { eyebrow } from '../../components/ui'

/* /ask on the main site: Gully Ask on its own page. Lazy route; the landing never loads it. */
export function AskPage() {
  return (
    <>
      <Seo title="Ask Gully" description="Ask a question about Gully Labs, the stock token tracker, its API, plans and products. Answers come from the docs and the site, with sources." />
      <section className="px-page pt-[72px] pb-24 max-[600px]:pt-10">
        <div className="mx-auto flex w-full max-w-[760px] flex-col gap-8">
          <header className="flex flex-col gap-4">
            <span className={eyebrow}>ASK GULLY</span>
            <h1 className="m-0 font-display text-[clamp(44px,6cqw,84px)] leading-[.9] font-extrabold uppercase">
              Ask about <span className="text-gold">Gully Labs</span>
            </h1>
            <p className="m-0 max-w-[620px] text-[17px] leading-[1.6] text-muted">The tracker, its API and widget, plans and alerts, Gully Analytics, Chain Kit and our projects. Answers come from our docs and site, with the sources linked, and live figures where they matter.</p>
          </header>
          <AskPanel variant="page" />
        </div>
      </section>
    </>
  )
}
