import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import {
	StreamableHTTPClientTransport,
	type StreamableHTTPClientTransportOptions,
} from "@modelcontextprotocol/sdk/client/streamableHttp.js"

export interface McpRequestOptions {
	readonly signal?: AbortSignal
	readonly timeout?: number
}

export interface McpListToolsParams {
	readonly cursor?: string
}

export interface McpReadResourceParams {
	readonly uri: string
}

export interface McpCallToolParams {
	readonly name: string
	readonly arguments?: Record<string, unknown>
}

export interface McpTool {
	readonly name: string
	readonly title?: string
	readonly description?: string
	readonly inputSchema?: {
		readonly type: "object"
		readonly properties?: Record<string, object>
		readonly required?: string[]
		readonly [key: string]: unknown
	}
	readonly outputSchema?: {
		readonly type: "object"
		readonly properties?: Record<string, object>
		readonly required?: string[]
		readonly [key: string]: unknown
	}
	readonly annotations?: {
		readonly title?: string
		readonly readOnlyHint?: boolean
		readonly destructiveHint?: boolean
		readonly idempotentHint?: boolean
		readonly openWorldHint?: boolean
	}
	readonly _meta?: Record<string, unknown>
}

export interface McpListToolsResult {
	readonly tools: readonly McpTool[]
	readonly nextCursor?: string
}

export type McpResourceContent = McpTextResourceContent | McpBlobResourceContent

export interface McpTextResourceContent {
	readonly uri: string
	readonly mimeType?: string
	readonly text: string
	readonly _meta?: Record<string, unknown>
}

export interface McpBlobResourceContent {
	readonly uri: string
	readonly mimeType?: string
	readonly blob: string
	readonly _meta?: Record<string, unknown>
}

export interface McpReadResourceResult {
	readonly contents: readonly McpResourceContent[]
	readonly _meta?: Record<string, unknown>
}

export type McpToolContent =
	| McpToolTextContent
	| McpToolImageContent
	| McpToolAudioContent
	| McpToolResourceContent
	| McpToolResourceLinkContent

export interface McpToolTextContent {
	readonly type: "text"
	readonly text: string
	readonly _meta?: Record<string, unknown>
}

export interface McpToolImageContent {
	readonly type: "image"
	readonly data: string
	readonly mimeType: string
	readonly _meta?: Record<string, unknown>
}

export interface McpToolAudioContent {
	readonly type: "audio"
	readonly data: string
	readonly mimeType: string
	readonly _meta?: Record<string, unknown>
}

export interface McpToolResourceContent {
	readonly type: "resource"
	readonly resource: McpResourceContent
	readonly _meta?: Record<string, unknown>
}

export interface McpToolResourceLinkContent {
	readonly type: "resource_link"
	readonly uri: string
	readonly name: string
	readonly title?: string
	readonly description?: string
	readonly mimeType?: string
	readonly _meta?: Record<string, unknown>
}

export interface McpCallToolResult {
	readonly content?: readonly McpToolContent[]
	readonly structuredContent?: Record<string, unknown>
	readonly toolResult?: unknown
	readonly isError?: boolean
	readonly _meta?: Record<string, unknown>
	readonly [key: string]: unknown
}

export interface McpClient {
	listTools(params?: McpListToolsParams, options?: McpRequestOptions): Promise<McpListToolsResult>
	readResource(
		params: McpReadResourceParams,
		options?: McpRequestOptions,
	): Promise<McpReadResourceResult>
	callTool(params: McpCallToolParams, options?: McpRequestOptions): Promise<McpCallToolResult>
	close?(): Promise<void>
}

export type McpHttpHeaders =
	| Headers
	| Record<string, string>
	| readonly (readonly [string, string])[]

export interface StreamableHttpMcpClientOptions {
	readonly url: string | URL
	readonly name?: string
	readonly version?: string
	readonly timeoutMs?: number
	readonly headers?: McpHttpHeaders | (() => Promise<McpHttpHeaders>)
	readonly requestInit?: RequestInit
	readonly transportOptions?: Omit<StreamableHTTPClientTransportOptions, "requestInit">
}

export class StreamableHttpMcpClient implements McpClient {
	private clientPromise: Promise<Client> | null = null

	constructor(private readonly options: StreamableHttpMcpClientOptions) {}

	async listTools(
		params?: McpListToolsParams,
		options?: McpRequestOptions,
	): Promise<McpListToolsResult> {
		const request = requestOptions(this.options.timeoutMs, options)
		const client = await this.client(request)
		return client.listTools(params, request)
	}

	async readResource(
		params: McpReadResourceParams,
		options?: McpRequestOptions,
	): Promise<McpReadResourceResult> {
		const request = requestOptions(this.options.timeoutMs, options)
		const client = await this.client(request)
		return client.readResource(params, request)
	}

	async callTool(
		params: McpCallToolParams,
		options?: McpRequestOptions,
	): Promise<McpCallToolResult> {
		const request = requestOptions(this.options.timeoutMs, options)
		const client = await this.client(request)
		return client.callTool(params, undefined, request)
	}

	async close(): Promise<void> {
		if (!this.clientPromise) return
		const client = await this.clientPromise
		this.clientPromise = null
		await client.close()
	}

	private client(options?: McpRequestOptions): Promise<Client> {
		if (!this.clientPromise) {
			const promise = this.connect(options)
			this.clientPromise = promise
			void promise.catch(() => {
				if (this.clientPromise === promise) {
					this.clientPromise = null
				}
			})
		}
		return this.clientPromise
	}

	private async connect(options?: McpRequestOptions): Promise<Client> {
		const client = new Client({
			name: this.options.name ?? "freya-source-mcp",
			version: this.options.version ?? "0.0.0",
		})

		const transport = new StreamableHTTPClientTransport(toUrl(this.options.url), {
			...this.options.transportOptions,
			requestInit: await mergeRequestInit(this.options.requestInit, this.options.headers),
		})

		await client.connect(transport, options)
		return client
	}
}

function requestOptions(
	defaultTimeoutMs: number | undefined,
	options: McpRequestOptions | undefined,
): McpRequestOptions | undefined {
	if (defaultTimeoutMs === undefined && options === undefined) {
		return undefined
	}
	return {
		...(defaultTimeoutMs === undefined ? {} : { timeout: defaultTimeoutMs }),
		...options,
	}
}

function toUrl(value: string | URL): URL {
	if (value instanceof URL) return value
	return new URL(value)
}

async function mergeRequestInit(
	requestInit: RequestInit | undefined,
	headers: McpHttpHeaders | (() => Promise<McpHttpHeaders>) | undefined,
): Promise<RequestInit | undefined> {
	if (!requestInit && !headers) return undefined

	const mergedHeaders = new Headers(requestInit?.headers)
	const extraHeaders = typeof headers === "function" ? await headers() : headers
	if (extraHeaders) {
		applyHeaders(mergedHeaders, extraHeaders)
	}

	return {
		...requestInit,
		headers: mergedHeaders,
	}
}

function applyHeaders(target: Headers, headers: McpHttpHeaders): void {
	if (headers instanceof Headers) {
		headers.forEach((value, key) => {
			target.set(key, value)
		})
		return
	}

	if (Array.isArray(headers)) {
		for (const [key, value] of headers) {
			target.set(key, value)
		}
		return
	}

	for (const [key, value] of Object.entries(headers)) {
		target.set(key, value)
	}
}
