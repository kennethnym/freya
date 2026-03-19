import { WeatherSource, type WeatherSourceOptions } from "@aelis/source-weatherkit"
import { type } from "arktype"

import type { Database } from "../db/index.ts"
import type { FeedSourceProvider } from "../session/feed-source-provider.ts"

import { SourceDisabledError } from "../sources/errors.ts"
import { sources } from "../sources/user-sources.ts"

export interface WeatherSourceProviderOptions {
	db: Database
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
	private readonly db: Database
	private readonly credentials: WeatherSourceOptions["credentials"]
	private readonly client: WeatherSourceOptions["client"]

	constructor(options: WeatherSourceProviderOptions) {
		this.db = options.db
		this.credentials = options.credentials
		this.client = options.client
	}

	async feedSourceForUser(userId: string): Promise<WeatherSource> {
		const row = await sources(this.db, userId).find("aelis.weather")

		if (!row || !row.enabled) {
			throw new SourceDisabledError("aelis.weather", userId)
		}

		const parsed = weatherConfig(row.config ?? {})
		if (parsed instanceof type.errors) {
			throw new Error(`Invalid weather config for user ${userId}: ${parsed.summary}`)
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
