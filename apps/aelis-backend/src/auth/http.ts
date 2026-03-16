import type { Hono } from "hono"

import type { Auth } from "./index.ts"

export function registerAuthHandlers(app: Hono, auth: Auth): void {
	app.on(["POST", "GET"], "/api/auth/*", (c) => auth.handler(c.req.raw))
}
