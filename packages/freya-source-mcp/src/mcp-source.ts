import type {
	ActionDefinition,
	ContextEntry,
	ContextKey,
	FeedItem,
	FeedItemSignals,
	FeedSource,
	Slot,
} from "@freya/core"

import { Context, UnknownActionError } from "@freya/core"

import {
	StreamableHttpMcpClient,
	type McpCallToolResult,
	type McpClient,
	type McpHttpHeaders,
	type McpResourceContent,
	type McpTool,
	type McpToolContent,
	type StreamableHttpMcpClientOptions,
} from "./mcp-client"

export type McpFeedItem = FeedItem<string, Record<string, unknown>>

/**
 * Configuration for an MCP-backed `FeedSource`.
 *
 * The source is intentionally projection-based: remote MCP resources/tools are
 * only exposed to Freya when listed here as context entries, feed items, or
 * allowlisted actions.
 */
export interface McpSourceOptions {
	/** Stable Freya source identifier, for example `freya.github` or `freya.discord`. */
	readonly id: string
	/** Streamable HTTP MCP endpoint. Required unless `client` or `clientFactory` is provided. */
	readonly url?: string | URL
	/** Client name advertised during MCP initialization. */
	readonly clientName?: string
	/** Client version advertised during MCP initialization. */
	readonly clientVersion?: string
	/** Default timeout, in milliseconds, for MCP connection and request calls. */
	readonly timeoutMs?: number
	/** Static or lazily-resolved HTTP headers for the MCP transport. */
	readonly headers?: McpHttpHeaders | (() => Promise<McpHttpHeaders>)
	/** Additional `fetch` options merged into the MCP transport request init. */
	readonly requestInit?: RequestInit
	/** Additional transport options forwarded to the MCP SDK streamable HTTP transport. */
	readonly transportOptions?: StreamableHttpMcpClientOptions["transportOptions"]
	/** Preconfigured MCP client, primarily useful for tests or custom transports. */
	readonly client?: McpClient
	/** Lazy MCP client factory, useful when client construction depends on runtime state. */
	readonly clientFactory?: () => McpClient | Promise<McpClient>
	/** Freya source dependencies used by the context graph scheduler. */
	readonly dependencies?: readonly string[]
	/** MCP resources to read and write into Freya context keys. */
	readonly resources?: readonly McpContextResource[]
	/** MCP tools to call and write into Freya context keys. */
	readonly contextTools?: readonly McpContextTool[]
	/** MCP resources or tools to project into feed items. */
	readonly feedItems?: readonly McpFeedItemMapping[]
	/** Freya action IDs mapped to explicit, allowlisted MCP tools. */
	readonly actions?: Record<string, McpActionMapping>
}

export interface McpContextResource<T = unknown> {
	readonly uri: string
	readonly contextKey: ContextKey<T>
	readonly map?: (contents: readonly McpResourceContent[], context: Context) => T | null
}

export type McpToolArguments =
	| Record<string, unknown>
	| ((context: Context) => Record<string, unknown>)

export interface McpContextTool<T = unknown> {
	readonly tool: string
	readonly arguments?: McpToolArguments
	readonly contextKey: ContextKey<T>
	readonly map?: (result: McpCallToolResult, context: Context) => T | null
}

/**
 * Mapping from a Freya action ID to an MCP tool call.
 *
 * Only actions declared in `McpSourceOptions.actions` can be executed through
 * the source. The map is keyed by Freya action ID, while `tool` names the
 * remote MCP tool to call.
 */
export interface McpActionMapping {
	/** Remote MCP tool name to call when the Freya action is executed. */
	readonly tool: string
	/** Optional action description; falls back to the MCP tool description/title when omitted. */
	readonly description?: string
	/** Optional Standard Schema input validator exposed on the Freya action and checked locally. */
	readonly input?: ActionDefinition["input"]
	/** Static MCP arguments or a mapper from validated Freya action params to MCP arguments. */
	readonly arguments?: Record<string, unknown> | ((params: unknown) => Record<string, unknown>)
	/** Optional mapper from raw MCP tool result to the Freya action return value. */
	readonly mapResult?: (result: McpCallToolResult) => unknown
}

export type McpFeedItemMapping = McpResourceFeedItemMapping | McpToolFeedItemMapping

export type McpFeedPayload = McpResourceFeedPayload | McpToolFeedPayload

