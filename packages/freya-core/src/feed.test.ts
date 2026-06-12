import { describe, expect, test } from "bun:test"

import type { FeedItem, Slot } from "./feed"

describe("FeedItem slots", () => {
	test("FeedItem without slots is valid", () => {
		const item: FeedItem<"test", { value: number }> = {
			id: "test-1",
			sourceId: "test-source",
			type: "test",
			timestamp: new Date(),
			data: { value: 42 },
		}

		expect(item.slots).toBeUndefined()
	})

	test("FeedItem with unfilled slots", () => {
		const item: FeedItem<"weather", { temp: number }> = {
			id: "weather-1",
			sourceId: "freya.weather",
			type: "weather",
			timestamp: new Date(),
			data: { temp: 18 },
			slots: {
				insight: {
					description: "A short contextual insight about the current weather",
					content: null,
				},
				"cross-source": {
					description: "Connection between weather and calendar events",
					content: null,
				},
			},
		}

		expect(item.slots).toBeDefined()
		expect(Object.keys(item.slots!)).toEqual(["insight", "cross-source"])
		expect(item.slots!.insight!.content).toBeNull()
		expect(item.slots!["cross-source"]!.content).toBeNull()
	})

	test("FeedItem with filled slots", () => {
		const item: FeedItem<"weather", { temp: number }> = {
			id: "weather-1",
			sourceId: "freya.weather",
			type: "weather",
			timestamp: new Date(),
			data: { temp: 18 },
			slots: {
				insight: {
					description: "A short contextual insight about the current weather",
					content: "Rain after 3pm — grab a jacket before your walk",
				},
			},
		}

		expect(item.slots!.insight!.content).toBe("Rain after 3pm — grab a jacket before your walk")
	})

	test("Slot interface enforces required fields", () => {
		const slot: Slot = {
			description: "Test slot description",
			content: null,
		}

		expect(slot.description).toBe("Test slot description")
		expect(slot.content).toBeNull()

		const filledSlot: Slot = {
			description: "Test slot description",
			content: "Filled content",
		}

		expect(filledSlot.content).toBe("Filled content")
	})

	test("FeedItem with empty slots record", () => {
		const item: FeedItem<"test", { value: number }> = {
			id: "test-1",
			sourceId: "test-source",
			type: "test",
			timestamp: new Date(),
			data: { value: 1 },
			slots: {},
		}

		expect(item.slots).toEqual({})
		expect(Object.keys(item.slots!)).toHaveLength(0)
	})
})
