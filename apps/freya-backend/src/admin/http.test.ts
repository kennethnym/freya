import type { ActionDefinition, ContextEntry, FeedItem, FeedSource } from "@freya/core"

import { describe, expect, mock, test } from "bun:test"
import { Hono } from "hono"

import type { AdminMiddleware } from "../auth/admin-middleware.ts"
import type { AuthSession, AuthUser } from "../auth/session.ts"
import type { Database } from "../db/index.ts"
import type { FeedSourceProvider } from "../session/feed-source-provider.ts"

import { UserSessionManager } from "../session/user-session-manager.ts"
import { registerAdminHttpHandlers } from "./http.ts"

let mockEnabledSourceIds: string[] = []

mock.module("../sources/user-sources.ts", () => ({
	sources: (_db: Database, _userId: string) => ({
		async enabled() {
			const now = new Date()
			return mockEnabledSourceIds.map((sourceId) => ({
				id: crypto.randomUUID(),
				userId: _userId,
				sourceId,
				enabled: true,
				config: {},
				credentials: null,
				createdAt: now,
				updatedAt: now,
			}))
		},
		async find(sourceId: string) {
			const now = new Date()
			return {
				id: crypto.randomUUID(),
				userId: _userId,
				sourceId,
				enabled: true,
				config: {},
				credentials: null,
				createdAt: now,
				updatedAt: now,
			}
		},
	}),
}))

mock.module("../conversations/storage.ts", () => ({
	conversations: (_db: Database, userId: string) => ({
		async getOrCreateConversation() {
			return { id: `conversation-${userId}` }
		},
		async listEntries() {
			return []
		},
		async appendEntry() {
			return { id: "entry-1", sequence: 1 }
		},
	}),
}))

function createStubSource(id: string): FeedSource {
	return {
		id,
		async listActions(): Promise<Record<string, ActionDefinition>> {
			return {}
		},
		async executeAction(): Promise<unknown> {
			return undefined
		},
		async fetchContext(): Promise<readonly ContextEntry[] | null> {
			return null
		},
		async fetchItems(): Promise<FeedItem[]> {
			return []
		},
	}
}

function createStubProvider(sourceId: string): FeedSourceProvider {
	return {
		sourceId,
		async feedSourceForUser() {
			return createStubSource(sourceId)
		},
	}
}

/** Passthrough admin middleware for testing (assumes admin). */
function passthroughAdminMiddleware(): AdminMiddleware {
	const now = new Date()
	return async (c, next) => {
		c.set("user", {
			id: "admin-1",
			name: "Admin",
			email: "admin@test.com",
			emailVerified: true,
			image: null,
			createdAt: now,
			updatedAt: now,
			role: "admin",
			banned: false,
			banReason: null,
			banExpires: null,
		} as AuthUser)
		c.set("session", { id: "sess-1" } as AuthSession)
		await next()
	}
}

const fakeDb = {} as Database

function createApp(providers: FeedSourceProvider[]) {
	mockEnabledSourceIds = providers.map((p) => p.sourceId)
	const sessionManager = new UserSessionManager({ db: fakeDb, providers })
	const app = new Hono()
	registerAdminHttpHandlers(app, {
		sessionManager,
		adminMiddleware: passthroughAdminMiddleware(),
		db: fakeDb,
	})
	return { app, sessionManager }
}

const validWeatherConfig = {
	credentials: {
		privateKey: "pk-123",
		keyId: "key-456",
		teamId: "team-789",
		serviceId: "svc-abc",
	},
}

describe("PUT /api/admin/:sourceId/config", () => {
	test("returns 404 for unknown provider", async () => {
		const { app } = createApp([createStubProvider("freya.location")])

		const res = await app.request("/api/admin/freya.nonexistent/config", {
			method: "PUT",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ key: "value" }),
		})

		expect(res.status).toBe(404)
		const body = (await res.json()) as { error: string }
		expect(body.error).toContain("not found")
	})

	test("returns 404 for provider without runtime config support", async () => {
		const { app } = createApp([createStubProvider("freya.location")])

		const res = await app.request("/api/admin/freya.location/config", {
			method: "PUT",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ key: "value" }),
		})

		expect(res.status).toBe(404)
		const body = (await res.json()) as { error: string }
		expect(body.error).toContain("not found")
	})

	test("returns 400 for invalid JSON body", async () => {
		const { app } = createApp([createStubProvider("freya.weather")])

		const res = await app.request("/api/admin/freya.weather/config", {
			method: "PUT",
			headers: { "Content-Type": "application/json" },
			body: "not json",
		})

		expect(res.status).toBe(400)
		const body = (await res.json()) as { error: string }
		expect(body.error).toContain("Invalid JSON")
	})

	test("returns 400 when weather config fails validation", async () => {
		const { app } = createApp([createStubProvider("freya.weather")])

		const res = await app.request("/api/admin/freya.weather/config", {
			method: "PUT",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ credentials: { privateKey: 123 } }),
		})

		expect(res.status).toBe(400)
		const body = (await res.json()) as { error: string }
		expect(body.error).toBeDefined()
	})

	test("returns 204 and applies valid weather config", async () => {
		const { app, sessionManager } = createApp([createStubProvider("freya.weather")])

		const originalProvider = sessionManager.getProvider("freya.weather")

		const res = await app.request("/api/admin/freya.weather/config", {
			method: "PUT",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(validWeatherConfig),
		})

		expect(res.status).toBe(204)

		// Provider was replaced with a new instance
		const provider = sessionManager.getProvider("freya.weather")
		expect(provider).toBeDefined()
		expect(provider!.sourceId).toBe("freya.weather")
		expect(provider).not.toBe(originalProvider)
	})
})
