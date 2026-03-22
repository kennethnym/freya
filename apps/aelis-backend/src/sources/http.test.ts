import type { ActionDefinition, ContextEntry, FeedItem, FeedSource } from "@aelis/core"

import { describe, expect, mock, spyOn, test } from "bun:test"
import { Hono } from "hono"

import type { Database } from "../db/index.ts"
import type { ConfigSchema, FeedSourceProvider } from "../session/feed-source-provider.ts"

import { mockAuthSessionMiddleware } from "../auth/session-middleware.ts"
import { UserSessionManager } from "../session/user-session-manager.ts"
import { tflConfig } from "../tfl/provider.ts"
import { weatherConfig } from "../weather/provider.ts"
import { SourceNotFoundError } from "./errors.ts"
import { registerSourcesHttpHandlers } from "./http.ts"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

function createStubProvider(sourceId: string, configSchema?: ConfigSchema): FeedSourceProvider {
	return {
		sourceId,
		configSchema,
		async feedSourceForUser() {
			return createStubSource(sourceId)
		},
	}
}

const MOCK_USER_ID = "k7Gx2mPqRvNwYs9TdLfA4bHcJeUo1iZn"

type SourceRow = {
	userId: string
	sourceId: string
	enabled: boolean
	config: Record<string, unknown>
}

function createInMemoryStore() {
	const rows = new Map<string, SourceRow>()

	function key(userId: string, sourceId: string) {
		return `${userId}:${sourceId}`
	}

	return {
		rows,
		seed(userId: string, sourceId: string, data: Partial<SourceRow> = {}) {
			rows.set(key(userId, sourceId), {
				userId,
				sourceId,
				enabled: data.enabled ?? true,
				config: data.config ?? {},
			})
		},
		forUser(userId: string) {
			return {
				async enabled() {
					return [...rows.values()].filter((r) => r.userId === userId && r.enabled)
				},
				async find(sourceId: string) {
					return rows.get(key(userId, sourceId))
				},
				async updateConfig(sourceId: string, update: { enabled?: boolean; config?: unknown }) {
					const existing = rows.get(key(userId, sourceId))
					if (!existing) {
						throw new SourceNotFoundError(sourceId, userId)
					}
					if (update.enabled !== undefined) {
						existing.enabled = update.enabled
					}
					if (update.config !== undefined) {
						existing.config = update.config as Record<string, unknown>
					}
				},
				async upsertConfig(sourceId: string, data: { enabled: boolean; config: unknown }) {
					const existing = rows.get(key(userId, sourceId))
					if (existing) {
						existing.enabled = data.enabled
						existing.config = data.config as Record<string, unknown>
					} else {
						rows.set(key(userId, sourceId), {
							userId,
							sourceId,
							enabled: data.enabled,
							config: (data.config ?? {}) as Record<string, unknown>,
						})
					}
				},
			}
		},
	}
}

let activeStore: ReturnType<typeof createInMemoryStore>

mock.module("../sources/user-sources.ts", () => ({
	sources(_db: unknown, userId: string) {
		return activeStore.forUser(userId)
	},
}))

const fakeDb = {} as Database

function createApp(providers: FeedSourceProvider[], userId?: string) {
	const sessionManager = new UserSessionManager({ providers, db: fakeDb })
	const app = new Hono()
	registerSourcesHttpHandlers(app, {
		sessionManager,
		authSessionMiddleware: mockAuthSessionMiddleware(userId),
	})
	return { app, sessionManager }
}

function patch(app: Hono, sourceId: string, body: unknown) {
	return app.request(`/api/sources/${sourceId}`, {
		method: "PATCH",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body),
	})
}

function get(app: Hono, sourceId: string) {
	return app.request(`/api/sources/${sourceId}`, { method: "GET" })
}

