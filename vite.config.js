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
      injectRegister: false, // 등록은 main.jsx에서 명시적으로 1곳만
      workbox: {
        // 해시된 정적 자산(JS/CSS/이미지/폰트)만 precache. index.html은 절대 precache 안 함.
        globPatterns: ['**/*.{js,css,ico,svg,woff2}', 'icon-*.png', 'ttongpa.png'],
        globIgnores: ['**/ttlogo1.png'], // 5.65MB 대형 로고는 precache 제외(런타임 로드)
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        cleanupOutdatedCaches: true,
        skipWaiting: true,
        clientsClaim: true,
        // ★ 핵심: 페이지 이동(HTML)은 항상 네트워크 우선 → 옛 index/청크를 잡아 생기던 크래시 원천 차단.
        navigateFallback: null,
        runtimeCaching: [
          {
            urlPattern: ({ request }) => request.mode === 'navigate',
            handler: 'NetworkFirst',
            options: { cacheName: 'html-nf', networkTimeoutSeconds: 4, expiration: { maxEntries: 10 } },
          },
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
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
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
