import { Gauge } from 'lucide-react'
import type { NavEntry } from '../../content/site'

/** The Gully Score's entry for the site menus, for the Security group (part 2 of the security platform imports it
    into src/content/site.ts). Defined here so the score pages own their own label, icon and matching paths. */
export const scoreNavEntry: NavEntry = {
  label: 'Gully Score',
  desc: 'Transparent contract scores, nobody can pay for one',
  to: '/score',
  icon: Gauge,
  match: ['/score'],
}
