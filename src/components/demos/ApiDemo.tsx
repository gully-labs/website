import { useEffect, useRef, useState, type JSX } from 'react'
import { useTracker, type TrackerRow } from '../../lib/tracker'
import { SITE_URL } from '../../site-host'

/* An API playground that calls the real endpoints on this origin, without a key, exactly as a visitor's
   own code would: the status, the latency measured here, the rate-limit headers the server sent and
   the JSON it answered, shortened for the screen. Sends are spaced at least a second apart so the
   playground cannot hammer the API (the anonymous limit is per IP address, and this page shares it). */

type Lang = 'curl' | 'TypeScript' | 'Python'
type Auth = 'none' | 'key'
interface Endpoint {
  id: string
  path: string
  /** Metered under /api/tracker: answers carry X-RateLimit-* and a key raises the limit. */
  metered: boolean
  ts: (keyed: boolean) => string
}

const THROTTLE_MS = 1000
const MAX_LINES = 70

const client = (keyed: boolean) => `import { createTrackerClient } from '@gullylabs/tracker'\n\nconst tracker = createTrackerClient(${keyed ? '{ apiKey: process.env.GULLY_API_KEY }' : ''})`
const plainFetch = (path: string, keyed: boolean, name: string) =>
  `// Not wrapped by the SDK yet: plain fetch\nconst res = await fetch('${SITE_URL}${path}'${keyed ? ',\n  { headers: { Authorization: `Bearer ${process.env.GULLY_API_KEY}` } }' : ''})\nconst ${name} = await res.json()`

function endpoints(row: TrackerRow | null): Endpoint[] {
  const chain = row?.chain ?? 'robinhood'
  const ticker = row?.ticker ?? 'NVDA'
  return [
    { id: 'tracker', path: '/api/tracker', metered: true, ts: (k) => `${client(k)}\n\nconst t = await tracker.getTracker()\nconsole.log(t.rows.length, 'stocks', tracker.rateLimit)` },
    {
      id: 'history',
      path: `/api/tracker/history?chain=${chain}&ticker=${ticker}`,
      metered: true,
      ts: (k) => `${client(k)}\n\n// Up to 7 days of five-minute readings, oldest first\nconst points = await tracker.getHistory('${chain}', '${ticker}')\nconst stock = await tracker.getStock('${chain}', '${ticker}')`,
    },
    { id: 'movers', path: '/api/tracker/movers?window=24h', metered: true, ts: (k) => plainFetch('/api/tracker/movers?window=24h', k, 'movers') },
    { id: 'plans', path: '/api/plans', metered: false, ts: () => plainFetch('/api/plans', false, 'plans') },
    { id: 'channels', path: '/api/alerts/channels', metered: false, ts: () => plainFetch('/api/alerts/channels', false, 'channels') },
  ]
}

function snippet(e: Endpoint, lang: Lang, auth: Auth): string {
  const keyed = auth === 'key' && e.metered
  const url = `${SITE_URL}${e.path}`
  if (lang === 'curl') return `curl '${url}'${keyed ? ` \\\n  -H "Authorization: Bearer $GULLY_API_KEY"` : ''}`
  if (lang === 'Python') return `import os, requests\n\nr = requests.get(\n    "${url}"${keyed ? `,\n    headers={"Authorization": f"Bearer {os.environ['GULLY_API_KEY']}"}` : ''},\n)\nprint(r.status_code, r.headers.get("x-ratelimit-remaining"))\nprint(r.json())`
  return e.ts(keyed)
}

/** Long arrays keep their first three items and say how many more there are; long strings are cut. */
function prune(v: unknown, depth = 0): unknown {
  if (typeof v === 'string') return v.length > 140 ? `${v.slice(0, 140)}…` : v
  if (Array.isArray(v)) {
    const keep = depth === 0 ? 3 : 2
    const head = v.slice(0, keep).map((x) => prune(x, depth + 1))
    return v.length > keep ? [...head, `… ${v.length - keep} more`] : head
  }
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, prune(x, depth + 1)]))
  return v
}

type Result =
  | { k: 'idle' }
  | { k: 'loading' }
  | { k: 'network'; message: string; ms: number }
  | { k: 'done'; status: number; statusText: string; ms: number; bytes: number; headers: [string, string][]; body: string; json: boolean; cut: boolean }

/** One real request, timed here: the answer, its text, and how long it took. */
async function timed(path: string, signal: AbortSignal): Promise<{ r: Response; text: string; ms: number } | { error: string; ms: number }> {
  const t0 = performance.now()
  try {
    // no-store: every send is a real request with a fresh latency and fresh rate-limit headers.
    const r = await fetch(path, { cache: 'no-store', headers: { accept: 'application/json' }, signal })
    const text = await r.text()
    return { r, text, ms: Math.round(performance.now() - t0) }
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'The request failed.', ms: Math.round(performance.now() - t0) }
  }
}

