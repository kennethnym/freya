import type { ActionDefinition } from "./action"
import type { Context } from "./context"
import type { FeedItem } from "./feed"
import type { FeedPostProcessor, ItemGroup } from "./feed-post-processor"
import type { FeedSource } from "./feed-source"

export interface SourceError {
	sourceId: string
	error: Error
}

export interface FeedResult<TItem extends FeedItem = FeedItem> {
	context: Context
	items: TItem[]
	errors: SourceError[]
	/** Item groups produced by post-processors */
	groupedItems?: ItemGroup[]
}

export type FeedSubscriber<TItem extends FeedItem = FeedItem> = (result: FeedResult<TItem>) => void

const DEFAULT_CACHE_TTL_MS = 300_000 // 5 minutes
const MIN_CACHE_TTL_MS = 10 // prevent spin from zero/negative values

export interface FeedEngineConfig {
	/** Cache TTL in milliseconds. Default: 300_000 (5 minutes). Minimum: 10. */
	cacheTtlMs?: number
}

interface SourceGraph {
	sources: Map<string, FeedSource>
	sorted: FeedSource[]
	dependents: Map<string, string[]>
}

/**
 * Orchestrates FeedSources, managing the dependency graph and context flow.
 *
 * Sources declare dependencies on other sources. The engine:
 * - Validates the dependency graph (no missing deps, no cycles)
 * - Runs fetchContext() in topological order during refresh
 * - Runs fetchItems() on all sources with accumulated context
 * - Subscribes to reactive updates via onContextUpdate/onItemsUpdate
 *
 * @example
 * ```ts
 * const engine = new FeedEngine()
 *   .register(locationSource)
 *   .register(weatherSource)
 *   .register(alertSource)
 *
 * // Pull-based refresh
 * const { context, items, errors } = await engine.refresh()
 *
 * // Reactive updates
 * engine.subscribe((result) => {
 *   console.log(result.items)
 * })
 * engine.start()
 *
 * // Cleanup
 * engine.stop()
 * ```
 */
export class FeedEngine<TItems extends FeedItem = FeedItem> {
	private sources = new Map<string, FeedSource>()
	private graph: SourceGraph | null = null
	private context: Context = { time: new Date() }
	private subscribers = new Set<FeedSubscriber<TItems>>()
	private cleanups: Array<() => void> = []
	private started = false
	private postProcessors: FeedPostProcessor[] = []

	private readonly cacheTtlMs: number
	private cachedResult: FeedResult<TItems> | null = null
	private cachedAt: number | null = null
	private refreshTimer: ReturnType<typeof setTimeout> | null = null

	constructor(config?: FeedEngineConfig) {
		this.cacheTtlMs = Math.max(config?.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS, MIN_CACHE_TTL_MS)
	}

	/**
	 * Returns the cached FeedResult if available and not expired.
	 * Returns null if no refresh has completed or the cache TTL has elapsed.
	 */
	lastFeed(): FeedResult<TItems> | null {
		if (this.cachedResult === null || this.cachedAt === null) {
			return null
		}
		if (Date.now() - this.cachedAt > this.cacheTtlMs) {
			return null
		}
		return this.cachedResult
	}

	/**
	 * Registers a FeedSource. Invalidates the cached graph.
	 */
	register<TItem extends FeedItem>(source: FeedSource<TItem>): FeedEngine<TItems | TItem> {
		this.sources.set(source.id, source)
		this.graph = null
		return this as FeedEngine<TItems | TItem>
	}

	/**
	 * Unregisters a FeedSource by ID. Invalidates the cached graph.
	 */
	unregister(sourceId: string): this {
		this.sources.delete(sourceId)
		this.graph = null
		return this
	}

	/**
	 * Registers a post-processor. Processors run in registration order
	 * after items are collected, on every update path.
	 */
	registerPostProcessor(processor: FeedPostProcessor): this {
		this.postProcessors.push(processor)
		return this
	}

	/**
	 * Unregisters a post-processor by reference.
	 */
	unregisterPostProcessor(processor: FeedPostProcessor): this {
		this.postProcessors = this.postProcessors.filter((p) => p !== processor)
		return this
	}

	/**
	 * Refreshes the feed by running all sources in dependency order.
	 * Calls fetchContext() then fetchItems() on each source.
	 */
	async refresh(): Promise<FeedResult<TItems>> {
		const graph = this.ensureGraph()
		const errors: SourceError[] = []

		// Reset context with fresh time
		let context: Context = { time: new Date() }

		// Run fetchContext in topological order
		for (const source of graph.sorted) {
			try {
				const update = await source.fetchContext(context)
				if (update) {
					context = { ...context, ...update }
				}
			} catch (err) {
				errors.push({
					sourceId: source.id,
					error: err instanceof Error ? err : new Error(String(err)),
				})
			}
		}

		// Run fetchItems on all sources
		const items: FeedItem[] = []
		for (const source of graph.sorted) {
			if (source.fetchItems) {
				try {
					const sourceItems = await source.fetchItems(context)
					items.push(...sourceItems)
				} catch (err) {
					errors.push({
						sourceId: source.id,
						error: err instanceof Error ? err : new Error(String(err)),
					})
				}
			}
		}

		this.context = context

		const {
			items: processedItems,
			groupedItems,
			errors: postProcessorErrors,
		} = await this.applyPostProcessors(items as TItems[], context, errors)

		const result: FeedResult<TItems> = {
			context,
			items: processedItems,
			errors: postProcessorErrors,
			...(groupedItems.length > 0 ? { groupedItems } : {}),
		}
		this.updateCache(result)

		return result
	}

