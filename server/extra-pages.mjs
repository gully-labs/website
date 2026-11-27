// Three server-drawn pages on the Gully Labs page frame (landing.mjs header, footer, tokens, Light/Dark/System):
//   /downloads  every Gully download from the shared downloads kit (gully-ops sites/_shared/downloads, vendored
//               byte-identical in server/vendor/gully-downloads; hub manifest = server/data/gully-downloads.json).
//               "Coming soon" items have no link, no store badge and no email capture (kit rules, enforced in code).
//   /explain    Explain a Gully Chain testnet transaction (server/ai/explain-tx.mjs, POST /api/ai/explain-tx). The
//               page says plainly when Zayden is not writing and the answer is built from the transaction facts only.
//   /ai-tools   Use Gully with AI tools: Zayden, the read-only Gully MCP server, the CLI and the editor extension,
//               each with its honest state.
// The words for search engines live in src/content/seoPages.ts and scripts/build-page-content.mjs like every page.
import fs from 'node:fs'
import { CSS, cap, esc, icon, pageFoot, pageTop } from './landing.mjs'
import { render as renderDl, jsonLd } from './vendor/gully-downloads/downloads.mjs'
import { explainEnabled } from './ai/explain-tx.mjs'

const DL = JSON.parse(fs.readFileSync(new URL('./data/gully-downloads.json', import.meta.url), 'utf8'))
const DL_CSS = fs.readFileSync(new URL('./vendor/gully-downloads/downloads.css', import.meta.url), 'utf8')

const PCSS = `.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.ph{padding:22px 0 18px;background:radial-gradient(ellipse at 66% 45%,var(--hero1) 0,var(--hero2) 58%,var(--hero3) 100%)}
.ph h1{margin-top:8px}.ph .lede{max-width:62ch}.sub{margin-top:6px;max-width:62ch;font-size:16px;color:var(--soft)}
.gdl{--muted:var(--soft);--edge:var(--blue);--accent:var(--sky);--on-accent:var(--on-solid)}
.gdl-grid{margin-top:12px}.dlg .gdl-grid{display:flex;flex-wrap:wrap}.dlg .gdl-card{flex:1 1 300px;min-width:0}.dlg .gdl-priv{display:none}.dlg{margin-top:28px}.dlg:first-child{margin-top:0}.gdl-card a{color:var(--sky)}
.xform{display:flex;flex-wrap:wrap;gap:10px;margin-top:14px}.xform input{flex:1 1 320px;min-width:0;min-height:48px;padding:0 14px;border:1px solid var(--blue);border-radius:14px;background:var(--surface);color:var(--fg);font:500 15px 'IBM Plex Mono',ui-monospace,monospace}
.xform input:focus-visible{outline:2px solid var(--sky);outline-offset:2px}.xform button.cap{font:inherit;font-size:15px;font-weight:600}
.xout{margin-top:14px}.xout[hidden]{display:none}.xout h3{font-size:20px}.xnote{display:flex;align-items:center;gap:8px;margin-top:8px;font-size:13px;color:var(--soft)}
.xfacts{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,220px),1fr));gap:8px;margin-top:12px;font-size:14px}.xfacts div{padding:10px 12px;border:1px solid var(--blue);border-radius:12px}.xfacts small{display:block;color:var(--soft);font-size:12px}.xfacts b{font-weight:600;font-variant-numeric:tabular-nums;word-break:break-all}
.how{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin-top:12px}.how .box h3{font-size:18px}
.tools{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin-top:12px}.tools .box h3{font-size:20px;display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.chip{display:inline-flex;align-items:center;gap:6px;height:26px;padding:0 10px;border-radius:999px;font-size:12px;font-weight:600;white-space:nowrap;border:1px solid var(--blue);color:var(--soft)}.chip:before{content:"";width:7px;height:7px;border-radius:50%;background:none;box-shadow:inset 0 0 0 1.5px var(--soft)}.chip[data-s=live]{color:var(--fg);border-color:var(--sky)}.chip[data-s=live]:before{background:var(--ok);box-shadow:none}
.code{margin-top:10px;padding:12px 14px;border:1px solid var(--blue);border-radius:12px;background:var(--surface2);font:500 13px/1.5 'IBM Plex Mono',ui-monospace,monospace;white-space:pre-wrap;word-break:break-word}
@media (max-width:900px){.how,.tools{grid-template-columns:minmax(0,1fr)}}`

const page = (head, body, { scripts = '', extraCss = '' } = {}) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${head}<link rel="preload" href="/fonts/figtree-latin-700.woff2" as="font" type="font/woff2" crossorigin><script src="/landing/fx.js"></script><style>${CSS}${PCSS}${extraCss}</style></head><body>
${pageTop()}
<main>${body}</main>
${pageFoot()}
<div id="toasts" role="status" aria-live="polite"></div>${scripts}</body></html>`

const hero = (eye, h1, lede, cta = '') => `<section class="ph"><div class="w"><p class="eye">${esc(eye)}</p><h1>${esc(h1)}</h1><p class="lede">${esc(lede)}</p>${cta ? `<div class="cta">${cta}</div>` : ''}</div></section>`

/** /downloads: one group per product, from the hub manifest. */
export function renderDownloads(head) {
  const items = DL.groups.flatMap((g) => g.items)
  const live = items.filter((i) => i.state !== 'soon').length
  const groups = DL.groups.map((g) => `<div class="dlg"><h2 class="t" id="dl-${esc(g.id)}">${esc(g.title)}</h2>${renderDl({ product: DL.product, title: g.title, items: g.items })}</div>`).join('')
  const ld = JSON.stringify(jsonLd({ ...DL, items })).replace(/</g, '\\u003c')
  return page(head, `${hero('Downloads', 'Every Gully download in one place.', `Packages, plugins and apps for Gully Core, Gully Chain, Gully ID, Gully Pay, Swoop Ads, kre8 and Gully AI. ${live} available today; the rest say what they will do and what works now. Nothing here needs an account.`)}
