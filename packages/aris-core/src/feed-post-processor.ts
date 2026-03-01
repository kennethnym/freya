import type { FeedItem } from "./feed"

export interface ItemGroup {
	/** IDs of items to present together */
	itemIds: string[]
	/** Summary text for the group */
	summary: string
}

export interface FeedEnhancement {
	/** New items to inject into the feed */
	additionalItems?: FeedItem[]
	/** Groups of items to present together with a summary */
	groupedItems?: ItemGroup[]
	/** Item IDs to remove from the feed */
	suppress?: string[]
	/** Map of item ID to boost score (-1 to 1). Positive promotes, negative demotes. */
	boost?: Record<string, number>
}

/**
 * A function that transforms feed items and produces enhancement directives.
 * Use named functions for meaningful error attribution.
 */
export type FeedPostProcessor = (items: FeedItem[]) => Promise<FeedEnhancement>
