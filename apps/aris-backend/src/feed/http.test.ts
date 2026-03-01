import type { ActionDefinition, ContextEntry, FeedItem, FeedSource } from "@aris/core"

import { describe, expect, test } from "bun:test"
import { Hono } from "hono"

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

function createStubSource(id: string, items: FeedItem[] = []): FeedSource {
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

describe("GET /api/feed", () => {
	test("returns 401 without auth", async () => {
		const manager = new UserSessionManager([])
		const app = buildTestApp(manager)

		const res = await app.request("/api/feed")

		expect(res.status).toBe(401)
	})

	test("returns cached feed when available", async () => {
		const items: FeedItem[] = [
			{
				id: "item-1",
				type: "test",
				priority: 0.8,
				timestamp: new Date("2025-01-01T00:00:00.000Z"),
				data: { value: 42 },
			},
		]
		const manager = new UserSessionManager([() => createStubSource("test", items)])
		const app = buildTestApp(manager, "user-1")

		// Prime the cache
		const session = manager.getOrCreate("user-1")
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
				type: "test",
				priority: 0.5,
				timestamp: new Date("2025-06-01T12:00:00.000Z"),
				data: { fresh: true },
			},
		]
		const manager = new UserSessionManager([() => createStubSource("test", items)])
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
		const manager = new UserSessionManager([() => failingSource])
		const app = buildTestApp(manager, "user-1")

		const res = await app.request("/api/feed")

		expect(res.status).toBe(200)
		const body = (await res.json()) as FeedResponse
		expect(body.items).toHaveLength(0)
		expect(body.errors).toHaveLength(1)
		expect(body.errors[0]!.sourceId).toBe("failing")
		expect(body.errors[0]!.error).toBe("connection timeout")
	})
})
