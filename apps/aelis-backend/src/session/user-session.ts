import { FeedEngine, type FeedItem, type FeedResult, type FeedSource } from "@aelis/core"

import type { FeedEnhancer } from "../enhancement/enhance-feed.ts"

export class UserSession {
	readonly engine: FeedEngine
	private sources = new Map<string, FeedSource>()
	private readonly enhancer: FeedEnhancer | null
	private enhancedItems: FeedItem[] | null = null
	/** The FeedResult that enhancedItems was derived from. */
	private enhancedSource: FeedResult | null = null
	private enhancingPromise: Promise<void> | null = null
	private unsubscribe: (() => void) | null = null

	constructor(sources: FeedSource[], enhancer?: FeedEnhancer | null) {
		this.engine = new FeedEngine()
		this.enhancer = enhancer ?? null
		for (const source of sources) {
			this.sources.set(source.id, source)
			this.engine.register(source)
		}

		if (this.enhancer) {
			this.unsubscribe = this.engine.subscribe((result) => {
				this.invalidateEnhancement()
				this.runEnhancement(result)
			})
		}

		this.engine.start()
	}

	/**
	 * Returns the current feed, refreshing if the engine cache expired.
	 * Enhancement runs eagerly on engine updates; this method awaits
	 * any in-flight enhancement or triggers one if needed.
	 */
	async feed(): Promise<FeedResult> {
		const cached = this.engine.lastFeed()
		const result = cached ?? (await this.engine.refresh())

		if (!this.enhancer) {
			return result
		}

		// Wait for any in-flight background enhancement to finish
		if (this.enhancingPromise) {
			await this.enhancingPromise
		}

		// Serve cached enhancement only if it matches the current engine result
		if (this.enhancedItems && this.enhancedSource === result) {
			return { ...result, items: this.enhancedItems }
		}

		// Stale or missing — re-enhance
		await this.runEnhancement(result)

		if (this.enhancedItems) {
			return { ...result, items: this.enhancedItems }
		}

		return result
	}

	getSource<T extends FeedSource>(sourceId: string): T | undefined {
		return this.sources.get(sourceId) as T | undefined
	}

	destroy(): void {
		this.unsubscribe?.()
		this.unsubscribe = null
		this.engine.stop()
		this.sources.clear()
		this.invalidateEnhancement()
		this.enhancingPromise = null
	}

	private invalidateEnhancement(): void {
		this.enhancedItems = null
		this.enhancedSource = null
	}

	private runEnhancement(result: FeedResult): Promise<void> {
		const promise = this.enhance(result)
		this.enhancingPromise = promise
		promise.finally(() => {
			if (this.enhancingPromise === promise) {
				this.enhancingPromise = null
			}
		})
		return promise
	}

	private async enhance(result: FeedResult): Promise<void> {
		try {
			this.enhancedItems = await this.enhancer!(result.items)
			this.enhancedSource = result
		} catch (err) {
			console.error("[enhancement] Unexpected error:", err)
			this.invalidateEnhancement()
		}
	}
}
