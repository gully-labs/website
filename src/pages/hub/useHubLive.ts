/* One shared poller for /api/hub/live (server/hub-live.mjs: Gully ID stats, Gully Pay status, Gully RPC status.json
   and the Gully Chain indexer, read server-side), used by the landing and the Gully ID product page. */
import { useSyncExternalStore } from 'react'
import { poller } from '../../terminal/kit'
import type { HubLive } from './hubData'

const livePoll = poller<HubLive>('/api/hub/live', 45_000)
export const useHubLive = () => useSyncExternalStore(livePoll.subscribe, livePoll.get, livePoll.get)
