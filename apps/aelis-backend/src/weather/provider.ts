import { WeatherSource, type WeatherSourceOptions } from "@aelis/source-weatherkit"

import type { FeedSourceProvider } from "../session/feed-source-provider.ts"

export class WeatherSourceProvider implements FeedSourceProvider {
	private readonly options: WeatherSourceOptions

	constructor(options: WeatherSourceOptions) {
		this.options = options
	}

	feedSourceForUser(_userId: string): WeatherSource {
		return new WeatherSource(this.options)
	}
}
