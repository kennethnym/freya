import { contextKey, type ContextKeyPart } from "@freya/core"

import type { UserSession } from "../session/user-session.ts"
import type { QueryAgentToolResult, QueryAgentToolbox } from "./query-agent-toolbox.ts"

export class UserSessionQueryAgentToolbox implements QueryAgentToolbox {
	constructor(private readonly session: UserSession) {}

	async listSources(): Promise<QueryAgentToolResult> {
		const feed = await this.session.feed()
		const context = this.session.engine.currentContext()
		const contextEntries = context.entries()
		const actions = await this.session.listActions()

		const feedCounts = countBy(feed.items.map((item) => item.sourceId))
		const contextCounts = countBy(
			contextEntries
				.map((entry) => entry.key[0])
				.filter((part): part is string => typeof part === "string"),
		)
		const errors = groupErrorsBySource(
			feed.errors.map((error) => ({
				sourceId: error.sourceId,
				message: error.error.message,
			})),
		)
		const actionEntries = new Map(actions.map((entry) => [entry.sourceId, entry.actions]))
		const sourceIds = new Set<string>([
			...actionEntries.keys(),
			...feedCounts.keys(),
			...contextCounts.keys(),
			...errors.keys(),
		])

		return toolResult({
			time: context.time.toISOString(),
			sources: [...sourceIds].sort().map((sourceId) => {
				const sourceActions = actionEntries.get(sourceId) ?? {}
				const feedItemCount = feedCounts.get(sourceId) ?? 0
				const contextEntryCount = contextCounts.get(sourceId) ?? 0

				return {
					sourceId,
					hasFeedItems: feedItemCount > 0,
					feedItemCount,
					hasContext: contextEntryCount > 0,
					contextEntryCount,
					actions: Object.values(sourceActions).map((action) => ({
						id: action.id,
						description: action.description ?? null,
					})),
					errors: errors.get(sourceId) ?? [],
				}
			}),
		})
	}

	async getContext(
		key: ContextKeyPart[],
		match: "exact" | "prefix",
	): Promise<QueryAgentToolResult> {
		await this.session.feed()
		const context = this.session.engine.currentContext()
		const keyObject = contextKey(...key)

		if (match === "exact") {
			const value = context.get(keyObject)
			return toolResult({
				time: context.time.toISOString(),
				match,
				key,
				found: value !== undefined,
				value: value ?? null,
			})
		}

		const entries = context.find(keyObject)
		return toolResult({
			time: context.time.toISOString(),
			match,
			key,
			count: entries.length,
			entries,
		})
	}

	async getFeedItem(feedItemId: string): Promise<QueryAgentToolResult> {
		const feed = await this.session.feed()
		const context = this.session.engine.currentContext()
		const item = feed.items.find((candidate) => candidate.id === feedItemId)

		if (!item) {
			return toolResult({
				time: context.time.toISOString(),
				feedItemId,
				found: false,
				item: null,
			})
		}

		const sourceActions = this.session.hasSource(item.sourceId)
			? await this.session.engine.listActions(item.sourceId)
			: {}
		const errors = feed.errors
			.filter((error) => error.sourceId === item.sourceId)
			.map((error) => ({
				sourceId: error.sourceId,
				message: error.error.message,
			}))

		return toolResult({
			time: context.time.toISOString(),
			feedItemId,
			found: true,
			item,
			source: {
				sourceId: item.sourceId,
				hasSource: this.session.hasSource(item.sourceId),
				context: context.entries().filter((entry) => entry.key[0] === item.sourceId),
				actions: Object.values(sourceActions).map((action) => ({
					id: action.id,
					description: action.description ?? null,
				})),
				errors,
			},
		})
	}

	async queryContext(question: string, feedItemId?: string): Promise<QueryAgentToolResult> {
		const feed = await this.session.feed()
		const context = this.session.engine.currentContext()
		const selectedItem = feedItemId ? feed.items.find((item) => item.id === feedItemId) : undefined
		const actions = await this.session.listActions()

		return toolResult({
			time: context.time.toISOString(),
			question,
			feedItemId: feedItemId ?? null,
			selectedItem: selectedItem ?? null,
			items: feed.items,
			context: context.entries(),
			availableActions: actions.map((entry) => ({
				sourceId: entry.sourceId,
				actions: Object.values(entry.actions).map((action) => ({
					id: action.id,
					description: action.description ?? null,
				})),
			})),
			errors: feed.errors.map((error) => ({
				sourceId: error.sourceId,
				message: error.error.message,
			})),
		})
	}

	async listContext(): Promise<QueryAgentToolResult> {
		await this.session.feed()
		const context = this.session.engine.currentContext()
		const entries = context.entries()

		return toolResult({
			time: context.time.toISOString(),
			count: entries.length,
			entries,
		})
	}

	async getSourceData(sourceId: string, feedItemId?: string): Promise<QueryAgentToolResult> {
		const feed = await this.session.feed()
		const context = this.session.engine.currentContext()
		const sourceActions = this.session.hasSource(sourceId)
			? await this.session.engine.listActions(sourceId)
			: {}

		const items = feed.items.filter((item) => item.sourceId === sourceId)
		const selectedItem = feedItemId ? items.find((item) => item.id === feedItemId) : undefined
		const contextEntries = context.entries().filter((entry) => entry.key[0] === sourceId)
		const errors = feed.errors
			.filter((error) => error.sourceId === sourceId)
			.map((error) => ({
				sourceId: error.sourceId,
				message: error.error.message,
			}))

		return toolResult({
			time: context.time.toISOString(),
			sourceId,
			hasSource: this.session.hasSource(sourceId),
			feedItemId: feedItemId ?? null,
			selectedItem: selectedItem ?? null,
			items,
			context: contextEntries,
			actions: Object.values(sourceActions).map((action) => ({
				id: action.id,
				description: action.description ?? null,
			})),
			errors,
		})
	}

	async executeAction(
		sourceId: string,
		actionId: string,
		params?: unknown,
	): Promise<QueryAgentToolResult> {
		const result = await this.session.engine.executeAction(sourceId, actionId, params)
		const actionExecution = {
			sourceId,
			actionId,
			result: result ?? null,
		}

		return toolResult(
			{
				ok: true,
				...actionExecution,
			},
			{ actionExecution },
		)
	}
}

function toolResult(result: unknown, details: Record<string, unknown> = {}): QueryAgentToolResult {
	return {
		content: [
			{
				type: "text" as const,
				text: JSON.stringify(result),
			},
		],
		details,
	}
}

function countBy(values: string[]): Map<string, number> {
	const result = new Map<string, number>()
	for (const value of values) {
		result.set(value, (result.get(value) ?? 0) + 1)
	}
	return result
}

function groupErrorsBySource(
	errors: Array<{ sourceId: string; message: string }>,
): Map<string, Array<{ sourceId: string; message: string }>> {
	const result = new Map<string, Array<{ sourceId: string; message: string }>>()
	for (const error of errors) {
		const group = result.get(error.sourceId) ?? []
		group.push(error)
		result.set(error.sourceId, group)
	}
	return result
}
