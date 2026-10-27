/* Put a map on your site, as a stepper (owner rule: steppers for multi-step flows): 01 pick the format (the embed
   iframe, the widget script, the live badge, or the API), 02 copy its snippet, 03 check it live. The snippets name
   the real addresses integrators call and that never move (server/hosts.mjs): embed.gullylabs.xyz/embed/holders,
   embed.gullylabs.xyz/widget.js, the badge SVG and api.gullylabs.xyz/api/holders. Copying is a real event, so it
   toasts. Without a token (the landing) the snippets use the token of the moment, or a 0x… placeholder. */
import { useState } from 'react'
import { ArrowUpRight, Code2, Copy, Eye, LayoutTemplate, Plug, Tag } from 'lucide-react'
import { consoleToast } from '../console/toast'
import { API_URL, EMBED_URL, holderAbsUrl } from '../site-host'
import { HmSteps, type HmStep } from './HmKit'

type Fmt = 'embed' | 'widget' | 'badge' | 'api'
const FMTS: { id: Fmt; label: string; icon: typeof Plug; what: string }[] = [
  { id: 'embed', label: 'Embed', icon: LayoutTemplate, what: 'The full interactive map in an iframe: bubbles, clusters, replay and live transfers.' },
  { id: 'widget', label: 'Widget', icon: Plug, what: 'One script tag and a div: a compact live holder card that follows your page’s theme.' },
  { id: 'badge', label: 'Badge', icon: Tag, what: 'A live SVG badge with the token’s holder health, linking back to its map.' },
  { id: 'api', label: 'API', icon: Code2, what: 'The same map as JSON: holders, shares, clusters and the summary line.' },
]
const STEPS: HmStep[] = [
  { t: 'Pick', d: 'Embed, widget, badge or API' },
  { t: 'Copy', d: 'One snippet, no build step' },
  { t: 'Check it', d: 'See it live before you ship' },
]

function snippet(f: Fmt, chain: string, token: string) {
  const page = holderAbsUrl(`/holders/${chain}/${token}`)
  if (f === 'embed') return `<iframe src="${EMBED_URL}/embed/holders/${chain}/${token}" title="HolderMaps" width="100%" height="760" style="border:0" loading="lazy"></iframe>`
  if (f === 'widget') return `<div data-gully-widget="holders" data-chain="${chain}" data-token="${token}"></div>\n<script src="${EMBED_URL}/widget.js" async></script>`
  if (f === 'badge') return `<a href="${page}" target="_blank" rel="noopener noreferrer"><img src="${EMBED_URL}/api/holders/${chain}/${token}/badge.svg" alt="HolderMaps" height="24"></a>`
  return `curl ${API_URL}/api/holders/${chain}/${token}`
}

export function HmIntegrate({ chain, token, symbol }: { chain: string | null; token: string | null; symbol?: string | null }) {
  const [fmt, setFmt] = useState<Fmt | null>(null)
  const [copied, setCopied] = useState(false)
  const real = !!(chain && token)
  const c = chain ?? 'gully'
  const t = token ?? '0x…'
  const code = fmt ? snippet(fmt, c, t) : ''
  const at = !fmt ? 0 : !copied ? 1 : 2
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      consoleToast({ title: 'Snippet copied', text: `The ${fmt} snippet for ${symbol ? `$${symbol}` : real ? 'this token' : 'your token'} is on your clipboard.`, icon: 'check' })
    } catch {
      consoleToast({ title: 'Could not copy', text: 'Your browser blocked the clipboard: select the snippet and copy it by hand.', icon: 'zap' })
    }
  }
  const preview = fmt === 'embed' ? `${EMBED_URL}/embed/holders/${c}/${t}` : fmt === 'api' ? `${API_URL}/api/holders/${c}/${t}` : holderAbsUrl(`/holders/${c}/${t}`)
  return (
    <div className="hmt-integrate" data-integrate>
      <HmSteps steps={STEPS} at={at} label="Put a map on your site" />
      <div className="hmt-stepbody">
        <div className="hmt-seg" role="group" aria-label="Format">
          {FMTS.map((f) => {
            const I = f.icon
            return (
              <button
                key={f.id}
                type="button"
                aria-pressed={fmt === f.id}
                onClick={() => {
                  setFmt(f.id)
                  setCopied(false)
                }}
              >
                <I className="hm-ic" aria-hidden /> {f.label}
              </button>
            )
          })}
        </div>
        {!fmt ? (
          <p className="hm-note">Pick a format to get its snippet{real ? (symbol ? ` for $${symbol}` : ' for this token') : ''}. Free, no key needed for the embed, the widget and the badge.</p>
        ) : (
          <>
            <p className="hm-note">{FMTS.find((f) => f.id === fmt)?.what}</p>
            <pre className="hmt-snip" aria-label={`${fmt} snippet`}>
              <code>{code}</code>
            </pre>
            <div className="hmt-acts">
              <button type="button" className="hm-btn" onClick={copy} data-copy-snippet>
                <Copy aria-hidden className="hm-ic" /> {copied ? 'Copied' : 'Copy snippet'}
              </button>
              {real && (
                <a className="hm-btn ghost" href={preview} target="_blank" rel="noopener noreferrer">
                  <Eye aria-hidden className="hm-ic" /> Check it live <ArrowUpRight aria-hidden className="hm-ic sm" />
                  <span className="hm-sr"> (opens in a new tab)</span>
                </a>
              )}
              <a className="hm-btn ghost" href="https://docs.gullylabs.xyz/holder-map-integrate" target="_blank" rel="noopener noreferrer">
                Docs <ArrowUpRight aria-hidden className="hm-ic sm" />
                <span className="hm-sr"> (opens in a new tab)</span>
              </a>
            </div>
            {fmt === 'badge' && real && (
              <div className="hmt-preview">
                <span className="gt-k">Live preview</span>
                <img src={`/api/holders/${c}/${t}/badge.svg`} alt="HolderMaps badge for this token" height={24} data-badge-img />
              </div>
            )}
            {!real && <p className="hmt-fine">Replace 0x… with your token. Every token’s own map has these snippets filled in.</p>}
          </>
        )}
      </div>
    </div>
  )
}