	/**
	 * Subscribes to feed updates. Returns unsubscribe function.
	 */
	subscribe(callback: FeedSubscriber<TItems>): () => void {
		this.subscribers.add(callback)
		return () => {
			this.subscribers.delete(callback)
		}
	}

	/**
	 * Starts reactive subscriptions on all sources and begins periodic refresh.
	 * Sources with onContextUpdate will trigger re-computation of dependents.
	 */
	start(): void {
		if (this.started) return

		this.started = true
		const graph = this.ensureGraph()

		for (const source of graph.sorted) {
			if (source.onContextUpdate) {
				const cleanup = source.onContextUpdate(
					(update) => {
						this.handleContextUpdate(source.id, update)
					},
					() => this.context,
				)
				this.cleanups.push(cleanup)
			}

			if (source.onItemsUpdate) {
				const cleanup = source.onItemsUpdate(
					() => {
						this.scheduleRefresh()
					},
					() => this.context,
				)
				this.cleanups.push(cleanup)
			}
		}

		this.scheduleNextRefresh()
	}

	/**
	 * Stops all reactive subscriptions and the periodic refresh timer.
	 */
	stop(): void {
		this.started = false
		this.cancelScheduledRefresh()
		for (const cleanup of this.cleanups) {
			cleanup()
		}
		this.cleanups = []
	}

	/**
	 * Returns the current accumulated context.
	 */
	currentContext(): Context {
		return this.context
	}

	/**
	 * Execute an action on a registered source.
	 * Validates the action exists before dispatching.
	 *
	 * In pull-only mode (before `start()` is called), the action mutates source
	 * state but does not automatically refresh dependents. Call `refresh()`
	 * after to propagate changes. In reactive mode (`start()` called), sources
	 * that push context updates (e.g., LocationSource) will trigger dependent
	 * refresh automatically.
	 */
	async executeAction(sourceId: string, actionId: string, params: unknown): Promise<unknown> {
		const actions = await this.listActions(sourceId)
		if (!(actionId in actions)) {
			throw new Error(`Action "${actionId}" not found on source "${sourceId}"`)
		}
		return this.sources.get(sourceId)!.executeAction(actionId, params)
	}

	/**
	 * List actions available on a specific source.
	 * Validates that action definition IDs match their record keys.
	 */
	async listActions(sourceId: string): Promise<Record<string, ActionDefinition>> {
		const source = this.sources.get(sourceId)
		if (!source) {
			throw new Error(`Source not found: ${sourceId}`)
		}
		const actions = await source.listActions()
		for (const [key, definition] of Object.entries(actions)) {
			if (key !== definition.id) {
				throw new Error(
					`Action ID mismatch on source "${sourceId}": key "${key}" !== definition.id "${definition.id}"`,
				)
			}
		}
		return actions
	}

	private async applyPostProcessors(
		items: TItems[],
		context: Context,
		errors: SourceError[],
	): Promise<{ items: TItems[]; groupedItems: ItemGroup[]; errors: SourceError[] }> {
		let currentItems = items
		const allGroupedItems: ItemGroup[] = []
		const allErrors = [...errors]

		for (const processor of this.postProcessors) {
			const snapshot = currentItems
			try {
				const enhancement = await processor(currentItems, context)

				if (enhancement.additionalItems?.length) {
					// Post-processors operate on FeedItem[] without knowledge of TItems.
					// Additional items are merged untyped — this is intentional. The
					// processor contract is "FeedItem in, FeedItem out"; type narrowing
					// is the caller's responsibility when consuming FeedResult.
					currentItems = [...currentItems, ...(enhancement.additionalItems as TItems[])]
				}

				if (enhancement.suppress?.length) {
					const suppressSet = new Set(enhancement.suppress)
					currentItems = currentItems.filter((item) => !suppressSet.has(item.id))
				}

				if (enhancement.groupedItems?.length) {
					allGroupedItems.push(...enhancement.groupedItems)
				}
			} catch (err) {
				const sourceId = processor.name || "anonymous"
				allErrors.push({
					sourceId,
					error: err instanceof Error ? err : new Error(String(err)),
				})
				currentItems = snapshot
			}
		}

		// Remove stale item IDs from groups and drop empty groups
		const itemIds = new Set(currentItems.map((item) => item.id))
		const validGroups = allGroupedItems.reduce<ItemGroup[]>((acc, group) => {
			const ids = group.itemIds.filter((id) => itemIds.has(id))
			if (ids.length > 0) {
				acc.push({ ...group, itemIds: ids })
			}
			return acc
		}, [])

		return { items: currentItems, groupedItems: validGroups, errors: allErrors }
	}

