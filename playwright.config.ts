import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests/browser',
  workers: 1,
  timeout: 60_000,
  projects: [{ name: 'single-worker' }, { name: 'parallel-workers' }],
  use: { baseURL: 'http://127.0.0.1:43827/music_sheet_tools/', channel: process.env.PLAYWRIGHT_CHANNEL || undefined },
  webServer: { command: 'npm run preview -- --host 127.0.0.1 --port 43827 --strictPort', url: 'http://127.0.0.1:43827/music_sheet_tools/' },
})

