import { contextKey, type ContextKeyPart } from "@freya/core"

import type { UserSessionManager } from "../session/index.ts"
import type { ProposedAction } from "./query-agent.ts"

type ToolParams = Record<string, unknown>

export interface QueryDebugToolDefinition {
	name: string
	label: string
	description: string
	parameters: unknown
}

export interface QueryDebugTools {
	list(): QueryDebugToolDefinition[]
	execute(userId: string, toolName: string, params: unknown): Promise<unknown>
}

const FreyaQueryContextTool = "freya_query_context"
const FreyaListSourcesTool = "freya_list_sources"
const FreyaGetContextTool = "freya_get_context"
const FreyaListContextTool = "freya_list_context"
const FreyaGetSourceDataTool = "freya_get_source_data"
const FreyaGetFeedItemTool = "freya_get_feed_item"
const FreyaProposeActionTool = "freya_propose_action"

export function createQueryDebugTools(sessionManager: UserSessionManager): QueryDebugTools {
	return new DefaultQueryDebugTools(sessionManager)
}

class DefaultQueryDebugTools implements QueryDebugTools {
	constructor(private readonly sessionManager: UserSessionManager) {}

	list(): QueryDebugToolDefinition[] {
		return [
			{
				name: FreyaListSourcesTool,
				label: "List FREYA Sources",
				description:
					"List enabled source IDs and summarize available feed items, context entries, actions, and errors.",
				parameters: {},
			},
			{
				name: FreyaGetContextTool,
				label: "Get FREYA Context",
				description: "Read specific FREYA context entries by key with exact or prefix matching.",
				parameters: {
					key: "ContextKeyPart[]",
					match: '"exact" | "prefix"?',
				},
			},
			{
				name: FreyaGetFeedItemTool,
				label: "Get FREYA Feed Item",
				description:
					"Read one feed item by ID, including related source context, actions, and errors.",
				parameters: {
					feedItemId: "string",
				},
			},
			{
				name: FreyaQueryContextTool,
				label: "Query FREYA Context",
				description:
					"Read the user's current FREYA feed, source graph context, source errors, and available actions.",
				parameters: {
					question: "string",
					feedItemId: "string?",
				},
			},
			{
				name: FreyaListContextTool,
				label: "List FREYA Context",
				description: "List all current FREYA context graph entries for the user.",
				parameters: {},
			},
			{
				name: FreyaGetSourceDataTool,
				label: "Get FREYA Source Data",
				description:
					"Get current feed items, context entries, actions, and errors for a specific FREYA source ID.",
				parameters: {
					sourceId: "string",
					feedItemId: "string?",
				},
			},
			{
				name: FreyaProposeActionTool,
				label: "Propose FREYA Action",
				description: "Create a proposed action object without executing it.",
				parameters: {
					title: "string",
					description: "string",
					sourceId: "string?",
					actionId: "string?",
					params: "unknown?",
				},
			},
		]
	}

	async execute(userId: string, toolName: string, params: unknown): Promise<unknown> {
		switch (toolName) {
			case FreyaListSourcesTool:
				return this.listSources(userId)
			case FreyaGetContextTool:
				return this.getContext(userId, expectToolParams(params, ["key"]))
			case FreyaGetFeedItemTool:
				return this.getFeedItem(userId, expectToolParams(params, ["feedItemId"]))
			case FreyaQueryContextTool:
				return this.queryContext(userId, expectToolParams(params, ["question"]))
			case FreyaListContextTool:
				return this.listContext(userId)
			case FreyaGetSourceDataTool:
				return this.getSourceData(userId, expectToolParams(params, ["sourceId"]))
			case FreyaProposeActionTool:
				return proposeAction(expectToolParams(params, ["title", "description"]))
			default:
				throw new Error(`Unknown debug tool: ${toolName}`)
		}
	}

	private async listSources(userId: string): Promise<unknown> {
		const userSession = await this.sessionManager.getOrCreate(userId)
		const feed = await userSession.feed()
		const context = userSession.engine.currentContext()
		const contextEntries = context.entries()
		const actions = await userSession.listActions()

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

		return {
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
		}
	}

	private async getContext(userId: string, params: ToolParams): Promise<unknown> {
		const key = expectContextKey(params, "key")
		const match = optionalMatch(params, "match") ?? "prefix"
		const userSession = await this.sessionManager.getOrCreate(userId)
		await userSession.feed()
		const context = userSession.engine.currentContext()
		const keyObject = contextKey(...key)

		if (match === "exact") {
			const value = context.get(keyObject)
			return {
				time: context.time.toISOString(),
				match,
				key,
				found: value !== undefined,
				value: value ?? null,
			}
		}

		const entries = context.find(keyObject)
		return {
			time: context.time.toISOString(),
			match,
			key,
			count: entries.length,
			entries,
		}
	}

