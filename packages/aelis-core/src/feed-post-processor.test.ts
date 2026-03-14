import { describe, expect, mock, test } from "bun:test"

import type {
	ActionDefinition,
	ContextEntry,
	FeedItem,
	FeedPostProcessor,
	FeedSource,
} from "./index"

import { FeedEngine } from "./feed-engine"
import { UnknownActionError } from "./index"

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
// FEED ITEMS
// =============================================================================

type WeatherItem = FeedItem<"weather", { temp: number }>
type CalendarItem = FeedItem<"calendar", { title: string }>

function weatherItem(id: string, temp: number): WeatherItem {
	return { id, sourceId: "aelis.weather", type: "weather", timestamp: new Date(), data: { temp } }
}

function calendarItem(id: string, title: string): CalendarItem {
	return {
		id,
		sourceId: "aelis.calendar",
		type: "calendar",
		timestamp: new Date(),
		data: { title },
	}
}

// =============================================================================
// TEST SOURCES
// =============================================================================

function createWeatherSource(items: WeatherItem[]) {
	return {
		id: "aelis.weather",
		...noActions,
		async fetchContext() {
			return null
		},
		async fetchItems(): Promise<WeatherItem[]> {
			return items
		},
	}
}

function createCalendarSource(items: CalendarItem[]) {
	return {
		id: "aelis.calendar",
		...noActions,
		async fetchContext() {
			return null
		},
		async fetchItems(): Promise<CalendarItem[]> {
			return items
		},
	}
}

// =============================================================================
// REGISTRATION
// =============================================================================

