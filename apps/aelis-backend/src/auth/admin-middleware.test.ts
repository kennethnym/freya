import { Hono } from "hono"
import { describe, expect, test } from "bun:test"

import type { Auth } from "./index.ts"
import type { AuthSession, AuthUser } from "./session.ts"

import { createRequireAdmin } from "./admin-middleware.ts"

function makeUser(role: string | null): AuthUser {
	const now = new Date()
	return {
		id: "user-1",
		name: "Test User",
		email: "test@example.com",
		emailVerified: true,
		image: null,
		createdAt: now,
		updatedAt: now,
		role,
		banned: false,
		banReason: null,
		banExpires: null,
	}
}

function makeSession(): AuthSession {
	const now = new Date()
	return {
		id: "sess-1",
		userId: "user-1",
		token: "tok-1",
		expiresAt: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000),
		ipAddress: "127.0.0.1",
		userAgent: "test",
		createdAt: now,
		updatedAt: now,
	}
}

function mockAuth(sessionResult: { user: AuthUser; session: AuthSession } | null): Auth {
	return {
		api: {
			getSession: async () => sessionResult,
		},
	} as unknown as Auth
}

function createApp(auth: Auth) {
	const app = new Hono()
	const middleware = createRequireAdmin(auth)
	app.get("/api/admin/test", middleware, (c) => c.json({ ok: true }))
	return app
}

describe("createRequireAdmin", () => {
	test("returns 401 when no session", async () => {
		const app = createApp(mockAuth(null))

		const res = await app.request("/api/admin/test")

		expect(res.status).toBe(401)
		const body = (await res.json()) as { error: string }
		expect(body.error).toBe("Unauthorized")
	})

	test("returns 403 when user is not admin", async () => {
		const app = createApp(mockAuth({ user: makeUser("user"), session: makeSession() }))

		const res = await app.request("/api/admin/test")

		expect(res.status).toBe(403)
		const body = (await res.json()) as { error: string }
		expect(body.error).toBe("Forbidden")
	})

	test("returns 403 when role is null", async () => {
		const app = createApp(mockAuth({ user: makeUser(null), session: makeSession() }))

		const res = await app.request("/api/admin/test")

		expect(res.status).toBe(403)
	})

	test("allows admin users through and sets context", async () => {
		const user = makeUser("admin")
		const session = makeSession()
		const app = createApp(mockAuth({ user, session }))

		const res = await app.request("/api/admin/test")

		expect(res.status).toBe(200)
		const body = (await res.json()) as { ok: boolean }
		expect(body.ok).toBe(true)
	})
})
