import type { Context } from "./context"
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
}

/**
 * A function that transforms feed items and produces enhancement directives.
 * Use named functions for meaningful error attribution.
 */
export type FeedPostProcessor = (items: FeedItem[], context: Context) => Promise<FeedEnhancement>
