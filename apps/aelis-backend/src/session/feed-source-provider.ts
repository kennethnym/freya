import type { FeedSource } from "@aelis/core"

export interface FeedSourceProvider {
	feedSourceForUser(userId: string): FeedSource
}

export type FeedSourceProviderFn = (userId: string) => FeedSource

export type FeedSourceProviderInput = FeedSourceProvider | FeedSourceProviderFn
