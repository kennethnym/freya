import { WeatherSource, type WeatherSourceOptions } from "@aelis/source-weatherkit"

import type { FeedSourceProvider } from "../session/feed-source-provider.ts"

export class WeatherSourceProvider implements FeedSourceProvider {
	private readonly options: WeatherSourceOptions

	constructor(options: WeatherSourceOptions) {
		this.options = options
	}

	async feedSourceForUser(_userId: string): Promise<WeatherSource> {
		return new WeatherSource(this.options)
	}
}
