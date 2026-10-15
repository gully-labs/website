// Nothing numeric lives here any more: every figure on the site is read live from
// /api/stats (server/stats.mjs). This file keeps the counts the copy is labelled with.
import { comingSoon, projects } from './projects'

export const PROJECTS_LIVE = String(projects.length).padStart(2, '0')
export const IN_THE_LAB = String(comingSoon.length).padStart(2, '0')