<section class="s"><div class="w">${groups}<p class="sub" style="margin-top:20px">No account, no tracking and no cookies are needed to download. Checksums let you verify files.</p></div></section><script type="application/ld+json">${ld}</script>`, { extraCss: DL_CSS })
}

/** /explain: a form, the answer, the facts, and an honest line about who wrote it. */
export function renderExplain(head) {
  const on = explainEnabled()
  const form = on
    ? `<form class="xform" id="xform" novalidate><label class="sr-only" for="xhash">Transaction hash</label><input id="xhash" name="tx" inputmode="text" autocomplete="off" spellcheck="false" placeholder="0x… transaction hash on Gully Chain testnet" pattern="0x[0-9a-fA-F]{64}" required><button class="cap solid" type="submit"><b></b>Explain it</button></form>
<div class="box xout" id="xout" hidden aria-live="polite"><h3>What happened</h3><p id="xtext"></p><p class="xnote" id="xnote"></p><div class="xfacts" id="xfacts"></div></div>`
    : `<div class="box" style="margin-top:14px"><h3>Opening soon</h3><p>The explainer is built and being switched on. Until then, open any transaction on the testnet explorer.</p>${cap('https://testnet.gullyscan.xyz', 'Open the explorer', 'solid')}</div>`
  return page(head, `${hero('Gully AI · Zayden', 'Explain a transaction in plain words.', 'Paste a Gully Chain testnet transaction. You get what it did, who paid, what moved and what it cost in USD, read from the chain itself. Every figure comes from the transaction; nothing is guessed.')}
<section class="s"><div class="w">${form}
<div class="how"><div class="box"><h3>1 · Read from the chain</h3><p>The receipt, the logs, the method from the verified source and the token moves, priced in USD.</p></div><div class="box"><h3>2 · Zayden writes it up</h3><p>Zayden, the Gully AI assistant, turns those facts into a short explanation. A number that is not in the facts is refused.</p></div><div class="box"><h3>3 · When Zayden is busy</h3><p>If the model does not answer, you still get the explanation, written from the facts by a fixed template, and the page says so.</p></div></div>
<p class="sub" style="margin-top:14px">Testnet only for now: testnet coins have no real value. Explanations are not advice.</p></div></section>`, { scripts: on ? '<script type="module" src="/gl-kit/explain.js"></script>' : '' })
}

const TOOLS = [
  { state: 'live', name: 'Zayden on gullyai.xyz', body: 'Ask Zayden, the Gully AI assistant, about any Gully product. Answers come from the public docs of every product, with the sources linked.', href: 'https://gullyai.xyz', cta: 'Ask Zayden' },
  { state: 'live', name: 'Zayden in the docs and Telegram', body: 'The Ask box on every Gully docs site and the Gully Labs Telegram bot answer the same way, from the same docs.', href: 'https://docs.gullylabs.xyz', cta: 'Open the docs' },
  { state: 'soon', name: 'Gully MCP server', body: 'An open-source, read-only Model Context Protocol server for Claude, Cursor and other AI assistants: chain info, balances, transactions, logs, Gully Core addresses, token holders, swap quotes and docs search. It never signs or sends anything.', code: '{\n  "mcpServers": {\n    "gully": { "command": "npx", "args": ["-y", "gully-mcp"] }\n  }\n}', note: 'Not on npm yet: this is how it will be added once it is published.' },
  { state: 'soon', name: 'Gully CLI', body: 'One command line for Gully AI (ask, explain), Gully Core, chain reads and docs. Telemetry is off.', code: 'npx @gullylabs/cli ai ask "How do I launch a token on Gully Core?"', note: 'Not on npm yet. For Gully Core today: npx @gullylabs/core-cli' },
  { state: 'soon', name: 'Gully Dev Copilot for VS Code and Cursor', body: 'Explain code and contracts, draft Foundry tests and check an integration from your editor. Every request is shown to you before it is sent, and secrets are removed.' },
  { state: 'live', name: 'Explain a transaction', body: 'Paste a Gully Chain testnet transaction and get what it did in plain words, with every figure from the chain.', href: '/explain', cta: 'Explain a transaction' },
]

/** /ai-tools: what exists today and what is coming, never a promise dressed as a feature. */
export function renderAiTools(head) {
  const cards = TOOLS.map((t) => `<div class="box"><h3>${esc(t.name)} <span class="chip" data-s="${t.state}">${t.state === 'live' ? 'Live' : 'Coming soon'}</span></h3><p>${esc(t.body)}</p>${t.code ? `<pre class="code"><code>${esc(t.code)}</code></pre>` : ''}${t.note ? `<p class="xnote">${icon('book-open')}<span>${esc(t.note)}</span></p>` : ''}${t.href ? cap(t.href, t.cta, 'solid') : ''}</div>`).join('')
  return page(head, `${hero('Gully AI', 'Use Gully with AI tools.', 'Zayden answers from the docs today. The MCP server, the CLI and the editor extension are built and open as they are published. Every tool here only reads: none of them can sign or send a transaction.', `${cap('https://gullyai.xyz', 'Ask Zayden', 'solid')}${cap('/downloads', 'All downloads')}`)}
<section class="s"><div class="w"><div class="tools">${cards}</div>
<p class="sub" style="margin-top:14px">What leaves your machine: only the question you send. Addresses, keys and recovery phrases are removed before anything reaches a model, and a private key is refused outright.</p></div></section>`)
}
