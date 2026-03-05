import { describe, expect, test } from "bun:test"

import type { ActionDefinition, ContextEntry, ContextKey, FeedItem, FeedSource } from "./index"

import { FeedEngine } from "./feed-engine"
import { Context, TimeRelevance, UnknownActionError, contextKey } from "./index"

// No-op action methods for test sources
const noActions = {
	async listActions(): Promise<Record<string, ActionDefinition>> {
		return {}
	},
	async executeAction(actionId: string): Promise<void> {
		throw new UnknownActionError(actionId)
	},
}

// =============================================================================
// CONTEXT KEYS
// =============================================================================

interface Location {
	lat: number
	lng: number
}

interface Weather {
	temperature: number
	condition: string
}

const LocationKey: ContextKey<Location> = contextKey("location")
const WeatherKey: ContextKey<Weather> = contextKey("weather")

// =============================================================================
// FEED ITEMS
// =============================================================================

type WeatherFeedItem = FeedItem<"weather", { temperature: number; condition: string }>
type AlertFeedItem = FeedItem<"alert", { message: string }>

// =============================================================================
// TEST HELPERS
// =============================================================================

interface SimulatedLocationSource extends FeedSource {
	simulateUpdate(location: Location): void
}

function createLocationSource(): SimulatedLocationSource {
	let callback: ((entries: readonly ContextEntry[]) => void) | null = null
	let currentLocation: Location = { lat: 0, lng: 0 }

	return {
		id: "location",
		...noActions,

		onContextUpdate(cb) {
			callback = cb
			return () => {
				callback = null
			}
		},

		async fetchContext() {
			return [[LocationKey, currentLocation]]
		},

		simulateUpdate(location: Location) {
			currentLocation = location
			callback?.([[LocationKey, location]])
		},
	}
}

function createWeatherSource(
	fetchWeather: (location: Location) => Promise<Weather> = async () => ({
		temperature: 20,
		condition: "sunny",
	}),
): FeedSource<WeatherFeedItem> {
	return {
		id: "weather",
		dependencies: ["location"],
		...noActions,

		async fetchContext(context) {
			const location = context.get(LocationKey)
			if (!location) return null

			const weather = await fetchWeather(location)
			return [[WeatherKey, weather]]
		},

		async fetchItems(context) {
			const weather = context.get(WeatherKey)
			if (!weather) return []

			return [
				{
					id: `weather-${Date.now()}`,
					type: "weather",
					timestamp: new Date(),
					data: {
						temperature: weather.temperature,
						condition: weather.condition,
					},
					signals: { urgency: 0.5, timeRelevance: TimeRelevance.Ambient },
				},
			]
		},
	}
}

function createAlertSource(): FeedSource<AlertFeedItem> {
	return {
		id: "alert",
		dependencies: ["weather"],
		...noActions,

		async fetchContext() {
			return null
		},

		async fetchItems(context) {
			const weather = context.get(WeatherKey)
			if (!weather) return []

			if (weather.condition === "storm") {
				return [
					{
						id: "alert-storm",
						type: "alert",
						timestamp: new Date(),
						data: { message: "Storm warning!" },
						signals: { urgency: 1.0, timeRelevance: TimeRelevance.Imminent },
					},
				]
			}

			return []
		},
	}
}

// =============================================================================
// TESTS
// =============================================================================

