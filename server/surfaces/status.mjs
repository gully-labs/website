// Status rows for the Gully AI surfaces: counts only, never content. A surface whose flag is off has NO row (nothing to
// report); an enabled surface is 'degraded' until its keys are set, 'down' after 3 failed answers in a row, else 'up'.
import { SURFACES, surfaceCounts, surfaceEnabled, surfaceStatus } from './surface.mjs'

const NAMES = { discord: 'Gully AI on Discord', farcaster: 'Gully AI on Farcaster', tgapp: 'Gully AI in the Telegram Mini App', embed: 'Gully AI embed widget' }

/** `r` is status.mjs's row builder: r(id, group, name, state, detail). */
export function checkSurfaces(r) {
  const out = []
  for (const s of surfaceStatus()) {
    if (!s.enabled) continue
    const id = `ai-${s.surface}`
    const c = surfaceCounts(s.surface)
    if (!s.configured) {
      out.push(r(id, 'ai', NAMES[s.surface], 'degraded', 'Switched on, but its keys are not all set yet.'))
      continue
    }
    const today = `${c.ok} answered, ${c.refused} refused, ${c.failed} failed today`
    out.push(r(id, 'ai', NAMES[s.surface], c.streak >= 3 ? 'down' : 'up', c.streak >= 3 ? `The last ${c.streak} answers failed (${today}).` : `Ready (${today}).`))
  }
  return out
}
export { SURFACES, surfaceEnabled }
