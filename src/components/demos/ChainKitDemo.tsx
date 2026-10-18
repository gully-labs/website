import { useEffect, useState, type FormEvent, type JSX } from 'react'
import { Link } from 'react-router'
import { ArrowRight, Boxes, Search } from 'lucide-react'
import { track } from '../../lib/track'
import { useReducedMotion } from '../charts/chart-utils'

/* Landing demo: a Blockscout-style explorer that rebrands live (Chain Kit). Every block, transaction
   and figure in it is simulated and labelled "Example explorer"; nothing is read from a chain. */

const NAMES = ['Your Chain', 'Nova L2', 'Orbit Testnet']
const ACCENTS: [string, string][] = [
  ['#d9b563', 'Gold'],
  ['#5aa9e6', 'Blue'],
  ['#74c27b', 'Green'],
  ['#f2704a', 'Orange'],
  ['#c98bdb', 'Violet'],
]
const METHODS = ['Transfer', 'Swap', 'Mint', 'Approve', 'Deposit']
const START_HEIGHT = 4_812_000
const THEMES = {
  dark: { bg: 'var(--color-bg-alt)', surface: 'var(--color-surface-hover)', ink: 'var(--color-ink)', muted: 'var(--color-dim)', line: 'var(--color-line)', tint: 'var(--color-grid)', flash: 'rgba(255,255,255,.04)' },
  light: { bg: 'var(--color-paper-site)', surface: 'var(--color-paper)', ink: 'var(--color-bg)', muted: 'var(--color-axis)', line: 'var(--color-paper-site-line)', tint: 'var(--color-ink)', flash: 'rgba(0,0,0,.03)' },
}

const hash = (s: string) => {
  let h = 7
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 2147483647
  return h || 1
}
const hex = (seed: string, n: number) => {
  let h = hash(seed)
  let o = ''
  for (let i = 0; i < n; i++) {
    h = (h * 16807) % 2147483647
    o += '0123456789abcdef'[h % 16]
  }
  return o
}
const fmt = (n: number) => n.toLocaleString('en-US')

type Result = { kind: string; text: string; ok: boolean }

