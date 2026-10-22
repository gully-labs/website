import type { VercelRequest, VercelResponse } from '@vercel/node'
// The same on-chain reader the self-hosted server runs (server/peddles.mjs), for a Vercel deployment.
import { handlePeddlesOnchain } from '../../server/peddles.mjs'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET')
    return res.status(405).json({ error: 'Method not allowed' })
  }
  try {
    res.setHeader('Cache-Control', 'public, max-age=20')
    return res.status(200).json(await handlePeddlesOnchain())
  } catch (err) {
    return res.status(502).json({ error: String((err as Error)?.message ?? err) })
  }
}
