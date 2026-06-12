import { Context } from "@freya/core"
import { describe, expect, test } from "bun:test"

import type { WebSearchClient, WebSearchRequest, WebSearchResponse } from "./types.ts"

import { WebSearchAction } from "./types.ts"
import { WebSearchSource } from "./web-search-source.ts"

class RecordingSearchClient implements WebSearchClient {
	requests: WebSearchRequest[] = []

	async search(request: WebSearchRequest): Promise<WebSearchResponse> {
		this.requests.push(request)
		return {
			query: request.query,
			requestId: "request-1",
			results: [
				{
					id: "https://example.com/a",
					url: "https://example.com/a",
					title: "Example result",
					publishedDate: "2026-01-01T00:00:00.000Z",
					author: "Example Author",
					image: null,
					favicon: "https://example.com/favicon.ico",
					text: null,
					highlights: ["Relevant excerpt"],
					highlightScores: [0.8],
					summary: null,
				},
			],
		}
	}
}

describe("WebSearchSource", () => {
	test("has correct id", () => {
		const source = new WebSearchSource({ client: new RecordingSearchClient() })

		expect(source.id).toBe("freya.web-search")
	})

	test("does not provide context or feed items", async () => {
		const source = new WebSearchSource({ client: new RecordingSearchClient() })

		expect("fetchItems" in source).toBe(false)
		expect(await source.fetchContext(new Context())).toBeNull()
	})

	test("lists search action", async () => {
		const source = new WebSearchSource({ client: new RecordingSearchClient() })
		const actions = await source.listActions()

		expect(actions[WebSearchAction.Search]).toBeDefined()
		expect(actions[WebSearchAction.Search]!.id).toBe(WebSearchAction.Search)
		expect(actions[WebSearchAction.Search]!.input).toBeDefined()
	})

	test("executes search action with normalized params", async () => {
		const client = new RecordingSearchClient()
		const source = new WebSearchSource({ client })

		const result = await source.executeAction(WebSearchAction.Search, {
			query: "  latest personal assistant research  ",
			includeDomains: ["exa.ai"],
			type: "fast",
			userLocation: "gb",
			moderation: true,
		})

		expect(result.requestId).toBe("request-1")
		expect(result.results).toHaveLength(1)
		expect(client.requests).toEqual([
			{
				query: "latest personal assistant research",
				numResults: 10,
				includeDomains: ["exa.ai"],
				type: "fast",
				userLocation: "GB",
				moderation: true,
			},
		])
	})

	test("allows per-call numResults override", async () => {
		const client = new RecordingSearchClient()
		const source = new WebSearchSource({ client })

		await source.executeAction(WebSearchAction.Search, {
			query: "freya",
			numResults: 2,
		})

		expect(client.requests[0]!.numResults).toBe(2)
	})

	test("throws for invalid action", async () => {
		const source = new WebSearchSource({ client: new RecordingSearchClient() })

		await expect(source.executeAction("missing", {})).rejects.toThrow("Unknown action")
	})

	test("throws for invalid search params", async () => {
		const source = new WebSearchSource({ client: new RecordingSearchClient() })

		await expect(
			source.executeAction(WebSearchAction.Search, {
				query: "",
			}),
		).rejects.toThrow("query must not be empty")

		await expect(
			source.executeAction(WebSearchAction.Search, {
				query: "x",
				numResults: 101,
			}),
		).rejects.toThrow("numResults must be an integer")
	})

	test("throws if neither client nor apiKey is provided", () => {
		expect(() => new WebSearchSource({})).toThrow("Either client or apiKey must be provided")
	})
})
