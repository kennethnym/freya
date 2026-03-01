import type { ContextEntry } from "./context"
import type { DataSource } from "./data-source"
import type { FeedItem } from "./feed"
import type { ReconcileResult } from "./reconciler"

import { Context } from "./context"
import { Reconciler } from "./reconciler"

export interface FeedControllerConfig {
	/** Timeout for each data source query in milliseconds */
	timeout?: number
	/** Debounce window for batching context updates (default: 100ms) */
	debounceMs?: number
	/** Initial context state */
	initialContext?: Context
}

export type FeedSubscriber<TItems extends FeedItem> = (result: ReconcileResult<TItems>) => void

interface RegisteredSource {
	source: DataSource<FeedItem, unknown>
	config: unknown
}

const DEFAULT_DEBOUNCE_MS = 100

/**
 * Orchestrates feed reconciliation in response to context updates.
 *
 * Holds context state, debounces updates, queries data sources, and
 * notifies subscribers. Each user should have their own instance.
 *
 * @example
 * ```ts
 * const controller = new FeedController({ debounceMs: 100 })
 *   .addDataSource(new WeatherDataSource())
 *   .addDataSource(new TflDataSource())
 *
 * controller.subscribe((result) => {
 *   console.log(result.items)
 * })
 *
 * // Context update triggers debounced reconcile
 * controller.pushContextUpdate([[LocationKey, location]])
 *
 * // Direct reconcile (no debounce)
 * const result = await controller.reconcile()
 *
 * // Cleanup
 * controller.stop()
 * ```
 */
export class FeedController<TItems extends FeedItem = never> {
	private sources = new Map<string, RegisteredSource>()
	private subscribers = new Set<FeedSubscriber<TItems>>()
	private context: Context
	private debounceMs: number
	private timeout: number | undefined
	private pendingTimeout: ReturnType<typeof setTimeout> | null = null
	private stopped = false

	constructor(config?: FeedControllerConfig) {
		this.context = config?.initialContext ?? new Context()
		this.debounceMs = config?.debounceMs ?? DEFAULT_DEBOUNCE_MS
		this.timeout = config?.timeout
	}

	/** Registers a data source. */
	addDataSource<TItem extends FeedItem, TConfig>(
		source: DataSource<TItem, TConfig>,
		config?: TConfig,
	): FeedController<TItems | TItem> {
		this.sources.set(source.type, {
			source: source as DataSource<FeedItem, unknown>,
			config,
		})
		return this as FeedController<TItems | TItem>
	}

	/** Removes a data source by type. */
	removeDataSource<T extends TItems["type"]>(
		sourceType: T,
	): FeedController<Exclude<TItems, { type: T }>> {
		this.sources.delete(sourceType)
		return this as unknown as FeedController<Exclude<TItems, { type: T }>>
	}

	/** Stops the controller and cancels pending reconciles. */
	stop(): void {
		this.stopped = true

		if (this.pendingTimeout) {
			clearTimeout(this.pendingTimeout)
			this.pendingTimeout = null
		}
	}

	/** Merges entries into context and schedules a debounced reconcile. */
	pushContextUpdate(entries: readonly ContextEntry[]): void {
		this.context.time = new Date()
		this.context.set(entries)
		this.scheduleReconcile()
	}

	/** Subscribes to feed updates. Returns unsubscribe function. */
	subscribe(callback: FeedSubscriber<TItems>): () => void {
		this.subscribers.add(callback)

		return () => {
			this.subscribers.delete(callback)
		}
	}

	/** Immediately reconciles with current or provided context. */
	async reconcile(context?: Context): Promise<ReconcileResult<TItems>> {
		const ctx = context ?? this.context
		const reconciler = this.createReconciler()
		return reconciler.reconcile(ctx)
	}

	/** Returns current context. */
	getContext(): Context {
		return this.context
	}

	private scheduleReconcile(): void {
		if (this.pendingTimeout) return

		this.pendingTimeout = setTimeout(() => {
			this.flushPending()
		}, this.debounceMs)
	}

	private async flushPending(): Promise<void> {
		this.pendingTimeout = null

		if (this.stopped) return
		if (this.sources.size === 0) return

		const reconciler = this.createReconciler()
		const result = await reconciler.reconcile(this.context)

		this.notifySubscribers(result)
	}

	private createReconciler(): Reconciler<TItems> {
		const reconciler = new Reconciler<TItems>({ timeout: this.timeout })
		Array.from(this.sources.values()).forEach(({ source, config }) => {
			reconciler.register(source, config)
		})
		return reconciler as Reconciler<TItems>
	}

	private notifySubscribers(result: ReconcileResult<TItems>): void {
		this.subscribers.forEach((callback) => {
			try {
				callback(result)
			} catch {
				// Subscriber errors shouldn't break other subscribers
			}
		})
	}
}
