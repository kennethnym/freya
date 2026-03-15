import type { FeedItem, FeedItemRenderer, RenderedFeedItem } from "@aelis/core"

/**
 * Renders feed items using registered renderers.
 *
 * Constructed with a map of source ID to renderer function.
 * Items whose source has no renderer are silently dropped.
 */
export class FeedRenderer {
	private readonly renderers: Map<string, FeedItemRenderer>

	constructor(renderers: Record<string, FeedItemRenderer>) {
		this.renderers = new Map(Object.entries(renderers))
	}

	/**
	 * Renders an array of feed items. Items whose sourceId has no
	 * registered renderer are silently dropped from the result.
	 */
	render(items: FeedItem[]): RenderedFeedItem[] {
		const result: RenderedFeedItem[] = []
		for (const item of items) {
			const renderer = this.renderers.get(item.sourceId)
			if (renderer) {
				result.push({ ...item, ui: renderer(item) })
			}
		}
		return result
	}
}
