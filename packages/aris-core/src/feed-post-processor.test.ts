import { describe, expect, mock, test } from "bun:test"

import type { ActionDefinition, FeedItem, FeedPostProcessor, FeedSource } from "./index"

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
	return { id, type: "weather", timestamp: new Date(), data: { temp } }
}

function calendarItem(id: string, title: string): CalendarItem {
	return { id, type: "calendar", timestamp: new Date(), data: { title } }
}

// =============================================================================
// TEST SOURCES
// =============================================================================

function createWeatherSource(items: WeatherItem[]) {
	return {
		id: "aris.weather",
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
		id: "aris.calendar",
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

			let triggerUpdate: ((update: Record<string, unknown>) => void) | null = null

			const source: FeedSource = {
				id: "aris.reactive",
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
			triggerUpdate!({ foo: "bar" })
			await new Promise((resolve) => setTimeout(resolve, 50))

			expect(callCount).toBeGreaterThan(countAfterStart)

			engine.stop()
		})

		test("post-processors run during reactive item updates", async () => {
			let callCount = 0

			let triggerItemsUpdate: (() => void) | null = null

			const source: FeedSource = {
				id: "aris.reactive",
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
			triggerItemsUpdate!()
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
