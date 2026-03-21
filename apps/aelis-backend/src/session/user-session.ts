import { FeedEngine, type FeedItem, type FeedResult, type FeedSource } from "@aelis/core"

import type { FeedEnhancer } from "../enhancement/enhance-feed.ts"
import type { FeedSourceProvider } from "./feed-source-provider.ts"

export class UserSession {
	readonly userId: string
	readonly engine: FeedEngine
	private sources = new Map<string, FeedSource>()
	private readonly enhancer: FeedEnhancer | null
	private enhancedItems: FeedItem[] | null = null
	/** The FeedResult that enhancedItems was derived from. */
	private enhancedSource: FeedResult | null = null
	private enhancingPromise: Promise<void> | null = null
	private unsubscribe: (() => void) | null = null

	constructor(userId: string, sources: FeedSource[], enhancer?: FeedEnhancer | null) {
		this.userId = userId
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

	/**
	 * Re-resolves a source from its provider using this session's userId.
	 * The source must already be registered. Throws if it isn't.
	 * If the provider fails, the source is removed from the session.
	 */
	async refreshSource(provider: FeedSourceProvider): Promise<void> {
		if (!this.sources.has(provider.sourceId)) {
			throw new Error(`Cannot refresh source "${provider.sourceId}": not registered`)
		}

		try {
			const newSource = await provider.feedSourceForUser(this.userId)
			this.replaceSource(provider.sourceId, newSource)
		} catch (err) {
			console.error(
				`[UserSession] refreshSource("${provider.sourceId}") failed for user ${this.userId}:`,
				err,
			)
		}
	}

	/**
	 * Replaces a source in the engine and invalidates all caches.
	 * Stops and restarts the engine to re-establish reactive subscriptions.
	 */
	replaceSource(oldSourceId: string, newSource: FeedSource): void {
		if (!this.sources.has(oldSourceId)) {
			throw new Error(`Cannot replace source "${oldSourceId}": not registered`)
		}

		const wasStarted = this.engine.isStarted()

		if (wasStarted) {
			this.engine.stop()
		}

		this.engine.unregister(oldSourceId)
		this.sources.delete(oldSourceId)

		this.engine.register(newSource)
		this.sources.set(newSource.id, newSource)

		this.invalidateEnhancement()
		this.enhancingPromise = null

		if (wasStarted) {
			this.engine.start()
		}
	}

	/**
	 * Removes a source from the engine and invalidates all caches.
	 * Stops and restarts the engine to clean up reactive subscriptions.
	 */
	removeSource(sourceId: string): void {
		if (!this.sources.has(sourceId)) return

		const wasStarted = this.engine.isStarted()

		if (wasStarted) {
			this.engine.stop()
		}

		this.engine.unregister(sourceId)
		this.sources.delete(sourceId)

		this.invalidateEnhancement()
		this.enhancingPromise = null

		if (wasStarted) {
			this.engine.start()
		}
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
