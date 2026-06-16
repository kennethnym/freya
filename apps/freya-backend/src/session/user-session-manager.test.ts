import type { ActionDefinition, ContextEntry, FeedItem, FeedSource } from "@freya/core"

import { LocationSource } from "@freya/source-location"
import { WeatherSource } from "@freya/source-weatherkit"
import { beforeEach, describe, expect, mock, spyOn, test } from "bun:test"

import type { ConversationStorageEntry } from "../agent/conversation-recording-query-agent.ts"
import type { AppendConversationEntryInput } from "../conversations/storage.ts"
import type { Database } from "../db/index.ts"
import type { FeedSourceProvider } from "./feed-source-provider.ts"

import { ConversationEntryKind } from "../conversations/types.ts"
import { CredentialEncryptor } from "../lib/crypto.ts"
import {
	CredentialStorageUnavailableError,
	InvalidSourceCredentialsError,
} from "../sources/errors.ts"
import { SourceNotFoundError } from "../sources/errors.ts"
import { UserSessionManager } from "./user-session-manager.ts"

/**
 * Per-user enabled source IDs used by the mocked `sources` module.
 * Tests configure this before calling getOrCreate.
 * Key = userId (or "*" for a default), value = array of enabled sourceIds.
 */
const enabledByUser = new Map<string, string[]>()
const conversationEntriesByUser = new Map<string, ConversationStorageEntry[]>()
const mockConversationCalls: Array<{ type: "getOrCreate" | "listEntries"; userId: string }> = []

/** Set which sourceIds are enabled for all users. */
function setEnabledSources(sourceIds: string[]) {
	enabledByUser.clear()
	enabledByUser.set("*", sourceIds)
}

/** Set which sourceIds are enabled for a specific user. */
function setEnabledSourcesForUser(userId: string, sourceIds: string[]) {
	enabledByUser.set(userId, sourceIds)
}

function getEnabledSourceIds(userId: string): string[] {
	return enabledByUser.get(userId) ?? enabledByUser.get("*") ?? []
}

function setConversationEntriesForUser(userId: string, entries: ConversationStorageEntry[]) {
	conversationEntriesByUser.set(userId, entries)
}

/**
 * Controls what `find()` returns in the mock. When `undefined` (the default),
 * `find()` returns a standard enabled row. Set to a specific value (including
 * `null`) to override the return value for all `find()` calls.
 */
let mockFindResult: unknown | undefined

/**
 * Spy for `updateCredentials` calls. Tests can inspect calls via
 * `mockUpdateCredentialsCalls` or override behavior.
 */
const mockUpdateCredentialsCalls: Array<{ sourceId: string; credentials: Buffer }> = []
let mockUpdateCredentialsError: Error | null = null

// Mock the sources module so UserSessionManager's DB query returns controlled data.
mock.module("../sources/user-sources.ts", () => ({
	sources: (_db: Database, userId: string) => ({
		async enabled() {
			const now = new Date()
			return getEnabledSourceIds(userId).map((sourceId) => ({
				id: crypto.randomUUID(),
				userId,
				sourceId,
				enabled: true,
				config: {},
				credentials: null,
				createdAt: now,
				updatedAt: now,
			}))
		},
		async find(sourceId: string) {
			if (mockFindResult !== undefined) return mockFindResult
			const now = new Date()
			return {
				id: crypto.randomUUID(),
				userId,
				sourceId,
				enabled: true,
				config: {},
				credentials: null,
				createdAt: now,
				updatedAt: now,
			}
		},
		async findForUpdate(sourceId: string) {
			// Delegates to find — row locking is a no-op in tests.
			if (mockFindResult !== undefined) return mockFindResult
			const now = new Date()
			return {
				id: crypto.randomUUID(),
				userId,
				sourceId,
				enabled: true,
				config: {},
				credentials: null,
				createdAt: now,
				updatedAt: now,
			}
		},
		async updateConfig(_sourceId: string, _update: { enabled?: boolean; config?: unknown }) {
			// no-op for tests
		},
		async upsertConfig(_sourceId: string, _data: { enabled: boolean; config: unknown }) {
			// no-op for tests
		},
		async updateCredentials(sourceId: string, credentials: Buffer) {
			if (mockUpdateCredentialsError) {
				throw mockUpdateCredentialsError
			}
			mockUpdateCredentialsCalls.push({ sourceId, credentials })
		},
	}),
}))

