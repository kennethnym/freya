import type { ActionDefinition, ContextEntry, FeedItem, FeedSource } from "@aelis/core"

import { contextKey } from "@aelis/core"
import { describe, expect, mock, spyOn, test } from "bun:test"
import { Hono } from "hono"

import type { Database } from "../db/index.ts"

import { mockAuthSessionMiddleware } from "../auth/session-middleware.ts"
import { UserSessionManager } from "../session/index.ts"
import { registerFeedHttpHandlers } from "./http.ts"

interface FeedResponse {
	items: Array<{
		id: string
		type: string
		priority: number
		timestamp: string
		data: Record<string, unknown>
	}>
	errors: Array<{ sourceId: string; error: string }>
}

function createStubSource(
	id: string,
	items: FeedItem[] = [],
	contextEntries: readonly ContextEntry[] | null = null,
): FeedSource {
	return {
		id,
		async listActions(): Promise<Record<string, ActionDefinition>> {
			return {}
		},
		async executeAction(): Promise<unknown> {
			return undefined
		},
		async fetchContext(): Promise<readonly ContextEntry[] | null> {
			return contextEntries
		},
		async fetchItems() {
			return items
		},
	}
}

function buildTestApp(sessionManager: UserSessionManager, userId?: string) {
	const app = new Hono()
	registerFeedHttpHandlers(app, {
		sessionManager,
		authSessionMiddleware: mockAuthSessionMiddleware(userId),
	})
	return app
}

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

const fakeDb = {} as Database

describe("GET /api/feed", () => {
	test("returns 401 without auth", async () => {
		mockEnabledSourceIds = []
		const manager = new UserSessionManager({ db: fakeDb, providers: [] })
		const app = buildTestApp(manager)

		const res = await app.request("/api/feed")

		expect(res.status).toBe(401)
	})

	test("returns cached feed when available", async () => {
		const items: FeedItem[] = [
			{
				id: "item-1",
				sourceId: "test",
				type: "test",
				priority: 0.8,
				timestamp: new Date("2025-01-01T00:00:00.000Z"),
				data: { value: 42 },
			},
		]
		mockEnabledSourceIds = ["test"]
		const manager = new UserSessionManager({
			db: fakeDb,
			providers: [
				{
					sourceId: "test",
					async feedSourceForUser() {
						return createStubSource("test", items)
					},
				},
			],
		})
		const app = buildTestApp(manager, "user-1")

		// Prime the cache
		const session = await manager.getOrCreate("user-1")
		await session.engine.refresh()
		expect(session.engine.lastFeed()).not.toBeNull()

		const res = await app.request("/api/feed")

		expect(res.status).toBe(200)
		const body = (await res.json()) as FeedResponse
		expect(body.items).toHaveLength(1)
		expect(body.items[0]!.id).toBe("item-1")
		expect(body.items[0]!.type).toBe("test")
		expect(body.items[0]!.priority).toBe(0.8)
		expect(body.items[0]!.timestamp).toBe("2025-01-01T00:00:00.000Z")
		expect(body.errors).toHaveLength(0)
	})

	test("forces refresh when no cached feed", async () => {
		const items: FeedItem[] = [
			{
				id: "fresh-1",
				sourceId: "test",
				type: "test",
				priority: 0.5,
				timestamp: new Date("2025-06-01T12:00:00.000Z"),
				data: { fresh: true },
			},
		]
		mockEnabledSourceIds = ["test"]
		const manager = new UserSessionManager({
			db: fakeDb,
			providers: [
				{
					sourceId: "test",
					async feedSourceForUser() {
						return createStubSource("test", items)
					},
				},
			],
		})
		const app = buildTestApp(manager, "user-1")

		// No prior refresh — lastFeed() returns null, handler should call refresh()
		const res = await app.request("/api/feed")

		expect(res.status).toBe(200)
		const body = (await res.json()) as FeedResponse
		expect(body.items).toHaveLength(1)
		expect(body.items[0]!.id).toBe("fresh-1")
		expect(body.items[0]!.data.fresh).toBe(true)
		expect(body.errors).toHaveLength(0)
	})

	test("serializes source errors as message strings", async () => {
		const failingSource: FeedSource = {
			id: "failing",
			async listActions() {
				return {}
			},
			async executeAction() {
				return undefined
			},
			async fetchContext() {
				return null
			},
			async fetchItems() {
				throw new Error("connection timeout")
			},
		}
		mockEnabledSourceIds = ["failing"]
		const manager = new UserSessionManager({
			db: fakeDb,
			providers: [
				{
					sourceId: "failing",
					async feedSourceForUser() {
						return failingSource
					},
				},
			],
		})
		const app = buildTestApp(manager, "user-1")

		const res = await app.request("/api/feed")

		expect(res.status).toBe(200)
		const body = (await res.json()) as FeedResponse
		expect(body.items).toHaveLength(0)
		expect(body.errors).toHaveLength(1)
		expect(body.errors[0]!.sourceId).toBe("failing")
		expect(body.errors[0]!.error).toBe("connection timeout")
	})

	test("returns 503 when all providers fail", async () => {
		mockEnabledSourceIds = ["test"]
		const manager = new UserSessionManager({
			db: fakeDb,
			providers: [
				{
					sourceId: "test",
					async feedSourceForUser() {
						throw new Error("provider down")
					},
				},
			],
		})
		const app = buildTestApp(manager, "user-1")

		const spy = spyOn(console, "error").mockImplementation(() => {})

		const res = await app.request("/api/feed")

		expect(res.status).toBe(503)
		const body = (await res.json()) as { error: string }
		expect(body.error).toBe("Service unavailable")

		spy.mockRestore()
	})
})

