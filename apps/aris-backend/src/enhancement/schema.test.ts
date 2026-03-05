import { describe, expect, test } from "bun:test"

import { emptyEnhancementResult, parseEnhancementResult } from "./schema.ts"

describe("parseEnhancementResult", () => {
	test("parses valid result", () => {
		const input = JSON.stringify({
			slotFills: {
				"weather-1": {
					insight: "Rain after 3pm",
					"cross-source": null,
				},
			},
			syntheticItems: [
				{
					id: "briefing-morning",
					type: "briefing",
					text: "Light afternoon ahead.",
				},
			],
		})

		const result = parseEnhancementResult(input)

		expect(result).not.toBeNull()
		expect(result!.slotFills["weather-1"]!.insight).toBe("Rain after 3pm")
		expect(result!.slotFills["weather-1"]!["cross-source"]).toBeNull()
		expect(result!.syntheticItems).toHaveLength(1)
		expect(result!.syntheticItems[0]!.id).toBe("briefing-morning")
		expect(result!.syntheticItems[0]!.text).toBe("Light afternoon ahead.")
	})

	test("parses empty result", () => {
		const input = JSON.stringify({
			slotFills: {},
			syntheticItems: [],
		})

		const result = parseEnhancementResult(input)

		expect(result).not.toBeNull()
		expect(Object.keys(result!.slotFills)).toHaveLength(0)
		expect(result!.syntheticItems).toHaveLength(0)
	})

	test("returns null for invalid JSON", () => {
		expect(parseEnhancementResult("not json")).toBeNull()
	})

	test("returns null for non-object", () => {
		expect(parseEnhancementResult('"hello"')).toBeNull()
		expect(parseEnhancementResult("42")).toBeNull()
		expect(parseEnhancementResult("null")).toBeNull()
	})

	test("returns null when slotFills is missing", () => {
		const input = JSON.stringify({ syntheticItems: [] })
		expect(parseEnhancementResult(input)).toBeNull()
	})

	test("returns null when syntheticItems is missing", () => {
		const input = JSON.stringify({ slotFills: {} })
		expect(parseEnhancementResult(input)).toBeNull()
	})

	test("returns null when slotFills has non-string values", () => {
		const input = JSON.stringify({
			slotFills: { "item-1": { slot: 42 } },
			syntheticItems: [],
		})
		expect(parseEnhancementResult(input)).toBeNull()
	})

	test("returns null when syntheticItem is missing required fields", () => {
		const input = JSON.stringify({
			slotFills: {},
			syntheticItems: [{ id: "x" }],
		})
		expect(parseEnhancementResult(input)).toBeNull()
	})
})

describe("emptyEnhancementResult", () => {
	test("returns empty slotFills and syntheticItems", () => {
		const result = emptyEnhancementResult()
		expect(result.slotFills).toEqual({})
		expect(result.syntheticItems).toEqual([])
	})
})
