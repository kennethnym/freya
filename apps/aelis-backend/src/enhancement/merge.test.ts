import type { FeedItem } from "@aelis/core"

import { describe, expect, test } from "bun:test"

import type { EnhancementResult } from "./schema.ts"

import { mergeEnhancement } from "./merge.ts"

function makeItem(overrides: Partial<FeedItem> = {}): FeedItem {
	return {
		id: "item-1",
		sourceId: "test",
		type: "test",
		timestamp: new Date("2025-01-01T00:00:00Z"),
		data: { value: 42 },
		...overrides,
	}
}

const now = new Date("2025-06-01T12:00:00Z")

describe("mergeEnhancement", () => {
	test("fills matching slots", () => {
		const item = makeItem({
			slots: {
				insight: { description: "Weather insight", content: null },
			},
		})
		const result: EnhancementResult = {
			slotFills: {
				"item-1": { insight: "Rain after 3pm" },
			},
			syntheticItems: [],
		}

		const merged = mergeEnhancement([item], result, now)

		expect(merged).toHaveLength(1)
		expect(merged[0]!.slots!.insight!.content).toBe("Rain after 3pm")
		// Description preserved
		expect(merged[0]!.slots!.insight!.description).toBe("Weather insight")
	})

	test("does not mutate original items", () => {
		const item = makeItem({
			slots: {
				insight: { description: "test", content: null },
			},
		})
		const result: EnhancementResult = {
			slotFills: { "item-1": { insight: "filled" } },
			syntheticItems: [],
		}

		mergeEnhancement([item], result, now)

		expect(item.slots!.insight!.content).toBeNull()
	})

	test("ignores fills for non-existent items", () => {
		const item = makeItem()
		const result: EnhancementResult = {
			slotFills: { "non-existent": { insight: "text" } },
			syntheticItems: [],
		}

		const merged = mergeEnhancement([item], result, now)

		expect(merged).toHaveLength(1)
		expect(merged[0]!.id).toBe("item-1")
	})

	test("ignores fills for non-existent slots", () => {
		const item = makeItem({
			slots: {
				insight: { description: "test", content: null },
			},
		})
		const result: EnhancementResult = {
			slotFills: { "item-1": { "non-existent-slot": "text" } },
			syntheticItems: [],
		}

		const merged = mergeEnhancement([item], result, now)

		expect(merged[0]!.slots!.insight!.content).toBeNull()
	})

	test("skips null fills", () => {
		const item = makeItem({
			slots: {
				insight: { description: "test", content: null },
			},
		})
		const result: EnhancementResult = {
			slotFills: { "item-1": { insight: null } },
			syntheticItems: [],
		}

		const merged = mergeEnhancement([item], result, now)

		expect(merged[0]!.slots!.insight!.content).toBeNull()
	})

	test("passes through items without slots unchanged", () => {
		const item = makeItem()
		const result: EnhancementResult = {
			slotFills: {},
			syntheticItems: [],
		}

		const merged = mergeEnhancement([item], result, now)

		expect(merged[0]).toBe(item)
	})

	test("appends synthetic items with backfilled fields", () => {
		const item = makeItem()
		const result: EnhancementResult = {
			slotFills: {},
			syntheticItems: [
				{
					id: "briefing-morning",
					type: "briefing",
					text: "Light afternoon ahead.",
				},
			],
		}

		const merged = mergeEnhancement([item], result, now)

		expect(merged).toHaveLength(2)
		expect(merged[1]!.id).toBe("briefing-morning")
		expect(merged[1]!.type).toBe("briefing")
		expect(merged[1]!.timestamp).toEqual(now)
		expect(merged[1]!.data).toEqual({ text: "Light afternoon ahead." })
	})

	test("handles empty enhancement result", () => {
		const item = makeItem()
		const result: EnhancementResult = {
			slotFills: {},
			syntheticItems: [],
		}

		const merged = mergeEnhancement([item], result, now)

		expect(merged).toHaveLength(1)
		expect(merged[0]).toBe(item)
	})
})
