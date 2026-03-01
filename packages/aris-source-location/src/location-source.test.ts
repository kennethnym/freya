import { describe, expect, mock, test } from "bun:test"

import type { Location } from "./types.ts"

import { LocationKey, LocationSource } from "./location-source.ts"

function createLocation(overrides: Partial<Location> = {}): Location {
	return {
		lat: 37.7749,
		lng: -122.4194,
		accuracy: 10,
		timestamp: new Date(),
		...overrides,
	}
}

describe("LocationSource", () => {
	describe("FeedSource interface", () => {
		test("has correct id", () => {
			const source = new LocationSource()
			expect(source.id).toBe("aris.location")
		})

		test("fetchItems always returns empty array", async () => {
			const source = new LocationSource()
			source.pushLocation(createLocation())

			const items = await source.fetchItems()
			expect(items).toEqual([])
		})

		test("fetchContext returns null when no location", async () => {
			const source = new LocationSource()

			const context = await source.fetchContext()
			expect(context).toBeNull()
		})

		test("fetchContext returns location when available", async () => {
			const source = new LocationSource()
			const location = createLocation()
			source.pushLocation(location)

			const entries = await source.fetchContext()
			expect(entries).toEqual([[LocationKey, location]])
		})
	})

	describe("pushLocation", () => {
		test("updates lastLocation", () => {
			const source = new LocationSource()
			expect(source.lastLocation).toBeNull()

			const location = createLocation()
			source.pushLocation(location)

			expect(source.lastLocation).toEqual(location)
		})

		test("notifies listeners", () => {
			const source = new LocationSource()
			const listener = mock()

			source.onContextUpdate(listener)

			const location = createLocation()
			source.pushLocation(location)

			expect(listener).toHaveBeenCalledTimes(1)
			expect(listener).toHaveBeenCalledWith([[LocationKey, location]])
		})
	})

	describe("history", () => {
		test("default historySize is 1", () => {
			const source = new LocationSource()

			source.pushLocation(createLocation({ lat: 1 }))
			source.pushLocation(createLocation({ lat: 2 }))

			expect(source.locationHistory).toHaveLength(1)
			expect(source.lastLocation?.lat).toBe(2)
		})

		test("respects configured historySize", () => {
			const source = new LocationSource({ historySize: 3 })

			const loc1 = createLocation({ lat: 1 })
			const loc2 = createLocation({ lat: 2 })
			const loc3 = createLocation({ lat: 3 })

			source.pushLocation(loc1)
			source.pushLocation(loc2)
			source.pushLocation(loc3)

			expect(source.locationHistory).toEqual([loc1, loc2, loc3])
		})

		test("evicts oldest when exceeding historySize", () => {
			const source = new LocationSource({ historySize: 2 })

			const loc1 = createLocation({ lat: 1 })
			const loc2 = createLocation({ lat: 2 })
			const loc3 = createLocation({ lat: 3 })

			source.pushLocation(loc1)
			source.pushLocation(loc2)
			source.pushLocation(loc3)

			expect(source.locationHistory).toEqual([loc2, loc3])
		})

		test("locationHistory is readonly", () => {
			const source = new LocationSource({ historySize: 3 })
			source.pushLocation(createLocation())

			const history = source.locationHistory
			expect(Array.isArray(history)).toBe(true)
		})
	})

	describe("onContextUpdate", () => {
		test("returns cleanup function", () => {
			const source = new LocationSource()
			const listener = mock()

			const cleanup = source.onContextUpdate(listener)

			source.pushLocation(createLocation({ lat: 1 }))
			expect(listener).toHaveBeenCalledTimes(1)

			cleanup()

			source.pushLocation(createLocation({ lat: 2 }))
			expect(listener).toHaveBeenCalledTimes(1)
		})

		test("supports multiple listeners", () => {
			const source = new LocationSource()
			const listener1 = mock()
			const listener2 = mock()

			source.onContextUpdate(listener1)
			source.onContextUpdate(listener2)

			source.pushLocation(createLocation())

			expect(listener1).toHaveBeenCalledTimes(1)
			expect(listener2).toHaveBeenCalledTimes(1)
		})
	})

	describe("actions", () => {
		test("listActions returns update-location action", async () => {
			const source = new LocationSource()
			const actions = await source.listActions()

			expect(actions["update-location"]).toBeDefined()
			expect(actions["update-location"]!.id).toBe("update-location")
			expect(actions["update-location"]!.input).toBeDefined()
		})

		test("executeAction update-location pushes location", async () => {
			const source = new LocationSource()

			expect(source.lastLocation).toBeNull()

			const location = createLocation({ lat: 40.7128, lng: -74.006 })
			await source.executeAction("update-location", location)

			expect(source.lastLocation).toEqual(location)
		})

		test("executeAction throws on invalid input", async () => {
			const source = new LocationSource()

			await expect(
				source.executeAction("update-location", { lat: "not a number" }),
			).rejects.toThrow()
		})

		test("executeAction throws for unknown action", async () => {
			const source = new LocationSource()

			await expect(source.executeAction("nonexistent", {})).rejects.toThrow("Unknown action")
		})
	})
})