function put(app: Hono, sourceId: string, body: unknown) {
	return app.request(`/api/sources/${sourceId}`, {
		method: "PUT",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body),
	})
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("GET /api/sources/:sourceId", () => {
	test("returns 401 without auth", async () => {
		activeStore = createInMemoryStore()
		const { app } = createApp([createStubProvider("aelis.weather", weatherConfig)])

		const res = await get(app, "aelis.weather")

		expect(res.status).toBe(401)
	})

	test("returns 404 for unknown source", async () => {
		activeStore = createInMemoryStore()
		const { app } = createApp([createStubProvider("aelis.weather", weatherConfig)], MOCK_USER_ID)

		const res = await get(app, "unknown.source")

		expect(res.status).toBe(404)
		const body = (await res.json()) as { error: string }
		expect(body.error).toContain("not found")
	})

	test("returns enabled and config for existing source", async () => {
		activeStore = createInMemoryStore()
		activeStore.seed(MOCK_USER_ID, "aelis.weather", {
			enabled: true,
			config: { units: "metric" },
		})
		const { app } = createApp([createStubProvider("aelis.weather", weatherConfig)], MOCK_USER_ID)

		const res = await get(app, "aelis.weather")

		expect(res.status).toBe(200)
		const body = (await res.json()) as { enabled: boolean; config: unknown }
		expect(body.enabled).toBe(true)
		expect(body.config).toEqual({ units: "metric" })
	})

	test("returns defaults when user has no row for source", async () => {
		activeStore = createInMemoryStore()
		const { app } = createApp([createStubProvider("aelis.weather", weatherConfig)], MOCK_USER_ID)

		const res = await get(app, "aelis.weather")

		expect(res.status).toBe(200)
		const body = (await res.json()) as { enabled: boolean; config: unknown }
		expect(body.enabled).toBe(false)
		expect(body.config).toEqual({})
	})

	test("returns disabled source", async () => {
		activeStore = createInMemoryStore()
		activeStore.seed(MOCK_USER_ID, "aelis.weather", {
			enabled: false,
			config: { units: "imperial" },
		})
		const { app } = createApp([createStubProvider("aelis.weather", weatherConfig)], MOCK_USER_ID)

		const res = await get(app, "aelis.weather")

		expect(res.status).toBe(200)
		const body = (await res.json()) as { enabled: boolean; config: unknown }
		expect(body.enabled).toBe(false)
		expect(body.config).toEqual({ units: "imperial" })
	})
})

