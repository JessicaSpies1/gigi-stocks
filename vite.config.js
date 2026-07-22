import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
// In production (GitHub Pages project site) assets are served from
// /gigi-stocks/. Local dev stays at root. Data fetches use import.meta.env.BASE_URL
// so they resolve correctly in both.
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/gigi-stocks/' : '/',
  plugins: [react()],
}))
