/* The "Pay with crypto" button a merchant pastes on their own site: a plain styled link that opens the
   Gully Pay checkout in a new tab, plus an optional tiny script (public/pay-button.js) that opens it in
   a popup instead. The checkout is never framed: its pages send frame-ancestors 'self' / 'none'. */

const STYLE = 'display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:44px;padding:0 20px;border-radius:10px;background:#d9b563;color:#0d141c;font:600 15px/1 system-ui,-apple-system,Segoe UI,sans-serif;text-decoration:none'

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** HTML to paste: the link alone works; the script only upgrades it to a popup. */
export function embedSnippet(origin: string, path: string, label = 'Pay with crypto') {
  const href = `${origin}${path}`
  return `<a href="${esc(href)}" target="_blank" rel="noopener noreferrer" data-gully-pay="popup" style="${STYLE}">${esc(label)}</a>\n<script src="${esc(origin)}/pay-button.js" async></script>`
}
