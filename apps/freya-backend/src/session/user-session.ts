import {
	FeedEngine,
	type ActionDefinition,
	type FeedItem,
	type FeedResult,
	type FeedSource,
} from "@freya/core"

import type { ConversationStorage } from "../agent/conversation-recording-query-agent.ts"
import type { QueryAgentToolbox } from "../agent/query-agent-toolbox.ts"
import type { QueryAgent } from "../agent/query-agent.ts"
import type { FeedEnhancer } from "../enhancement/enhance-feed.ts"

import { PiQueryAgent } from "../agent/pi-query-agent.ts"
import { UserSessionQueryAgentToolbox } from "../agent/user-session-query-agent-toolbox.ts"

export interface UserSessionAgentConfig {
	apiKey?: string
	cwd?: string
	systemPrompt?: string
	conversationStorage?: Pick<ConversationStorage, "listEntries">
}

export interface LoadConversationInput {
	id: string
	/** Exclude the pending batch that the caller will supply to ask(). */
	beforeSequence?: number
}

export class UserSession {
	readonly userId: string
	readonly engine: FeedEngine
	readonly toolbox: QueryAgentToolbox
	private sources = new Map<string, FeedSource>()
	private readonly enhancer: FeedEnhancer | null
	private readonly agentConfig: UserSessionAgentConfig | undefined
	private readonly queryAgents = new Map<string, QueryAgent>()
	private readonly pendingConversations = new Map<string, Promise<QueryAgent>>()
	private destroyed = false
	private enhancedItems: FeedItem[] | null = null
	/** The FeedResult that enhancedItems was derived from. */
	private enhancedSource: FeedResult | null = null
	private enhancingPromise: Promise<void> | null = null
	private unsubscribe: (() => void) | null = null

	constructor(
		userId: string,
		sources: FeedSource[],
		enhancer?: FeedEnhancer | null,
		agentConfig?: UserSessionAgentConfig,
	) {
		this.userId = userId
		this.engine = new FeedEngine()
		this.enhancer = enhancer ?? null
		this.agentConfig = agentConfig
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

		this.toolbox = new UserSessionQueryAgentToolbox(this)
		this.engine.start()
	}

	async loadConversation(input: LoadConversationInput): Promise<QueryAgent> {
		if (this.destroyed) throw new Error("User session is destroyed")

		const existing = this.queryAgents.get(input.id)
		if (existing) return existing

		const pending = this.pendingConversations.get(input.id)
		if (pending) return pending

		const promise = this.createConversationAgent(input)
		this.pendingConversations.set(input.id, promise)
		try {
			return await promise
		} finally {
			this.pendingConversations.delete(input.id)
		}
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

	hasSource(sourceId: string): boolean {
		return this.sources.has(sourceId)
	}

	async listActions(): Promise<
		Array<{ sourceId: string; actions: Record<string, ActionDefinition> }>
	> {
		const result: Array<{ sourceId: string; actions: Record<string, ActionDefinition> }> = []

		for (const [sourceId, source] of this.sources) {
			result.push({
				sourceId,
				actions: await source.listActions(),
			})
		}

		return result
	}

	/**
	 * Registers a new source in the engine and invalidates all caches.
	 * Stops and restarts the engine to establish reactive subscriptions.
	 */
	addSource(source: FeedSource): void {
		if (this.sources.has(source.id)) {
			throw new Error(`Cannot add source "${source.id}": already registered`)
		}

		const wasStarted = this.engine.isStarted()

		if (wasStarted) {
			this.engine.stop()
		}

		this.engine.register(source)
		this.sources.set(source.id, source)

		this.invalidateEnhancement()
		this.enhancingPromise = null

		if (wasStarted) {
			this.engine.start()
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
		this.destroyed = true
		for (const agent of this.queryAgents.values()) agent.dispose()
		this.queryAgents.clear()
		this.pendingConversations.clear()
		this.unsubscribe?.()
		this.unsubscribe = null
		this.engine.stop()
		this.sources.clear()
		this.invalidateEnhancement()
		this.enhancingPromise = null
	}

	private async createConversationAgent(input: LoadConversationInput): Promise<QueryAgent> {
		const storage = this.agentConfig?.conversationStorage
		if (!storage) throw new Error("Conversation storage is not configured")

		// The user-scoped storage validates ownership before returning entries.
		const entries = await storage.listEntries(input.id)
		if (this.destroyed) {
			throw new Error("User session was destroyed while loading conversation")
		}
		const agent = new PiQueryAgent({
			conversationId: input.id,
			toolbox: this.toolbox,
			apiKey: this.agentConfig?.apiKey,
			cwd: this.agentConfig?.cwd,
			systemPrompt: this.agentConfig?.systemPrompt,
			initialEntries: entries.filter(
				(entry) => input.beforeSequence === undefined || entry.sequence < input.beforeSequence,
			),
		})
		this.queryAgents.set(input.id, agent)
		return agent
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
