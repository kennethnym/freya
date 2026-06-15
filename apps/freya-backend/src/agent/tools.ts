import { defineTool } from "@earendil-works/pi-coding-agent"
import { type } from "arktype"
import { Type } from "typebox"

import type { QueryAgentToolbox } from "./query-agent-toolbox.ts"

interface CreateFreyaAgentToolsConfig {
	toolbox: QueryAgentToolbox
}

export const FREYA_QUERY_CONTEXT_TOOL = "freya_query_context"
export const FREYA_LIST_SOURCES_TOOL = "freya_list_sources"
export const FREYA_GET_CONTEXT_TOOL = "freya_get_context"
export const FREYA_LIST_CONTEXT_TOOL = "freya_list_context"
export const FREYA_GET_SOURCE_DATA_TOOL = "freya_get_source_data"
export const FREYA_GET_FEED_ITEM_TOOL = "freya_get_feed_item"
export const FREYA_EXECUTE_ACTION_TOOL = "freya_execute_action"

const ContextKeyObjectPart = type("Record<string, string | number | boolean>").narrow(
	(value) => !Array.isArray(value),
)
const ContextKeyPart = type("string | number").or(ContextKeyObjectPart)

const GetContextToolParams = type({
	"+": "reject",
	key: ContextKeyPart.array().atLeastLength(1),
	"match?": "'exact' | 'prefix'",
})

const GetFeedItemToolParams = type({
	"+": "reject",
	feedItemId: type.string.atLeastLength(1),
})

const QueryContextToolParams = type({
	"+": "reject",
	question: type.string.atLeastLength(1),
	"feedItemId?": "string",
})

const GetSourceDataToolParams = type({
	"+": "reject",
	sourceId: type.string.atLeastLength(1),
	"feedItemId?": "string",
})

const ExecuteActionToolParams = type({
	"+": "reject",
	sourceId: type.string.atLeastLength(1),
	actionId: type.string.atLeastLength(1),
	"params?": "unknown",
})

export const FREYA_AGENT_TOOL_NAMES = [
	FREYA_LIST_SOURCES_TOOL,
	FREYA_GET_CONTEXT_TOOL,
	FREYA_GET_FEED_ITEM_TOOL,
	FREYA_QUERY_CONTEXT_TOOL,
	FREYA_LIST_CONTEXT_TOOL,
	FREYA_GET_SOURCE_DATA_TOOL,
	FREYA_EXECUTE_ACTION_TOOL,
]

