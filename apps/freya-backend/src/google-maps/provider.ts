import { GoogleMapsSource, type GoogleMapsSourceOptions } from "@freya/source-google-maps"

import type { FeedSourceProvider } from "../session/feed-source-provider.ts"

export interface GoogleMapsSourceProviderOptions {
	readonly apiKey: string
	readonly client?: GoogleMapsSourceOptions["client"]
}

export class GoogleMapsSourceProvider implements FeedSourceProvider {
	readonly sourceId = "freya.google-maps"

	private readonly apiKey: string
	private readonly client: GoogleMapsSourceProviderOptions["client"]

	constructor(options: GoogleMapsSourceProviderOptions) {
		if (!nonEmptyString(options.apiKey)) {
			throw new Error("Google Maps MCP API key must be configured")
		}

		this.apiKey = options.apiKey
		this.client = options.client
	}

	async feedSourceForUser(
		_userId: string,
		_config: unknown,
		_credentials: unknown,
	): Promise<GoogleMapsSource> {
		return new GoogleMapsSource({
			apiKey: this.apiKey,
			client: this.client,
		})
	}
}

function nonEmptyString(value: string): boolean {
	return typeof value === "string" && value.trim().length > 0
}
