import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,svg,woff2}'],
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/.*\.googleapis\.com\/.*/i,
            handler: 'NetworkFirst',
            options: { cacheName: 'google-apis', expiration: { maxEntries: 50, maxAgeSeconds: 300 } },
          },
          {
            urlPattern: /^https:\/\/.*\.kakao\.com\/.*/i,
            handler: 'NetworkFirst',
            options: { cacheName: 'kakao-apis', expiration: { maxEntries: 50, maxAgeSeconds: 300 } },
          },
        ],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//],
      },
      manifest: {
        name: 'Nexus Pipeline',
        short_name: 'Nexus',
        description: '웰쉐어 명단 정제 및 기사 배분 시스템',
        theme_color: '#1e293b',
        background_color: '#0f172a',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
        ],
      },
    }),
  ],
  build: {
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      output: {
        // rolldown(Vite 8)은 함수형 manualChunks 필요
        manualChunks(id) {
          if (id.includes('firebase/firestore') || id.includes('@firebase/firestore')) {
            return 'firebase-firestore';
          }
          if (id.includes('firebase/auth') || id.includes('@firebase/auth')) {
            return 'firebase-auth';
          }
          if (id.includes('jspdf') || id.includes('html2canvas')) {
            return 'pdf-export';
          }
          if (id.includes('lucide-react')) {
            return 'icons';
          }
        },
      },
    },
  },
  optimizeDeps: {
    include: ['react', 'react-dom'],
  },
})
