import type { FeedSource } from "@aelis/core"

export interface FeedSourceProvider {
	feedSourceForUser(userId: string): Promise<FeedSource>
}

export type FeedSourceProviderFn = (userId: string) => Promise<FeedSource>

export type FeedSourceProviderInput = FeedSourceProvider | FeedSourceProviderFn
