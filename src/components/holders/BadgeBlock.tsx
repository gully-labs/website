import { Copy, Tag } from 'lucide-react'
import { copyWithToast } from '../ui/toast'
import { btnOutline } from '../ui'
import { EMBED_URL, holderAbsUrl } from '../../site-host'

/* The token's live Holder Map badge (GET /api/holders/:chain/:token/badge.svg, cached map data only) with copy
   buttons for an HTML and a Markdown embed that link back to the map page. */


export function BadgeBlock({ chain, token }: { chain: string; token: string }) {
  const page = holderAbsUrl(`/holders/${chain}/${token}`)
  const img = `${EMBED_URL}/api/holders/${chain}/${token}/badge.svg`
  const html = `<a href="${page}"><img src="${img}" alt="Holder Map by Gully Labs" height="24"></a>`
  const md = `[![Holder Map by Gully Labs](${img})](${page})`
  return (
    <section aria-labelledby="hm-badge" className="card card-pad flex flex-wrap items-center justify-between gap-x-4 gap-y-2" data-badge-block>
      <div className="flex min-w-0 flex-col gap-1">
        <h2 id="hm-badge" className="eyebrow flex items-center gap-2">
          <Tag className="icon-sm" aria-hidden /> Badge
        </h2>
        <p className="m-0 text-[13px] leading-[1.5] text-muted">Show this token’s live holder health on your site.</p>
        <img src={`/api/holders/${chain}/${token}/badge.svg`} alt="Holder Map badge for this token" height={24} className="mt-1 h-6 w-auto self-start" data-badge-img />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => copyWithToast(html, 'HTML snippet')} className={`${btnOutline} inline-flex min-h-11 items-center gap-2 px-4 text-[13px]`} data-copy-html>
          <Copy className="icon-sm" aria-hidden /> Copy HTML
        </button>
        <button type="button" onClick={() => copyWithToast(md, 'Markdown snippet')} className={`${btnOutline} inline-flex min-h-11 items-center gap-2 px-4 text-[13px]`} data-copy-md>
          <Copy className="icon-sm" aria-hidden /> Copy Markdown
        </button>
      </div>
    </section>
  )
}
