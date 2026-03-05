import type { FeedItem } from "@aris/core"

import type { EnhancementResult } from "./schema.ts"

/**
 * Merges an EnhancementResult into feed items.
 *
 * - Writes slot content from slotFills into matching items
 * - Appends synthetic items to the list
 * - Returns a new array (no mutation)
 * - Ignores fills for items/slots that don't exist
 */
export function mergeEnhancement(items: FeedItem[], result: EnhancementResult, currentTime: Date): FeedItem[] {
	const merged = items.map((item) => {
		const fills = result.slotFills[item.id]
		if (!fills || !item.slots) return item

		const mergedSlots = { ...item.slots }
		let changed = false

		for (const [slotName, content] of Object.entries(fills)) {
			if (slotName in mergedSlots && content !== null) {
				mergedSlots[slotName] = { ...mergedSlots[slotName]!, content }
				changed = true
			}
		}

		return changed ? { ...item, slots: mergedSlots } : item
	})

	for (const synthetic of result.syntheticItems) {
		merged.push({
			id: synthetic.id,
			type: synthetic.type,
			timestamp: currentTime,
			data: { text: synthetic.text },
		})
	}

	return merged
}
