import { describe, expect, test } from "bun:test"

import {
	emptyEnhancementResult,
	enhancementResultJsonSchema,
	parseEnhancementResult,
} from "./schema.ts"

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

describe("schema sync", () => {
	const referencePayloads = [
		{
			name: "full payload with null slot fill",
			payload: {
				slotFills: {
					"weather-1": { insight: "Rain after 3pm", crossSource: null },
					"cal-2": { summary: "Busy morning" },
				},
				syntheticItems: [
					{ id: "briefing-morning", type: "briefing", text: "Light day ahead." },
					{ id: "nudge-umbrella", type: "nudge", text: "Bring an umbrella." },
				],
			},
		},
		{
			name: "empty collections",
			payload: { slotFills: {}, syntheticItems: [] },
		},
		{
			name: "slot fills only",
			payload: {
				slotFills: { "item-1": { slot: "filled" } },
				syntheticItems: [],
			},
		},
		{
			name: "synthetic items only",
			payload: {
				slotFills: {},
				syntheticItems: [{ id: "insight-1", type: "insight", text: "Something." }],
			},
		},
	]

	for (const { name, payload } of referencePayloads) {
		test(`arktype and JSON Schema agree on: ${name}`, () => {
			// arktype accepts it
			const parsed = parseEnhancementResult(JSON.stringify(payload))
			expect(parsed).not.toBeNull()

			// JSON Schema structure matches
			const jsonSchema = enhancementResultJsonSchema
			const payloadKeys = Object.keys(payload).sort() as Array<(typeof jsonSchema.required)[number]>
			expect(Object.keys(jsonSchema.properties).sort()).toEqual(Object.keys(payload).sort())
			expect([...jsonSchema.required].sort()).toEqual(payloadKeys)

			// syntheticItems item schema has the right required fields
			const itemSchema = jsonSchema.properties.syntheticItems.items
			expect([...itemSchema.required].sort()).toEqual(["id", "text", "type"])

			// Verify each synthetic item has exactly the fields the JSON Schema expects
			for (const item of payload.syntheticItems) {
				expect(Object.keys(item).sort()).toEqual([...itemSchema.required].sort())
			}
		})
	}

	test("JSON Schema rejects what arktype rejects: missing required field", () => {
		// Missing syntheticItems
		expect(parseEnhancementResult(JSON.stringify({ slotFills: {} }))).toBeNull()

		// JSON Schema also requires it
		expect(enhancementResultJsonSchema.required).toContain("syntheticItems")
	})

	test("JSON Schema rejects what arktype rejects: wrong slot fill value type", () => {
		const bad = { slotFills: { "item-1": { slot: 42 } }, syntheticItems: [] }

		// arktype rejects it
		expect(parseEnhancementResult(JSON.stringify(bad))).toBeNull()

		// JSON Schema only allows string or null for slot values
		const slotValueSchema =
			enhancementResultJsonSchema.properties.slotFills.additionalProperties.additionalProperties
		expect(slotValueSchema.anyOf).toEqual([{ type: "string" }, { type: "null" }])
	})
})
