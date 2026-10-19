// Discovery files for people and machines: /.well-known/contracts.json, /llms.txt and /llms-full.txt.
// The bodies are built from the typed catalogs by scripts/build-discovery.mjs and committed under server/data/
// (npm run test:contracts fails when they are stale). Served on every host, public, open CORS.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'data')
const FILES = {
  '/.well-known/contracts.json': ['contracts.json', 'application/json; charset=utf-8'],
  '/llms.txt': ['llms.txt', 'text/plain; charset=utf-8'],
  '/llms-full.txt': ['llms-full.txt', 'text/plain; charset=utf-8'],
}
const cache = new Map()
const body = (file) => {
  if (!cache.has(file)) cache.set(file, fs.readFileSync(path.join(DIR, file)))
  return cache.get(file)
}

/** Answers a discovery path; false when the path is not one of them. */
export function handleDiscovery(req, res, url) {
  const f = FILES[url.pathname]
  if (!f) return false
  const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS', 'Access-Control-Max-Age': '86400' }
  if (req.method === 'OPTIONS') {
    res.writeHead(204, cors)
    res.end()
    return true
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { ...cors, Allow: 'GET, HEAD, OPTIONS' })
    res.end()
    return true
  }
  const b = body(f[0])
  res.writeHead(200, { ...cors, 'Content-Type': f[1], 'Content-Length': b.length, 'Cache-Control': 'public, max-age=3600, stale-while-revalidate=86400', 'X-Content-Type-Options': 'nosniff' })
  res.end(req.method === 'HEAD' ? undefined : b)
  return true
}