mock.module("../conversations/storage.ts", () => ({
	conversations: (_db: Database, userId: string) => ({
		async getOrCreateConversation(): Promise<{ id: string }> {
			mockConversationCalls.push({ type: "getOrCreate", userId })
			return { id: `conversation-${userId}` }
		},
		async listEntries(_conversationId: string): Promise<ConversationStorageEntry[]> {
			mockConversationCalls.push({ type: "listEntries", userId })
			return conversationEntriesByUser.get(userId) ?? []
		},
		async appendEntry(
			_conversationId: string,
			input: AppendConversationEntryInput,
		): Promise<ConversationStorageEntry> {
			const entries = conversationEntriesByUser.get(userId) ?? []
			const row: ConversationStorageEntry = {
				id: `entry-${entries.length + 1}`,
				sequence: entries.length + 1,
				kind: input.kind,
				payload: input.payload,
				metadata: input.metadata ?? {},
				createdAt: new Date("2026-06-15T00:00:00.000Z"),
			}
			conversationEntriesByUser.set(userId, [...entries, row])
			return row
		},
	}),
}))

const fakeDb = {
	transaction: <T>(fn: (tx: unknown) => Promise<T>) => fn(fakeDb),
} as unknown as Database

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

function createStubProvider(
	sourceId: string,
	factory: (
		userId: string,
		config: Record<string, unknown>,
		credentials: unknown,
	) => Promise<FeedSource> = async () => createStubSource(sourceId),
): FeedSourceProvider {
	return { sourceId, feedSourceForUser: factory }
}

const locationProvider: FeedSourceProvider = {
	sourceId: "freya.location",
	async feedSourceForUser() {
		return new LocationSource()
	},
}

const weatherProvider: FeedSourceProvider = {
	sourceId: "freya.weather",
	async feedSourceForUser() {
		return new WeatherSource({ client: { fetch: async () => ({}) as never } })
	},
}

beforeEach(() => {
	enabledByUser.clear()
	conversationEntriesByUser.clear()
	mockConversationCalls.length = 0
	mockFindResult = undefined
	mockUpdateCredentialsCalls.length = 0
	mockUpdateCredentialsError = null
})

