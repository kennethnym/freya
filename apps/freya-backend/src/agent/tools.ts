import { defineTool } from "@earendil-works/pi-coding-agent"
import { Type } from "typebox"

import type { UserSessionManager } from "../session/index.ts"
import type { QueryDebugTools } from "./debug-tools.ts"
import type { ProposedAction } from "./query-agent.ts"

import { createQueryDebugTools } from "./debug-tools.ts"

interface CreateFreyaAgentToolsConfig {
	userId: string
	sessionManager: UserSessionManager
	clock: () => Date
	proposeAction(action: ProposedAction): void
}

export const FREYA_QUERY_CONTEXT_TOOL = "freya_query_context"
export const FREYA_LIST_SOURCES_TOOL = "freya_list_sources"
export const FREYA_GET_CONTEXT_TOOL = "freya_get_context"
export const FREYA_LIST_CONTEXT_TOOL = "freya_list_context"
export const FREYA_GET_SOURCE_DATA_TOOL = "freya_get_source_data"
export const FREYA_GET_FEED_ITEM_TOOL = "freya_get_feed_item"
export const FREYA_PROPOSE_ACTION_TOOL = "freya_propose_action"

export const FREYA_AGENT_TOOL_NAMES = [
	FREYA_LIST_SOURCES_TOOL,
	FREYA_GET_CONTEXT_TOOL,
	FREYA_GET_FEED_ITEM_TOOL,
	FREYA_QUERY_CONTEXT_TOOL,
	FREYA_LIST_CONTEXT_TOOL,
	FREYA_GET_SOURCE_DATA_TOOL,
	FREYA_PROPOSE_ACTION_TOOL,
]

export function createFreyaAgentTools(config: CreateFreyaAgentToolsConfig) {
	const { userId } = config
	const debugTools = createQueryDebugTools(config.sessionManager)

	const listSourcesTool = defineTool({
		name: FREYA_LIST_SOURCES_TOOL,
		label: "List FREYA Sources",
		description:
			"List enabled FREYA source IDs and summarize available feed items, context entries, actions, and errors.",
		parameters: Type.Object({}),
		execute: async () => executeDebugTool(debugTools, userId, FREYA_LIST_SOURCES_TOOL, {}),
	})

	const getContextTool = defineTool({
		name: FREYA_GET_CONTEXT_TOOL,
		label: "Get FREYA Context",
		description:
			"Read specific FREYA context entries by key. Use prefix matching to discover entries under a source ID, or exact matching when you know the full key.",
		parameters: Type.Object({
			key: Type.Array(Type.Unknown(), {
				description:
					'Context key array, for example ["freya.location"] or ["freya.location", "location"].',
			}),
			match: Type.Optional(
				Type.Union([Type.Literal("exact"), Type.Literal("prefix")], {
					description: "Match mode. Defaults to prefix.",
				}),
			),
		}),
		execute: async (_toolCallId, params) =>
			executeDebugTool(debugTools, userId, FREYA_GET_CONTEXT_TOOL, params),
	})

	const getFeedItemTool = defineTool({
		name: FREYA_GET_FEED_ITEM_TOOL,
		label: "Get FREYA Feed Item",
		description: "Read one feed item by ID, including related source context, actions, and errors.",
		parameters: Type.Object({
			feedItemId: Type.String({ description: "Feed item ID to inspect." }),
		}),
		execute: async (_toolCallId, params) =>
			executeDebugTool(debugTools, userId, FREYA_GET_FEED_ITEM_TOOL, params),
	})

	const queryContextTool = defineTool({
		name: FREYA_QUERY_CONTEXT_TOOL,
		label: "Query FREYA Context",
		description:
			"Read the user's current FREYA feed, source graph context, source errors, and available actions.",
		parameters: Type.Object({
			question: Type.String({
				description: "The specific personal-context question to answer.",
			}),
			feedItemId: Type.Optional(
				Type.String({
					description: "Optional feed item ID when the user is asking about a specific card.",
				}),
			),
		}),
		execute: async (_toolCallId, params) => executeQueryContextTool(config, params),
	})

	const listContextTool = defineTool({
		name: FREYA_LIST_CONTEXT_TOOL,
		label: "List FREYA Context",
		description:
			"List all current FREYA context graph entries for the user. Use this to inspect what personal context is available.",
		parameters: Type.Object({}),
		execute: async () => executeListContextTool(config),
	})

	const getSourceDataTool = defineTool({
		name: FREYA_GET_SOURCE_DATA_TOOL,
		label: "Get FREYA Source Data",
		description:
			"Get current feed items, context entries, actions, and errors for a specific FREYA source ID.",
		parameters: Type.Object({
			sourceId: Type.String({
				description: "Source ID, for example freya.location, freya.tfl, or freya.weather.",
			}),
			feedItemId: Type.Optional(
				Type.String({
					description: "Optional feed item ID to select one item from the source.",
				}),
			),
		}),
		execute: async (_toolCallId, params) => executeGetSourceDataTool(config, params),
	})

	const proposeActionTool = defineTool({
		name: FREYA_PROPOSE_ACTION_TOOL,
		label: "Propose FREYA Action",
		description: "Create a proposed action for the user to review. This never executes the action.",
		parameters: Type.Object({
			title: Type.String({ description: "Short user-facing action title." }),
			description: Type.String({
				description: "What will happen if the user confirms this action.",
			}),
			sourceId: Type.Optional(
				Type.String({ description: "Source ID that should execute the action, if known." }),
			),
			actionId: Type.Optional(
				Type.String({ description: "Source action ID to execute after confirmation, if known." }),
			),
			params: Type.Optional(
				Type.Unknown({
					description: "Parameters to pass to the source action after confirmation.",
				}),
			),
		}),
		execute: async (_toolCallId, params) => executeProposeActionTool(config, params),
	})

	return [
		listSourcesTool,
		getContextTool,
		getFeedItemTool,
		queryContextTool,
		listContextTool,
		getSourceDataTool,
		proposeActionTool,
	]
}

