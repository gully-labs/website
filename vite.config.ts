import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { readStats } from './server/stats.mjs'
import { readHistory, readTracker } from './server/tracker.mjs'
import { handleAdmin } from './server/admin.mjs'
import { handleDeveloper } from './server/developer.mjs'
import { handlePay } from './server/invoices.mjs'
import { publicPlans } from './server/plans.mjs'

// In dev there is no serverless runtime, so answer /api/contact locally.
function mockContactApi(): Plugin {
  return {
    name: 'mock-contact-api',
    configureServer(server) {
      server.middlewares.use('/api/contact', (req, res) => {
        let body = ''
        req.on('data', (chunk) => (body += chunk))
        req.on('end', () => {
          console.log('[dev] /api/contact', body)
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ ok: true }))
        })
      })
    },
  }
}

// In dev the same aggregator the production server runs answers /api/stats.
function statsApi(): Plugin {
  return {
    name: 'stats-api',
    configureServer(server) {
      server.middlewares.use('/api/stats', (_req, res) => {
        readStats().then(
          (body) => {
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify(body))
          },
          (err) => {
            res.statusCode = 502
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ error: String(err?.message ?? err) }))
          },
        )
      })
    },
  }
}

// In dev the tracker answers from the same module the production server runs.
function trackerApi(): Plugin {
  return {
    name: 'tracker-api',
    configureServer(server) {
      server.middlewares.use('/api/tracker/history', (req, res) => {
        const q = new URL(req.url ?? '', 'http://x').searchParams
        const chain = q.get('chain') ?? 'robinhood'
        const ticker = q.get('ticker') ?? ''
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify({ chain, ticker: ticker.toUpperCase(), points: readHistory(chain, ticker) }))
      })
      server.middlewares.use('/api/tracker', (req, res, next) => {
        if ((req.url ?? '/').replace(/\?.*$/, '') !== '/') return next()
        readTracker().then(
          (body) => {
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify(body))
          },
          (err: unknown) => {
            res.statusCode = 502
            res.end(JSON.stringify({ error: String(err) }))
          },
        )
      })
    },
  }
}

// In dev the admin and developer APIs answer from the same modules the production server runs.
function serverModules(): Plugin {
  return {
    name: 'server-modules',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = new URL(req.url ?? '/', 'http://localhost')
        if (url.pathname === '/api/plans') {
          res.setHeader('Content-Type', 'application/json')
          return res.end(JSON.stringify(publicPlans()))
        }
        const handler = url.pathname.startsWith('/api/admin/') ? handleAdmin : url.pathname.startsWith('/api/developer/') ? handleDeveloper : url.pathname.startsWith('/api/pay/') ? handlePay : null
        if (!handler) return next()
        handler(req, res, url).then((done) => {
          if (done) return
          res.statusCode = 404
          res.setHeader('Content-Type', 'application/json')
          res.end('{"error":"not found"}')
        }, next)
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss(), mockContactApi(), statsApi(), trackerApi(), serverModules()],
})