describe("UserSessionManager", () => {
	test("getOrCreate creates session on first call", async () => {
		setEnabledSources(["freya.location"])
		const manager = new UserSessionManager({ db: fakeDb, providers: [locationProvider] })

		const session = await manager.getOrCreate("user-1")

		expect(session).toBeDefined()
		expect(session.engine).toBeDefined()
	})

	test("getOrCreate eagerly loads conversation entries for the user session", async () => {
		setEnabledSources([])
		setConversationEntriesForUser("user-1", [
			{
				id: "entry-1",
				sequence: 1,
				kind: ConversationEntryKind.UserMessage,
				payload: {
					role: "user",
					parts: [{ type: "text", text: "stored hello" }],
				},
				metadata: {},
				createdAt: new Date("2026-06-15T00:00:00.000Z"),
			},
		])
		const manager = new UserSessionManager({ db: fakeDb, providers: [] })

		await manager.getOrCreate("user-1")

		expect(mockConversationCalls).toEqual([
			{ type: "getOrCreate", userId: "user-1" },
			{ type: "listEntries", userId: "user-1" },
		])
	})

	test("getOrCreate returns same session for same user", async () => {
		setEnabledSources(["freya.location"])
		const manager = new UserSessionManager({ db: fakeDb, providers: [locationProvider] })

		const session1 = await manager.getOrCreate("user-1")
		const session2 = await manager.getOrCreate("user-1")

		expect(session1).toBe(session2)
	})

	test("getOrCreate returns different sessions for different users", async () => {
		setEnabledSources(["freya.location"])
		const manager = new UserSessionManager({ db: fakeDb, providers: [locationProvider] })

		const session1 = await manager.getOrCreate("user-1")
		const session2 = await manager.getOrCreate("user-2")

		expect(session1).not.toBe(session2)
	})

	test("each user gets independent source instances", async () => {
		setEnabledSources(["freya.location"])
		const manager = new UserSessionManager({ db: fakeDb, providers: [locationProvider] })

		const session1 = await manager.getOrCreate("user-1")
		const session2 = await manager.getOrCreate("user-2")

		const source1 = session1.getSource<LocationSource>("freya.location")
		const source2 = session2.getSource<LocationSource>("freya.location")

		expect(source1).not.toBe(source2)
	})

	test("remove destroys session and allows re-creation", async () => {
		setEnabledSources(["freya.location"])
		const manager = new UserSessionManager({ db: fakeDb, providers: [locationProvider] })

		const session1 = await manager.getOrCreate("user-1")
		manager.remove("user-1")
		const session2 = await manager.getOrCreate("user-1")

		expect(session1).not.toBe(session2)
	})

	test("remove is no-op for unknown user", () => {
		setEnabledSources(["freya.location"])
		const manager = new UserSessionManager({ db: fakeDb, providers: [locationProvider] })

		expect(() => manager.remove("unknown")).not.toThrow()
	})

	test("registers multiple providers", async () => {
		setEnabledSources(["freya.location", "freya.weather"])
		const manager = new UserSessionManager({
			db: fakeDb,
			providers: [locationProvider, weatherProvider],
		})

		const session = await manager.getOrCreate("user-1")

		expect(session.getSource("freya.location")).toBeDefined()
		expect(session.getSource("freya.weather")).toBeDefined()
	})

	test("refresh returns feed result through session", async () => {
		setEnabledSources(["freya.location"])
		const manager = new UserSessionManager({ db: fakeDb, providers: [locationProvider] })

		const session = await manager.getOrCreate("user-1")
		const result = await session.engine.refresh()

		expect(result).toHaveProperty("context")
		expect(result).toHaveProperty("items")
		expect(result).toHaveProperty("errors")
		expect(result.context.time).toBeInstanceOf(Date)
	})

	test("location update via executeAction works", async () => {
		setEnabledSources(["freya.location"])
		const manager = new UserSessionManager({ db: fakeDb, providers: [locationProvider] })

		const session = await manager.getOrCreate("user-1")
		await session.engine.executeAction("freya.location", "update-location", {
			lat: 51.5074,
			lng: -0.1278,
			accuracy: 10,
			timestamp: new Date(),
		})

		const source = session.getSource<LocationSource>("freya.location")
		expect(source?.lastLocation?.lat).toBe(51.5074)
	})

	test("subscribe receives updates after location push", async () => {
		setEnabledSources(["freya.location"])
		const manager = new UserSessionManager({ db: fakeDb, providers: [locationProvider] })
		const callback = mock()

		const session = await manager.getOrCreate("user-1")
		session.engine.subscribe(callback)

		await session.engine.executeAction("freya.location", "update-location", {
			lat: 51.5074,
			lng: -0.1278,
			accuracy: 10,
			timestamp: new Date(),
		})

		// Wait for async update propagation
		await new Promise((resolve) => setTimeout(resolve, 10))

		expect(callback).toHaveBeenCalled()
	})

	test("remove stops reactive updates", async () => {
		setEnabledSources(["freya.location"])
		const manager = new UserSessionManager({ db: fakeDb, providers: [locationProvider] })
		const callback = mock()

		const session = await manager.getOrCreate("user-1")
		session.engine.subscribe(callback)

		manager.remove("user-1")

		// Create new session and push location — old callback should not fire
		const session2 = await manager.getOrCreate("user-1")
		await session2.engine.executeAction("freya.location", "update-location", {
			lat: 51.5074,
			lng: -0.1278,
			accuracy: 10,
			timestamp: new Date(),
		})

		await new Promise((resolve) => setTimeout(resolve, 10))

		expect(callback).not.toHaveBeenCalled()
	})

	test("creates session with successful providers when some fail", async () => {
		setEnabledSources(["freya.location", "freya.failing"])
		const failingProvider: FeedSourceProvider = {
			sourceId: "freya.failing",
			async feedSourceForUser() {
				throw new Error("provider failed")
			},
		}

		const manager = new UserSessionManager({
			db: fakeDb,
			providers: [locationProvider, failingProvider],
		})

		const spy = spyOn(console, "error").mockImplementation(() => {})

		const session = await manager.getOrCreate("user-1")

		expect(session).toBeDefined()
		expect(session.getSource("freya.location")).toBeDefined()
		expect(spy).toHaveBeenCalled()

		spy.mockRestore()
	})

	test("throws AggregateError when all providers fail", async () => {
		setEnabledSources(["freya.fail-1", "freya.fail-2"])
		const manager = new UserSessionManager({
			db: fakeDb,
			providers: [
				{
					sourceId: "freya.fail-1",
					async feedSourceForUser() {
						throw new Error("first failed")
					},
				},
				{
					sourceId: "freya.fail-2",
					async feedSourceForUser() {
						throw new Error("second failed")
					},
				},
			],
		})

		await expect(manager.getOrCreate("user-1")).rejects.toBeInstanceOf(AggregateError)
	})

	test("concurrent getOrCreate for same user returns same session", async () => {
		setEnabledSources(["freya.location"])
		let callCount = 0
		const manager = new UserSessionManager({
			db: fakeDb,
			providers: [
				{
					sourceId: "freya.location",
					async feedSourceForUser() {
						callCount++
						await new Promise((resolve) => setTimeout(resolve, 10))
						return new LocationSource()
					},
				},
			],
		})

		const [session1, session2] = await Promise.all([
			manager.getOrCreate("user-1"),
			manager.getOrCreate("user-1"),
		])

		expect(session1).toBe(session2)
		expect(callCount).toBe(1)
	})

	test("remove during in-flight getOrCreate prevents session from being stored", async () => {
		setEnabledSources(["freya.location"])
		let resolveProvider: () => void
		const providerGate = new Promise<void>((r) => {
			resolveProvider = r
		})

		const manager = new UserSessionManager({
			db: fakeDb,
			providers: [
				{
					sourceId: "freya.location",
					async feedSourceForUser() {
						await providerGate
						return new LocationSource()
					},
				},
			],
		})

		const sessionPromise = manager.getOrCreate("user-1")

		// remove() while provider is still resolving
		manager.remove("user-1")

		// Let the provider finish
		resolveProvider!()

		await expect(sessionPromise).rejects.toThrow("removed during creation")

		// A fresh getOrCreate should produce a new session, not the cancelled one
		const freshSession = await manager.getOrCreate("user-1")
		expect(freshSession).toBeDefined()
		expect(freshSession.engine).toBeDefined()
	})

	test("only invokes providers for sources enabled for the user", async () => {
		setEnabledSources(["freya.location"])
		const locationFactory = mock(async () => createStubSource("freya.location"))
		const weatherFactory = mock(async () => createStubSource("freya.weather"))

		const manager = new UserSessionManager({
			db: fakeDb,
			providers: [
				{ sourceId: "freya.location", feedSourceForUser: locationFactory },
				{ sourceId: "freya.weather", feedSourceForUser: weatherFactory },
			],
		})

		const session = await manager.getOrCreate("user-1")

		expect(locationFactory).toHaveBeenCalledTimes(1)
		expect(weatherFactory).not.toHaveBeenCalled()
		expect(session.getSource("freya.location")).toBeDefined()
		expect(session.getSource("freya.weather")).toBeUndefined()
	})

	test("creates empty session when no sources are enabled", async () => {
		setEnabledSources([])
		const factory = mock(async () => createStubSource("freya.location"))

		const manager = new UserSessionManager({
			db: fakeDb,
			providers: [{ sourceId: "freya.location", feedSourceForUser: factory }],
		})

		const session = await manager.getOrCreate("user-1")

		expect(factory).not.toHaveBeenCalled()
		expect(session).toBeDefined()
		expect(session.getSource("freya.location")).toBeUndefined()
	})

	test("per-user enabled sources are respected", async () => {
		enabledByUser.clear()
		setEnabledSourcesForUser("user-1", ["freya.location"])
		setEnabledSourcesForUser("user-2", ["freya.weather"])

		const manager = new UserSessionManager({
			db: fakeDb,
			providers: [createStubProvider("freya.location"), createStubProvider("freya.weather")],
		})

		const session1 = await manager.getOrCreate("user-1")
		const session2 = await manager.getOrCreate("user-2")

		expect(session1.getSource("freya.location")).toBeDefined()
		expect(session1.getSource("freya.weather")).toBeUndefined()
		expect(session2.getSource("freya.location")).toBeUndefined()
		expect(session2.getSource("freya.weather")).toBeDefined()
	})
})

