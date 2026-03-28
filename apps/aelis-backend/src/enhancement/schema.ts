import { type } from "arktype"

const SyntheticItem = type({
	id: "string",
	type: "string",
	text: "string",
})

const EnhancementResult = type({
	slotFills: "Record<string, Record<string, string | null>>",
	syntheticItems: SyntheticItem.array(),
})

export type SyntheticItem = typeof SyntheticItem.infer
export type EnhancementResult = typeof EnhancementResult.infer

/**
 * JSON Schema passed to OpenRouter's structured output.
 * OpenRouter doesn't support arktype, so this is maintained separately.
 *
 * ⚠️  Must stay in sync with EnhancementResult above.
 * If you add/remove fields, update both schemas.
 */
export const enhancementResultJsonSchema = {
	type: "object",
	properties: {
		slotFills: {
			type: "object",
			description:
				"Map of feed item ID to an object of slot name to filled text content. Use null for slots that cannot be meaningfully filled.",
			additionalProperties: {
				type: "object",
				additionalProperties: {
					anyOf: [{ type: "string" }, { type: "null" }],
				},
			},
		},
		syntheticItems: {
			type: "array",
			description:
				"New feed items to inject (briefings, nudges, cross-source insights). Keep these short and actionable.",
			items: {
				type: "object",
				properties: {
					id: {
						type: "string",
						description: "Unique ID, e.g. 'briefing-morning'",
					},
					type: {
						type: "string",
						description: "One of: 'briefing', 'nudge', 'insight'",
					},
					text: {
						type: "string",
						description: "Display text, 1-3 sentences",
					},
				},
				required: ["id", "type", "text"],
				additionalProperties: false,
			},
		},
	},
	required: ["slotFills", "syntheticItems"],
	additionalProperties: false,
} as const

/**
 * Parses a JSON string into an EnhancementResult.
 * Returns null if the input is malformed.
 */
export function parseEnhancementResult(json: string): EnhancementResult | null {
	let parsed: unknown
	try {
		parsed = JSON.parse(json)
	} catch {
		return null
	}

	const result = EnhancementResult(parsed)
	if (result instanceof type.errors) {
		return null
	}

	return result
}

export function emptyEnhancementResult(): EnhancementResult {
	return { slotFills: {}, syntheticItems: [] }
}
