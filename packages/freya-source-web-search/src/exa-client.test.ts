import { describe, expect, test } from "bun:test"

import { ExaSearchClient } from "./exa-client.ts"

describe("ExaSearchClient", () => {
	test("maps request and response", async () => {
		const originalFetch = globalThis.fetch
		let requestUrl = ""
		let requestHeaders: Headers
		let requestBody: unknown

		globalThis.fetch = (async (
			input: Parameters<typeof fetch>[0],
			init?: Parameters<typeof fetch>[1],
		) => {
			requestUrl = String(input)
			requestHeaders = new Headers(init?.headers)
			requestBody = JSON.parse(String(init?.body))

			return new Response(
				JSON.stringify({
					requestId: "exa-request-1",
					results: [
						{
							id: "result-1",
							url: "https://example.com",
							title: "Example",
							publishedDate: "2026-01-01T00:00:00.000Z",
							author: "Author",
							image: "https://example.com/image.png",
							favicon: "https://example.com/favicon.ico",
							highlights: ["A useful passage"],
							highlightScores: [0.7],
							summary: "Summary",
						},
					],
				}),
				{ status: 200 },
			)
		}) as unknown as typeof fetch

		try {
			const client = new ExaSearchClient("api-key", "https://api.example.test")
			const result = await client.search({
				query: "test query",
				numResults: 3,
				includeDomains: ["example.com"],
				highlights: false,
			})

			expect(requestUrl).toBe("https://api.example.test/search")
			expect(requestHeaders!.get("x-api-key")).toBe("api-key")
			expect(requestBody).toEqual({
				query: "test query",
				numResults: 3,
				includeDomains: ["example.com"],
				contents: { highlights: false },
			})
			expect(result).toEqual({
				query: "test query",
				requestId: "exa-request-1",
				results: [
					{
						id: "result-1",
						url: "https://example.com",
						title: "Example",
						publishedDate: "2026-01-01T00:00:00.000Z",
						author: "Author",
						image: "https://example.com/image.png",
						favicon: "https://example.com/favicon.ico",
						text: null,
						highlights: ["A useful passage"],
						highlightScores: [0.7],
						summary: "Summary",
					},
				],
			})
		} finally {
			globalThis.fetch = originalFetch
		}
	})

	test("throws on non-ok response", async () => {
		const originalFetch = globalThis.fetch
		globalThis.fetch = (async () =>
			new Response("nope", { status: 401, statusText: "Unauthorized" })) as unknown as typeof fetch

		try {
			const client = new ExaSearchClient("bad-key")
			await expect(client.search({ query: "test" })).rejects.toThrow(
				"Exa API error: 401 Unauthorized",
			)
		} finally {
			globalThis.fetch = originalFetch
		}
	})
})
