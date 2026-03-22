import { WeatherSource, type WeatherSourceOptions } from "@aelis/source-weatherkit"
import { type } from "arktype"

import type { FeedSourceProvider } from "../session/feed-source-provider.ts"

export interface WeatherSourceProviderOptions {
	credentials: WeatherSourceOptions["credentials"]
	client?: WeatherSourceOptions["client"]
}

const weatherConfig = type({
	"units?": "'metric' | 'imperial'",
	"hourlyLimit?": "number",
	"dailyLimit?": "number",
})

export class WeatherSourceProvider implements FeedSourceProvider {
	readonly sourceId = "aelis.weather"
	private readonly credentials: WeatherSourceOptions["credentials"]
	private readonly client: WeatherSourceOptions["client"]

	constructor(options: WeatherSourceProviderOptions) {
		this.credentials = options.credentials
		this.client = options.client
	}

	async feedSourceForUser(_userId: string, config: unknown): Promise<WeatherSource> {
		const parsed = weatherConfig(config)
		if (parsed instanceof type.errors) {
			throw new Error(`Invalid weather config: ${parsed.summary}`)
		}

		return new WeatherSource({
			credentials: this.credentials,
			client: this.client,
			units: parsed.units,
			hourlyLimit: parsed.hourlyLimit,
			dailyLimit: parsed.dailyLimit,
		})
	}
}