describe("PATCH /api/sources/:sourceId", () => {
	test("returns 401 without auth", async () => {
		activeStore = createInMemoryStore()
		const { app } = createApp([createStubProvider("aelis.weather", weatherConfig)])

		const res = await patch(app, "aelis.weather", { enabled: true })

		expect(res.status).toBe(401)
	})

	test("returns 404 for unknown source", async () => {
		activeStore = createInMemoryStore()
		const { app } = createApp([createStubProvider("aelis.weather", weatherConfig)], MOCK_USER_ID)

		const res = await patch(app, "unknown.source", { enabled: true })

		expect(res.status).toBe(404)
		const body = (await res.json()) as { error: string }
		expect(body.error).toContain("not found")
	})

	test("returns 404 when user has no existing row for source", async () => {
		activeStore = createInMemoryStore()
		const { app } = createApp([createStubProvider("aelis.weather", weatherConfig)], MOCK_USER_ID)

		const res = await patch(app, "aelis.weather", { enabled: true })

		expect(res.status).toBe(404)
		const body = (await res.json()) as { error: string }
		expect(body.error).toContain("not found")
	})

	test("returns 204 when body is empty object (no-op) on existing source", async () => {
		activeStore = createInMemoryStore()
		activeStore.seed(MOCK_USER_ID, "aelis.weather")
		const { app } = createApp([createStubProvider("aelis.weather", weatherConfig)], MOCK_USER_ID)

		const res = await patch(app, "aelis.weather", {})

		expect(res.status).toBe(204)
	})

	test("returns 404 when body is empty object on nonexistent user source", async () => {
		activeStore = createInMemoryStore()
		const { app } = createApp([createStubProvider("aelis.weather", weatherConfig)], MOCK_USER_ID)

		const res = await patch(app, "aelis.weather", {})

		expect(res.status).toBe(404)
	})

	test("returns 400 for invalid JSON body", async () => {
		activeStore = createInMemoryStore()
		activeStore.seed(MOCK_USER_ID, "aelis.weather")
		const { app } = createApp([createStubProvider("aelis.weather", weatherConfig)], MOCK_USER_ID)

		const res = await app.request("/api/sources/aelis.weather", {
			method: "PATCH",
			headers: { "Content-Type": "application/json" },
			body: "not json",
		})

		expect(res.status).toBe(400)
		const body = (await res.json()) as { error: string }
		expect(body.error).toContain("Invalid JSON")
	})

	test("returns 400 when request body contains unknown fields", async () => {
		activeStore = createInMemoryStore()
		activeStore.seed(MOCK_USER_ID, "aelis.weather")
		const { app } = createApp([createStubProvider("aelis.weather", weatherConfig)], MOCK_USER_ID)

		const res = await patch(app, "aelis.weather", {
			enabled: true,
			unknownField: "hello",
		})

		expect(res.status).toBe(400)
	})

	test("returns 400 when weather config contains unknown fields", async () => {
		activeStore = createInMemoryStore()
		activeStore.seed(MOCK_USER_ID, "aelis.weather")
		const { app } = createApp([createStubProvider("aelis.weather", weatherConfig)], MOCK_USER_ID)

		const res = await patch(app, "aelis.weather", {
			config: { units: "metric", unknownField: "hello" },
		})

		expect(res.status).toBe(400)
	})

	test("returns 400 when weather config fails validation", async () => {
		activeStore = createInMemoryStore()
		activeStore.seed(MOCK_USER_ID, "aelis.weather")
		const { app } = createApp([createStubProvider("aelis.weather", weatherConfig)], MOCK_USER_ID)

		const res = await patch(app, "aelis.weather", {
			config: { units: "invalid" },
		})

		expect(res.status).toBe(400)
	})

	test("returns 204 and updates enabled", async () => {
		activeStore = createInMemoryStore()
		activeStore.seed(MOCK_USER_ID, "aelis.weather", {
			enabled: true,
			config: { units: "metric" },
		})
		const { app } = createApp([createStubProvider("aelis.weather", weatherConfig)], MOCK_USER_ID)

		const res = await patch(app, "aelis.weather", { enabled: false })

		expect(res.status).toBe(204)
		const row = activeStore.rows.get(`${MOCK_USER_ID}:aelis.weather`)
		expect(row!.enabled).toBe(false)
		expect(row!.config).toEqual({ units: "metric" })
	})

	test("returns 204 and updates config", async () => {
		activeStore = createInMemoryStore()
		activeStore.seed(MOCK_USER_ID, "aelis.weather", {
			config: { units: "metric" },
		})
		const { app } = createApp([createStubProvider("aelis.weather", weatherConfig)], MOCK_USER_ID)

		const res = await patch(app, "aelis.weather", {
			config: { units: "imperial" },
		})

		expect(res.status).toBe(204)
		const row = activeStore.rows.get(`${MOCK_USER_ID}:aelis.weather`)
		expect(row!.config).toEqual({ units: "imperial" })
	})

	test("preserves config when only updating enabled", async () => {
		activeStore = createInMemoryStore()
		activeStore.seed(MOCK_USER_ID, "aelis.tfl", {
			enabled: true,
			config: { lines: ["bakerloo"] },
		})
		const { app } = createApp([createStubProvider("aelis.tfl", tflConfig)], MOCK_USER_ID)

		const res = await patch(app, "aelis.tfl", { enabled: false })

		expect(res.status).toBe(204)
		const row = activeStore.rows.get(`${MOCK_USER_ID}:aelis.tfl`)
		expect(row!.enabled).toBe(false)
		expect(row!.config).toEqual({ lines: ["bakerloo"] })
	})

	test("deep-merges config on update", async () => {
		activeStore = createInMemoryStore()
		activeStore.seed(MOCK_USER_ID, "aelis.weather", {
			config: { units: "metric", hourlyLimit: 12 },
		})
		const { app } = createApp([createStubProvider("aelis.weather", weatherConfig)], MOCK_USER_ID)

		const res = await patch(app, "aelis.weather", {
			config: { dailyLimit: 5 },
		})

		expect(res.status).toBe(204)
		const row = activeStore.rows.get(`${MOCK_USER_ID}:aelis.weather`)
		expect(row!.config).toEqual({
			units: "metric",
			hourlyLimit: 12,
			dailyLimit: 5,
		})
	})

	test("refreshes source in active session after config update", async () => {
		activeStore = createInMemoryStore()
		activeStore.seed(MOCK_USER_ID, "aelis.weather", {
			config: { units: "metric" },
		})
		const { app, sessionManager } = createApp(
			[createStubProvider("aelis.weather", weatherConfig)],
			MOCK_USER_ID,
		)

		const session = await sessionManager.getOrCreate(MOCK_USER_ID)
		const replaceSpy = spyOn(session, "replaceSource")

		const res = await patch(app, "aelis.weather", {
			config: { units: "imperial" },
		})

		expect(res.status).toBe(204)
		expect(replaceSpy).toHaveBeenCalled()
		replaceSpy.mockRestore()
	})

	test("removes source from session when disabled", async () => {
		activeStore = createInMemoryStore()
		activeStore.seed(MOCK_USER_ID, "aelis.weather", {
			enabled: true,
			config: { units: "metric" },
		})
		const { app, sessionManager } = createApp(
			[createStubProvider("aelis.weather", weatherConfig)],
			MOCK_USER_ID,
		)

		const session = await sessionManager.getOrCreate(MOCK_USER_ID)
		const removeSpy = spyOn(session, "removeSource")

		const res = await patch(app, "aelis.weather", { enabled: false })

		expect(res.status).toBe(204)
		expect(removeSpy).toHaveBeenCalledWith("aelis.weather")
		removeSpy.mockRestore()
	})

	test("returns 400 when config is provided for source without schema", async () => {
		activeStore = createInMemoryStore()
		activeStore.seed(MOCK_USER_ID, "aelis.location")
		const { app } = createApp([createStubProvider("aelis.location")], MOCK_USER_ID)

		const res = await patch(app, "aelis.location", {
			config: { something: "value" },
		})

		expect(res.status).toBe(400)
	})

	test("returns 400 when empty config is provided for source without schema", async () => {
		activeStore = createInMemoryStore()
		activeStore.seed(MOCK_USER_ID, "aelis.location")
		const { app } = createApp([createStubProvider("aelis.location")], MOCK_USER_ID)

		const res = await patch(app, "aelis.location", {
			config: {},
		})

		expect(res.status).toBe(400)
	})

	test("updates enabled on location source", async () => {
		activeStore = createInMemoryStore()
		activeStore.seed(MOCK_USER_ID, "aelis.location", { enabled: true })
		const { app } = createApp([createStubProvider("aelis.location")], MOCK_USER_ID)

		const res = await patch(app, "aelis.location", { enabled: false })

		expect(res.status).toBe(204)
		const row = activeStore.rows.get(`${MOCK_USER_ID}:aelis.location`)
		expect(row!.enabled).toBe(false)
	})
})

