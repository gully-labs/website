import { useContact } from './ContactContext'
import { comingSoon, projectNumber, projects } from '../content/projects'
import { btnGold } from './ui'

/** "Want to be the next project?" band shown above the footer on every page. */
export function ClosingCta() {
  const { openContact } = useContact()

  return (
    <section className="flex flex-wrap items-center justify-between gap-8 border-t border-line px-page py-24">
      <h2 className="m-0 font-display text-h2 font-extrabold uppercase">
        Want to be project <span className="text-gold">{projectNumber(projects.length + comingSoon.length)}?</span>
      </h2>
      <button type="button" onClick={() => openContact()} className={`${btnGold} px-[30px] py-[18px] text-[17px]`}>
        Start a project
      </button>
    </section>
  )
}