export default function ChainKitDemo(): JSX.Element {
  const reduced = useReducedMotion()
  const [name, setName] = useState(0)
  const [accent, setAccent] = useState(0)
  const [mode, setMode] = useState<'dark' | 'light'>('dark')
  const [tick, setTick] = useState(0)
  const [q, setQ] = useState('')
  const [res, setRes] = useState<Result | null>(null)

  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 2000)
    return () => clearInterval(id)
  }, [])

  const t = THEMES[mode]
  const ac = ACCENTS[accent][0]
  const chainName = NAMES[name]
  const slug = chainName.toLowerCase().replace(/[^a-z0-9]+/g, '')
  const height = START_HEIGHT + tick

  const blocks = [0, 1, 2, 3, 4].map((i) => {
    const n = height - i
    return { n, age: `${i * 2 + 1}s ago`, txs: 12 + (hash(`b${n}`) % 140) }
  })
  const txs = [0, 1, 2, 3, 4].map((i) => {
    const k = tick * 5 - i
    return { k, h: `0x${hex(`t${k}`, 6)}…${hex(`u${k}`, 4)}`, ft: `0x${hex(`f${k}`, 4)}… → 0x${hex(`g${k}`, 4)}…`, v: ((hash(`v${k}`) % 5000) / 1000).toFixed(3), m: METHODS[hash(`m${k}`) % 5] }
  })
  const stats = [
    { k: 'Block height', v: fmt(height) },
    { k: 'Avg block time', v: '2.0 s' },
    { k: 'Transactions · 24h', v: fmt(184_200 + tick * 37) },
    { k: 'Gas price', v: `${(0.012 + (tick % 7) * 0.001).toFixed(3)} gwei` },
  ]

  const doSearch = (e: FormEvent) => {
    e.preventDefault()
    const s = q.trim()
    if (/^0x[0-9a-fA-F]{64}$/.test(s)) setRes({ kind: 'Transaction', text: s, ok: true })
    else if (/^0x[0-9a-fA-F]{40}$/.test(s)) setRes({ kind: 'Address', text: s, ok: true })
    else if (/^\d{1,15}$/.test(s)) {
      const n = Number(s)
      setRes({ kind: 'Block', text: `#${fmt(n)}${n > height ? ' · not mined yet' : ` · ${12 + (hash(`b${n}`) % 140)} txs`}`, ok: true })
    } else setRes({ kind: 'No match', text: s ? 'Try a 0x address (40 hex), a tx hash (64 hex) or a block number' : 'Type something to search', ok: false })
  }

  const chip = (on: boolean) => `min-h-11 rounded-full border px-3 text-[12px] transition-colors ${on ? 'border-gold bg-gold font-semibold text-bg' : 'border-line-strong text-ink-2 hover:border-line-hover hover:text-ink'}`
  const fade = reduced ? '' : 'transition-[background-color,color,border-color] duration-[400ms]'

  return (
    <div className="flex w-full flex-wrap overflow-hidden lg:flex-nowrap rounded-card border border-line bg-surface text-[13px] leading-[1.45] text-ink lg:h-[620px]">
      {/* Left: the controls */}
      <div className="flex min-w-0 flex-[1_1_240px] flex-col gap-4 border-line p-4 max-lg:border-b lg:overflow-y-auto lg:border-r">
        <div className="flex flex-col gap-0.5">
          <span className="font-mono text-[11px] tracking-[1px] text-gold">CHAIN KIT · TRY IT</span>
          <b className="font-display text-[22px] leading-[1.05] font-bold uppercase">Brand your explorer, live</b>
        </div>
        <div className="flex flex-col gap-1.5">
          <span id="ck-name" className="text-[11px] text-dim">
            Network name
          </span>
          <div role="radiogroup" aria-labelledby="ck-name" className="flex flex-wrap gap-1.5">
            {NAMES.map((n, i) => (
              <button key={n} type="button" role="radio" aria-checked={i === name} onClick={() => setName(i)} className={chip(i === name)}>
                {n}
              </button>
            ))}
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          <span id="ck-accent" className="text-[11px] text-dim">
            Accent
          </span>
          <div role="radiogroup" aria-labelledby="ck-accent" className="flex gap-1.5">
            {ACCENTS.map(([c, label], i) => (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={i === accent}
                aria-label={label}
                onClick={() => setAccent(i)}
                className={`grid size-11 place-items-center rounded-full border-2 transition-colors ${i === accent ? 'border-ink' : 'border-transparent hover:border-line-hover'}`}
              >
                <span aria-hidden className="size-8 rounded-full" style={{ background: c }} />
              </button>
            ))}
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          <span id="ck-theme" className="text-[11px] text-dim">
            Theme
          </span>
          <div role="radiogroup" aria-labelledby="ck-theme" className="flex w-fit gap-0.5 rounded-[8px] border border-line p-0.5">
            {(['dark', 'light'] as const).map((m) => (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={m === mode}
                onClick={() => setMode(m)}
                className={`min-h-11 rounded-[6px] px-4 text-[12px] capitalize transition-colors ${m === mode ? 'bg-gold font-semibold text-bg' : 'text-muted hover:text-ink'}`}
              >
                {m}
              </button>
            ))}
          </div>
        </div>
        <ul className="m-0 mt-2 flex list-none flex-col gap-1.5 p-0 text-[12px] text-muted">
          <li>Blockscout, open source, run by Gully Labs</li>
          <li>Your domain, logo, colours and token list</li>
          <li>Contract verification and a public API</li>
        </ul>
        <Link to="/chain-kit" onClick={() => track('cta-click', { cta: 'request-chain-kit', page: location.pathname })} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-[8px] bg-gold font-semibold text-bg transition-colors hover:bg-gold-hover">
          Request Chain Kit <ArrowRight size={15} aria-hidden />
        </Link>
      </div>

      {/* Right: the explorer */}
      <div className="min-w-0 flex-[999_1_640px] bg-bg p-3.5">
        <div className={`overflow-hidden rounded-[10px] border border-line ${fade}`} style={{ background: t.bg, color: t.ink }}>
          <div className="flex items-center gap-2 border-b border-line bg-surface-hover px-3 py-2">
            <span aria-hidden className="flex gap-[5px]">
              <span className="size-[9px] rounded-full bg-line-hover" />
              <span className="size-[9px] rounded-full bg-line-hover" />
              <span className="size-[9px] rounded-full bg-line-hover" />
            </span>
            <span className="flex-1 truncate text-center font-mono text-[11px] text-dim">explorer.{slug}.xyz</span>
            <span className="rounded-full border border-gold-line px-2 py-0.5 font-mono text-[11px] tracking-[.5px] text-gold">EXAMPLE EXPLORER</span>
          </div>
          <div className={`flex flex-wrap items-center gap-x-3.5 gap-y-1.5 border-b px-4 py-3 ${fade}`} style={{ borderColor: t.line }}>
            <span className="flex items-center gap-2">
              <span aria-hidden className={`grid size-[26px] place-items-center rounded-[7px] text-bg ${fade}`} style={{ background: ac }}>
                <Boxes size={15} strokeWidth={2.2} />
              </span>
              <b className="text-[15px]">{chainName}</b>
            </span>
            <span aria-hidden className="flex flex-wrap gap-x-3.5 text-[12px]" style={{ color: t.muted }}>
              <span>Blocks</span>
              <span>Transactions</span>
              <span className="max-sm:hidden">Tokens</span>
              <span className="max-sm:hidden">Contracts</span>
              <span>API</span>
            </span>
          </div>
          <div className="flex flex-col gap-2.5 p-4">
            <form onSubmit={doSearch} role="search" className="flex gap-2">
              <label className={`flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-[8px] border px-3 ${fade}`} style={{ borderColor: t.line, background: t.surface }}>
                <Search size={14} aria-hidden style={{ color: t.muted }} />
                <span className="sr-only">Search by address, transaction hash or block number</span>
                <input
                  value={q}
                  onChange={(e) => {
                    setQ(e.target.value)
                    setRes(null)
                  }}
                  placeholder="Address, tx hash or block number"
                  spellCheck={false}
                  autoComplete="off"
                  className="min-w-0 flex-1 border-0 bg-transparent font-mono text-[12px] outline-none"
                  style={{ color: t.ink }}
                />
              </label>
              <button type="submit" className={`min-h-11 rounded-[8px] px-4 font-semibold text-bg ${fade}`} style={{ background: ac }}>
                Search
              </button>
            </form>
            {res && (
              <div role="status" className="flex items-center gap-2.5 rounded-[8px] border px-3 py-2.5 text-[12px]" style={{ borderColor: t.line, background: t.surface }}>
                <span className="flex-none rounded-[4px] px-2 py-0.5 font-semibold" style={res.ok ? { background: ac, color: '#0d141c' } : { border: `1px solid ${t.line}`, color: t.muted }}>
                  {res.kind}
                </span>
                <span className="truncate font-mono">{res.text}</span>
              </div>
            )}
            <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
              {stats.map((s) => (
                <div key={s.k} className={`flex flex-col gap-0.5 rounded-[8px] border px-3 py-2.5 ${fade}`} style={{ borderColor: t.line, background: t.surface }}>
                  <span className="text-[11px]" style={{ color: t.muted }}>
                    {s.k}
                  </span>
                  <b className="font-mono text-[15px] font-medium">{s.v}</b>
                </div>
              ))}
            </div>
            <div className="flex flex-wrap gap-3">
              <section aria-label="Latest blocks" className={`min-w-0 flex-[1_1_260px] rounded-[8px] border ${fade}`} style={{ borderColor: t.line, background: t.surface }}>
                <div className="border-b px-3 py-2 text-[12px] font-semibold" style={{ borderColor: t.line }}>
                  Latest blocks
                </div>
                {blocks.map((b, i) => (
                  <div key={b.n} className="flex items-center gap-2.5 border-b px-3 py-2 text-[12px] last:border-b-0" style={{ borderColor: t.line, background: i === 0 && !reduced ? t.flash : 'transparent' }}>
                    <span aria-hidden className="grid size-7 place-items-center rounded-[6px] font-mono text-[11px]" style={{ background: t.tint, color: ac }}>
                      Bk
                    </span>
                    <span className="flex flex-1 flex-col leading-[1.2]">
                      <span className="font-mono" style={{ color: ac }}>
                        #{fmt(b.n)}
                      </span>
                      <span className="text-[11px]" style={{ color: t.muted }}>
                        {b.age}
                      </span>
                    </span>
                    <span className="font-mono" style={{ color: t.muted }}>
                      {b.txs} txs
                    </span>
                  </div>
                ))}
              </section>
              <section aria-label="Latest transactions" className={`min-w-0 flex-[1_1_260px] rounded-[8px] border ${fade}`} style={{ borderColor: t.line, background: t.surface }}>
                <div className="border-b px-3 py-2 text-[12px] font-semibold" style={{ borderColor: t.line }}>
                  Latest transactions
                </div>
                {txs.map((x) => (
                  <div key={x.k} className="flex items-center gap-2.5 border-b px-3 py-2 text-[12px] last:border-b-0" style={{ borderColor: t.line }}>
                    <span className="min-w-[58px] rounded-[4px] border px-1.5 py-0.5 text-center text-[11px]" style={{ borderColor: t.line, color: t.muted }}>
                      {x.m}
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col leading-[1.2]">
                      <span className="truncate font-mono" style={{ color: ac }}>
                        {x.h}
                      </span>
                      <span className="truncate font-mono text-[11px]" style={{ color: t.muted }}>
                        {x.ft}
                      </span>
                    </span>
                    <span className="font-mono">{x.v}</span>
                  </div>
                ))}
              </section>
            </div>
            <p className="m-0 text-[11px]" style={{ color: t.muted }}>
              Simulated blocks and transactions. A real Chain Kit explorer indexes your chain.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
