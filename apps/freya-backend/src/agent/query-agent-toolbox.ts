import type { ContextKeyPart } from "@freya/core"

export interface QueryAgentToolResult {
	content: Array<{ type: "text"; text: string }>
	details: Record<string, unknown>
}

/**
 * Implementation boundary for FREYA query-agent tools.
 *
 * The Pi-facing tool definitions in `tools.ts` should stay thin: they declare
 * schemas, validate and narrow raw model-provided parameters, then delegate to
 * this toolbox. Concrete implementations own the actual data gathering,
 * source/action lookups, result shaping, and any session-specific behavior.
 */
export interface QueryAgentToolbox {
	/**
	 * Summarizes every source currently visible to the user's session.
	 *
	 * Implementations should refresh or read the current feed as needed, then
	 * return a compact source inventory including feed item counts, context
	 * entry counts, available action IDs/descriptions, and source errors. This
	 * is the broad discovery tool an agent can use before deciding which more
	 * targeted tool call to make.
	 */
	listSources(): Promise<QueryAgentToolResult>

	/**
	 * Reads context entries from the current FREYA context graph.
	 *
	 * `key` is a tuple-style context key. With `match: "exact"`, the implementation
	 * should return only the value at that exact key and indicate whether it was
	 * found. With `match: "prefix"`, it should return all entries whose keys
	 * begin with the provided key parts, plus a count. Implementations may refresh
	 * the feed first so the context reflects the latest source data.
	 */
	getContext(key: ContextKeyPart[], match: "exact" | "prefix"): Promise<QueryAgentToolResult>

	/**
	 * Reads one feed item by ID and includes source-local diagnostics.
	 *
	 * Implementations should search the current feed for `feedItemId`. When found,
	 * the result should include the item plus related context entries, source
	 * action summaries, and source errors. When missing, the result should clearly
	 * report `found: false` and return `item: null`.
	 */
	getFeedItem(feedItemId: string): Promise<QueryAgentToolResult>

	/**
	 * Returns the broad context bundle needed to answer a natural-language query.
	 *
	 * `question` is included in the result for traceability. If `feedItemId` is
	 * provided, implementations should also include the matching selected item
	 * when present. The result should expose the current feed items, context graph
	 * entries, available source actions, and source errors so the agent can
	 * synthesize an answer from the user's personal data.
	 */
	queryContext(question: string, feedItemId?: string): Promise<QueryAgentToolResult>

	/**
	 * Lists every current context graph entry.
	 *
	 * This is a lower-level inspection tool than `queryContext`: it should return
	 * all context entries and a count, without feed items or action summaries.
	 * Implementations may refresh the feed first to ensure source-provided
	 * context has been materialized.
	 */
	listContext(): Promise<QueryAgentToolResult>

	/**
	 * Returns all currently available data for one source.
	 *
	 * Implementations should include whether the source is enabled, all feed
	 * items from `sourceId`, context entries owned by that source, available
	 * action summaries, and errors from that source. If `feedItemId` is provided,
	 * the result should also include the matching selected item from that source
	 * when present.
	 */
	getSourceData(sourceId: string, feedItemId?: string): Promise<QueryAgentToolResult>

	/**
	 * Executes a source action and returns a serializable execution result.
	 *
	 * `sourceId` identifies the source, `actionId` identifies the action within
	 * that source, and `params` is the source-specific action payload. Tool
	 * wrappers validate the action envelope, while the source action schema owns
	 * payload validation. Implementations should let source/action validation
	 * errors propagate, and on success should return an `ok: true` result plus
	 * `details.actionExecution` for callers that need a structured record of
	 * what ran.
	 */
	executeAction(sourceId: string, actionId: string, params?: unknown): Promise<QueryAgentToolResult>
}
