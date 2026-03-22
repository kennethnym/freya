import type { ActionDefinition, ContextEntry, FeedItem, FeedSource } from "@aelis/core"

import { LocationSource } from "@aelis/source-location"
import { describe, expect, spyOn, test } from "bun:test"

import { UserSession } from "./user-session.ts"

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

describe("UserSession", () => {
	test("registers sources and starts engine", async () => {
		const session = new UserSession("test-user", [
			createStubSource("test-a"),
			createStubSource("test-b"),
		])

		const result = await session.engine.refresh()

		expect(result.errors).toHaveLength(0)
	})

	test("getSource returns registered source", () => {
		const location = new LocationSource()
		const session = new UserSession("test-user", [location])

		const result = session.getSource<LocationSource>("aelis.location")

		expect(result).toBe(location)
	})

	test("getSource returns undefined for unknown source", () => {
		const session = new UserSession("test-user", [createStubSource("test")])

		expect(session.getSource("unknown")).toBeUndefined()
	})

	test("destroy stops engine and clears sources", () => {
		const session = new UserSession("test-user", [createStubSource("test")])

		session.destroy()

		expect(session.getSource("test")).toBeUndefined()
	})

	test("engine.executeAction routes to correct source", async () => {
		const location = new LocationSource()
		const session = new UserSession("test-user", [location])

		await session.engine.executeAction("aelis.location", "update-location", {
			lat: 51.5,
			lng: -0.1,
			accuracy: 10,
			timestamp: new Date(),
		})

		expect(location.lastLocation).toBeDefined()
		expect(location.lastLocation!.lat).toBe(51.5)
	})
})

describe("UserSession.feed", () => {
	test("returns feed items without enhancer", async () => {
		const items: FeedItem[] = [
			{
				id: "item-1",
				sourceId: "test",
				type: "test",
				timestamp: new Date("2025-01-01T00:00:00.000Z"),
				data: { value: 42 },
			},
		]
		const session = new UserSession("test-user", [createStubSource("test", items)])

		const result = await session.feed()

		expect(result.items).toHaveLength(1)
		expect(result.items[0]!.id).toBe("item-1")
	})

	test("returns enhanced items when enhancer is provided", async () => {
		const items: FeedItem[] = [
			{
				id: "item-1",
				sourceId: "test",
				type: "test",
				timestamp: new Date("2025-01-01T00:00:00.000Z"),
				data: { value: 42 },
			},
		]
		const enhancer = async (feedItems: FeedItem[]) =>
			feedItems.map((item) => ({ ...item, data: { ...item.data, enhanced: true } }))

		const session = new UserSession("test-user", [createStubSource("test", items)], enhancer)

		const result = await session.feed()

		expect(result.items).toHaveLength(1)
		expect(result.items[0]!.data.enhanced).toBe(true)
	})

	test("caches enhanced items on subsequent calls", async () => {
		const items: FeedItem[] = [
			{
				id: "item-1",
				sourceId: "test",
				type: "test",
				timestamp: new Date("2025-01-01T00:00:00.000Z"),
				data: { value: 42 },
			},
		]
		let enhancerCallCount = 0
		const enhancer = async (feedItems: FeedItem[]) => {
			enhancerCallCount++
			return feedItems.map((item) => ({ ...item, data: { ...item.data, enhanced: true } }))
		}

		const session = new UserSession("test-user", [createStubSource("test", items)], enhancer)

		const result1 = await session.feed()
		expect(result1.items[0]!.data.enhanced).toBe(true)
		expect(enhancerCallCount).toBe(1)

		const result2 = await session.feed()
		expect(result2.items[0]!.data.enhanced).toBe(true)
		expect(enhancerCallCount).toBe(1)
	})

	test("re-enhances after engine refresh with new data", async () => {
		let currentItems: FeedItem[] = [
			{
				id: "item-1",
				sourceId: "test",
				type: "test",
				timestamp: new Date("2025-01-01T00:00:00.000Z"),
				data: { version: 1 },
			},
		]
		const source = createStubSource("test", currentItems)
		// Make fetchItems dynamic so refresh returns new data
		source.fetchItems = async () => currentItems

		const enhancedVersions: number[] = []
		const enhancer = async (feedItems: FeedItem[]) => {
			const version = feedItems[0]!.data.version as number
			enhancedVersions.push(version)
			return feedItems.map((item) => ({
				...item,
				data: { ...item.data, enhanced: true },
			}))
		}

		const session = new UserSession("test-user", [source], enhancer)

		// First feed triggers refresh + enhancement
		const result1 = await session.feed()
		expect(result1.items[0]!.data.version).toBe(1)
		expect(result1.items[0]!.data.enhanced).toBe(true)

		// Update source data and trigger engine refresh
		currentItems = [
			{
				id: "item-1",
				sourceId: "test",
				type: "test",
				timestamp: new Date("2025-01-02T00:00:00.000Z"),
				data: { version: 2 },
			},
		]
		await session.engine.refresh()

		// Wait for subscriber-triggered background enhancement
		await new Promise((resolve) => setTimeout(resolve, 10))

		// feed() should now serve re-enhanced items with version 2
		const result2 = await session.feed()
		expect(result2.items[0]!.data.version).toBe(2)
		expect(result2.items[0]!.data.enhanced).toBe(true)
		expect(enhancedVersions).toEqual([1, 2])
	})

	test("falls back to unenhanced items when enhancer throws", async () => {
		const items: FeedItem[] = [
			{
				id: "item-1",
				sourceId: "test",
				type: "test",
				timestamp: new Date("2025-01-01T00:00:00.000Z"),
				data: { value: 42 },
			},
		]
		const enhancer = async () => {
			throw new Error("enhancement exploded")
		}

		const session = new UserSession("test-user", [createStubSource("test", items)], enhancer)

		const result = await session.feed()

		expect(result.items).toHaveLength(1)
		expect(result.items[0]!.id).toBe("item-1")
		expect(result.items[0]!.data.value).toBe(42)
	})
})

