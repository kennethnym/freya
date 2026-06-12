export const WebSearchAction = {
	Search: "search",
} as const

export type WebSearchAction = (typeof WebSearchAction)[keyof typeof WebSearchAction]

export const WebSearchType = {
	Instant: "instant",
	Fast: "fast",
	Auto: "auto",
	DeepLite: "deep-lite",
	Deep: "deep",
	DeepReasoning: "deep-reasoning",
} as const

export type WebSearchType = (typeof WebSearchType)[keyof typeof WebSearchType]

export interface WebSearchRequest {
	query: string
	numResults?: number
	includeDomains?: string[]
	excludeDomains?: string[]
	startCrawlDate?: string
	endCrawlDate?: string
	startPublishedDate?: string
	endPublishedDate?: string
	type?: WebSearchType
	category?: string
	userLocation?: string
	moderation?: boolean
	highlights?: boolean
}

export interface WebSearchResult extends Record<string, unknown> {
	id: string
	url: string
	title: string | null
	publishedDate: string | null
	author: string | null
	image: string | null
	favicon: string | null
	text: string | null
	highlights: string[]
	highlightScores: number[]
	summary: string | null
}

export interface WebSearchResponse extends Record<string, unknown> {
	query: string
	requestId: string | null
	results: WebSearchResult[]
}

export interface WebSearchClient {
	search(request: WebSearchRequest): Promise<WebSearchResponse>
}

export interface WebSearchSourceOptions {
	apiKey?: string
	client?: WebSearchClient
}
