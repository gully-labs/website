import qrcode from 'qrcode-generator'
import { useMemo } from 'react'

/* A QR code drawn as one SVG path (qrcode-generator, MIT, Kazuhiko Arase). Dark modules on white with
   the standard four-module quiet zone, so phone cameras and wallets read it in any theme. */

export function QrCode({ value, size = 200, label }: { value: string; size?: number; label: string }) {
  const { d, n } = useMemo(() => {
    const qr = qrcode(0, 'M')
    qr.addData(value)
    qr.make()
    const count = qr.getModuleCount()
    let path = ''
    for (let r = 0; r < count; r++) {
      for (let c = 0; c < count; c++) if (qr.isDark(r, c)) path += `M${c + 4} ${r + 4}h1v1h-1z`
    }
    return { d: path, n: count + 8 }
  }, [value])
  return (
    <svg role="img" aria-label={label} viewBox={`0 0 ${n} ${n}`} width={size} height={size} shapeRendering="crispEdges" className="block h-auto max-w-full rounded-[10px]">
      <rect width={n} height={n} fill="#fff" />
      <path d={d} fill="#0d141c" />
    </svg>
  )
}
