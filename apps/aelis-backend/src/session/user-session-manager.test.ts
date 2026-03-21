import type { ActionDefinition, ContextEntry, FeedItem, FeedSource } from "@aelis/core"

import { LocationSource } from "@aelis/source-location"
import { WeatherSource } from "@aelis/source-weatherkit"
import { describe, expect, mock, spyOn, test } from "bun:test"

import type { FeedSourceProvider } from "./feed-source-provider.ts"

import { UserSessionManager } from "./user-session-manager.ts"

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
	factory: (userId: string) => Promise<FeedSource> = async () => createStubSource(sourceId),
): FeedSourceProvider {
	return { sourceId, feedSourceForUser: factory }
}

const locationProvider: FeedSourceProvider = {
	sourceId: "aelis.location",
	async feedSourceForUser() {
		return new LocationSource()
	},
}

const weatherProvider: FeedSourceProvider = {
	sourceId: "aelis.weather",
	async feedSourceForUser() {
		return new WeatherSource({ client: { fetch: async () => ({}) as never } })
	},
}

describe("UserSessionManager", () => {
	test("getOrCreate creates session on first call", async () => {
		const manager = new UserSessionManager({ providers: [locationProvider] })

		const session = await manager.getOrCreate("user-1")

		expect(session).toBeDefined()
		expect(session.engine).toBeDefined()
	})

	test("getOrCreate returns same session for same user", async () => {
		const manager = new UserSessionManager({ providers: [locationProvider] })

		const session1 = await manager.getOrCreate("user-1")
		const session2 = await manager.getOrCreate("user-1")

		expect(session1).toBe(session2)
	})

	test("getOrCreate returns different sessions for different users", async () => {
		const manager = new UserSessionManager({ providers: [locationProvider] })

		const session1 = await manager.getOrCreate("user-1")
		const session2 = await manager.getOrCreate("user-2")

		expect(session1).not.toBe(session2)
	})

	test("each user gets independent source instances", async () => {
		const manager = new UserSessionManager({ providers: [locationProvider] })

		const session1 = await manager.getOrCreate("user-1")
		const session2 = await manager.getOrCreate("user-2")

		const source1 = session1.getSource<LocationSource>("aelis.location")
		const source2 = session2.getSource<LocationSource>("aelis.location")

		expect(source1).not.toBe(source2)
	})

	test("remove destroys session and allows re-creation", async () => {
		const manager = new UserSessionManager({ providers: [locationProvider] })

		const session1 = await manager.getOrCreate("user-1")
		manager.remove("user-1")
		const session2 = await manager.getOrCreate("user-1")

		expect(session1).not.toBe(session2)
	})

	test("remove is no-op for unknown user", () => {
		const manager = new UserSessionManager({ providers: [locationProvider] })

		expect(() => manager.remove("unknown")).not.toThrow()
	})

	test("registers multiple providers", async () => {
		const manager = new UserSessionManager({
			providers: [locationProvider, weatherProvider],
		})

		const session = await manager.getOrCreate("user-1")

		expect(session.getSource("aelis.location")).toBeDefined()
		expect(session.getSource("aelis.weather")).toBeDefined()
	})

	test("refresh returns feed result through session", async () => {
		const manager = new UserSessionManager({ providers: [locationProvider] })

		const session = await manager.getOrCreate("user-1")
		const result = await session.engine.refresh()

		expect(result).toHaveProperty("context")
		expect(result).toHaveProperty("items")
		expect(result).toHaveProperty("errors")
		expect(result.context.time).toBeInstanceOf(Date)
	})

	test("location update via executeAction works", async () => {
		const manager = new UserSessionManager({ providers: [locationProvider] })

		const session = await manager.getOrCreate("user-1")
		await session.engine.executeAction("aelis.location", "update-location", {
			lat: 51.5074,
			lng: -0.1278,
			accuracy: 10,
			timestamp: new Date(),
		})

		const source = session.getSource<LocationSource>("aelis.location")
		expect(source?.lastLocation?.lat).toBe(51.5074)
	})

	test("subscribe receives updates after location push", async () => {
		const manager = new UserSessionManager({ providers: [locationProvider] })
		const callback = mock()

		const session = await manager.getOrCreate("user-1")
		session.engine.subscribe(callback)

		await session.engine.executeAction("aelis.location", "update-location", {
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
		const manager = new UserSessionManager({ providers: [locationProvider] })
		const callback = mock()

		const session = await manager.getOrCreate("user-1")
		session.engine.subscribe(callback)

		manager.remove("user-1")

		// Create new session and push location — old callback should not fire
		const session2 = await manager.getOrCreate("user-1")
		await session2.engine.executeAction("aelis.location", "update-location", {
			lat: 51.5074,
			lng: -0.1278,
			accuracy: 10,
			timestamp: new Date(),
		})

		await new Promise((resolve) => setTimeout(resolve, 10))

		expect(callback).not.toHaveBeenCalled()
	})

	test("creates session with successful providers when some fail", async () => {
		const failingProvider: FeedSourceProvider = {
			sourceId: "aelis.failing",
			async feedSourceForUser() {
				throw new Error("provider failed")
			},
		}

		const manager = new UserSessionManager({
			providers: [locationProvider, failingProvider],
		})

		const spy = spyOn(console, "error").mockImplementation(() => {})

		const session = await manager.getOrCreate("user-1")

		expect(session).toBeDefined()
		expect(session.getSource("aelis.location")).toBeDefined()
		expect(spy).toHaveBeenCalled()

		spy.mockRestore()
	})

	test("throws AggregateError when all providers fail", async () => {
		const manager = new UserSessionManager({
			providers: [
				{
					sourceId: "aelis.fail-1",
					async feedSourceForUser() {
						throw new Error("first failed")
					},
				},
				{
					sourceId: "aelis.fail-2",
					async feedSourceForUser() {
						throw new Error("second failed")
					},
				},
			],
		})

		await expect(manager.getOrCreate("user-1")).rejects.toBeInstanceOf(AggregateError)
	})

	test("concurrent getOrCreate for same user returns same session", async () => {
		let callCount = 0
		const manager = new UserSessionManager({
			providers: [
				{
					sourceId: "aelis.location",
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
		let resolveProvider: () => void
		const providerGate = new Promise<void>((r) => {
			resolveProvider = r
		})

		const manager = new UserSessionManager({
			providers: [
				{
					sourceId: "aelis.location",
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
})

describe("UserSessionManager.replaceProvider", () => {
	test("replaces source in all active sessions", async () => {
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
		const manager = new UserSessionManager({ providers: [providerV1] })

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
		const manager = new UserSessionManager({ providers: [locationProvider] })

		const unknownProvider = createStubProvider("aelis.unknown")

		await expect(manager.replaceProvider(unknownProvider)).rejects.toThrow(
			"no existing provider with that sourceId",
		)
	})

	test("keeps existing source when new provider fails for a user", async () => {
		const providerV1 = createStubProvider("test", async () => createStubSource("test"))
		const manager = new UserSessionManager({ providers: [providerV1] })

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
		const manager = new UserSessionManager({ providers: [providerV1] })

		const providerV2 = createStubProvider("test", async () => createStubSource("test", itemsV2))
		await manager.replaceProvider(providerV2)

		// New session should use v2
		const session = await manager.getOrCreate("user-new")
		const feed = await session.feed()
		expect(feed.items[0]!.data.version).toBe(2)
	})

	test("does not affect other providers' sources", async () => {
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

		const manager = new UserSessionManager({ providers: [providerA, providerB] })
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
		const manager = new UserSessionManager({ providers: [providerV1] })

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
})
