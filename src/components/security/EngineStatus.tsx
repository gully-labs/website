import { Bot, Cpu, ListOrdered } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { StatusPill, type PillTone } from '../ui/StatusPill'

/* What the scanner can run right now, read live from GET /api/security/engine (security-routes.mjs publicEngine):
   the AI review and the static tools, each online or offline as last seen working (never assumed), and the queue.
   Shown at the scan checkout (the app's New scan step 2 and the pay step), on /security and on the scan terms page.
   Polls every 20 s while the tab is visible. The strip on the right draws every check made since the page opened
   (real reads, not a history the server keeps), so a change shows the moment it happens. */

export interface EngineState {
  checkedAt: string
  state: 'online' | 'partial' | 'offline'
  text: string
  engines: { id: 'ai' | 'static'; name: string; status: 'online' | 'offline'; tools?: string[]; note?: string }[]
  queue: { running: boolean; queued: number }
}

const EVERY_MS = 20_000
const KEEP = 24
const TONE: Record<EngineState['state'], PillTone> = { online: 'live', partial: 'warn', offline: 'error' }
const CELL: Record<EngineState['state'], string> = { online: 'bg-green', partial: 'bg-gold', offline: 'bg-error' }
const ICON: Record<string, ReactNode> = { ai: <Bot size={14} aria-hidden />, static: <Cpu size={14} aria-hidden /> }

type Read = { k: 'loading' } | { k: 'error' } | { k: 'ok'; data: EngineState }

/** The engine state, live. `history` holds the states of the checks made since mount (newest last). */
function useEngineStatus(): { read: Read; history: { at: number; state: EngineState['state'] }[] } {
  const [read, setRead] = useState<Read>({ k: 'loading' })
  const [history, setHistory] = useState<{ at: number; state: EngineState['state'] }[]>([])
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    const go = () =>
      fetch('/api/security/engine')
        .then((r) => (r.ok ? (r.json() as Promise<EngineState>) : Promise.reject(new Error(String(r.status)))))
        .then((d) => {
          if (!alive.current) return
          setRead({ k: 'ok', data: d })
          setHistory((h) => [...h, { at: Date.now(), state: d.state }].slice(-KEEP))
        })
        .catch(() => alive.current && setRead((prev) => (prev.k === 'ok' ? prev : { k: 'error' })))
    go()
    const id = setInterval(() => document.visibilityState !== 'hidden' && go(), EVERY_MS)
    return () => {
      alive.current = false
      clearInterval(id)
    }
  }, [])
  return { read, history }
}

/** "12 s ago", ticking every second. */
function Ago({ iso }: { iso: string }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1_000)
    return () => clearInterval(id)
  }, [])
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1_000))
  return <>{s < 60 ? `${s} s ago` : `${Math.round(s / 60)} min ago`}</>
}

export function EngineStatus({ className = '', testId = 'engine-status' }: { className?: string; testId?: string }) {
  const { read, history } = useEngineStatus()
  const d = read.k === 'ok' ? read.data : null
  return (
    <section aria-label="Scanner status" aria-live="polite" className={`flex min-w-0 flex-col gap-2 rounded-card border border-line bg-surface px-4 py-3 ${className}`} data-testid={testId} data-state={d?.state ?? read.k}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="font-mono text-[11px] tracking-[1px] text-faint">SCANNER</span>
        {d ? (
          <StatusPill tone={TONE[d.state]} dot>
            {d.state === 'online' ? 'online' : d.state === 'partial' ? 'partly online' : 'offline'}
          </StatusPill>
        ) : (
          <StatusPill tone="neutral">{read.k === 'loading' ? 'checking…' : 'status unreadable'}</StatusPill>
        )}
        {d?.engines.map((e) => (
          <span key={e.id} className="inline-flex min-w-0 items-center gap-[6px] text-[12px] text-muted" data-engine={e.id} data-engine-status={e.status} title={e.tools?.length ? e.tools.join(', ') : e.note}>
            <span className={e.status === 'online' ? 'text-green' : 'text-faint'}>{ICON[e.id]}</span>
            {e.name}
            <StatusPill tone={e.status === 'online' ? 'live' : 'off'} dot={e.status === 'online'}>
              {e.status}
            </StatusPill>
          </span>
        ))}
        {d && (
          <span className="inline-flex items-center gap-[6px] font-mono text-[11px] text-faint" data-testid="engine-queue">
            <ListOrdered size={13} aria-hidden />
            {d.queue.running ? '1 running' : 'none running'} · {d.queue.queued} waiting
          </span>
        )}
        <span className="ml-auto flex items-end gap-[3px]" aria-hidden data-testid="engine-history">
          {history.map((h) => (
            <i key={h.at} className={`block h-[14px] w-[5px] origin-bottom rounded-[1px] ${CELL[h.state]}`} style={{ animation: 'gl-grow .45s cubic-bezier(.2,.8,.2,1) both' }} />
          ))}
        </span>
      </div>
      <p className="m-0 text-[13px] leading-[1.5] text-ink-2">
        {d ? d.text : read.k === 'loading' ? 'Reading what the scanner can run right now…' : 'The scanner status could not be read just now. It retries every 20 seconds.'}
        {d && (
          <span className="ml-2 font-mono text-[11px] text-faint">
            checked <Ago iso={d.checkedAt} />
          </span>
        )}
      </p>
    </section>
  )
}
