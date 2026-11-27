// /explain: posts the hash to /api/ai/explain-tx and shows the answer, who wrote it and the facts it came from.
// Plain DOM (textContent only), no dependency.
const form = document.getElementById('xform')
const input = document.getElementById('xhash')
const out = document.getElementById('xout')
const text = document.getElementById('xtext')
const note = document.getElementById('xnote')
const facts = document.getElementById('xfacts')
const btn = form?.querySelector('button')
const WHY = { bad_input: 'That is not a transaction hash: it starts with 0x and has 64 more characters.', not_found: 'No transaction with that hash on Gully Chain testnet.', pending: 'That transaction has not been confirmed yet. Try again in a few seconds.', wrong_chain: 'Only Gully Chain testnet transactions can be explained for now.', unavailable: 'The chain could not be read just now. Try again in a minute.' }
const toast = (msg) => { const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg; const x = document.createElement('button'); x.type = 'button'; x.setAttribute('aria-label', 'Dismiss'); x.textContent = '×'; x.onclick = () => t.remove(); t.appendChild(x); document.getElementById('toasts')?.appendChild(t); setTimeout(() => t.remove(), 8000) }
const fact = (label, value) => { if (value == null || value === '') return; const d = document.createElement('div'); const s = document.createElement('small'); s.textContent = label; const b = document.createElement('b'); b.textContent = String(value); d.append(s, b); facts.appendChild(d) }
form?.addEventListener('submit', async (e) => {
  e.preventDefault()
  const txHash = input.value.trim()
  if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) { toast(WHY.bad_input); input.focus(); return }
  btn.disabled = true; btn.setAttribute('aria-busy', 'true')
  try {
    const r = await fetch('/api/ai/explain-tx', { method: 'POST', headers: { 'content-type': 'application/json', 'x-requested-with': 'gully' }, body: JSON.stringify({ txHash }) })
    const j = await r.json().catch(() => ({}))
    if (!r.ok) { toast(WHY[j.code] || j.error || 'This could not be explained just now.'); return }
    text.textContent = j.explanation
    note.textContent = (j.source === 'model' ? 'Written by Zayden from the facts below.' : 'Zayden is not answering right now: this explanation is built from the facts below by a fixed template.') + ' ' + (j.label || '')
    facts.replaceChildren()
    const f = j.facts || {}
    fact('Result', f.tx?.status === 'success' ? 'Succeeded' : f.tx?.status === 'reverted' ? 'Reverted' + (f.tx.revertReason ? ': ' + f.tx.revertReason : '') : null)
    fact('Method', f.method?.name)
    fact('Done by', f.actor?.short)
    fact('Fee', f.fee?.usd ? f.fee.usd + ' (' + f.fee.eth + ' ETH)' : f.fee?.eth ? f.fee.eth + ' ETH (unpriced)' : null)
    fact('Paid by', f.fee?.paidBy)
    fact('Token moves', f.counts?.transfers)
    fact('Block', f.tx?.block)
    out.hidden = false
    out.scrollIntoView({ block: 'nearest' })
  } catch { toast('This could not be explained just now. Check your connection and try again.') }
  finally { btn.disabled = false; btn.removeAttribute('aria-busy') }
})
