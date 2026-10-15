import type { VercelRequest, VercelResponse } from '@vercel/node'
// The same aggregator the self-hosted server runs (server/stats.mjs), for a Vercel deployment.
import { readStats } from '../server/stats.mjs'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET')
    return res.status(405).json({ error: 'Method not allowed' })
  }
  try {
    res.setHeader('Cache-Control', 'public, max-age=30')
    return res.status(200).json(await readStats())
  } catch (err) {
    return res.status(502).json({ error: String((err as Error)?.message ?? err) })
  }
}