describe("UserSessionManager.replaceProvider", () => {
	test("replaces source in all active sessions", async () => {
		setEnabledSources(["test"])
		const itemsV1: FeedItem[] = [
			{
				id: "v1",
				sourceId: "test",
				type: "test",
				timestamp: new Date(),
				data: { version: 1 },
			},
		]
		const itemsV2: FeedItem[] = [
			{
				id: "v2",
				sourceId: "test",
				type: "test",
				timestamp: new Date(),
				data: { version: 2 },
			},
		]

		const providerV1 = createStubProvider("test", async () => createStubSource("test", itemsV1))
		const manager = new UserSessionManager({ db: fakeDb, providers: [providerV1] })

		const session1 = await manager.getOrCreate("user-1")
		const session2 = await manager.getOrCreate("user-2")

		// Verify v1 items
		const feed1 = await session1.feed()
		expect(feed1.items[0]!.data.version).toBe(1)

		// Replace provider
		const providerV2 = createStubProvider("test", async () => createStubSource("test", itemsV2))
		await manager.replaceProvider(providerV2)

		// Both sessions should now serve v2 items
		const feed1After = await session1.feed()
		const feed2After = await session2.feed()
		expect(feed1After.items[0]!.data.version).toBe(2)
		expect(feed2After.items[0]!.data.version).toBe(2)
	})

	test("throws for unknown provider sourceId", async () => {
		setEnabledSources(["freya.location"])
		const manager = new UserSessionManager({ db: fakeDb, providers: [locationProvider] })

		const unknownProvider = createStubProvider("freya.unknown")

		await expect(manager.replaceProvider(unknownProvider)).rejects.toThrow(
			"no existing provider with that sourceId",
		)
	})

	test("keeps existing source when new provider fails for a user", async () => {
		setEnabledSources(["test"])
		const providerV1 = createStubProvider("test", async () => createStubSource("test"))
		const manager = new UserSessionManager({ db: fakeDb, providers: [providerV1] })

		const session = await manager.getOrCreate("user-1")
		expect(session.getSource("test")).toBeDefined()

		const spy = spyOn(console, "error").mockImplementation(() => {})

		const failingProvider = createStubProvider("test", async () => {
			throw new Error("source disabled")
		})
		await manager.replaceProvider(failingProvider)

		expect(session.getSource("test")).toBeDefined()
		expect(spy).toHaveBeenCalled()

		spy.mockRestore()
	})

	test("new sessions use the replaced provider", async () => {
		setEnabledSources(["test"])
		const itemsV1: FeedItem[] = [
			{
				id: "v1",
				sourceId: "test",
				type: "test",
				timestamp: new Date(),
				data: { version: 1 },
			},
		]
		const itemsV2: FeedItem[] = [
			{
				id: "v2",
				sourceId: "test",
				type: "test",
				timestamp: new Date(),
				data: { version: 2 },
			},
		]

		const providerV1 = createStubProvider("test", async () => createStubSource("test", itemsV1))
		const manager = new UserSessionManager({ db: fakeDb, providers: [providerV1] })

		const providerV2 = createStubProvider("test", async () => createStubSource("test", itemsV2))
		await manager.replaceProvider(providerV2)

		// New session should use v2
		const session = await manager.getOrCreate("user-new")
		const feed = await session.feed()
		expect(feed.items[0]!.data.version).toBe(2)
	})

	test("does not affect other providers' sources", async () => {
		setEnabledSources(["source-a", "source-b"])
		const providerA = createStubProvider("source-a", async () =>
			createStubSource("source-a", [
				{
					id: "a-1",
					sourceId: "source-a",
					type: "test",
					timestamp: new Date(),
					data: { from: "a" },
				},
			]),
		)
		const providerB = createStubProvider("source-b", async () =>
			createStubSource("source-b", [
				{
					id: "b-1",
					sourceId: "source-b",
					type: "test",
					timestamp: new Date(),
					data: { from: "b" },
				},
			]),
		)

		const manager = new UserSessionManager({ db: fakeDb, providers: [providerA, providerB] })
		const session = await manager.getOrCreate("user-1")

		// Replace only source-a
		const providerA2 = createStubProvider("source-a", async () =>
			createStubSource("source-a", [
				{
					id: "a-2",
					sourceId: "source-a",
					type: "test",
					timestamp: new Date(),
					data: { from: "a-new" },
				},
			]),
		)
		await manager.replaceProvider(providerA2)

		// source-b should be unaffected
		expect(session.getSource("source-b")).toBeDefined()
		const feed = await session.feed()
		const ids = feed.items.map((i) => i.id).sort()
		expect(ids).toEqual(["a-2", "b-1"])
	})

	test("updates sessions that are still being created", async () => {
		setEnabledSources(["test"])
		const itemsV1: FeedItem[] = [
			{
				id: "v1",
				sourceId: "test",
				type: "test",
				timestamp: new Date(),
				data: { version: 1 },
			},
		]
		const itemsV2: FeedItem[] = [
			{
				id: "v2",
				sourceId: "test",
				type: "test",
				timestamp: new Date(),
				data: { version: 2 },
			},
		]

		let resolveCreation: () => void
		const creationGate = new Promise<void>((r) => {
			resolveCreation = r
		})

		const providerV1 = createStubProvider("test", async () => {
			await creationGate
			return createStubSource("test", itemsV1)
		})
		const manager = new UserSessionManager({ db: fakeDb, providers: [providerV1] })

		// Start session creation but don't let it finish yet
		const sessionPromise = manager.getOrCreate("user-1")

		// Replace provider while session is still pending
		const providerV2 = createStubProvider("test", async () => createStubSource("test", itemsV2))
		const replacePromise = manager.replaceProvider(providerV2)

		// Let the original creation finish
		resolveCreation!()

		const session = await sessionPromise
		await replacePromise

		// Session should have been updated to v2
		const feed = await session.feed()
		expect(feed.items[0]!.data.version).toBe(2)
	})

	test("skips source replacement when source was disabled between creation and replace", async () => {
		setEnabledSources(["test"])
		const itemsV1: FeedItem[] = [
			{
				id: "v1",
				sourceId: "test",
				type: "test",
				timestamp: new Date(),
				data: { version: 1 },
			},
		]

		const providerV1 = createStubProvider("test", async () => createStubSource("test", itemsV1))
		const manager = new UserSessionManager({ db: fakeDb, providers: [providerV1] })

		const session = await manager.getOrCreate("user-1")
		const feedBefore = await session.feed()
		expect(feedBefore.items[0]!.data.version).toBe(1)

		// Simulate the source being disabled/deleted between session creation and replace
		mockFindResult = null

		const providerV2 = createStubProvider("test", async () =>
			createStubSource("test", [
				{
					id: "v2",
					sourceId: "test",
					type: "test",
					timestamp: new Date(),
					data: { version: 2 },
				},
			]),
		)
		await manager.replaceProvider(providerV2)

		// Session should still have v1 — the replace was skipped
		const feedAfter = await session.feed()
		expect(feedAfter.items[0]!.data.version).toBe(1)
	})
})

