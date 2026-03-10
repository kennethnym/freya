import type { Hono } from "hono"

import { auth } from "./index.ts"

export function registerAuthHandlers(app: Hono): void {
	app.on(["POST", "GET"], "/api/auth/*", (c) => auth.handler(c.req.raw))
}
