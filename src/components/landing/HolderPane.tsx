import { useEffect, useState } from 'react'
import { HolderMapMini } from '../holders/HolderMapMini'
import { LaunchHolders } from '../holders/LaunchHolders'

/* The home console's Holder Map tab (design audit X11): the live mini map of the newest Gully Chain launch (the
   animated bubbles, the launch-health ring and the top-10 share since launch, all from the Holder Map's own
   components) with the latest launches under it, each linking to its full map. Stock maps are not shown here:
   they appear only where an archive RPC is configured (see /holders). Nothing is typed in: the launch comes
   from GET /api/holders/launches (the Gully Launchpad, read from our own indexer), and a quiet feed says so. */

type Latest = { chainKey: string; token: string } | null

export default function HolderPane() {
  const [first, setFirst] = useState<Latest | undefined>(undefined)
  useEffect(() => {
    let alive = true
    fetch('/api/holders/launches')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then(
        (b: { launches?: { chainKey: string; token: string }[] }) => alive && setFirst(b.launches?.[0] ? { chainKey: b.launches[0].chainKey, token: b.launches[0].token } : null),
        () => alive && setFirst(null),
      )
    return () => {
      alive = false
    }
  }, [])
  return (
    <div className="flex flex-col gap-4" data-console-holders>
      {first === undefined && <div role="status" aria-label="Reading the newest launch" className="h-[132px] animate-[gl-skeleton_1.4s_ease-in-out_infinite] card" />}
      {first && <HolderMapMini chain={first.chainKey} token={first.token} />}
      <div className="card card-pad">
        <LaunchHolders limit={5} />
      </div>
    </div>
  )
}