const TEST_ENCRYPTION_KEY = "/bv1nbzC4ozZkT/pcv5oQfl+JAMuMZDUSVDesG2dur8="
const testEncryptor = new CredentialEncryptor(TEST_ENCRYPTION_KEY)

describe("UserSessionManager.updateSourceCredentials", () => {
	test("encrypts and persists credentials", async () => {
		setEnabledSources(["test"])
		const provider = createStubProvider("test")
		const manager = new UserSessionManager({
			db: fakeDb,
			providers: [provider],
			credentialEncryptor: testEncryptor,
		})

		await manager.updateSourceCredentials("user-1", "test", { token: "secret-123" })

		expect(mockUpdateCredentialsCalls).toHaveLength(1)
		expect(mockUpdateCredentialsCalls[0]!.sourceId).toBe("test")

		// Verify the persisted buffer decrypts to the original credentials
		const decrypted = JSON.parse(testEncryptor.decrypt(mockUpdateCredentialsCalls[0]!.credentials))
		expect(decrypted).toEqual({ token: "secret-123" })
	})

	test("throws CredentialStorageUnavailableError when encryptor is not configured", async () => {
		setEnabledSources(["test"])
		const provider = createStubProvider("test")
		const manager = new UserSessionManager({
			db: fakeDb,
			providers: [provider],
			// no credentialEncryptor
		})

		await expect(
			manager.updateSourceCredentials("user-1", "test", { token: "x" }),
		).rejects.toBeInstanceOf(CredentialStorageUnavailableError)
	})

	test("throws SourceNotFoundError for unknown source", async () => {
		setEnabledSources([])
		const manager = new UserSessionManager({
			db: fakeDb,
			providers: [],
			credentialEncryptor: testEncryptor,
		})

		await expect(
			manager.updateSourceCredentials("user-1", "unknown", { token: "x" }),
		).rejects.toBeInstanceOf(SourceNotFoundError)
	})

	test("propagates InvalidSourceCredentialsError from provider", async () => {
		setEnabledSources(["test"])
		let callCount = 0
		const provider: FeedSourceProvider = {
			sourceId: "test",
			async feedSourceForUser(_userId: string, _config: unknown, _credentials: unknown) {
				callCount++
				// Succeed on first call (session creation), throw on refresh
				if (callCount > 1) {
					throw new InvalidSourceCredentialsError("test", "bad credentials")
				}
				return createStubSource("test")
			},
		}
		const manager = new UserSessionManager({
			db: fakeDb,
			providers: [provider],
			credentialEncryptor: testEncryptor,
		})

		// Create a session first so the refresh path is exercised
		await manager.getOrCreate("user-1")

		await expect(
			manager.updateSourceCredentials("user-1", "test", { token: "bad" }),
		).rejects.toBeInstanceOf(InvalidSourceCredentialsError)

		// Credentials should still have been persisted before the provider threw
		expect(mockUpdateCredentialsCalls).toHaveLength(1)
	})

	test("refreshes source in active session after credential update", async () => {
		setEnabledSources(["test"])
		let receivedCredentials: unknown = null
		const provider = createStubProvider("test", async (_userId, _config, credentials) => {
			receivedCredentials = credentials
			return createStubSource("test")
		})
		const manager = new UserSessionManager({
			db: fakeDb,
			providers: [provider],
			credentialEncryptor: testEncryptor,
		})

		await manager.getOrCreate("user-1")
		await manager.updateSourceCredentials("user-1", "test", { token: "refreshed" })

		expect(receivedCredentials).toEqual({ token: "refreshed" })
	})

	test("persists credentials without session refresh when no active session", async () => {
		setEnabledSources(["test"])
		const factory = mock(async () => createStubSource("test"))
		const provider: FeedSourceProvider = { sourceId: "test", feedSourceForUser: factory }
		const manager = new UserSessionManager({
			db: fakeDb,
			providers: [provider],
			credentialEncryptor: testEncryptor,
		})

		// No session created — just update credentials
		await manager.updateSourceCredentials("user-1", "test", { token: "stored" })

		expect(mockUpdateCredentialsCalls).toHaveLength(1)
		// feedSourceForUser should not have been called (no session to refresh)
		expect(factory).not.toHaveBeenCalled()
	})
})

