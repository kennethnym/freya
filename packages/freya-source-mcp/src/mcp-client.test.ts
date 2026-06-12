import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js"
import { describe, expect, test } from "bun:test"

import { StreamableHttpMcpClient, type StreamableHttpMcpClientOptions } from "./mcp-client"

type JsonRpcId = string | number

type FetchLike = NonNullable<
	NonNullable<StreamableHttpMcpClientOptions["transportOptions"]>["fetch"]
>

describe("StreamableHttpMcpClient", () => {
	test("retries connection after initial connection failure", async () => {
		const methods: string[] = []
		let initializeAttempts = 0
		const fetch: FetchLike = async (_url, init) => {
			const method = requestMethod(init)

			if (init?.method === "GET") {
				return new Response(null, { status: 405, statusText: "Method Not Allowed" })
			}

			methods.push(method)
			switch (method) {
				case "initialize":
					initializeAttempts += 1
					if (initializeAttempts === 1) {
						throw new Error("Transient connection failure")
					}
					return jsonRpcResponse(requestId(init), {
						protocolVersion: "2025-06-18",
						capabilities: {
							tools: {},
						},
						serverInfo: {
							name: "test-mcp",
							version: "1.0.0",
						},
					})
				case "notifications/initialized":
					return new Response(null, { status: 202, statusText: "Accepted" })
				case "tools/list":
					return jsonRpcResponse(requestId(init), {
						tools: [],
					})
				default:
					throw new Error(`Unexpected MCP method: ${method}`)
			}
		}

		const client = new StreamableHttpMcpClient({
			url: "https://example.test/mcp",
			transportOptions: { fetch },
		})

		await expectRejectedMessage(client.listTools(), "Transient connection failure")

		const result = await client.listTools()
		await client.close()

		expect(result.tools).toEqual([])
		expect(initializeAttempts).toBe(2)
		expect(methods).toEqual(["initialize", "initialize", "notifications/initialized", "tools/list"])
	})

	test("applies timeout to initial connection request", async () => {
		const methods: string[] = []
		let initializeAttempts = 0
		const fetch: FetchLike = async (_url, init) => {
			if (init?.method === "GET") {
				return new Response(null, { status: 405, statusText: "Method Not Allowed" })
			}

			const method = requestMethod(init)
			methods.push(method)

			switch (method) {
				case "initialize":
					initializeAttempts += 1
					if (initializeAttempts === 1) {
						return new Promise<Response>(() => {})
					}
					return jsonRpcResponse(requestId(init), {
						protocolVersion: "2025-06-18",
						capabilities: {
							tools: {},
						},
						serverInfo: {
							name: "test-mcp",
							version: "1.0.0",
						},
					})
				case "notifications/cancelled":
				case "notifications/initialized":
					return new Response(null, { status: 202, statusText: "Accepted" })
				case "tools/list":
					return jsonRpcResponse(requestId(init), {
						tools: [],
					})
				default:
					throw new Error(`Unexpected MCP method: ${method}`)
			}
		}

		const client = new StreamableHttpMcpClient({
			url: "https://example.test/mcp",
			timeoutMs: 1,
			transportOptions: { fetch },
		})

		await expectMcpErrorCode(client.listTools(), ErrorCode.RequestTimeout)

		const result = await client.listTools()
		await client.close()

		expect(result.tools).toEqual([])
		expect(initializeAttempts).toBe(2)
		expect(methods).toEqual([
			"initialize",
			"notifications/cancelled",
			"initialize",
			"notifications/initialized",
			"tools/list",
		])
	})

	test("applies caller signal to initial connection request", async () => {
		const methods: string[] = []
		const fetch = createSuccessfulFetch(methods)
		const controller = new AbortController()
		controller.abort(new Error("Caller aborted"))

		const client = new StreamableHttpMcpClient({
			url: "https://example.test/mcp",
			transportOptions: { fetch },
		})

		await expectRejectedMessageContaining(
			client.listTools(undefined, { signal: controller.signal }),
			"Caller aborted",
		)
		expect(methods).toEqual([])

		const result = await client.listTools()
		await client.close()

		expect(result.tools).toEqual([])
		expect(methods).toEqual(["initialize", "notifications/initialized", "tools/list"])
	})
})

function createSuccessfulFetch(methods: string[]): FetchLike {
	return async (_url, init) => {
		if (init?.method === "GET") {
			return new Response(null, { status: 405, statusText: "Method Not Allowed" })
		}

		const method = requestMethod(init)
		methods.push(method)

		switch (method) {
			case "initialize":
				return jsonRpcResponse(requestId(init), {
					protocolVersion: "2025-06-18",
					capabilities: {
						tools: {},
					},
					serverInfo: {
						name: "test-mcp",
						version: "1.0.0",
					},
				})
			case "notifications/initialized":
				return new Response(null, { status: 202, statusText: "Accepted" })
			case "tools/list":
				return jsonRpcResponse(requestId(init), {
					tools: [],
				})
			default:
				throw new Error(`Unexpected MCP method: ${method}`)
		}
	}
}

function jsonRpcResponse(id: JsonRpcId, result: Record<string, unknown>): Response {
	return Response.json({
		jsonrpc: "2.0",
		id,
		result,
	})
}

function requestMethod(init: RequestInit | undefined): string {
	const request = requestBody(init)
	const method = request.method
	if (typeof method !== "string") {
		throw new Error("Expected JSON-RPC request method")
	}
	return method
}

function requestId(init: RequestInit | undefined): JsonRpcId {
	const request = requestBody(init)
	const id = request.id
	if (typeof id !== "string" && typeof id !== "number") {
		throw new Error("Expected JSON-RPC request id")
	}
	return id
}

function requestBody(init: RequestInit | undefined): Record<string, unknown> {
	const body = init?.body
	if (typeof body !== "string") {
		throw new Error("Expected string request body")
	}

	const value: unknown = JSON.parse(body)
	if (!isRecord(value)) {
		throw new Error("Expected object request body")
	}

	return value
}

async function expectRejectedMessage(promise: Promise<unknown>, message: string): Promise<void> {
	try {
		await promise
	} catch (error) {
		expect(error).toBeInstanceOf(Error)
		if (error instanceof Error) {
			expect(error.message).toBe(message)
			return
		}
		throw new Error("Expected promise to reject with an Error")
	}

	throw new Error(`Expected promise to reject with message: ${message}`)
}

async function expectMcpErrorCode(promise: Promise<unknown>, code: ErrorCode): Promise<void> {
	try {
		await promise
	} catch (error) {
		expect(error).toBeInstanceOf(McpError)
		if (error instanceof McpError) {
			expect(error.code).toBe(code)
			return
		}
		throw new Error("Expected promise to reject with an McpError")
	}

	throw new Error(`Expected promise to reject with MCP error code: ${code}`)
}

async function expectRejectedMessageContaining(
	promise: Promise<unknown>,
	message: string,
): Promise<void> {
	try {
		await promise
	} catch (error) {
		expect(error).toBeInstanceOf(Error)
		if (error instanceof Error) {
			expect(error.message).toContain(message)
			return
		}
		throw new Error("Expected promise to reject with an Error")
	}

	throw new Error(`Expected promise to reject with message containing: ${message}`)
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value)
}