describe("GET /api/context", () => {
	const weatherKey = contextKey("aelis.weather", "weather")
	const weatherData = { temperature: 20, condition: "Clear" }
	const contextEntries: readonly ContextEntry[] = [[weatherKey, weatherData]]

	// The mock auth middleware always injects this hardcoded user ID
	const mockUserId = "k7Gx2mPqRvNwYs9TdLfA4bHcJeUo1iZn"

	async function buildContextApp(userId?: string) {
		mockEnabledSourceIds = ["weather"]
		const manager = new UserSessionManager({
			db: fakeDb,
			providers: [
				{
					sourceId: "weather",
					async feedSourceForUser() {
						return createStubSource("weather", [], contextEntries)
					},
				},
			],
		})
		const app = buildTestApp(manager, userId)
		const session = await manager.getOrCreate(mockUserId)
		return { app, session }
	}

	test("returns 401 without auth", async () => {
		mockEnabledSourceIds = []
		const manager = new UserSessionManager({ db: fakeDb, providers: [] })
		const app = buildTestApp(manager)

		const res = await app.request('/api/context?key=["aelis.weather","weather"]')

		expect(res.status).toBe(401)
	})

	test("returns 400 when key param is missing", async () => {
		const { app } = await buildContextApp("user-1")

		const res = await app.request("/api/context")

		expect(res.status).toBe(400)
		const body = (await res.json()) as { error: string }
		expect(body.error).toContain("key")
	})

	test("returns 400 when key is invalid JSON", async () => {
		const { app } = await buildContextApp("user-1")

		const res = await app.request("/api/context?key=notjson")

		expect(res.status).toBe(400)
		const body = (await res.json()) as { error: string }
		expect(body.error).toContain("key")
	})

	test("returns 400 when key is not an array", async () => {
		const { app } = await buildContextApp("user-1")

		const res = await app.request('/api/context?key="string"')

		expect(res.status).toBe(400)
		const body = (await res.json()) as { error: string }
		expect(body.error).toContain("key")
	})

	test("returns 400 when key contains invalid element types", async () => {
		const { app } = await buildContextApp("user-1")

		const res = await app.request("/api/context?key=[true,null,[1,2]]")

		expect(res.status).toBe(400)
		const body = (await res.json()) as { error: string }
		expect(body.error).toContain("key")
	})

	test("returns 400 when key is an empty array", async () => {
		const { app } = await buildContextApp("user-1")

		const res = await app.request("/api/context?key=[]")

		expect(res.status).toBe(400)
		const body = (await res.json()) as { error: string }
		expect(body.error).toContain("key")
	})

	test("returns 400 when match param is invalid", async () => {
		const { app } = await buildContextApp("user-1")

		const res = await app.request('/api/context?key=["aelis.weather"]&match=invalid')

		expect(res.status).toBe(400)
		const body = (await res.json()) as { error: string }
		expect(body.error).toContain("match")
	})

	test("returns exact match with match=exact", async () => {
		const { app, session } = await buildContextApp("user-1")
		await session.engine.refresh()

		const res = await app.request('/api/context?key=["aelis.weather","weather"]&match=exact')

		expect(res.status).toBe(200)
		const body = (await res.json()) as { match: string; value: unknown }
		expect(body.match).toBe("exact")
		expect(body.value).toEqual(weatherData)
	})

	test("returns 404 with match=exact when only prefix would match", async () => {
		const { app, session } = await buildContextApp("user-1")
		await session.engine.refresh()

		const res = await app.request('/api/context?key=["aelis.weather"]&match=exact')

		expect(res.status).toBe(404)
	})

	test("returns prefix match with match=prefix", async () => {
		const { app, session } = await buildContextApp("user-1")
		await session.engine.refresh()

		const res = await app.request('/api/context?key=["aelis.weather"]&match=prefix')

		expect(res.status).toBe(200)
		const body = (await res.json()) as {
			match: string
			entries: Array<{ key: unknown[]; value: unknown }>
		}
		expect(body.match).toBe("prefix")
		expect(body.entries).toHaveLength(1)
		expect(body.entries[0]!.key).toEqual(["aelis.weather", "weather"])
		expect(body.entries[0]!.value).toEqual(weatherData)
	})

	test("default mode returns exact match when available", async () => {
		const { app, session } = await buildContextApp("user-1")
		await session.engine.refresh()

		const res = await app.request('/api/context?key=["aelis.weather","weather"]')

		expect(res.status).toBe(200)
		const body = (await res.json()) as { match: string; value: unknown }
		expect(body.match).toBe("exact")
		expect(body.value).toEqual(weatherData)
	})

	test("default mode falls back to prefix when no exact match", async () => {
		const { app, session } = await buildContextApp("user-1")
		await session.engine.refresh()

		const res = await app.request('/api/context?key=["aelis.weather"]')

		expect(res.status).toBe(200)
		const body = (await res.json()) as {
			match: string
			entries: Array<{ key: unknown[]; value: unknown }>
		}
		expect(body.match).toBe("prefix")
		expect(body.entries).toHaveLength(1)
		expect(body.entries[0]!.value).toEqual(weatherData)
	})

	test("returns 404 when neither exact nor prefix matches", async () => {
		const { app, session } = await buildContextApp("user-1")
		await session.engine.refresh()

		const res = await app.request('/api/context?key=["nonexistent"]')

		expect(res.status).toBe(404)
		const body = (await res.json()) as { error: string }
		expect(body.error).toBe("Context key not found")
	})
})