const HEADERS = ['x-ratelimit-limit', 'x-ratelimit-remaining', 'retry-after', 'cache-control', 'content-type']

export default function ApiDemo(): JSX.Element {
  const st = useTracker()
  const row = st.k === 'ok' ? ([...st.data.rows].filter((r) => r.gapPct !== null).sort((a, b) => Math.abs(b.gapPct!) - Math.abs(a.gapPct!))[0] ?? st.data.rows[0] ?? null) : null
  const eps = endpoints(row)
  const [epId, setEpId] = useState('tracker')
  const [lang, setLang] = useState<Lang>('curl')
  const [auth, setAuth] = useState<Auth>('none')
  const [res, setRes] = useState<Result>({ k: 'idle' })
  const [limit, setLimit] = useState<{ limit: number; remaining: number } | null>(null)
  const [cooling, setCooling] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const ctrl = useRef<AbortController | null>(null)
  useEffect(
    () => () => {
      clearTimeout(timer.current)
      ctrl.current?.abort()
    },
    [],
  )

  const ep = eps.find((e) => e.id === epId) ?? eps[0]
  const historyWaiting = ep.id === 'history' && !row

  const send = async () => {
    if (cooling || res.k === 'loading' || historyWaiting) return
    setCooling(true)
    timer.current = setTimeout(() => setCooling(false), THROTTLE_MS)
    setRes({ k: 'loading' })
    ctrl.current?.abort()
    const c = new AbortController()
    ctrl.current = c
    const out = await timed(ep.path, c.signal)
    if (c.signal.aborted) return
    if ('error' in out) {
      setRes({ k: 'network', message: out.error, ms: out.ms })
      return
    }
    const { r, text, ms } = out
    const headers = HEADERS.map((h) => [h, r.headers.get(h)] as [string, string | null]).filter((x): x is [string, string] => x[1] !== null)
    const lim = Number(r.headers.get('x-ratelimit-limit'))
    const rem = Number(r.headers.get('x-ratelimit-remaining'))
    if (r.headers.has('x-ratelimit-limit') && Number.isFinite(lim) && Number.isFinite(rem)) setLimit({ limit: lim, remaining: rem })
    let body: string
    let json = true
    try {
      body = JSON.stringify(prune(JSON.parse(text)), null, 2)
    } catch {
      json = false
      body = text.slice(0, 600)
    }
    const lines = body.split('\n')
    const cut = lines.length > MAX_LINES
    setRes({ k: 'done', status: r.status, statusText: r.statusText, ms, bytes: new Blob([text]).size, headers, body: cut ? `${lines.slice(0, MAX_LINES).join('\n')}\n…` : body, json, cut })
  }

  const tab = (on: boolean) => `min-h-11 px-4 font-mono text-[12px] border-b-2 bg-transparent transition-colors ${on ? 'border-gold text-ink' : 'border-transparent text-muted hover:text-ink'}`
  const ok = res.k === 'done' && res.status < 400
  const statusCls = res.k === 'done' ? (ok ? 'bg-success-bg text-green' : 'bg-[rgba(255,138,122,.12)] text-error') : res.k === 'network' ? 'bg-[rgba(255,138,122,.12)] text-error' : 'bg-grid text-dim'
  const used = limit ? limit.limit - limit.remaining : null

  return (
    <div className="flex flex-wrap overflow-hidden rounded-card border border-line bg-surface text-[13px] leading-[1.45]">
      {/* Request */}
      <div className="flex min-w-0 flex-[1_1_280px] flex-col gap-[10px] border-line p-[14px] min-[720px]:border-r max-[719px]:border-b">
        <span className="font-mono text-[10px] tracking-[1px] text-gold">API PLAYGROUND · LIVE</span>
        <div role="radiogroup" aria-label="Endpoint" className="flex flex-col gap-[2px]">
          {eps.map((e) => (
            <button
              key={e.id}
              type="button"
              role="radio"
              aria-checked={e.id === ep.id}
              onClick={() => (setEpId(e.id), setRes({ k: 'idle' }))}
              className={`flex min-h-11 items-center gap-2 rounded-[8px] px-[10px] text-left font-mono text-[12px] text-ink transition-colors ${e.id === ep.id ? 'bg-grid' : 'bg-transparent hover:bg-surface-hover'}`}
            >
              <span className="rounded-[4px] bg-success-bg px-[6px] py-px text-[10px] text-green">GET</span>
              <span className="min-w-0 truncate" title={e.path}>
                {e.path}
              </span>
            </button>
          ))}
        </div>
        <div role="radiogroup" aria-label="Snippet authentication" className="flex gap-[2px] rounded-[8px] border border-line p-[2px]">
          {(
            [
              ['none', 'No key'],
              ['key', 'With a key'],
            ] as [Auth, string][]
          ).map(([a, label]) => (
            <button key={a} type="button" role="radio" aria-checked={auth === a} onClick={() => setAuth(a)} className={`min-h-11 flex-1 rounded-[6px] text-[12px] transition-colors ${auth === a ? 'bg-gold text-bg' : 'bg-transparent text-muted hover:text-ink'}`}>
              {label}
            </button>
          ))}
        </div>
        <p className="m-0 text-[11px] leading-[1.5] text-faint">This page always sends without a key. The toggle changes the snippet: a free key from the developer portal raises the limit.</p>
        <div className="flex flex-col gap-1">
          <span className="flex justify-between font-mono text-[11px] text-dim">
            <span>Your IP, this minute</span>
            <span>{limit ? `${used} / ${limit.limit.toLocaleString('en-US')}` : '— / —'}</span>
          </span>
          <span className="h-[6px] overflow-hidden rounded-[3px] bg-grid" aria-hidden>
            <span className="block h-full rounded-[3px] bg-gold transition-[width] duration-400" style={{ width: limit ? `${Math.min(100, ((used ?? 0) / limit.limit) * 100)}%` : '0%' }} />
          </span>
          <span className="font-mono text-[10px] text-faint">{limit ? 'from the X-RateLimit headers of the last metered answer' : 'filled in from the first /api/tracker answer'}</span>
        </div>
        <button
          type="button"
          onClick={send}
          disabled={cooling || res.k === 'loading' || historyWaiting}
          className="mt-auto min-h-11 rounded-[8px] bg-gold font-semibold text-bg transition-colors hover:bg-gold-hover disabled:cursor-wait disabled:opacity-70"
        >
          {res.k === 'loading' ? 'Sending…' : historyWaiting ? 'Finding a stock…' : cooling ? 'One a second…' : 'Send request'}
        </button>
      </div>

      {/* Snippet and response */}
      <div className="flex min-w-0 flex-[999_1_520px] flex-col bg-bg">
        <div role="tablist" aria-label="Language" className="flex overflow-x-auto border-b border-line">
          {(['curl', 'TypeScript', 'Python'] as Lang[]).map((l) => (
            <button key={l} type="button" role="tab" aria-selected={lang === l} onClick={() => setLang(l)} className={tab(lang === l)}>
              {l}
            </button>
          ))}
        </div>
        <pre className="m-0 border-b border-line px-4 py-[14px] font-mono text-[12px] leading-[1.65] break-all whitespace-pre-wrap text-ink-2">
          <code>{snippet(ep, lang, auth)}</code>
        </pre>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line px-4 py-[10px] font-mono text-[12px]" aria-live="polite">
          <span className={`rounded-[4px] px-2 py-[2px] ${statusCls}`}>
            {res.k === 'done' ? `${res.status} ${res.statusText || (ok ? 'OK' : '')}`.trim() : res.k === 'network' ? 'failed' : res.k === 'loading' ? '…' : '—'}
          </span>
          <span className="text-dim">{res.k === 'done' || res.k === 'network' ? `${res.ms} ms` : res.k === 'loading' ? 'sending' : 'Press Send'}</span>
          {res.k === 'done' && <span className="text-dim">{(res.bytes / 1024).toFixed(1)} KB</span>}
          {res.k === 'done' &&
            res.headers
              .filter(([h]) => h.startsWith('x-ratelimit') || h === 'retry-after')
              .map(([h, v]) => (
                <span key={h} className="text-dim">
                  {h}: <span className="text-ink-2">{v}</span>
                </span>
              ))}
          {res.k === 'done' && !res.headers.some(([h]) => h.startsWith('x-ratelimit')) && <span className="text-faint">not metered: no rate-limit headers</span>}
        </div>
        <pre
          className={`m-0 max-h-[420px] min-h-[220px] flex-1 overflow-auto px-4 py-[14px] font-mono text-[12px] leading-[1.6] whitespace-pre-wrap break-all transition-opacity duration-250 ${res.k === 'loading' ? 'opacity-30' : ''} ${
            res.k === 'network' || (res.k === 'done' && !ok) ? 'text-error' : res.k === 'done' ? 'text-ink-2' : 'text-faint'
          }`}
          tabIndex={0}
          aria-label="Response body"
        >
          {res.k === 'idle' && '// the real response appears here'}
          {res.k === 'loading' && '// waiting for the server…'}
          {res.k === 'network' && `// ${res.message}`}
          {res.k === 'done' && (res.json ? res.body : `// not JSON (${res.headers.find(([h]) => h === 'content-type')?.[1] ?? 'no content-type'})\n${res.body}`)}
        </pre>
        {res.k === 'done' && res.json && <span className="border-t border-line px-4 py-2 font-mono text-[10px] text-faint">Long lists show their first items and how many more there are{res.cut ? '; the rest of the answer is cut for the screen' : ''}.</span>}
      </div>
    </div>
  )
}
