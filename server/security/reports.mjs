// Published Gully Security reports, for the Gully Score (gully-score.mjs, part 3). Only a report its owner
// PUBLISHED counts (security-routes.mjs publish route; the public snapshot stored on the job); whether the
// scan was free or paid never matters. Nothing private (draft PoC code, the workspace) is read here.

import { CHAINS } from './chains.mjs'
import { publishedJobs } from '../security-store.mjs'
import { scopeLabel } from '../security-contract.mjs'

const SITE = 'https://gullylabs.xyz'
const SEVERITIES = ['critical', 'high', 'medium', 'low', 'info']

/**
 * The newest published scan report of a deployed contract, or null.
 * @returns {{ url: string, title: string, publishedAt: string, status: 'published', severities: Record<string, number> } | null}
 */
export function publishedReportFor(chainId, address) {
  const chain = CHAINS[Number(chainId)]?.key
  const addr = String(address ?? '').toLowerCase()
  if (!chain || !/^0x[0-9a-f]{40}$/.test(addr)) return null
  // publishedJobs() is newest first and holds only published, finished scans with a stored snapshot.
  const job = publishedJobs().find((j) => j.snapshot && j.input?.kind === 'address' && j.input.chain === chain && j.input.address === addr)
  if (!job) return null
  const counts = job.snapshot.summary?.counts ?? job.counts ?? {}
  return {
    url: `${SITE}/security/reports/${job.id}`,
    title: `AI Security Scan: ${scopeLabel(job.input)}`,
    publishedAt: job.publishedAt,
    status: 'published',
    severities: Object.fromEntries(SEVERITIES.map((s) => [s, Number(counts[s] ?? 0)])),
  }
}