describe("FeedPostProcessor", () => {
	describe("registration", () => {
		test("registerPostProcessor is chainable", () => {
			const engine = new FeedEngine()
			const processor: FeedPostProcessor = async () => ({})
			const result = engine.registerPostProcessor(processor)
			expect(result).toBe(engine)
		})

		test("unregisterPostProcessor is chainable", () => {
			const engine = new FeedEngine()
			const processor: FeedPostProcessor = async () => ({})
			const result = engine.unregisterPostProcessor(processor)
			expect(result).toBe(engine)
		})

		test("unregistered processor does not run", async () => {
			const processor = mock(async () => ({}))

			const engine = new FeedEngine()
				.register(createWeatherSource([weatherItem("w1", 20)]))
				.registerPostProcessor(processor)
				.unregisterPostProcessor(processor)

			await engine.refresh()
			expect(processor).not.toHaveBeenCalled()
		})
	})

	// =============================================================================
	// ADDITIONAL ITEMS
	// =============================================================================

	describe("additionalItems", () => {
		test("injects additional items into the feed", async () => {
			const extra = calendarItem("c1", "Meeting")

			const engine = new FeedEngine()
				.register(createWeatherSource([weatherItem("w1", 20)]))
				.registerPostProcessor(async () => ({ additionalItems: [extra] }))

			const result = await engine.refresh()
			expect(result.items).toHaveLength(2)
			expect(result.items.find((i) => i.id === "c1")).toBeDefined()
		})
	})

	// =============================================================================
	// SUPPRESS
	// =============================================================================

	describe("suppress", () => {
		test("removes suppressed items from the feed", async () => {
			const engine = new FeedEngine()
				.register(createWeatherSource([weatherItem("w1", 20), weatherItem("w2", 25)]))
				.registerPostProcessor(async () => ({ suppress: ["w1"] }))

			const result = await engine.refresh()
			expect(result.items).toHaveLength(1)
			expect(result.items[0].id).toBe("w2")
		})

		test("suppressing nonexistent ID is a no-op", async () => {
			const engine = new FeedEngine()
				.register(createWeatherSource([weatherItem("w1", 20)]))
				.registerPostProcessor(async () => ({ suppress: ["nonexistent"] }))

			const result = await engine.refresh()
			expect(result.items).toHaveLength(1)
		})
	})

	// =============================================================================
	// GROUPED ITEMS
	// =============================================================================

	describe("groupedItems", () => {
		test("accumulates grouped items on FeedResult", async () => {
			const engine = new FeedEngine()
				.register(
					createCalendarSource([calendarItem("c1", "Meeting A"), calendarItem("c2", "Meeting B")]),
				)
				.registerPostProcessor(async () => ({
					groupedItems: [{ itemIds: ["c1", "c2"], summary: "Busy afternoon" }],
				}))

			const result = await engine.refresh()
			expect(result.groupedItems).toEqual([{ itemIds: ["c1", "c2"], summary: "Busy afternoon" }])
		})

		test("multiple processors accumulate groups", async () => {
			const engine = new FeedEngine()
				.register(
					createCalendarSource([calendarItem("c1", "Meeting A"), calendarItem("c2", "Meeting B")]),
				)
				.registerPostProcessor(async () => ({
					groupedItems: [{ itemIds: ["c1"], summary: "Group A" }],
				}))
				.registerPostProcessor(async () => ({
					groupedItems: [{ itemIds: ["c2"], summary: "Group B" }],
				}))

			const result = await engine.refresh()
			expect(result.groupedItems).toEqual([
				{ itemIds: ["c1"], summary: "Group A" },
				{ itemIds: ["c2"], summary: "Group B" },
			])
		})

		test("stale item IDs are removed from groups after suppression", async () => {
			const engine = new FeedEngine()
				.register(
					createCalendarSource([calendarItem("c1", "Meeting A"), calendarItem("c2", "Meeting B")]),
				)
				.registerPostProcessor(async () => ({
					groupedItems: [{ itemIds: ["c1", "c2"], summary: "Afternoon" }],
				}))
				.registerPostProcessor(async () => ({ suppress: ["c1"] }))

			const result = await engine.refresh()
			expect(result.groupedItems).toEqual([{ itemIds: ["c2"], summary: "Afternoon" }])
		})

		test("groups with all items suppressed are dropped", async () => {
			const engine = new FeedEngine()
				.register(createCalendarSource([calendarItem("c1", "Meeting A")]))
				.registerPostProcessor(async () => ({
					groupedItems: [{ itemIds: ["c1"], summary: "Solo" }],
				}))
				.registerPostProcessor(async () => ({ suppress: ["c1"] }))

			const result = await engine.refresh()
			expect(result.groupedItems).toBeUndefined()
		})

		test("groupedItems is omitted when no processors produce groups", async () => {
			const engine = new FeedEngine()
				.register(createWeatherSource([weatherItem("w1", 20)]))
				.registerPostProcessor(async () => ({}))

			const result = await engine.refresh()
			expect(result.groupedItems).toBeUndefined()
		})
	})

	// =============================================================================
	// BOOST
	// =============================================================================

	describe("boost", () => {
		test("positive boost moves item before non-boosted items", async () => {
			const engine = new FeedEngine()
				.register(createWeatherSource([weatherItem("w1", 20), weatherItem("w2", 25)]))
				.registerPostProcessor(async () => ({ boost: { w2: 0.8 } }))

			const result = await engine.refresh()
			expect(result.items.map((i) => i.id)).toEqual(["w2", "w1"])
		})

		test("negative boost moves item after non-boosted items", async () => {
			const engine = new FeedEngine()
				.register(createWeatherSource([weatherItem("w1", 20), weatherItem("w2", 25)]))
				.registerPostProcessor(async () => ({ boost: { w1: -0.5 } }))

			const result = await engine.refresh()
			expect(result.items.map((i) => i.id)).toEqual(["w2", "w1"])
		})

		test("multiple boosted items are sorted by boost descending", async () => {
			const engine = new FeedEngine()
				.register(
					createWeatherSource([
						weatherItem("w1", 20),
						weatherItem("w2", 25),
						weatherItem("w3", 30),
					]),
				)
				.registerPostProcessor(async () => ({
					boost: { w3: 0.3, w1: 0.9 },
				}))

			const result = await engine.refresh()
			// w1 (0.9) first, w3 (0.3) second, w2 (no boost) last
			expect(result.items.map((i) => i.id)).toEqual(["w1", "w3", "w2"])
		})

		test("multiple processors accumulate boost scores", async () => {
			const engine = new FeedEngine()
				.register(createWeatherSource([weatherItem("w1", 20), weatherItem("w2", 25)]))
				.registerPostProcessor(async () => ({ boost: { w1: 0.3 } }))
				.registerPostProcessor(async () => ({ boost: { w1: 0.4 } }))

			const result = await engine.refresh()
			// w1 accumulated boost = 0.7, moves before w2
			expect(result.items.map((i) => i.id)).toEqual(["w1", "w2"])
		})

		test("accumulated boost is clamped to [-1, 1]", async () => {
			const engine = new FeedEngine()
				.register(
					createWeatherSource([
						weatherItem("w1", 20),
						weatherItem("w2", 25),
						weatherItem("w3", 30),
					]),
				)
				.registerPostProcessor(async () => ({ boost: { w1: 0.8, w2: 0.9 } }))
				.registerPostProcessor(async () => ({ boost: { w1: 0.8 } }))

			const result = await engine.refresh()
			// w1 accumulated = 1.6 clamped to 1, w2 = 0.9 — w1 still first
			expect(result.items.map((i) => i.id)).toEqual(["w1", "w2", "w3"])
		})

		test("out-of-range boost values are clamped", async () => {
			const engine = new FeedEngine()
				.register(createWeatherSource([weatherItem("w1", 20), weatherItem("w2", 25)]))
				.registerPostProcessor(async () => ({ boost: { w1: 5.0 } }))

			const result = await engine.refresh()
			// Clamped to 1, still boosted to front
			expect(result.items.map((i) => i.id)).toEqual(["w1", "w2"])
		})

		test("boosting a suppressed item is a no-op", async () => {
			const engine = new FeedEngine()
				.register(createWeatherSource([weatherItem("w1", 20), weatherItem("w2", 25)]))
				.registerPostProcessor(async () => ({
					suppress: ["w1"],
					boost: { w1: 1.0 },
				}))

			const result = await engine.refresh()
			expect(result.items).toHaveLength(1)
			expect(result.items[0].id).toBe("w2")
		})

		test("boosting a nonexistent item ID is a no-op", async () => {
			const engine = new FeedEngine()
				.register(createWeatherSource([weatherItem("w1", 20)]))
				.registerPostProcessor(async () => ({ boost: { nonexistent: 1.0 } }))

			const result = await engine.refresh()
			expect(result.items).toHaveLength(1)
			expect(result.items[0].id).toBe("w1")
		})

		test("items with equal boost retain original relative order", async () => {
			const engine = new FeedEngine()
				.register(
					createWeatherSource([
						weatherItem("w1", 20),
						weatherItem("w2", 25),
						weatherItem("w3", 30),
					]),
				)
				.registerPostProcessor(async () => ({
					boost: { w1: 0.5, w3: 0.5 },
				}))

			const result = await engine.refresh()
			// w1 and w3 have equal boost — original order preserved: w1 before w3
			expect(result.items.map((i) => i.id)).toEqual(["w1", "w3", "w2"])
		})

		test("negative boosts preserve relative order among demoted items", async () => {
			const engine = new FeedEngine()
				.register(
					createWeatherSource([
						weatherItem("w1", 20),
						weatherItem("w2", 25),
						weatherItem("w3", 30),
					]),
				)
				.registerPostProcessor(async () => ({
					boost: { w1: -0.3, w2: -0.3 },
				}))

			const result = await engine.refresh()
			// w3 (neutral) first, then w1 and w2 (equal negative) in original order
			expect(result.items.map((i) => i.id)).toEqual(["w3", "w1", "w2"])
		})

		test("boost works alongside additionalItems and groupedItems", async () => {
			const extra = calendarItem("c1", "Meeting")

			const engine = new FeedEngine()
				.register(createWeatherSource([weatherItem("w1", 20), weatherItem("w2", 25)]))
				.registerPostProcessor(async () => ({
					additionalItems: [extra],
					boost: { c1: 1.0 },
					groupedItems: [{ itemIds: ["w1", "c1"], summary: "Related" }],
				}))

			const result = await engine.refresh()
			// c1 boosted to front
			expect(result.items[0].id).toBe("c1")
			expect(result.items).toHaveLength(3)
			expect(result.groupedItems).toEqual([{ itemIds: ["w1", "c1"], summary: "Related" }])
		})
	})

	// =============================================================================
	// PIPELINE ORDERING
	// =============================================================================

	describe("pipeline ordering", () => {
		test("each processor sees items as modified by the previous processor", async () => {
			const seen: string[] = []

			const engine = new FeedEngine()
				.register(createWeatherSource([weatherItem("w1", 20)]))
				.registerPostProcessor(async () => ({
					additionalItems: [calendarItem("c1", "Injected")],
				}))
				.registerPostProcessor(async (items) => {
					seen.push(...items.map((i) => i.id))
					return {}
				})

			await engine.refresh()
			expect(seen).toEqual(["w1", "c1"])
		})

		test("suppression in first processor affects second processor", async () => {
			const seen: string[] = []

			const engine = new FeedEngine()
				.register(createWeatherSource([weatherItem("w1", 20), weatherItem("w2", 25)]))
				.registerPostProcessor(async () => ({ suppress: ["w1"] }))
				.registerPostProcessor(async (items) => {
					seen.push(...items.map((i) => i.id))
					return {}
				})

			await engine.refresh()
			expect(seen).toEqual(["w2"])
		})
	})

	// =============================================================================
	// ERROR HANDLING
	// =============================================================================

	describe("error handling", () => {
		test("throwing processor is recorded in errors and pipeline continues", async () => {
			const seen: string[] = []

			async function failingProcessor(): Promise<never> {
				throw new Error("processor failed")
			}

			const engine = new FeedEngine()
				.register(createWeatherSource([weatherItem("w1", 20)]))
				.registerPostProcessor(failingProcessor)
				.registerPostProcessor(async (items) => {
					seen.push(...items.map((i) => i.id))
					return {}
				})

			const result = await engine.refresh()

			const ppError = result.errors.find((e) => e.sourceId === "failingProcessor")
			expect(ppError).toBeDefined()
			expect(ppError!.error.message).toBe("processor failed")

			// Pipeline continued — observer still saw the original item
			expect(seen).toEqual(["w1"])
			expect(result.items).toHaveLength(1)
		})

		test("anonymous throwing processor uses 'anonymous' as sourceId", async () => {
			const engine = new FeedEngine()
				.register(createWeatherSource([weatherItem("w1", 20)]))
				.registerPostProcessor(async () => {
					throw new Error("anon failed")
				})

			const result = await engine.refresh()
			const ppError = result.errors.find((e) => e.sourceId === "anonymous")
			expect(ppError).toBeDefined()
		})

		test("non-Error throw is wrapped", async () => {
			async function failingProcessor(): Promise<never> {
				throw "string error"
			}

			const engine = new FeedEngine()
				.register(createWeatherSource([weatherItem("w1", 20)]))
				.registerPostProcessor(failingProcessor)

			const result = await engine.refresh()
			const ppError = result.errors.find((e) => e.sourceId === "failingProcessor")
			expect(ppError).toBeDefined()
			expect(ppError!.error).toBeInstanceOf(Error)
		})
	})

	// =============================================================================
	// REACTIVE PATHS
	// =============================================================================

	describe("reactive updates", () => {
		test("post-processors run during reactive context updates", async () => {
			let callCount = 0

			let triggerUpdate: ((entries: readonly ContextEntry[]) => void) | null = null

			const source: FeedSource = {
				id: "aelis.reactive",
				...noActions,
				async fetchContext() {
					return null
				},
				async fetchItems() {
					return [weatherItem("w1", 20)]
				},
				onContextUpdate(callback, _getContext) {
					triggerUpdate = callback
					return () => {
						triggerUpdate = null
					}
				},
			}

			const engine = new FeedEngine().register(source).registerPostProcessor(async () => {
				callCount++
				return {}
			})

			engine.start()

			// Wait for initial periodic refresh
			await new Promise((resolve) => setTimeout(resolve, 50))
			const countAfterStart = callCount

			// Trigger a reactive context update
			triggerUpdate!([])
			await new Promise((resolve) => setTimeout(resolve, 50))

			expect(callCount).toBeGreaterThan(countAfterStart)

			engine.stop()
		})

		test("post-processors run during reactive item updates", async () => {
			let callCount = 0

			let triggerItemsUpdate: ((items: FeedItem[]) => void) | null = null

			const source: FeedSource = {
				id: "aelis.reactive",
				...noActions,
				async fetchContext() {
					return null
				},
				async fetchItems() {
					return [weatherItem("w1", 20)]
				},
				onItemsUpdate(callback, _getContext) {
					triggerItemsUpdate = callback
					return () => {
						triggerItemsUpdate = null
					}
				},
			}

			const engine = new FeedEngine().register(source).registerPostProcessor(async () => {
				callCount++
				return {}
			})

			engine.start()

			await new Promise((resolve) => setTimeout(resolve, 50))
			const countAfterStart = callCount

			// Trigger a reactive items update
			triggerItemsUpdate!([weatherItem("w1", 25)])
			await new Promise((resolve) => setTimeout(resolve, 50))

			expect(callCount).toBeGreaterThan(countAfterStart)

			engine.stop()
		})
	})

	// =============================================================================
	// NO PROCESSORS = NO CHANGE
	// =============================================================================

	describe("no processors", () => {
		test("engine without post-processors returns raw items unchanged", async () => {
			const items = [weatherItem("w1", 20), weatherItem("w2", 25)]
			const engine = new FeedEngine().register(createWeatherSource(items))

			const result = await engine.refresh()
			expect(result.items).toHaveLength(2)
			expect(result.items[0].id).toBe("w1")
			expect(result.items[1].id).toBe("w2")
			expect(result.groupedItems).toBeUndefined()
		})
	})

	// =============================================================================
	// COMBINED ENHANCEMENT
	// =============================================================================

	describe("combined enhancement", () => {
		test("single processor can use all enhancement fields at once", async () => {
			const engine = new FeedEngine()
				.register(createWeatherSource([weatherItem("w1", 20), weatherItem("w2", 25)]))
				.registerPostProcessor(async () => ({
					additionalItems: [calendarItem("c1", "Injected")],
					suppress: ["w2"],
					groupedItems: [{ itemIds: ["w1", "c1"], summary: "Related" }],
				}))

			const result = await engine.refresh()

			// w2 suppressed, c1 injected → w1 + c1
			expect(result.items).toHaveLength(2)
			expect(result.items.map((i) => i.id)).toEqual(["w1", "c1"])

			// Groups on result
			expect(result.groupedItems).toEqual([{ itemIds: ["w1", "c1"], summary: "Related" }])
		})
	})
})
