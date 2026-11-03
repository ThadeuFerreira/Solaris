import react from '@vitejs/plugin-react'
import { tsImport } from 'tsx/esm/api'
import { defineConfig, type Connect, type Plugin } from 'vite'

// Mounts the SQLite-backed API (server/) on the dev and preview servers, so
// `npm run dev` runs frontend and backend in one process. The server code is
// loaded through tsx on the first /api request, so the config never bundles
// it and the database is not opened by builds or tests.
function solarisApi(): Plugin {
  let handler: Promise<Connect.NextHandleFunction> | null = null
  const load = async (): Promise<Connect.NextHandleFunction> => {
    const entry = new URL('./server/app.ts', import.meta.url).href
    const { createSolarisApi } = await tsImport(entry, import.meta.url)
    return createSolarisApi(process.env.SOLARIS_DB ?? 'data/solaris.db')
  }
  const middleware: Connect.NextHandleFunction = (req, res, next) => {
    if (!req.url?.startsWith('/api/')) return next()
    handler ??= load()
    handler.then((h) => h(req, res, next), next)
  }
  return {
    name: 'solaris-api',
    configureServer: (server) => void server.middlewares.use(middleware),
    configurePreviewServer: (server) => void server.middlewares.use(middleware),
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), solarisApi()],
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
