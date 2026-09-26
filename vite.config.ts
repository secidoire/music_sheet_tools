import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Served from GitHub Pages as a project page: https://<user>.github.io/music_sheet_tools/
// Every runtime URL (worker, pdf.js worker, vendor assets) is resolved against this base.
export default defineConfig({
  base: '/music_sheet_tools/',
  plugins: [react()],
  worker: { format: 'es' },
  // pdf.js and its worker are large by nature; the app is a single screen, so no splitting.
  build: { chunkSizeWarningLimit: 2000 },
})