describe("UserSession.replaceSource", () => {
	test("replaces source and invalidates feed cache", async () => {
		const itemsA: FeedItem[] = [
			{
				id: "a-1",
				sourceId: "test",
				type: "test",
				timestamp: new Date("2025-01-01T00:00:00.000Z"),
				data: { from: "a" },
			},
		]
		const itemsB: FeedItem[] = [
			{
				id: "b-1",
				sourceId: "test",
				type: "test",
				timestamp: new Date("2025-01-01T00:00:00.000Z"),
				data: { from: "b" },
			},
		]

		const sourceA = createStubSource("test", itemsA)
		const session = new UserSession("test-user", [sourceA])

		const result1 = await session.feed()
		expect(result1.items).toHaveLength(1)
		expect(result1.items[0]!.data.from).toBe("a")

		const sourceB = createStubSource("test", itemsB)
		session.replaceSource("test", sourceB)

		const result2 = await session.feed()
		expect(result2.items).toHaveLength(1)
		expect(result2.items[0]!.data.from).toBe("b")
	})

	test("getSource returns new source after replace", () => {
		const sourceA = createStubSource("test")
		const session = new UserSession("test-user", [sourceA])

		const sourceB = createStubSource("test")
		session.replaceSource("test", sourceB)

		expect(session.getSource("test")).toBe(sourceB)
		expect(session.getSource("test")).not.toBe(sourceA)
	})

	test("throws when replacing a source that is not registered", () => {
		const session = new UserSession("test-user", [createStubSource("test")])

		expect(() => session.replaceSource("nonexistent", createStubSource("other"))).toThrow(
			'Cannot replace source "nonexistent": not registered',
		)
	})

	test("other sources are unaffected by replace", async () => {
		const sourceA = createStubSource("source-a", [
			{
				id: "a-1",
				sourceId: "source-a",
				type: "test",
				timestamp: new Date(),
				data: { from: "a" },
			},
		])
		const sourceB = createStubSource("source-b", [
			{
				id: "b-1",
				sourceId: "source-b",
				type: "test",
				timestamp: new Date(),
				data: { from: "b" },
			},
		])
		const session = new UserSession("test-user", [sourceA, sourceB])

		const replacement = createStubSource("source-a", [
			{
				id: "a-2",
				sourceId: "source-a",
				type: "test",
				timestamp: new Date(),
				data: { from: "a-new" },
			},
		])
		session.replaceSource("source-a", replacement)

		const result = await session.feed()
		expect(result.items).toHaveLength(2)

		const ids = result.items.map((i) => i.id).sort()
		expect(ids).toEqual(["a-2", "b-1"])
	})

	test("invalidates enhancement cache on replace", async () => {
		const items: FeedItem[] = [
			{
				id: "item-1",
				sourceId: "test",
				type: "test",
				timestamp: new Date(),
				data: { version: 1 },
			},
		]
		let enhanceCount = 0
		const enhancer = async (feedItems: FeedItem[]) => {
			enhanceCount++
			return feedItems.map((item) => ({ ...item, data: { ...item.data, enhanced: true } }))
		}

		const session = new UserSession("test-user", [createStubSource("test", items)], enhancer)

		await session.feed()
		expect(enhanceCount).toBe(1)

		const newItems: FeedItem[] = [
			{
				id: "item-2",
				sourceId: "test",
				type: "test",
				timestamp: new Date(),
				data: { version: 2 },
			},
		]
		session.replaceSource("test", createStubSource("test", newItems))

		const result = await session.feed()
		expect(enhanceCount).toBe(2)
		expect(result.items[0]!.id).toBe("item-2")
		expect(result.items[0]!.data.enhanced).toBe(true)
	})
})

describe("UserSession.removeSource", () => {
	test("removes source from engine and sources map", () => {
		const session = new UserSession("test-user", [
			createStubSource("test-a"),
			createStubSource("test-b"),
		])

		session.removeSource("test-a")

		expect(session.getSource("test-a")).toBeUndefined()
		expect(session.getSource("test-b")).toBeDefined()
	})

	test("invalidates feed cache on remove", async () => {
		const items: FeedItem[] = [
			{
				id: "item-1",
				sourceId: "test",
				type: "test",
				timestamp: new Date(),
				data: {},
			},
		]
		const session = new UserSession("test-user", [createStubSource("test", items)])

		const result1 = await session.feed()
		expect(result1.items).toHaveLength(1)

		session.removeSource("test")

		const result2 = await session.feed()
		expect(result2.items).toHaveLength(0)
	})

	test("is a no-op for unknown source", () => {
		const session = new UserSession("test-user", [createStubSource("test")])

		expect(() => session.removeSource("unknown")).not.toThrow()
		expect(session.getSource("test")).toBeDefined()
	})
})