async function executeDebugTool(
	debugTools: QueryDebugTools,
	userId: string,
	toolName: string,
	params: unknown,
) {
	const result = await debugTools.execute(userId, toolName, params)

	return {
		content: [
			{
				type: "text" as const,
				text: JSON.stringify(result),
			},
		],
		details: {},
	}
}

async function executeQueryContextTool(
	config: CreateFreyaAgentToolsConfig,
	params: { question: string; feedItemId?: string },
) {
	const userSession = await config.sessionManager.getOrCreate(config.userId)
	const feed = await userSession.feed()
	const context = userSession.engine.currentContext()
	const feedItemId = params.feedItemId
	const selectedItem =
		typeof feedItemId === "string" ? feed.items.find((item) => item.id === feedItemId) : undefined
	const actions = await userSession.listActions()

	return {
		content: [
			{
				type: "text" as const,
				text: JSON.stringify({
					time: context.time.toISOString(),
					question: params.question,
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
				}),
			},
		],
		details: {},
	}
}

async function executeListContextTool(config: CreateFreyaAgentToolsConfig) {
	const userSession = await config.sessionManager.getOrCreate(config.userId)
	await userSession.feed()
	const context = userSession.engine.currentContext()
	const entries = context.entries()

	return {
		content: [
			{
				type: "text" as const,
				text: JSON.stringify({
					time: context.time.toISOString(),
					count: entries.length,
					entries,
				}),
			},
		],
		details: {},
	}
}

async function executeGetSourceDataTool(
	config: CreateFreyaAgentToolsConfig,
	params: { sourceId: string; feedItemId?: string },
) {
	const userSession = await config.sessionManager.getOrCreate(config.userId)
	const feed = await userSession.feed()
	const context = userSession.engine.currentContext()
	const sourceActions = userSession.hasSource(params.sourceId)
		? await userSession.engine.listActions(params.sourceId)
		: {}

	const items = feed.items.filter((item) => item.sourceId === params.sourceId)
	const selectedItem =
		params.feedItemId !== undefined
			? items.find((item) => item.id === params.feedItemId)
			: undefined
	const contextEntries = context.entries().filter((entry) => entry.key[0] === params.sourceId)
	const errors = feed.errors
		.filter((error) => error.sourceId === params.sourceId)
		.map((error) => ({
			sourceId: error.sourceId,
			message: error.error.message,
		}))

	return {
		content: [
			{
				type: "text" as const,
				text: JSON.stringify({
					time: context.time.toISOString(),
					sourceId: params.sourceId,
					hasSource: userSession.hasSource(params.sourceId),
					feedItemId: params.feedItemId ?? null,
					selectedItem: selectedItem ?? null,
					items,
					context: contextEntries,
					actions: Object.values(sourceActions).map((action) => ({
						id: action.id,
						description: action.description ?? null,
					})),
					errors,
				}),
			},
		],
		details: {},
	}
}

function executeProposeActionTool(
	config: CreateFreyaAgentToolsConfig,
	params: {
		title: string
		description: string
		sourceId?: string
		actionId?: string
		params?: unknown
	},
) {
	const action: ProposedAction = {
		id: crypto.randomUUID(),
		title: params.title,
		description: params.description,
		requiresConfirmation: true,
		createdAt: config.clock().toISOString(),
		...(params.sourceId ? { sourceId: params.sourceId } : {}),
		...(params.actionId ? { actionId: params.actionId } : {}),
		...(params.params !== undefined ? { params: params.params } : {}),
	}

	config.proposeAction(action)

	return {
		content: [
			{
				type: "text" as const,
				text: JSON.stringify({
					ok: true,
					proposedActionId: action.id,
					requiresConfirmation: true,
				}),
			},
		],
		details: { proposedAction: action },
	}
}
