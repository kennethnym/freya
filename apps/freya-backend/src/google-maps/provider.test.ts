import type { GoogleMapsSourceOptions } from "@freya/source-google-maps"

import { describe, expect, test } from "bun:test"

import { GoogleMapsSourceProvider } from "./provider.ts"

type McpClient = NonNullable<GoogleMapsSourceOptions["client"]>

class MockMcpClient implements McpClient {
	async listTools(): ReturnType<McpClient["listTools"]> {
		return { tools: [] }
	}

	async readResource(
		_params: Parameters<McpClient["readResource"]>[0],
	): ReturnType<McpClient["readResource"]> {
		throw new Error("unexpected resource read")
	}

	async callTool(_params: Parameters<McpClient["callTool"]>[0]): ReturnType<McpClient["callTool"]> {
		return { structuredContent: {} }
	}
}

describe("GoogleMapsSourceProvider", () => {
	test("sourceId is freya.google-maps", () => {
		const provider = new GoogleMapsSourceProvider({ apiKey: "key" })
		expect(provider.sourceId).toBe("freya.google-maps")
	})

	test("throws when service API key is empty", () => {
		expect(() => new GoogleMapsSourceProvider({ apiKey: "" })).toThrow(
			"Google Maps API key must be configured",
		)
	})

	test("returns source with service API key", async () => {
		const provider = new GoogleMapsSourceProvider({ apiKey: "key" })

		const source = await provider.feedSourceForUser("user-1", {}, null)

		expect(source.id).toBe("freya.google-maps")
	})

	test("allows injected test client with service API key", async () => {
		const provider = new GoogleMapsSourceProvider({
			apiKey: "key",
			client: new MockMcpClient(),
		})

		const source = await provider.feedSourceForUser("user-1", {}, null)

		expect(source.id).toBe("freya.google-maps")
	})
})
