import { type } from "arktype"

import type {
	WebSearchClient,
	WebSearchRequest,
	WebSearchResponse,
	WebSearchResult,
} from "./types.ts"

const EXA_API_BASE = "https://api.exa.ai"
const DEFAULT_NUM_RESULTS = 10

const ExaSearchResult = type({
	id: "string",
	url: "string",
	"title?": "string | null",
	"publishedDate?": "string | null",
	"author?": "string | null",
	"image?": "string | null",
	"favicon?": "string | null",
	"text?": "string | null",
	"highlights?": "string[]",
	"highlightScores?": "number[]",
	"summary?": "string | null",
})

const ExaSearchResponse = type({
	results: ExaSearchResult.array(),
	"requestId?": "string",
})

interface ExaSearchBody {
	query: string
	numResults?: number
	includeDomains?: string[]
	excludeDomains?: string[]
	startCrawlDate?: string
	endCrawlDate?: string
	startPublishedDate?: string
	endPublishedDate?: string
	type?: WebSearchRequest["type"]
	category?: string
	userLocation?: string
	moderation?: boolean
	contents: {
		highlights: boolean
	}
}

export class ExaSearchClient implements WebSearchClient {
	private readonly apiKey: string
	private readonly baseUrl: string

	constructor(apiKey: string, baseUrl = EXA_API_BASE) {
		this.apiKey = apiKey
		this.baseUrl = baseUrl
	}

	async search(request: WebSearchRequest): Promise<WebSearchResponse> {
		const response = await fetch(new URL("/search", this.baseUrl), {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"x-api-key": this.apiKey,
			},
			body: JSON.stringify(toExaSearchBody(request)),
		})

		if (!response.ok) {
			throw new Error(`Exa API error: ${response.status} ${response.statusText}`)
		}

		const data = await response.json()
		const parsed = ExaSearchResponse(data)
		if (parsed instanceof type.errors) {
			throw new Error(`Invalid Exa API response: ${parsed.summary}`)
		}

		return {
			query: request.query,
			requestId: parsed.requestId ?? null,
			results: parsed.results.map(toWebSearchResult),
		}
	}
}

function toExaSearchBody(request: WebSearchRequest): ExaSearchBody {
	const body: ExaSearchBody = {
		query: request.query,
		numResults: request.numResults ?? DEFAULT_NUM_RESULTS,
		contents: {
			highlights: request.highlights ?? true,
		},
	}

	if (request.includeDomains) body.includeDomains = request.includeDomains
	if (request.excludeDomains) body.excludeDomains = request.excludeDomains
	if (request.startCrawlDate) body.startCrawlDate = request.startCrawlDate
	if (request.endCrawlDate) body.endCrawlDate = request.endCrawlDate
	if (request.startPublishedDate) body.startPublishedDate = request.startPublishedDate
	if (request.endPublishedDate) body.endPublishedDate = request.endPublishedDate
	if (request.type) body.type = request.type
	if (request.category) body.category = request.category
	if (request.userLocation) body.userLocation = request.userLocation
	if (request.moderation !== undefined) body.moderation = request.moderation

	return body
}

function toWebSearchResult(result: typeof ExaSearchResult.infer): WebSearchResult {
	return {
		id: result.id,
		url: result.url,
		title: result.title ?? null,
		publishedDate: result.publishedDate ?? null,
		author: result.author ?? null,
		image: result.image ?? null,
		favicon: result.favicon ?? null,
		text: result.text ?? null,
		highlights: result.highlights ?? [],
		highlightScores: result.highlightScores ?? [],
		summary: result.summary ?? null,
	}
}
