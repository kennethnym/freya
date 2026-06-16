import type { ActionDefinition, ContextEntry, FeedItem, FeedSource } from "@freya/core"

import { describe, expect, mock, spyOn, test } from "bun:test"
import { Hono } from "hono"

import type { Database } from "../db/index.ts"
import type { ConfigSchema, FeedSourceProvider } from "../session/feed-source-provider.ts"

import { mockAuthSessionMiddleware } from "../auth/session-middleware.ts"
import { CredentialEncryptor } from "../lib/crypto.ts"
import { UserSessionManager } from "../session/user-session-manager.ts"
import { tflConfig } from "../tfl/provider.ts"
import { weatherConfig } from "../weather/provider.ts"
import { InvalidSourceCredentialsError, SourceNotFoundError } from "./errors.ts"
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
		async feedSourceForUser(_userId: string, _config: unknown, _credentials: unknown) {
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
				async findForUpdate(sourceId: string) {
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
				async updateCredentials(sourceId: string, _credentials: Buffer) {
					const existing = rows.get(key(userId, sourceId))
					if (!existing) {
						throw new SourceNotFoundError(sourceId, userId)
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

const fakeDb = {
	transaction: <T>(fn: (tx: unknown) => Promise<T>) => fn(fakeDb),
} as unknown as Database

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

const TEST_ENCRYPTION_KEY = "/bv1nbzC4ozZkT/pcv5oQfl+JAMuMZDUSVDesG2dur8="

function createAppWithEncryptor(providers: FeedSourceProvider[], userId?: string) {
	const sessionManager = new UserSessionManager({
		providers,
		db: fakeDb,
		credentialEncryptor: new CredentialEncryptor(TEST_ENCRYPTION_KEY),
	})
	const app = new Hono()
	registerSourcesHttpHandlers(app, {
		sessionManager,
		authSessionMiddleware: mockAuthSessionMiddleware(userId),
	})
	return { app, sessionManager }
}

function putCredentials(app: Hono, sourceId: string, body: unknown) {
	return app.request(`/api/sources/${sourceId}/credentials`, {
		method: "PUT",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body),
	})
}

function put(app: Hono, sourceId: string, body: unknown) {
	return app.request(`/api/sources/${sourceId}`, {
		method: "PUT",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body),
	})
}

function listActions(app: Hono, sourceId: string) {
	return app.request(`/api/sources/${sourceId}/actions`, { method: "GET" })
}

function executeAction(app: Hono, sourceId: string, actionId: string, body: unknown) {
	return app.request(`/api/sources/${sourceId}/actions/${actionId}`, {
		method: "POST",
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
		const { app } = createApp([createStubProvider("freya.weather", weatherConfig)])

		const res = await get(app, "freya.weather")

		expect(res.status).toBe(401)
	})

	test("returns 404 for unknown source", async () => {
		activeStore = createInMemoryStore()
		const { app } = createApp([createStubProvider("freya.weather", weatherConfig)], MOCK_USER_ID)

		const res = await get(app, "unknown.source")

		expect(res.status).toBe(404)
		const body = (await res.json()) as { error: string }
		expect(body.error).toContain("not found")
	})

	test("returns enabled and config for existing source", async () => {
		activeStore = createInMemoryStore()
		activeStore.seed(MOCK_USER_ID, "freya.weather", {
			enabled: true,
			config: { units: "metric" },
		})
		const { app } = createApp([createStubProvider("freya.weather", weatherConfig)], MOCK_USER_ID)

		const res = await get(app, "freya.weather")

		expect(res.status).toBe(200)
		const body = (await res.json()) as { enabled: boolean; config: unknown }
		expect(body.enabled).toBe(true)
		expect(body.config).toEqual({ units: "metric" })
	})

	test("returns defaults when user has no row for source", async () => {
		activeStore = createInMemoryStore()
		const { app } = createApp([createStubProvider("freya.weather", weatherConfig)], MOCK_USER_ID)

		const res = await get(app, "freya.weather")

		expect(res.status).toBe(200)
		const body = (await res.json()) as { enabled: boolean; config: unknown }
		expect(body.enabled).toBe(false)
		expect(body.config).toEqual({})
	})

	test("returns disabled source", async () => {
		activeStore = createInMemoryStore()
		activeStore.seed(MOCK_USER_ID, "freya.weather", {
			enabled: false,
			config: { units: "imperial" },
		})
		const { app } = createApp([createStubProvider("freya.weather", weatherConfig)], MOCK_USER_ID)

		const res = await get(app, "freya.weather")

		expect(res.status).toBe(200)
		const body = (await res.json()) as { enabled: boolean; config: unknown }
		expect(body.enabled).toBe(false)
		expect(body.config).toEqual({ units: "imperial" })
	})
})

describe("PATCH /api/sources/:sourceId", () => {
	test("returns 401 without auth", async () => {
		activeStore = createInMemoryStore()
		const { app } = createApp([createStubProvider("freya.weather", weatherConfig)])

		const res = await patch(app, "freya.weather", { enabled: true })

		expect(res.status).toBe(401)
	})

	test("returns 404 for unknown source", async () => {
		activeStore = createInMemoryStore()
		const { app } = createApp([createStubProvider("freya.weather", weatherConfig)], MOCK_USER_ID)

		const res = await patch(app, "unknown.source", { enabled: true })

		expect(res.status).toBe(404)
		const body = (await res.json()) as { error: string }
		expect(body.error).toContain("not found")
	})

	test("returns 404 when user has no existing row for source", async () => {
		activeStore = createInMemoryStore()
		const { app } = createApp([createStubProvider("freya.weather", weatherConfig)], MOCK_USER_ID)

		const res = await patch(app, "freya.weather", { enabled: true })

		expect(res.status).toBe(404)
		const body = (await res.json()) as { error: string }
		expect(body.error).toContain("not found")
	})

	test("returns 204 when body is empty object (no-op) on existing source", async () => {
		activeStore = createInMemoryStore()
		activeStore.seed(MOCK_USER_ID, "freya.weather")
		const { app } = createApp([createStubProvider("freya.weather", weatherConfig)], MOCK_USER_ID)

		const res = await patch(app, "freya.weather", {})

		expect(res.status).toBe(204)
	})

	test("returns 404 when body is empty object on nonexistent user source", async () => {
		activeStore = createInMemoryStore()
		const { app } = createApp([createStubProvider("freya.weather", weatherConfig)], MOCK_USER_ID)

		const res = await patch(app, "freya.weather", {})

		expect(res.status).toBe(404)
	})

	test("returns 400 for invalid JSON body", async () => {
		activeStore = createInMemoryStore()
		activeStore.seed(MOCK_USER_ID, "freya.weather")
		const { app } = createApp([createStubProvider("freya.weather", weatherConfig)], MOCK_USER_ID)

		const res = await app.request("/api/sources/freya.weather", {
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
		activeStore.seed(MOCK_USER_ID, "freya.weather")
		const { app } = createApp([createStubProvider("freya.weather", weatherConfig)], MOCK_USER_ID)

		const res = await patch(app, "freya.weather", {
			enabled: true,
			unknownField: "hello",
		})

		expect(res.status).toBe(400)
	})

	test("returns 400 when weather config contains unknown fields", async () => {
		activeStore = createInMemoryStore()
		activeStore.seed(MOCK_USER_ID, "freya.weather")
		const { app } = createApp([createStubProvider("freya.weather", weatherConfig)], MOCK_USER_ID)

		const res = await patch(app, "freya.weather", {
			config: { units: "metric", unknownField: "hello" },
		})

		expect(res.status).toBe(400)
	})

	test("returns 400 when weather config fails validation", async () => {
		activeStore = createInMemoryStore()
		activeStore.seed(MOCK_USER_ID, "freya.weather")
		const { app } = createApp([createStubProvider("freya.weather", weatherConfig)], MOCK_USER_ID)

		const res = await patch(app, "freya.weather", {
			config: { units: "invalid" },
		})

		expect(res.status).toBe(400)
	})

	test("returns 204 and updates enabled", async () => {
		activeStore = createInMemoryStore()
		activeStore.seed(MOCK_USER_ID, "freya.weather", {
			enabled: true,
			config: { units: "metric" },
		})
		const { app } = createApp([createStubProvider("freya.weather", weatherConfig)], MOCK_USER_ID)

		const res = await patch(app, "freya.weather", { enabled: false })

		expect(res.status).toBe(204)
		const row = activeStore.rows.get(`${MOCK_USER_ID}:freya.weather`)
		expect(row!.enabled).toBe(false)
		expect(row!.config).toEqual({ units: "metric" })
	})

	test("returns 204 and updates config", async () => {
		activeStore = createInMemoryStore()
		activeStore.seed(MOCK_USER_ID, "freya.weather", {
			config: { units: "metric" },
		})
		const { app } = createApp([createStubProvider("freya.weather", weatherConfig)], MOCK_USER_ID)

		const res = await patch(app, "freya.weather", {
			config: { units: "imperial" },
		})

		expect(res.status).toBe(204)
		const row = activeStore.rows.get(`${MOCK_USER_ID}:freya.weather`)
		expect(row!.config).toEqual({ units: "imperial" })
	})

	test("preserves config when only updating enabled", async () => {
		activeStore = createInMemoryStore()
		activeStore.seed(MOCK_USER_ID, "freya.tfl", {
			enabled: true,
			config: { lines: ["bakerloo"] },
		})
		const { app } = createApp([createStubProvider("freya.tfl", tflConfig)], MOCK_USER_ID)

		const res = await patch(app, "freya.tfl", { enabled: false })

		expect(res.status).toBe(204)
		const row = activeStore.rows.get(`${MOCK_USER_ID}:freya.tfl`)
		expect(row!.enabled).toBe(false)
		expect(row!.config).toEqual({ lines: ["bakerloo"] })
	})

	test("deep-merges config on update", async () => {
		activeStore = createInMemoryStore()
		activeStore.seed(MOCK_USER_ID, "freya.weather", {
			config: { units: "metric", hourlyLimit: 12 },
		})
		const { app } = createApp([createStubProvider("freya.weather", weatherConfig)], MOCK_USER_ID)

		const res = await patch(app, "freya.weather", {
			config: { dailyLimit: 5 },
		})

		expect(res.status).toBe(204)
		const row = activeStore.rows.get(`${MOCK_USER_ID}:freya.weather`)
		expect(row!.config).toEqual({
			units: "metric",
			hourlyLimit: 12,
			dailyLimit: 5,
		})
	})

	test("refreshes source in active session after config update", async () => {
		activeStore = createInMemoryStore()
		activeStore.seed(MOCK_USER_ID, "freya.weather", {
			config: { units: "metric" },
		})
		const { app, sessionManager } = createApp(
			[createStubProvider("freya.weather", weatherConfig)],
			MOCK_USER_ID,
		)

		const session = await sessionManager.getOrCreate(MOCK_USER_ID)
		const replaceSpy = spyOn(session, "replaceSource")

		const res = await patch(app, "freya.weather", {
			config: { units: "imperial" },
		})

		expect(res.status).toBe(204)
		expect(replaceSpy).toHaveBeenCalled()
		replaceSpy.mockRestore()
	})

	test("removes source from session when disabled", async () => {
		activeStore = createInMemoryStore()
		activeStore.seed(MOCK_USER_ID, "freya.weather", {
			enabled: true,
			config: { units: "metric" },
		})
		const { app, sessionManager } = createApp(
			[createStubProvider("freya.weather", weatherConfig)],
			MOCK_USER_ID,
		)

		const session = await sessionManager.getOrCreate(MOCK_USER_ID)
		const removeSpy = spyOn(session, "removeSource")

		const res = await patch(app, "freya.weather", { enabled: false })

		expect(res.status).toBe(204)
		expect(removeSpy).toHaveBeenCalledWith("freya.weather")
		removeSpy.mockRestore()
	})

	test("returns 400 when config is provided for source without schema", async () => {
		activeStore = createInMemoryStore()
		activeStore.seed(MOCK_USER_ID, "freya.location")
		const { app } = createApp([createStubProvider("freya.location")], MOCK_USER_ID)

		const res = await patch(app, "freya.location", {
			config: { something: "value" },
		})

		expect(res.status).toBe(400)
	})

	test("returns 400 when empty config is provided for source without schema", async () => {
		activeStore = createInMemoryStore()
		activeStore.seed(MOCK_USER_ID, "freya.location")
		const { app } = createApp([createStubProvider("freya.location")], MOCK_USER_ID)

		const res = await patch(app, "freya.location", {
			config: {},
		})

		expect(res.status).toBe(400)
	})

	test("updates enabled on location source", async () => {
		activeStore = createInMemoryStore()
		activeStore.seed(MOCK_USER_ID, "freya.location", { enabled: true })
		const { app } = createApp([createStubProvider("freya.location")], MOCK_USER_ID)

		const res = await patch(app, "freya.location", { enabled: false })

		expect(res.status).toBe(204)
		const row = activeStore.rows.get(`${MOCK_USER_ID}:freya.location`)
		expect(row!.enabled).toBe(false)
	})
})

// ---------------------------------------------------------------------------
// PUT /api/sources/:sourceId
// ---------------------------------------------------------------------------

describe("PUT /api/sources/:sourceId", () => {
	test("returns 401 without auth", async () => {
		activeStore = createInMemoryStore()
		const { app } = createApp([createStubProvider("freya.weather", weatherConfig)])

		const res = await put(app, "freya.weather", { enabled: true, config: {} })

		expect(res.status).toBe(401)
	})

	test("returns 404 for unknown source", async () => {
		activeStore = createInMemoryStore()
		const { app } = createApp([createStubProvider("freya.weather", weatherConfig)], MOCK_USER_ID)

		const res = await put(app, "unknown.source", { enabled: true, config: {} })

		expect(res.status).toBe(404)
		const body = (await res.json()) as { error: string }
		expect(body.error).toContain("not found")
	})

	test("returns 400 for invalid JSON", async () => {
		activeStore = createInMemoryStore()
		const { app } = createApp([createStubProvider("freya.weather", weatherConfig)], MOCK_USER_ID)

		const res = await app.request("/api/sources/freya.weather", {
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
		const { app } = createApp([createStubProvider("freya.weather", weatherConfig)], MOCK_USER_ID)

		const res = await put(app, "freya.weather", { config: {} })

		expect(res.status).toBe(400)
	})

	test("returns 400 when config is missing", async () => {
		activeStore = createInMemoryStore()
		const { app } = createApp([createStubProvider("freya.weather", weatherConfig)], MOCK_USER_ID)

		const res = await put(app, "freya.weather", { enabled: true })

		expect(res.status).toBe(400)
	})

	test("returns 400 when request body contains unknown fields", async () => {
		activeStore = createInMemoryStore()
		const { app } = createApp([createStubProvider("freya.weather", weatherConfig)], MOCK_USER_ID)

		const res = await put(app, "freya.weather", {
			enabled: true,
			config: { units: "metric" },
			unknownField: "hello",
		})

		expect(res.status).toBe(400)
	})

	test("returns 400 when weather config contains unknown fields", async () => {
		activeStore = createInMemoryStore()
		const { app } = createApp([createStubProvider("freya.weather", weatherConfig)], MOCK_USER_ID)

		const res = await put(app, "freya.weather", {
			enabled: true,
			config: { units: "metric", unknownField: "hello" },
		})

		expect(res.status).toBe(400)
	})

	test("returns 400 when config fails schema validation", async () => {
		activeStore = createInMemoryStore()
		const { app } = createApp([createStubProvider("freya.weather", weatherConfig)], MOCK_USER_ID)

		const res = await put(app, "freya.weather", {
			enabled: true,
			config: { units: "invalid" },
		})

		expect(res.status).toBe(400)
	})

	test("returns 204 and inserts when row does not exist", async () => {
		activeStore = createInMemoryStore()
		const { app } = createApp([createStubProvider("freya.weather", weatherConfig)], MOCK_USER_ID)

		const res = await put(app, "freya.weather", {
			enabled: true,
			config: { units: "metric" },
		})

		expect(res.status).toBe(204)
		const row = activeStore.rows.get(`${MOCK_USER_ID}:freya.weather`)
		expect(row).toBeDefined()
		expect(row!.enabled).toBe(true)
		expect(row!.config).toEqual({ units: "metric" })
	})

	test("returns 204 and fully replaces existing row", async () => {
		activeStore = createInMemoryStore()
		activeStore.seed(MOCK_USER_ID, "freya.weather", {
			enabled: true,
			config: { units: "metric", hourlyLimit: 12 },
		})
		const { app } = createApp([createStubProvider("freya.weather", weatherConfig)], MOCK_USER_ID)

		const res = await put(app, "freya.weather", {
			enabled: false,
			config: { units: "imperial" },
		})

		expect(res.status).toBe(204)
		const row = activeStore.rows.get(`${MOCK_USER_ID}:freya.weather`)
		expect(row!.enabled).toBe(false)
		// hourlyLimit should be gone — full replace, not merge
		expect(row!.config).toEqual({ units: "imperial" })
	})

	test("refreshes source in active session after upsert", async () => {
		activeStore = createInMemoryStore()
		activeStore.seed(MOCK_USER_ID, "freya.weather", {
			config: { units: "metric" },
		})
		const { app, sessionManager } = createApp(
			[createStubProvider("freya.weather", weatherConfig)],
			MOCK_USER_ID,
		)

		const session = await sessionManager.getOrCreate(MOCK_USER_ID)
		const replaceSpy = spyOn(session, "replaceSource")

		const res = await put(app, "freya.weather", {
			enabled: true,
			config: { units: "imperial" },
		})

		expect(res.status).toBe(204)
		expect(replaceSpy).toHaveBeenCalled()
		replaceSpy.mockRestore()
	})

	test("removes source from session when disabled via upsert", async () => {
		activeStore = createInMemoryStore()
		activeStore.seed(MOCK_USER_ID, "freya.weather", {
			enabled: true,
			config: { units: "metric" },
		})
		const { app, sessionManager } = createApp(
			[createStubProvider("freya.weather", weatherConfig)],
			MOCK_USER_ID,
		)

		const session = await sessionManager.getOrCreate(MOCK_USER_ID)
		const removeSpy = spyOn(session, "removeSource")

		const res = await put(app, "freya.weather", {
			enabled: false,
			config: { units: "metric" },
		})

		expect(res.status).toBe(204)
		expect(removeSpy).toHaveBeenCalledWith("freya.weather")
		removeSpy.mockRestore()
	})

	test("adds source to active session when inserting a new source", async () => {
		activeStore = createInMemoryStore()
		// Seed a different source so the session can be created
		activeStore.seed(MOCK_USER_ID, "freya.location", { enabled: true })
		const { app, sessionManager } = createApp(
			[createStubProvider("freya.location"), createStubProvider("freya.weather", weatherConfig)],
			MOCK_USER_ID,
		)

		// Create session — only has freya.location
		const session = await sessionManager.getOrCreate(MOCK_USER_ID)
		expect(session.hasSource("freya.weather")).toBe(false)

		// PUT a new source that didn't exist before
		const res = await put(app, "freya.weather", {
			enabled: true,
			config: { units: "metric" },
		})

		expect(res.status).toBe(204)
		expect(session.hasSource("freya.weather")).toBe(true)
	})

	test("returns 400 when config is provided for source without schema", async () => {
		activeStore = createInMemoryStore()
		const { app } = createApp([createStubProvider("freya.location")], MOCK_USER_ID)

		const res = await put(app, "freya.location", {
			enabled: true,
			config: { something: "value" },
		})

		expect(res.status).toBe(400)
	})

	test("returns 400 when empty config is provided for source without schema", async () => {
		activeStore = createInMemoryStore()
		const { app } = createApp([createStubProvider("freya.location")], MOCK_USER_ID)

		const res = await put(app, "freya.location", {
			enabled: true,
			config: {},
		})

		expect(res.status).toBe(400)
	})

	test("returns 204 without config field for source without schema", async () => {
		activeStore = createInMemoryStore()
		const { app } = createApp([createStubProvider("freya.location")], MOCK_USER_ID)

		const res = await put(app, "freya.location", {
			enabled: true,
		})

		expect(res.status).toBe(204)
	})

	test("returns 204 when credentials are included alongside config", async () => {
		activeStore = createInMemoryStore()
		const { app } = createAppWithEncryptor(
			[createStubProvider("freya.weather", weatherConfig)],
			MOCK_USER_ID,
		)

		const res = await put(app, "freya.weather", {
			enabled: true,
			config: { units: "metric" },
			credentials: { apiKey: "secret123" },
		})

		expect(res.status).toBe(204)
		const row = activeStore.rows.get(`${MOCK_USER_ID}:freya.weather`)
		expect(row).toBeDefined()
		expect(row!.enabled).toBe(true)
		expect(row!.config).toEqual({ units: "metric" })
	})

	test("returns 503 when credentials are provided but no encryptor is configured", async () => {
		activeStore = createInMemoryStore()
		// createApp does NOT configure an encryptor
		const { app } = createApp([createStubProvider("freya.weather", weatherConfig)], MOCK_USER_ID)

		const res = await put(app, "freya.weather", {
			enabled: true,
			config: { units: "metric" },
			credentials: { apiKey: "secret123" },
		})

		expect(res.status).toBe(503)
		const body = (await res.json()) as { error: string }
		expect(body.error).toContain("not configured")
	})
})

describe("GET /api/sources/:sourceId/actions", () => {
	test("returns 401 without auth", async () => {
		activeStore = createInMemoryStore()
		const { app } = createApp([createStubProvider("freya.location")])

		const res = await listActions(app, "freya.location")

		expect(res.status).toBe(401)
	})

	test("returns 404 for source that is not enabled in the user session", async () => {
		activeStore = createInMemoryStore()
		const { app } = createApp([createStubProvider("freya.location")], MOCK_USER_ID)

		const res = await listActions(app, "freya.location")

		expect(res.status).toBe(404)
	})

	test("returns serializable action definitions", async () => {
		activeStore = createInMemoryStore()
		activeStore.seed(MOCK_USER_ID, "test.actions")
		const provider: FeedSourceProvider = {
			sourceId: "test.actions",
			async feedSourceForUser() {
				return {
					id: "test.actions",
					async listActions() {
						return {
							search: {
								id: "search",
								description: "Search something",
								input: tflConfig,
							},
						}
					},
					async executeAction() {
						return undefined
					},
					async fetchContext() {
						return null
					},
				}
			},
		}
		const { app } = createApp([provider], MOCK_USER_ID)

		const res = await listActions(app, "test.actions")

		expect(res.status).toBe(200)
		const body = (await res.json()) as {
			actions: Record<string, { id: string; description?: string; input?: unknown }>
		}
		expect(body.actions.search).toEqual({
			id: "search",
			description: "Search something",
		})
	})
})

describe("POST /api/sources/:sourceId/actions/:actionId", () => {
	test("returns 401 without auth", async () => {
		activeStore = createInMemoryStore()
		const { app } = createApp([createStubProvider("freya.location")])

		const res = await executeAction(app, "freya.location", "update-location", {})

		expect(res.status).toBe(401)
	})

	test("executes source action with request body as params", async () => {
		activeStore = createInMemoryStore()
		activeStore.seed(MOCK_USER_ID, "test.actions")
		let receivedParams: unknown
		const provider: FeedSourceProvider = {
			sourceId: "test.actions",
			async feedSourceForUser() {
				return {
					id: "test.actions",
					async listActions() {
						return {
							search: { id: "search", description: "Search something" },
						}
					},
					async executeAction(_actionId: string, params: unknown) {
						receivedParams = params
						return { ok: true, count: 2 }
					},
					async fetchContext() {
						return null
					},
				}
			},
		}
		const { app } = createApp([provider], MOCK_USER_ID)

		const res = await executeAction(app, "test.actions", "search", { query: "exa" })

		expect(res.status).toBe(200)
		expect(receivedParams).toEqual({ query: "exa" })
		const body = (await res.json()) as { result: unknown }
		expect(body.result).toEqual({ ok: true, count: 2 })
	})

	test("returns 404 for unknown action", async () => {
		activeStore = createInMemoryStore()
		activeStore.seed(MOCK_USER_ID, "freya.location")
		const { app } = createApp([createStubProvider("freya.location")], MOCK_USER_ID)

		const res = await executeAction(app, "freya.location", "missing", {})

		expect(res.status).toBe(404)
	})

	test("returns 400 for invalid JSON", async () => {
		activeStore = createInMemoryStore()
		activeStore.seed(MOCK_USER_ID, "freya.location")
		const { app } = createApp([createStubProvider("freya.location")], MOCK_USER_ID)

		const res = await app.request("/api/sources/freya.location/actions/search", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: "not-json",
		})

		expect(res.status).toBe(400)
		const body = (await res.json()) as { error: string }
		expect(body.error).toBe("Invalid JSON")
	})

	test("returns 400 when source rejects params", async () => {
		activeStore = createInMemoryStore()
		activeStore.seed(MOCK_USER_ID, "test.actions")
		const provider: FeedSourceProvider = {
			sourceId: "test.actions",
			async feedSourceForUser() {
				return {
					id: "test.actions",
					async listActions() {
						return {
							search: { id: "search" },
						}
					},
					async executeAction() {
						throw new Error("query must not be empty")
					},
					async fetchContext() {
						return null
					},
				}
			},
		}
		const { app } = createApp([provider], MOCK_USER_ID)

		const res = await executeAction(app, "test.actions", "search", { query: "" })

		expect(res.status).toBe(400)
		const body = (await res.json()) as { error: string }
		expect(body.error).toBe("query must not be empty")
	})
})

describe("PUT /api/sources/:sourceId/credentials", () => {
	test("returns 401 without auth", async () => {
		activeStore = createInMemoryStore()
		const { app } = createAppWithEncryptor([createStubProvider("freya.location")])

		const res = await putCredentials(app, "freya.location", { token: "x" })

		expect(res.status).toBe(401)
	})

	test("returns 404 for unknown source", async () => {
		activeStore = createInMemoryStore()
		const { app } = createAppWithEncryptor([createStubProvider("freya.location")], MOCK_USER_ID)

		const res = await putCredentials(app, "unknown.source", { token: "x" })

		expect(res.status).toBe(404)
	})

	test("returns 400 for invalid JSON", async () => {
		activeStore = createInMemoryStore()
		activeStore.seed(MOCK_USER_ID, "freya.location")
		const { app } = createAppWithEncryptor([createStubProvider("freya.location")], MOCK_USER_ID)

		const res = await app.request("/api/sources/freya.location/credentials", {
			method: "PUT",
			headers: { "Content-Type": "application/json" },
			body: "not-json",
		})

		expect(res.status).toBe(400)
		const body = (await res.json()) as { error: string }
		expect(body.error).toBe("Invalid JSON")
	})

	test("returns 204 and persists credentials", async () => {
		activeStore = createInMemoryStore()
		activeStore.seed(MOCK_USER_ID, "freya.location")
		const { app } = createAppWithEncryptor([createStubProvider("freya.location")], MOCK_USER_ID)

		const res = await putCredentials(app, "freya.location", { token: "secret" })

		expect(res.status).toBe(204)
	})

	test("returns 400 when provider throws InvalidSourceCredentialsError", async () => {
		activeStore = createInMemoryStore()
		activeStore.seed(MOCK_USER_ID, "test.creds")
		let callCount = 0
		const provider: FeedSourceProvider = {
			sourceId: "test.creds",
			async feedSourceForUser(_userId: string, _config: unknown, _credentials: unknown) {
				callCount++
				if (callCount > 1) {
					throw new InvalidSourceCredentialsError("test.creds", "invalid token format")
				}
				return createStubSource("test.creds")
			},
		}
		const { app, sessionManager } = createAppWithEncryptor([provider], MOCK_USER_ID)

		await sessionManager.getOrCreate(MOCK_USER_ID)

		const res = await putCredentials(app, "test.creds", { token: "bad" })

		expect(res.status).toBe(400)
		const body = (await res.json()) as { error: string }
		expect(body.error).toContain("invalid token format")
	})

	test("returns 503 when credential encryption is not configured", async () => {
		activeStore = createInMemoryStore()
		activeStore.seed(MOCK_USER_ID, "freya.location")
		const { app } = createApp([createStubProvider("freya.location")], MOCK_USER_ID)

		const res = await putCredentials(app, "freya.location", { token: "x" })

		expect(res.status).toBe(503)
		const body = (await res.json()) as { error: string }
		expect(body.error).toContain("not configured")
	})
})