	private ensureGraph(): SourceGraph {
		if (!this.graph) {
			this.graph = buildGraph(Array.from(this.sources.values()))
		}
		return this.graph
	}

	private handleContextUpdate(sourceId: string, update: Partial<Context>): void {
		this.context = { ...this.context, ...update, time: new Date() }

		// Re-run dependents and notify
		this.refreshDependents(sourceId)
	}

	private async refreshDependents(sourceId: string): Promise<void> {
		const graph = this.ensureGraph()
		const toRefresh = this.collectDependents(sourceId, graph)

		// Re-run fetchContext for dependents in order
		for (const id of toRefresh) {
			const source = graph.sources.get(id)
			if (source) {
				try {
					const update = await source.fetchContext(this.context)
					if (update) {
						this.context = { ...this.context, ...update }
					}
				} catch {
					// Errors during reactive updates are logged but don't stop propagation
				}
			}
		}

		// Collect items from all sources
		const items: FeedItem[] = []
		const errors: SourceError[] = []

		for (const source of graph.sorted) {
			if (source.fetchItems) {
				try {
					const sourceItems = await source.fetchItems(this.context)
					items.push(...sourceItems)
				} catch (err) {
					errors.push({
						sourceId: source.id,
						error: err instanceof Error ? err : new Error(String(err)),
					})
				}
			}
		}

		const {
			items: processedItems,
			groupedItems,
			errors: postProcessorErrors,
		} = await this.applyPostProcessors(items as TItems[], this.context, errors)

		const result: FeedResult<TItems> = {
			context: this.context,
			items: processedItems,
			errors: postProcessorErrors,
			...(groupedItems.length > 0 ? { groupedItems } : {}),
		}
		this.updateCache(result)

		this.notifySubscribers(result)
	}

	private collectDependents(sourceId: string, graph: SourceGraph): string[] {
		const result: string[] = []
		const visited = new Set<string>()

		const collect = (id: string): void => {
			const deps = graph.dependents.get(id) ?? []
			for (const dep of deps) {
				if (!visited.has(dep)) {
					visited.add(dep)
					result.push(dep)
					collect(dep)
				}
			}
		}

		collect(sourceId)

		// Return in topological order
		return graph.sorted.filter((s) => result.includes(s.id)).map((s) => s.id)
	}

	private updateCache(result: FeedResult<TItems>): void {
		this.cachedResult = result
		this.cachedAt = Date.now()
		if (this.started) {
			this.scheduleNextRefresh()
		}
	}

	private scheduleNextRefresh(): void {
		this.cancelScheduledRefresh()
		this.refreshTimer = setTimeout(() => {
			this.refresh()
				.then((result) => {
					this.notifySubscribers(result)
				})
				.catch(() => {
					// Periodic refresh errors are non-fatal; schedule next attempt
					if (this.started) {
						this.scheduleNextRefresh()
					}
				})
		}, this.cacheTtlMs)
	}

	private cancelScheduledRefresh(): void {
		if (this.refreshTimer !== null) {
			clearTimeout(this.refreshTimer)
			this.refreshTimer = null
		}
	}

	private scheduleRefresh(): void {
		// Simple immediate refresh for now - could add debouncing later
		this.refresh()
			.then((result) => {
				this.notifySubscribers(result)
			})
			.catch(() => {
				// Reactive refresh errors are non-fatal
			})
	}

	private notifySubscribers(result: FeedResult<TItems>): void {
		this.subscribers.forEach((callback) => {
			try {
				callback(result)
			} catch {
				// Subscriber errors shouldn't break other subscribers
			}
		})
	}
}

function buildGraph(sources: FeedSource[]): SourceGraph {
	const byId = new Map<string, FeedSource>()
	for (const source of sources) {
		byId.set(source.id, source)
	}

	// Validate dependencies exist
	for (const source of sources) {
		for (const dep of source.dependencies ?? []) {
			if (!byId.has(dep)) {
				throw new Error(`Source "${source.id}" depends on "${dep}" which is not registered`)
			}
		}
	}

	// Check for cycles and topologically sort
	const visited = new Set<string>()
	const visiting = new Set<string>()
	const sorted: FeedSource[] = []

	function visit(id: string, path: string[]): void {
		if (visiting.has(id)) {
			const cycle = [...path.slice(path.indexOf(id)), id].join(" → ")
			throw new Error(`Circular dependency detected: ${cycle}`)
		}
		if (visited.has(id)) return

		visiting.add(id)
		const source = byId.get(id)!
		for (const dep of source.dependencies ?? []) {
			visit(dep, [...path, id])
		}
		visiting.delete(id)
		visited.add(id)
		sorted.push(source)
	}

	for (const source of sources) {
		visit(source.id, [])
	}

	// Build reverse dependency map
	const dependents = new Map<string, string[]>()
	for (const source of sources) {
		for (const dep of source.dependencies ?? []) {
			const list = dependents.get(dep) ?? []
			list.push(source.id)
			dependents.set(dep, list)
		}
	}

	return { sources: byId, sorted, dependents }
}
