import type { Context, MiddlewareHandler, Next } from "hono"

import type { AuthSession, AuthUser } from "./session.ts"

import { auth } from "./index.ts"

export interface SessionVariables {
	user: AuthUser | null
	session: AuthSession | null
}

export type AuthSessionEnv = { Variables: SessionVariables }

export type AuthSessionMiddleware = MiddlewareHandler<AuthSessionEnv>

declare module "hono" {
	interface ContextVariableMap extends SessionVariables {}
}

/**
 * Middleware that attaches session and user to the context.
 * Does not reject unauthenticated requests - use requireSession for that.
 */
export async function sessionMiddleware(c: Context, next: Next): Promise<void> {
	const session = await auth.api.getSession({ headers: c.req.raw.headers })

	if (session) {
		c.set("user", session.user)
		c.set("session", session.session)
	} else {
		c.set("user", null)
		c.set("session", null)
	}

	await next()
}

/**
 * Middleware that requires a valid session. Returns 401 if not authenticated.
 */
export async function requireSession(c: Context, next: Next): Promise<Response | void> {
	const session = await auth.api.getSession({ headers: c.req.raw.headers })

	if (!session) {
		return c.json({ error: "Unauthorized" }, 401)
	}

	c.set("user", session.user)
	c.set("session", session.session)
	await next()
}

/**
 * Get session from headers. Useful for WebSocket upgrade validation.
 */
export async function getSessionFromHeaders(
	headers: Headers,
): Promise<{ user: AuthUser; session: AuthSession } | null> {
	const session = await auth.api.getSession({ headers })
	return session
}

/**
 * Dev/test middleware that injects a fake user and session.
 * Pass userId to simulate an authenticated request, or omit to get 401.
 */
export function mockAuthSessionMiddleware(userId?: string): AuthSessionMiddleware {
	return async (c: Context, next: Next): Promise<Response | void> => {
		if (!userId) {
			return c.json({ error: "Unauthorized" }, 401)
		}

		const now = new Date()
		const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)

		const user: AuthUser = {
			id: "k7Gx2mPqRvNwYs9TdLfA4bHcJeUo1iZn",
			name: "Dev User",
			email: "dev@aelis.local",
			emailVerified: true,
			image: null,
			createdAt: now,
			updatedAt: now,
		}

		const session: AuthSession = {
			id: "Wt3FvBpXaQrMhD8sKjE6LcYn0gUz5iRo",
			userId: "k7Gx2mPqRvNwYs9TdLfA4bHcJeUo1iZn",
			token: "Vb9CxNfRm2KwQs7TjPeA5dLhYg0UoZi4",
			expiresAt,
			ipAddress: "127.0.0.1",
			userAgent: "aelis-dev",
			createdAt: now,
			updatedAt: now,
		}

		c.set("user", user)
		c.set("session", session)

		await next()
	}
}
