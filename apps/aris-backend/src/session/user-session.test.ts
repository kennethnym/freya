import type { ActionDefinition, ContextEntry, FeedItem, FeedSource } from "@aris/core"

import { LocationSource } from "@aris/source-location"
import { describe, expect, test } from "bun:test"

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
		const session = new UserSession([createStubSource("test-a"), createStubSource("test-b")])

		const result = await session.engine.refresh()

		expect(result.errors).toHaveLength(0)
	})

	test("getSource returns registered source", () => {
		const location = new LocationSource()
		const session = new UserSession([location])

		const result = session.getSource<LocationSource>("aris.location")

		expect(result).toBe(location)
	})

	test("getSource returns undefined for unknown source", () => {
		const session = new UserSession([createStubSource("test")])

		expect(session.getSource("unknown")).toBeUndefined()
	})

	test("destroy stops engine and clears sources", () => {
		const session = new UserSession([createStubSource("test")])

		session.destroy()

		expect(session.getSource("test")).toBeUndefined()
	})

	test("engine.executeAction routes to correct source", async () => {
		const location = new LocationSource()
		const session = new UserSession([location])

		await session.engine.executeAction("aris.location", "update-location", {
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
				type: "test",
				timestamp: new Date("2025-01-01T00:00:00.000Z"),
				data: { value: 42 },
			},
		]
		const session = new UserSession([createStubSource("test", items)])

		const result = await session.feed()

		expect(result.items).toHaveLength(1)
		expect(result.items[0]!.id).toBe("item-1")
	})

	test("returns enhanced items when enhancer is provided", async () => {
		const items: FeedItem[] = [
			{
				id: "item-1",
				type: "test",
				timestamp: new Date("2025-01-01T00:00:00.000Z"),
				data: { value: 42 },
			},
		]
		const enhancer = async (feedItems: FeedItem[]) =>
			feedItems.map((item) => ({ ...item, data: { ...item.data, enhanced: true } }))

		const session = new UserSession([createStubSource("test", items)], enhancer)

		const result = await session.feed()

		expect(result.items).toHaveLength(1)
		expect(result.items[0]!.data.enhanced).toBe(true)
	})

	test("caches enhanced items on subsequent calls", async () => {
		const items: FeedItem[] = [
			{
				id: "item-1",
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

		const session = new UserSession([createStubSource("test", items)], enhancer)

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

		const session = new UserSession([source], enhancer)

		// First feed triggers refresh + enhancement
		const result1 = await session.feed()
		expect(result1.items[0]!.data.version).toBe(1)
		expect(result1.items[0]!.data.enhanced).toBe(true)

		// Update source data and trigger engine refresh
		currentItems = [
			{
				id: "item-1",
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
				type: "test",
				timestamp: new Date("2025-01-01T00:00:00.000Z"),
				data: { value: 42 },
			},
		]
		const enhancer = async () => {
			throw new Error("enhancement exploded")
		}

		const session = new UserSession([createStubSource("test", items)], enhancer)

		const result = await session.feed()

		expect(result.items).toHaveLength(1)
		expect(result.items[0]!.id).toBe("item-1")
		expect(result.items[0]!.data.value).toBe(42)
	})
})
