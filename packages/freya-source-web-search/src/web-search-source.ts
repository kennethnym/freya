import type { ActionDefinition, Context, ContextEntry, FeedSource } from "@freya/core"

import { UnknownActionError } from "@freya/core"
import { type } from "arktype"

import type {
	WebSearchClient,
	WebSearchRequest,
	WebSearchResponse,
	WebSearchSourceOptions,
} from "./types.ts"

import { ExaSearchClient } from "./exa-client.ts"
import { WebSearchAction, WebSearchType } from "./types.ts"

const DEFAULT_NUM_RESULTS = 10
const MIN_NUM_RESULTS = 1
const MAX_NUM_RESULTS = 100

const SearchInput = type({
	"+": "reject",
	query: "string",
	"numResults?": "number",
	"includeDomains?": "string[]",
	"excludeDomains?": "string[]",
	"startCrawlDate?": "string.date.iso",
	"endCrawlDate?": "string.date.iso",
	"startPublishedDate?": "string.date.iso",
	"endPublishedDate?": "string.date.iso",
	"type?": "'instant' | 'fast' | 'auto' | 'deep-lite' | 'deep' | 'deep-reasoning'",
	"category?": "string",
	"userLocation?": "string",
	"moderation?": "boolean",
	"highlights?": "boolean",
})

/**
 * Action-only FeedSource for web search through Exa.
 *
 * It intentionally does not produce feed items. Consumers call the `search`
 * action and receive structured web results.
 */
export class WebSearchSource implements FeedSource {
	readonly id = "freya.web-search"

	private readonly client: WebSearchClient

	constructor(options: WebSearchSourceOptions) {
		if (!options.client && !options.apiKey) {
			throw new Error("Either client or apiKey must be provided")
		}
		this.client = options.client ?? new ExaSearchClient(options.apiKey!)
	}

	async listActions(): Promise<Record<string, ActionDefinition>> {
		return {
			[WebSearchAction.Search]: {
				id: WebSearchAction.Search,
				description: "Search the web and return structured results",
				input: SearchInput,
			},
		}
	}

	async executeAction(actionId: string, params: unknown): Promise<WebSearchResponse> {
		switch (actionId) {
			case WebSearchAction.Search:
				return this.client.search(this.parseSearchInput(params))
			default:
				throw new UnknownActionError(actionId)
		}
	}

	async fetchContext(_context: Context): Promise<readonly ContextEntry[] | null> {
		return null
	}

	private parseSearchInput(params: unknown): WebSearchRequest {
		const parsed = SearchInput(params)
		if (parsed instanceof type.errors) {
			throw new Error(parsed.summary)
		}

		const query = parsed.query.trim()
		if (!query) {
			throw new Error("query must not be empty")
		}

		const numResults = parsed.numResults ?? DEFAULT_NUM_RESULTS
		if (
			!Number.isInteger(numResults) ||
			numResults < MIN_NUM_RESULTS ||
			numResults > MAX_NUM_RESULTS
		) {
			throw new Error(`numResults must be an integer from ${MIN_NUM_RESULTS} to ${MAX_NUM_RESULTS}`)
		}

		if (parsed.userLocation && !/^[A-Za-z]{2}$/.test(parsed.userLocation)) {
			throw new Error("userLocation must be a two-letter ISO country code")
		}

		const request: WebSearchRequest = {
			query,
			numResults,
		}

		if (parsed.includeDomains) request.includeDomains = parsed.includeDomains
		if (parsed.excludeDomains) request.excludeDomains = parsed.excludeDomains
		if (parsed.startCrawlDate) request.startCrawlDate = parsed.startCrawlDate
		if (parsed.endCrawlDate) request.endCrawlDate = parsed.endCrawlDate
		if (parsed.startPublishedDate) request.startPublishedDate = parsed.startPublishedDate
		if (parsed.endPublishedDate) request.endPublishedDate = parsed.endPublishedDate
		if (parsed.type) request.type = parsed.type as WebSearchType
		if (parsed.category) request.category = parsed.category
		if (parsed.userLocation) request.userLocation = parsed.userLocation.toUpperCase()
		if (parsed.moderation !== undefined) request.moderation = parsed.moderation
		if (parsed.highlights !== undefined) request.highlights = parsed.highlights

		return request
	}
}