describe("FeedEngine", () => {
	describe("registration", () => {
		test("registers sources", () => {
			const engine = new FeedEngine()
			const location = createLocationSource()

			engine.register(location)

			// Can refresh without error
			expect(engine.refresh()).resolves.toBeDefined()
		})

		test("unregisters sources", async () => {
			const engine = new FeedEngine()
			const location = createLocationSource()

			engine.register(location)
			engine.unregister("location")

			const result = await engine.refresh()
			expect(result.items).toHaveLength(0)
		})

		test("allows chained registration", () => {
			const engine = new FeedEngine()
				.register(createLocationSource())
				.register(createWeatherSource())
				.register(createAlertSource())

			expect(engine.refresh()).resolves.toBeDefined()
		})
	})

	describe("graph validation", () => {
		test("throws on missing dependency", async () => {
			const engine = new FeedEngine()
			const orphan: FeedSource = {
				id: "orphan",
				dependencies: ["nonexistent"],
				...noActions,
				async fetchContext() {
					return null
				},
			}

			engine.register(orphan)

			await expect(engine.refresh()).rejects.toThrow(
				'Source "orphan" depends on "nonexistent" which is not registered',
			)
		})

		test("throws on circular dependency", async () => {
			const engine = new FeedEngine()
			const a: FeedSource = {
				id: "a",
				dependencies: ["b"],
				...noActions,
				async fetchContext() {
					return null
				},
			}
			const b: FeedSource = {
				id: "b",
				dependencies: ["a"],
				...noActions,
				async fetchContext() {
					return null
				},
			}

			engine.register(a).register(b)

			await expect(engine.refresh()).rejects.toThrow("Circular dependency detected: a → b → a")
		})

		test("throws on longer cycles", async () => {
			const engine = new FeedEngine()
			const a: FeedSource = {
				id: "a",
				dependencies: ["c"],
				...noActions,
				async fetchContext() {
					return null
				},
			}
			const b: FeedSource = {
				id: "b",
				dependencies: ["a"],
				...noActions,
				async fetchContext() {
					return null
				},
			}
			const c: FeedSource = {
				id: "c",
				dependencies: ["b"],
				...noActions,
				async fetchContext() {
					return null
				},
			}

			engine.register(a).register(b).register(c)

			await expect(engine.refresh()).rejects.toThrow("Circular dependency detected")
		})
	})

	describe("refresh", () => {
		test("runs fetchContext in dependency order", async () => {
			const order: string[] = []

			const location: FeedSource = {
				id: "location",
				...noActions,
				async fetchContext() {
					order.push("location")
					return [[LocationKey, { lat: 51.5, lng: -0.1 }]]
				},
			}

			const weather: FeedSource = {
				id: "weather",
				dependencies: ["location"],
				...noActions,
				async fetchContext(ctx) {
					order.push("weather")
					const loc = ctx.get(LocationKey)
					expect(loc).toBeDefined()
					return [[WeatherKey, { temperature: 20, condition: "sunny" }]]
				},
			}

			const engine = new FeedEngine().register(weather).register(location)

			await engine.refresh()

			expect(order).toEqual(["location", "weather"])
		})

		test("accumulates context across sources", async () => {
			const location = createLocationSource()
			location.simulateUpdate({ lat: 51.5, lng: -0.1 })

			const weather = createWeatherSource()

			const engine = new FeedEngine().register(location).register(weather)

			const { context } = await engine.refresh()

			expect(context.get(LocationKey)).toEqual({
				lat: 51.5,
				lng: -0.1,
			})
			expect(context.get(WeatherKey)).toEqual({
				temperature: 20,
				condition: "sunny",
			})
		})

		test("collects items from all sources", async () => {
			const location = createLocationSource()
			location.simulateUpdate({ lat: 51.5, lng: -0.1 })

			const weather = createWeatherSource()

			const engine = new FeedEngine().register(location).register(weather)

			const { items } = await engine.refresh()

			expect(items).toHaveLength(1)
			expect(items[0]!.type).toBe("weather")
		})

		test("returns items in source graph order (no engine-level sorting)", async () => {
			const location = createLocationSource()
			location.simulateUpdate({ lat: 51.5, lng: -0.1 })

			const weather = createWeatherSource(async () => ({
				temperature: 15,
				condition: "storm",
			}))

			const alert = createAlertSource()

			const engine = new FeedEngine().register(location).register(weather).register(alert)

			const { items } = await engine.refresh()

			expect(items).toHaveLength(2)
			// Items returned in topological order (weather before alert)
			expect(items[0]!.type).toBe("weather")
			expect(items[1]!.type).toBe("alert")
			// Signals are preserved for post-processors to consume
			expect(items[0]!.signals?.urgency).toBe(0.5)
			expect(items[1]!.signals?.urgency).toBe(1.0)
		})

		test("handles missing upstream context gracefully", async () => {
			const location: FeedSource = {
				id: "location",
				...noActions,
				async fetchContext() {
					return null // No location available
				},
			}

			const weather = createWeatherSource()

			const engine = new FeedEngine().register(location).register(weather)

			const { context, items } = await engine.refresh()

			expect(context.get(WeatherKey)).toBeUndefined()
			expect(items).toHaveLength(0)
		})

		test("captures errors from fetchContext", async () => {
			const failing: FeedSource = {
				id: "failing",
				...noActions,
				async fetchContext() {
					throw new Error("Context fetch failed")
				},
			}

			const engine = new FeedEngine().register(failing)

			const { errors } = await engine.refresh()

			expect(errors).toHaveLength(1)
			expect(errors[0]!.sourceId).toBe("failing")
			expect(errors[0]!.error.message).toBe("Context fetch failed")
		})

		test("captures errors from fetchItems", async () => {
			const failing: FeedSource = {
				id: "failing",
				...noActions,
				async fetchContext() {
					return null
				},
				async fetchItems() {
					throw new Error("Items fetch failed")
				},
			}

			const engine = new FeedEngine().register(failing)

			const { errors } = await engine.refresh()

			expect(errors).toHaveLength(1)
			expect(errors[0]!.sourceId).toBe("failing")
			expect(errors[0]!.error.message).toBe("Items fetch failed")
		})

		test("continues after source error", async () => {
			const failing: FeedSource = {
				id: "failing",
				...noActions,
				async fetchContext() {
					throw new Error("Failed")
				},
			}

			const working: FeedSource = {
				id: "working",
				...noActions,
				async fetchContext() {
					return null
				},
				async fetchItems() {
					return [
						{
							id: "item-1",
							type: "test",
							priority: 0.5,
							timestamp: new Date(),
							data: {},
						},
					]
				},
			}

			const engine = new FeedEngine().register(failing).register(working)

			const { items, errors } = await engine.refresh()

			expect(errors).toHaveLength(1)
			expect(items).toHaveLength(1)
		})
	})

	describe("currentContext", () => {
		test("returns initial context before refresh", () => {
			const engine = new FeedEngine()

			const context = engine.currentContext()

			expect(context.time).toBeInstanceOf(Date)
		})

		test("returns accumulated context after refresh", async () => {
			const location = createLocationSource()
			location.simulateUpdate({ lat: 51.5, lng: -0.1 })

			const engine = new FeedEngine().register(location)

			await engine.refresh()

			const context = engine.currentContext()
			expect(context.get(LocationKey)).toEqual({
				lat: 51.5,
				lng: -0.1,
			})
		})
	})

	describe("subscribe", () => {
		test("returns unsubscribe function", () => {
			const engine = new FeedEngine()
			let callCount = 0

			const unsubscribe = engine.subscribe(() => {
				callCount++
			})

			unsubscribe()

			// Subscriber should not be called after unsubscribe
			expect(callCount).toBe(0)
		})
	})

	describe("reactive updates", () => {
		test("start subscribes to onContextUpdate", async () => {
			const location = createLocationSource()
			const weather = createWeatherSource()

			const engine = new FeedEngine().register(location).register(weather)

			const results: Array<{ items: FeedItem[] }> = []
			engine.subscribe((result) => {
				results.push({ items: result.items })
			})

			engine.start()

			// Simulate location update
			location.simulateUpdate({ lat: 51.5, lng: -0.1 })

			// Wait for async refresh
			await new Promise((resolve) => setTimeout(resolve, 50))

			expect(results.length).toBeGreaterThan(0)
			expect(results[0]!.items[0]!.type).toBe("weather")
		})

		test("stop unsubscribes from all sources", async () => {
			const location = createLocationSource()

			const engine = new FeedEngine().register(location)

			let callCount = 0
			engine.subscribe(() => {
				callCount++
			})

			engine.start()
			engine.stop()

			// Simulate update after stop
			location.simulateUpdate({ lat: 1, lng: 1 })

			await new Promise((resolve) => setTimeout(resolve, 50))

			expect(callCount).toBe(0)
		})

		test("start is idempotent", () => {
			const location = createLocationSource()
			const engine = new FeedEngine().register(location)

			// Should not throw or double-subscribe
			engine.start()
			engine.start()
			engine.stop()
		})
	})

	describe("executeAction", () => {
		test("routes action to correct source", async () => {
			let receivedAction = ""
			let receivedParams: unknown = {}

			const source: FeedSource = {
				id: "test-source",
				async listActions() {
					return {
						"do-thing": { id: "do-thing" },
					}
				},
				async executeAction(actionId, params) {
					receivedAction = actionId
					receivedParams = params
				},
				async fetchContext() {
					return null
				},
			}

			const engine = new FeedEngine().register(source)
			await engine.executeAction("test-source", "do-thing", { key: "value" })

			expect(receivedAction).toBe("do-thing")
			expect(receivedParams).toEqual({ key: "value" })
		})

		test("throws for unknown source", async () => {
			const engine = new FeedEngine()

			await expect(engine.executeAction("nonexistent", "action", {})).rejects.toThrow(
				"Source not found: nonexistent",
			)
		})

		test("throws for unknown action on source", async () => {
			const source: FeedSource = {
				id: "test-source",
				...noActions,
				async fetchContext() {
					return null
				},
			}

			const engine = new FeedEngine().register(source)

			await expect(engine.executeAction("test-source", "nonexistent", {})).rejects.toThrow(
				'Action "nonexistent" not found on source "test-source"',
			)
		})
	})

	describe("listActions", () => {
		test("returns actions for a specific source", async () => {
			const source: FeedSource = {
				id: "test-source",
				async listActions() {
					return {
						"action-1": { id: "action-1" },
						"action-2": { id: "action-2" },
					}
				},
				async executeAction() {},
				async fetchContext() {
					return null
				},
			}

			const engine = new FeedEngine().register(source)
			const actions = await engine.listActions("test-source")

			expect(Object.keys(actions)).toEqual(["action-1", "action-2"])
		})

		test("throws for unknown source", async () => {
			const engine = new FeedEngine()

			await expect(engine.listActions("nonexistent")).rejects.toThrow(
				"Source not found: nonexistent",
			)
		})

		test("throws on mismatched action ID", async () => {
			const source: FeedSource = {
				id: "bad-source",
				async listActions() {
					return {
						"correct-key": { id: "wrong-id" },
					}
				},
				async executeAction() {},
				async fetchContext() {
					return null
				},
			}

			const engine = new FeedEngine().register(source)

			await expect(engine.listActions("bad-source")).rejects.toThrow(
				'Action ID mismatch on source "bad-source"',
			)
		})
	})

	describe("lastFeed", () => {
		test("returns null before any refresh", () => {
			const engine = new FeedEngine()

			expect(engine.lastFeed()).toBeNull()
		})

		test("returns cached result after refresh", async () => {
			const location = createLocationSource()
			location.simulateUpdate({ lat: 51.5, lng: -0.1 })

			const weather = createWeatherSource()
			const engine = new FeedEngine().register(location).register(weather)

			const refreshResult = await engine.refresh()

			const cached = engine.lastFeed()
			expect(cached).not.toBeNull()
			expect(cached!.items).toEqual(refreshResult.items)
			expect(cached!.context).toEqual(refreshResult.context)
		})

		test("returns null after TTL expires", async () => {
			const engine = new FeedEngine({ cacheTtlMs: 50 })
			const location = createLocationSource()
			location.simulateUpdate({ lat: 51.5, lng: -0.1 })

			engine.register(location)
			await engine.refresh()

			expect(engine.lastFeed()).not.toBeNull()

			await new Promise((resolve) => setTimeout(resolve, 60))

			expect(engine.lastFeed()).toBeNull()
		})

		test("defaults to 5 minute TTL", async () => {
			const engine = new FeedEngine()
			const location = createLocationSource()
			location.simulateUpdate({ lat: 51.5, lng: -0.1 })

			engine.register(location)
			await engine.refresh()

			// Should still be cached immediately
			expect(engine.lastFeed()).not.toBeNull()
		})

		test("refresh always fetches from sources", async () => {
			let fetchCount = 0
			const source: FeedSource = {
				id: "counter",
				...noActions,
				async fetchContext() {
					fetchCount++
					return null
				},
			}

			const engine = new FeedEngine().register(source)

			await engine.refresh()
			await engine.refresh()
			await engine.refresh()

			expect(fetchCount).toBe(3)
		})

		test("reactive context update refreshes cache", async () => {
			const location = createLocationSource()
			const weather = createWeatherSource()

			const engine = new FeedEngine({ cacheTtlMs: 5000 }).register(location).register(weather)

			engine.start()

			// Simulate location update which triggers reactive refresh
			location.simulateUpdate({ lat: 51.5, lng: -0.1 })

			// Wait for async reactive refresh to complete
			await new Promise((resolve) => setTimeout(resolve, 50))

			const cached = engine.lastFeed()
			expect(cached).not.toBeNull()
			expect(cached!.items.length).toBeGreaterThan(0)

			engine.stop()
		})

		test("reactive item update refreshes cache", async () => {
			let itemUpdateCallback: ((items: FeedItem[]) => void) | null = null

			const source: FeedSource = {
				id: "reactive-items",
				...noActions,
				async fetchContext() {
					return null
				},
				async fetchItems() {
					return [
						{
							id: "item-1",
							type: "test",
							priority: 0.5,
							timestamp: new Date(),
							data: {},
						},
					]
				},
				onItemsUpdate(callback) {
					itemUpdateCallback = callback
					return () => {
						itemUpdateCallback = null
					}
				},
			}

			const engine = new FeedEngine().register(source)
			engine.start()

			// Trigger item update
			itemUpdateCallback!([])

			// Wait for async refresh
			await new Promise((resolve) => setTimeout(resolve, 50))

			const cached = engine.lastFeed()
			expect(cached).not.toBeNull()
			expect(cached!.items).toHaveLength(1)

			engine.stop()
		})

		test("TTL resets after reactive update", async () => {
			const location = createLocationSource()
			const weather = createWeatherSource()

			const engine = new FeedEngine({ cacheTtlMs: 100 }).register(location).register(weather)

			engine.start()

			// Initial reactive update
			location.simulateUpdate({ lat: 51.5, lng: -0.1 })
			await new Promise((resolve) => setTimeout(resolve, 50))

			expect(engine.lastFeed()).not.toBeNull()

			// Wait 70ms (total 120ms from first update, past original TTL)
			// but trigger another update at 50ms to reset TTL
			location.simulateUpdate({ lat: 52.0, lng: -0.2 })
			await new Promise((resolve) => setTimeout(resolve, 50))

			// Should still be cached because TTL was reset by second update
			expect(engine.lastFeed()).not.toBeNull()

			engine.stop()
		})

		test("cacheTtlMs is configurable", async () => {
			const engine = new FeedEngine({ cacheTtlMs: 30 })
			const location = createLocationSource()
			location.simulateUpdate({ lat: 51.5, lng: -0.1 })

			engine.register(location)
			await engine.refresh()

			expect(engine.lastFeed()).not.toBeNull()

			await new Promise((resolve) => setTimeout(resolve, 40))

			expect(engine.lastFeed()).toBeNull()
		})

		test("auto-refreshes on TTL interval after start", async () => {
			let fetchCount = 0
			const source: FeedSource = {
				id: "counter",
				...noActions,
				async fetchContext() {
					fetchCount++
					return null
				},
				async fetchItems() {
					return [
						{
							id: `item-${fetchCount}`,
							type: "test",
							priority: 0.5,
							timestamp: new Date(),
							data: {},
						},
					]
				},
			}

			const engine = new FeedEngine({ cacheTtlMs: 50 }).register(source)
			engine.start()

			// Wait for two TTL intervals to elapse
			await new Promise((resolve) => setTimeout(resolve, 120))

			// Should have auto-refreshed at least twice
			expect(fetchCount).toBeGreaterThanOrEqual(2)
			expect(engine.lastFeed()).not.toBeNull()

			engine.stop()
		})

		test("stop cancels periodic refresh", async () => {
			let fetchCount = 0
			const source: FeedSource = {
				id: "counter",
				...noActions,
				async fetchContext() {
					fetchCount++
					return null
				},
			}

			const engine = new FeedEngine({ cacheTtlMs: 50 }).register(source)
			engine.start()
			engine.stop()

			const countAfterStop = fetchCount

			// Wait past TTL
			await new Promise((resolve) => setTimeout(resolve, 80))

			// No additional fetches after stop
			expect(fetchCount).toBe(countAfterStop)
		})

		test("reactive update resets periodic refresh timer", async () => {
			let fetchCount = 0
			const location = createLocationSource()
			const countingWeather: FeedSource<WeatherFeedItem> = {
				id: "weather",
				dependencies: ["location"],
				...noActions,
				async fetchContext(ctx) {
					fetchCount++
					const loc = ctx.get(LocationKey)
					if (!loc) return null
					return [[WeatherKey, { temperature: 20, condition: "sunny" }]]
				},
				async fetchItems(ctx) {
					const weather = ctx.get(WeatherKey)
					if (!weather) return []
					return [
						{
							id: `weather-${Date.now()}`,
							type: "weather",
							priority: 0.5,
							timestamp: new Date(),
							data: { temperature: weather.temperature, condition: weather.condition },
						},
					]
				},
			}

			const engine = new FeedEngine({ cacheTtlMs: 100 })
				.register(location)
				.register(countingWeather)

			engine.start()

			// At 40ms, push a reactive update — this resets the timer
			await new Promise((resolve) => setTimeout(resolve, 40))
			const countBeforeUpdate = fetchCount
			location.simulateUpdate({ lat: 51.5, lng: -0.1 })
			await new Promise((resolve) => setTimeout(resolve, 20))

			// Reactive update triggered a fetch
			expect(fetchCount).toBeGreaterThan(countBeforeUpdate)
			const countAfterUpdate = fetchCount

			// At 100ms from start (60ms after reactive update), the original
			// timer would have fired, but it was reset. No extra fetch yet.
			await new Promise((resolve) => setTimeout(resolve, 40))
			expect(fetchCount).toBe(countAfterUpdate)

			engine.stop()
		})
	})
})