export interface McpFeedItemBaseMapping {
	readonly type: string
	readonly id?: string | ((payload: McpFeedPayload, context: Context) => string)
	readonly mapData?: (payload: McpFeedPayload, context: Context) => Record<string, unknown> | null
	readonly signals?:
		| FeedItemSignals
		| ((payload: McpFeedPayload, context: Context) => FeedItemSignals | undefined)
	readonly slots?:
		| Record<string, Slot>
		| ((payload: McpFeedPayload, context: Context) => Record<string, Slot>)
}

export interface McpResourceFeedItemMapping extends McpFeedItemBaseMapping {
	readonly kind: "resource"
	readonly uri: string
}

export interface McpToolFeedItemMapping extends McpFeedItemBaseMapping {
	readonly kind: "tool"
	readonly tool: string
	readonly arguments?: McpToolArguments
}

export interface McpResourceFeedPayload {
	readonly kind: "resource"
	readonly uri: string
	readonly contents: readonly McpResourceContent[]
	readonly value: unknown
}

export interface McpToolFeedPayload {
	readonly kind: "tool"
	readonly tool: string
	readonly result: McpCallToolResult
	readonly value: unknown
}

/**
 * FeedSource backed by a remote MCP server.
 *
 * The source intentionally uses explicit projections. A remote MCP server can
 * expose many resources and tools, but only configured resources/tools enter the
 * Freya context graph or action surface.
 */
export class McpSource implements FeedSource<McpFeedItem> {
	readonly id: string
	readonly dependencies: readonly string[] | undefined

	private clientPromise: Promise<McpClient> | null = null

	constructor(private readonly options: McpSourceOptions) {
		this.id = options.id
		this.dependencies = options.dependencies

		if (!options.client && !options.clientFactory && !options.url) {
			throw new Error("McpSource requires either a client, clientFactory, or remote url")
		}
	}

	async listActions(): Promise<Record<string, ActionDefinition>> {
		const actionMappings = this.options.actions
		if (!actionMappings) {
			return {}
		}

		const tools = await this.toolsByName()
		const actions: Record<string, ActionDefinition> = {}

		for (const [actionId, mapping] of Object.entries(actionMappings)) {
			const tool = tools.get(mapping.tool)
			if (!tool) {
				throw new Error(
					`Configured MCP action "${actionId}" maps to missing tool "${mapping.tool}"`,
				)
			}

			const description = mapping.description ?? tool.description ?? tool.title
			actions[actionId] = {
				id: actionId,
				...(description ? { description } : {}),
				...(mapping.input ? { input: mapping.input } : {}),
			}
		}

		return actions
	}

	async executeAction(actionId: string, params: unknown): Promise<unknown> {
		const mapping = this.options.actions?.[actionId]
		if (!mapping) {
			throw new UnknownActionError(actionId)
		}
		const validatedParams = await validateActionInput(actionId, params, mapping)

		const client = await this.client()
		const result = await client.callTool(
			{
				name: mapping.tool,
				arguments: resolveActionArguments(actionId, validatedParams, mapping),
			},
			this.requestOptions(),
		)

		if (result.isError) {
			throw new Error(`MCP tool "${mapping.tool}" returned an error: ${toolResultText(result)}`)
		}

		return mapping.mapResult ? mapping.mapResult(result) : toolResultValue(result)
	}

	async fetchContext(context: Context): Promise<readonly ContextEntry[] | null> {
		const resources = this.options.resources ?? []
		const contextTools = this.options.contextTools ?? []
		if (resources.length === 0 && contextTools.length === 0) {
			return null
		}

		const entries: ContextEntry[] = []
		const client = await this.client()

		for (const resource of resources) {
			const result = await client.readResource({ uri: resource.uri }, this.requestOptions())
			const value = resource.map
				? resource.map(result.contents, context)
				: resourceContentsValue(result.contents)

			if (value !== null) {
				entries.push([resource.contextKey, value])
			}
		}

		for (const tool of contextTools) {
			const result = await client.callTool(
				{
					name: tool.tool,
					arguments: resolveToolArguments(tool.arguments, context),
				},
				this.requestOptions(),
			)

			if (result.isError) {
				throw new Error(`MCP tool "${tool.tool}" returned an error: ${toolResultText(result)}`)
			}

			const value = tool.map ? tool.map(result, context) : toolResultValue(result)
			if (value !== null) {
				entries.push([tool.contextKey, value])
			}
		}

		return entries.length > 0 ? entries : null
	}