	private async getFeedItem(userId: string, params: ToolParams): Promise<unknown> {
		const feedItemId = expectString(params, "feedItemId")
		const userSession = await this.sessionManager.getOrCreate(userId)
		const feed = await userSession.feed()
		const context = userSession.engine.currentContext()
		const item = feed.items.find((candidate) => candidate.id === feedItemId)

		if (!item) {
			return {
				time: context.time.toISOString(),
				feedItemId,
				found: false,
				item: null,
			}
		}

		const sourceActions = userSession.hasSource(item.sourceId)
			? await userSession.engine.listActions(item.sourceId)
			: {}
		const errors = feed.errors
			.filter((error) => error.sourceId === item.sourceId)
			.map((error) => ({
				sourceId: error.sourceId,
				message: error.error.message,
			}))

		return {
			time: context.time.toISOString(),
			feedItemId,
			found: true,
			item,
			source: {
				sourceId: item.sourceId,
				hasSource: userSession.hasSource(item.sourceId),
				context: context.entries().filter((entry) => entry.key[0] === item.sourceId),
				actions: Object.values(sourceActions).map((action) => ({
					id: action.id,
					description: action.description ?? null,
				})),
				errors,
			},
		}
	}

	private async queryContext(userId: string, params: ToolParams): Promise<unknown> {
		const question = expectString(params, "question")
		const feedItemId = optionalString(params, "feedItemId")
		const userSession = await this.sessionManager.getOrCreate(userId)
		const feed = await userSession.feed()
		const context = userSession.engine.currentContext()
		const selectedItem = feedItemId ? feed.items.find((item) => item.id === feedItemId) : undefined
		const actions = await userSession.listActions()

		return {
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
		}
	}

	private async listContext(userId: string): Promise<unknown> {
		const userSession = await this.sessionManager.getOrCreate(userId)
		await userSession.feed()
		const context = userSession.engine.currentContext()
		const entries = context.entries()

		return {
			time: context.time.toISOString(),
			count: entries.length,
			entries,
		}
	}

	private async getSourceData(userId: string, params: ToolParams): Promise<unknown> {
		const sourceId = expectString(params, "sourceId")
		const feedItemId = optionalString(params, "feedItemId")
		const userSession = await this.sessionManager.getOrCreate(userId)
		const feed = await userSession.feed()
		const context = userSession.engine.currentContext()
		const sourceActions = userSession.hasSource(sourceId)
			? await userSession.engine.listActions(sourceId)
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

		return {
			time: context.time.toISOString(),
			sourceId,
			hasSource: userSession.hasSource(sourceId),
			feedItemId: feedItemId ?? null,
			selectedItem: selectedItem ?? null,
			items,
			context: contextEntries,
			actions: Object.values(sourceActions).map((action) => ({
				id: action.id,
				description: action.description ?? null,
			})),
			errors,
		}
	}
}

function proposeAction(params: ToolParams): unknown {
	const sourceId = optionalString(params, "sourceId")
	const actionId = optionalString(params, "actionId")
	const action: ProposedAction = {
		id: crypto.randomUUID(),
		title: expectString(params, "title"),
		description: expectString(params, "description"),
		requiresConfirmation: true,
		createdAt: new Date().toISOString(),
		...(sourceId ? { sourceId } : {}),
		...(actionId ? { actionId } : {}),
		...("params" in params ? { params: params.params } : {}),
	}

	return {
		ok: true,
		proposedActionId: action.id,
		requiresConfirmation: true,
		proposedAction: action,
	}
}

function expectToolParams(value: unknown, requiredKeys: string[]): ToolParams {
	if (!isRecord(value)) {
		throw new Error("Tool params must be a JSON object")
	}

	for (const key of requiredKeys) {
		if (!(key in value)) {
			throw new Error(`Missing required param: ${key}`)
		}
	}

	return value
}

function expectString(params: ToolParams, key: string): string {
	const value = params[key]
	if (typeof value !== "string" || value.length === 0) {
		throw new Error(`Param "${key}" must be a non-empty string`)
	}
	return value
}

function optionalString(params: ToolParams, key: string): string | undefined {
	const value = params[key]
	if (value === undefined) return undefined
	if (typeof value !== "string") {
		throw new Error(`Param "${key}" must be a string`)
	}
	return value
}

function expectContextKey(params: ToolParams, key: string): ContextKeyPart[] {
	const value = params[key]
	if (!Array.isArray(value) || value.length === 0) {
		throw new Error(`Param "${key}" must be a non-empty array`)
	}
	if (!value.every(isContextKeyPart)) {
		throw new Error(`Param "${key}" contains an invalid context key part`)
	}
	return value
}

function optionalMatch(params: ToolParams, key: string): "exact" | "prefix" | undefined {
	const value = params[key]
	if (value === undefined) return undefined
	if (value !== "exact" && value !== "prefix") {
		throw new Error(`Param "${key}" must be "exact" or "prefix"`)
	}
	return value
}

function isContextKeyPart(value: unknown): value is ContextKeyPart {
	if (typeof value === "string" || typeof value === "number") return true
	if (!isRecord(value)) return false
	return Object.values(value).every(
		(part) => typeof part === "string" || typeof part === "number" || typeof part === "boolean",
	)
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

function isRecord(value: unknown): value is ToolParams {
	return typeof value === "object" && value !== null && !Array.isArray(value)
}
