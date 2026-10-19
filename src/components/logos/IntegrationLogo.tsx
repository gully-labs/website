import { Logo } from './Logo'
import { integrationMark, type LogoSize } from './registry'

/** A third-party service's own mark (public/integrations), as a rounded tile. A mark that is missing or fails
    to load gets a neutral lettermark tile in its place. */
export function IntegrationLogo({ id, name, size = 40, decorative = false, className = '' }: { id: string; name: string; size?: LogoSize; decorative?: boolean; className?: string }) {
  return <Logo mark={integrationMark(id)} glyph="venue" letter={name} size={size} shape="tile" alt={decorative ? '' : `${name} logo`} className={className} />
}