	async fetchItems(context: Context): Promise<McpFeedItem[]> {
		const mappings = this.options.feedItems ?? []
		if (mappings.length === 0) {
			return []
		}

		const client = await this.client()
		const items: McpFeedItem[] = []

		for (const mapping of mappings) {
			const payload = await this.fetchFeedPayload(client, mapping, context)
			const data = mapping.mapData
				? mapping.mapData(payload, context)
				: defaultFeedItemData(payload)

			if (data === null) {
				continue
			}

			items.push({
				id: resolveFeedItemId(this.id, mapping, payload, context),
				sourceId: this.id,
				type: mapping.type,
				timestamp: context.time,
				data,
				...resolveSignals(mapping, payload, context),
				...resolveSlots(mapping, payload, context),
			})
		}

		return items
	}

	async close(): Promise<void> {
		if (!this.clientPromise) return
		const client = await this.clientPromise
		this.clientPromise = null
		await client.close?.()
	}

	private async fetchFeedPayload(
		client: McpClient,
		mapping: McpFeedItemMapping,
		context: Context,
	): Promise<McpFeedPayload> {
		switch (mapping.kind) {
			case "resource": {
				const result = await client.readResource({ uri: mapping.uri }, this.requestOptions())
				return {
					kind: "resource",
					uri: mapping.uri,
					contents: result.contents,
					value: resourceContentsValue(result.contents),
				}
			}
			case "tool": {
				const result = await client.callTool(
					{
						name: mapping.tool,
						arguments: resolveToolArguments(mapping.arguments, context),
					},
					this.requestOptions(),
				)
				if (result.isError) {
					throw new Error(`MCP tool "${mapping.tool}" returned an error: ${toolResultText(result)}`)
				}
				return {
					kind: "tool",
					tool: mapping.tool,
					result,
					value: toolResultValue(result),
				}
			}
		}
	}

	private async toolsByName(): Promise<Map<string, McpTool>> {
		const client = await this.client()
		const tools = new Map<string, McpTool>()
		let cursor: string | undefined

		do {
			const result = await client.listTools(cursor ? { cursor } : undefined, this.requestOptions())
			for (const tool of result.tools) {
				tools.set(tool.name, tool)
			}
			cursor = result.nextCursor
		} while (cursor)

		return tools
	}

	private client(): Promise<McpClient> {
		if (!this.clientPromise) {
			this.clientPromise = this.createClient()
		}
		return this.clientPromise
	}

	private async createClient(): Promise<McpClient> {
		if (this.options.client) {
			return this.options.client
		}

		if (this.options.clientFactory) {
			return this.options.clientFactory()
		}

		return new StreamableHttpMcpClient({
			url: this.options.url!,
			name: this.options.clientName,
			version: this.options.clientVersion,
			timeoutMs: this.options.timeoutMs,
			headers: this.options.headers,
			requestInit: this.options.requestInit,
			transportOptions: this.options.transportOptions,
		})
	}

	private requestOptions(): { timeout?: number } | undefined {
		if (this.options.timeoutMs === undefined) {
			return undefined
		}
		return { timeout: this.options.timeoutMs }
	}
}

async function validateActionInput(
	actionId: string,
	params: unknown,
	mapping: McpActionMapping,
): Promise<unknown> {
	if (!mapping.input) {
		return params
	}

	const result = await mapping.input["~standard"].validate(params)
	if (result.issues) {
		throw new Error(
			`Invalid MCP action "${actionId}" params: ${formatStandardSchemaIssues(result.issues)}`,
		)
	}

	return result.value
}

function resolveToolArguments(
	args: McpToolArguments | undefined,
	context: Context,
): Record<string, unknown> {
	if (!args) return {}
	if (typeof args === "function") {
		return args(context)
	}
	return args
}

function resolveActionArguments(
	actionId: string,
	params: unknown,
	mapping: McpActionMapping,
): Record<string, unknown> {
	if (mapping.arguments) {
		if (typeof mapping.arguments === "function") {
			return mapping.arguments(params)
		}
		return mapping.arguments
	}

	if (params === undefined || params === null) {
		return {}
	}

	if (!isRecord(params)) {
		throw new Error(`MCP action "${actionId}" requires object params`)
	}

	return params
}

