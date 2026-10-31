import react from '@vitejs/plugin-react'
import { defineConfig, type ProxyOptions } from 'vite'

// The ANEEL open data portal may not send CORS headers. The app calls it
// directly first and falls back to this same-origin proxy (dev and preview).
const aneelProxy: Record<string, ProxyOptions> = {
  '/aneel-api': {
    target: 'https://dadosabertos.aneel.gov.br',
    changeOrigin: true,
    rewrite: (path) => path.replace(/^\/aneel-api/, ''),
  },
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: { proxy: aneelProxy },
  preview: { proxy: aneelProxy },
  build: {
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            // leafletGlobal must share the chunk with Geoman so it runs first.
            {
              name: 'map',
              test: /node_modules[\\/](leaflet|react-leaflet|@react-leaflet|@geoman-io)|src[\\/]lib[\\/]leafletGlobal/,
            },
            { name: 'charts', test: /node_modules[\\/](recharts|d3-|victory-vendor|@reduxjs|immer|reselect)/ },
            { name: 'react', test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/ },
          ],
        },
      },
    },
  },
})
