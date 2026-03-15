import type { FeedRenderer } from "./feed-renderer.ts"

export interface FeedRendererProvider {
	feedRendererForUser(userId: string): FeedRenderer
}
