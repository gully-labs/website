import { useEffect } from 'react'
import { ensureWidgetScript, previewOrigin, widgetAttrs, type WidgetOptions } from '../../lib/widgetEmbed'

/** The real widget.js, running on this page. A change of options mounts a fresh element, which the
    script's own observer picks up; the old one is dropped from its refresh list once it leaves the page. */
export function LiveWidget({ options }: { options: WidgetOptions }) {
  const attrs = widgetAttrs(options)
  const key = attrs.map(([k, v]) => `${k}=${v}`).join(' ')
  useEffect(() => {
    ensureWidgetScript()
  }, [key])
  const props = Object.fromEntries(attrs)
  return <div key={key} {...props} data-api={previewOrigin()} />
}