// ---------------------------------------------------------------------------
// PUT /api/sources/:sourceId
// ---------------------------------------------------------------------------

describe("PUT /api/sources/:sourceId", () => {
	test("returns 401 without auth", async () => {
		activeStore = createInMemoryStore()
		const { app } = createApp([createStubProvider("aelis.weather", weatherConfig)])

		const res = await put(app, "aelis.weather", { enabled: true, config: {} })

		expect(res.status).toBe(401)
	})

	test("returns 404 for unknown source", async () => {
		activeStore = createInMemoryStore()
		const { app } = createApp([createStubProvider("aelis.weather", weatherConfig)], MOCK_USER_ID)

		const res = await put(app, "unknown.source", { enabled: true, config: {} })

		expect(res.status).toBe(404)
		const body = (await res.json()) as { error: string }
		expect(body.error).toContain("not found")
	})

	test("returns 400 for invalid JSON", async () => {
		activeStore = createInMemoryStore()
		const { app } = createApp([createStubProvider("aelis.weather", weatherConfig)], MOCK_USER_ID)

		const res = await app.request("/api/sources/aelis.weather", {
			method: "PUT",
			headers: { "Content-Type": "application/json" },
			body: "not json",
		})

		expect(res.status).toBe(400)
		const body = (await res.json()) as { error: string }
		expect(body.error).toContain("Invalid JSON")
	})

	test("returns 400 when enabled is missing", async () => {
		activeStore = createInMemoryStore()
		const { app } = createApp([createStubProvider("aelis.weather", weatherConfig)], MOCK_USER_ID)

		const res = await put(app, "aelis.weather", { config: {} })

		expect(res.status).toBe(400)
	})

	test("returns 400 when config is missing", async () => {
		activeStore = createInMemoryStore()
		const { app } = createApp([createStubProvider("aelis.weather", weatherConfig)], MOCK_USER_ID)

		const res = await put(app, "aelis.weather", { enabled: true })

		expect(res.status).toBe(400)
	})

	test("returns 400 when request body contains unknown fields", async () => {
		activeStore = createInMemoryStore()
		const { app } = createApp([createStubProvider("aelis.weather", weatherConfig)], MOCK_USER_ID)

		const res = await put(app, "aelis.weather", {
			enabled: true,
			config: { units: "metric" },
			unknownField: "hello",
		})

		expect(res.status).toBe(400)
	})

	test("returns 400 when weather config contains unknown fields", async () => {
		activeStore = createInMemoryStore()
		const { app } = createApp([createStubProvider("aelis.weather", weatherConfig)], MOCK_USER_ID)

		const res = await put(app, "aelis.weather", {
			enabled: true,
			config: { units: "metric", unknownField: "hello" },
		})

		expect(res.status).toBe(400)
	})

	test("returns 400 when config fails schema validation", async () => {
		activeStore = createInMemoryStore()
		const { app } = createApp([createStubProvider("aelis.weather", weatherConfig)], MOCK_USER_ID)

		const res = await put(app, "aelis.weather", {
			enabled: true,
			config: { units: "invalid" },
		})

		expect(res.status).toBe(400)
	})

	test("returns 204 and inserts when row does not exist", async () => {
		activeStore = createInMemoryStore()
		const { app } = createApp([createStubProvider("aelis.weather", weatherConfig)], MOCK_USER_ID)

		const res = await put(app, "aelis.weather", {
			enabled: true,
			config: { units: "metric" },
		})

		expect(res.status).toBe(204)
		const row = activeStore.rows.get(`${MOCK_USER_ID}:aelis.weather`)
		expect(row).toBeDefined()
		expect(row!.enabled).toBe(true)
		expect(row!.config).toEqual({ units: "metric" })
	})

	test("returns 204 and fully replaces existing row", async () => {
		activeStore = createInMemoryStore()
		activeStore.seed(MOCK_USER_ID, "aelis.weather", {
			enabled: true,
			config: { units: "metric", hourlyLimit: 12 },
		})
		const { app } = createApp([createStubProvider("aelis.weather", weatherConfig)], MOCK_USER_ID)

		const res = await put(app, "aelis.weather", {
			enabled: false,
			config: { units: "imperial" },
		})

		expect(res.status).toBe(204)
		const row = activeStore.rows.get(`${MOCK_USER_ID}:aelis.weather`)
		expect(row!.enabled).toBe(false)
		// hourlyLimit should be gone — full replace, not merge
		expect(row!.config).toEqual({ units: "imperial" })
	})

	test("refreshes source in active session after upsert", async () => {
		activeStore = createInMemoryStore()
		activeStore.seed(MOCK_USER_ID, "aelis.weather", {
			config: { units: "metric" },
		})
		const { app, sessionManager } = createApp(
			[createStubProvider("aelis.weather", weatherConfig)],
			MOCK_USER_ID,
		)

		const session = await sessionManager.getOrCreate(MOCK_USER_ID)
		const replaceSpy = spyOn(session, "replaceSource")

		const res = await put(app, "aelis.weather", {
			enabled: true,
			config: { units: "imperial" },
		})

		expect(res.status).toBe(204)
		expect(replaceSpy).toHaveBeenCalled()
		replaceSpy.mockRestore()
	})

	test("removes source from session when disabled via upsert", async () => {
		activeStore = createInMemoryStore()
		activeStore.seed(MOCK_USER_ID, "aelis.weather", {
			enabled: true,
			config: { units: "metric" },
		})
		const { app, sessionManager } = createApp(
			[createStubProvider("aelis.weather", weatherConfig)],
			MOCK_USER_ID,
		)

		const session = await sessionManager.getOrCreate(MOCK_USER_ID)
		const removeSpy = spyOn(session, "removeSource")

		const res = await put(app, "aelis.weather", {
			enabled: false,
			config: { units: "metric" },
		})

		expect(res.status).toBe(204)
		expect(removeSpy).toHaveBeenCalledWith("aelis.weather")
		removeSpy.mockRestore()
	})

	test("adds source to active session when inserting a new source", async () => {
		activeStore = createInMemoryStore()
		// Seed a different source so the session can be created
		activeStore.seed(MOCK_USER_ID, "aelis.location", { enabled: true })
		const { app, sessionManager } = createApp(
			[createStubProvider("aelis.location"), createStubProvider("aelis.weather", weatherConfig)],
			MOCK_USER_ID,
		)

		// Create session — only has aelis.location
		const session = await sessionManager.getOrCreate(MOCK_USER_ID)
		expect(session.hasSource("aelis.weather")).toBe(false)

		// PUT a new source that didn't exist before
		const res = await put(app, "aelis.weather", {
			enabled: true,
			config: { units: "metric" },
		})

		expect(res.status).toBe(204)
		expect(session.hasSource("aelis.weather")).toBe(true)
	})

	test("returns 400 when config is provided for source without schema", async () => {
		activeStore = createInMemoryStore()
		const { app } = createApp([createStubProvider("aelis.location")], MOCK_USER_ID)

		const res = await put(app, "aelis.location", {
			enabled: true,
			config: { something: "value" },
		})

		expect(res.status).toBe(400)
	})

	test("returns 400 when empty config is provided for source without schema", async () => {
		activeStore = createInMemoryStore()
		const { app } = createApp([createStubProvider("aelis.location")], MOCK_USER_ID)

		const res = await put(app, "aelis.location", {
			enabled: true,
			config: {},
		})

		expect(res.status).toBe(400)
	})

	test("returns 204 without config field for source without schema", async () => {
		activeStore = createInMemoryStore()
		const { app } = createApp([createStubProvider("aelis.location")], MOCK_USER_ID)

		const res = await put(app, "aelis.location", {
			enabled: true,
		})

		expect(res.status).toBe(204)
	})
})
