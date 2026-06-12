import type {
	McpCallToolParams,
	McpCallToolResult,
	McpClient,
	McpListToolsResult,
	McpReadResourceParams,
	McpReadResourceResult,
} from "@freya/source-mcp"

import { describe, expect, test } from "bun:test"

import { GoogleMapsAction, GoogleMapsSource, GoogleMapsSourceId, GoogleMapsTool } from "./index"

class MockMcpClient implements McpClient {
	readonly calls: McpCallToolParams[] = []

	async listTools(): Promise<McpListToolsResult> {
		return {
			tools: Object.values(GoogleMapsTool).map((name) => ({
				name,
				description: `${name} description`,
			})),
		}
	}

	async readResource(_params: McpReadResourceParams): Promise<McpReadResourceResult> {
		throw new Error("unexpected resource read")
	}

	async callTool(params: McpCallToolParams): Promise<McpCallToolResult> {
		this.calls.push(params)
		return {
			structuredContent: {
				tool: params.name,
				arguments: params.arguments ?? {},
			},
		}
	}
}

describe("GoogleMapsSource", () => {
	test("uses the Google Maps source id", () => {
		const source = new GoogleMapsSource({ client: new MockMcpClient() })
		expect(source.id).toBe(GoogleMapsSourceId)
	})

	test("exposes documented Google Maps MCP tools as actions", async () => {
		const source = new GoogleMapsSource({ client: new MockMcpClient() })

		const actions = await source.listActions()

		expect(Object.keys(actions).sort()).toEqual(Object.values(GoogleMapsAction).sort())
		expect(actions[GoogleMapsAction.SearchPlaces]!.id).toBe(GoogleMapsAction.SearchPlaces)
	})

	test("maps action execution to the underlying MCP tool", async () => {
		const client = new MockMcpClient()
		const source = new GoogleMapsSource({ client })

		const result = await source.executeAction(GoogleMapsAction.SearchPlaces, {
			textQuery: "coffee shops near Golden Gate Park",
			regionCode: "US",
		})

		expect(client.calls).toEqual([
			{
				name: GoogleMapsTool.SearchPlaces,
				arguments: {
					textQuery: "coffee shops near Golden Gate Park",
					regionCode: "US",
				},
			},
		])
		expect(result).toEqual({
			tool: GoogleMapsTool.SearchPlaces,
			arguments: {
				textQuery: "coffee shops near Golden Gate Park",
				regionCode: "US",
			},
		})
	})

	test("validates action input before calling the MCP tool", async () => {
		const client = new MockMcpClient()
		const source = new GoogleMapsSource({ client })

		await expectRejectsWithMessage(
			source.executeAction(GoogleMapsAction.SearchPlaces, {}),
			"textQuery must be a string",
		)
		expect(client.calls).toEqual([])
	})

	test("validates resolve names query objects", async () => {
		const client = new MockMcpClient()
		const source = new GoogleMapsSource({ client })

		await expectRejectsWithMessage(
			source.executeAction(GoogleMapsAction.ResolveNames, { queries: [{}] }),
			"queries[0].text must be a string",
		)
		expect(client.calls).toEqual([])
	})

	test("does not produce feed items or context by default", async () => {
		const source = new GoogleMapsSource({ client: new MockMcpClient() })

		const contextEntries = await source.fetchContext(undefined as never)
		const items = await source.fetchItems(undefined as never)

		expect(contextEntries).toBeNull()
		expect(items).toEqual([])
	})
})

async function expectRejectsWithMessage(
	promise: Promise<unknown>,
	expectedMessage: string,
): Promise<void> {
	try {
		await promise
	} catch (err) {
		expect(errorMessage(err)).toContain(expectedMessage)
		return
	}

	throw new Error(`Expected promise to reject with "${expectedMessage}"`)
}

function errorMessage(err: unknown): string {
	if (err instanceof Error) {
		return err.message
	}
	return String(err)
}