describe("UserSessionManager.saveSourceConfig", () => {
	test("upserts config without credentials (existing behavior)", async () => {
		setEnabledSources(["test"])
		const factory = mock(async () => createStubSource("test"))
		const provider: FeedSourceProvider = { sourceId: "test", feedSourceForUser: factory }
		const manager = new UserSessionManager({
			db: fakeDb,
			providers: [provider],
			credentialEncryptor: testEncryptor,
		})

		// Create a session first so we can verify the source is refreshed
		await manager.getOrCreate("user-1")

		await manager.saveSourceConfig("user-1", "test", {
			enabled: true,
			config: { key: "value" },
		})

		// feedSourceForUser called once for session creation, once for upsert refresh
		expect(factory).toHaveBeenCalledTimes(2)
		// No credentials should have been persisted
		expect(mockUpdateCredentialsCalls).toHaveLength(0)
	})

	test("upserts config with credentials — persists both and passes credentials to source", async () => {
		setEnabledSources(["test"])
		let receivedCredentials: unknown = null
		const factory = mock(async (_userId: string, _config: unknown, creds: unknown) => {
			receivedCredentials = creds
			return createStubSource("test")
		})
		const provider: FeedSourceProvider = { sourceId: "test", feedSourceForUser: factory }
		const manager = new UserSessionManager({
			db: fakeDb,
			providers: [provider],
			credentialEncryptor: testEncryptor,
		})

		// Create a session so the source refresh path runs
		await manager.getOrCreate("user-1")

		const creds = { username: "alice", password: "s3cret" }
		await manager.saveSourceConfig("user-1", "test", {
			enabled: true,
			config: { serverUrl: "https://example.com" },
			credentials: creds,
		})

		// Credentials were encrypted and persisted
		expect(mockUpdateCredentialsCalls).toHaveLength(1)
		const decrypted = JSON.parse(testEncryptor.decrypt(mockUpdateCredentialsCalls[0]!.credentials))
		expect(decrypted).toEqual(creds)

		// feedSourceForUser received the provided credentials (not null)
		expect(receivedCredentials).toEqual(creds)
	})

	test("upserts config with credentials adds source to session when not already present", async () => {
		// Start with no enabled sources so the session is empty
		setEnabledSources([])
		const factory = mock(async () => createStubSource("test"))
		const provider: FeedSourceProvider = { sourceId: "test", feedSourceForUser: factory }
		const manager = new UserSessionManager({
			db: fakeDb,
			providers: [provider],
			credentialEncryptor: testEncryptor,
		})

		const session = await manager.getOrCreate("user-1")
		expect(session.hasSource("test")).toBe(false)

		// Set mockFindResult to undefined so find() returns a row (simulating the row was just created by upsertConfig)
		await manager.saveSourceConfig("user-1", "test", {
			enabled: true,
			config: {},
			credentials: { token: "abc" },
		})

		// Source should now be in the session
		expect(session.hasSource("test")).toBe(true)
		expect(mockUpdateCredentialsCalls).toHaveLength(1)
	})

	test("throws CredentialStorageUnavailableError when credentials provided without encryptor", async () => {
		setEnabledSources(["test"])
		const provider = createStubProvider("test")
		const manager = new UserSessionManager({
			db: fakeDb,
			providers: [provider],
			// No credentialEncryptor
		})

		await expect(
			manager.saveSourceConfig("user-1", "test", {
				enabled: true,
				config: {},
				credentials: { token: "abc" },
			}),
		).rejects.toBeInstanceOf(CredentialStorageUnavailableError)
	})

	test("throws SourceNotFoundError for unknown provider", async () => {
		const manager = new UserSessionManager({
			db: fakeDb,
			providers: [],
			credentialEncryptor: testEncryptor,
		})

		await expect(
			manager.saveSourceConfig("user-1", "unknown", {
				enabled: true,
				config: {},
			}),
		).rejects.toBeInstanceOf(SourceNotFoundError)
	})
})
