import { AppWindow, ClipboardCopy, Code2, Eye, History } from 'lucide-react'
import { useTracker } from '../../../lib/tracker'
import { WidgetBuilder } from '../../widget/WidgetPage'
import { ExtLink } from '../ExtLink'
import { pillSm } from '../styles'
import { useSubTab } from '../subtab'
import { SubTabs, type SubTabItem } from '../ui'
import { docsPage, sitePage } from './links'
import { ServiceHeader, type Status } from './ServiceHeader'

/* Widgets, in the app: the public widget builder itself (WidgetBuilder: options, the real widget.js
   running live against this server, the gap history chart and the snippet), under the app's header. "Build it"
   stays on the left; the right-hand card is a sub-tab (preview, history, snippet) so the page fits 900 px. */

const TABS = ['preview', 'history', 'snippet'] as const
type Sub = (typeof TABS)[number]
const ITEMS: SubTabItem<Sub>[] = [
  { id: 'preview', label: 'Live preview', icon: <Eye size={15} aria-hidden /> },
  { id: 'history', label: 'Gap history', icon: <History size={15} aria-hidden /> },
  { id: 'snippet', label: 'Paste it', icon: <ClipboardCopy size={15} aria-hidden /> },
]

export default function WidgetsView() {
  const st = useTracker()
  const [sub, setSub] = useSubTab<Sub>('widgets', TABS, 'preview', { hashOnOpen: false })
  const data = st.k === 'ok' ? st.data : null
  const pending = st.k === 'error' ? 'unreadable' : '…'
  const status: Status = data ? { tone: 'live', text: 'live data' } : st.k === 'error' ? { tone: 'down', text: 'tracker unreadable' } : { tone: 'checking', text: 'reading…' }
  return (
    <>
      <ServiceHeader
        icon={AppWindow}
        title="Widgets"
        desc="Live fair prices on any page with one script tag: a ticker, a one-stock badge or a table of the widest gaps. Free, no key."
        status={status}
        docs={docsPage('widget')}
        page={{ href: sitePage('/widget') }}
        actions={
          <ExtLink href={docsPage('sdk')} className={pillSm}>
            <Code2 size={14} aria-hidden /> SDK
          </ExtLink>
        }
        tiles={[
          { label: 'STOCKS TO EMBED', value: data?.rows.length, unknown: pending, note: 'any one in a badge' },
          { label: 'CHAINS', value: data?.chains.length, unknown: pending, note: data ? data.chains.map((c) => c.name).join(', ') : 'tracked' },
          { label: 'TRUSTED POOLS', value: data ? data.rows.filter((r) => r.gapPct !== null && r.status !== 'thin').length : null, unknown: pending, note: 'what the table shows' },
        ]}
      />
      <SubTabs items={ITEMS} value={sub} onChange={setSub} label="Widget sections" idBase="widgets" />
      {/* One builder for every sub-tab, so the choices survive a switch; SubPanel would remount it. */}
      <div id="widgets-panel" role="tabpanel" aria-labelledby={`widgets-tab-${sub}`} className="min-w-0">
        <WidgetBuilder compact panel={sub} />
      </div>
    </>
  )
}