export function createFreyaAgentTools(config: CreateFreyaAgentToolsConfig) {
	const listSourcesTool = defineTool({
		name: FREYA_LIST_SOURCES_TOOL,
		label: "List FREYA Sources",
		description:
			"List enabled FREYA source IDs and summarize available feed items, context entries, actions, and errors.",
		parameters: Type.Object({}, { additionalProperties: false }),
		execute: async () => executeListSourcesTool(config.toolbox),
	})

	const getContextTool = defineTool({
		name: FREYA_GET_CONTEXT_TOOL,
		label: "Get FREYA Context",
		description:
			"Read specific FREYA context entries by key. Use prefix matching to discover entries under a source ID, or exact matching when you know the full key.",
		parameters: Type.Object(
			{
				key: Type.Array(Type.Unknown(), {
					description:
						'Context key array, for example ["freya.location"] or ["freya.location", "location"].',
				}),
				match: Type.Optional(
					Type.Union([Type.Literal("exact"), Type.Literal("prefix")], {
						description: "Match mode. Defaults to prefix.",
					}),
				),
			},
			{ additionalProperties: false },
		),
		execute: async (_toolCallId, params) => executeGetContextTool(config.toolbox, params),
	})

	const getFeedItemTool = defineTool({
		name: FREYA_GET_FEED_ITEM_TOOL,
		label: "Get FREYA Feed Item",
		description: "Read one feed item by ID, including related source context, actions, and errors.",
		parameters: Type.Object(
			{
				feedItemId: Type.String({ description: "Feed item ID to inspect." }),
			},
			{ additionalProperties: false },
		),
		execute: async (_toolCallId, params) => executeGetFeedItemTool(config.toolbox, params),
	})

	const queryContextTool = defineTool({
		name: FREYA_QUERY_CONTEXT_TOOL,
		label: "Query FREYA Context",
		description:
			"Read the user's current FREYA feed, source graph context, source errors, and available actions.",
		parameters: Type.Object(
			{
				question: Type.String({
					description: "The specific personal-context question to answer.",
				}),
				feedItemId: Type.Optional(
					Type.String({
						description: "Optional feed item ID when the user is asking about a specific card.",
					}),
				),
			},
			{ additionalProperties: false },
		),
		execute: async (_toolCallId, params) => executeQueryContextTool(config.toolbox, params),
	})

	const listContextTool = defineTool({
		name: FREYA_LIST_CONTEXT_TOOL,
		label: "List FREYA Context",
		description:
			"List all current FREYA context graph entries for the user. Use this to inspect what personal context is available.",
		parameters: Type.Object({}, { additionalProperties: false }),
		execute: async () => executeListContextTool(config.toolbox),
	})

	const getSourceDataTool = defineTool({
		name: FREYA_GET_SOURCE_DATA_TOOL,
		label: "Get FREYA Source Data",
		description:
			"Get current feed items, context entries, actions, and errors for a specific FREYA source ID.",
		parameters: Type.Object(
			{
				sourceId: Type.String({
					description: "Source ID, for example freya.location, freya.tfl, or freya.weather.",
				}),
				feedItemId: Type.Optional(
					Type.String({
						description: "Optional feed item ID to select one item from the source.",
					}),
				),
			},
			{ additionalProperties: false },
		),
		execute: async (_toolCallId, params) => executeGetSourceDataTool(config.toolbox, params),
	})

	const executeActionTool = defineTool({
		name: FREYA_EXECUTE_ACTION_TOOL,
		label: "Execute FREYA Action",
		description:
			"Execute an available FREYA source action immediately without creating a proposal.",
		parameters: Type.Object(
			{
				sourceId: Type.String({ description: "Source ID that should execute the action." }),
				actionId: Type.String({ description: "Source action ID to execute." }),
				params: Type.Optional(
					Type.Unknown({
						description: "Parameters to pass to the source action.",
					}),
				),
			},
			{ additionalProperties: false },
		),
		execute: async (_toolCallId, params) => executeActionToolCall(config.toolbox, params),
	})

	return [
		listSourcesTool,
		getContextTool,
		getFeedItemTool,
		queryContextTool,
		listContextTool,
		getSourceDataTool,
		executeActionTool,
	]
}

async function executeListSourcesTool(toolbox: QueryAgentToolbox) {
	return toolbox.listSources()
}

async function executeGetContextTool(toolbox: QueryAgentToolbox, rawParams: unknown) {
	const params = GetContextToolParams(rawParams)
	if (params instanceof type.errors) {
		throw new Error(params.summary)
	}

	const match = params.match ?? "prefix"

	return toolbox.getContext(params.key, match)
}

async function executeGetFeedItemTool(toolbox: QueryAgentToolbox, rawParams: unknown) {
	const params = GetFeedItemToolParams(rawParams)
	if (params instanceof type.errors) {
		throw new Error(params.summary)
	}

	return toolbox.getFeedItem(params.feedItemId)
}

async function executeQueryContextTool(toolbox: QueryAgentToolbox, rawParams: unknown) {
	const params = QueryContextToolParams(rawParams)
	if (params instanceof type.errors) {
		throw new Error(params.summary)
	}

	return toolbox.queryContext(params.question, params.feedItemId)
}

async function executeListContextTool(toolbox: QueryAgentToolbox) {
	return toolbox.listContext()
}

async function executeGetSourceDataTool(toolbox: QueryAgentToolbox, rawParams: unknown) {
	const params = GetSourceDataToolParams(rawParams)
	if (params instanceof type.errors) {
		throw new Error(params.summary)
	}

	return toolbox.getSourceData(params.sourceId, params.feedItemId)
}

async function executeActionToolCall(toolbox: QueryAgentToolbox, rawParams: unknown) {
	const params = ExecuteActionToolParams(rawParams)
	if (params instanceof type.errors) {
		throw new Error(params.summary)
	}

	return toolbox.executeAction(params.sourceId, params.actionId, params.params)
}
