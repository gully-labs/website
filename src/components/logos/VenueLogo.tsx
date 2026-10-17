import { Logo } from './Logo'
import { venueMark, type LogoSize } from './registry'

const initials = (name: string) =>
  name
    .split(/(?=[A-Z])|\s+/)
    .filter(Boolean)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()

/** A Gully venue's own app icon, taken from its site, as a rounded tile. */
export function VenueLogo({ venue, name, size = 40, decorative = false, className = '' }: { venue: string; name: string; size?: LogoSize; decorative?: boolean; className?: string }) {
  return <Logo mark={venueMark(venue)} label={initials(name)} size={size} shape="tile" alt={decorative ? '' : `${name} logo`} className={className} />
}
