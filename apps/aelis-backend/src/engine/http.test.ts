import type {
	ActionDefinition,
	ContextEntry,
	FeedItem,
	FeedItemRenderer,
	FeedSource,
} from "@aelis/core"
import type { Spec } from "@json-render/core"

import { contextKey } from "@aelis/core"
import { JRX_NODE } from "@nym.sh/jrx"
import { describe, expect, test } from "bun:test"
import { Hono } from "hono"

import { mockAuthSessionMiddleware } from "../auth/session-middleware.ts"
import { FeedRenderer } from "../session/feed-renderer.ts"
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

interface RenderedFeedResponse {
	items: Array<{
		id: string
		type: string
		timestamp: string
		data: Record<string, unknown>
		ui: Spec
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

describe("GET /api/feed", () => {
	test("returns 401 without auth", async () => {
		const manager = new UserSessionManager({ providers: [] })
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
		const manager = new UserSessionManager({
			providers: [() => createStubSource("test", items)],
		})
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
				sourceId: "test",
				type: "test",
				priority: 0.5,
				timestamp: new Date("2025-06-01T12:00:00.000Z"),
				data: { fresh: true },
			},
		]
		const manager = new UserSessionManager({
			providers: [() => createStubSource("test", items)],
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
		const manager = new UserSessionManager({ providers: [() => failingSource] })
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

describe("GET /api/feed?render=json-render", () => {
	const stubRenderer: FeedItemRenderer = (item) => ({
		$$typeof: JRX_NODE,
		type: "FeedCard",
		props: {},
		children: [
			{
				$$typeof: JRX_NODE,
				type: "SansSerifText",
				props: { content: `Rendered: ${item.data.value}` },
				children: [],
				key: undefined,
				visible: undefined,
				on: undefined,
				repeat: undefined,
				watch: undefined,
			},
		],
		key: undefined,
		visible: undefined,
		on: undefined,
		repeat: undefined,
		watch: undefined,
	})

	const rendererProvider = {
		feedRendererForUser: () => new FeedRenderer({ "test-source": stubRenderer }),
	}

	test("returns rendered items with ui field as Spec", async () => {
		const items: FeedItem[] = [
			{
				id: "item-1",
				sourceId: "test-source",
				type: "renderable",
				timestamp: new Date("2025-01-01T00:00:00.000Z"),
				data: { value: "hello" },
			},
		]
		const manager = new UserSessionManager({
			providers: [() => createStubSource("test", items)],
			rendererProvider,
		})
		const app = buildTestApp(manager, "user-1")

		const res = await app.request("/api/feed?render=json-render")

		expect(res.status).toBe(200)
		const body = (await res.json()) as RenderedFeedResponse
		expect(body.items).toHaveLength(1)
		expect(body.items[0]!.id).toBe("item-1")
		expect(body.items[0]!.ui).toBeDefined()
		expect(body.items[0]!.ui.root).toBeDefined()
		expect(body.items[0]!.ui.elements).toBeDefined()
	})

	test("drops items without a renderer", async () => {
		const items: FeedItem[] = [
			{
				id: "renderable-1",
				sourceId: "test-source",
				type: "renderable",
				timestamp: new Date("2025-01-01T00:00:00.000Z"),
				data: { value: "yes" },
			},
			{
				id: "unrenderable-1",
				sourceId: "other-source",
				type: "no-renderer",
				timestamp: new Date("2025-01-01T00:00:00.000Z"),
				data: { value: "no" },
			},
		]
		const manager = new UserSessionManager({
			providers: [() => createStubSource("test", items)],
			rendererProvider,
		})
		const app = buildTestApp(manager, "user-1")

		const res = await app.request("/api/feed?render=json-render")

		expect(res.status).toBe(200)
		const body = (await res.json()) as RenderedFeedResponse
		expect(body.items).toHaveLength(1)
		expect(body.items[0]!.id).toBe("renderable-1")
	})

	test("returns empty items when no renderers match", async () => {
		const items: FeedItem[] = [
			{
				id: "item-1",
				sourceId: "other-source",
				type: "no-renderer",
				timestamp: new Date("2025-01-01T00:00:00.000Z"),
				data: { value: 42 },
			},
		]
		const manager = new UserSessionManager({
			providers: [() => createStubSource("test", items)],
			rendererProvider,
		})
		const app = buildTestApp(manager, "user-1")

		const res = await app.request("/api/feed?render=json-render")

		expect(res.status).toBe(200)
		const body = (await res.json()) as RenderedFeedResponse
		expect(body.items).toHaveLength(0)
	})

	test("returns 400 for unknown render format", async () => {
		const manager = new UserSessionManager({
			providers: [() => createStubSource("test")],
			rendererProvider,
		})
		const app = buildTestApp(manager, "user-1")

		const res = await app.request("/api/feed?render=unknown")

		expect(res.status).toBe(400)
		const body = (await res.json()) as { error: string }
		expect(body.error).toContain("unknown")
	})

	test("returns 500 when renderer is not available", async () => {
		const manager = new UserSessionManager({
			providers: [() => createStubSource("test")],
		})
		const app = buildTestApp(manager, "user-1")

		const res = await app.request("/api/feed?render=json-render")

		expect(res.status).toBe(500)
		const body = (await res.json()) as { error: string }
		expect(body.error).toContain("not available")
	})

	test("without render param returns raw items (no ui field)", async () => {
		const items: FeedItem[] = [
			{
				id: "item-1",
				sourceId: "test-source",
				type: "renderable",
				timestamp: new Date("2025-01-01T00:00:00.000Z"),
				data: { value: 42 },
			},
		]
		const manager = new UserSessionManager({
			providers: [() => createStubSource("test", items)],
			rendererProvider,
		})
		const app = buildTestApp(manager, "user-1")

		const res = await app.request("/api/feed")

		expect(res.status).toBe(200)
		const body = (await res.json()) as FeedResponse
		expect(body.items).toHaveLength(1)
		expect(body.items[0]!).not.toHaveProperty("ui")
	})
})

describe("GET /api/context", () => {
	const weatherKey = contextKey("aelis.weather", "weather")
	const weatherData = { temperature: 20, condition: "Clear" }
	const contextEntries: readonly ContextEntry[] = [[weatherKey, weatherData]]

	// The mock auth middleware always injects this hardcoded user ID
	const mockUserId = "k7Gx2mPqRvNwYs9TdLfA4bHcJeUo1iZn"

	function buildContextApp(userId?: string) {
		const manager = new UserSessionManager({
			providers: [() => createStubSource("weather", [], contextEntries)],
		})
		const app = buildTestApp(manager, userId)
		const session = manager.getOrCreate(mockUserId)
		return { app, session }
	}

	test("returns 401 without auth", async () => {
		const manager = new UserSessionManager({ providers: [] })
		const app = buildTestApp(manager)

		const res = await app.request('/api/context?key=["aelis.weather","weather"]')

		expect(res.status).toBe(401)
	})

	test("returns 400 when key param is missing", async () => {
		const { app } = buildContextApp("user-1")

		const res = await app.request("/api/context")

		expect(res.status).toBe(400)
		const body = (await res.json()) as { error: string }
		expect(body.error).toContain("key")
	})

	test("returns 400 when key is invalid JSON", async () => {
		const { app } = buildContextApp("user-1")

		const res = await app.request("/api/context?key=notjson")

		expect(res.status).toBe(400)
		const body = (await res.json()) as { error: string }
		expect(body.error).toContain("key")
	})

	test("returns 400 when key is not an array", async () => {
		const { app } = buildContextApp("user-1")

		const res = await app.request('/api/context?key="string"')

		expect(res.status).toBe(400)
		const body = (await res.json()) as { error: string }
		expect(body.error).toContain("key")
	})

	test("returns 400 when key contains invalid element types", async () => {
		const { app } = buildContextApp("user-1")

		const res = await app.request("/api/context?key=[true,null,[1,2]]")

		expect(res.status).toBe(400)
		const body = (await res.json()) as { error: string }
		expect(body.error).toContain("key")
	})

	test("returns 400 when key is an empty array", async () => {
		const { app } = buildContextApp("user-1")

		const res = await app.request("/api/context?key=[]")

		expect(res.status).toBe(400)
		const body = (await res.json()) as { error: string }
		expect(body.error).toContain("key")
	})

	test("returns 400 when match param is invalid", async () => {
		const { app } = buildContextApp("user-1")

		const res = await app.request('/api/context?key=["aelis.weather"]&match=invalid')

		expect(res.status).toBe(400)
		const body = (await res.json()) as { error: string }
		expect(body.error).toContain("match")
	})

	test("returns exact match with match=exact", async () => {
		const { app, session } = buildContextApp("user-1")
		await session.engine.refresh()

		const res = await app.request('/api/context?key=["aelis.weather","weather"]&match=exact')

		expect(res.status).toBe(200)
		const body = (await res.json()) as { match: string; value: unknown }
		expect(body.match).toBe("exact")
		expect(body.value).toEqual(weatherData)
	})

	test("returns 404 with match=exact when only prefix would match", async () => {
		const { app, session } = buildContextApp("user-1")
		await session.engine.refresh()

		const res = await app.request('/api/context?key=["aelis.weather"]&match=exact')

		expect(res.status).toBe(404)
	})

	test("returns prefix match with match=prefix", async () => {
		const { app, session } = buildContextApp("user-1")
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
		const { app, session } = buildContextApp("user-1")
		await session.engine.refresh()

		const res = await app.request('/api/context?key=["aelis.weather","weather"]')

		expect(res.status).toBe(200)
		const body = (await res.json()) as { match: string; value: unknown }
		expect(body.match).toBe("exact")
		expect(body.value).toEqual(weatherData)
	})

	test("default mode falls back to prefix when no exact match", async () => {
		const { app, session } = buildContextApp("user-1")
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
		const { app, session } = buildContextApp("user-1")
		await session.engine.refresh()

		const res = await app.request('/api/context?key=["nonexistent"]')

		expect(res.status).toBe(404)
		const body = (await res.json()) as { error: string }
		expect(body.error).toBe("Context key not found")
	})
})
