import type { FeedSource } from "@aelis/core"

export interface FeedSourceProvider {
	/** The source ID this provider is responsible for (e.g., "aelis.location"). */
	readonly sourceId: string
	feedSourceForUser(userId: string): Promise<FeedSource>
}
