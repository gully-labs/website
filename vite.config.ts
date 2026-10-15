import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { readStats } from './server/stats.mjs'

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

export default defineConfig({
  plugins: [react(), tailwindcss(), mockContactApi(), statsApi()],
})
