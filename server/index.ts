// Bun entry: serves the API and the built front end (dist/).
// Run with: bun run server   (dev, proxied by Vite under /api)   or   bun run start   (production)

import { serveStatic } from 'hono/bun'
import { app } from './app'

app.use('/*', serveStatic({ root: './dist' }))
app.get('*', serveStatic({ path: './dist/index.html' }))

// Hosted containers set PORT; local dev defaults to 3001.
const port = Number(process.env.PORT ?? (process.env.NODE_ENV === 'production' ? 7860 : 3001))
console.log(`TradePort API listening on :${port}`)

export default { port, fetch: app.fetch, maxRequestBodySize: 256 * 1024 }
