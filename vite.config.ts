import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: './',
  server: {
    host: '0.0.0.0',
    port: 5173,
    allowedHosts: ['bcim.ddns.net'],
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    // Electron loads chunks from local disk — bundle size doesn't affect load time
    // the way it would for a web app. Raise the limit to avoid noise.
    chunkSizeWarningLimit: 3000,
    rollupOptions: {
      output: {
        manualChunks: (id) => {
          if (id.includes('pdfjs-dist'))   return 'vendor-pdfjs'
          if (id.includes('pdf-lib'))      return 'vendor-pdflib'
          if (id.includes('tesseract'))    return 'vendor-tesseract'
          if (id.includes('react') || id.includes('lucide-react'))
                                           return 'vendor-react'
          // exceljs + its archiving/streaming transitive deps
          if (id.includes('exceljs') || id.includes('archiver') ||
              id.includes('zip-stream') || id.includes('lazystream') ||
              id.includes('fstream'))      return 'vendor-exceljs'
          // Remaining office libs (mammoth, docx, jspdf, html2canvas, …)
          if (id.includes('node_modules')) return 'vendor-office'
        },
      },
    },
  },
  optimizeDeps: {
    exclude: ['pdfjs-dist'],
  },
})
