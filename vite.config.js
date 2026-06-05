import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// PWA(바로가기 설치)는 vite-plugin-pwa의 precache 대신 public/sw.js(네트워크 통과 전용)로 직접 처리.
// → 앱 파일을 캐시하지 않으므로 옛 버전 잡힘/크래시 루프가 구조적으로 불가능. 설치만 가능.
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
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