function resolveFeedItemId(
	sourceId: string,
	mapping: McpFeedItemMapping,
	payload: McpFeedPayload,
	context: Context,
): string {
	if (typeof mapping.id === "function") {
		return mapping.id(payload, context)
	}
	if (mapping.id) {
		return mapping.id
	}

	const identifier = payload.kind === "resource" ? payload.uri : payload.tool
	return `${sourceId}-${mapping.type}-${slug(identifier)}`
}

function resolveSignals(
	mapping: McpFeedItemMapping,
	payload: McpFeedPayload,
	context: Context,
): { signals?: FeedItemSignals } {
	if (!mapping.signals) return {}
	const signals =
		typeof mapping.signals === "function" ? mapping.signals(payload, context) : mapping.signals
	return signals ? { signals } : {}
}

function resolveSlots(
	mapping: McpFeedItemMapping,
	payload: McpFeedPayload,
	context: Context,
): { slots?: Record<string, Slot> } {
	if (!mapping.slots) return {}
	const slots =
		typeof mapping.slots === "function" ? mapping.slots(payload, context) : mapping.slots
	return { slots }
}

function defaultFeedItemData(payload: McpFeedPayload): Record<string, unknown> {
	switch (payload.kind) {
		case "resource":
			return {
				kind: "mcp-resource",
				uri: payload.uri,
				value: payload.value,
			}
		case "tool":
			return {
				kind: "mcp-tool",
				tool: payload.tool,
				value: payload.value,
			}
	}
}

function resourceContentsValue(contents: readonly McpResourceContent[]): unknown {
	const values = contents.map(resourceContentValue)
	if (values.length === 1) {
		return values[0]
	}
	return values
}

function resourceContentValue(content: McpResourceContent): unknown {
	if ("text" in content) {
		return parseTextValue(content.text, content.mimeType)
	}

	return {
		uri: content.uri,
		...(content.mimeType ? { mimeType: content.mimeType } : {}),
		blob: content.blob,
	}
}

function toolResultValue(result: McpCallToolResult): unknown {
	if (result.structuredContent) {
		return result.structuredContent
	}

	if ("toolResult" in result) {
		return result.toolResult
	}

	if (result.content) {
		const values = result.content.map(toolContentValue)
		if (values.length === 1) {
			return values[0]
		}
		return values
	}

	return result
}

function toolContentValue(content: McpToolContent): unknown {
	switch (content.type) {
		case "text":
			return parseTextValue(content.text)
		case "resource":
			return resourceContentValue(content.resource)
		case "resource_link":
			return {
				type: content.type,
				uri: content.uri,
				name: content.name,
				...(content.title ? { title: content.title } : {}),
				...(content.description ? { description: content.description } : {}),
				...(content.mimeType ? { mimeType: content.mimeType } : {}),
			}
		case "image":
		case "audio":
			return {
				type: content.type,
				data: content.data,
				mimeType: content.mimeType,
			}
	}
}

function toolResultText(result: McpCallToolResult): string {
	const value = toolResultValue(result)
	if (typeof value === "string") {
		return value
	}
	return JSON.stringify(value)
}

function parseTextValue(text: string, mimeType?: string): unknown {
	if (shouldParseJson(text, mimeType)) {
		try {
			return JSON.parse(text)
		} catch {
			return text
		}
	}
	return text
}

function shouldParseJson(text: string, mimeType?: string): boolean {
	if (mimeType?.includes("json")) {
		return true
	}

	const trimmed = text.trim()
	return trimmed.startsWith("{") || trimmed.startsWith("[")
}

function slug(value: string): string {
	return value
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-|-$/g, "")
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value)
}

function formatStandardSchemaIssues(
	issues: readonly {
		readonly message: string
		readonly path?: readonly (PropertyKey | { readonly key: PropertyKey })[]
	}[],
): string {
	return issues.map(formatStandardSchemaIssue).join("; ")
}

function formatStandardSchemaIssue(issue: {
	readonly message: string
	readonly path?: readonly (PropertyKey | { readonly key: PropertyKey })[]
}): string {
	const path = issue.path?.map(formatStandardSchemaPathSegment).join(".")
	return path ? `${path}: ${issue.message}` : issue.message
}

function formatStandardSchemaPathSegment(
	segment: PropertyKey | { readonly key: PropertyKey },
): string {
	if (typeof segment === "object" && segment !== null && "key" in segment) {
		return String(segment.key)
	}
	return String(segment)
}
