import { lazy, Suspense } from 'react'
import { Skeleton } from '../parts'
import type { ServiceCtx } from './links'
import type { ServiceTab } from './nav'

/* One service page at a time, each its own chunk: the dashboard never downloads a service page until
   it is opened. The skeleton holds the header and a body so nothing jumps when the chunk lands. */

const VIEWS = {
  tracker: lazy(() => import('./TrackerView')),
  pay: lazy(() => import('./PayView')),
  'chain-kit': lazy(() => import('./ChainKitView')),
  ai: lazy(() => import('./AiView')),
  deepcore: lazy(() => import('./DeepcoreView')),
  holders: lazy(() => import('./HoldersView')),
  widgets: lazy(() => import('./WidgetsView')),
  telegram: lazy(() => import('./TelegramView')),
} satisfies Record<ServiceTab, unknown>

function Loading() {
  return (
    <div role="status" aria-label="Loading the page" className="flex flex-col gap-4">
      <Skeleton h={44} w="min(420px,100%)" />
      <Skeleton h={78} />
      <Skeleton h={320} />
    </div>
  )
}

export function ServiceView({ id, ctx }: { id: ServiceTab; ctx: ServiceCtx }) {
  const View = VIEWS[id]
  return (
    <Suspense fallback={<Loading />}>
      <div className="flex flex-col gap-4" data-service={id}>
        <View ctx={ctx} />
      </div>
    </Suspense>
  )
}
