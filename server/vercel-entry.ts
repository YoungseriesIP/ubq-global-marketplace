// Vercel function entry. All /api/* requests are rewritten here (see vercel.json).

import { getRequestListener } from '@hono/node-server'
import { app } from './app'

export default getRequestListener(app.fetch)
