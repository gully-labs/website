import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

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

export default defineConfig({
  plugins: [react(), tailwindcss(), mockContactApi()],
})
