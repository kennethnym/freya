import { describe, expect, test } from "bun:test"

import type { ActionDefinition, ContextEntry, ContextKey, FeedItem, FeedSource } from "./index"

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
					sourceId: "weather",
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
						sourceId: "alert",
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
// GRAPH SIMULATION (until FeedController is updated)
// =============================================================================

interface SourceGraph {
	sources: Map<string, FeedSource>
	sorted: FeedSource[]
	dependents: Map<string, string[]>
}

function buildGraph(sources: FeedSource[]): SourceGraph {
	const byId = new Map<string, FeedSource>()
	for (const source of sources) {
		byId.set(source.id, source)
	}

	// Validate dependencies exist
	for (const source of sources) {
		for (const dep of source.dependencies ?? []) {
			if (!byId.has(dep)) {
				throw new Error(`Source "${source.id}" depends on "${dep}" which is not registered`)
			}
		}
	}

	// Check for cycles and topologically sort
	const visited = new Set<string>()
	const visiting = new Set<string>()
	const sorted: FeedSource[] = []

	function visit(id: string, path: string[]): void {
		if (visiting.has(id)) {
			const cycle = [...path.slice(path.indexOf(id)), id].join(" → ")
			throw new Error(`Circular dependency detected: ${cycle}`)
		}
		if (visited.has(id)) return

		visiting.add(id)
		const source = byId.get(id)!
		for (const dep of source.dependencies ?? []) {
			visit(dep, [...path, id])
		}
		visiting.delete(id)
		visited.add(id)
		sorted.push(source)
	}

	for (const source of sources) {
		visit(source.id, [])
	}

	// Build reverse dependency map
	const dependents = new Map<string, string[]>()
	for (const source of sources) {
		for (const dep of source.dependencies ?? []) {
			const list = dependents.get(dep) ?? []
			list.push(source.id)
			dependents.set(dep, list)
		}
	}

	return { sources: byId, sorted, dependents }
}

async function refreshGraph(graph: SourceGraph): Promise<{ context: Context; items: FeedItem[] }> {
	const context = new Context()

	// Run fetchContext in topological order
	for (const source of graph.sorted) {
		const entries = await source.fetchContext(context)
		if (entries) {
			context.set(entries)
		}
	}

	// Run fetchItems on all sources
	const items: FeedItem[] = []
	for (const source of graph.sorted) {
		if (source.fetchItems) {
			const sourceItems = await source.fetchItems(context)
			items.push(...sourceItems)
		}
	}

	return { context, items }
}

// =============================================================================
// TESTS
// =============================================================================

describe("FeedSource", () => {
	describe("interface", () => {
		test("source with only context production", () => {
			const source = createLocationSource()

			expect(source.id).toBe("location")
			expect(source.dependencies).toBeUndefined()
			expect(source.fetchContext).toBeDefined()
			expect(source.onContextUpdate).toBeDefined()
			expect(source.fetchItems).toBeUndefined()
		})

		test("source with dependencies and both context and items", () => {
			const source = createWeatherSource()

			expect(source.id).toBe("weather")
			expect(source.dependencies).toEqual(["location"])
			expect(source.fetchContext).toBeDefined()
			expect(source.fetchItems).toBeDefined()
		})

		test("source with only item production", () => {
			const source = createAlertSource()

			expect(source.id).toBe("alert")
			expect(source.dependencies).toEqual(["weather"])
			expect(source.fetchContext).toBeDefined()
			expect(source.fetchItems).toBeDefined()
		})

		test("source without context returns null from fetchContext", async () => {
			const source = createAlertSource()
			const result = await source.fetchContext(new Context())
			expect(result).toBeNull()
		})
	})

	describe("graph validation", () => {
		test("validates all dependencies exist", () => {
			const orphan: FeedSource = {
				id: "orphan",
				dependencies: ["nonexistent"],
				...noActions,
				async fetchContext() {
					return null
				},
			}

			expect(() => buildGraph([orphan])).toThrow(
				'Source "orphan" depends on "nonexistent" which is not registered',
			)
		})

		test("detects circular dependencies", () => {
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

			expect(() => buildGraph([a, b])).toThrow("Circular dependency detected: a → b → a")
		})

		test("detects longer cycles", () => {
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

			expect(() => buildGraph([a, b, c])).toThrow("Circular dependency detected")
		})

		test("topologically sorts sources", () => {
			const location = createLocationSource()
			const weather = createWeatherSource()
			const alert = createAlertSource()

			// Register in wrong order
			const graph = buildGraph([alert, weather, location])

			expect(graph.sorted.map((s) => s.id)).toEqual(["location", "weather", "alert"])
		})

		test("builds reverse dependency map", () => {
			const location = createLocationSource()
			const weather = createWeatherSource()
			const alert = createAlertSource()

			const graph = buildGraph([location, weather, alert])

			expect(graph.dependents.get("location")).toEqual(["weather"])
			expect(graph.dependents.get("weather")).toEqual(["alert"])
			expect(graph.dependents.get("alert")).toBeUndefined()
		})
	})

	describe("graph refresh", () => {
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

			const graph = buildGraph([weather, location])
			await refreshGraph(graph)

			expect(order).toEqual(["location", "weather"])
		})

		test("accumulates context across sources", async () => {
			const location = createLocationSource()
			location.simulateUpdate({ lat: 51.5, lng: -0.1 })

			const weather = createWeatherSource()

			const graph = buildGraph([location, weather])
			const { context } = await refreshGraph(graph)

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

			const graph = buildGraph([location, weather])
			const { items } = await refreshGraph(graph)

			expect(items).toHaveLength(1)
			expect(items[0]!.type).toBe("weather")
		})

		test("downstream source receives upstream context", async () => {
			const location = createLocationSource()
			location.simulateUpdate({ lat: 51.5, lng: -0.1 })

			const weather = createWeatherSource(async () => ({
				temperature: 15,
				condition: "storm",
			}))

			const alert = createAlertSource()

			const graph = buildGraph([location, weather, alert])
			const { items } = await refreshGraph(graph)

			expect(items).toHaveLength(2)
			// Items returned in topological order (weather before alert)
			expect(items[0]!.type).toBe("weather")
			expect(items[1]!.type).toBe("alert")
			// Signals preserved for post-processors
			expect(items[0]!.signals?.urgency).toBe(0.5)
			expect(items[1]!.signals?.urgency).toBe(1.0)
		})

		test("source without location context returns empty items", async () => {
			const location: FeedSource = {
				id: "location",
				...noActions,
				async fetchContext() {
					return null
				},
			}

			const weather = createWeatherSource()

			const graph = buildGraph([location, weather])
			const { context, items } = await refreshGraph(graph)

			expect(context.get(WeatherKey)).toBeUndefined()
			expect(items).toHaveLength(0)
		})
	})

	describe("reactive updates", () => {
		test("onContextUpdate receives callback and returns cleanup", () => {
			const location = createLocationSource()
			let updateCount = 0

			const cleanup = location.onContextUpdate!(
				() => {
					updateCount++
				},
				() => new Context(),
			)

			location.simulateUpdate({ lat: 1, lng: 1 })
			expect(updateCount).toBe(1)

			location.simulateUpdate({ lat: 2, lng: 2 })
			expect(updateCount).toBe(2)

			cleanup()

			location.simulateUpdate({ lat: 3, lng: 3 })
			expect(updateCount).toBe(2) // no more updates after cleanup
		})
	})
})
