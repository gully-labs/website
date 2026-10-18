import { Bot } from 'lucide-react'
import { useEffect, useState } from 'react'
import { AskPanel } from '../../../components/ask/AskPanel'
import { askStatus, type AskStatus } from '../../../components/ask/askApi'
import { NF } from '../../../components/charts/number-formats'
import { LiveTopGaps } from '../../../components/tracker/LiveTopGaps'
import { CHAIN_SHORT, useTracker } from '../../../lib/tracker'
import { docsPage, sitePage } from './links'
import { Section, ServiceHeader, type Status } from './ServiceHeader'

/* Gully AI, in the app: the full chat (AskPanel, the same component as /ask and the floating panel),
   with what it reads beside it: its index (GET /api/ask/status) and the tracker's widest gaps right
   now (GET /api/tracker), which it quotes live when asked about a stock. */

function useAskStatus() {
  const [s, setS] = useState<AskStatus | null | 'loading'>('loading')
  useEffect(() => {
    let alive = true
    askStatus().then((v) => alive && setS(v))
    return () => {
      alive = false
    }
  }, [])
  return s
}

export default function AiView() {
  const s = useAskStatus()
  const st = s === 'loading' ? null : s
  const tr = useTracker()
  const [now] = useState(() => Date.now())
  const widest = tr.k === 'ok' ? [...tr.data.rows].filter((r) => r.gapPct !== null && r.status !== 'thin').sort((a, b) => Math.abs(b.gapPct ?? 0) - Math.abs(a.gapPct ?? 0))[0] : undefined
  const hours = st?.updatedAt ? Math.max(0, (now - Date.parse(st.updatedAt)) / 3_600_000) : null
  const status: Status = s === 'loading' ? { tone: 'checking', text: 'checking…' } : st?.configured ? { tone: 'live', text: 'online' } : st ? { tone: 'idle', text: 'not switched on here' } : { tone: 'down', text: 'unreadable' }
  return (
    <>
      <ServiceHeader
        icon={Bot}
        title="Gully AI"
        desc="Ask about the tracker, its API, plans and alerts, Gully Pay, Chain Kit and DeepCore. Answers cite the docs and read live figures."
        status={status}
        docs={docsPage()}
        page={{ href: sitePage('/ask') }}
        tiles={[
          { label: 'INDEX PASSAGES', value: st?.indexSize || null, unknown: s === 'loading' ? '…' : 'not tracked yet', note: 'docs, site, changelog' },
          { label: 'INDEX AGE', value: hours, format: { maximumFractionDigits: 1 }, suffix: ' h', unknown: s === 'loading' ? '…' : 'not published', note: 'since it was built' },
          { label: 'WIDEST GAP NOW', value: widest?.gapPct ?? null, format: NF.signed2, suffix: '%', unknown: tr.k === 'loading' ? '…' : 'none', note: widest ? `${widest.ticker} · ${CHAIN_SHORT[widest.chain] ?? widest.chain} · it can quote this` : 'read live when asked' },
        ]}
      />
      <div className="grid grid-cols-[minmax(0,1fr)_340px] items-start gap-4 max-[1100px]:grid-cols-1">
        <section aria-label="Chat with Gully AI" className="flex min-w-0 flex-col gap-3 rounded-[14px] border border-line bg-surface p-4" data-testid="app-ask">
          <AskPanel variant="page" />
        </section>
        <Section title="Widest gaps now" sub="live · Gully AI reads these when you ask about a stock">
          <LiveTopGaps count={8} />
        </Section>
      </div>
    </>
  )
}
