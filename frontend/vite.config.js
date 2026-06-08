import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // nameGenerator backend (8002) — strip /api/gen prefix before forwarding
      '/api/gen': {
        target: 'http://localhost:8002',
        changeOrigin: true,
        rewrite: path => path.replace(/^\/api\/gen/, '/api'),
      },
      // domainscraper backend (8001) — strip /api/domain prefix before forwarding
      '/api/domain': {
        target: 'http://localhost:8001',
        changeOrigin: true,
        rewrite: path => path.replace(/^\/api\/domain/, '/api'),
      },
    },
  },
})
