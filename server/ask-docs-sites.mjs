// Gully AI: the PUBLIC docs sites of our other products, as remote sources (used by ask-remote.mjs).
//
// Only the hosts listed in DOC_SITES are ever fetched, https only, same host only (a sitemap or a page cannot send the
// reader elsewhere), at most MAX_PAGES pages per site, 4 at a time. Each page is cut to its main text (navigation,
// header, footer, scripts and forms removed) and chunked like any other source. The refresh loop then runs every chunk
// through ask-public-guard.mjs, so internal data on a page never reaches the index.

import { chunkSection, clean, markdownSections } from './ask-index.mjs'

/** `start` pages are read when the host has no sitemap.xml. */
export const DOC_SITES = [
  { key: 'docs:swoop', label: 'Swoop Ads docs', source: 'Swoop Ads docs', host: 'docs.swoopads.xyz', start: ['/'] },
  { key: 'docs:core', label: 'Gully Core docs', source: 'Gully Core docs', host: 'docs.gullycore.xyz', start: ['/'] },
  { key: 'docs:chain', label: 'Gully Chain docs', source: 'Gully Chain docs', host: 'docs.gullychain.xyz', start: ['/'] },
  { key: 'docs:kre8', label: 'kre8 docs', source: 'kre8 docs', host: 'docs.kre8.fun', start: ['/'] },
  { key: 'docs:id', label: 'Gully ID docs', source: 'Gully ID docs', host: 'gullyid.xyz', start: ['/developers'] },
  { key: 'docs:rpc', label: 'Gully RPC docs', source: 'Gully RPC docs', host: 'gullyrpc.xyz', start: ['/', '/docs'] },
  { key: 'docs:studio', label: 'Gully Studio site', source: 'Gully Studio docs', host: 'gullystudio.xyz', start: ['/'] },
  { key: 'docs:multisig', label: 'Gully Multisig docs', source: 'Gully Multisig docs', host: 'gullymultisig.xyz', start: ['/'] },
]
export const MAX_PAGES = 40
const SKIP_PATH = /^\/(?:admin|api|auth|oauth2?|login|logout|account|wallet|assets|static|_)(?:\/|$)|\.(?:png|jpe?g|gif|svg|webp|ico|css|js|json|xml|zip|pdf|woff2?)$/i

/** HTML of one page to { title, sections } for chunking. */
export function htmlToSections(html) {
  const raw = String(html ?? '')
  const title = clean((raw.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '').replace(/<[^>]+>/g, ''))
    .replace(/\s*[|·–—-]\s*[^|·–—-]*$/, '')
    .slice(0, 160)
  const main = raw.match(/<main[\s\S]*?<\/main>/i)?.[0] ?? raw.match(/<body[\s\S]*<\/body>/i)?.[0] ?? raw
  const body = main.replace(/<(script|style|noscript|svg|template|nav|header|footer|aside|form|iframe)\b[\s\S]*?<\/\1>/gi, ' ')
  return { title, sections: markdownSections(body, { maxWords: 1_500 }) }
}

/** Same-host https page URLs from a sitemap (<loc>) or, without one, the links on a page. */
export function pageUrls(site, text, base) {
  const found = new Set()
  const add = (u0) => {
    try {
      const u = new URL(u0, base)
      if (u.protocol !== 'https:' || u.hostname !== site.host || SKIP_PATH.test(u.pathname)) return
      u.hash = ''
      u.search = ''
      found.add(u.toString())
    } catch {
      /* not a url */
    }
  }
  for (const m of text.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)) add(m[1])
  if (!found.size) for (const m of text.matchAll(/href="([^"#?]+)"/gi)) add(m[1])
  return [...found].slice(0, MAX_PAGES)
}

/** A remote source ({ key, label, load(fetchImpl) }) for one docs site; `getText(f, url)` is ask-remote's fetcher. */
export function docSource(site, getText) {
  return {
    key: site.key,
    label: site.label,
    async load(f) {
      const origin = `https://${site.host}`
      let urls = []
      let lastError = null
      try {
        urls = pageUrls(site, await getText(f, `${origin}/sitemap.xml`), origin)
      } catch {
        /* no sitemap: the start pages and the links on them */
      }
      if (!urls.length) {
        for (const s of site.start) {
          try {
            const u = new URL(s, origin).toString()
            urls.push(u, ...pageUrls(site, await getText(f, u), origin))
          } catch (e) {
            lastError = e // next start page
          }
        }
        urls = [...new Set(urls)].slice(0, MAX_PAGES)
      }
      const out = []
      for (let i = 0; i < urls.length; i += 4) {
        await Promise.all(
          urls.slice(i, i + 4).map(async (u) => {
            try {
              const { title, sections } = htmlToSections(await getText(f, u))
              for (const sec of sections) out.push(...chunkSection({ source: site.source, title: title || site.label, url: u, section: sec.heading, paragraphs: sec.paras }))
            } catch (e) {
              lastError = e // one page failing keeps the others
            }
          }),
        )
      }
      if (!out.length) throw lastError ?? new Error('no public text found')
      return out
    },
  }
}
