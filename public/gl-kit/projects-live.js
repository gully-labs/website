// /projects: Gully Chain testnet activity, last 24 hours, drawn live with the Gully UI Kit (uPlot via mountLive).
// Reads the same public source as the landing (/api/hub/products), refreshes every 60 s; a failed read keeps the last
// drawing, and a first read that fails says so in the frame (never an empty box). Lazy: uPlot loads only here.
import { mountLive } from '/vendor/gully-ui-kit/live.js'

const el = document.getElementById('gl-live')
if (el) {
  const read = async () => {
    const r = await fetch('/api/hub/products', { headers: { accept: 'application/json' } })
    if (!r.ok) throw new Error(String(r.status))
    const j = await r.json()
    // A source that could not be read draws a gap (null), never a zero.
    const txs = new Map((j.chain?.hourly ?? []).map((h) => [h.t, h.txs ?? null]))
    const trades = new Map((j.activity?.hourly ?? []).map((h) => [h.t, h.trades ?? null]))
    const t = [...new Set([...txs.keys(), ...trades.keys()])].sort((x, y) => x - y).slice(-24)
    if (!t.length) return [[], [], []]
    return [t, t.map((x) => txs.get(x) ?? null), t.map((x) => trades.get(x) ?? null)]
  }
  let h = null
  const tick = async () => {
    try {
      const data = await read()
      if (!h) h = await mountLive(el, { series: [{ label: 'Transactions' }, { label: 'Trades' }], data, height: 200, empty: 'No activity read in the last 24 hours' })
      else h.set(data)
    } catch {
      if (!h) { el.classList.add('gu-frame'); el.dataset.guState = 'error'; el.textContent = 'Activity could not be read just now'; el.classList.add('gu-note') }
    }
  }
  tick()
  setInterval(() => { if (!document.hidden) tick() }, 60_000)
}
