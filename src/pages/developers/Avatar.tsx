import { useState } from 'react'

/* A wallet's picture: its ENS / Basename avatar when the server found one, otherwise a blockie (a
   symmetric 5×5 pattern and colours derived from the address), drawn as inline SVG so it needs no
   network and no canvas. */

function blockie(address: string) {
  const hex = address.toLowerCase().replace(/^0x/, '').padEnd(40, '0')
  const byte = (i: number) => parseInt(hex.slice((i * 2) % 40, (i * 2) % 40 + 2), 16)
  const hue = Math.round((byte(0) / 255) * 360)
  const fg = `hsl(${hue} 62% 58%)`
  const bg = `hsl(${(hue + 180) % 360} 28% 18%)`
  const spot = `hsl(${(hue + 40) % 360} 70% 72%)`
  const cells: { x: number; y: number; c: string }[] = []
  for (let y = 0; y < 5; y++)
    for (let x = 0; x < 3; x++) {
      const v = byte(1 + y * 3 + x) % 3
      if (!v) continue
      const c = v === 1 ? fg : spot
      cells.push({ x, y, c })
      if (x < 2) cells.push({ x: 4 - x, y, c })
    }
  return { bg, cells }
}

export function Avatar({ address, src, size = 32, label }: { address: string; src?: string | null; size?: number; label?: string }) {
  const [broken, setBroken] = useState(false)
  if (src && !broken)
    return <img src={src} alt={label ?? ''} width={size} height={size} onError={() => setBroken(true)} referrerPolicy="no-referrer" className="shrink-0 rounded-full object-cover" style={{ width: size, height: size }} />
  const b = blockie(address)
  return (
    <svg viewBox="0 0 5 5" width={size} height={size} className="shrink-0 rounded-full" role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true} shapeRendering="crispEdges">
      <rect width={5} height={5} fill={b.bg} />
      {b.cells.map((c, i) => (
        <rect key={i} x={c.x} y={c.y} width={1} height={1} fill={c.c} />
      ))}
    </svg>
  )
}
