import { TflSource, type ITflApi } from "@aelis/source-tfl"

import type { FeedSourceProvider } from "../session/feed-source-provider.ts"

export type TflSourceProviderOptions =
	| { apiKey: string; client?: never }
	| { apiKey?: never; client: ITflApi }

export class TflSourceProvider implements FeedSourceProvider {
	private readonly options: TflSourceProviderOptions

	constructor(options: TflSourceProviderOptions) {
		this.options = options
	}

	feedSourceForUser(_userId: string): TflSource {
		return new TflSource(this.options)
	}
}
