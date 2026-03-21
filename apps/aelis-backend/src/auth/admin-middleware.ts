import type { Context, MiddlewareHandler, Next } from "hono"

import type { Auth } from "./index.ts"
import type { AuthSessionEnv } from "./session-middleware.ts"

export type AdminMiddleware = MiddlewareHandler<AuthSessionEnv>

/**
 * Creates a middleware that requires a valid session with admin role.
 * Returns 401 if not authenticated, 403 if not admin.
 */
export function createRequireAdmin(auth: Auth): AdminMiddleware {
	return async (c: Context, next: Next): Promise<Response | void> => {
		const session = await auth.api.getSession({ headers: c.req.raw.headers })

		if (!session) {
			return c.json({ error: "Unauthorized" }, 401)
		}

		if (session.user.role !== "admin") {
			return c.json({ error: "Forbidden" }, 403)
		}

		c.set("user", session.user)
		c.set("session", session.session)
		await next()
	}
}
