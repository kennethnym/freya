import type { ActionDefinition } from "./action"
import type { Context, ContextEntry } from "./context"
import type { FeedItem } from "./feed"

/**
 * Unified interface for sources that provide context, feed items, and actions.
 *
 * Sources form a dependency graph — a source declares which other sources
 * it depends on, and the graph ensures dependencies are resolved before
 * dependents run.
 *
 * Source IDs use reverse domain notation. Built-in sources use `freya.<name>`,
 * third parties use their own domain (e.g., `com.spotify`).
 *
 * Every method maps to a protocol operation for remote source support:
 * - `id`, `dependencies`       → source/describe
 * - `listActions()`            → source/listActions
 * - `executeAction()`          → source/executeAction
 * - `fetchContext()`           → source/fetchContext
 * - `fetchItems()`             → source/fetchItems
 * - `onContextUpdate()`        → source/contextUpdated (notification)
 * - `onItemsUpdate()`          → source/itemsUpdated (notification)
 *
 * @example
 * ```ts
 * const locationSource: FeedSource = {
 *   id: "freya.location",
 *   async listActions() { return { "update-location": { id: "update-location" } } },
 *   async executeAction(actionId) { throw new UnknownActionError(actionId) },
 *   async fetchContext() { ... },
 * }
 * ```
 */
export interface FeedSource<TItem extends FeedItem = FeedItem> {
	/** Unique identifier for this source in reverse-domain format */
	readonly id: string

	/** IDs of sources this source depends on */
	readonly dependencies?: readonly string[]

	/**
	 * List actions this source supports. Empty record if none.
	 * Maps to: source/listActions
	 */
	listActions(): Promise<Record<string, ActionDefinition>>

	/**
	 * Execute an action by ID. Throws on unknown action or invalid input.
	 * Maps to: source/executeAction
	 */
	executeAction(actionId: string, params: unknown): Promise<unknown>

	/**
	 * Subscribe to reactive context updates.
	 * Called when the source can push context changes proactively.
	 * Returns cleanup function.
	 * Maps to: source/contextUpdated (notification, source → host)
	 */
	onContextUpdate?(
		callback: (entries: readonly ContextEntry[]) => void,
		getContext: () => Context,
	): () => void

	/**
	 * Fetch context on-demand.
	 * Called during manual refresh or initial load.
	 * Return null if this source cannot provide context.
	 * Maps to: source/fetchContext
	 */
	fetchContext(context: Context): Promise<readonly ContextEntry[] | null>

	/**
	 * Subscribe to reactive feed item updates.
	 * Called when the source can push item changes proactively.
	 * Returns cleanup function.
	 * Maps to: source/itemsUpdated (notification, source → host)
	 */
	onItemsUpdate?(callback: (items: TItem[]) => void, getContext: () => Context): () => void

	/**
	 * Fetch feed items on-demand.
	 * Called during manual refresh or when dependencies update.
	 * Maps to: source/fetchItems
	 */
	fetchItems?(context: Context): Promise<TItem[]>
}
