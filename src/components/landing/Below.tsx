import { useEffect } from 'react'
import { useLocation } from 'react-router'
import { motion, MotionConfig } from 'motion/react'
import { comingSoon, projects } from '../../content/projects'
import { scrollToAnchor } from '../../lib/anchors'
import type { PlansState } from '../../lib/plans'
import type { Stats } from '../../lib/stats'
import { ProjectCards } from '../ProjectRows'
import { eyebrow, h2 } from './links'
import { MostMapped } from './MostMapped'
import { PricingSwitch } from './PricingSwitch'
import { ProductConsole } from './ProductConsole'
import { OpenStrip, ServicesBlock } from './Sections'

/* Everything on the landing under the hero, in one lazy chunk with the animation library: the product
   console, the project cards, pricing, services and the open-source strip. The hero paints without
   waiting for it. Motion follows the reader's setting: under reduced motion, nothing travels or grows,
   fades and number changes stay. */

const words = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven']
const cap = (s: string) => s[0].toUpperCase() + s.slice(1)

export default function Below({ data, state, plans }: { data: Stats | null; state: 'loading' | 'error' | 'ok'; plans: PlansState }) {
  const location = useLocation()
  // This chunk arrives after the Layout tried to scroll to a #hash on first load; finish that scroll.
  useEffect(() => {
    const id = location.hash.slice(1)
    if (id) scrollToAnchor(id)
    // only on arrival
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <MotionConfig reducedMotion="user">
      <ProductConsole plans={plans} />
      <MostMapped />

      <section id="projects" aria-labelledby="projects-title" className="scroll-mt-[72px] border-t border-line">
        <div className="flex flex-col gap-4 px-page py-12 max-[599px]:py-9">
          <motion.div initial={{ opacity: 0, y: 12 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: '-80px' }} transition={{ duration: 0.45, ease: [0.2, 0.8, 0.2, 1] }} className="flex flex-wrap items-end justify-between gap-3">
            <div className="flex flex-col gap-1">
              <span className={eyebrow}>PROJECTS · OUT OF THE LAB</span>
              <h2 id="projects-title" className={h2}>
                Venues we run
              </h2>
            </div>
            <p className="m-0 max-w-[420px] text-[14px] leading-[1.5] text-muted">
              {cap(words[projects.length] ?? String(projects.length))} live venues, {words[comingSoon.length] ?? comingSoon.length} in development. Every card reads its own project's API.
            </p>
          </motion.div>
          <ProjectCards data={data} state={state} />
        </div>
      </section>

      <PricingSwitch plans={plans} />
      <ServicesBlock />
      <OpenStrip data={data} />
    </MotionConfig>
  )
}
