import { defineConfig } from 'vite'

export default defineConfig({
  build: {
    target: 'es2022',
    cssTarget: 'chrome100',
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      output: {
        // Pecah vendor agar tetap di-cache saat kode aplikasi berubah
        manualChunks(id) {
          if (id.includes('node_modules/three/')) return 'three'
          if (/node_modules\/(react|react-dom|scheduler)\//.test(id)) return 'react'
        },
      },
    },
  },
})
