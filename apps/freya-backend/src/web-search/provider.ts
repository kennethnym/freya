import { WebSearchSource, type WebSearchClient } from "@freya/source-web-search"

import type { FeedSourceProvider } from "../session/feed-source-provider.ts"

export type WebSearchSourceProviderOptions =
	| { apiKey: string | undefined; client?: never }
	| { apiKey?: never; client: WebSearchClient }

export class WebSearchSourceProvider implements FeedSourceProvider {
	readonly sourceId = "freya.web-search"

	private readonly apiKey: string | undefined
	private readonly client: WebSearchClient | undefined

	constructor(options: WebSearchSourceProviderOptions) {
		this.apiKey = "apiKey" in options ? options.apiKey : undefined
		this.client = "client" in options ? options.client : undefined
	}

	async feedSourceForUser(
		_userId: string,
		_config: unknown,
		_credentials: unknown,
	): Promise<WebSearchSource> {
		return new WebSearchSource({
			apiKey: this.apiKey,
			client: this.client,
		})
	}
}
