import { Link } from 'react-router'
import { ScanSearch } from 'lucide-react'

/* The home console's Holder Map tab. Until 2026-11-08 it showed the newest DeepCore launch's mini map and the latest
   DeepCore launches (GET /api/deepcore/launches). That feed was retired with the rest of the DeepCore integrations
   (owner, 2026-11-08); the Gully Core launch feed is not wired here yet, so the tab says so plainly and sends people
   to the Holder Map itself, where any token can be looked up. Nothing is invented and no empty chart frame is drawn. */

export default function HolderPane() {
  return (
    <div className="flex flex-col gap-4" data-console-holders>
      <div className="card card-pad flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <ScanSearch className="size-5 text-dim" aria-hidden="true" />
          <h3 className="text-[15px] font-semibold text-ink">Holder Map</h3>
        </div>
        <p className="text-[14px] leading-relaxed text-dim">
          Look up who holds any token: bundled buys, the deployer’s share and the wallets that move together. The live launch feed shown here
          until 8 November 2026 came from DeepCore and was retired; Gully Core launches will take its place when their feed is wired.
        </p>
        <Link to="/holders" className="btn btn-primary self-start" data-console-holders-open>
          Open the Holder Map
        </Link>
      </div>
    </div>
  )
}
