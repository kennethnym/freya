import type { FeedItem } from "@aris/core"

import type { LlmClient } from "./llm-client.ts"

import { mergeEnhancement } from "./merge.ts"
import { buildPrompt, hasUnfilledSlots } from "./prompt-builder.ts"

/** Takes feed items, returns enhanced feed items. */
export type FeedEnhancer = (items: FeedItem[]) => Promise<FeedItem[]>

export interface FeedEnhancerConfig {
	client: LlmClient
	/** Defaults to Date.now — override for testing */
	clock?: () => Date
}

/**
 * Creates a FeedEnhancer that uses the provided LlmClient.
 *
 * Skips the LLM call when no items have unfilled slots.
 * Returns items unchanged on LLM failure.
 */
export function createFeedEnhancer(config: FeedEnhancerConfig): FeedEnhancer {
	const { client } = config
	const clock = config.clock ?? (() => new Date())

	return async function enhanceFeed(items) {
		if (!hasUnfilledSlots(items)) {
			return items
		}

		const currentTime = clock()
		const { systemPrompt, userMessage } = buildPrompt(items, currentTime)

		let result
		try {
			result = await client.enhance({ systemPrompt, userMessage })
		} catch (err) {
			console.error("[enhancement] LLM call failed:", err)
			result = null
		}

		if (!result) {
			return items
		}

		return mergeEnhancement(items, result, currentTime)
	}
}


