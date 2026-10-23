import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      devOptions: { enabled: false },
      includeAssets: ['icon.svg'],
      manifest: {
        name: 'Assembly',
        short_name: 'Assembly',
        description: "Tonight's underground: DIY shows, raves, queer dance nights.",
        theme_color: '#07080f',
        background_color: '#07080f',
        display: 'standalone',
        start_url: '/',
        icons: [{ src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' }],
      },
    }),
  ],
  worker: { format: 'es' },
  server: { port: 5173 },
})
